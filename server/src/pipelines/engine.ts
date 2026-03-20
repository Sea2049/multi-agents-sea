import { randomUUID } from 'node:crypto'
import { buildExecutionMessage } from '../orchestrator/execution-message.js'
import { summarizeStepOutput } from '../orchestrator/step-summarizer.js'
import type { StepResult, TaskExecutionEvent, TaskPlan } from '../orchestrator/types.js'
import type { LLMProvider, ToolCallRequest } from '../providers/types.js'
import { loadAgentSystemPrompt } from '../runtime/prompt-loader.js'
import type { RegistrySnapshot } from '../runtime/registry-snapshot.js'
import { runWithTools } from '../runtime/tool-executor.js'
import { executeTool, getToolDefinitions } from '../tools/index.js'
import {
  pipelineToTaskPlan,
  type PipelineConditionStep,
  type PipelineDefinition,
  type PipelineStep,
  type PipelineToolStep,
} from './types.js'

interface PipelineApprovalRequest {
  taskId: string
  stepId: string
  approve: boolean
}

interface PipelineRuntimeDefaults {
  provider?: string
  model?: string
}

export interface RunPipelineParams {
  taskId: string
  objective: string
  definition: PipelineDefinition
  snapshot: RegistrySnapshot
  providerFactory: (provider: string) => LLMProvider
  runtimeDefaults?: PipelineRuntimeDefaults
  onEvent: (event: TaskExecutionEvent) => void
  timeoutMs?: number
  maxConcurrent?: number
}

interface PipelineGateWaiter {
  resolve: (approved: boolean) => void
}

const gateWaiters = new Map<string, PipelineGateWaiter>()

function gateKey(taskId: string, stepId: string): string {
  return `${taskId}:${stepId}`
}

export function approvePipelineGate(request: PipelineApprovalRequest): boolean {
  const key = gateKey(request.taskId, request.stepId)
  const waiter = gateWaiters.get(key)
  if (!waiter) {
    return false
  }

  gateWaiters.delete(key)
  waiter.resolve(request.approve)
  return true
}

export function cancelPipelineTaskRuntime(taskId: string): void {
  const prefix = `${taskId}:`
  for (const [key, waiter] of gateWaiters.entries()) {
    if (!key.startsWith(prefix)) {
      continue
    }
    gateWaiters.delete(key)
    waiter.resolve(false)
  }
}

function getPipelineStepAssignee(step: PipelineStep): string {
  switch (step.kind) {
    case 'llm':
      return step.assignee
    case 'tool':
      return 'pipeline-tool'
    case 'gate':
      return 'human-approval'
    case 'condition':
      return 'pipeline-condition'
    default:
      return 'pipeline'
  }
}

function createSkippedResult(step: PipelineStep, reason: string): StepResult {
  const timestamp = Date.now()
  return {
    stepId: step.id,
    agentId: getPipelineStepAssignee(step),
    output: `Skipped: ${reason}`,
    summary: reason,
    startedAt: timestamp,
    completedAt: timestamp,
  }
}

