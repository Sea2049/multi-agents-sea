import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, initDb } from '../storage/db.js'
import { flushMemoryIndexingQueue, listMemories } from '../memory/store.js'
import { persistTaskLongTermMemories } from '../memory/task-memory-extractor.js'
import type { LLMProvider, ChatChunk, ChatParams, ModelInfo, ProviderHealth } from '../providers/types.js'
import type { TaskPlan, StepResult } from '../orchestrator/types.js'

class StaticTextProvider implements LLMProvider {
  readonly name = 'mock'

  constructor(private readonly text: string) {}

  async *chat(_params: ChatParams): AsyncIterable<ChatChunk> {
    yield { delta: this.text, done: false }
    yield { delta: '', done: true }
  }

  async models(): Promise<ModelInfo[]> {
    return [{ id: 'mock-model', name: 'Mock Model' }]
  }

  async validateCredentials(): Promise<ProviderHealth> {
    return { ok: true, latencyMs: 1 }
  }
}

function createTaskPlan(): TaskPlan {
  return {
    taskId: 'task-memory-001',
    summary: '总结一个跨任务记忆抽取流程',
    steps: [
      {
        id: 'step-research',
        title: 'Research',
        assignee: 'engineering-ai-engineer',
        dependsOn: [],
        objective: '整理事实',
        expectedOutput: '事实列表',
      },
      {
        id: 'step-decision',
        title: 'Decide',
        assignee: 'engineering-backend-architect',
        dependsOn: ['step-research'],
        objective: '形成决策',
        expectedOutput: '架构决策',
      },
    ],
  }
}

function createStepResults(): Map<string, StepResult> {
  return new Map<string, StepResult>([
    [
      'step-research',
      {
        stepId: 'step-research',
        agentId: 'engineering-ai-engineer',
        output: '发现用户需要跨任务复用营销文案洞察。',
        summary: '确认多个任务都会复用相同营销洞察。',
        startedAt: 1,
        completedAt: 2,
      },
    ],
    [
      'step-decision',
      {
        stepId: 'step-decision',
        agentId: 'engineering-backend-architect',
        output: '决定把高价值结论拆成结构化长期记忆。',
        summary: '决定新增结构化长期记忆抽取。',
        startedAt: 3,
        completedAt: 4,
      },
    ],
  ])
}

beforeEach(() => {
  closeDb()
  initDb(':memory:')
})

afterEach(async () => {
  await flushMemoryIndexingQueue()
  closeDb()
})

describe('task memory extractor', () => {
  it('在任务完成后写入 task_report 与 facts/decisions/outputs 三类长期记忆', async () => {
    const provider = new StaticTextProvider(JSON.stringify({
      facts: [
        {
          content: '跨任务营销任务会反复依赖同一批洞察结论。',
        },
      ],
      decisions: [
        {
          content: '系统决定把高价值结论拆成结构化长期记忆，供后续任务检索。',
          agentId: 'engineering-backend-architect',
        },
      ],
      outputs: [
        {
          content: '产出了一份可复用的营销文案提炼报告。',
          agentId: 'engineering-ai-engineer',
        },
      ],
    }))

    const created = await persistTaskLongTermMemories({
      taskId: 'task-memory-001',
      taskObjective: '为营销团队沉淀可复用的长期记忆',
      plan: createTaskPlan(),
      stepResults: createStepResults(),
      report: '最终报告：建议把任务结论拆分成 facts、decisions、outputs 三类记忆。',
      provider,
      model: 'mock-model',
    })

    expect(created).toHaveLength(4)

    const stored = listMemories({ taskId: 'task-memory-001', limit: 10 })
    expect(stored).toHaveLength(4)
    expect(stored.some((memory) => memory.category === 'task_report')).toBe(true)
    expect(stored.some((memory) => memory.category === 'fact')).toBe(true)
    expect(stored.some((memory) => memory.category === 'decision')).toBe(true)
    expect(stored.some((memory) => memory.category === 'output')).toBe(true)
    expect(stored.find((memory) => memory.category === 'decision')?.agentId).toBe('engineering-backend-architect')
    expect(stored.find((memory) => memory.category === 'output')?.agentId).toBe('engineering-ai-engineer')
  })

  it('当结构化抽取失败时，至少保留 task_report 记忆', async () => {
    const provider = new StaticTextProvider('not-json')

    const created = await persistTaskLongTermMemories({
      taskId: 'task-memory-002',
      taskObjective: '验证失败回退',
      plan: createTaskPlan(),
      stepResults: createStepResults(),
      report: '最终报告：即使抽取失败，也要保留任务总结。',
      provider,
      model: 'mock-model',
    })

    expect(created).toHaveLength(1)

    const stored = listMemories({ taskId: 'task-memory-002', limit: 10 })
    expect(stored).toHaveLength(1)
    expect(stored[0]?.category).toBe('task_report')
  })
})
