import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ToolDefinition, ToolCallRequest, ToolCallResult } from '../providers/types.js'
import type { RegistrySnapshot } from '../runtime/registry-snapshot.js'
import type { SkillState } from '../skills/types.js'
import { getToolRegistry } from './registry.js'
import { WEB_SEARCH_DEFINITION, executeWebSearch } from './web-search.js'
import { FILE_READ_DEFINITION, executeFileRead } from './file-read.js'
import { CODE_EXEC_DEFINITION, executeCodeExec } from './code-exec.js'

export type { ToolDefinition, ToolCallRequest, ToolCallResult }
export { WEB_SEARCH_DEFINITION, FILE_READ_DEFINITION, CODE_EXEC_DEFINITION }

interface SkillToolModule {
  execute?: (
    input: Record<string, unknown>,
    context: {
      skillId: string
      toolName: string
      workspaceRoot: string
      env: NodeJS.ProcessEnv
    },
  ) => Promise<string> | string
}

let builtinsRegistered = false

function ensureBuiltinToolsRegistered(): void {
  if (builtinsRegistered) {
    return
  }

  const registry = getToolRegistry()
  registry.registerBuiltin(WEB_SEARCH_DEFINITION, (input) => executeWebSearch(input as { query: string }))
  registry.registerBuiltin(FILE_READ_DEFINITION, (input) => executeFileRead(input as { path: string; maxChars?: string }))
  registry.registerBuiltin(CODE_EXEC_DEFINITION, (input) => executeCodeExec(input as { language: string; code: string }))
  builtinsRegistered = true
}

async function loadSkillToolModule(skill: SkillState, handlerPath: string): Promise<SkillToolModule> {
  const fileUrl = pathToFileURL(handlerPath).href
  const module = await import(`${fileUrl}?ts=${Date.now()}`) as SkillToolModule
  if (typeof module.execute !== 'function') {
    throw new Error(`Skill handler "${handlerPath}" must export an execute() function`)
  }
  return module
}

export async function syncSkillToolsFromStates(skills: SkillState[]): Promise<void> {
  ensureBuiltinToolsRegistered()
  const registry = getToolRegistry()
  registry.clearSkillTools()

  for (const skill of skills) {
    const mode = skill.metadata.mode ?? 'prompt-only'
    if (!skill.enabled || !skill.eligible || mode !== 'tool-contributor') {
      continue
    }

    for (const tool of skill.metadata.tools ?? []) {
      const handlerPath = join(skill.dirPath, tool.handler)

      try {
        const module = await loadSkillToolModule(skill, handlerPath)
        registry.registerSkillTool(skill.id, {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        }, (input) => Promise.resolve(module.execute!(input, {
          skillId: skill.id,
          toolName: tool.name,
          workspaceRoot: process.cwd(),
          env: process.env,
        })))
      } catch (error) {
        console.warn(
          `[skills] failed to register tool "${tool.name}" from skill "${skill.id}": ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }
}

export function getToolDefinitions(snapshot?: RegistrySnapshot): ToolDefinition[] {
  ensureBuiltinToolsRegistered()
  if (snapshot) {
    return snapshot.toolDefinitions
  }

  return getToolRegistry().getDefinitions()
}

export function getToolRegistryVersion(): number {
  ensureBuiltinToolsRegistered()
  return getToolRegistry().getVersion()
}

export async function executeTool(request: ToolCallRequest, snapshot?: RegistrySnapshot): Promise<ToolCallResult> {
  ensureBuiltinToolsRegistered()
  const allowedToolNames = snapshot
    ? new Set(snapshot.toolDefinitions.map((tool) => tool.name))
    : undefined
  return getToolRegistry().execute(request, allowedToolNames)
}