function truncateSummary(text: string, maxLength = 200): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength - 1)}…`
}

function resolveRuntimeDefaults(
  definition: PipelineDefinition,
  runtimeDefaults?: PipelineRuntimeDefaults,
): PipelineRuntimeDefaults {
  return {
    provider: runtimeDefaults?.provider ?? definition.runtimeDefaults?.provider,
    model: runtimeDefaults?.model ?? definition.runtimeDefaults?.model,
  }
}

function renderTemplate(template: string, objective: string, completedResults: Map<string, StepResult>): string {
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, expression) => {
    const token = String(expression).trim()
    if (token === 'task.objective') {
      return objective
    }

    if (token.startsWith('steps.')) {
      const [, stepId, field] = token.split('.')
      const result = completedResults.get(stepId)
      if (!result) {
        return ''
      }

      switch (field) {
        case 'output':
          return result.output
        case 'summary':
          return result.summary ?? ''
        case 'error':
          return result.error ?? ''
        default:
          return ''
      }
    }

    return ''
  })
}

function parseToolInput(step: PipelineToolStep, objective: string, completedResults: Map<string, StepResult>): Record<string, unknown> {
  const rendered = renderTemplate(step.inputTemplate, objective, completedResults).trim()
  if (!rendered) {
    return {}
  }

  try {
    const parsed = JSON.parse(rendered) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Fall through to raw string mode.
  }

  return { input: rendered }
}

function evaluateCondition(step: PipelineConditionStep, completedResults: Map<string, StepResult>): boolean {
  const source = completedResults.get(step.sourceStepId)
  const sourceContent = (source?.summary || source?.output || '').trim()

  switch (step.operator) {
    case 'exists':
      return sourceContent.length > 0
    case 'contains':
      return sourceContent.includes(step.value ?? '')
    case 'equals':
      return sourceContent === (step.value ?? '')
    case 'not_contains':
      return !sourceContent.includes(step.value ?? '')
    default:
      return false
  }
}

async function runLlmStep(params: {
  taskId: string
  objective: string
  compiledStep: TaskPlan['steps'][number]
  pipelineStep: Extract<PipelineStep, { kind: 'llm' }>
  completedResults: Map<string, StepResult>
  snapshot: RegistrySnapshot
  providerFactory: (provider: string) => LLMProvider
  runtimeDefaults: PipelineRuntimeDefaults
  onEvent: (event: TaskExecutionEvent) => void
  timeoutMs: number
}): Promise<StepResult> {
  const {
    taskId,
    compiledStep,
    pipelineStep,
    completedResults,
    snapshot,
    providerFactory,
    runtimeDefaults,
    onEvent,
    timeoutMs,
  } = params

  const providerName = pipelineStep.provider ?? runtimeDefaults.provider
  const model = pipelineStep.model ?? runtimeDefaults.model
  if (!providerName || !model) {
    throw new Error(`LLM step "${pipelineStep.id}" is missing provider/model runtime defaults`)
  }

  const provider = providerFactory(providerName)
  let systemPrompt: string
  try {
    systemPrompt = loadAgentSystemPrompt(pipelineStep.assignee, snapshot)
  } catch {
    systemPrompt = `You are ${pipelineStep.assignee}. Complete the given task thoroughly and clearly.`
  }

  const { message, promptChars } = await buildExecutionMessage(compiledStep, completedResults)
  const startedAt = Date.now()
  const tools = getToolDefinitions(snapshot)

  const chatPromise = (async () => {
    const result = await runWithTools({
      provider,
      model,
      systemPrompt,
      initialMessages: [{ role: 'user', content: message }],
      tools,
      snapshot,
      onToolCallStarted: (toolCall) => {
        onEvent({
          type: 'tool_call_started',
          taskId,
          stepId: pipelineStep.id,
          agentId: pipelineStep.assignee,
          timestamp: Date.now(),
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          toolInput: toolCall.input,
        })
      },
      onToolCallCompleted: (toolCall, toolOutput, isError) => {
        onEvent({
          type: 'tool_call_completed',
          taskId,
          stepId: pipelineStep.id,
          agentId: pipelineStep.assignee,
          timestamp: Date.now(),
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          toolInput: toolCall.input,
          toolOutput,
          toolIsError: isError,
        })
      },
    })
    return result.finalText
  })()

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Pipeline step "${pipelineStep.id}" timed out after ${timeoutMs}ms`)), timeoutMs),
  )

  const output = await Promise.race([chatPromise, timeoutPromise])

  let summary: string | undefined
  try {
    summary = await summarizeStepOutput({
      provider,
      model,
      stepTitle: pipelineStep.title,
      rawOutput: output,
    })
    if (summary === output) {
      summary = undefined
    }
  } catch {
    summary = truncateSummary(output)
  }

  return {
    stepId: pipelineStep.id,
    agentId: pipelineStep.assignee,
    output,
    summary,
    promptChars,
    startedAt,
    completedAt: Date.now(),
  }
}

async function runToolStep(params: {
  taskId: string
  objective: string
  step: PipelineToolStep
  completedResults: Map<string, StepResult>
  snapshot: RegistrySnapshot
  onEvent: (event: TaskExecutionEvent) => void
}): Promise<StepResult> {
  const { taskId, objective, step, completedResults, snapshot, onEvent } = params
  const startedAt = Date.now()
  const toolCall: ToolCallRequest = {
    id: randomUUID(),
    name: step.toolName,
    input: parseToolInput(step, objective, completedResults),
  }

  onEvent({
    type: 'tool_call_started',
    taskId,
    stepId: step.id,
    agentId: 'pipeline-tool',
    timestamp: startedAt,
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    toolInput: toolCall.input,
  })

  const result = await executeTool(toolCall, snapshot)

  onEvent({
    type: 'tool_call_completed',
    taskId,
    stepId: step.id,
    agentId: 'pipeline-tool',
    timestamp: Date.now(),
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    toolInput: toolCall.input,
    toolOutput: result.output,
    toolIsError: result.isError,
  })

  if (result.isError) {
    throw new Error(result.output)
  }

  return {
    stepId: step.id,
    agentId: 'pipeline-tool',
    output: result.output,
    summary: truncateSummary(result.output),
    startedAt,
    completedAt: Date.now(),
  }
}

