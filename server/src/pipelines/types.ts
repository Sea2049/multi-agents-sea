import type { TaskPlan } from '../orchestrator/types.js'

export type PipelineStepKind = 'llm' | 'tool' | 'gate' | 'condition' | 'loop' | 'map' | 'sub_pipeline'
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

export interface PipelineLoopStep extends PipelineBaseStep {
  kind: 'loop'
  maxIterations: number
  exitCondition?: {
    operator: PipelineConditionOperator
    value?: string
  }
  bodyStepIds: string[]
}

export interface PipelineMapStep extends PipelineBaseStep {
  kind: 'map'
  sourceExpression: string
  maxConcurrency?: number
  bodyStepIds: string[]
  reduceObjective?: string
}

export interface PipelineSubPipelineStep extends PipelineBaseStep {
  kind: 'sub_pipeline'
  pipelineId: string
  pipelineVersion?: number
  inputMapping?: Record<string, string>
}

export type PipelineStep =
  | PipelineLlmStep
  | PipelineToolStep
  | PipelineGateStep
  | PipelineConditionStep
  | PipelineLoopStep
  | PipelineMapStep
  | PipelineSubPipelineStep

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

function collectBodyStepIds(steps: PipelineStep[]): Set<string> {
  const ids = new Set<string>()
  for (const step of steps) {
    if (step.kind === 'loop' || step.kind === 'map') {
      for (const id of step.bodyStepIds) {
        ids.add(id)
      }
    }
  }
  return ids
}

export function pipelineToTaskPlan(definition: PipelineDefinition, taskId: string): TaskPlan {
  const bodyStepIds = collectBodyStepIds(definition.steps)

  return {
    taskId,
    summary: definition.description?.trim() || `${definition.name} pipeline run`,
    steps: definition.steps
      .filter((step) => !bodyStepIds.has(step.id))
      .map((step) => {
        const base = {
          id: step.id,
          title: step.title,
          dependsOn: step.dependsOn ?? [],
          objective: step.objective,
        }
        switch (step.kind) {
          case 'llm':
            return {
              ...base,
              kind: 'agent' as const,
              assignee: step.assignee,
              expectedOutput: step.expectedOutput ?? 'Structured response for the next pipeline stage',
            }
          case 'tool':
            return {
              ...base,
              kind: 'tool' as const,
              assignee: 'pipeline-tool',
              expectedOutput: step.expectedOutput ?? `Tool output from ${step.toolName}`,
            }
          case 'gate':
            return {
              ...base,
              kind: 'gate' as const,
              assignee: 'human-approval',
              expectedOutput: 'Approval decision',
            }
          case 'condition':
            return {
              ...base,
              kind: 'condition' as const,
              assignee: 'pipeline-condition',
              expectedOutput: 'Condition evaluation result',
            }
          case 'loop':
            return {
              ...base,
              assignee: 'pipeline-loop',
              expectedOutput: `Loop result after up to ${step.maxIterations} iterations`,
            }
          case 'map':
            return {
              ...base,
              assignee: 'pipeline-map',
              expectedOutput: 'Map aggregation result',
            }
          case 'sub_pipeline':
            return {
              ...base,
              assignee: 'pipeline-sub',
              expectedOutput: 'Sub-pipeline result',
            }
        }
      }),
  }
}
