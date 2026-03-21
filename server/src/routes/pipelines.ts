import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { aggregateResults } from '../orchestrator/aggregator.js'
import type { StepResult, TaskExecutionEvent, TaskStatus } from '../orchestrator/types.js'
import { persistTaskLongTermMemories } from '../memory/task-memory-extractor.js'
import { getRuntimeProviderFromEnv, isProviderName } from '../providers/index.js'
import { runPipeline, approvePipelineGate } from '../pipelines/engine.js'
import { createPipeline, deletePipeline, getPipelineById, listPipelines, updatePipeline } from '../pipelines/store.js'
import { pipelineToTaskPlan, type PipelineDefinition, type PipelineStep } from '../pipelines/types.js'
import { createRegistrySnapshot } from '../runtime/registry-snapshot-builder.js'
import { serializeRegistrySnapshot } from '../runtime/registry-snapshot.js'
import {
  broadcastTaskEvent,
  clearTaskSseSubscribers,
  persistTaskExecutionEvent,
  updateTaskStatus,
  updateTaskStepSummary,
  upsertTaskStep,
} from '../tasks/runtime-store.js'
import { getDb } from '../storage/db.js'

interface PipelineBody {
  name: string
  description?: string
  runtimeDefaults?: {
    provider?: string
    model?: string
  }
  steps: PipelineStep[]
}

interface RunPipelineBody {
  objective?: string
  provider?: string
  model?: string
}

interface TaskRowExists {
  id: string
  kind: string
}

interface GateStepRow {
  status: string
  objective: string
}

function failOrphanedGate(taskId: string, stepId: string, gateRow: GateStepRow | undefined): string {
  const errorMessage =
    'Gate approval channel is no longer available. The pipeline runtime was likely restarted or cancelled; please rerun the pipeline.'
  const timestamp = Date.now()

  upsertTaskStep({
    taskId,
    stepId,
    agentId: 'human-approval',
    objective: gateRow?.objective ?? '',
    status: 'failed',
    error: errorMessage,
    completedAt: timestamp,
  })
  updateTaskStatus(taskId, 'failed', { error: errorMessage })
  broadcastTaskEvent(taskId, {
    type: 'step_failed',
    taskId,
    stepId,
    agentId: 'human-approval',
    error: errorMessage,
    timestamp,
  })
  broadcastTaskEvent(taskId, {
    type: 'task_failed',
    taskId,
    error: errorMessage,
    timestamp,
  })

  return errorMessage
}

function buildFallbackReport(objective: string, stepResults: Map<string, StepResult>): string {
  const lines = [
    '# Pipeline Report',
    '',
    `**Objective:** ${objective}`,
    '',
    '## Step Results',
  ]

  for (const result of stepResults.values()) {
    lines.push('', `### ${result.stepId}`, result.summary ?? result.output ?? '(empty output)')
    if (result.error) {
      lines.push(`Error: ${result.error}`)
    }
  }

  return lines.join('\n')
}

function detectPipelineCycle(steps: PipelineStep[]): string | null {
  const adjacency = new Map<string, string[]>()
  for (const step of steps) {
    adjacency.set(step.id, step.dependsOn ?? [])
  }

  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const colors = new Map<string, number>()
  for (const step of steps) {
    colors.set(step.id, WHITE)
  }

  function dfs(stepId: string): string | null {
    colors.set(stepId, GRAY)
    for (const depId of adjacency.get(stepId) ?? []) {
      const state = colors.get(depId)
      if (state === GRAY) {
        return depId
      }
      if (state === WHITE) {
        const cycle = dfs(depId)
        if (cycle) {
          return cycle
        }
      }
    }
    colors.set(stepId, BLACK)
    return null
  }

  for (const step of steps) {
    if (colors.get(step.id) === WHITE) {
      const cycle = dfs(step.id)
      if (cycle) {
        return cycle
      }
    }
  }

  return null
}