async function waitForGateApproval(taskId: string, stepId: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    gateWaiters.set(gateKey(taskId, stepId), { resolve })
  })
}

async function runGateStep(params: {
  taskId: string
  stepId: string
  instructions?: string
  onEvent: (event: TaskExecutionEvent) => void
}): Promise<StepResult> {
  const { taskId, stepId, instructions, onEvent } = params
  const startedAt = Date.now()

  onEvent({
    type: 'step_waiting',
    taskId,
    stepId,
    agentId: 'human-approval',
    output: instructions ?? 'Awaiting manual approval',
    timestamp: startedAt,
  })

  const approved = await waitForGateApproval(taskId, stepId)
  if (!approved) {
    throw new Error('Gate rejected by operator')
  }

  return {
    stepId,
    agentId: 'human-approval',
    output: 'Gate approved',
    summary: instructions ? truncateSummary(instructions) : 'Manual approval granted',
    startedAt,
    completedAt: Date.now(),
  }
}

function runConditionStep(
  step: PipelineConditionStep,
  completedResults: Map<string, StepResult>,
): { result: StepResult; excludedStepIds: string[] } {
  const matched = evaluateCondition(step, completedResults)
  const excludedStepIds = matched ? (step.onFalse ?? []) : (step.onTrue ?? [])
  const explanation = [
    `Condition on "${step.sourceStepId}" evaluated to ${matched ? 'true' : 'false'}.`,
    `Operator: ${step.operator}${step.value ? ` ${step.value}` : ''}`,
  ].join(' ')

  const timestamp = Date.now()
  return {
    result: {
      stepId: step.id,
      agentId: 'pipeline-condition',
      output: explanation,
      summary: explanation,
      startedAt: timestamp,
      completedAt: timestamp,
    },
    excludedStepIds,
  }
}

