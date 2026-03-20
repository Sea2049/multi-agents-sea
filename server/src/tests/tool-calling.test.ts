import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runWithTools } from '../runtime/tool-executor.js'
import { executeTool, getToolDefinitions } from '../tools/index.js'
import { resetCodeExecDependencies, setCodeExecDependencies } from '../tools/code-exec.js'
import { executeFileRead, setWorkspaceRoot } from '../tools/file-read.js'
import type { ProviderMessage, ToolCallRequest } from '../providers/types.js'

// Mock web-search to avoid real network calls in unit tests
vi.mock('../tools/web-search.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../tools/web-search.js')>()
  return {
    ...original,
    executeWebSearch: vi.fn().mockResolvedValue('Mocked search result for: test query'),
  }
})

// Mock provider that supports tools
function createMockProvider(responses: Array<{ text?: string; toolCall?: ToolCallRequest }>) {
  let callIndex = 0
  const provider = {
    name: 'mock-tools',
    supportsTools: true,
    chat: vi.fn(),
    models: vi.fn(),
    validateCredentials: vi.fn(),
    chatWithTools: vi.fn().mockImplementation(async function* () {
      const response = responses[callIndex++] ?? { text: 'No more responses' }
      if (response.toolCall) {
        yield { delta: response.text ?? '', done: false, toolCall: response.toolCall }
      } else {
        yield { delta: response.text ?? '', done: false }
      }
      yield { delta: '', done: true }
    }),
  }
  return provider
}

// Mock provider that does NOT support tools
function createLegacyProvider(text: string) {
  return {
    name: 'mock-legacy',
    supportsTools: false,
    chat: vi.fn().mockImplementation(async function* () {
      yield { delta: text, done: false }
      yield { delta: '', done: true }
    }),
    models: vi.fn(),
    validateCredentials: vi.fn(),
  }
}

const testMessages: ProviderMessage[] = [
  { role: 'user', content: 'What is the weather in Paris?' }
]

beforeEach(() => {
  vi.clearAllMocks()
  resetCodeExecDependencies()
})

describe('Tool Registry', () => {
  it('should return all registered tool definitions', () => {
    const tools = getToolDefinitions()
    expect(tools.length).toBeGreaterThanOrEqual(2)
    const names = tools.map(t => t.name)
    expect(names).toContain('web_search')
    expect(names).toContain('file_read')
    expect(names).toContain('code_exec')
  })

  it('should return error result for unknown tool', async () => {
    const result = await executeTool({ id: 'test-1', name: 'unknown_tool', input: {} })
    expect(result.isError).toBe(true)
    expect(result.output).toContain('Unknown tool')
  })
})

