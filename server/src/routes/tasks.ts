import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { getDb } from '../storage/db.js'
import { getRuntimeProviderFromEnv, isProviderName, type ProviderName } from '../providers/index.js'
import { createRegistrySnapshot } from '../runtime/registry-snapshot-builder.js'
import type { RegistrySnapshot, SkillRoutingPolicy } from '../runtime/registry-snapshot.js'
import { parseRegistrySnapshot, serializeRegistrySnapshot } from '../runtime/registry-snapshot.js'
import { parseSkillRoutingPolicy, sanitizeSkillRoutingPolicy, serializeSkillRoutingPolicy } from '../runtime/skill-routing.js'
import { loadAgentProfile } from '../runtime/prompt-loader.js'
import { persistTaskLongTermMemories } from '../memory/task-memory-extractor.js'
import { createPlan } from '../orchestrator/planner.js'
import { validatePlan } from '../orchestrator/plan-validator.js'
import { executePlan } from '../orchestrator/scheduler.js'
import { aggregateResults } from '../orchestrator/aggregator.js'
import type { TaskExecutionEvent, TaskStatus } from '../orchestrator/types.js'
import { cancelPipelineTaskRuntime } from '../pipelines/engine.js'
import {
  addTaskSseSubscriber,
  broadcastTaskEvent,
  clearTaskSseSubscribers,
  cancelTaskSseCleanup,
  deleteTaskRuntime,
  getTaskRunVersion,
  removeTaskSseSubscriber,
  persistTaskExecutionEvent,
  scheduleTaskSseCleanup,
  toClientTaskStepId,
  updateTaskStatus,
  updateTaskStepSummary,
  upsertTaskStep,
} from '../tasks/runtime-store.js'
import {
  appendTaskMessage,
  buildContinuationContext,
  buildTaskQuestionWithMemoryContext,
  buildTaskChatMessages,
  buildTaskChatSystemPrompt,
  listTaskMessages,
  type TaskStepSnapshot,
} from '../tasks/followup-thread.js'

const MAX_PLAN_RETRIES = 2

interface TaskTeamMemberInput {
  agentId: string
  provider: string
  model: string
}

interface CreateTaskBody {
  objective: string
  teamMembers: TaskTeamMemberInput[]
  skillRouting?: SkillRoutingPolicy
}

interface TaskRow {
  id: string
  status: string
  kind: string
  run_version: number | null
  team_members: string
  objective: string
  plan: string | null
  registry_snapshot: string | null
  skill_routing: string | null
  pipeline_id: string | null
  pipeline_version: number | null
  result: string | null
  error: string | null
  created_at: number
  updated_at: number
}

interface TaskStepRow {
  id: string
  task_id: string
  run_version: number | null
  agent_id: string
  status: string
  objective: string
  result: string | null
  error: string | null
  summary: string | null
  token_count: number | null
  started_at: number | null
  completed_at: number | null
}

interface TaskMessageBody {
  message: string
}

function buildFailureMemoryReport(params: {
  objective: string
  finalReport: string
  stepFailures: Array<{ stepId: string; agentId: string; error: string }>
}): string {
  const header = [
    '# Failed Task Summary',
    '',
    `Objective: ${params.objective}`,
    `Failure count: ${params.stepFailures.length}`,
    '',
  ]
  const failureLines = params.stepFailures.slice(0, 5).map((failure, index) =>
    `${index + 1}. [${failure.stepId}] (${failure.agentId}) ${failure.error}`,
  )

  const reportSnippet = params.finalReport.trim().slice(0, 1600)

  return [
    ...header,
    ...(failureLines.length > 0 ? ['Key failures:', ...failureLines, ''] : []),
    'Execution report excerpt:',
    reportSnippet || '(empty)',
  ].join('\n')
}

function parseTaskTeamMembers(raw: string): TaskTeamMemberInput[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter((item): item is TaskTeamMemberInput => {
      if (!item || typeof item !== 'object') return false
      const candidate = item as Partial<TaskTeamMemberInput>
      return typeof candidate.agentId === 'string' && typeof candidate.provider === 'string' && typeof candidate.model === 'string'
    })
  } catch {
    return []
  }
}

function toTaskStepSnapshot(step: TaskStepRow): TaskStepSnapshot {
  return {
    objective: step.objective,
    status: step.status,
    summary: step.summary,
    result: step.result,
    error: step.error,
    runVersion: step.run_version,
  }
}

/**
 * 异步执行整个编排流程（规划 -> 校验 -> 调度 -> 汇总），不阻塞 HTTP 响应
 */
