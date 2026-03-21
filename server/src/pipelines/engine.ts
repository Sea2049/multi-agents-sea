import { randomUUID } from 'node:crypto'
import { buildExecutionMessage } from '../orchestrator/execution-message.js'
import { summarizeStepOutput } from '../orchestrator/step-summarizer.js'
import type { StepResult, TaskExecutionEvent, TaskPlan } from '../orchestrator/types.js'
import type { LLMProvider, ToolCallRequest } from '../providers/types.js'
import { loadAgentSystemPrompt } from '../runtime/prompt-loader.js'
import type { RegistrySnapshot, SkillRoutingPolicy } from '../runtime/registry-snapshot.js'
import { deriveScopedSnapshot } from '../runtime/scoped-snapshot.js'
import { runWithTools } from '../runtime/tool-executor.js'
import { executeTool, getToolDefinitions } from '../tools/index.js'
import { getPipelineById } from './store.js'
import {
  pipelineToTaskPlan,
  type PipelineConditionOperator,
  type PipelineConditionStep,
  type PipelineDefinition,
  type PipelineLoopStep,
  type PipelineMapStep,
  type PipelineStep,
  type PipelineSubPipelineStep,
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
  skillRouting?: SkillRoutingPolicy
  providerFactory: (provider: string) => LLMProvider
  runtimeDefaults?: PipelineRuntimeDefaults
  onEvent: (event: TaskExecutionEvent) => void
  timeoutMs?: number
  maxConcurrent?: number
}

interface PipelineGateWaiter {
  resolve: (approved: boolean) => void
}

function parseToolIterationLimit(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(20, Math.max(1, parsed))
}

const PIPELINE_TOOL_MAX_ITERATIONS = parseToolIterationLimit(
  process.env.PIPELINE_TOOL_MAX_ITERATIONS,
  8,
)

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
    case 'loop':
      return 'pipeline-loop'
    case 'map':
      return 'pipeline-map'
    case 'sub_pipeline':
      return 'pipeline-sub'
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

function resolvePath(obj: unknown, path: string): string {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.')
  let current: unknown = obj
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return ''
    current = (current as Record<string, unknown>)[part]
  }
  return current != null ? String(current) : ''
}

interface RenderContext {
  mapItem?: unknown
  mapIndex?: number
}

function renderTemplate(
  template: string,
  objective: string,
  completedResults: Map<string, StepResult>,
  ctx?: RenderContext,
): string {
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, expression) => {
    const token = String(expression).trim()

    if (token === 'task.objective') {
      return objective
    }

    if (token === 'map.item') {
      const item = ctx?.mapItem
      if (item == null) return ''
      if (typeof item === 'string') return item
      return JSON.stringify(item)
    }

    if (token === 'map.index') {
      return ctx?.mapIndex != null ? String(ctx.mapIndex) : ''
    }

    if (token.startsWith('steps.')) {
      const remainder = token.slice('steps.'.length)
      const firstDot = remainder.indexOf('.')
      if (firstDot === -1) return ''
      const stepId = remainder.slice(0, firstDot)
      const fieldRemainder = remainder.slice(firstDot + 1)
      const secondDot = fieldRemainder.indexOf('.')
      const field = secondDot === -1 ? fieldRemainder : fieldRemainder.slice(0, secondDot)
      const subPath = secondDot === -1 ? '' : fieldRemainder.slice(secondDot + 1)

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
        case 'structuredOutput': {
          if (!subPath) return result.structuredOutput != null ? String(result.structuredOutput) : ''
          return resolvePath(result.structuredOutput, subPath)
        }
        default:
          return ''
      }
    }

    return ''
  })
}

