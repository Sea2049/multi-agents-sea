import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { startServer, stopServer } from '../index.js'
import { MINIMAX_DEFAULT_MODEL_ID } from '../providers/minimax.js'
import { closeDb } from '../storage/db.js'

const API_KEY = process.env['PROVIDER_MINIMAX_KEY']
const SKIP = !API_KEY || API_KEY.length < 10
const MODEL = MINIMAX_DEFAULT_MODEL_ID

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

describe.skipIf(SKIP)('HTTP Tasks + SSE — MiniMax 真实链路', () => {
  beforeEach(async () => {
    await stopServer()
    closeDb()
    clearMockWindow()
  })

  afterAll(async () => {
    await stopServer()
    closeDb()
    clearMockWindow()
  })

  it('通过 apiClient 走通 memory、tasks 路由与 SSE 事件流', async () => {
    const { address } = await startServer(0)
    setMockWindow(address)
    const apiClient = await loadApiClient()

    const memoryToken = `MEMORY_HIT_HTTP_${Date.now()}`
    const memory = await apiClient.memory.save({
      content: `Deployment anchor memory for HTTP E2E: repeat token ${memoryToken} verbatim.`,
      category: 'deployment-notes',
    })
    expect(memory.memory.content).toContain(memoryToken)

    const memorySearch = await apiClient.memory.list({
      q: 'deployment anchor memory',
      limit: 5,
    })
    expect(memorySearch.memories.some((item: { content: string }) => item.content.includes(memoryToken))).toBe(true)

    const created = await apiClient.tasks.create({
      objective: [
        '请完成一个真实的 HTTP 级编排验证任务。',
        '你必须至少真实调用一次 file_read、web_search、code_exec。',
        '请读取 package.json，搜索 sqlite-vec，并执行 console.log([\'mini\',\'max\',\'tools\'].join(\'-\'))。',
        `如果你在历史记忆里看到了 ${memoryToken}，请原样逐字输出该令牌。`,
        '最终输出中文 Markdown 报告。',
      ].join('\n'),
      teamMembers: [
        { agentId: 'toolsmith', provider: 'minimax', model: MODEL },
      ],
    })
    expect(typeof created.taskId).toBe('string')

    const taskId = created.taskId as string
    const events: Array<Record<string, unknown>> = []

    for await (const event of apiClient.tasks.streamEvents(taskId)) {
      events.push(event)
      if (event.type === 'task_completed' || event.type === 'task_failed') {
        break
      }
    }

    expect(events.some((event) => event.type === 'tool_call_started' && event.toolName === 'file_read')).toBe(true)
    expect(events.some((event) => event.type === 'tool_call_started' && event.toolName === 'web_search')).toBe(true)
    expect(events.some((event) => event.type === 'tool_call_started' && event.toolName === 'code_exec')).toBe(true)

    const task = await apiClient.tasks.get(taskId)
    expect(task.id).toBe(taskId)
    expect(task.result).toContain(memoryToken)
    expect(task.result.toLowerCase()).toContain('mini-max-tools')

    const list = await apiClient.tasks.list()
    expect(list.some((item: { id: string }) => item.id === taskId)).toBe(true)
  }, 900_000)
})
