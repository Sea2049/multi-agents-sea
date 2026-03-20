export type MessageRole = 'user' | 'assistant' | 'system'

export interface Message {
  role: MessageRole
  content: string
}

export interface ChatChunk {
  delta: string
  done: boolean
}

export interface ModelInfo {
  id: string
  name: string
  contextWindow?: number
}

export interface ProviderHealth {
  ok: boolean
  latencyMs?: number
  error?: string
}

export interface ChatParams {
  model: string
  systemPrompt: string
  messages: Message[]
  temperature?: number
  maxTokens?: number
}

export interface LLMProvider {
  readonly name: string
  chat(params: ChatParams): AsyncIterable<ChatChunk>
  models(): Promise<ModelInfo[]>
  validateCredentials(): Promise<ProviderHealth>
  // 新增可选能力标识
  readonly supportsTools?: boolean
  // 新增支持 tools 的 chat 重载（可选实现）
  chatWithTools?(params: ChatParamsWithTools): AsyncIterable<ChatChunkWithTools>
}

// ─── Runtime-only Tool Types (not persisted to DB) ───────────────────────────

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, { type: string; description: string }>
    required?: string[]
  }
}

export interface ToolCallRequest {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolCallResult {
  toolCallId: string
  toolName: string
  output: string
  isError?: boolean
}

// Runtime provider message (extends DB Message for tool interaction)
export type ProviderMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCallRequest[] }
  | { role: 'tool'; toolCallId: string; toolName: string; content: string }

// Extended ChatParams that supports tools
export interface ChatParamsWithTools {
  model: string
  systemPrompt: string
  messages: ProviderMessage[]
  maxTokens?: number
  temperature?: number
  tools?: ToolDefinition[]
}

// Extended ChatChunk that may carry a tool call
export interface ChatChunkWithTools {
  delta: string
  done: boolean
  toolCall?: ToolCallRequest
}
