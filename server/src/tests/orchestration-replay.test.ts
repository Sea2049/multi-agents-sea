import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { executePlan } from '../orchestrator/scheduler.js'
import { validatePlan } from '../orchestrator/plan-validator.js'
import { createPlan } from '../orchestrator/planner.js'
import type { LLMProvider, ChatParams, ChatChunk } from '../providers/types.js'
import type { TaskPlan, TaskExecutionEvent } from '../orchestrator/types.js'
import { closeDb, initDb } from '../storage/db.js'

// ---------------------------------------------------------------------------
// Mock LLM provider helpers
// ---------------------------------------------------------------------------

function makeMockProvider(responseText: string): LLMProvider {
  return {
    name: 'mock',
    async *chat(_params: ChatParams): AsyncIterable<ChatChunk> {
      yield { delta: responseText, done: false }
      yield { delta: '', done: true }
    },
    async models() {
      return [{ id: 'mock-model', name: 'Mock' }]
    },
    async validateCredentials() {
      return { ok: true }
    },
  }
}

function makeSlowProvider(delayMs: number): LLMProvider {
  return {
    name: 'mock-slow',
    async *chat(_params: ChatParams): AsyncIterable<ChatChunk> {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      yield { delta: 'too late', done: false }
      yield { delta: '', done: true }
    },
    async models() {
      return [{ id: 'mock-model', name: 'Mock' }]
    },
    async validateCredentials() {
      return { ok: true }
    },
  }
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TWO_STEP_PLAN: TaskPlan = {
  taskId: 'task-replay-1',
  summary: 'Two sequential steps',
  steps: [
    {
      id: 'step-1',
      title: 'Step One',
      assignee: 'agent-a',
      dependsOn: [],
      objective: 'First objective',
      expectedOutput: 'First result',
    },
    {
      id: 'step-2',
      title: 'Step Two',
      assignee: 'agent-b',
      dependsOn: ['step-1'],
      objective: 'Second objective',
      expectedOutput: 'Second result',
    },
  ],
}

const AVAILABLE_AGENTS = new Set(['agent-a', 'agent-b'])

beforeEach(() => {
  closeDb()
  initDb(':memory:')
})

afterEach(() => {
  closeDb()
})

// ---------------------------------------------------------------------------
// 场景1：成功执行（2个步骤，step-2 依赖 step-1）
// ---------------------------------------------------------------------------
describe('Scenario 1: Successful two-step execution', () => {
  it('should execute both steps and emit all events in order', async () => {
    const events: TaskExecutionEvent[] = []
    const mockProvider = makeMockProvider('Mock output')

    const results = await executePlan({
      plan: TWO_STEP_PLAN,
      teamMembers: [
        { agentId: 'agent-a', provider: 'mock', model: 'mock-model' },
        { agentId: 'agent-b', provider: 'mock', model: 'mock-model' },
      ],
      providerFactory: () => mockProvider,
      onEvent: (e) => events.push(e),
      timeoutMs: 5_000,
    })

    const eventTypes = events.map((e) => e.type)
    expect(eventTypes[0]).toBe('task_started')
    expect(eventTypes).toContain('step_started')
    expect(eventTypes).toContain('step_completed')
    expect(eventTypes[eventTypes.length - 1]).toBe('task_completed')

    expect(results.get('step-1')?.output).toBe('Mock output')
    expect(results.get('step-2')?.output).toBe('Mock output')

    // step-2 must start after step-1 completes (sequential)
    const s1CompletedIdx = events.findIndex(
      (e) => e.type === 'step_completed' && e.stepId === 'step-1',
    )
    const s2StartedIdx = events.findIndex(
      (e) => e.type === 'step_started' && e.stepId === 'step-2',
    )
    expect(s1CompletedIdx).toBeLessThan(s2StartedIdx)
  })
})

// ---------------------------------------------------------------------------
// 场景2：计划修复（第一次 validatePlan 失败 → repair → 第二次成功）
// ---------------------------------------------------------------------------
describe('Scenario 2: Plan repair flow', () => {
  it('should succeed on second attempt after repair hint', async () => {
    const invalidPlanJson = JSON.stringify({
      taskId: 'task-repair',
      summary: 'Bad plan',
      steps: [
        {
          id: 'step-1',
          title: 'Step One',
          assignee: 'agent-unknown', // will fail UNKNOWN_ASSIGNEE
          dependsOn: [],
          objective: 'Do something',
          expectedOutput: 'A result',
        },
      ],
    })

    const validPlanJson = JSON.stringify({
      taskId: 'task-repair',
      summary: 'Fixed plan',
      steps: [
        {
          id: 'step-1',
          title: 'Step One',
          assignee: 'agent-a',
          dependsOn: [],
          objective: 'Do something',
          expectedOutput: 'A result',
        },
      ],
    })

    let callCount = 0
    const repairProvider = makeMockProvider(
      callCount === 0 ? invalidPlanJson : validPlanJson,
    )

    const mockProviderRepair: LLMProvider = {
      name: 'mock-repair',
      async *chat(_params: ChatParams): AsyncIterable<ChatChunk> {
        callCount++
        const text = callCount === 1 ? invalidPlanJson : validPlanJson
        yield { delta: text, done: false }
        yield { delta: '', done: true }
      },
      async models() {
        return [{ id: 'mock-model', name: 'Mock' }]
      },
      async validateCredentials() {
        return { ok: true }
      },
    }
    void repairProvider

    const teamMembers = [
      {
        agentId: 'agent-a',
        name: 'Agent A',
        description: 'General agent',
        division: 'ops',
      },
    ]

    // First attempt — expect invalid plan
    const plan1 = await createPlan({
      taskId: 'task-repair',
      objective: 'Test repair',
      teamMembers,
      provider: mockProviderRepair,
      model: 'mock-model',
    })
    const validation1 = validatePlan(plan1, new Set(['agent-a']))
    expect(validation1.valid).toBe(false)
    expect(validation1.errors[0].code).toBe('UNKNOWN_ASSIGNEE')

    // Second attempt — with repair hint
    const plan2 = await createPlan({
      taskId: 'task-repair',
      objective: 'Test repair',
      teamMembers,
      provider: mockProviderRepair,
      model: 'mock-model',
      repairHints: validation1.errors.map((e) => e.message).join('\n'),
    })
    const validation2 = validatePlan(plan2, new Set(['agent-a']))
    expect(validation2.valid).toBe(true)
    expect(validation2.errors).toHaveLength(0)
    expect(callCount).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 场景3：步骤超时
// ---------------------------------------------------------------------------
describe('Scenario 3: Step execution timeout', () => {
  it('should mark step as failed when it times out', async () => {
    const events: TaskExecutionEvent[] = []
    const slowProvider = makeSlowProvider(500) // 500ms delay

    const singleStepPlan: TaskPlan = {
      taskId: 'task-timeout',
      summary: 'Timeout test',
      steps: [
        {
          id: 'step-1',
          title: 'Slow step',
          assignee: 'agent-a',
          dependsOn: [],
          objective: 'This will time out',
          expectedOutput: 'Nothing',
        },
      ],
    }

    const results = await executePlan({
      plan: singleStepPlan,
      teamMembers: [{ agentId: 'agent-a', provider: 'mock-slow', model: 'mock-model' }],
      providerFactory: () => slowProvider,
      onEvent: (e) => events.push(e),
      timeoutMs: 50, // 50ms timeout — much less than 500ms delay
    })

    const failedResult = results.get('step-1')
    expect(failedResult?.error).toBeDefined()
    expect(failedResult?.error).toContain('timed out')

    const eventTypes = events.map((e) => e.type)
    expect(eventTypes).toContain('step_failed')
    expect(eventTypes[eventTypes.length - 1]).toBe('task_failed')
  })

  it('should mark downstream steps as skipped when an upstream dependency times out', async () => {
    const events: TaskExecutionEvent[] = []
    const fastProvider = makeMockProvider('fast output')
    const slowProvider = makeSlowProvider(500)
    const threeStepPlan: TaskPlan = {
      taskId: 'task-timeout-dependency',
      summary: 'Timeout dependency propagation test',
      steps: [
        {
          id: 'step-1',
          title: 'Fast step',
          assignee: 'agent-a',
          dependsOn: [],
          objective: 'Complete quickly',
          expectedOutput: 'Done fast',
        },
        {
          id: 'step-2',
          title: 'Slow step',
          assignee: 'agent-b',
          dependsOn: ['step-1'],
          objective: 'This step times out',
          expectedOutput: 'Never completes in time',
        },
        {
          id: 'step-3',
          title: 'Blocked step',
          assignee: 'agent-a',
          dependsOn: ['step-2'],
          objective: 'Should be skipped after dependency failure',
          expectedOutput: 'No execution',
        },
      ],
    }

    const results = await executePlan({
      plan: threeStepPlan,
      teamMembers: [
        { agentId: 'agent-a', provider: 'mock-fast', model: 'mock-model' },
        { agentId: 'agent-b', provider: 'mock-slow', model: 'mock-model' },
      ],
      providerFactory: (providerName) => providerName === 'mock-slow' ? slowProvider : fastProvider,
      onEvent: (e) => events.push(e),
      timeoutMs: 50,
    })

    expect(results.get('step-1')?.output).toBe('fast output')
    expect(results.get('step-2')?.error).toContain('timed out')

    const skippedEvent = events.find(
      (event) => event.type === 'step_skipped' && event.stepId === 'step-3',
    )
    expect(skippedEvent).toBeDefined()
    expect(skippedEvent?.output).toContain('Skipped because dependency failed')
    expect(events.at(-1)?.type).toBe('task_failed')
  })

  it('should propagate skipped status through all downstream dependency levels', async () => {
    const events: TaskExecutionEvent[] = []
    const fastProvider = makeMockProvider('unused output')
    const slowProvider = makeSlowProvider(500)
    const threeStepPlan: TaskPlan = {
      taskId: 'task-timeout-root-dependency',
      summary: 'Root timeout should skip the entire downstream chain',
      steps: [
        {
          id: 'step-1',
          title: 'Root slow step',
          assignee: 'agent-a',
          dependsOn: [],
          objective: 'This root step times out',
          expectedOutput: 'Never completes in time',
        },
        {
          id: 'step-2',
          title: 'First blocked step',
          assignee: 'agent-b',
          dependsOn: ['step-1'],
          objective: 'Should be skipped after root failure',
          expectedOutput: 'No execution',
        },
        {
          id: 'step-3',
          title: 'Second blocked step',
          assignee: 'agent-b',
          dependsOn: ['step-2'],
          objective: 'Should also be skipped, not marked deadlocked',
          expectedOutput: 'No execution',
        },
      ],
    }

    const results = await executePlan({
      plan: threeStepPlan,
      teamMembers: [
        { agentId: 'agent-a', provider: 'mock-slow', model: 'mock-model' },
        { agentId: 'agent-b', provider: 'mock-fast', model: 'mock-model' },
      ],
      providerFactory: (providerName) => providerName === 'mock-slow' ? slowProvider : fastProvider,
      onEvent: (e) => events.push(e),
      timeoutMs: 50,
    })

    expect(results.get('step-1')?.error).toContain('timed out')

    const skippedStepIds = events
      .filter((event) => event.type === 'step_skipped')
      .map((event) => event.stepId)
    expect(skippedStepIds).toEqual(expect.arrayContaining(['step-2', 'step-3']))

    const deadlockFailure = events.find(
      (event) => event.type === 'step_failed' && event.error?.includes('deadlocked'),
    )
    expect(deadlockFailure).toBeUndefined()
    expect(events.at(-1)?.type).toBe('task_failed')
  })
})

// ---------------------------------------------------------------------------
// 场景4：循环依赖（validatePlan 检测环）
// ---------------------------------------------------------------------------
describe('Scenario 4: Circular dependency detection', () => {
  it('should detect circular dependency and refuse to execute', () => {
    const circularPlan: TaskPlan = {
      taskId: 'task-circular',
      summary: 'Circular deps',
      steps: [
        {
          id: 'step-1',
          title: 'Step One',
          assignee: 'agent-a',
          dependsOn: ['step-2'],
          objective: 'Depends on step-2',
          expectedOutput: 'Result',
        },
        {
          id: 'step-2',
          title: 'Step Two',
          assignee: 'agent-b',
          dependsOn: ['step-1'],
          objective: 'Depends on step-1',
          expectedOutput: 'Result',
        },
      ],
    }

    const result = validatePlan(circularPlan, AVAILABLE_AGENTS)
    expect(result.valid).toBe(false)
    expect(result.errors[0].code).toBe('CIRCULAR_DEPENDENCY')
    expect(result.errors[0].message).toContain('Circular dependency')
  })
})

// ---------------------------------------------------------------------------
// 场景5：Agent 不存在（validatePlan 检测 unknown assignee）
// ---------------------------------------------------------------------------
describe('Scenario 5: Unknown assignee detection', () => {
  it('should fail validation when a step is assigned to a non-existent agent', () => {
    const unknownAssigneePlan: TaskPlan = {
      taskId: 'task-ghost',
      summary: 'Ghost agent plan',
      steps: [
        {
          id: 'step-1',
          title: 'Ghost step',
          assignee: 'agent-ghost',
          dependsOn: [],
          objective: 'Assigned to nonexistent agent',
          expectedOutput: 'Nothing',
        },
      ],
    }

    const result = validatePlan(unknownAssigneePlan, AVAILABLE_AGENTS)
    expect(result.valid).toBe(false)
    expect(result.errors[0].code).toBe('UNKNOWN_ASSIGNEE')
    expect(result.errors[0].message).toContain('agent-ghost')
    expect(result.errors[0].stepId).toBe('step-1')
  })

  it('should pass validation after providing the correct agent set', () => {
    const fixedPlan: TaskPlan = {
      taskId: 'task-ghost',
      summary: 'Ghost agent plan fixed',
      steps: [
        {
          id: 'step-1',
          title: 'Now valid step',
          assignee: 'agent-ghost',
          dependsOn: [],
          objective: 'Assigned to ghost agent (now available)',
          expectedOutput: 'Something',
        },
      ],
    }

    // Add ghost to the available set
    const result = validatePlan(fixedPlan, new Set(['agent-a', 'agent-ghost']))
    expect(result.valid).toBe(true)
  })
})
