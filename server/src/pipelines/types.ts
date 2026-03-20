import type { TaskPlan } from '../orchestrator/types.js'

export type PipelineStepKind = 'llm' | 'tool' | 'gate' | 'condition'
export type PipelineConditionOperator = 'exists' | 'contains' | 'equals' | 'not_contains'

interface PipelineBaseStep {
  id: string
  title: string
  kind: PipelineStepKind
  dependsOn?: string[]
  objective: string
}

export interface PipelineLlmStep extends PipelineBaseStep {
  kind: 'llm'
  assignee: string
  expectedOutput?: string
  provider?: string
  model?: string
}

export interface PipelineToolStep extends PipelineBaseStep {
  kind: 'tool'
  toolName: string
  inputTemplate: string
  expectedOutput?: string
}

export interface PipelineGateStep extends PipelineBaseStep {
  kind: 'gate'
  instructions?: string
}

export interface PipelineConditionStep extends PipelineBaseStep {
  kind: 'condition'
  sourceStepId: string
  operator: PipelineConditionOperator
  value?: string
  onTrue?: string[]
  onFalse?: string[]
}

export type PipelineStep =
  | PipelineLlmStep
  | PipelineToolStep
  | PipelineGateStep
  | PipelineConditionStep

export interface PipelineRuntimeDefaults {
  provider?: string
  model?: string
}

export interface PipelineDefinition {
  id: string
  name: string
  description?: string
  version: number
  runtimeDefaults?: PipelineRuntimeDefaults
  steps: PipelineStep[]
}

export interface StoredPipelineRecord {
  id: string
  name: string
  description?: string
  version: number
  definition: PipelineDefinition
  createdAt: number
  updatedAt: number
}

export function pipelineToTaskPlan(definition: PipelineDefinition, taskId: string): TaskPlan {
  return {
    taskId,
    summary: definition.description?.trim() || `${definition.name} pipeline run`,
    steps: definition.steps.map((step) => ({
      id: step.id,
      title: step.title,
      kind: step.kind === 'llm' ? 'agent' : step.kind,
      assignee:
        step.kind === 'llm'
          ? step.assignee
          : step.kind === 'tool'
            ? 'pipeline-tool'
            : step.kind === 'gate'
              ? 'human-approval'
              : 'pipeline-condition',
      dependsOn: step.dependsOn ?? [],
      objective: step.objective,
      expectedOutput:
        step.kind === 'llm'
          ? step.expectedOutput ?? 'Structured response for the next pipeline stage'
          : step.kind === 'tool'
            ? step.expectedOutput ?? `Tool output from ${step.toolName}`
            : step.kind === 'gate'
              ? 'Approval decision'
              : 'Condition evaluation result',
    })),
  }
}
