import { randomUUID } from 'node:crypto'
import type BetterSqlite3 from 'better-sqlite3'
import type { Message, MessageRole } from '../providers/types.js'
import { retrieveRelevantMemories } from '../memory/retriever.js'

export type TaskMessageMode = 'chat' | 'continue'

export interface TaskThreadMessage {
  id: string
  taskId: string
  runVersion: number
  role: MessageRole
  mode: TaskMessageMode
  content: string
  createdAt: number
}

interface TaskMessageRow {
  id: string
  task_id: string
  run_version: number | null
  role: string
  mode: string
  content: string
  created_at: number
}

export interface TaskContextSnapshot {
  id: string
  objective: string
  result: string | null
  error: string | null
  runVersion: number
}

export interface TaskStepSnapshot {
  objective: string
  status: string
  summary: string | null
  result: string | null
  error: string | null
  runVersion: number | null
}

const MAX_MESSAGE_CHARS = 12_000

function clampText(text: string, maxChars = MAX_MESSAGE_CHARS): string {
  if (text.length <= maxChars) {
    return text
  }
  return `${text.slice(0, maxChars)}\n\n...[truncated]`
}

export function listTaskMessages(
  db: BetterSqlite3.Database,
  taskId: string,
  limit = 24,
): TaskThreadMessage[] {
  const rows = db
    .prepare<[string, number], TaskMessageRow>(
      `SELECT id, task_id, run_version, role, mode, content, created_at
       FROM task_messages
       WHERE task_id = ?
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .all(taskId, Math.max(1, limit))

  return rows.map((row) => ({
    id: row.id,
    taskId: row.task_id,
    runVersion: row.run_version ?? 1,
    role: (row.role === 'assistant' || row.role === 'system') ? row.role : 'user',
    mode: row.mode === 'continue' ? 'continue' : 'chat',
    content: row.content,
    createdAt: row.created_at,
  }))
}

export function appendTaskMessage(
  db: BetterSqlite3.Database,
  params: {
    taskId: string
    runVersion: number
    role: MessageRole
    mode: TaskMessageMode
    content: string
  },
): TaskThreadMessage {
  const now = Date.now()
  const record: TaskThreadMessage = {
    id: randomUUID(),
    taskId: params.taskId,
    runVersion: params.runVersion,
    role: params.role,
    mode: params.mode,
    content: clampText(params.content),
    createdAt: now,
  }
  db.prepare(
    `INSERT INTO task_messages (id, task_id, run_version, role, mode, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id,
    record.taskId,
    record.runVersion,
    record.role,
    record.mode,
    record.content,
    record.createdAt,
  )
  return record
}

export function buildTaskChatMessages(
  messages: TaskThreadMessage[],
  question: string,
): Message[] {
  const contextMessages = messages.slice(-16).map<Message>((message) => ({
    role: message.role === 'system' ? 'assistant' : message.role,
    content: clampText(message.content, 3_000),
  }))
  contextMessages.push({ role: 'user', content: question.trim() })
  return contextMessages
}

export async function buildTaskQuestionWithMemoryContext(params: {
  taskId: string
  agentId?: string
  question: string
}): Promise<string> {
  const question = params.question.trim()
  if (!question) {
    return ''
  }

  const retrieval = await retrieveRelevantMemories({
    query: question,
    taskId: params.taskId,
    agentId: params.agentId,
    limit: 4,
    maxChars: 1200,
    preferTaskScoped: true,
    includePinned: true,
    includeGraphContext: false,
  })

  if (!retrieval.injectedContext) {
    return question
  }

  return `${retrieval.injectedContext}\n\n## Current User Request\n${question}`
}

export function buildTaskChatSystemPrompt(params: {
  task: TaskContextSnapshot
  steps: TaskStepSnapshot[]
}): string {
  const stepLines = params.steps
    .slice(-10)
    .map((step, index) => {
      const status = step.status
      const summary = step.summary ?? step.result ?? step.error ?? '(no output)'
      return `${index + 1}. [run ${step.runVersion ?? params.task.runVersion}] [${status}] ${step.objective}\n${clampText(summary, 600)}`
    })
    .join('\n\n')

  return [
    'You are the follow-up assistant for an orchestration task.',
    'Answer questions strictly based on the task context and outputs.',
    'If user asks for actions, propose concrete next actions tied to current task outputs.',
    `Task ID: ${params.task.id}`,
    `Current run version: ${params.task.runVersion}`,
    `Objective: ${params.task.objective}`,
    `Latest result:\n${clampText(params.task.result ?? '(empty)', 2_000)}`,
    params.task.error ? `Latest error:\n${clampText(params.task.error, 800)}` : '',
    stepLines ? `Recent step snapshots:\n${stepLines}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

export async function buildContinuationContext(params: {
  task: TaskContextSnapshot
  steps: TaskStepSnapshot[]
  threadMessages: TaskThreadMessage[]
  instruction: string
  agentId?: string
}): Promise<string> {
  const instruction = params.instruction.trim()
  const recentMessages = params.threadMessages
    .slice(-10)
    .map((message) => `${message.role.toUpperCase()}(${message.mode}): ${clampText(message.content, 500)}`)
    .join('\n')

  const latestStepDigest = params.steps
    .slice(-10)
    .map((step, index) => {
      const detail = step.summary ?? step.result ?? step.error ?? '(no detail)'
      return `${index + 1}. [run ${step.runVersion ?? params.task.runVersion}] [${step.status}] ${step.objective}\n${clampText(detail, 500)}`
    })
    .join('\n\n')

  const retrieval = await retrieveRelevantMemories({
    query: instruction,
    taskId: params.task.id,
    agentId: params.agentId,
    limit: 4,
    maxChars: 1200,
    preferTaskScoped: true,
    includePinned: true,
    includeGraphContext: false,
  })

  return [
    `Continuation requested for task ${params.task.id}.`,
    `Original objective: ${params.task.objective}`,
    `Current run version: ${params.task.runVersion}`,
    `Latest task result:\n${clampText(params.task.result ?? '(empty)', 2_000)}`,
    params.task.error ? `Latest task error:\n${clampText(params.task.error, 800)}` : '',
    latestStepDigest ? `Historical steps summary:\n${latestStepDigest}` : '',
    recentMessages ? `Recent follow-up thread:\n${recentMessages}` : '',
    retrieval.injectedContext ? `Relevant memory context:\n${retrieval.injectedContext}` : '',
    `New instruction:\n${instruction}`,
  ]
    .filter(Boolean)
    .join('\n\n')
}
