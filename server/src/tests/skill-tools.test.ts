import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getSkillRegistry, initSkillRegistry, shutdownSkillRegistry } from '../skills/registry.js'
import { closeDb, initDb } from '../storage/db.js'
import { executeTool, getToolDefinitions } from '../tools/index.js'

const WORKSPACE_SKILLS_ENV = 'SEA_WORKSPACE_SKILLS_DIR'
const USER_SKILLS_ENV = 'SEA_USER_SKILLS_DIR'
const TEST_SKILL_ID = 'test-exec-skill'
const TEST_TOOL_NAME = 'workspace_echo'

function writeExecutableSkill(rootDir: string, handlerBody = `export function execute(input) { return \`echo:\${String(input.value ?? '')}\` }\n`): void {
  const skillDir = join(rootDir, TEST_SKILL_ID)
  mkdirSync(skillDir, { recursive: true })

  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---
name: ${TEST_SKILL_ID}
description: Test executable skill for dynamic tool registration.
version: "1.0"
metadata:
  mode: tool-contributor
  tools:
    - name: ${TEST_TOOL_NAME}
      description: Echo a value from the executable skill test handler.
      handler: handler.mjs
      inputSchema:
        type: object
        properties:
          value:
            type: string
            description: Value to echo back
        required:
          - value
---

Use this skill only for executable tool registration tests.
`,
    'utf8',
  )

  writeFileSync(join(skillDir, 'handler.mjs'), handlerBody, 'utf8')
}

describe('Executable skill tools', () => {
  let workspaceSkillsDir = ''
  let userSkillsDir = ''

  beforeEach(async () => {
    await shutdownSkillRegistry()
    closeDb()
    initDb(':memory:')

    workspaceSkillsDir = mkdtempSync(join(tmpdir(), 'sea-workspace-skills-'))
    userSkillsDir = mkdtempSync(join(tmpdir(), 'sea-user-skills-'))
    process.env[WORKSPACE_SKILLS_ENV] = workspaceSkillsDir
    process.env[USER_SKILLS_ENV] = userSkillsDir

    writeExecutableSkill(workspaceSkillsDir)
    await initSkillRegistry()
  })

  afterEach(async () => {
    await shutdownSkillRegistry()
    closeDb()
    delete process.env[WORKSPACE_SKILLS_ENV]
    delete process.env[USER_SKILLS_ENV]
    if (workspaceSkillsDir) {
      rmSync(workspaceSkillsDir, { recursive: true, force: true })
    }
    if (userSkillsDir) {
      rmSync(userSkillsDir, { recursive: true, force: true })
    }
  })

  it('requires explicit trust before registering a workspace executable skill tool', async () => {
    const registry = getSkillRegistry()
    const skill = registry.get(TEST_SKILL_ID)

    expect(skill).toBeDefined()
    expect(skill?.source).toBe('workspace')
    expect(skill?.trusted).toBe(false)
    expect(skill?.eligible).toBe(false)
    expect(skill?.disabledReasons).toContain('可执行 skill 尚未受信任')
    expect(getToolDefinitions().map((tool) => tool.name)).not.toContain(TEST_TOOL_NAME)

    const updated = await registry.setTrusted(TEST_SKILL_ID, true)

    expect(updated?.trusted).toBe(true)
    expect(updated?.eligible).toBe(true)
    expect(getToolDefinitions().map((tool) => tool.name)).toContain(TEST_TOOL_NAME)

    const result = await executeTool({
      id: 'skill-tool-call-1',
      name: TEST_TOOL_NAME,
      input: { value: 'sea' },
    })

    expect(result.isError).toBeUndefined()
    expect(result.output).toBe('echo:sea')
  })

  it('reloads an executable skill handler after the file changes', async () => {
    const registry = getSkillRegistry()
    await registry.setTrusted(TEST_SKILL_ID, true)

    const firstResult = await executeTool({
      id: 'skill-tool-call-2',
      name: TEST_TOOL_NAME,
      input: { value: 'v1' },
    })
    expect(firstResult.output).toBe('echo:v1')

    writeExecutableSkill(
      workspaceSkillsDir,
      `export function execute(input) { return \`reloaded:\${String(input.value ?? '')}\` }\n`,
    )
    await registry.reload()

    const reloadedSkill = registry.get(TEST_SKILL_ID)
    expect(reloadedSkill?.eligible).toBe(true)

    const secondResult = await executeTool({
      id: 'skill-tool-call-3',
      name: TEST_TOOL_NAME,
      input: { value: 'v2' },
    })
    expect(secondResult.isError).toBeUndefined()
    expect(secondResult.output).toBe('reloaded:v2')
  })
})
