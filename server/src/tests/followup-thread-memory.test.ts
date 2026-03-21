import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetEmbeddingProviderForTests, setEmbeddingProviderFactoryForTests } from '../embedding/index.js'
import {
  buildContinuationContext,
  buildTaskQuestionWithMemoryContext,
  type TaskContextSnapshot,
  type TaskStepSnapshot,
  type TaskThreadMessage,
} from '../tasks/followup-thread.js'
import { flushMemoryIndexingQueue, saveMemory } from '../memory/store.js'
import { closeDb, initDb } from '../storage/db.js'

beforeEach(() => {
  closeDb()
  resetEmbeddingProviderForTests()
  setEmbeddingProviderFactoryForTests(async () => null)
  initDb(':memory:')
})

afterEach(async () => {
  await flushMemoryIndexingQueue()
  resetEmbeddingProviderForTests()
  closeDb()
})

describe('followup-thread memory context', () => {
  it('injects only scoped task knowledge into follow-up chat question', async () => {
    saveMemory({
      content: 'Task A baseline: use MySQL connection pool size 15.',
      source: 'task_report',
      category: 'fact',
      taskId: 'task-a',
      agentId: 'agent-a',
    })
    saveMemory({
      content: 'Task B baseline: use PostgreSQL pool size 40.',
      source: 'task_report',
      category: 'fact',
      taskId: 'task-b',
      agentId: 'agent-b',
    })

    const enriched = await buildTaskQuestionWithMemoryContext({
      taskId: 'task-a',
      agentId: 'agent-a',
      question: 'confirm rollout baseline for deployment',
    })

    expect(enriched).toContain('Task A baseline')
    expect(enriched).not.toContain('Task B baseline')
    expect(enriched).toContain('## Current User Request')
  })

  it('adds scoped memory block to continuation context while preserving thread digest', async () => {
    saveMemory({
      content: 'Task C decision: split migration into read/write phases and keep a rollback checkpoint.',
      source: 'task_report',
      category: 'decision',
      taskId: 'task-c',
      agentId: 'agent-c',
    })

    const task: TaskContextSnapshot = {
      id: 'task-c',
      objective: '升级数据库迁移流程',
      result: '已有初版执行报告',
      error: null,
      runVersion: 2,
    }
    const steps: TaskStepSnapshot[] = [
      {
        objective: '分析迁移风险',
        status: 'completed',
        summary: '已识别锁表风险',
        result: null,
        error: null,
        runVersion: 1,
      },
    ]
    const threadMessages: TaskThreadMessage[] = [
      {
        id: 'm1',
        taskId: 'task-c',
        runVersion: 2,
        role: 'user',
        mode: 'continue',
        content: '继续生成详细迁移步骤',
        createdAt: Date.now(),
      },
    ]

    const continuation = await buildContinuationContext({
      task,
      steps,
      threadMessages,
      instruction: 'please add rollback strategy',
      agentId: 'agent-c',
    })

    expect(continuation).toContain('Relevant memory context:')
    expect(continuation).toContain('Task C decision')
    expect(continuation).toContain('Recent follow-up thread')
    expect(continuation).toContain('New instruction:')
  })
})

