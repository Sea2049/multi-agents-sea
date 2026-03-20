import { describe, it, expect } from 'vitest'
import { validatePlan } from '../orchestrator/plan-validator.js'
import type { TaskPlan } from '../orchestrator/types.js'

describe('PlanValidator', () => {
  const availableAgents = new Set(['agent-a', 'agent-b', 'agent-c'])

  const validPlan: TaskPlan = {
    taskId: 'task-1',
    summary: 'Test plan',
    steps: [
      {
        id: 'step-1',
        title: 'Step One',
        assignee: 'agent-a',
        dependsOn: [],
        objective: 'Do something',
        expectedOutput: 'A result',
      },
      {
        id: 'step-2',
        title: 'Step Two',
        assignee: 'agent-b',
        dependsOn: ['step-1'],
        objective: 'Do something else',
        expectedOutput: 'Another result',
      },
    ],
  }

  it('should pass a valid plan', () => {
    const result = validatePlan(validPlan, availableAgents)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should fail for empty steps', () => {
    const plan = { ...validPlan, steps: [] }
    const result = validatePlan(plan, availableAgents)
    expect(result.valid).toBe(false)
    expect(result.errors[0].code).toBe('EMPTY_STEPS')
  })

  it('should fail for unknown assignee', () => {
    const plan: TaskPlan = {
      ...validPlan,
      steps: [{ ...validPlan.steps[0], assignee: 'agent-unknown' }],
    }
    const result = validatePlan(plan, availableAgents)
    expect(result.valid).toBe(false)
    expect(result.errors[0].code).toBe('UNKNOWN_ASSIGNEE')
  })

  it('should fail for duplicate step ids', () => {
    const plan: TaskPlan = {
      ...validPlan,
      steps: [validPlan.steps[0], { ...validPlan.steps[1], id: 'step-1' }],
    }
    const result = validatePlan(plan, availableAgents)
    expect(result.valid).toBe(false)
    expect(result.errors[0].code).toBe('DUPLICATE_STEP_ID')
  })

  it('should fail for circular dependency', () => {
    const plan: TaskPlan = {
      ...validPlan,
      steps: [
        { ...validPlan.steps[0], dependsOn: ['step-2'] },
        { ...validPlan.steps[1], dependsOn: ['step-1'] },
      ],
    }
    const result = validatePlan(plan, availableAgents)
    expect(result.valid).toBe(false)
    expect(result.errors[0].code).toBe('CIRCULAR_DEPENDENCY')
  })

  it('should fail for missing required fields', () => {
    const plan = {
      ...validPlan,
      steps: [{ id: 'step-1', title: 'Only title' }],
    }
    const result = validatePlan(plan as unknown as TaskPlan, availableAgents)
    expect(result.valid).toBe(false)
    expect(result.errors[0].code).toBe('SCHEMA_ERROR')
  })
})