export async function runPipeline(params: RunPipelineParams): Promise<{
  plan: TaskPlan
  stepResults: Map<string, StepResult>
}> {
  const {
    taskId,
    objective,
    definition,
    snapshot,
    providerFactory,
    runtimeDefaults,
    onEvent,
    timeoutMs = 120_000,
    maxConcurrent = 2,
  } = params

  const plan = pipelineToTaskPlan(definition, taskId)
  const planStepMap = new Map(plan.steps.map((step) => [step.id, step]))
  const pipelineStepMap = new Map(definition.steps.map((step) => [step.id, step]))
  const dependents = new Map<string, string[]>()
  for (const step of definition.steps) {
    for (const depId of step.dependsOn ?? []) {
      const current = dependents.get(depId) ?? []
      current.push(step.id)
      dependents.set(depId, current)
    }
  }

  const resolvedDefaults = resolveRuntimeDefaults(definition, runtimeDefaults)
  const pendingSteps = new Set(definition.steps.map((step) => step.id))
  const runningSteps = new Set<string>()
  const waitingSteps = new Set<string>()
  const completedSteps = new Set<string>()
  const failedSteps = new Set<string>()
  const skippedSteps = new Set<string>()
  const stepResults = new Map<string, StepResult>()

  const markStepSkipped = (stepId: string, reason: string) => {
    if (!pendingSteps.has(stepId)) {
      return
    }

    pendingSteps.delete(stepId)
    skippedSteps.add(stepId)
    const step = pipelineStepMap.get(stepId)
    if (!step) {
      return
    }

    stepResults.set(stepId, createSkippedResult(step, reason))
    onEvent({
      type: 'step_skipped',
      taskId,
      stepId,
      agentId: getPipelineStepAssignee(step),
      output: reason,
      timestamp: Date.now(),
    })
  }

  const propagateSkippedBranches = () => {
    let changed = true
    while (changed) {
      changed = false
      for (const stepId of [...pendingSteps]) {
        const step = pipelineStepMap.get(stepId)
        if (!step) {
          continue
        }

        const deps = step.dependsOn ?? []
        if (deps.some((depId) => failedSteps.has(depId))) {
          markStepSkipped(stepId, 'Skipped because dependency failed')
          changed = true
          continue
        }

        if (deps.some((depId) => skippedSteps.has(depId))) {
          markStepSkipped(stepId, 'Skipped because branch was not selected')
          changed = true
        }
      }
    }
  }

  onEvent({ type: 'task_started', taskId, timestamp: Date.now() })

  return new Promise((resolve) => {
    let terminated = false

    const checkCompletion = () => {
      propagateSkippedBranches()
      if (terminated) {
        return
      }

      if (pendingSteps.size === 0 && runningSteps.size === 0 && waitingSteps.size === 0) {
        terminated = true
        resolve({ plan, stepResults })
      }
    }

    const scheduleNext = () => {
      propagateSkippedBranches()
      if (terminated) {
        return
      }

      const readySteps = [...pendingSteps]
        .map((stepId) => pipelineStepMap.get(stepId)!)
        .filter((step) => (step.dependsOn ?? []).every((depId) => completedSteps.has(depId)))
        .slice(0, Math.max(maxConcurrent - runningSteps.size, 0))

      if (readySteps.length === 0) {
        if (pendingSteps.size > 0 && runningSteps.size === 0 && waitingSteps.size === 0) {
          for (const pendingStepId of [...pendingSteps]) {
            pendingSteps.delete(pendingStepId)
            failedSteps.add(pendingStepId)
            const step = pipelineStepMap.get(pendingStepId)
            if (!step) {
              continue
            }
            const errorMessage = 'Pipeline is deadlocked because one or more dependencies can never be satisfied'
            stepResults.set(pendingStepId, {
              stepId: pendingStepId,
              agentId: getPipelineStepAssignee(step),
              output: '',
              startedAt: Date.now(),
              completedAt: Date.now(),
              error: errorMessage,
            })
            onEvent({
              type: 'step_failed',
              taskId,
              stepId: pendingStepId,
              agentId: getPipelineStepAssignee(step),
              error: errorMessage,
              timestamp: Date.now(),
            })
          }
        }
        checkCompletion()
        return
      }

      for (const step of readySteps) {
        const compiledStep = planStepMap.get(step.id)
        if (!compiledStep) {
          markStepSkipped(step.id, 'Compiled pipeline plan is missing this step')
          continue
        }

        pendingSteps.delete(step.id)
        runningSteps.add(step.id)
        onEvent({
          type: 'step_started',
          taskId,
          stepId: step.id,
          agentId: getPipelineStepAssignee(step),
          timestamp: Date.now(),
        })

        const runner = (async (): Promise<StepResult> => {
          switch (step.kind) {
            case 'llm':
              return runLlmStep({
                taskId,
                objective,
                compiledStep,
                pipelineStep: step,
                completedResults: stepResults,
                snapshot,
                providerFactory,
                runtimeDefaults: resolvedDefaults,
                onEvent,
                timeoutMs,
              })
            case 'tool':
              return runToolStep({
                taskId,
                objective,
                step,
                completedResults: stepResults,
                snapshot,
                onEvent,
              })
            case 'gate':
              waitingSteps.add(step.id)
              return runGateStep({
                taskId,
                stepId: step.id,
                instructions: step.instructions,
                onEvent,
              })
            case 'condition': {
              const outcome = runConditionStep(step, stepResults)
              for (const excludedStepId of outcome.excludedStepIds) {
                markStepSkipped(excludedStepId, `Condition "${step.id}" excluded this branch`)
              }
              return outcome.result
            }
            default:
              throw new Error(`Unsupported pipeline step kind: ${(step as PipelineStep).kind}`)
          }
        })()

        runner
          .then((result) => {
            runningSteps.delete(step.id)
            waitingSteps.delete(step.id)
            completedSteps.add(step.id)
            stepResults.set(step.id, result)
            onEvent({
              type: 'step_completed',
              taskId,
              stepId: step.id,
              agentId: getPipelineStepAssignee(step),
              output: result.output,
              timestamp: Date.now(),
            })
            scheduleNext()
          })
          .catch((error: unknown) => {
            runningSteps.delete(step.id)
            waitingSteps.delete(step.id)
            failedSteps.add(step.id)
            const errorMessage = error instanceof Error ? error.message : String(error)
            stepResults.set(step.id, {
              stepId: step.id,
              agentId: getPipelineStepAssignee(step),
              output: '',
              startedAt: Date.now(),
              completedAt: Date.now(),
              error: errorMessage,
            })
            onEvent({
              type: 'step_failed',
              taskId,
              stepId: step.id,
              agentId: getPipelineStepAssignee(step),
              error: errorMessage,
              timestamp: Date.now(),
            })
            scheduleNext()
          })
      }

      checkCompletion()
    }

    scheduleNext()
  })
}
