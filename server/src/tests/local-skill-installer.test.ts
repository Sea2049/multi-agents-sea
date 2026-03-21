import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  installLocalSkillFromStaging,
  listImportedSkills,
  previewLocalSkillFromStaging,
  uninstallImportedSkill,
} from '../skills/local-installer.js'
import { getSkillRegistry, initSkillRegistry, shutdownSkillRegistry } from '../skills/registry.js'
import { closeDb, initDb } from '../storage/db.js'

const WORKSPACE_SKILLS_ENV = 'SEA_WORKSPACE_SKILLS_DIR'
const USER_SKILLS_ENV = 'SEA_USER_SKILLS_DIR'
const REMOTE_SKILLS_ENV = 'SEA_REMOTE_SKILLS_DIR'
const IMPORTED_SKILLS_ENV = 'SEA_IMPORTED_SKILLS_DIR'

function makeTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function writeSkill(
  rootDir: string,
  skillId: string,
  options?: { toolContributor?: boolean; withHandler?: boolean },
): string {
  const skillDir = join(rootDir, skillId)
  mkdirSync(skillDir, { recursive: true })
  const toolContributor = options?.toolContributor ?? false
  const withHandler = options?.withHandler ?? true

  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---
name: ${skillId}
description: Test skill ${skillId}
metadata:
  mode: ${toolContributor ? 'tool-contributor' : 'prompt-only'}
${toolContributor ? `  tools:
    - name: ${skillId}_tool
      description: tool for ${skillId}
      handler: handler.mjs
      inputSchema:
        type: object
        properties:
          value:
            type: string
            description: test value
        required:
          - value` : ''}
---

Instructions for ${skillId}.
`,
    'utf8',
  )

  if (toolContributor && withHandler) {
    writeFileSync(
      join(skillDir, 'handler.mjs'),
      `export function execute(input) { return String(input.value ?? '') }\n`,
      'utf8',
    )
  }

  return skillDir
}

describe('local skill installer', () => {
  let workspaceDir = ''
  let userDir = ''
  let remoteDir = ''
  let importedDir = ''

  beforeEach(async () => {
    workspaceDir = makeTmpDir('sea-workspace-')
    userDir = makeTmpDir('sea-user-')
    remoteDir = makeTmpDir('sea-remote-')
    importedDir = makeTmpDir('sea-imported-')

    process.env[WORKSPACE_SKILLS_ENV] = workspaceDir
    process.env[USER_SKILLS_ENV] = userDir
    process.env[REMOTE_SKILLS_ENV] = remoteDir
    process.env[IMPORTED_SKILLS_ENV] = importedDir

    closeDb()
    initDb(':memory:')
    await initSkillRegistry()
  })

  afterEach(async () => {
    await shutdownSkillRegistry()
    closeDb()
    delete process.env[WORKSPACE_SKILLS_ENV]
    delete process.env[USER_SKILLS_ENV]
    delete process.env[REMOTE_SKILLS_ENV]
    delete process.env[IMPORTED_SKILLS_ENV]
    if (workspaceDir) rmSync(workspaceDir, { recursive: true, force: true })
    if (userDir) rmSync(userDir, { recursive: true, force: true })
    if (remoteDir) rmSync(remoteDir, { recursive: true, force: true })
    if (importedDir) rmSync(importedDir, { recursive: true, force: true })
  })

  it('previews and detects conflict with existing skill id', async () => {
    writeSkill(workspaceDir, 'conflict-skill')
    await getSkillRegistry().reload()

    const stagingRoot = makeTmpDir('sea-staging-')
    writeSkill(stagingRoot, 'conflict-skill')

    const preview = await previewLocalSkillFromStaging(stagingRoot)
    expect(preview.skillId).toBe('conflict-skill')
    expect(preview.conflict.hasConflict).toBe(true)
    expect(preview.conflict.existingSource).toBe('workspace')

    rmSync(stagingRoot, { recursive: true, force: true })
  })

  it('installs tool-contributor skill with trusted=false by default', async () => {
    const stagingRoot = makeTmpDir('sea-staging-')
    const stagingSkillDir = writeSkill(stagingRoot, 'imported-tool-skill', {
      toolContributor: true,
      withHandler: true,
    })

    const result = await installLocalSkillFromStaging(stagingSkillDir, 'imported-tool-skill.zip')
    expect(result.skillId).toBe('imported-tool-skill')

    const imported = listImportedSkills()
    expect(imported).toHaveLength(1)
    expect(imported[0]!.skillId).toBe('imported-tool-skill')
    expect(imported[0]!.originalFilename).toBe('imported-tool-skill.zip')

    const skill = getSkillRegistry().get('imported-tool-skill')
    expect(skill).toBeDefined()
    expect(skill?.source).toBe('imported')
    expect(skill?.trusted).toBe(false)
    expect(skill?.eligible).toBe(false)
    expect(skill?.disabledReasons).toContain('可执行 skill 尚未受信任')

    rmSync(stagingRoot, { recursive: true, force: true })
  })

  it('uninstalls imported skill and removes db record', async () => {
    const stagingRoot = makeTmpDir('sea-staging-')
    const stagingSkillDir = writeSkill(stagingRoot, 'to-remove-skill')

    await installLocalSkillFromStaging(stagingSkillDir, 'to-remove-skill.md')
    expect(listImportedSkills().some((item) => item.skillId === 'to-remove-skill')).toBe(true)

    await uninstallImportedSkill('to-remove-skill')
    expect(listImportedSkills().some((item) => item.skillId === 'to-remove-skill')).toBe(false)
    expect(getSkillRegistry().get('to-remove-skill')).toBeUndefined()

    rmSync(stagingRoot, { recursive: true, force: true })
  })

  it('rejects install when declared handler file is missing', async () => {
    const stagingRoot = makeTmpDir('sea-staging-')
    const stagingSkillDir = writeSkill(stagingRoot, 'broken-tool-skill', {
      toolContributor: true,
      withHandler: false,
    })

    await expect(
      installLocalSkillFromStaging(stagingSkillDir, 'broken-tool-skill.zip'),
    ).rejects.toThrow(/handler/i)

    rmSync(stagingRoot, { recursive: true, force: true })
  })
})
