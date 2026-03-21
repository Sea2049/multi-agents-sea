import { createWriteStream } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pipeline } from 'node:stream/promises'
import matter from 'gray-matter'
import yauzl from 'yauzl'
import { installLocalSkillFromStaging, previewLocalSkillFromStaging } from '../local-installer.js'
import { getSkillRegistry } from '../registry.js'
import { clawhubProvider } from './providers/clawhub.js'
import { skillhubProvider } from './providers/skillhub.js'
import type {
  MarketCompatibility,
  MarketInstallability,
  SkillMarketEntry,
  SkillMarketInstallResult,
  SkillMarketPreview,
  SkillMarketProvider,
  SkillMarketProviderAdapter,
} from './types.js'

const ZIP_MAX_FILE_SIZE = 10 * 1024 * 1024
const ZIP_MAX_TOTAL_SIZE = 50 * 1024 * 1024

function normalizeZipEntryName(entryName: string): string {
  return entryName.replaceAll('\\', '/')
}

function assertSafeZipEntryName(entryName: string): void {
  const normalized = normalizeZipEntryName(entryName)
  if (
    normalized.startsWith('/')
    || normalized.includes('../')
    || normalized.includes('..\\')
    || /^[A-Za-z]:/.test(normalized)
  ) {
    throw new Error(`ZIP 条目路径非法: ${entryName}`)
  }
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

      if (entry.uncompressedSize > ZIP_MAX_FILE_SIZE) {
        throw new Error(`ZIP 条目过大: ${entry.fileName}`)
      }
      totalSize += entry.uncompressedSize
      if (totalSize > ZIP_MAX_TOTAL_SIZE) {
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

async function withDownloadedBundle<T>(
  provider: SkillMarketProviderAdapter,
  providerSkillId: string,
  callback: (stagingDir: string, cleanupDir: string) => Promise<T>,
): Promise<T> {
  const bundle = await provider.fetchBundle({ providerSkillId })
  const cleanupDir = await mkdtemp(join(tmpdir(), `sea-market-${provider.provider}-`))
  const bundleZipPath = join(cleanupDir, 'bundle.zip')
  const extractedDir = join(cleanupDir, 'extracted')
  await mkdir(extractedDir, { recursive: true })

  try {
    await writeFile(bundleZipPath, bundle)
    await extractZipToDir(bundleZipPath, extractedDir)
    return await callback(extractedDir, cleanupDir)
  } finally {
    await rm(cleanupDir, { recursive: true, force: true })
  }
}

async function findSkillMdPath(rootDir: string): Promise<string | null> {
  const stack = [rootDir]
  let found: string | null = null
  while (stack.length > 0) {
    const current = stack.pop()!
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }
      if (entry.isFile() && entry.name === 'SKILL.md') {
        if (found) {
          return null
        }
        found = fullPath
      }
    }
  }
  return found
}

function getEnabledProviders(): SkillMarketProvider[] {
  const fromEnv = process.env['SEA_MARKET_PROVIDERS']?.trim()
  if (!fromEnv) {
    return ['clawhub']
  }
  const providers = fromEnv
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is SkillMarketProvider => item === 'clawhub' || item === 'skillhub')
  if (providers.length === 0) {
    return ['clawhub']
  }
  return providers
}

function buildProviderMap(): Map<SkillMarketProvider, SkillMarketProviderAdapter> {
  const map = new Map<SkillMarketProvider, SkillMarketProviderAdapter>()
  map.set('clawhub', clawhubProvider)
  map.set('skillhub', skillhubProvider)
  return map
}

function resolveProvider(provider: SkillMarketProvider): SkillMarketProviderAdapter {
  const map = buildProviderMap()
  const target = map.get(provider)
  if (!target) {
    throw new Error(`Market provider is not configured: ${provider}`)
  }
  return target
}

function parseUnsupportedMetadataFields(frontmatter: Record<string, unknown>): string[] {
  const metadata = frontmatter['metadata']
  if (!metadata || typeof metadata !== 'object') {
    return []
  }
  const typedMetadata = metadata as Record<string, unknown>
  const runtimeMetadata =
    typedMetadata['openclaw']
    ?? typedMetadata['clawdbot']
    ?? typedMetadata['clawdis']

  if (!runtimeMetadata || typeof runtimeMetadata !== 'object') {
    return []
  }
  const typedRuntime = runtimeMetadata as Record<string, unknown>
  const unsupportedFields: string[] = []
  for (const key of ['install', 'config', 'always', 'nix', 'systems']) {
    if (typedRuntime[key] !== undefined) {
      unsupportedFields.push(key)
    }
  }
  return unsupportedFields
}