async function runOrchestration(params: {
  taskId: string
  objective: string
  continuationContext?: string
  runVersion?: number
  teamMembersInput: TaskTeamMemberInput[]
  snapshot: RegistrySnapshot
  skillRouting?: SkillRoutingPolicy
}): Promise<void> {
  const { taskId, objective, continuationContext, teamMembersInput, snapshot, skillRouting } = params
  const runVersion = params.runVersion ?? getTaskRunVersion(params.taskId)

  try {
    // 构建 planner 需要的团队信息（从 runtime-profiles 获取）
    const plannerTeam = teamMembersInput.map((m) => {
      try {
        const profile = loadAgentProfile(m.agentId)
        return {
          agentId: m.agentId,
          name: profile.name,
          description: profile.planningHints.join('; '),
          division: profile.division,
        }
      } catch {
        return {
          agentId: m.agentId,
          name: m.agentId,
          description: 'AI assistant',
          division: 'general',
        }
      }
    })

    // 选择 planner 使用的 provider（用第一个有效成员的 provider）
    const firstMember = teamMembersInput[0]
    if (!firstMember) throw new Error('teamMembers is empty')

    const plannerProvider = getRuntimeProviderFromEnv(firstMember.provider as ProviderName)
    const availableAgentIds = new Set(teamMembersInput.map((m) => m.agentId))

    cancelTaskSseCleanup(taskId)
    updateTaskStatus(taskId, 'planning')

    // Repair loop：最多重试 MAX_PLAN_RETRIES 次
    let plan = null
    let repairHints: string | undefined
    let lastValidationErrors: string[] = []

    for (let attempt = 0; attempt <= MAX_PLAN_RETRIES; attempt++) {
      const rawPlan = await createPlan({
        taskId,
        objective,
        continuationContext,
        teamMembers: plannerTeam,
        provider: plannerProvider,
        model: firstMember.model,
        snapshot,
        repairHints,
      })

      const validation = validatePlan(rawPlan, availableAgentIds)
      if (validation.valid && validation.plan) {
        plan = validation.plan
        break
      }

      lastValidationErrors = validation.errors.map((e) => `[${e.code}] ${e.message}`)
      repairHints = lastValidationErrors.join('\n')

      if (attempt === MAX_PLAN_RETRIES) {
        throw new Error(`Plan validation failed after ${MAX_PLAN_RETRIES + 1} attempts:\n${repairHints}`)
      }
    }

    if (!plan) {
      throw new Error('Failed to produce a valid plan')
    }

    updateTaskStatus(taskId, 'running', { plan: JSON.stringify(plan) })

    // 预插入所有 step 记录（pending 状态）
    for (const step of plan.steps) {
      upsertTaskStep({
        taskId,
        stepId: step.id,
        agentId: step.assignee,
        objective: step.objective,
        status: 'pending',
        runVersion,
      })
    }

    // 执行 DAG 调度
    const stepResults = await executePlan({
      plan,
      teamMembers: teamMembersInput.map((m) => ({
        agentId: m.agentId,
        provider: m.provider,
        model: m.model,
      })),
      providerFactory: (providerName) => getRuntimeProviderFromEnv(providerName as ProviderName),
      snapshot,
      skillRouting,
      onEvent: (event) => {
        const scopedEvent: TaskExecutionEvent = { ...event, runVersion }
        if (event.type !== 'task_completed' && event.type !== 'task_failed') {
          broadcastTaskEvent(taskId, scopedEvent)
        }
        persistTaskExecutionEvent(taskId, plan!, scopedEvent, runVersion)
      },
    })

    for (const result of stepResults.values()) {
      updateTaskStepSummary(taskId, result.stepId, result.summary ?? null)
    }

    // 汇总结果
    const aggregatorProvider = getRuntimeProviderFromEnv(firstMember.provider as ProviderName)
    const finalReport = await aggregateResults({
      taskId,
      objective,
      plan,
      stepResults,
      provider: aggregatorProvider,
      model: firstMember.model,
      snapshot,
    })

    // 判断整体是否有失败步骤
    const hasFailedStep = [...stepResults.values()].some((r) => r.error)
    const finalStatus: TaskStatus = hasFailedStep ? 'failed' : 'completed'

    if (finalReport) {
      try {
        const stepFailures = [...stepResults.values()]
          .filter((result): result is typeof result & { error: string } => typeof result.error === 'string' && result.error.length > 0)
          .map((result) => ({
            stepId: result.stepId,
            agentId: result.agentId,
            error: result.error,
          }))
        const reportForMemory = finalStatus === 'completed'
          ? finalReport
          : buildFailureMemoryReport({
            objective,
            finalReport,
            stepFailures,
          })

        await persistTaskLongTermMemories({
          taskId,
          taskObjective: objective,
          plan,
          stepResults,
          report: reportForMemory,
          provider: aggregatorProvider,
          model: firstMember.model,
        })
      } catch {
        // 记忆写入失败不影响任务终态
      }
    }

    updateTaskStatus(taskId, finalStatus, { result: finalReport })

    const completionEvent: TaskExecutionEvent = {
      type: hasFailedStep ? 'task_failed' : 'task_completed',
      taskId,
      runVersion,
      output: finalReport,
      timestamp: Date.now(),
    }
    broadcastTaskEvent(taskId, completionEvent)
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    // 构建最小化的降级报告，确保前端 ResultAggregator 能显示最终报告区域
    const fallbackOutput = `# 任务执行报告\n\n**状态:** 任务执行过程中发生错误\n\n**错误详情:** ${errorMsg}`
    updateTaskStatus(taskId, 'failed', { error: errorMsg, result: fallbackOutput })

    const failEvent: TaskExecutionEvent = {
      type: 'task_failed',
      taskId,
      runVersion,
      error: errorMsg,
      output: fallbackOutput,
      timestamp: Date.now(),
    }
    broadcastTaskEvent(taskId, failEvent)
  } finally {
    // 清理 SSE 客户端（延迟 10s，让客户端有时间收到最终事件）
    scheduleTaskSseCleanup(taskId)
  }
}

