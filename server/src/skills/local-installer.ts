import { createHash } from 'node:crypto'
import { cp, mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { getDb } from '../storage/db.js'
import { getSkillRegistry } from './registry.js'
import { getImportedSkillsDir, loadAllSkills, loadSkillFile } from './loader.js'
import type { SkillDefinition, SkillState } from './types.js'

interface ImportedSkillRow {
  id: string
  skill_id: string
  original_filename: string | null
  sha256: string
  imported_at: number
  updated_at: number
}

export interface ImportedSkillRecord {
  id: string
  skillId: string
  originalFilename: string | null
  sha256: string
  importedAt: number
  updatedAt: number
}

export interface LocalSkillPreview {
  skillId: string
  name: string
  description: string
  version?: string
  mode: 'prompt-only' | 'tool-contributor'
  files: string[]
  handlers: string[]
  conflict: {
    hasConflict: boolean
    existingSource?: SkillState['source']
    existingFilePath?: string
    willOverride: boolean
  }
  warnings: string[]
}

export interface LocalSkillInstallResult {
  skillId: string
  name: string
  importedAt: number
}

function normalizeRelativePath(pathValue: string): string {
  return pathValue.split(sep).join('/')
}

function assertInsideRoot(rootDir: string, targetPath: string): void {
  const normalizedRoot = resolve(rootDir)
  const normalizedTarget = resolve(targetPath)
  if (!normalizedTarget.startsWith(normalizedRoot)) {
    throw new Error(`Path escapes root directory: ${targetPath}`)
  }
}

async function collectFilesRecursive(rootDir: string): Promise<string[]> {
  const output: string[] = []

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = join(currentDir, entry.name)
      if (entry.isDirectory()) {
        await walk(entryPath)
        continue
      }
      if (entry.isFile()) {
        const relativePath = normalizeRelativePath(relative(rootDir, entryPath))
        output.push(relativePath)
      }
    }
  }

  await walk(rootDir)
  output.sort((a, b) => a.localeCompare(b))
  return output
}

async function findSkillMarkdownPaths(rootDir: string): Promise<string[]> {
  const files = await collectFilesRecursive(rootDir)
  return files
    .filter((filePath) => filePath.endsWith('/SKILL.md') || filePath === 'SKILL.md')
    .map((filePath) => join(rootDir, filePath))
}

async function resolveSkillDefinitionFromStaging(stagingDir: string): Promise<{
  skill: SkillDefinition
  skillRootDir: string
  allFiles: string[]
}> {
  const skillMdPaths = await findSkillMarkdownPaths(stagingDir)
  if (skillMdPaths.length === 0) {
    throw new Error('未发现 SKILL.md')
  }
  if (skillMdPaths.length > 1) {
    throw new Error('检测到多个 SKILL.md，请只导入单个 skill 包')
  }

  const skillMdPath = skillMdPaths[0]!
  const skill = await loadSkillFile(skillMdPath, 'imported')
  if (!skill) {
    throw new Error('SKILL.md 缺少必填字段 name 或 description')
  }

  const skillRootDir = skill.dirPath
  assertInsideRoot(stagingDir, skillRootDir)
  const allFiles = await collectFilesRecursive(skillRootDir)

  return { skill, skillRootDir, allFiles }
}

async function validateToolHandlers(skill: SkillDefinition, skillRootDir: string): Promise<string[]> {
  const handlers = (skill.metadata.tools ?? []).map((tool) => tool.handler)
  for (const handler of handlers) {
    const handlerPath = join(skillRootDir, handler)
    assertInsideRoot(skillRootDir, handlerPath)
    try {
      const handlerStats = await stat(handlerPath)
      if (!handlerStats.isFile()) {
        throw new Error(`handler 不是文件: ${handler}`)
      }
    } catch {
      throw new Error(`缺少 handler 文件: ${handler}`)
    }
  }
  return handlers
}

async function computeDirectoryHash(rootDir: string, files: string[]): Promise<string> {
  const hash = createHash('sha256')
  for (const relativePath of files) {
    const absolutePath = join(rootDir, relativePath)
    const content = await readFile(absolutePath)
    hash.update(relativePath)
    hash.update(content)
  }
  return hash.digest('hex')
}

async function detectConflict(skillId: string): Promise<LocalSkillPreview['conflict']> {
  const registry = getSkillRegistry()
  const existing = registry.get(skillId)
  if (!existing) {
    return {
      hasConflict: false,
      willOverride: false,
    }
  }

  return {
    hasConflict: true,
    existingSource: existing.source,
    existingFilePath: existing.filePath,
    willOverride: existing.source !== 'workspace',
  }
}

export async function previewLocalSkillFromStaging(stagingDir: string): Promise<LocalSkillPreview> {
  const { skill, skillRootDir, allFiles } = await resolveSkillDefinitionFromStaging(stagingDir)
  const handlers = await validateToolHandlers(skill, skillRootDir)
  const conflict = await detectConflict(skill.id)
  const warnings: string[] = []

  if ((skill.metadata.mode ?? 'prompt-only') === 'tool-contributor') {
    warnings.push('该技能为可执行技能，导入后默认不受信任，需要手动信任才可生效')
  }

  if (conflict.hasConflict) {
    warnings.push(`存在同名 skill: ${skill.id}（来源: ${conflict.existingSource ?? 'unknown'}）`)
  }

  return {
    skillId: skill.id,
    name: skill.name,
    description: skill.description,
    version: skill.version,
    mode: skill.metadata.mode ?? 'prompt-only',
    files: allFiles,
    handlers,
    conflict,
    warnings,
  }
}

export async function installLocalSkillFromStaging(
  stagingDir: string,
  originalFilename: string | null,
): Promise<LocalSkillInstallResult> {
  const { skill, skillRootDir, allFiles } = await resolveSkillDefinitionFromStaging(stagingDir)
  await validateToolHandlers(skill, skillRootDir)

  const importedRoot = getImportedSkillsDir()
  const targetDir = join(importedRoot, skill.id)
  const hash = await computeDirectoryHash(skillRootDir, allFiles)
  const now = Date.now()

  await mkdir(importedRoot, { recursive: true })
  await rm(targetDir, { recursive: true, force: true })
  await cp(skillRootDir, targetDir, { recursive: true })

  const db = getDb()
  db.prepare(`
    INSERT INTO imported_skills (id, skill_id, original_filename, sha256, imported_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      skill_id = excluded.skill_id,
      original_filename = excluded.original_filename,
      sha256 = excluded.sha256,
      updated_at = excluded.updated_at
  `).run(skill.id, skill.id, originalFilename, hash, now, now)

  await getSkillRegistry().reload()

  return {
    skillId: skill.id,
    name: skill.name,
    importedAt: now,
  }
}

export async function uninstallImportedSkill(skillId: string): Promise<void> {
  const importedRoot = getImportedSkillsDir()
  const targetDir = join(importedRoot, skillId)
  await rm(targetDir, { recursive: true, force: true })
  const db = getDb()
  db.prepare(`DELETE FROM imported_skills WHERE id = ?`).run(skillId)
  await getSkillRegistry().reload()
}

export function listImportedSkills(): ImportedSkillRecord[] {
  const db = getDb()
  const rows = db.prepare<[], ImportedSkillRow>(`
    SELECT id, skill_id, original_filename, sha256, imported_at, updated_at
    FROM imported_skills
    ORDER BY updated_at DESC
  `).all()
  return rows.map((row) => ({
    id: row.id,
    skillId: row.skill_id,
    originalFilename: row.original_filename,
    sha256: row.sha256,
    importedAt: row.imported_at,
    updatedAt: row.updated_at,
  }))
}