function validatePipelineDefinition(body: PipelineBody): string[] {
  const errors: string[] = []
  if (!body.name?.trim()) {
    errors.push('name is required')
  }
  if (!Array.isArray(body.steps) || body.steps.length === 0) {
    errors.push('steps must be a non-empty array')
    return errors
  }

  const stepIds = new Set<string>()
  for (const step of body.steps) {
    if (!step.id?.trim()) {
      errors.push('each step requires a non-empty id')
      continue
    }
    if (stepIds.has(step.id)) {
      errors.push(`duplicate step id: ${step.id}`)
    }
    stepIds.add(step.id)
  }

  const stepMap = new Map(body.steps.map((step) => [step.id, step] as const))

  const cycleNode = detectPipelineCycle(body.steps)
  if (cycleNode) {
    errors.push(`circular dependency detected involving step "${cycleNode}"`)
  }

  for (const step of body.steps) {
    if (!step.title?.trim()) {
      errors.push(`step "${step.id}" is missing title`)
    }
    if (!step.objective?.trim()) {
      errors.push(`step "${step.id}" is missing objective`)
    }
    for (const depId of step.dependsOn ?? []) {
      if (!stepMap.has(depId)) {
        errors.push(`step "${step.id}" depends on unknown step "${depId}"`)
      }
    }

    switch (step.kind) {
      case 'llm':
        if (!step.assignee?.trim()) {
          errors.push(`llm step "${step.id}" is missing assignee`)
        }
        if (step.provider && !isProviderName(step.provider)) {
          errors.push(`llm step "${step.id}" uses unknown provider "${step.provider}"`)
        }
        break
      case 'tool':
        if (!step.toolName?.trim()) {
          errors.push(`tool step "${step.id}" is missing toolName`)
        }
        if (!step.inputTemplate?.trim()) {
          errors.push(`tool step "${step.id}" is missing inputTemplate`)
        }
        break
      case 'gate':
        break
      case 'condition':
        if (!stepMap.has(step.sourceStepId)) {
          errors.push(`condition step "${step.id}" references unknown sourceStepId "${step.sourceStepId}"`)
        }
        if (!(step.dependsOn ?? []).includes(step.sourceStepId)) {
          errors.push(`condition step "${step.id}" must depend on sourceStepId "${step.sourceStepId}"`)
        }
        // eslint-disable-next-line no-case-declarations
        const branchTargets = [...(step.onTrue ?? []), ...(step.onFalse ?? [])]
        if (branchTargets.length === 0) {
          errors.push(`condition step "${step.id}" must declare at least one branch target`)
        }
        for (const targetId of branchTargets) {
          if (!stepMap.has(targetId)) {
            errors.push(`condition step "${step.id}" references unknown branch target "${targetId}"`)
            continue
          }
          if (!(stepMap.get(targetId)?.dependsOn ?? []).includes(step.id)) {
            errors.push(`branch target "${targetId}" must explicitly depend on condition step "${step.id}"`)
          }
        }
        break
      case 'loop': {
        if (!step.bodyStepIds?.length) {
          errors.push(`loop step "${step.id}" is missing bodyStepIds`)
        } else {
          for (const bsId of step.bodyStepIds) {
            if (!stepMap.has(bsId)) {
              errors.push(`loop step "${step.id}" references unknown body step "${bsId}"`)
            }
          }
        }
        if (!step.maxIterations || step.maxIterations < 1) {
          errors.push(`loop step "${step.id}" has invalid maxIterations (must be >= 1)`)
        }
        break
      }
      case 'map': {
        if (!step.sourceExpression?.trim()) {
          errors.push(`map step "${step.id}" is missing sourceExpression`)
        }
        if (!step.bodyStepIds?.length) {
          errors.push(`map step "${step.id}" is missing bodyStepIds`)
        } else {
          for (const bsId of step.bodyStepIds) {
            if (!stepMap.has(bsId)) {
              errors.push(`map step "${step.id}" references unknown body step "${bsId}"`)
            }
          }
        }
        break
      }
      case 'sub_pipeline': {
        if (!step.pipelineId?.trim()) {
          errors.push(`sub_pipeline step "${step.id}" is missing pipelineId`)
        }
        break
      }
      default:
        errors.push(`unsupported step kind: ${(step as PipelineStep).kind}`)
    }
  }

  if (body.runtimeDefaults?.provider && !isProviderName(body.runtimeDefaults.provider)) {
    errors.push(`unknown runtimeDefaults.provider "${body.runtimeDefaults.provider}"`)
  }

  return errors
}