export async function tasksRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/tasks - 创建并异步执行编排任务
  app.post<{ Body: CreateTaskBody }>('/tasks', async (request, reply) => {
    const { objective, teamMembers } = request.body

    if (!objective?.trim()) {
      return reply.status(400).send({ error: 'objective is required and cannot be empty' })
    }
    if (!Array.isArray(teamMembers) || teamMembers.length === 0) {
      return reply.status(400).send({ error: 'teamMembers must be a non-empty array' })
    }
    for (const m of teamMembers) {
      if (!m.agentId || !m.provider || !m.model) {
        return reply.status(400).send({ error: 'Each teamMember must have agentId, provider, and model' })
      }
      if (!isProviderName(m.provider)) {
        return reply.status(400).send({ error: `Unknown provider: ${m.provider}` })
      }
    }

    const db = getDb()
    const taskId = randomUUID()
    const now = Date.now()
    const snapshot = createRegistrySnapshot()
    const skillRouting = sanitizeSkillRoutingPolicy(request.body.skillRouting)

    db.prepare(
      `INSERT INTO tasks (id, status, kind, run_version, team_members, objective, registry_snapshot, skill_routing, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      taskId,
      'pending',
      'orchestration',
      1,
      JSON.stringify(teamMembers),
      objective.trim(),
      serializeRegistrySnapshot(snapshot),
      serializeSkillRoutingPolicy(skillRouting),
      now,
      now,
    )

    // 异步启动编排（不 await）
    void runOrchestration({
      taskId,
      objective: objective.trim(),
      teamMembersInput: teamMembers,
      snapshot,
      skillRouting,
    })

    return reply.status(202).send({
      id: taskId,
      status: 'pending',
      runVersion: 1,
      objective: objective.trim(),
      createdAt: now,
    })
  })

  // GET /api/tasks - 获取最近 20 个任务历史
  app.get('/tasks', async (_request, reply) => {
    const db = getDb()
    const rows = db
      .prepare<[], TaskRow>(
        `SELECT id, status, kind, run_version, objective, plan, result, error, created_at, updated_at
         FROM tasks
         ORDER BY created_at DESC
         LIMIT 20`,
      )
      .all()

    return reply.send(
      rows.map((r) => ({
        id: r.id,
        status: r.status,
        kind: r.kind,
        runVersion: r.run_version ?? 1,
        objective: r.objective,
        hasPlan: r.plan !== null,
        hasResult: r.result !== null,
        error: r.error,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    )
  })

  // GET /api/tasks/:id - 获取任务状态和完整结果
  app.get<{ Params: { id: string } }>('/tasks/:id', async (request, reply) => {
    const { id } = request.params
    const db = getDb()

    const task = db.prepare<[string], TaskRow>(`SELECT * FROM tasks WHERE id = ?`).get(id)
    if (!task) {
      return reply.status(404).send({ error: `Task not found: ${id}` })
    }

    const steps = db
      .prepare<[string], TaskStepRow>(
        `SELECT * FROM task_steps WHERE task_id = ? ORDER BY run_version ASC, started_at ASC, id ASC`,
      )
      .all(id)
    const threadMessages = listTaskMessages(db, id, 30)

    return reply.send({
      id: task.id,
      status: task.status,
      kind: task.kind,
      runVersion: task.run_version ?? 1,
      objective: task.objective,
      plan: task.plan ? (JSON.parse(task.plan) as unknown) : null,
      registrySnapshot: parseRegistrySnapshot(task.registry_snapshot),
      skillRouting: parseSkillRoutingPolicy(task.skill_routing) ?? null,
      pipelineId: task.pipeline_id,
      pipelineVersion: task.pipeline_version,
      result: task.result,
      error: task.error,
      teamMembers: JSON.parse(task.team_members) as unknown,
      createdAt: task.created_at,
      updatedAt: task.updated_at,
      threadMessages,
      steps: steps.map((s) => ({
        id: toClientTaskStepId(task.id, s.id),
        runVersion: s.run_version ?? 1,
        agentId: s.agent_id,
        status: s.status,
        objective: s.objective,
        result: s.result,
        summary: s.summary,
        error: s.error,
        tokenCount: s.token_count,
        startedAt: s.started_at,
        completedAt: s.completed_at,
      })),
    })
  })

  app.post<{ Params: { id: string }; Body: TaskMessageBody }>('/tasks/:id/chat', async (request, reply) => {
    const { id } = request.params
    const { message } = request.body
    const trimmedMessage = message?.trim()
    if (!trimmedMessage) {
      return reply.status(400).send({ error: 'message is required and cannot be empty' })
    }

    const db = getDb()
    const task = db.prepare<[string], TaskRow>(`SELECT * FROM tasks WHERE id = ?`).get(id)
    if (!task) {
      return reply.status(404).send({ error: `Task not found: ${id}` })
    }

    const teamMembers = parseTaskTeamMembers(task.team_members)
    const firstMember = teamMembers[0]
    if (!firstMember) {
      return reply.status(400).send({ error: 'Task has no team members for follow-up chat' })
    }

    const steps = db
      .prepare<[string], TaskStepRow>(
        `SELECT * FROM task_steps WHERE task_id = ? ORDER BY run_version ASC, started_at ASC, id ASC`,
      )
      .all(id)
    const runVersion = task.run_version ?? 1
    const previousMessages = listTaskMessages(db, id, 24)
    appendTaskMessage(db, {
      taskId: id,
      runVersion,
      role: 'user',
      mode: 'chat',
      content: trimmedMessage,
    })

    const origin = request.headers.origin
    const allowLocalOrigin =
      typeof origin === 'string' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...(allowLocalOrigin
        ? {
            'Access-Control-Allow-Origin': origin,
            Vary: 'Origin',
          }
        : {}),
    })

    const write = (data: string) => {
      reply.raw.write(`data: ${data}\n\n`)
    }

    let assistantOutput = ''
    try {
      const provider = getRuntimeProviderFromEnv(firstMember.provider as ProviderName)
      const systemPrompt = buildTaskChatSystemPrompt({
        task: {
          id: task.id,
          objective: task.objective,
          result: task.result,
          error: task.error,
          runVersion,
        },
        steps: steps.map(toTaskStepSnapshot),
      })
      const userMessage = await buildTaskQuestionWithMemoryContext({
        taskId: task.id,
        agentId: firstMember.agentId,
        question: trimmedMessage,
      })

      for await (const chunk of provider.chat({
        model: firstMember.model,
        systemPrompt,
        messages: buildTaskChatMessages(previousMessages, userMessage),
        temperature: 0.2,
      })) {
        if (chunk.delta) {
          assistantOutput += chunk.delta
        }
        write(JSON.stringify({ delta: chunk.delta, done: chunk.done }))
        if (chunk.done) break
      }

      appendTaskMessage(db, {
        taskId: id,
        runVersion,
        role: 'assistant',
        mode: 'chat',
        content: assistantOutput.trim() || '（无输出）',
      })
      write('[DONE]')
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : 'Internal server error'
      write(JSON.stringify({ delta: '', done: true, error: errMessage }))
    } finally {
      reply.raw.end()
    }
  })

  app.post<{ Params: { id: string }; Body: TaskMessageBody }>('/tasks/:id/continue', async (request, reply) => {
    const { id } = request.params
    const { message } = request.body
    const instruction = message?.trim()
    if (!instruction) {
      return reply.status(400).send({ error: 'message is required and cannot be empty' })
    }

    const db = getDb()
    const task = db.prepare<[string], TaskRow>(`SELECT * FROM tasks WHERE id = ?`).get(id)
    if (!task) {
      return reply.status(404).send({ error: `Task not found: ${id}` })
    }
    if (task.status !== 'completed' && task.status !== 'failed') {
      return reply.status(409).send({ error: `Task ${id} is ${task.status}, only completed/failed tasks can continue` })
    }

    const teamMembers = parseTaskTeamMembers(task.team_members)
    if (teamMembers.length === 0) {
      return reply.status(400).send({ error: 'Task has no team members, cannot continue' })
    }
    for (const member of teamMembers) {
      if (!isProviderName(member.provider)) {
        return reply.status(400).send({ error: `Unknown provider: ${member.provider}` })
      }
    }

    const steps = db
      .prepare<[string], TaskStepRow>(
        `SELECT * FROM task_steps WHERE task_id = ? ORDER BY run_version ASC, started_at ASC, id ASC`,
      )
      .all(id)
    const threadMessages = listTaskMessages(db, id, 30)
    const currentRunVersion = task.run_version ?? 1
    const nextRunVersion = currentRunVersion + 1

    appendTaskMessage(db, {
      taskId: id,
      runVersion: nextRunVersion,
      role: 'user',
      mode: 'continue',
      content: instruction,
    })

    const continuationContext = await buildContinuationContext({
      task: {
        id: task.id,
        objective: task.objective,
        result: task.result,
        error: task.error,
        runVersion: currentRunVersion,
      },
      steps: steps.map(toTaskStepSnapshot),
      threadMessages,
      instruction,
      agentId: teamMembers[0]?.agentId,
    })

    const now = Date.now()
    db.prepare(`UPDATE tasks SET status = ?, run_version = ?, result = NULL, error = NULL, updated_at = ? WHERE id = ?`).run(
      'planning',
      nextRunVersion,
      now,
      id,
    )

    const snapshot = parseRegistrySnapshot(task.registry_snapshot)
    const skillRouting = parseSkillRoutingPolicy(task.skill_routing)
    void runOrchestration({
      taskId: id,
      objective: task.objective,
      continuationContext,
      runVersion: nextRunVersion,
      teamMembersInput: teamMembers,
      snapshot,
      skillRouting,
    })

    return reply.send({
      ok: true,
      taskId: id,
      status: 'planning',
      runVersion: nextRunVersion,
    })
  })

  // GET /api/tasks/:id/stream - SSE 实时推送 TaskExecutionEvent
  app.get<{ Params: { id: string } }>('/tasks/:id/stream', async (request, reply) => {
    const { id } = request.params
    const db = getDb()
    const origin = request.headers.origin
    const allowLocalOrigin =
      typeof origin === 'string' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)

    const task = db
      .prepare<[string], { id: string; status: string; run_version: number | null; result: string | null; error: string | null }>(
        `SELECT id, status, run_version, result, error FROM tasks WHERE id = ?`,
      )
      .get(id)
    if (!task) {
      return reply.status(404).send({ error: `Task not found: ${id}` })
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...(allowLocalOrigin
        ? {
            'Access-Control-Allow-Origin': origin,
            Vary: 'Origin',
          }
        : {}),
    })

    const send = (data: string) => {
      reply.raw.write(`data: ${data}\n\n`)
    }

    // 如果任务已终态，直接发送一次性状态事件关闭
    if (task.status === 'completed' || task.status === 'failed') {
      const eventType = task.status === 'completed' ? 'task_completed' : 'task_failed'
      send(
        JSON.stringify({
          type: eventType,
          taskId: id,
          runVersion: task.run_version ?? 1,
          output: task.result ?? undefined,
          error: task.error ?? undefined,
          timestamp: Date.now(),
        }),
      )
      reply.raw.end()
      return
    }

    // 注册 SSE 订阅者
    addTaskSseSubscriber(id, send)

    const cleanup = () => {
      removeTaskSseSubscriber(id, send)
    }

    request.raw.on('close', cleanup)
    request.raw.on('error', cleanup)

    // 保持连接开启（Fastify 不自动关闭）
    await new Promise<void>((resolve) => {
      request.raw.on('close', resolve)
      request.raw.on('error', resolve)
    })
  })

  // DELETE /api/tasks/:id - 删除任务记录
  app.delete<{ Params: { id: string } }>('/tasks/:id', async (request, reply) => {
    const { id } = request.params
    const db = getDb()

    const task = db.prepare<[string], { id: string }>(`SELECT id FROM tasks WHERE id = ?`).get(id)
    if (!task) {
      return reply.status(404).send({ error: `Task not found: ${id}` })
    }

    deleteTaskRuntime(id)
    cancelPipelineTaskRuntime(id)
    clearTaskSseSubscribers(id)

    return reply.status(204).send()
  })
}
