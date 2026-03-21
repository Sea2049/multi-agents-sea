import { getDb } from '../storage/db.js'
import type { TaskExecutionEvent, TaskPlan, TaskStatus } from '../orchestrator/types.js'

interface TaskStepWriteParams {
  taskId: string
  stepId: string
  runVersion?: number
  agentId: string
  objective: string
  status: string
  result?: string
  summary?: string
  error?: string
  startedAt?: number
  completedAt?: number
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
  started_at: number | null
  completed_at: number | null
}

const sseClients = new Map<string, Set<(data: string) => void>>()
const sseCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()

function taskExists(taskId: string): boolean {
  const db = getDb()
  const row = db.prepare<[string], { id: string }>(`SELECT id FROM tasks WHERE id = ?`).get(taskId)
  return Boolean(row)
}

function toDbTaskStepId(taskId: string, stepId: string, runVersion = 1): string {
  return `${taskId}:rv${runVersion}:${stepId}`
}

export function toClientTaskStepId(taskId: string, storedStepId: string): string {
  const scopedPrefix = `${taskId}:rv`
  if (storedStepId.startsWith(scopedPrefix)) {
    const firstSeparator = storedStepId.indexOf(':', scopedPrefix.length)
    if (firstSeparator !== -1 && firstSeparator + 1 < storedStepId.length) {
      return storedStepId.slice(firstSeparator + 1)
    }
  }
  const legacyPrefix = `${taskId}:`
  return storedStepId.startsWith(legacyPrefix) ? storedStepId.slice(legacyPrefix.length) : storedStepId
}

export function broadcastTaskEvent(taskId: string, event: TaskExecutionEvent): void {
  const clients = sseClients.get(taskId)
  if (!clients || clients.size === 0) {
    return
  }

  const data = JSON.stringify(event)
  for (const send of clients) {
    try {
      send(data)
    } catch {
      // Ignore disconnected clients.
    }
  }
}

export function addTaskSseSubscriber(taskId: string, send: (data: string) => void): void {
  if (!sseClients.has(taskId)) {
    sseClients.set(taskId, new Set())
  }

  sseClients.get(taskId)!.add(send)
}

export function removeTaskSseSubscriber(taskId: string, send: (data: string) => void): void {
  sseClients.get(taskId)?.delete(send)
}

export function clearTaskSseSubscribers(taskId: string): void {
  sseClients.delete(taskId)
}

export function scheduleTaskSseCleanup(taskId: string, delayMs = 10_000): void {
  const existing = sseCleanupTimers.get(taskId)
  if (existing) {
    clearTimeout(existing)
  }
  const timer = setTimeout(() => {
    clearTaskSseSubscribers(taskId)
    sseCleanupTimers.delete(taskId)
  }, delayMs)
  sseCleanupTimers.set(taskId, timer)
}

export function cancelTaskSseCleanup(taskId: string): void {
  const timer = sseCleanupTimers.get(taskId)
  if (!timer) {
    return
  }
  clearTimeout(timer)
  sseCleanupTimers.delete(taskId)
}

export function getTaskRunVersion(taskId: string): number {
  const db = getDb()
  const row = db.prepare<[string], { run_version: number | null }>(`SELECT run_version FROM tasks WHERE id = ?`).get(taskId)
  return row?.run_version ?? 1
}

export function updateTaskStatus(
  taskId: string,
  status: TaskStatus,
  extra?: { plan?: string; result?: string; error?: string },
): void {
  if (!taskExists(taskId)) {
    return
  }

  const db = getDb()
  const now = Date.now()

  if (extra?.plan !== undefined) {
    db.prepare(`UPDATE tasks SET status = ?, plan = ?, updated_at = ? WHERE id = ?`).run(status, extra.plan, now, taskId)
    return
  }

  if (extra?.result !== undefined) {
    db.prepare(`UPDATE tasks SET status = ?, result = ?, updated_at = ? WHERE id = ?`).run(status, extra.result, now, taskId)
    return
  }

  if (extra?.error !== undefined) {
    db.prepare(`UPDATE tasks SET status = ?, error = ?, updated_at = ? WHERE id = ?`).run(status, extra.error, now, taskId)
    return
  }

  db.prepare(`UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?`).run(status, now, taskId)
}

