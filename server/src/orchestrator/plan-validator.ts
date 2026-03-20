import type { TaskPlan, TaskStep, PlanValidationResult, PlanValidationError } from './types.js'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

function validateStepSchema(step: unknown, index: number): PlanValidationError | null {
  if (!isRecord(step)) {
    return {
      code: 'SCHEMA_ERROR',
      message: `Step at index ${index} is not an object`,
    }
  }
  const required = ['id', 'title', 'assignee', 'dependsOn', 'objective', 'expectedOutput'] as const
  for (const field of required) {
    if (!(field in step)) {
      return {
        code: 'SCHEMA_ERROR',
        message: `Step at index ${index} is missing required field: "${field}"`,
        stepId: typeof step['id'] === 'string' ? step['id'] : undefined,
      }
    }
  }
  if (typeof step['id'] !== 'string' || !step['id']) {
    return { code: 'SCHEMA_ERROR', message: `Step at index ${index} has invalid "id" (must be non-empty string)` }
  }
  if (typeof step['title'] !== 'string' || !step['title']) {
    return { code: 'SCHEMA_ERROR', message: `Step "${step['id']}" has invalid "title"`, stepId: step['id'] }
  }
  if (typeof step['assignee'] !== 'string' || !step['assignee']) {
    return { code: 'SCHEMA_ERROR', message: `Step "${step['id']}" has invalid "assignee"`, stepId: step['id'] }
  }
  if (!isStringArray(step['dependsOn'])) {
    return { code: 'SCHEMA_ERROR', message: `Step "${step['id']}" has invalid "dependsOn" (must be string[])`, stepId: step['id'] }
  }
  if (typeof step['objective'] !== 'string' || !step['objective']) {
    return { code: 'SCHEMA_ERROR', message: `Step "${step['id']}" has invalid "objective"`, stepId: step['id'] }
  }
  if (typeof step['expectedOutput'] !== 'string' || !step['expectedOutput']) {
    return { code: 'SCHEMA_ERROR', message: `Step "${step['id']}" has invalid "expectedOutput"`, stepId: step['id'] }
  }
  return null
}

/**
 * DFS 环检测：返回第一个形成环的 stepId，无环返回 null
 */
function detectCycle(steps: TaskStep[]): string | null {
  const adjMap = new Map<string, string[]>()
  for (const s of steps) {
    adjMap.set(s.id, s.dependsOn)
  }

  const WHITE = 0, GRAY = 1, BLACK = 2
  const color = new Map<string, number>()
  for (const s of steps) {
    color.set(s.id, WHITE)
  }

  function dfs(nodeId: string): string | null {
    color.set(nodeId, GRAY)
    for (const dep of adjMap.get(nodeId) ?? []) {
      const c = color.get(dep)
      if (c === GRAY) return dep
      if (c === WHITE) {
        const found = dfs(dep)
        if (found) return found
      }
    }
    color.set(nodeId, BLACK)
    return null
  }

  for (const s of steps) {
    if (color.get(s.id) === WHITE) {
      const cycle = dfs(s.id)
      if (cycle) return cycle
    }
  }
  return null
}

export function validatePlan(
  plan: unknown,
  availableAgentIds: Set<string>,
): PlanValidationResult {
  if (!isRecord(plan)) {
    return {
      valid: false,
      errors: [{ code: 'SCHEMA_ERROR', message: 'Plan must be a JSON object' }],
    }
  }

  const rawSteps = plan['steps']
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    return {
      valid: false,
      errors: [{ code: 'EMPTY_STEPS', message: 'Plan must contain at least one step' }],
    }
  }

  // Schema check
  for (let i = 0; i < rawSteps.length; i++) {
    const err = validateStepSchema(rawSteps[i], i)
    if (err) {
      return { valid: false, errors: [err] }
    }
  }

  const steps = rawSteps as TaskStep[]

  // Duplicate step id
  const seenIds = new Set<string>()
  for (const step of steps) {
    if (seenIds.has(step.id)) {
      return {
        valid: false,
        errors: [{ code: 'DUPLICATE_STEP_ID', message: `Duplicate step id: "${step.id}"`, stepId: step.id }],
      }
    }
    seenIds.add(step.id)
  }

  // Unknown assignee
  for (const step of steps) {
    if (!availableAgentIds.has(step.assignee)) {
      return {
        valid: false,
        errors: [
          {
            code: 'UNKNOWN_ASSIGNEE',
            message: `Step "${step.id}" assigned to unknown agent: "${step.assignee}". Available: ${[...availableAgentIds].join(', ')}`,
            stepId: step.id,
          },
        ],
      }
    }
  }

  // Unknown dependency reference
  for (const step of steps) {
    for (const depId of step.dependsOn) {
      if (!seenIds.has(depId)) {
        return {
          valid: false,
          errors: [
            {
              code: 'UNKNOWN_DEPENDENCY',
              message: `Step "${step.id}" depends on unknown step: "${depId}"`,
              stepId: step.id,
            },
          ],
        }
      }
    }
  }

  // Circular dependency
  const cycleNode = detectCycle(steps)
  if (cycleNode) {
    return {
      valid: false,
      errors: [
        {
          code: 'CIRCULAR_DEPENDENCY',
          message: `Circular dependency detected involving step: "${cycleNode}"`,
          stepId: cycleNode,
        },
      ],
    }
  }

  const taskPlan: TaskPlan = {
    taskId: typeof plan['taskId'] === 'string' ? plan['taskId'] : '',
    summary: typeof plan['summary'] === 'string' ? plan['summary'] : '',
    steps,
  }

  return { valid: true, errors: [], plan: taskPlan }
}
