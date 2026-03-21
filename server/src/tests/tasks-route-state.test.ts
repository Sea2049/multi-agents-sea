import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../app.js'
import type { TaskPlan } from '../orchestrator/types.js'
import { closeDb, getDb, initDb } from '../storage/db.js'
import { persistTaskExecutionEvent } from '../tasks/runtime-store.js'

function insertTask(taskId: string, overrides?: { status?: string; result?: string; error?: string; teamMembers?: Array<{ agentId: string; provider: string; model: string }>; runVersion?: number }): void {
  const now = Date.now()
  getDb().prepare(
    `INSERT INTO tasks (id, status, kind, run_version, team_members, objective, result, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    taskId,
    overrides?.status ?? 'running',
    'orchestration',
    overrides?.runVersion ?? 1,
    JSON.stringify(overrides?.teamMembers ?? []),
    'Test task objective',
    overrides?.result ?? null,
    overrides?.error ?? null,
    now,
    now,
  )
}

describe('tasks routes state consistency', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    closeDb()
    initDb(':memory:')
    app = await buildApp()
  })

  afterEach(async () => {
    await app.close()
    closeDb()
  })

  it('should expose persisted step_skipped state through GET /api/tasks/:id', async () => {
    const taskId = 'task-route-skipped'
    const plan: TaskPlan = {
      taskId,
      summary: 'Route state mapping test',
      steps: [
        {
          id: 'step-3',
          title: 'Blocked step',
          assignee: 'agent-a',
          dependsOn: ['step-2'],
          objective: 'Should appear as skipped',
          expectedOutput: 'Skip reason',
        },
      ],
    }

    insertTask(taskId)
    persistTaskExecutionEvent(taskId, plan, {
      type: 'step_skipped',
      taskId,
      stepId: 'step-3',
      agentId: 'agent-a',
      output: 'Skipped because dependency failed',
      timestamp: Date.now(),
    })

    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}`,
    })

    expect(response.statusCode).toBe(200)
    const payload = response.json() as {
      steps: Array<{ id: string; status: string; result?: string | null }>
    }

    expect(payload.steps).toHaveLength(1)
    expect(payload.steps[0]).toMatchObject({
      id: 'step-3',
      status: 'skipped',
      result: 'Skipped because dependency failed',
    })
  })

  it('should emit terminal SSE state consistent with stored failed task data', async () => {
    const taskId = 'task-route-failed'
    insertTask(taskId, {
      status: 'failed',
      result: '# Task Report\n\nFallback report body',
      error: 'Step "step-2" timed out after 120000ms',
    })

    const taskResponse = await app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}`,
    })

    expect(taskResponse.statusCode).toBe(200)
    const taskPayload = taskResponse.json() as {
      status: string
      result?: string
      error?: string
    }
    expect(taskPayload.status).toBe('failed')
    expect(taskPayload.error).toContain('timed out')

    const streamResponse = await app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}/stream`,
    })

    expect(streamResponse.statusCode).toBe(200)
    expect(streamResponse.headers['content-type']).toContain('text/event-stream')

    const body = streamResponse.body.trim()
    expect(body.startsWith('data: ')).toBe(true)

    const event = JSON.parse(body.slice('data: '.length)) as {
      type: string
      output?: string
      error?: string
    }

    expect(event).toMatchObject({
      type: 'task_failed',
      output: '# Task Report\n\nFallback report body',
      error: 'Step "step-2" timed out after 120000ms',
    })
  })

  it('should reject continue when task is not in terminal state', async () => {
    const taskId = 'task-route-running'
    insertTask(taskId, {
      status: 'running',
      teamMembers: [{ agentId: 'agent-a', provider: 'minimax', model: 'mock-model' }],
    })

    const response = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/continue`,
      payload: { message: '继续执行后续步骤' },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({
      error: expect.stringContaining('only completed/failed tasks can continue'),
    })
  })

  it('should bump runVersion and persist continue thread message', async () => {
    const taskId = 'task-route-continue'
    insertTask(taskId, {
      status: 'completed',
      result: '# Final result',
      runVersion: 2,
      teamMembers: [{ agentId: 'agent-a', provider: 'minimax', model: 'mock-model' }],
    })

    const response = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/continue`,
      payload: { message: '请继续扩展到实施清单' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      ok: true,
      taskId,
      runVersion: 3,
    })

    const taskResponse = await app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}`,
    })
    expect(taskResponse.statusCode).toBe(200)

    const payload = taskResponse.json() as {
      runVersion: number
      threadMessages: Array<{ role: string; mode: string; runVersion: number; content: string }>
    }
    expect(payload.runVersion).toBe(3)
    expect(payload.threadMessages.at(-1)).toMatchObject({
      role: 'user',
      mode: 'continue',
      runVersion: 3,
      content: '请继续扩展到实施清单',
    })
  })
})
