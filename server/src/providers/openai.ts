import OpenAI from 'openai'
import type {
  ChatChunk,
  ChatChunkWithTools,
  ChatParams,
  ChatParamsWithTools,
  LLMProvider,
  ModelInfo,
  ProviderHealth,
  ProviderMessage,
  ToolCallRequest,
} from './types.js'

const OPENAI_DEFAULT_MODELS: ModelInfo[] = [
  { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000 },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128000 },
  { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', contextWindow: 128000 },
  { id: 'gpt-4', name: 'GPT-4', contextWindow: 8192 },
  { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', contextWindow: 16385 },
]

interface OpenAIProviderOptions {
  name?: string
  baseURL?: string
  models?: ModelInfo[]
  validationModel?: string
}

function toOpenAiMessages(
  systemPrompt: string,
  messages: ChatParams['messages'] | ChatParamsWithTools['messages'],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
  ]

  for (const message of messages) {
    if (message.role === 'tool') {
      openAiMessages.push({
        role: 'tool',
        content: message.content,
        tool_call_id: message.toolCallId,
      })
      continue
    }

    if (message.role === 'assistant' && 'toolCalls' in message && message.toolCalls?.length) {
      openAiMessages.push({
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.toolCalls.map((toolCall: ToolCallRequest) => ({
          id: toolCall.id,
          type: 'function',
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.input ?? {}),
          },
        })),
      })
      continue
    }

    openAiMessages.push({
      role: message.role as Extract<ProviderMessage['role'], 'user' | 'assistant'>,
      content: message.content,
    })
  }

  return openAiMessages
}

export class OpenAIProvider implements LLMProvider {
  readonly name: string
  readonly supportsTools = true as const
  private readonly client: OpenAI
  private readonly catalog: ModelInfo[]
  private readonly validationModel: string

  constructor(apiKey: string, options: OpenAIProviderOptions = {}) {
    this.name = options.name ?? 'openai'
    this.catalog = options.models ?? OPENAI_DEFAULT_MODELS
    this.validationModel = options.validationModel ?? this.catalog[0]?.id ?? 'gpt-4o-mini'
    this.client = new OpenAI({
      apiKey,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    })
  }

  async *chat(params: ChatParams): AsyncIterable<ChatChunk> {
    const messages = toOpenAiMessages(params.systemPrompt, params.messages)

    let stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>
    try {
      stream = await this.client.chat.completions.create({
        model: params.model,
        messages,
        stream: true,
        temperature: params.temperature,
        max_tokens: params.maxTokens,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : `${this.name} chat request failed`
      throw new Error(`${this.name} chat error: ${message}`)
    }

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content
      const delta = typeof content === 'string' ? content : ''
      const done = chunk.choices[0]?.finish_reason != null
      if (delta) {
        yield { delta, done: false }
      }
      if (done) {
        yield { delta: '', done: true }
      }
    }
  }

  async models(): Promise<ModelInfo[]> {
    return this.catalog
  }

  async validateCredentials(): Promise<ProviderHealth> {
    const start = Date.now()
    try {
      await this.client.chat.completions.create({
        model: this.validationModel,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1,
      })
      return { ok: true, latencyMs: Date.now() - start }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return { ok: false, error: `${this.name} validation failed: ${message}` }
    }
  }

  async *chatWithTools(params: ChatParamsWithTools): AsyncGenerator<ChatChunkWithTools> {
    const messages = toOpenAiMessages(params.systemPrompt, params.messages)
    const tools: OpenAI.Chat.ChatCompletionTool[] = (params.tools ?? []).map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema as OpenAI.FunctionParameters,
      },
    }))

    let stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>
    try {
      stream = await this.client.chat.completions.create({
        model: params.model,
        messages,
        stream: true,
        temperature: params.temperature,
        max_tokens: params.maxTokens,
        ...(tools.length > 0 ? { tools, tool_choice: 'auto' as const } : {}),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : `${this.name} tool chat request failed`
      throw new Error(`${this.name} chatWithTools error: ${message}`)
    }

    const pendingToolCalls = new Map<number, { id: string; name: string; arguments: string }>()

    const flushToolCalls = async function *(): AsyncGenerator<ChatChunkWithTools> {
      const ordered = [...pendingToolCalls.entries()].sort(([left], [right]) => left - right)
      pendingToolCalls.clear()

      for (const [, pending] of ordered) {
        let input: Record<string, unknown> = {}
        try {
          input = JSON.parse(pending.arguments || '{}') as Record<string, unknown>
        } catch {
          input = {}
        }

        const toolCall: ToolCallRequest = {
          id: pending.id,
          name: pending.name,
          input,
        }
        yield { delta: '', done: false, toolCall }
      }
    }

    for await (const chunk of stream) {
      const choice = chunk.choices[0]
      const deltaContent = choice?.delta?.content
      const textDelta = typeof deltaContent === 'string' ? deltaContent : ''
      if (textDelta) {
        yield { delta: textDelta, done: false }
      }

      for (const toolDelta of choice?.delta?.tool_calls ?? []) {
        const index = toolDelta.index ?? 0
        const current = pendingToolCalls.get(index) ?? { id: '', name: '', arguments: '' }
        if (toolDelta.id) {
          current.id = toolDelta.id
        }
        if (toolDelta.function?.name) {
          current.name = toolDelta.function.name
        }
        if (toolDelta.function?.arguments) {
          current.arguments += toolDelta.function.arguments
        }
        pendingToolCalls.set(index, current)
      }

      if (choice?.finish_reason === 'tool_calls') {
        for await (const toolChunk of flushToolCalls()) {
          yield toolChunk
        }
      }

      if (choice?.finish_reason != null) {
        yield { delta: '', done: true }
      }
    }

    if (pendingToolCalls.size > 0) {
      for await (const toolChunk of flushToolCalls()) {
        yield toolChunk
      }
    }
  }
}
