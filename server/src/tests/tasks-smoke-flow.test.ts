import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app.js'
import { closeDb, initDb } from '../storage/db.js'
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

describe('tasks smoke flow', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    closeDb()
    initDb(':memory:')
    app = await buildApp()
  })

  afterEach(async () => {
    await app.close()
    await flushMemoryIndexingQueue()
    closeDb()
  })

  it('covers create -> chat -> continue HTTP flow', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      payload: {
        objective: '冒烟：输出一段简要状态说明',
        teamMembers: [{ agentId: 'agent-a', provider: 'minimax', model: 'mock-model' }],
      },
    })

    expect(createRes.statusCode).toBe(202)
    const created = createRes.json() as { id: string; status: string; runVersion: number }
    expect(typeof created.id).toBe('string')
    expect(created.status).toBe('pending')
    expect(created.runVersion).toBe(1)

    const chatRes = await app.inject({
      method: 'POST',
      url: `/api/tasks/${created.id}/chat`,
      payload: { message: '继续聊天：请总结当前状态' },
    })
    expect(chatRes.statusCode).toBe(200)
    expect(chatRes.headers['content-type']).toContain('text/event-stream')
    expect(chatRes.body).toContain('data:')

    let latestStatus = 'pending'
    for (let i = 0; i < 40; i++) {
      const taskRes = await app.inject({
        method: 'GET',
        url: `/api/tasks/${created.id}`,
      })
      expect(taskRes.statusCode).toBe(200)
      const taskPayload = taskRes.json() as { status: string }
      latestStatus = taskPayload.status
      if (latestStatus === 'completed' || latestStatus === 'failed') {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }

    expect(['completed', 'failed']).toContain(latestStatus)

    const continueRes = await app.inject({
      method: 'POST',
      url: `/api/tasks/${created.id}/continue`,
      payload: { message: '继续执行：补充下一步清单' },
    })

    expect(continueRes.statusCode).toBe(200)
    const continued = continueRes.json() as { ok: boolean; runVersion: number; status: string }
    expect(continued.ok).toBe(true)
    expect(continued.status).toBe('planning')
    expect(continued.runVersion).toBe(2)
  }, 60_000)
})

