import { describe, expect, it } from 'vitest'
import { FailoverProvider } from '../providers/runtime-fallback.js'
import type {
  ChatChunk,
  ChatChunkWithTools,
  ChatParams,
  ChatParamsWithTools,
  LLMProvider,
  ModelInfo,
  ProviderHealth,
} from '../providers/types.js'

interface MockProviderOptions {
  name: string
  chatImpl?: (params: ChatParams) => AsyncIterable<ChatChunk>
  chatWithToolsImpl?: (params: ChatParamsWithTools) => AsyncIterable<ChatChunkWithTools>
  supportsTools?: boolean
}

function createMockProvider(options: MockProviderOptions): LLMProvider {
  return {
    name: options.name,
    supportsTools: options.supportsTools ?? Boolean(options.chatWithToolsImpl),
    chat: options.chatImpl ?? (async function *() {
      yield { delta: '', done: true }
    }),
    chatWithTools: options.chatWithToolsImpl,
    async models(): Promise<ModelInfo[]> {
      return []
    },
    async validateCredentials(): Promise<ProviderHealth> {
      return { ok: true }
    },
  }
}

async function collectChatText(stream: AsyncIterable<ChatChunk>): Promise<string> {
  let text = ''
  for await (const chunk of stream) {
    text += chunk.delta
  }
  return text
}

async function collectToolChunks(stream: AsyncIterable<ChatChunkWithTools>): Promise<ChatChunkWithTools[]> {
  const chunks: ChatChunkWithTools[] = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }
  return chunks
}

describe('FailoverProvider', () => {
  it('uses DashScope fallback when primary chat fails before first chunk', async () => {
    let fallbackModel = ''

    const provider = new FailoverProvider(
      'minimax',
      createMockProvider({
        name: 'minimax',
        chatImpl: async function *() {
          throw new Error('primary unavailable')
        },
      }),
      createMockProvider({
        name: 'dashscope',
        chatImpl: async function *(params) {
          fallbackModel = params.model
          yield { delta: 'fallback answer', done: false }
          yield { delta: '', done: true }
        },
      }),
      'qwen-max',
    )

    const text = await collectChatText(provider.chat({
      model: 'MiniMax-M2.7',
      systemPrompt: 'You are helpful.',
      messages: [{ role: 'user', content: 'hello' }],
    }))

    expect(text).toBe('fallback answer')
    expect(fallbackModel).toBe('qwen-max')
  })

  it('keeps primary provider when chat succeeds', async () => {
    let fallbackCalled = false

    const provider = new FailoverProvider(
      'minimax',
      createMockProvider({
        name: 'minimax',
        chatImpl: async function *() {
          yield { delta: 'primary answer', done: false }
          yield { delta: '', done: true }
        },
      }),
      createMockProvider({
        name: 'dashscope',
        chatImpl: async function *() {
          fallbackCalled = true
          yield { delta: 'fallback answer', done: false }
          yield { delta: '', done: true }
        },
      }),
      'qwen-max',
    )

    const text = await collectChatText(provider.chat({
      model: 'MiniMax-M2.7',
      systemPrompt: 'You are helpful.',
      messages: [{ role: 'user', content: 'hello' }],
    }))

    expect(text).toBe('primary answer')
    expect(fallbackCalled).toBe(false)
  })

  it('uses DashScope fallback for tool calls when primary tool chat fails', async () => {
    let fallbackModel = ''

    const provider = new FailoverProvider(
      'minimax',
      createMockProvider({
        name: 'minimax',
        supportsTools: true,
        chatWithToolsImpl: async function *() {
          throw new Error('primary tool call failed')
        },
      }),
      createMockProvider({
        name: 'dashscope',
        supportsTools: true,
        chatWithToolsImpl: async function *(params) {
          fallbackModel = params.model
          yield {
            delta: '',
            done: false,
            toolCall: {
              id: 'tool-1',
              name: 'file_read',
              input: { path: 'README.md' },
            },
          }
          yield { delta: '', done: true }
        },
      }),
      'qwen-max',
    )

    const chunks = await collectToolChunks(provider.chatWithTools!({
      model: 'MiniMax-M2.7',
      systemPrompt: 'Use tools when needed.',
      messages: [{ role: 'user', content: 'Read README.md' }],
      tools: [{
        name: 'file_read',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path' },
          },
          required: ['path'],
        },
      }],
    }))

    expect(fallbackModel).toBe('qwen-max')
    expect(chunks.some((chunk) => chunk.toolCall?.name === 'file_read')).toBe(true)
  })
})