async function detectSubPipelineCycles(
  pipelineId: string,
  definition: PipelineBody,
  maxDepth = 10,
  visited: Set<string> = new Set(),
): Promise<string | null> {
  if (visited.has(pipelineId)) {
    return pipelineId
  }
  if (visited.size >= maxDepth) {
    return null
  }
  visited.add(pipelineId)

  for (const step of definition.steps) {
    if ((step as PipelineStep).kind === 'sub_pipeline') {
      const subStep = step as Extract<PipelineStep, { kind: 'sub_pipeline' }>
      if (!subStep.pipelineId?.trim()) continue

      const child = getPipelineById(subStep.pipelineId)
      if (!child) continue

      const cycleId = await detectSubPipelineCycles(
        subStep.pipelineId,
        { name: child.definition.name, steps: child.definition.steps } as PipelineBody,
        maxDepth,
        new Set(visited),
      )
      if (cycleId) return cycleId
    }
  }

  return null
}

function resolveAggregatorConfig(
  definition: PipelineDefinition,
  runtimeDefaults?: { provider?: string; model?: string },
): { provider?: string; model?: string } {
  if (runtimeDefaults?.provider && runtimeDefaults?.model) {
    return runtimeDefaults
  }

  if (definition.runtimeDefaults?.provider && definition.runtimeDefaults?.model) {
    return definition.runtimeDefaults
  }

  const firstLlmStep = definition.steps.find((step): step is Extract<PipelineStep, { kind: 'llm' }> => step.kind === 'llm')
  return {
    provider: runtimeDefaults?.provider ?? definition.runtimeDefaults?.provider ?? firstLlmStep?.provider,
    model: runtimeDefaults?.model ?? definition.runtimeDefaults?.model ?? firstLlmStep?.model,
  }
}

async function runPipelineTask(params: {
  taskId: string
  objective: string
  definition: PipelineDefinition
  snapshot: ReturnType<typeof createRegistrySnapshot>
  runtimeDefaults?: { provider?: string; model?: string }
}): Promise<void> {
  const { taskId, objective, definition, runtimeDefaults, snapshot } = params
  const plan = pipelineToTaskPlan(definition, taskId)

  updateTaskStatus(taskId, 'running', { plan: JSON.stringify(plan) })
  for (const step of plan.steps) {
    upsertTaskStep({
      taskId,
      stepId: step.id,
      agentId: step.assignee,
      objective: step.objective,
      status: 'pending',
    })
  }

  try {
    const { stepResults } = await runPipeline({
      taskId,
      objective,
      definition,
      snapshot,
      runtimeDefaults,
      providerFactory: (providerName) => getRuntimeProviderFromEnv(providerName),
      onEvent: (event) => {
        if (event.type !== 'task_completed' && event.type !== 'task_failed') {
          broadcastTaskEvent(taskId, event)
        }
        persistTaskExecutionEvent(taskId, plan, event)
      },
    })

    for (const result of stepResults.values()) {
      updateTaskStepSummary(taskId, result.stepId, result.summary ?? null)
    }

    const aggregatorConfig = resolveAggregatorConfig(definition, runtimeDefaults)
    let finalReport = buildFallbackReport(objective, stepResults)
    if (aggregatorConfig.provider && aggregatorConfig.model) {
      try {
        finalReport = await aggregateResults({
          taskId,
          objective,
          plan,
          stepResults,
          provider: getRuntimeProviderFromEnv(aggregatorConfig.provider),
          model: aggregatorConfig.model,
          snapshot,
        })
      } catch {
        // Keep fallback report.
      }
    }

    const hasFailedStep = [...stepResults.values()].some((result) => Boolean(result.error))
    const finalStatus: TaskStatus = hasFailedStep ? 'failed' : 'completed'

    if (finalStatus === 'completed' && aggregatorConfig.provider && aggregatorConfig.model) {
      try {
        await persistTaskLongTermMemories({
          taskId,
          taskObjective: objective,
          plan,
          stepResults,
          report: finalReport,
          provider: getRuntimeProviderFromEnv(aggregatorConfig.provider),
          model: aggregatorConfig.model,
        })
      } catch {
        // Memory persistence is best-effort.
      }
    }

    updateTaskStatus(taskId, finalStatus, { result: finalReport })
    const completionEvent: TaskExecutionEvent = {
      type: finalStatus === 'completed' ? 'task_completed' : 'task_failed',
      taskId,
      output: finalReport,
      timestamp: Date.now(),
    }
    broadcastTaskEvent(taskId, completionEvent)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const fallbackOutput = `# Pipeline 执行报告\n\n**状态:** Pipeline 执行过程中发生错误\n\n**错误详情:** ${errorMessage}`
    updateTaskStatus(taskId, 'failed', { error: errorMessage, result: fallbackOutput })
    broadcastTaskEvent(taskId, {
      type: 'task_failed',
      taskId,
      error: errorMessage,
      output: fallbackOutput,
      timestamp: Date.now(),
    })
  } finally {
    setTimeout(() => {
      clearTaskSseSubscribers(taskId)
    }, 10_000)
  }
}

