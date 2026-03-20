import Anthropic from '@anthropic-ai/sdk'
import type { LLMProvider, ChatParams, ChatChunk, ModelInfo, ProviderHealth, ChatParamsWithTools, ChatChunkWithTools, ToolCallRequest } from './types.js'

export class AnthropicProvider implements LLMProvider {
  readonly name: string = 'anthropic'
  readonly supportsTools = true as const
  private client: Anthropic

  constructor(apiKey: string, baseURL?: string) {
    this.client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) })
  }

  async *chat(params: ChatParams): AsyncIterable<ChatChunk> {
    const messages: Anthropic.MessageParam[] = params.messages.map((m) => ({
      role: m.role === 'system' ? 'user' : (m.role as 'user' | 'assistant'),
      content: m.content,
    }))

    let stream: ReturnType<typeof this.client.messages.stream>
    try {
      stream = this.client.messages.stream({
        model: params.model,
        system: params.systemPrompt,
        messages,
        max_tokens: params.maxTokens ?? 4096,
        temperature: params.temperature,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Anthropic chat request failed'
      throw new Error(`Anthropic chat error: ${message}`)
    }

    try {
      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield { delta: event.delta.text, done: false }
        } else if (event.type === 'message_stop') {
          yield { delta: '', done: true }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Anthropic stream error'
      throw new Error(`Anthropic stream error: ${message}`)
    }
  }

  async models(): Promise<ModelInfo[]> {
    return [
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', contextWindow: 200000 },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', contextWindow: 200000 },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', contextWindow: 200000 },
    ]
  }

  async validateCredentials(): Promise<ProviderHealth> {
    const start = Date.now()
    try {
      await this.client.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      })
      return { ok: true, latencyMs: Date.now() - start }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return { ok: false, error: `Anthropic validation failed: ${message}` }
    }
  }

  async *chatWithTools(params: ChatParamsWithTools): AsyncGenerator<ChatChunkWithTools> {
    const messages: Anthropic.MessageParam[] = []

    for (const msg of params.messages) {
      if (msg.role === 'user') {
        messages.push({ role: 'user', content: msg.content })
      } else if (msg.role === 'assistant') {
        if (msg.toolCalls?.length) {
          const content: Anthropic.ContentBlock[] = []
          if (msg.content) {
            content.push({ type: 'text', text: msg.content })
          }
          for (const tc of msg.toolCalls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.input,
            })
          }
          messages.push({ role: 'assistant', content })
        } else {
          messages.push({ role: 'assistant', content: msg.content })
        }
      } else if (msg.role === 'tool') {
        messages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: msg.toolCallId,
            content: msg.content,
          }],
        })
      }
    }

    const tools: Anthropic.Tool[] = (params.tools ?? []).map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }))

    const stream = this.client.messages.stream({
      model: params.model,
      system: params.systemPrompt,
      messages,
      max_tokens: params.maxTokens ?? 2048,
      ...(tools.length > 0 ? { tools } : {}),
    })

    let pendingToolCall: Partial<ToolCallRequest> | null = null
    let toolInputBuffer = ''

    try {
      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            pendingToolCall = {
              id: event.content_block.id,
              name: event.content_block.name,
            }
            toolInputBuffer = ''
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            yield { delta: event.delta.text, done: false }
          } else if (event.delta.type === 'input_json_delta') {
            toolInputBuffer += event.delta.partial_json
          }
        } else if (event.type === 'content_block_stop') {
          if (pendingToolCall) {
            try {
              pendingToolCall.input = JSON.parse(toolInputBuffer || '{}')
            } catch {
              pendingToolCall.input = {}
            }
            yield {
              delta: '',
              done: false,
              toolCall: pendingToolCall as ToolCallRequest,
            }
            pendingToolCall = null
            toolInputBuffer = ''
          }
        } else if (event.type === 'message_stop') {
          yield { delta: '', done: true }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Anthropic stream error'
      throw new Error(`Anthropic chatWithTools stream error: ${message}`)
    }
  }
}