function parseToolInput(
  step: PipelineToolStep,
  objective: string,
  completedResults: Map<string, StepResult>,
  ctx?: RenderContext,
): Record<string, unknown> {
  const rendered = renderTemplate(step.inputTemplate, objective, completedResults, ctx).trim()
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

function evaluateLoopExitCondition(
  condition: { operator: PipelineConditionOperator; value?: string },
  output: string,
): boolean {
  const text = output.trim()
  switch (condition.operator) {
    case 'exists':
      return text.length > 0
    case 'contains':
      return text.includes(condition.value ?? '')
    case 'equals':
      return text === (condition.value ?? '')
    case 'not_contains':
      return !text.includes(condition.value ?? '')
    default:
      return false
  }
}

function preRenderMapTokens(template: string, item: unknown, index: number): string {
  const itemStr = item != null ? (typeof item === 'string' ? item : JSON.stringify(item)) : ''
  const indexStr = String(index)
  return template.replace(/\{\{\s*map\.item\s*\}\}/g, itemStr).replace(/\{\{\s*map\.index\s*\}\}/g, indexStr)
}

async function runLlmStep(params: {
  taskId: string
  objective: string
  compiledStep: TaskPlan['steps'][number]
  pipelineStep: Extract<PipelineStep, { kind: 'llm' }>
  completedResults: Map<string, StepResult>
  snapshot: RegistrySnapshot
  skillRouting?: SkillRoutingPolicy
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
    skillRouting,
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
  const scopedSnapshot = deriveScopedSnapshot(snapshot, pipelineStep.assignee, skillRouting)
  let systemPrompt: string
  try {
    systemPrompt = loadAgentSystemPrompt(pipelineStep.assignee, scopedSnapshot, {
      referenceQuery: compiledStep.objective,
    })
  } catch {
    systemPrompt = `You are ${pipelineStep.assignee}. Complete the given task thoroughly and clearly.`
  }

  const { message, promptChars } = await buildExecutionMessage(compiledStep, completedResults)
  const startedAt = Date.now()
  const tools = getToolDefinitions(scopedSnapshot)

  const chatPromise = (async () => {
    const result = await runWithTools({
      provider,
      model,
      systemPrompt,
      initialMessages: [{ role: 'user', content: message }],
      tools,
      snapshot: scopedSnapshot,
      maxIterations: PIPELINE_TOOL_MAX_ITERATIONS,
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
  renderCtx?: RenderContext
}): Promise<StepResult> {
  const { taskId, objective, step, completedResults, snapshot, onEvent, renderCtx } = params
  const startedAt = Date.now()
  const toolCall: ToolCallRequest = {
    id: randomUUID(),
    name: step.toolName,
    input: parseToolInput(step, objective, completedResults, renderCtx),
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

function parseMapSourceExpression(expression: string, stepResults: Map<string, StepResult>): unknown[] {
  const token = expression.trim()
  if (!token.startsWith('steps.')) return []

  const remainder = token.slice('steps.'.length)
  const firstDot = remainder.indexOf('.')
  if (firstDot === -1) return []

  const stepId = remainder.slice(0, firstDot)
  const fieldRemainder = remainder.slice(firstDot + 1)
  const secondDot = fieldRemainder.indexOf('.')
  const field = secondDot === -1 ? fieldRemainder : fieldRemainder.slice(0, secondDot)
  const subPath = secondDot === -1 ? '' : fieldRemainder.slice(secondDot + 1)

  const result = stepResults.get(stepId)
  if (!result) return []

  let value: unknown
  switch (field) {
    case 'output': {
      try {
        value = JSON.parse(result.output)
      } catch {
        value = result.output.split('\n').filter(Boolean)
      }
      break
    }
    case 'structuredOutput': {
      value = subPath ? resolvePath(result.structuredOutput, subPath) : result.structuredOutput
      break
    }
    default:
      return []
  }

  return Array.isArray(value) ? value : []
}

// ─── Expander map state ─────────────────────────────────────────────────────

interface MapRunState {
  mapStep: PipelineMapStep
  items: unknown[]
  nextIndex: number
  activeGroups: number
  completedGroups: number
  itemOutputs: (unknown | undefined)[]
  exitSyntheticIds: Map<number, Set<string>>
  pendingInGroup: Map<number, number>
  settled: boolean
  startedAt: number
  resolve: (r: StepResult) => void
  reject: (e: Error) => void
}

// ─── runPipeline ─────────────────────────────────────────────────────────────

export async function runPipeline(params: RunPipelineParams): Promise<{
  plan: TaskPlan
  stepResults: Map<string, StepResult>
}> {
  const {
    taskId,
    objective,
    definition,
    snapshot,
    skillRouting,
    providerFactory,
    runtimeDefaults,
    onEvent,
    timeoutMs = 120_000,
    maxConcurrent = 2,
  } = params

  const plan = pipelineToTaskPlan(definition, taskId)
  const planStepMap = new Map(plan.steps.map((step) => [step.id, step]))
  const pipelineStepMap = new Map(definition.steps.map((step) => [step.id, step]))
  const originalPipelineStepMap = new Map(definition.steps.map((step) => [step.id, step]))

  // Build dependency mapping (not used by scheduler directly but kept for potential future use)
  const dependents = new Map<string, string[]>()
  for (const step of definition.steps) {
    for (const depId of step.dependsOn ?? []) {
      const current = dependents.get(depId) ?? []
      current.push(step.id)
      dependents.set(depId, current)
    }
  }

  const resolvedDefaults = resolveRuntimeDefaults(definition, runtimeDefaults)

  // Exclude body steps from initial pending set; they run only as synthetic copies.
  const bodyStepIdSet = new Set<string>()
  for (const step of definition.steps) {
    if (step.kind === 'loop' || step.kind === 'map') {
      for (const id of step.bodyStepIds) {
        bodyStepIdSet.add(id)
      }
    }
  }

  const pendingSteps = new Set(
    definition.steps.filter((step) => !bodyStepIdSet.has(step.id)).map((step) => step.id),
  )
  const runningSteps = new Set<string>()
  const waitingSteps = new Set<string>()
  const completedSteps = new Set<string>()
  const failedSteps = new Set<string>()
  const skippedSteps = new Set<string>()
  const stepResults = new Map<string, StepResult>()

  // ─── Expander state ──────────────────────────────────────────────────────

  const syntheticOwners = new Map<string, string>()

  // Loop state
  const loopIterCount = new Map<string, number>()
  const loopCurrentBodyIds = new Map<string, Set<string>>()
  const loopPendingBodyCount = new Map<string, number>()
  const loopResolvers = new Map<string, { resolve: (r: StepResult) => void; reject: (e: Error) => void }>()

  // Map state
  const mapRunStates = new Map<string, MapRunState>()

  // Sub-pipeline state
  const subPipelinePendingCount = new Map<string, number>()
  const subPipelineResolvers = new Map<string, { resolve: (r: StepResult) => void; reject: (e: Error) => void }>()
  const subPipelineLeafIds = new Map<string, Set<string>>()

  // ─── Expander helpers ─────────────────────────────────────────────────────

  function makePlanStep(step: PipelineStep): TaskPlan['steps'][number] {
    const kind =
      step.kind === 'llm'
        ? ('agent' as const)
        : step.kind === 'tool'
          ? ('tool' as const)
          : step.kind === 'gate'
            ? ('gate' as const)
            : step.kind === 'condition'
              ? ('condition' as const)
              : undefined

    const expectedOutput =
      step.kind === 'llm'
        ? (step.expectedOutput ?? 'Step output')
        : step.kind === 'tool'
          ? (step.expectedOutput ?? `Tool output from ${step.toolName}`)
          : step.kind === 'gate'
            ? 'Approval decision'
            : step.kind === 'condition'
              ? 'Condition evaluation result'
              : 'Step output'

    return {
      id: step.id,
      title: step.title,
      kind,
      assignee: getPipelineStepAssignee(step),
      dependsOn: step.dependsOn ?? [],
      objective: step.objective,
      expectedOutput,
    }
  }

  function cloneStep(step: PipelineStep, newId: string, newDeps: string[]): PipelineStep {
    switch (step.kind) {
      case 'llm':
        return { ...step, id: newId, dependsOn: newDeps }
      case 'tool':
        return { ...step, id: newId, dependsOn: newDeps }
      case 'gate':
        return { ...step, id: newId, dependsOn: newDeps }
      case 'condition':
        return { ...step, id: newId, dependsOn: newDeps }
      case 'loop':
        return { ...step, id: newId, dependsOn: newDeps }
      case 'map':
        return { ...step, id: newId, dependsOn: newDeps }
      case 'sub_pipeline':
        return { ...step, id: newId, dependsOn: newDeps }
    }
  }

  function addSyntheticStep(original: PipelineStep, syntheticId: string, newDeps: string[], ownerId: string): void {
    const syntheticStep = cloneStep(original, syntheticId, newDeps)
    pipelineStepMap.set(syntheticId, syntheticStep)
    planStepMap.set(syntheticId, makePlanStep(syntheticStep))
    pendingSteps.add(syntheticId)
    syntheticOwners.set(syntheticId, ownerId)
  }

  function getExitBodyStepIds(bodyStepIds: string[]): string[] {
    return bodyStepIds.filter(
      (id) =>
        !bodyStepIds.some((otherId) => {
          const other = originalPipelineStepMap.get(otherId)
          return (other?.dependsOn ?? []).includes(id)
        }),
    )
  }

  // ── Loop expander ─────────────────────────────────────────────────────────

  function expandLoopIteration(loopStep: PipelineLoopStep, iteration: number): void {
    const bodySet = new Set(loopStep.bodyStepIds)
    const prevExitSyntheticIds =
      iteration > 0 ? getExitBodyStepIds(loopStep.bodyStepIds).map((id) => `${id}_iter_${iteration - 1}`) : []

    const newBodyIds = new Set<string>()

    for (const bodyStepId of loopStep.bodyStepIds) {
      const original = originalPipelineStepMap.get(bodyStepId)
      if (!original) continue

      const syntheticId = `${bodyStepId}_iter_${iteration}`
      const newDeps: string[] = []
      let isEntry = true

      for (const dep of original.dependsOn ?? []) {
        if (bodySet.has(dep)) {
          newDeps.push(`${dep}_iter_${iteration}`)
          isEntry = false
        } else {
          newDeps.push(dep)
        }
      }

      if (isEntry && iteration > 0) {
        newDeps.push(...prevExitSyntheticIds)
      }

      addSyntheticStep(original, syntheticId, newDeps, loopStep.id)
      newBodyIds.add(syntheticId)
    }

    loopCurrentBodyIds.set(loopStep.id, newBodyIds)
    loopPendingBodyCount.set(loopStep.id, newBodyIds.size)
  }

  function handleLoopBodyDone(loopStepId: string, syntheticId: string, isError: boolean): void {
    const currentBodyIds = loopCurrentBodyIds.get(loopStepId)
    if (!currentBodyIds?.has(syntheticId)) return

    const resolver = loopResolvers.get(loopStepId)
    if (!resolver) return

    if (isError) {
      loopResolvers.delete(loopStepId)
      resolver.reject(new Error(`Loop body step "${syntheticId}" failed`))
      return
    }

    const newCount = (loopPendingBodyCount.get(loopStepId) ?? 0) - 1
    loopPendingBodyCount.set(loopStepId, newCount)
    if (newCount > 0) return

    // All body steps for this iteration done — evaluate exit condition
    const loopStep = originalPipelineStepMap.get(loopStepId) as PipelineLoopStep
    if (!loopStep) return

    const iteration = loopIterCount.get(loopStepId) ?? 0
    const exitIds = getExitBodyStepIds(loopStep.bodyStepIds).map((id) => `${id}_iter_${iteration}`)
    const lastOutput = exitIds.length > 0 ? (stepResults.get(exitIds[0])?.output ?? '') : ''

    let shouldExit = false
    if (loopStep.exitCondition) {
      shouldExit = evaluateLoopExitCondition(loopStep.exitCondition, lastOutput)
    }

    const nextIteration = iteration + 1
    if (!shouldExit && nextIteration < loopStep.maxIterations) {
      loopIterCount.set(loopStepId, nextIteration)
      expandLoopIteration(loopStep, nextIteration)
      // scheduleNext will be invoked by the .then() handler of the completed synthetic step
    } else {
      loopResolvers.delete(loopStepId)
      const ts = Date.now()
      resolver.resolve({
        stepId: loopStepId,
        agentId: 'pipeline-loop',
        output: lastOutput,
        summary: `Loop completed after ${iteration + 1} iteration(s)`,
        startedAt: ts,
        completedAt: ts,
      })
    }
  }

  // ── Map expander ──────────────────────────────────────────────────────────

  function expandMapItem(mapStep: PipelineMapStep, itemIndex: number, state: MapRunState): void {
    const bodySet = new Set(mapStep.bodyStepIds)
    const item = state.items[itemIndex]
    const exitBodyStepIds = new Set(getExitBodyStepIds(mapStep.bodyStepIds))

    const exitIds = new Set<string>()
    let bodyStepCount = 0

    for (const bodyStepId of mapStep.bodyStepIds) {
      const original = originalPipelineStepMap.get(bodyStepId)
      if (!original) continue

      const syntheticId = `${bodyStepId}_item_${itemIndex}`
      const newDeps: string[] = (original.dependsOn ?? []).map((dep) =>
        bodySet.has(dep) ? `${dep}_item_${itemIndex}` : dep,
      )

      // Pre-render {{ map.item }} / {{ map.index }} tokens so that LLM/tool body steps see the correct value
      let syntheticStep: PipelineStep
      if (original.kind === 'tool') {
        syntheticStep = {
          ...original,
          id: syntheticId,
          dependsOn: newDeps,
          objective: preRenderMapTokens(original.objective, item, itemIndex),
          inputTemplate: preRenderMapTokens(original.inputTemplate, item, itemIndex),
        }
      } else {
        const updated = { ...original, objective: preRenderMapTokens(original.objective, item, itemIndex) }
        syntheticStep = cloneStep(updated as PipelineStep, syntheticId, newDeps)
      }

      pipelineStepMap.set(syntheticId, syntheticStep)
      planStepMap.set(syntheticId, makePlanStep(syntheticStep))
      pendingSteps.add(syntheticId)
      syntheticOwners.set(syntheticId, mapStep.id)

      if (exitBodyStepIds.has(bodyStepId)) {
        exitIds.add(syntheticId)
      }
      bodyStepCount++
    }

    state.exitSyntheticIds.set(itemIndex, exitIds)
    state.pendingInGroup.set(itemIndex, bodyStepCount)
  }

  function handleMapBodyDone(mapStepId: string, syntheticId: string, isError: boolean): void {
    const state = mapRunStates.get(mapStepId)
    if (!state || state.settled) return

    if (isError) {
      state.settled = true
      state.reject(new Error(`Map body step "${syntheticId}" failed`))
      return
    }

    // Look up which item index this synthetic step belongs to
    // The syntheticId pattern is `{bodyStepId}_item_{index}`
    const itemIndexMatch = /_item_(\d+)$/.exec(syntheticId)
    if (!itemIndexMatch) return
    const itemIndex = parseInt(itemIndexMatch[1], 10)

    const pendingCount = (state.pendingInGroup.get(itemIndex) ?? 0) - 1
    state.pendingInGroup.set(itemIndex, pendingCount)
    if (pendingCount > 0) return

    // Item group fully done
    const exitIds = state.exitSyntheticIds.get(itemIndex) ?? new Set()
    const outputs: unknown[] = []
    for (const exitId of exitIds) {
      const result = stepResults.get(exitId)
      if (result) {
        outputs.push(result.structuredOutput ?? result.output)
      }
    }
    state.itemOutputs[itemIndex] = outputs.length === 1 ? outputs[0] : outputs

    state.completedGroups++
    state.activeGroups--

    // Expand next item if within concurrency limit
    if (state.nextIndex < state.items.length) {
      const nextIdx = state.nextIndex++
      state.activeGroups++
      expandMapItem(state.mapStep, nextIdx, state)
    }

    if (state.completedGroups >= state.items.length) {
      state.settled = true
      const ts = Date.now()
      const aggregated = state.itemOutputs.filter((o) => o !== undefined)
      state.resolve({
        stepId: mapStepId,
        agentId: 'pipeline-map',
        output: JSON.stringify(aggregated),
        summary: `Map over ${state.items.length} items completed`,
        startedAt: state.startedAt,
        completedAt: ts,
        structuredOutput: aggregated,
      })
    }
  }

  // ── Sub-pipeline expander ─────────────────────────────────────────────────

  function expandSubPipeline(step: PipelineSubPipelineStep, childDef: PipelineDefinition): void {
    const prefix = `${step.id}__`
    const childStepIds = new Set(childDef.steps.map((s) => s.id))

    // Leaf steps: child steps that no other child step depends on
    const leafIds = new Set(
      childDef.steps
        .filter((s) => !childDef.steps.some((other) => (other.dependsOn ?? []).includes(s.id)))
        .map((s) => `${prefix}${s.id}`),
    )
    subPipelineLeafIds.set(step.id, leafIds)

    // Apply input mapping: pre-populate step results so child steps can access parent vars
    if (step.inputMapping) {
      for (const [parentVar, childInput] of Object.entries(step.inputMapping)) {
        const parentResult = stepResults.get(parentVar)
        if (parentResult) {
          stepResults.set(`${prefix}${childInput}`, parentResult)
        }
      }
    }

    let count = 0
    for (const childStep of childDef.steps) {
      const syntheticId = `${prefix}${childStep.id}`
      const newDeps = (childStep.dependsOn ?? []).map((dep) => (childStepIds.has(dep) ? `${prefix}${dep}` : dep))

      // Entry steps (no deps within the child graph) also inherit the sub_pipeline step's dependencies
      const hasChildDeps = (childStep.dependsOn ?? []).some((dep) => childStepIds.has(dep))
      if (!hasChildDeps) {
        newDeps.push(...(step.dependsOn ?? []))
      }

      addSyntheticStep(childStep, syntheticId, newDeps, step.id)
      count++
    }

    subPipelinePendingCount.set(step.id, count)
  }

  function handleSubPipelineStepDone(subStepId: string, syntheticId: string, isError: boolean): void {
    const count = (subPipelinePendingCount.get(subStepId) ?? 0) - 1
    subPipelinePendingCount.set(subStepId, count)

    const resolver = subPipelineResolvers.get(subStepId)
    if (!resolver) return

    if (isError) {
      subPipelineResolvers.delete(subStepId)
      resolver.reject(new Error(`Sub-pipeline child step "${syntheticId}" failed`))
      return
    }

    if (count > 0) return

    subPipelineResolvers.delete(subStepId)
    const leafIds = subPipelineLeafIds.get(subStepId) ?? new Set()
    const outputs: string[] = []
    for (const leafId of leafIds) {
      const result = stepResults.get(leafId)
      if (result) outputs.push(result.output)
    }

    const ts = Date.now()
    resolver.resolve({
      stepId: subStepId,
      agentId: 'pipeline-sub',
      output: outputs.join('\n\n'),
      summary: `Sub-pipeline ${subStepId} completed`,
      startedAt: ts,
      completedAt: ts,
    })
  }

  function notifyExpanderOwner(syntheticStepId: string, isError: boolean): void {
    const ownerId = syntheticOwners.get(syntheticStepId)
    if (!ownerId) return

    const ownerStep = pipelineStepMap.get(ownerId)
    if (!ownerStep) return

    switch (ownerStep.kind) {
      case 'loop':
        handleLoopBodyDone(ownerId, syntheticStepId, isError)
        break
      case 'map':
        handleMapBodyDone(ownerId, syntheticStepId, isError)
        break
      case 'sub_pipeline':
        handleSubPipelineStepDone(ownerId, syntheticStepId, isError)
        break
      default:
        break
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

      // Notify the expander owner if this is a synthetic step being skipped
      notifyExpanderOwner(stepId, true)
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
        if (!compiledStep && step.kind === 'llm') {
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
                compiledStep: compiledStep!,
                pipelineStep: step,
                completedResults: stepResults,
                snapshot,
                skillRouting,
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
            case 'loop': {
              const loopStep = step as PipelineLoopStep
              return new Promise<StepResult>((res, rej) => {
                loopResolvers.set(loopStep.id, { resolve: res, reject: rej })
                loopIterCount.set(loopStep.id, 0)
                expandLoopIteration(loopStep, 0)
              })
            }
            case 'map': {
              const mapStep = step as PipelineMapStep
              return new Promise<StepResult>((res, rej) => {
                const items = parseMapSourceExpression(mapStep.sourceExpression, stepResults)
                const ts = Date.now()
                if (items.length === 0) {
                  res({
                    stepId: mapStep.id,
                    agentId: 'pipeline-map',
                    output: '[]',
                    summary: 'Map over empty array',
                    startedAt: ts,
                    completedAt: ts,
                    structuredOutput: [],
                  })
                  return
                }
                const maxConcurrencyMap = mapStep.maxConcurrency ?? 3
                const state: MapRunState = {
                  mapStep,
                  items,
                  nextIndex: 0,
                  activeGroups: 0,
                  completedGroups: 0,
                  itemOutputs: new Array(items.length).fill(undefined) as (unknown | undefined)[],
                  exitSyntheticIds: new Map(),
                  pendingInGroup: new Map(),
                  settled: false,
                  startedAt: ts,
                  resolve: res,
                  reject: rej,
                }
                mapRunStates.set(mapStep.id, state)

                const initialBatch = Math.min(maxConcurrencyMap, items.length)
                for (let i = 0; i < initialBatch; i++) {
                  state.nextIndex = i + 1
                  state.activeGroups++
                  expandMapItem(mapStep, i, state)
                }
              })
            }
            case 'sub_pipeline': {
              const subStep = step as PipelineSubPipelineStep
              return new Promise<StepResult>((res, rej) => {
                const childRecord = getPipelineById(subStep.pipelineId)
                if (!childRecord) {
                  rej(new Error(`Sub-pipeline not found: ${subStep.pipelineId}`))
                  return
                }
                if (subStep.pipelineVersion !== undefined && childRecord.version !== subStep.pipelineVersion) {
                  rej(
                    new Error(
                      `Sub-pipeline version mismatch: expected ${subStep.pipelineVersion}, got ${childRecord.version}`,
                    ),
                  )
                  return
                }
                subPipelineResolvers.set(subStep.id, { resolve: res, reject: rej })

                if (childRecord.definition.steps.length === 0) {
                  subPipelineResolvers.delete(subStep.id)
                  const ts = Date.now()
                  res({ stepId: subStep.id, agentId: 'pipeline-sub', output: '', summary: 'Empty sub-pipeline', startedAt: ts, completedAt: ts })
                  return
                }
                expandSubPipeline(subStep, childRecord.definition)
              })
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
            notifyExpanderOwner(step.id, false)
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

            // Cancel any still-pending synthetic steps owned by this expander step
            if (step.kind === 'loop' || step.kind === 'map' || step.kind === 'sub_pipeline') {
              for (const [syntheticId, ownerId] of syntheticOwners.entries()) {
                if (ownerId === step.id && pendingSteps.has(syntheticId)) {
                  markStepSkipped(syntheticId, `Owner step "${step.id}" failed`)
                }
              }
            }

            notifyExpanderOwner(step.id, true)
            scheduleNext()
          })
      }

      // Recurse to pick up newly added synthetic steps or fill remaining concurrency slots
      scheduleNext()
    }

    scheduleNext()
  })
}
