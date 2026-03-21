import { createWriteStream } from 'node:fs'
import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pipeline } from 'node:stream/promises'
import type { Multipart } from '@fastify/multipart'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import yauzl from 'yauzl'
import { getSkillRegistry } from '../skills/registry.js'
import { rankIndexEntries } from '../skills/index-ranker.js'
import {
  installRemoteSkill,
  uninstallRemoteSkill,
  listRemoteSkills,
  checkRemoteSkillUpdate,
} from '../skills/remote-installer.js'
import {
  installLocalSkillFromStaging,
  previewLocalSkillFromStaging,
  uninstallImportedSkill,
} from '../skills/local-installer.js'
import type { RemoteSkillIndexEntry } from '../skills/types.js'

const SKILLS_INDEX_URL = process.env['SEA_SKILLS_INDEX_URL']
  ?? 'https://raw.githubusercontent.com/multi-agents-sea/skills-index/main/skills-index.json'
const LOCAL_IMPORT_BODY_LIMIT = 50 * 1024 * 1024
const LOCAL_IMPORT_MAX_FILE_SIZE = 10 * 1024 * 1024
const LOCAL_IMPORT_MAX_TOTAL_SIZE = 50 * 1024 * 1024
const SKILLS_INDEX_CACHE_TTL_MS = 5 * 60 * 1000

let cachedSkillsIndex: RemoteSkillIndexEntry[] | null = null
let cachedSkillsIndexAt = 0

interface MultipartStagingResult {
  stagingDir: string
  cleanupDir: string
  originalFilename: string | null
}

function normalizeZipEntryName(entryName: string): string {
  return entryName.replaceAll('\\', '/')
}

function assertSafeZipEntryName(entryName: string): void {
  const normalized = normalizeZipEntryName(entryName)
  if (normalized.startsWith('/') || normalized.includes('../') || normalized.includes('..\\') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`ZIP 条目路径非法: ${entryName}`)
  }
}

function sanitizeUploadFilename(filename: string): string {
  const normalized = filename.replaceAll('\\', '/')
  const segments = normalized.split('/').filter(Boolean)
  const last = segments[segments.length - 1] ?? ''
  if (!last || last === '.' || last === '..') {
    throw new Error('上传文件名无效')
  }
  return last
}

async function extractZipToDir(zipFilePath: string, targetDir: string): Promise<void> {
  const zipFile = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(zipFilePath, { lazyEntries: true }, (err, file) => {
      if (err || !file) {
        reject(err ?? new Error('无法打开 ZIP 文件'))
        return
      }
      resolve(file)
    })
  })

  let totalSize = 0

  await new Promise<void>((resolve, reject) => {
    let settled = false

    const finishError = (error: unknown): void => {
      if (settled) return
      settled = true
      try {
        zipFile.close()
      } catch {
        // ignore close errors
      }
      reject(error instanceof Error ? error : new Error(String(error)))
    }

    const processEntry = async (entry: yauzl.Entry): Promise<void> => {
      assertSafeZipEntryName(entry.fileName)
      const normalizedName = normalizeZipEntryName(entry.fileName)
      const outputPath = join(targetDir, normalizedName)
      if (normalizedName.endsWith('/')) {
        await mkdir(outputPath, { recursive: true })
        return
      }

      if (entry.uncompressedSize > LOCAL_IMPORT_MAX_FILE_SIZE) {
        throw new Error(`ZIP 条目过大: ${entry.fileName}`)
      }
      totalSize += entry.uncompressedSize
      if (totalSize > LOCAL_IMPORT_MAX_TOTAL_SIZE) {
        throw new Error('ZIP 总解压体积超过限制')
      }

      await mkdir(dirname(outputPath), { recursive: true })
      const stream = await new Promise<NodeJS.ReadableStream>((resolveStream, rejectStream) => {
        zipFile.openReadStream(entry, (err, readStream) => {
          if (err || !readStream) {
            rejectStream(err ?? new Error(`无法读取 ZIP 条目: ${entry.fileName}`))
            return
          }
          resolveStream(readStream)
        })
      })
      await pipeline(stream, createWriteStream(outputPath))
    }

    zipFile.on('entry', (entry) => {
      void processEntry(entry)
        .then(() => {
          zipFile.readEntry()
        })
        .catch(finishError)
    })

    zipFile.on('end', () => {
      if (settled) return
      settled = true
      resolve()
    })
    zipFile.on('error', finishError)
    zipFile.readEntry()
  })
}

