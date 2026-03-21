import type { ToolCallRequest, ToolCallResult, ToolDefinition } from '../providers/types.js'

export interface ToolRegistryEntry {
  ownerId: string
  kind: 'builtin' | 'skill'
  definition: ToolDefinition
  execute: (input: Record<string, unknown>) => Promise<string>
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolRegistryEntry>()
  private version = 0

  registerBuiltin(
    definition: ToolDefinition,
    execute: (input: Record<string, unknown>) => Promise<string>,
  ): void {
    this.tools.set(definition.name, {
      ownerId: 'builtin',
      kind: 'builtin',
      definition,
      execute,
    })
    this.version += 1
  }

  registerSkillTool(
    ownerId: string,
    definition: ToolDefinition,
    execute: (input: Record<string, unknown>) => Promise<string>,
  ): void {
    this.tools.set(definition.name, {
      ownerId,
      kind: 'skill',
      definition,
      execute,
    })
    this.version += 1
  }

  unregisterByOwner(ownerId: string): void {
    let removed = false
    for (const [toolName, entry] of this.tools.entries()) {
      if (entry.kind === 'skill' && entry.ownerId === ownerId) {
        this.tools.delete(toolName)
        removed = true
      }
    }
    if (removed) {
      this.version += 1
    }
  }

  clearSkillTools(): void {
    let removed = false
    for (const [toolName, entry] of this.tools.entries()) {
      if (entry.kind === 'skill') {
        this.tools.delete(toolName)
        removed = true
      }
    }
    if (removed) {
      this.version += 1
    }
  }

  getDefinitions(): ToolDefinition[] {
    return [...this.tools.values()].map((entry) => entry.definition)
  }

  getDefinitionsWithOwner(): Array<{ definition: ToolDefinition; ownerId: string }> {
    return [...this.tools.values()].map((entry) => ({
      definition: entry.definition,
      ownerId: entry.ownerId,
    }))
  }

  getVersion(): number {
    return this.version
  }

  async execute(request: ToolCallRequest, allowedToolNames?: Set<string>): Promise<ToolCallResult> {
    if (allowedToolNames && !allowedToolNames.has(request.name)) {
      return {
        toolCallId: request.id,
        toolName: request.name,
        output: `Tool "${request.name}" is not available in the current registry snapshot`,
        isError: true,
      }
    }

    const tool = this.tools.get(request.name)
    if (!tool) {
      return {
        toolCallId: request.id,
        toolName: request.name,
        output: `Unknown tool: ${request.name}`,
        isError: true,
      }
    }

    try {
      const output = await tool.execute(request.input)
      return {
        toolCallId: request.id,
        toolName: request.name,
        output,
      }
    } catch (error) {
      return {
        toolCallId: request.id,
        toolName: request.name,
        output: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      }
    }
  }
}

let toolRegistrySingleton: ToolRegistry | null = null

export function getToolRegistry(): ToolRegistry {
  if (!toolRegistrySingleton) {
    toolRegistrySingleton = new ToolRegistry()
  }

  return toolRegistrySingleton
}