export function upsertTaskStep(params: TaskStepWriteParams): void {
  if (!taskExists(params.taskId)) {
    return
  }

  const db = getDb()
  const runVersion = params.runVersion ?? getTaskRunVersion(params.taskId)
  const dbStepId = toDbTaskStepId(params.taskId, params.stepId, runVersion)
  const existing = db.prepare<[string], TaskStepRow>(`SELECT * FROM task_steps WHERE id = ?`).get(dbStepId)
  if (!existing) {
    db.prepare(
      `INSERT INTO task_steps (id, task_id, run_version, agent_id, status, objective, result, error, summary, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      dbStepId,
      params.taskId,
      runVersion,
      params.agentId,
      params.status,
      params.objective,
      params.result ?? null,
      params.error ?? null,
      params.summary ?? null,
      params.startedAt ?? null,
      params.completedAt ?? null,
    )
    return
  }

  const nextResult = params.result !== undefined ? params.result : existing.result
  const nextError = params.error !== undefined ? params.error : existing.error
  const nextSummary = params.summary !== undefined ? params.summary : existing.summary
  const nextStartedAt = params.startedAt !== undefined ? params.startedAt : existing.started_at
  const nextCompletedAt = params.completedAt !== undefined ? params.completedAt : existing.completed_at

  db.prepare(
    `UPDATE task_steps
       SET agent_id = ?, status = ?, objective = ?, result = ?, error = ?, summary = ?, started_at = ?, completed_at = ?
     WHERE id = ?`,
  ).run(
    params.agentId || existing.agent_id,
    params.status,
    params.objective || existing.objective,
    nextResult,
    nextError,
    nextSummary,
    nextStartedAt,
    nextCompletedAt,
    dbStepId,
  )
}

export function updateTaskStepSummary(taskId: string, stepId: string, summary: string | null): void {
  if (!taskExists(taskId)) {
    return
  }

  const db = getDb()
  const runVersion = getTaskRunVersion(taskId)
  db.prepare(`UPDATE task_steps SET summary = ? WHERE id = ?`).run(summary, toDbTaskStepId(taskId, stepId, runVersion))
}

export function persistTaskExecutionEvent(taskId: string, plan: TaskPlan, event: TaskExecutionEvent, runVersion?: number): void {
  const lookupStep = event.stepId ? plan.steps.find((step) => step.id === event.stepId) : undefined
  const scopedRunVersion = runVersion ?? getTaskRunVersion(taskId)

  if (event.type === 'step_started' && event.stepId) {
    upsertTaskStep({
      taskId,
      stepId: event.stepId,
      runVersion: scopedRunVersion,
      agentId: event.agentId ?? lookupStep?.assignee ?? '',
      objective: lookupStep?.objective ?? '',
      status: 'running',
      startedAt: event.timestamp,
    })
    return
  }

  if (event.type === 'step_waiting' && event.stepId) {
    upsertTaskStep({
      taskId,
      stepId: event.stepId,
      runVersion: scopedRunVersion,
      agentId: event.agentId ?? lookupStep?.assignee ?? '',
      objective: lookupStep?.objective ?? '',
      status: 'pending_approval',
      result: event.output,
      startedAt: event.timestamp,
    })
    return
  }

  if (event.type === 'step_completed' && event.stepId) {
    upsertTaskStep({
      taskId,
      stepId: event.stepId,
      runVersion: scopedRunVersion,
      agentId: event.agentId ?? lookupStep?.assignee ?? '',
      objective: lookupStep?.objective ?? '',
      status: 'completed',
      result: event.output,
      completedAt: event.timestamp,
    })
    return
  }

  if (event.type === 'step_skipped' && event.stepId) {
    upsertTaskStep({
      taskId,
      stepId: event.stepId,
      runVersion: scopedRunVersion,
      agentId: event.agentId ?? lookupStep?.assignee ?? '',
      objective: lookupStep?.objective ?? '',
      status: 'skipped',
      result: event.output,
      completedAt: event.timestamp,
    })
    return
  }

  if (event.type === 'step_failed' && event.stepId) {
    upsertTaskStep({
      taskId,
      stepId: event.stepId,
      runVersion: scopedRunVersion,
      agentId: event.agentId ?? lookupStep?.assignee ?? '',
      objective: lookupStep?.objective ?? '',
      status: 'failed',
      error: event.error,
      completedAt: event.timestamp,
    })
    return
  }

  if (event.type === 'tool_call_started' && event.stepId && event.toolCallId && event.toolName) {
    insertToolCall({
      id: event.toolCallId,
      taskId,
      stepId: event.stepId,
      toolName: event.toolName,
      toolInput: event.toolInput,
      startedAt: event.timestamp,
    })
    return
  }

  if (event.type === 'tool_call_completed' && event.stepId && event.toolCallId && event.toolName) {
    completeToolCall({
      id: event.toolCallId,
      taskId,
      stepId: event.stepId,
      toolName: event.toolName,
      toolInput: event.toolInput,
      toolOutput: event.toolOutput,
      toolIsError: event.toolIsError,
      completedAt: event.timestamp,
    })
  }
}

export function insertToolCall(params: {
  id: string
  taskId: string
  stepId: string
  toolName: string
  toolInput?: Record<string, unknown>
  startedAt: number
}): void {
  if (!taskExists(params.taskId)) {
    return
  }

  const db = getDb()
  db.prepare(
    `INSERT OR IGNORE INTO tool_calls (id, task_id, step_id, tool_name, tool_input, started_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    params.id,
    params.taskId,
    params.stepId,
    params.toolName,
    JSON.stringify(params.toolInput ?? {}),
    params.startedAt,
  )
}

export function completeToolCall(params: {
  id: string
  taskId: string
  stepId: string
  toolName: string
  toolInput?: Record<string, unknown>
  toolOutput?: string
  toolIsError?: boolean
  completedAt: number
}): void {
  if (!taskExists(params.taskId)) {
    return
  }

  const db = getDb()
  const result = db.prepare(
    `UPDATE tool_calls
       SET tool_output = ?, is_error = ?, completed_at = ?
     WHERE id = ?`,
  ).run(
    params.toolOutput ?? null,
    params.toolIsError ? 1 : 0,
    params.completedAt,
    params.id,
  )

  if (result.changes === 0) {
    db.prepare(
      `INSERT INTO tool_calls (
        id, task_id, step_id, tool_name, tool_input, tool_output, is_error, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      params.id,
      params.taskId,
      params.stepId,
      params.toolName,
      JSON.stringify(params.toolInput ?? {}),
      params.toolOutput ?? null,
      params.toolIsError ? 1 : 0,
      params.completedAt,
      params.completedAt,
    )
  }
}

export function deleteTaskRuntime(taskId: string): void {
  const db = getDb()
  db.prepare(`DELETE FROM task_messages WHERE task_id = ?`).run(taskId)
  db.prepare(`DELETE FROM tool_calls WHERE task_id = ?`).run(taskId)
  db.prepare(`DELETE FROM task_steps WHERE task_id = ?`).run(taskId)
  db.prepare(`DELETE FROM tasks WHERE id = ?`).run(taskId)
}