async function buildStagingFromMultipart(request: FastifyRequest): Promise<MultipartStagingResult> {
  if (!request.isMultipart()) {
    throw new Error('请求必须使用 multipart/form-data')
  }

  const cleanupDir = await mkdtemp(join(tmpdir(), 'sea-skill-upload-'))
  const uploadsDir = join(cleanupDir, 'uploads')
  await mkdir(uploadsDir, { recursive: true })

  const uploadedFilePaths: string[] = []
  let originalFilename: string | null = null
  let totalUploadedSize = 0

  for await (const part of request.parts() as AsyncIterable<Multipart>) {
    if (part.type !== 'file') {
      continue
    }
    const safeFilename = sanitizeUploadFilename(part.filename)
    const outputPath = join(uploadsDir, safeFilename)
    await pipeline(part.file, createWriteStream(outputPath))
    const uploadedStat = await stat(outputPath)
    if (uploadedStat.size > LOCAL_IMPORT_MAX_FILE_SIZE) {
      throw new Error(`上传文件过大: ${safeFilename}`)
    }
    totalUploadedSize += uploadedStat.size
    if (totalUploadedSize > LOCAL_IMPORT_MAX_TOTAL_SIZE) {
      throw new Error('上传文件总体积超过限制')
    }
    uploadedFilePaths.push(outputPath)
    if (!originalFilename) {
      originalFilename = safeFilename
    }
  }

  if (uploadedFilePaths.length === 0) {
    await rm(cleanupDir, { recursive: true, force: true })
    throw new Error('未检测到上传文件')
  }

  const zipFiles = uploadedFilePaths.filter((filePath) => extname(filePath).toLowerCase() === '.zip')
  if (zipFiles.length > 1 || (zipFiles.length === 1 && uploadedFilePaths.length > 1)) {
    await rm(cleanupDir, { recursive: true, force: true })
    throw new Error('仅支持上传单个 ZIP 文件，或上传非 ZIP 文件集合')
  }

  if (zipFiles.length === 1) {
    const extractedDir = join(cleanupDir, 'extracted')
    await mkdir(extractedDir, { recursive: true })
    await extractZipToDir(zipFiles[0]!, extractedDir)
    return {
      stagingDir: extractedDir,
      cleanupDir,
      originalFilename,
    }
  }

  return {
    stagingDir: uploadsDir,
    cleanupDir,
    originalFilename,
  }
}

async function fetchSkillsIndexWithCache(): Promise<RemoteSkillIndexEntry[]> {
  const now = Date.now()
  if (cachedSkillsIndex && now - cachedSkillsIndexAt < SKILLS_INDEX_CACHE_TTL_MS) {
    return cachedSkillsIndex
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const res = await fetch(SKILLS_INDEX_URL, { signal: controller.signal })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }
    const data = await res.json() as unknown
    if (!Array.isArray(data)) {
      throw new Error('Skills index must be an array')
    }
    cachedSkillsIndex = data as RemoteSkillIndexEntry[]
    cachedSkillsIndexAt = now
    return cachedSkillsIndex
  } finally {
    clearTimeout(timer)
  }
}

