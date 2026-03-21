import { createHash } from 'node:crypto'
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { isIP } from 'node:net'
import matter from 'gray-matter'
import { getDb } from '../storage/db.js'
import type { RemoteSkillRecord } from './types.js'

function getRemoteSkillsDir(): string {
  return process.env['SEA_REMOTE_SKILLS_DIR'] ?? join(homedir(), '.sea', 'skills', 'remote')
}

const SAFE_SKILL_ID_PATTERN = /^[A-Za-z0-9._-]+$/
const SAFE_HANDLER_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/

function isPrivateIpAddress(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  if (!normalized) return true
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true

  const ipVersion = isIP(normalized)
  if (ipVersion === 4) {
    const parts = normalized.split('.').map((part) => Number.parseInt(part, 10))
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return true
    const [a, b] = parts
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    return false
  }

  if (ipVersion === 6) {
    if (normalized === '::1') return true
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true
    if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
      return true
    }
    return false
  }

  return false
}

function normalizeRemoteBaseUrl(input: string): string {
  let parsed: URL
  try {
    parsed = new URL(input.trim())
  } catch {
    throw new Error('Invalid remote skill URL')
  }

  const protocol = parsed.protocol.toLowerCase()
  if (protocol !== 'https:' && protocol !== 'http:') {
    throw new Error('Remote skill URL must use http or https')
  }

  if (isPrivateIpAddress(parsed.hostname)) {
    throw new Error('Remote skill URL cannot target localhost or private network addresses')
  }

  if (parsed.username || parsed.password) {
    throw new Error('Remote skill URL must not include credentials')
  }

  parsed.hash = ''
  return parsed.href.replace(/\/$/, '')
}

function normalizeSkillId(rawSkillId: string): string {
  const skillId = rawSkillId.trim()
  if (!skillId) {
    throw new Error('Remote SKILL.md missing required "name" frontmatter field')
  }
  if (!SAFE_SKILL_ID_PATTERN.test(skillId)) {
    throw new Error(`Invalid remote skill id "${skillId}"`)
  }
  return skillId
}

function normalizeToolHandler(rawHandler: string): string {
  const normalized = rawHandler.trim().replaceAll('\\', '/')
  if (!normalized) {
    throw new Error('Remote tool handler path cannot be empty')
  }
  if (normalized.startsWith('/') || normalized.includes('//')) {
    throw new Error(`Invalid remote tool handler path "${rawHandler}"`)
  }
  const segments = normalized.split('/')
  if (
    segments.some((segment) =>
      segment.length === 0 || segment === '.' || segment === '..' || !SAFE_HANDLER_SEGMENT_PATTERN.test(segment),
    )
  ) {
    throw new Error(`Invalid remote tool handler path "${rawHandler}"`)
  }
  return segments.join('/')
}

function resolveInside(baseDir: string, relativePath: string): string {
  const normalizedBase = resolve(baseDir)
  const resolvedPath = resolve(normalizedBase, relativePath)
  if (resolvedPath !== normalizedBase && !resolvedPath.startsWith(`${normalizedBase}${sep}`)) {
    throw new Error('Resolved path escapes remote skill directory')
  }
  return resolvedPath
}

export function getRemoteSkillDir(skillId: string): string {
  const normalizedSkillId = normalizeSkillId(skillId)
  return resolveInside(getRemoteSkillsDir(), normalizedSkillId)
}

export interface RemoteSkillInstallResult {
  skillId: string
  name: string
  installedAt: number
}

