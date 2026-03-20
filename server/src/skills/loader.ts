import { access, readdir, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import matter from 'gray-matter'
import type { SkillDefinition, SkillMetadata, SkillMode, SkillSource, SkillToolDeclaration } from './types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const BUNDLED_SKILLS_DIR = join(__dirname, 'bundled')

function getUserSkillsDir(): string {
  return process.env['SEA_USER_SKILLS_DIR']?.trim() || join(homedir(), '.sea', 'skills')
}

function getWorkspaceSkillsDir(): string {
  return process.env['SEA_WORKSPACE_SKILLS_DIR']?.trim() || join(process.cwd(), 'skills')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function collectSkillFiles(rootDir: string): Promise<string[]> {
  if (!(await pathExists(rootDir))) {
    return []
  }

  const entries = await readdir(rootDir, { withFileTypes: true })
  const results: string[] = []

  for (const entry of entries) {
    const fullPath = join(rootDir, entry.name)
    if (entry.isDirectory()) {
      results.push(...await collectSkillFiles(fullPath))
      continue
    }

    if (entry.isFile() && entry.name === 'SKILL.md') {
      results.push(fullPath)
    }
  }

  return results
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  return items.length > 0 ? items : undefined
}

function toInputSchema(value: unknown): SkillToolDeclaration['inputSchema'] | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const maybeSchema = value as {
    type?: unknown
    properties?: unknown
    required?: unknown
  }
  if (maybeSchema.type !== 'object' || !maybeSchema.properties || typeof maybeSchema.properties !== 'object') {
    return undefined
  }

  const properties = Object.fromEntries(
    Object.entries(maybeSchema.properties).flatMap(([key, raw]) => {
      if (!raw || typeof raw !== 'object') {
        return []
      }
      const typed = raw as { type?: unknown; description?: unknown }
      if (typeof typed.type !== 'string' || typeof typed.description !== 'string') {
        return []
      }

      return [[key, { type: typed.type, description: typed.description }]]
    }),
  )

  return {
    type: 'object',
    properties,
    required: toStringArray(maybeSchema.required),
  }
}

function toToolDeclarations(value: unknown): SkillToolDeclaration[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const tools = value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return []
    }

    const typed = entry as {
      name?: unknown
      description?: unknown
      handler?: unknown
      inputSchema?: unknown
    }

    if (
      typeof typed.name !== 'string' ||
      typeof typed.description !== 'string' ||
      typeof typed.handler !== 'string'
    ) {
      return []
    }

    const inputSchema = toInputSchema(typed.inputSchema)
    if (!inputSchema) {
      return []
    }

    return [{
      name: typed.name.trim(),
      description: typed.description.trim(),
      handler: typed.handler.trim(),
      inputSchema,
    }]
  })

  return tools.length > 0 ? tools : undefined
}

function toMetadata(value: unknown): SkillMetadata {
  if (!value || typeof value !== 'object') {
    return {}
  }

  const typed = value as {
    mode?: unknown
    requires?: unknown
    os?: unknown
    homepage?: unknown
    tools?: unknown
  }

  const requires = typed.requires && typeof typed.requires === 'object'
    ? {
        bins: toStringArray((typed.requires as { bins?: unknown }).bins),
        env: toStringArray((typed.requires as { env?: unknown }).env),
        config: toStringArray((typed.requires as { config?: unknown }).config),
      }
    : undefined

  const os = toStringArray(typed.os)?.filter(
    (item): item is 'win32' | 'linux' | 'darwin' => item === 'win32' || item === 'linux' || item === 'darwin',
  )
  const mode = typed.mode === 'tool-contributor' ? 'tool-contributor' : 'prompt-only'

  return {
    mode: mode as SkillMode,
    requires,
    os,
    homepage: typeof typed.homepage === 'string' ? typed.homepage.trim() : undefined,
    tools: toToolDeclarations(typed.tools),
  }
}

async function loadSkillFile(filePath: string, source: SkillSource): Promise<SkillDefinition | null> {
  const content = await readFile(filePath, 'utf8')
  const parsed = matter(content)
  const name = typeof parsed.data['name'] === 'string' ? parsed.data['name'].trim() : ''
  const description = typeof parsed.data['description'] === 'string' ? parsed.data['description'].trim() : ''
  if (!name || !description) {
    return null
  }

  return {
    id: name,
    name,
    description,
    version: typeof parsed.data['version'] === 'string' ? parsed.data['version'].trim() : undefined,
    metadata: toMetadata(parsed.data['metadata']),
    instructions: parsed.content.trim(),
    source,
    dirPath: dirname(filePath),
    filePath,
  }
}

async function loadSkillsForSource(rootDir: string, source: SkillSource): Promise<SkillDefinition[]> {
  const skillFiles = await collectSkillFiles(rootDir)
  const results: SkillDefinition[] = []

  for (const filePath of skillFiles) {
    const skill = await loadSkillFile(filePath, source)
    if (skill) {
      results.push(skill)
    }
  }

  return results
}

function sortSkillsByPrecedence(skills: SkillDefinition[]): SkillDefinition[] {
  const precedence: Record<SkillSource, number> = {
    workspace: 3,
    user: 2,
    bundled: 1,
  }

  return [...skills].sort((left, right) => precedence[right.source] - precedence[left.source])
}

export async function loadAllSkills(): Promise<SkillDefinition[]> {
  const [workspaceSkills, userSkills, bundledSkills] = await Promise.all([
    loadSkillsForSource(getWorkspaceSkillsDir(), 'workspace'),
    loadSkillsForSource(getUserSkillsDir(), 'user'),
    loadSkillsForSource(BUNDLED_SKILLS_DIR, 'bundled'),
  ])

  const deduped = new Map<string, SkillDefinition>()
  for (const skill of sortSkillsByPrecedence([...workspaceSkills, ...userSkills, ...bundledSkills])) {
    if (!deduped.has(skill.id)) {
      deduped.set(skill.id, skill)
    }
  }

  return [...deduped.values()].sort((left, right) => left.name.localeCompare(right.name))
}

export function getSkillDiscoveryRoots(): string[] {
  return [getWorkspaceSkillsDir(), getUserSkillsDir(), BUNDLED_SKILLS_DIR]
}