export async function skillsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/skills', async (_request, reply) => {
    const registry = getSkillRegistry()
    return reply.send({
      version: registry.getVersion(),
      skills: registry.list().map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        version: skill.version ?? null,
        source: skill.source,
        mode: skill.metadata.mode ?? 'prompt-only',
        homepage: skill.metadata.homepage ?? null,
        enabled: skill.enabled,
        trusted: skill.trusted,
        eligible: skill.eligible,
        disabledReasons: skill.disabledReasons,
      })),
    })
  })

  app.post<{ Params: { id: string } }>('/skills/:id/enable', async (request, reply) => {
    const registry = getSkillRegistry()
    const skill = await registry.setEnabled(request.params.id, true)
    if (!skill) {
      return reply.status(404).send({ error: `Skill not found: ${request.params.id}` })
    }

    return reply.send({ ok: true, skillId: skill.id, enabled: skill.enabled })
  })

  app.post<{ Params: { id: string } }>('/skills/:id/disable', async (request, reply) => {
    const registry = getSkillRegistry()
    const skill = await registry.setEnabled(request.params.id, false)
    if (!skill) {
      return reply.status(404).send({ error: `Skill not found: ${request.params.id}` })
    }

    return reply.send({ ok: true, skillId: skill.id, enabled: skill.enabled })
  })

  app.post<{ Params: { id: string } }>('/skills/:id/trust', async (request, reply) => {
    const registry = getSkillRegistry()
    const skill = await registry.setTrusted(request.params.id, true)
    if (!skill) {
      return reply.status(404).send({ error: `Skill not found: ${request.params.id}` })
    }

    return reply.send({ ok: true, skillId: skill.id, trusted: skill.trusted })
  })

  app.post<{ Params: { id: string } }>('/skills/:id/untrust', async (request, reply) => {
    const registry = getSkillRegistry()
    const skill = await registry.setTrusted(request.params.id, false)
    if (!skill) {
      return reply.status(404).send({ error: `Skill not found: ${request.params.id}` })
    }

    return reply.send({ ok: true, skillId: skill.id, trusted: skill.trusted })
  })

  // ─── Remote Skill Market ──────────────────────────────────────────────────

  app.get<{ Querystring: { q?: string } }>('/skills/index', async (request, reply) => {
    try {
      const data = await fetchSkillsIndexWithCache()
      const query = request.query.q?.trim() ?? ''
      if (!query) {
        return reply.send(data)
      }
      const ranked = rankIndexEntries(query, data)
      return reply.send(ranked.map((item) => item.entry))
    } catch (err) {
      return reply.status(502).send({ error: `Failed to fetch skills index: ${err instanceof Error ? err.message : String(err)}` })
    }
  })

  app.get('/skills/remote', async (_request, reply) => {
    return reply.send(listRemoteSkills())
  })

  app.post('/skills/local/preview', { bodyLimit: LOCAL_IMPORT_BODY_LIMIT }, async (request, reply) => {
    let staging: MultipartStagingResult | null = null
    try {
      staging = await buildStagingFromMultipart(request)
      const result = await previewLocalSkillFromStaging(staging.stagingDir)
      return reply.send(result)
    } catch (err) {
      return reply.status(400).send({ error: `Preview failed: ${err instanceof Error ? err.message : String(err)}` })
    } finally {
      if (staging) {
        await rm(staging.cleanupDir, { recursive: true, force: true })
      }
    }
  })

  app.post('/skills/local/import', { bodyLimit: LOCAL_IMPORT_BODY_LIMIT }, async (request, reply) => {
    let staging: MultipartStagingResult | null = null
    try {
      staging = await buildStagingFromMultipart(request)
      const result = await installLocalSkillFromStaging(staging.stagingDir, staging.originalFilename)
      return reply.send(result)
    } catch (err) {
      return reply.status(400).send({ error: `Import failed: ${err instanceof Error ? err.message : String(err)}` })
    } finally {
      if (staging) {
        await rm(staging.cleanupDir, { recursive: true, force: true })
      }
    }
  })

  app.delete<{ Params: { id: string } }>('/skills/local/:id', async (request, reply) => {
    const skillId = request.params.id
    try {
      await uninstallImportedSkill(skillId)
      return reply.status(204).send()
    } catch (err) {
      return reply.status(500).send({ error: `Uninstall imported skill failed: ${err instanceof Error ? err.message : String(err)}` })
    }
  })

  app.post<{ Body: { url?: string } }>('/skills/remote/install', async (request, reply) => {
    const { url } = request.body ?? {}
    if (!url || typeof url !== 'string') {
      return reply.status(400).send({ error: 'Body must include a "url" string' })
    }

    try {
      const result = await installRemoteSkill(url)
      await getSkillRegistry().reload()
      return reply.send(result)
    } catch (err) {
      return reply.status(500).send({ error: `Install failed: ${err instanceof Error ? err.message : String(err)}` })
    }
  })

  app.post<{ Params: { id: string } }>('/skills/remote/:id/update', async (request, reply) => {
    const skillId = request.params.id
    const remoteSkills = listRemoteSkills()
    const existing = remoteSkills.find((s) => s.id === skillId)
    if (!existing) {
      return reply.status(404).send({ error: `Remote skill not found: ${skillId}` })
    }

    try {
      const result = await installRemoteSkill(existing.url)
      await getSkillRegistry().reload()
      return reply.send(result)
    } catch (err) {
      return reply.status(500).send({ error: `Update failed: ${err instanceof Error ? err.message : String(err)}` })
    }
  })

  app.delete<{ Params: { id: string } }>('/skills/remote/:id', async (request, reply) => {
    const skillId = request.params.id
    try {
      await uninstallRemoteSkill(skillId)
      await getSkillRegistry().reload()
      return reply.status(204).send()
    } catch (err) {
      return reply.status(500).send({ error: `Uninstall failed: ${err instanceof Error ? err.message : String(err)}` })
    }
  })

  app.get('/skills/remote/check-updates', async (_request, reply) => {
    const remoteSkills = listRemoteSkills()
    const results = await Promise.all(
      remoteSkills.map(async (skill) => {
        const check = await checkRemoteSkillUpdate(skill.id)
        return { id: skill.id, name: skill.name, ...check }
      }),
    )
    return reply.send(results)
  })
}
