import { spawnSync } from 'node:child_process'
import { getDb } from '../storage/db.js'
import { syncSkillToolsFromStates } from '../tools/index.js'
import { loadAllSkills } from './loader.js'
import { buildSkillPromptBlock } from './prompt-injector.js'
import type { SkillDefinition, SkillSettings, SkillState } from './types.js'
import { createSkillWatcher, type SkillWatcherHandle } from './watcher.js'

interface SkillSettingRow {
  skill_id: string
  enabled: number | null
  trusted: number | null
  updated_at: number
}

function checkBinaryExists(binaryName: string): boolean {
  const command = process.platform === 'win32' ? 'where' : 'which'
  const result = spawnSync(command, [binaryName], {
    stdio: 'ignore',
  })
  return result.status === 0
}

function getDefaultSkillSettings(skill: SkillDefinition): Required<SkillSettings> {
  return {
    enabled: true,
    trusted: skill.source === 'bundled',
  }
}

function readSkillSettings(): Map<string, SkillSettings> {
  const db = getDb()
  const rows = db.prepare<[], SkillSettingRow>(`SELECT * FROM skill_settings`).all()
  const settings = new Map<string, SkillSettings>()

  for (const row of rows) {
    settings.set(row.skill_id, {
      enabled: row.enabled === 1,
      trusted: row.trusted === 1,
    })
  }

  return settings
}

function evaluateSkill(skill: SkillDefinition, settings: Required<SkillSettings>): SkillState {
  const disabledReasons: string[] = []
  const mode = skill.metadata.mode ?? 'prompt-only'
  const currentPlatform = process.platform === 'win32' || process.platform === 'linux' || process.platform === 'darwin'
    ? process.platform
    : null

  if (Array.isArray(skill.metadata.os) && skill.metadata.os.length > 0 && (!currentPlatform || !skill.metadata.os.includes(currentPlatform))) {
    disabledReasons.push(`仅支持平台: ${skill.metadata.os.join(', ')}`)
  }

  for (const envName of skill.metadata.requires?.env ?? []) {
    if (!process.env[envName]?.trim()) {
      disabledReasons.push(`缺少环境变量: ${envName}`)
    }
  }

  for (const binaryName of skill.metadata.requires?.bins ?? []) {
    if (!checkBinaryExists(binaryName)) {
      disabledReasons.push(`缺少可执行文件: ${binaryName}`)
    }
  }

  for (const configName of skill.metadata.requires?.config ?? []) {
    disabledReasons.push(`暂不支持自动配置检查: ${configName}`)
  }

  if (mode === 'tool-contributor') {
    if (!skill.metadata.tools || skill.metadata.tools.length === 0) {
      disabledReasons.push('tool-contributor skill 未声明 metadata.tools')
    }

    for (const tool of skill.metadata.tools ?? []) {
      if (!tool.handler.endsWith('.js') && !tool.handler.endsWith('.mjs')) {
        disabledReasons.push(`暂仅支持 .js/.mjs handler: ${tool.handler}`)
      }
    }

    if (!settings.trusted) {
      disabledReasons.push('可执行 skill 尚未受信任')
    }
  }

  return {
    ...skill,
    enabled: settings.enabled,
    trusted: settings.trusted,
    eligible: settings.enabled && disabledReasons.length === 0,
    disabledReasons,
  }
}

export class SkillRegistry {
  private watcher: SkillWatcherHandle | null = null
  private skills = new Map<string, SkillState>()
  private version = 0

  async init(): Promise<void> {
    await this.reload()
    if (!this.watcher) {
      this.watcher = createSkillWatcher(async () => {
        await this.reload()
      })
    }
  }

  async shutdown(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
  }

  async reload(): Promise<void> {
    const discoveredSkills = await loadAllSkills()
    const storedSettings = readSkillSettings()
    const nextSkills = new Map<string, SkillState>()

    for (const skill of discoveredSkills) {
      const settings = {
        ...getDefaultSkillSettings(skill),
        ...storedSettings.get(skill.id),
      }
      nextSkills.set(skill.id, evaluateSkill(skill, settings))
    }

    this.skills = nextSkills
    this.version += 1
    await syncSkillToolsFromStates(this.list())
  }

  list(): SkillState[] {
    return [...this.skills.values()].sort((left, right) => left.name.localeCompare(right.name))
  }

  get(id: string): SkillState | undefined {
    return this.skills.get(id)
  }

  getVersion(): number {
    return this.version
  }

  getPromptEligibleSkills(): SkillState[] {
    return this.list().filter(
      (skill) => skill.enabled && skill.eligible && (skill.metadata.mode ?? 'prompt-only') === 'prompt-only',
    )
  }

  getSnapshotSkills() {
    return this.getPromptEligibleSkills().map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      source: skill.source,
      mode: skill.metadata.mode ?? 'prompt-only',
      promptBlock: buildSkillPromptBlock(skill),
    }))
  }

  async setEnabled(skillId: string, enabled: boolean): Promise<SkillState | undefined> {
    const db = getDb()
    const now = Date.now()
    db.prepare(`
      INSERT INTO skill_settings (skill_id, enabled, trusted, updated_at)
      VALUES (?, ?, COALESCE((SELECT trusted FROM skill_settings WHERE skill_id = ?), NULL), ?)
      ON CONFLICT(skill_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at
    `).run(skillId, enabled ? 1 : 0, skillId, now)

    await this.reload()
    return this.get(skillId)
  }

  async setTrusted(skillId: string, trusted: boolean): Promise<SkillState | undefined> {
    const db = getDb()
    const now = Date.now()
    db.prepare(`
      INSERT INTO skill_settings (skill_id, enabled, trusted, updated_at)
      VALUES (?, COALESCE((SELECT enabled FROM skill_settings WHERE skill_id = ?), 1), ?, ?)
      ON CONFLICT(skill_id) DO UPDATE SET trusted = excluded.trusted, updated_at = excluded.updated_at
    `).run(skillId, skillId, trusted ? 1 : 0, now)

    await this.reload()
    return this.get(skillId)
  }
}

let skillRegistrySingleton: SkillRegistry | null = null

export async function initSkillRegistry(): Promise<SkillRegistry> {
  if (!skillRegistrySingleton) {
    skillRegistrySingleton = new SkillRegistry()
  }

  await skillRegistrySingleton.init()
  return skillRegistrySingleton
}

export function getSkillRegistry(): SkillRegistry {
  if (!skillRegistrySingleton) {
    throw new Error('Skill registry has not been initialized')
  }

  return skillRegistrySingleton
}

export async function shutdownSkillRegistry(): Promise<void> {
  if (skillRegistrySingleton) {
    await skillRegistrySingleton.shutdown()
  }
}