interface RemoteSkillRow {
  id: string
  url: string
  sha256: string
  name: string
  installed_at: number
  updated_at: number
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} fetching ${url}`)
    }
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

function computeHash(parts: string[]): string {
  const hash = createHash('sha256')
  for (const part of parts) {
    hash.update(part)
  }
  return hash.digest('hex')
}

function parseSkillId(content: string): { id: string; name: string; tools: string[] } {
  const parsed = matter(content)
  const name = typeof parsed.data['name'] === 'string' ? normalizeSkillId(parsed.data['name']) : ''

  const toolHandlers: string[] = []
  const tools = parsed.data['metadata']?.['tools']
  if (Array.isArray(tools)) {
    for (const tool of tools) {
      if (tool && typeof tool === 'object' && typeof tool['handler'] === 'string') {
        toolHandlers.push(normalizeToolHandler(tool['handler']))
      }
    }
  }

  return { id: name, name, tools: toolHandlers }
}

export async function installRemoteSkill(url: string): Promise<RemoteSkillInstallResult> {
  const normalizedUrl = normalizeRemoteBaseUrl(url)

  const skillMdContent = await fetchText(`${normalizedUrl}/SKILL.md`)
  const { id: skillId, name, tools: toolHandlers } = parseSkillId(skillMdContent)

  const installDir = getRemoteSkillDir(skillId)
  await mkdir(installDir, { recursive: true })

  const contentParts: string[] = [skillMdContent]
  await writeFile(join(installDir, 'SKILL.md'), skillMdContent, 'utf8')

  for (const handler of toolHandlers) {
    try {
      const handlerContent = await fetchText(`${normalizedUrl}/${handler}`)
      contentParts.push(handlerContent)
      const handlerPath = resolveInside(installDir, handler)
      const handlerDir = dirname(handlerPath)
      await mkdir(handlerDir, { recursive: true })
      await writeFile(handlerPath, handlerContent, 'utf8')
    } catch (err) {
      console.warn(`[remote-installer] failed to fetch handler "${handler}": ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const sha256 = computeHash(contentParts)
  const now = Date.now()

  const db = getDb()
  db.prepare(`
    INSERT INTO remote_skills (id, url, sha256, name, installed_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      url = excluded.url,
      sha256 = excluded.sha256,
      name = excluded.name,
      updated_at = excluded.updated_at
  `).run(skillId, normalizedUrl, sha256, name, now, now)

  return { skillId, name, installedAt: now }
}

export async function checkRemoteSkillUpdate(skillId: string): Promise<{ hasUpdate: boolean; remoteHash?: string }> {
  const db = getDb()
  const row = db.prepare<[string], RemoteSkillRow>(
    `SELECT * FROM remote_skills WHERE id = ?`
  ).get(skillId)

  if (!row) {
    return { hasUpdate: false }
  }

  try {
    const skillMdContent = await fetchText(`${row.url}/SKILL.md`)
    const contentParts: string[] = [skillMdContent]

    // Also fetch handlers to compute the same composite hash as at install time
    const { tools: toolHandlers } = parseSkillId(skillMdContent)
    for (const handler of toolHandlers) {
      try {
        const handlerContent = await fetchText(`${row.url}/${handler}`)
        contentParts.push(handlerContent)
      } catch {
        // handler fetch failed - skip it (same as install)
      }
    }

    const remoteHash = computeHash(contentParts)
    const storedHash = row.sha256

    return { hasUpdate: storedHash !== remoteHash, remoteHash }
  } catch {
    return { hasUpdate: false }
  }
}

export async function uninstallRemoteSkill(skillId: string): Promise<void> {
  const installDir = getRemoteSkillDir(skillId)
  try {
    await rm(installDir, { recursive: true, force: true })
  } catch (err) {
    console.warn(`[remote-installer] failed to remove dir "${installDir}": ${err instanceof Error ? err.message : String(err)}`)
  }

  const db = getDb()
  db.prepare(`DELETE FROM remote_skills WHERE id = ?`).run(skillId)
}

export function listRemoteSkills(): RemoteSkillRecord[] {
  const db = getDb()
  const rows = db.prepare<[], RemoteSkillRow>(`SELECT * FROM remote_skills ORDER BY name ASC`).all()
  return rows.map((row) => ({
    id: row.id,
    url: row.url,
    sha256: row.sha256,
    name: row.name,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
  }))
}