export async function pipelinesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/pipelines', async (_request, reply) => {
    return reply.send({
      pipelines: listPipelines().map((pipeline) => ({
        id: pipeline.id,
        name: pipeline.name,
        description: pipeline.description,
        version: pipeline.version,
        runtimeDefaults: pipeline.definition.runtimeDefaults ?? null,
        stepCount: pipeline.definition.steps.length,
        createdAt: pipeline.createdAt,
        updatedAt: pipeline.updatedAt,
      })),
    })
  })

  app.get<{ Params: { id: string } }>('/pipelines/:id', async (request, reply) => {
    const pipeline = getPipelineById(request.params.id)
    if (!pipeline) {
      return reply.status(404).send({ error: `Pipeline not found: ${request.params.id}` })
    }

    return reply.send({ pipeline })
  })

  app.post<{ Body: PipelineBody }>('/pipelines', async (request, reply) => {
    const errors = validatePipelineDefinition(request.body)
    if (errors.length > 0) {
      return reply.status(400).send({ error: errors.join('\n') })
    }

    const cycleId = await detectSubPipelineCycles(randomUUID(), request.body)
    if (cycleId) {
      return reply.status(400).send({ error: `sub_pipeline circular reference detected involving pipeline "${cycleId}"` })
    }

    const created = createPipeline({
      name: request.body.name,
      description: request.body.description,
      definition: {
        name: request.body.name,
        description: request.body.description,
        runtimeDefaults: request.body.runtimeDefaults,
        steps: request.body.steps,
      },
    })

    return reply.status(201).send({ pipeline: created })
  })

  app.put<{ Params: { id: string }; Body: PipelineBody }>('/pipelines/:id', async (request, reply) => {
    const errors = validatePipelineDefinition(request.body)
    if (errors.length > 0) {
      return reply.status(400).send({ error: errors.join('\n') })
    }

    const cycleId = await detectSubPipelineCycles(request.params.id, request.body)
    if (cycleId) {
      return reply.status(400).send({ error: `sub_pipeline circular reference detected involving pipeline "${cycleId}"` })
    }

    try {
      const updated = updatePipeline({
        id: request.params.id,
        name: request.body.name,
        description: request.body.description,
        definition: {
          name: request.body.name,
          description: request.body.description,
          runtimeDefaults: request.body.runtimeDefaults,
          steps: request.body.steps,
        },
      })

      return reply.send({ pipeline: updated })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.status(404).send({ error: message })
    }
  })

  app.delete<{ Params: { id: string } }>('/pipelines/:id', async (request, reply) => {
    deletePipeline(request.params.id)
    return reply.status(204).send()
  })

  app.post<{ Params: { id: string }; Body: RunPipelineBody }>('/pipelines/:id/run', async (request, reply) => {
    const pipeline = getPipelineById(request.params.id)
    if (!pipeline) {
      return reply.status(404).send({ error: `Pipeline not found: ${request.params.id}` })
    }

    const runtimeDefaults = {
      provider: request.body.provider,
      model: request.body.model,
    }
    if (runtimeDefaults.provider && !isProviderName(runtimeDefaults.provider)) {
      return reply.status(400).send({ error: `Unknown provider: ${runtimeDefaults.provider}` })
    }

    const taskId = randomUUID()
    const now = Date.now()
    const db = getDb()
    const snapshot = createRegistrySnapshot()
    const objective = request.body.objective?.trim() || `Run pipeline: ${pipeline.name}`

    db.prepare(`
      INSERT INTO tasks (id, status, kind, team_members, objective, registry_snapshot, pipeline_id, pipeline_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      taskId,
      'pending',
      'pipeline',
      JSON.stringify([]),
      objective,
      serializeRegistrySnapshot(snapshot),
      pipeline.id,
      pipeline.version,
      now,
      now,
    )

    void runPipelineTask({
      taskId,
      objective,
      definition: pipeline.definition,
      snapshot,
      runtimeDefaults,
    })

    return reply.status(202).send({
      id: taskId,
      status: 'pending',
      kind: 'pipeline',
      objective,
      pipelineId: pipeline.id,
      pipelineVersion: pipeline.version,
      createdAt: now,
    })
  })

  app.post<{ Params: { taskId: string; stepId: string } }>('/tasks/:taskId/steps/:stepId/approve', async (request, reply) => {
    const db = getDb()
    const task = db.prepare<[string], TaskRowExists>(`SELECT id, kind FROM tasks WHERE id = ?`).get(request.params.taskId)
    if (!task) {
      return reply.status(404).send({ error: `Task not found: ${request.params.taskId}` })
    }
    if (task.kind !== 'pipeline') {
      return reply.status(400).send({ error: 'Only pipeline tasks support gate approval' })
    }

    const approved = approvePipelineGate({
      taskId: request.params.taskId,
      stepId: request.params.stepId,
      approve: true,
    })
    if (!approved) {
      const gateRow = db
        .prepare<[string, string, string], GateStepRow>(
          `SELECT status, objective FROM task_steps WHERE task_id = ? AND id IN (?, ?)`,
        )
        .get(request.params.taskId, request.params.stepId, `${request.params.taskId}:${request.params.stepId}`)

      if (gateRow?.status === 'pending_approval') {
        const errorMessage = failOrphanedGate(request.params.taskId, request.params.stepId, gateRow)
        return reply.status(409).send({ error: errorMessage })
      }

      return reply.status(409).send({ error: 'Gate is not currently awaiting approval' })
    }

    return reply.send({ ok: true })
  })

  app.post<{ Params: { taskId: string; stepId: string } }>('/tasks/:taskId/steps/:stepId/reject', async (request, reply) => {
    const db = getDb()
    const task = db.prepare<[string], TaskRowExists>(`SELECT id, kind FROM tasks WHERE id = ?`).get(request.params.taskId)
    if (!task) {
      return reply.status(404).send({ error: `Task not found: ${request.params.taskId}` })
    }
    if (task.kind !== 'pipeline') {
      return reply.status(400).send({ error: 'Only pipeline tasks support gate approval' })
    }

    const approved = approvePipelineGate({
      taskId: request.params.taskId,
      stepId: request.params.stepId,
      approve: false,
    })
    if (!approved) {
      const gateRow = db
        .prepare<[string, string, string], GateStepRow>(
          `SELECT status, objective FROM task_steps WHERE task_id = ? AND id IN (?, ?)`,
        )
        .get(request.params.taskId, request.params.stepId, `${request.params.taskId}:${request.params.stepId}`)

      if (gateRow?.status === 'pending_approval') {
        const errorMessage = failOrphanedGate(request.params.taskId, request.params.stepId, gateRow)
        return reply.status(409).send({ error: errorMessage })
      }

      return reply.status(409).send({ error: 'Gate is not currently awaiting approval' })
    }

    return reply.send({ ok: true })
  })
}
