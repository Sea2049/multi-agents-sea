import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { startServer, stopServer } from '../index.js'
import { closeDb } from '../storage/db.js'
import { flushMemoryIndexingQueue } from '../memory/store.js'

function extractTaskId(content: string): string {
  const match = content.match(/Task ID:\s*([^\n]+)/i)
  return match?.[1]?.trim() || `task-${Date.now()}`
}

const mockedProvider = {
  name: 'mock-runtime',
  supportsTools: false,
  async *chat(params: { systemPrompt: string; messages: Array<{ content: string }> }) {
    const prompt = params.systemPrompt
    const userContent = params.messages.at(-1)?.content ?? ''

    if (prompt.includes('task planning coordinator')) {
      const taskId = extractTaskId(userContent)
      yield {
        delta: JSON.stringify({
          taskId,
          summary: 'Mock plan summary',
          steps: [
            {
              id: 'step-1',
              title: 'Mock Step',
              assignee: 'agent-a',
              dependsOn: [],
              objective: 'Generate mock output',
              expectedOutput: 'Mock output',
            },
          ],
        }),
        done: false,
      }
      yield { delta: '', done: true }
      return
    }

    if (prompt.includes('synthesis coordinator')) {
      yield { delta: '# Mock Task Report\n\n- status: completed', done: false }
      yield { delta: '', done: true }
      return
    }

    yield { delta: 'Mock output', done: false }
    yield { delta: '', done: true }
  },
  async models() {
    return [{ id: 'mock-model', name: 'Mock Model' }]
  },
  async validateCredentials() {
    return { ok: true }
  },
}

vi.mock('../providers/index.js', () => ({
  getRuntimeProviderFromEnv: () => mockedProvider,
  isProviderName: (_name: string) => true,
}))

async function loadApiClient(): Promise<any> {
  const modulePath = '../../../src/lib/api-client.ts'
  const mod = await import(modulePath)
  return mod.apiClient
}

function setMockWindow(baseUrl: string): void {
  Object.defineProperty(globalThis, 'window', {
    value: {
      api: {
        getServerBaseUrl: async () => baseUrl,
      },
    },
    configurable: true,
  })
}

function clearMockWindow(): void {
  Reflect.deleteProperty(globalThis, 'window')
}

describe('HTTP Tasks + SSE local chain', () => {
  beforeEach(async () => {
    await stopServer()
    await flushMemoryIndexingQueue()
    closeDb()
    clearMockWindow()
  })

  afterAll(async () => {
    await stopServer()
    await flushMemoryIndexingQueue()
    closeDb()
    clearMockWindow()
  })

  it('walks create -> stream -> chat -> continue using apiClient', async () => {
    const { address } = await startServer(0)
    setMockWindow(address)
    const apiClient = await loadApiClient()

    const created = await apiClient.tasks.create({
      objective: '本地链路验证：输出任务摘要并支持后续交互',
      teamMembers: [{ agentId: 'agent-a', provider: 'minimax', model: 'mock-model' }],
    })
    const taskId = created.taskId as string
    expect(typeof taskId).toBe('string')

    const events: Array<Record<string, unknown>> = []
    for await (const event of apiClient.tasks.streamEvents(taskId)) {
      events.push(event)
      if (event.type === 'task_completed' || event.type === 'task_failed') {
        break
      }
    }

    expect(events.some((event) => event.type === 'task_completed')).toBe(true)

    const chatChunks: Array<{ delta: string; done: boolean; error?: string }> = []
    for await (const chunk of apiClient.tasks.chat(taskId, '继续聊天：请总结当前状态')) {
      chatChunks.push(chunk)
      if (chunk.done) break
    }
    expect(chatChunks.length).toBeGreaterThan(0)
    expect(chatChunks.some((chunk) => chunk.done)).toBe(true)

    const continued = await apiClient.tasks.continueTask(taskId, '继续执行：补充下一步行动清单')
    expect(continued.ok).toBe(true)
    expect(continued.runVersion).toBeGreaterThan(1)
  }, 60_000)
})

