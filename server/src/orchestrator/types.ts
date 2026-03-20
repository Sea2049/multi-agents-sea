export type StepStatus = 'pending' | 'running' | 'pending_approval' | 'completed' | 'failed' | 'skipped'
export type TaskStatus = 'pending' | 'planning' | 'running' | 'completed' | 'failed'
export type ContextCompressionMode = 'full' | 'summary'

export interface TaskStep {
  id: string
  title: string
  kind?: 'agent' | 'tool' | 'gate' | 'condition'
  assignee: string
  dependsOn: string[]
  objective: string
  expectedOutput: string
}

export interface TaskPlan {
  taskId: string
  summary: string
  steps: TaskStep[]
}

export interface PlanValidationError {
  code:
    | 'INVALID_JSON'
    | 'SCHEMA_ERROR'
    | 'UNKNOWN_ASSIGNEE'
    | 'UNKNOWN_DEPENDENCY'
    | 'CIRCULAR_DEPENDENCY'
    | 'EMPTY_STEPS'
    | 'DUPLICATE_STEP_ID'
  message: string
  stepId?: string
}

export interface PlanValidationResult {
  valid: boolean
  errors: PlanValidationError[]
  plan?: TaskPlan
}

export interface StepResult {
  stepId: string
  agentId: string
  output: string
  summary?: string    // condensed output for aggregator (≤200 words)
  promptChars?: number
  tokenCount?: number
  startedAt: number
  completedAt: number
  error?: string
}

export interface TaskExecutionEvent {
  type:
    | 'task_started'
    | 'step_started'
    | 'step_waiting'
    | 'step_completed'
    | 'step_skipped'
    | 'step_failed'
    | 'task_completed'
    | 'task_failed'
    | 'tool_call_started'
    | 'tool_call_completed'
  taskId: string
  stepId?: string
  agentId?: string
  output?: string
  error?: string
  timestamp: number
  toolCallId?: string
  toolName?: string
  toolInput?: Record<string, unknown>
  toolOutput?: string
  toolIsError?: boolean
}