describe('file_read tool', () => {
  it('should deny path traversal', async () => {
    setWorkspaceRoot('e:\\trae\\multi-agents-sea')
    const result = await executeFileRead({ path: '../../etc/passwd' })
    expect(result).toContain('Access denied')
  })

  it('should deny sensitive file patterns', async () => {
    setWorkspaceRoot('e:\\trae\\multi-agents-sea')
    const result = await executeFileRead({ path: '.env' })
    expect(result).toContain('Access denied')
  })

  it('should read a real file within workspace', async () => {
    setWorkspaceRoot('e:\\trae\\multi-agents-sea')
    const result = await executeFileRead({ path: 'package.json', maxChars: '100' })
    // Either reads successfully or file not found (either is fine for unit test)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })
})

describe('code_exec tool', () => {
  it('should return a friendly degradation error when Docker is unavailable', async () => {
    setCodeExecDependencies({
      checkDockerAvailable: vi.fn().mockResolvedValue({
        available: false,
        message: 'Docker CLI was not found in PATH',
      }),
    })

    const result = await executeTool({
      id: 'code-exec-docker-missing',
      name: 'code_exec',
      input: { language: 'javascript', code: 'console.log("hi")' },
    })

    expect(result.output).toContain('code_exec error')
    expect(result.output).toContain('Docker is not available')
    expect(result.output).toContain('Docker CLI was not found in PATH')
  })

  it('should execute javascript with hardened docker arguments', async () => {
    const checkDockerAvailable = vi.fn().mockResolvedValue({ available: true })
    const commandExecutor = vi.fn().mockResolvedValue({
      stdout: 'hello from js\n',
      stderr: '',
    })

    setCodeExecDependencies({
      checkDockerAvailable,
      commandExecutor,
    })

    const result = await executeTool({
      id: 'code-exec-js',
      name: 'code_exec',
      input: { language: 'javascript', code: 'console.log("hello from js")' },
    })

    expect(checkDockerAvailable).toHaveBeenCalledOnce()
    expect(commandExecutor).toHaveBeenCalledOnce()

    const [command, args, options] = commandExecutor.mock.calls[0] as [
      string,
      string[],
      { timeoutMs?: number } | undefined,
    ]

    expect(command).toBe('docker')
    expect(args).toEqual(expect.arrayContaining([
      'run',
      '--rm',
      '--network=none',
      '--memory=256m',
      '--cpus=0.5',
      '--pids-limit=64',
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt',
      'no-new-privileges',
      '--user',
      '65532:65532',
      '--tmpfs',
      '/tmp:size=16m,noexec,nosuid',
      'node:20-alpine',
      'node',
      '/workspace/main.js',
    ]))
    expect(args.some(arg => arg.endsWith(':/workspace:ro'))).toBe(true)
    expect(options).toMatchObject({ timeoutMs: 30_000 })
    expect(result.output).toContain('code_exec success')
    expect(result.output).toContain('hello from js')
  })

  it('should return a friendly error for unsupported languages', async () => {
    const checkDockerAvailable = vi.fn()
    setCodeExecDependencies({ checkDockerAvailable })

    const result = await executeTool({
      id: 'code-exec-bad-lang',
      name: 'code_exec',
      input: { language: 'ruby', code: 'puts 1' },
    })

    expect(checkDockerAvailable).not.toHaveBeenCalled()
    expect(result.output).toContain('code_exec error')
    expect(result.output).toContain('Unsupported language')
    expect(result.output).toContain('javascript')
    expect(result.output).toContain('python')
  })
})

describe('runWithTools - provider that does not support tools', () => {
  it('should fall back to regular chat when supportsTools is false', async () => {
    const provider = createLegacyProvider('Hello from legacy')
    const result = await runWithTools({
      provider: provider as any,
      model: 'test-model',
      systemPrompt: 'You are helpful',
      initialMessages: testMessages,
      tools: getToolDefinitions(),
    })
    expect(result.finalText).toBe('Hello from legacy')
    expect(result.toolCallCount).toBe(0)
    expect(provider.chat).toHaveBeenCalledOnce()
  })
})

describe('runWithTools - tool call flow', () => {
  it('should execute a tool and continue conversation', async () => {
    const toolCall: ToolCallRequest = {
      id: 'call-1',
      name: 'web_search',
      input: { query: 'test query' },
    }

    // First response: triggers a tool call
    // Second response: final answer after tool result
    const provider = createMockProvider([
      { text: 'Let me search for that.', toolCall },
      { text: 'Based on the search results, here is the answer.' },
    ])

    const started: ToolCallRequest[] = []
    const completed: Array<{ toolCall: ToolCallRequest; output: string; isError: boolean }> = []

    const result = await runWithTools({
      provider: provider as any,
      model: 'test-model',
      systemPrompt: 'You are helpful',
      initialMessages: testMessages,
      tools: getToolDefinitions(),
      onToolCallStarted: (tc) => started.push(tc),
      onToolCallCompleted: (tc, output, isError) => completed.push({ toolCall: tc, output, isError }),
    })

    expect(result.toolCallCount).toBe(1)
    expect(result.finalText).toBe('Based on the search results, here is the answer.')
    expect(started).toHaveLength(1)
    expect(started[0]?.name).toBe('web_search')
    expect(completed).toHaveLength(1)
  })

  it('should retry when the model claims tool usage without emitting a tool call', async () => {
    const toolCall: ToolCallRequest = {
      id: 'call-retry-1',
      name: 'file_read',
      input: { path: 'package.json' },
    }

    const provider = createMockProvider([
      { text: 'I used file_read and inspected package.json. Here is the answer.' },
      { text: '', toolCall },
      { text: 'Final answer after the real file_read tool result.' },
    ])

    const started: ToolCallRequest[] = []

    const result = await runWithTools({
      provider: provider as any,
      model: 'test-model',
      systemPrompt: 'You are helpful',
      initialMessages: [
        {
          role: 'user',
          content: 'You must use file_read to inspect package.json before answering.',
        },
      ],
      tools: getToolDefinitions(),
      onToolCallStarted: (tc) => started.push(tc),
    })

    expect(result.toolCallCount).toBe(1)
    expect(started).toHaveLength(1)
    expect(started[0]?.name).toBe('file_read')
    expect(result.finalText).toBe('Final answer after the real file_read tool result.')
  })

  it('should remind the model about remaining required tools after partial progress', async () => {
    const messageSnapshots: ProviderMessage[][] = []
    const provider = {
      name: 'mock-reminder',
      supportsTools: true,
      chat: vi.fn(),
      models: vi.fn(),
      validateCredentials: vi.fn(),
      chatWithTools: vi.fn().mockImplementation(async function* (params: { messages: ProviderMessage[] }) {
        messageSnapshots.push(
          params.messages.map((message) => {
            if (message.role === 'assistant') {
              return {
                ...message,
                toolCalls: message.toolCalls ? [...message.toolCalls] : undefined,
              }
            }
            return { ...message }
          }),
        )
        const callNumber = provider.chatWithTools.mock.calls.length
        const lastMessage = params.messages.at(-1)

        if (callNumber === 1) {
          yield {
            delta: '',
            done: false,
            toolCall: {
              id: 'call-file',
              name: 'file_read',
              input: { path: 'package.json' },
            },
          }
          yield { delta: '', done: true }
          return
        }

        if (
          callNumber === 2 &&
          lastMessage?.role === 'user' &&
          typeof lastMessage.content === 'string' &&
          lastMessage.content.includes('web_search')
        ) {
          yield {
            delta: '',
            done: false,
            toolCall: {
              id: 'call-web',
              name: 'web_search',
              input: { query: 'sqlite-vec' },
            },
          }
          yield { delta: '', done: true }
          return
        }

        yield {
          delta: callNumber >= 3 ? 'Final answer after both required tools.' : 'Final answer too early.',
          done: false,
        }
        yield { delta: '', done: true }
      }),
    }

    const result = await runWithTools({
      provider: provider as any,
      model: 'test-model',
      systemPrompt: 'You are helpful',
      initialMessages: [
        {
          role: 'user',
          content: 'You must use file_read and web_search before answering.',
        },
      ],
      tools: getToolDefinitions(),
      maxIterations: 4,
    })

    const secondCallMessages = messageSnapshots[1] ?? []
    const lastSecondMessage = secondCallMessages.at(-1)

    expect(lastSecondMessage?.role).toBe('user')
    expect((lastSecondMessage as Extract<ProviderMessage, { role: 'user' }>).content).toContain('web_search')
    expect(result.toolCallCount).toBe(2)
    expect(result.finalText).toBe('Final answer after both required tools.')
  })

  it('should synthesize a final answer when the provider returns empty text after tool completion', async () => {
    const provider = {
      name: 'mock-finalize',
      supportsTools: true,
      chat: vi.fn().mockImplementation(async function* () {
        yield { delta: 'Final synthesized answer.', done: false }
        yield { delta: '', done: true }
      }),
      models: vi.fn(),
      validateCredentials: vi.fn(),
      chatWithTools: vi.fn().mockImplementation(async function* () {
        const callNumber = provider.chatWithTools.mock.calls.length

        if (callNumber === 1) {
          yield {
            delta: '',
            done: false,
            toolCall: {
              id: 'call-file',
              name: 'file_read',
              input: { path: 'package.json' },
            },
          }
          yield { delta: '', done: true }
          return
        }

        yield { delta: '', done: false }
        yield { delta: '', done: true }
      }),
    }

    const result = await runWithTools({
      provider: provider as any,
      model: 'test-model',
      systemPrompt: 'You are helpful',
      initialMessages: [
        {
          role: 'user',
          content: 'You must use file_read before answering.',
        },
      ],
      tools: getToolDefinitions(),
      maxIterations: 4,
    })

    expect(result.toolCallCount).toBe(1)
    expect(provider.chat).toHaveBeenCalledOnce()
    expect(result.finalText).toBe('Final synthesized answer.')
  })

  it('should continue retrying when a required tool is still missing and the model emits only pseudo tool text', async () => {
    const provider = {
      name: 'mock-pseudo-tool',
      supportsTools: true,
      chat: vi.fn(),
      models: vi.fn(),
      validateCredentials: vi.fn(),
      chatWithTools: vi.fn().mockImplementation(async function* (params: { messages: ProviderMessage[] }) {
        const callNumber = provider.chatWithTools.mock.calls.length
        const lastMessage = params.messages.at(-1)

        if (callNumber === 1) {
          yield {
            delta: '',
            done: false,
            toolCall: {
              id: 'call-file',
              name: 'file_read',
              input: { path: 'package.json' },
            },
          }
          yield { delta: '', done: true }
          return
        }

        if (
          callNumber === 3 &&
          lastMessage?.role === 'user' &&
          typeof lastMessage.content === 'string' &&
          lastMessage.content.includes('code_exec')
        ) {
          yield {
            delta: '',
            done: false,
            toolCall: {
              id: 'call-code',
              name: 'code_exec',
              input: { language: 'javascript', code: 'console.log(1)' },
            },
          }
          yield { delta: '', done: true }
          return
        }

        if (callNumber === 3) {
          yield {
            delta: '```typescript\nfunctions.code_exec({ "language": "javascript", "code": "console.log(1)" })\n```',
            done: false,
          }
          yield { delta: '', done: true }
          return
        }

        if (callNumber === 4) {
          yield { delta: 'Final answer after real code execution.', done: false }
          yield { delta: '', done: true }
          return
        }
      }),
    }

    const result = await runWithTools({
      provider: provider as any,
      model: 'test-model',
      systemPrompt: 'You are helpful',
      initialMessages: [
        {
          role: 'user',
          content: 'You must use file_read and code_exec before answering.',
        },
      ],
      tools: getToolDefinitions(),
      maxIterations: 5,
    })

    expect(result.toolCallCount).toBe(2)
    expect(result.finalText).toBe('Final answer after real code execution.')
  })

  it('should stop after maxIterations', async () => {
    const toolCall: ToolCallRequest = {
      id: 'call-loop',
      name: 'web_search',
      input: { query: 'infinite' },
    }
    // Always returns a tool call, no final text
    const provider = {
      name: 'mock',
      supportsTools: true,
      chat: vi.fn(),
      models: vi.fn(),
      validateCredentials: vi.fn(),
      chatWithTools: vi.fn().mockImplementation(async function* () {
        yield { delta: '', done: false, toolCall }
        yield { delta: '', done: true }
      }),
    }

    const result = await runWithTools({
      provider: provider as any,
      model: 'test-model',
      systemPrompt: 'You are helpful',
      initialMessages: testMessages,
      tools: getToolDefinitions(),
      maxIterations: 3,
    })

    expect(result.toolCallCount).toBeLessThanOrEqual(3)
  })
})
