import { createHash } from 'node:crypto'
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import matter from 'gray-matter'
import { getDb } from '../storage/db.js'
import type { RemoteSkillRecord } from './types.js'

function getRemoteSkillsDir(): string {
  return process.env['SEA_REMOTE_SKILLS_DIR'] ?? join(homedir(), '.sea', 'skills', 'remote')
}

export function getRemoteSkillDir(skillId: string): string {
  return join(getRemoteSkillsDir(), skillId)
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
  const name = typeof parsed.data['name'] === 'string' ? parsed.data['name'].trim() : ''
  if (!name) {
    throw new Error('Remote SKILL.md missing required "name" frontmatter field')
  }

  const toolHandlers: string[] = []
  const tools = parsed.data['metadata']?.['tools']
  if (Array.isArray(tools)) {
    for (const tool of tools) {
      if (tool && typeof tool === 'object' && typeof tool['handler'] === 'string') {
        toolHandlers.push(tool['handler'].trim())
      }
    }
  }

  return { id: name, name, tools: toolHandlers }
}

export async function installRemoteSkill(url: string): Promise<RemoteSkillInstallResult> {
  const normalizedUrl = url.replace(/\/$/, '')

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
      const handlerPath = join(installDir, handler)
      const handlerDir = join(handlerPath, '..')
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