function deriveMarketStatus(params: {
  mode: 'prompt-only' | 'tool-contributor'
  fileCount: number
  hasAuxiliaryFiles: boolean
  unsupportedMetadata: string[]
}): {
  compatibility: MarketCompatibility
  installability: MarketInstallability
  reasons: string[]
  warnings: string[]
} {
  const reasons: string[] = []
  const warnings: string[] = []
  let compatibility: MarketCompatibility = 'compatible'
  let installability: MarketInstallability = 'installable'

  if (params.mode === 'tool-contributor') {
    compatibility = 'incompatible'
    installability = 'blocked'
    reasons.push('当前版本不开放第三方可执行 skill 安装，仅支持预检与详情查看')
  }

  if (params.unsupportedMetadata.length > 0) {
    compatibility = 'incompatible'
    installability = 'blocked'
    reasons.push(`包含暂不支持的 metadata 字段: ${params.unsupportedMetadata.join(', ')}`)
  }

  if (params.hasAuxiliaryFiles) {
    warnings.push('该技能包含多个 supporting files，当前版本仅完整消费 SKILL.md')
    if (compatibility === 'compatible') {
      compatibility = 'needs_review'
    }
  }

  if (params.fileCount > 20) {
    warnings.push('文件数量较多，建议人工审阅后再安装')
    if (compatibility === 'compatible') {
      compatibility = 'needs_review'
    }
    if (installability === 'installable') {
      installability = 'preview_only'
    }
  }

  return { compatibility, installability, reasons, warnings }
}

export async function searchSkillMarket(params: {
  query?: string
}): Promise<SkillMarketEntry[]> {
  const enabledProviders = getEnabledProviders()
  const map = buildProviderMap()
  const tasks = enabledProviders
    .map((providerId) => map.get(providerId))
    .filter((provider): provider is SkillMarketProviderAdapter => Boolean(provider))

  if (tasks.length === 0) {
    return []
  }

  const results = await Promise.all(tasks.map(async (provider) => {
    try {
      return await provider.search({ query: params.query })
    } catch {
      return [] as SkillMarketEntry[]
    }
  }))

  return results.flat()
}

export async function previewSkillFromMarket(params: {
  provider: SkillMarketProvider
  providerSkillId: string
}): Promise<SkillMarketPreview> {
  const provider = resolveProvider(params.provider)

  return withDownloadedBundle(provider, params.providerSkillId, async (stagingDir) => {
    const localPreview = await previewLocalSkillFromStaging(stagingDir)
    const skillMdPath = await findSkillMdPath(stagingDir)
    if (!skillMdPath) {
      throw new Error('未在技能包中检测到唯一 SKILL.md')
    }
    const skillMdContent = await readFile(skillMdPath, 'utf8')
    const parsed = matter(skillMdContent)
    const unsupportedMetadata = parseUnsupportedMetadataFields(
      parsed.data as Record<string, unknown>,
    )

    const hasAuxiliaryFiles = localPreview.files.some((filePath) => filePath !== 'SKILL.md')
    const marketStatus = deriveMarketStatus({
      mode: localPreview.mode,
      fileCount: localPreview.files.length,
      hasAuxiliaryFiles,
      unsupportedMetadata,
    })

    return {
      provider: params.provider,
      providerSkillId: params.providerSkillId,
      compatibility: marketStatus.compatibility,
      installability: marketStatus.installability,
      reasons: marketStatus.reasons,
      warnings: [...localPreview.warnings, ...marketStatus.warnings],
      localPreview: {
        skillId: localPreview.skillId,
        name: localPreview.name,
        description: localPreview.description,
        version: localPreview.version,
        mode: localPreview.mode,
        files: localPreview.files,
        handlers: localPreview.handlers,
        conflict: localPreview.conflict,
      },
    }
  })
}

export async function installSkillFromMarket(params: {
  provider: SkillMarketProvider
  providerSkillId: string
}): Promise<SkillMarketInstallResult> {
  const preview = await previewSkillFromMarket(params)
  if (preview.installability !== 'installable') {
    throw new Error(
      `Skill is not installable: ${preview.reasons.join('；') || preview.installability}`,
    )
  }

  const provider = resolveProvider(params.provider)
  return withDownloadedBundle(provider, params.providerSkillId, async (stagingDir) => {
    const result = await installLocalSkillFromStaging(
      stagingDir,
      `${params.provider}:${params.providerSkillId}.zip`,
    )

    // 安装第三方市场技能后默认禁用，避免“装完即生效”。
    await getSkillRegistry().setEnabled(result.skillId, false)

    return {
      provider: params.provider,
      providerSkillId: params.providerSkillId,
      skillId: result.skillId,
      name: result.name,
      importedAt: result.importedAt,
      enabled: false,
    }
  })
}
