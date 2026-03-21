import { randomUUID } from 'node:crypto'
import { getDb } from '../storage/db.js'
import { retrieveRelevantMemories } from '../memory/retriever.js'
import type { LLMProvider, ChatChunk, Message, ProviderMessage } from '../providers/types.js'
import type { RegistrySnapshot, SkillRoutingPolicy } from './registry-snapshot.js'
import { getToolDefinitions } from '../tools/index.js'
import { loadAgentSystemPrompt } from './prompt-loader.js'
import { runWithTools } from './tool-executor.js'
import { deriveScopedSnapshot } from './scoped-snapshot.js'

const MAX_CONTEXT_MESSAGES = 20

export interface RunAgentParams {
  agentId: string
  sessionId: string
  message: string
  provider: LLMProvider
  model: string
  snapshot: RegistrySnapshot
  skillRouting?: SkillRoutingPolicy
}

export interface AgentRunResult {
  sessionId: string
  messageId: string
}

interface DbMessage {
  id: string
  session_id: string
  role: string
  content: string
  created_at: number
  token_count: number | null
}

function toProviderMessages(messages: Message[]): ProviderMessage[] {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({ role: message.role as 'user' | 'assistant', content: message.content }))
}

async function buildUserMessageWithMemoryContext(message: string): Promise<string> {
  const retrieval = await retrieveRelevantMemories({
    query: message,
    limit: 5,
    maxChars: 1200,
  })

  if (!retrieval.injectedContext) {
    return message
  }

  return `${retrieval.injectedContext}\n\n## Current User Request\n${message}`
}

function loadRecentMessages(sessionId: string): Message[] {
  const db = getDb()
  const rows = db
    .prepare<string, DbMessage>(
      `SELECT role, content FROM messages
       WHERE session_id = ?
       ORDER BY created_at DESC
       LIMIT ${MAX_CONTEXT_MESSAGES}`,
    )
    .all(sessionId)

  return rows.reverse().map((row) => ({
    role: row.role as Message['role'],
    content: row.content,
  }))
}

function persistMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
): string {
  const db = getDb()
  const id = randomUUID()
  const now = Date.now()

  db.prepare(
    `INSERT INTO messages (id, session_id, role, content, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, sessionId, role, content, now)

  db.prepare(
    `UPDATE sessions SET updated_at = ? WHERE id = ?`,
  ).run(now, sessionId)

  return id
}

export async function* runAgentStream(
  params: RunAgentParams,
): AsyncIterable<ChatChunk> {
  const { agentId, sessionId, message, provider, model, snapshot, skillRouting } = params
  const scopedSnapshot = deriveScopedSnapshot(snapshot, agentId, skillRouting)

  const systemPrompt = loadAgentSystemPrompt(agentId, scopedSnapshot)
  const history = loadRecentMessages(sessionId)
  const userMessage = await buildUserMessageWithMemoryContext(message)

  persistMessage(sessionId, 'user', message)

  const messages: Message[] = [
    ...history,
    { role: 'user', content: userMessage },
  ]

  let fullReply = ''

  try {
    if (provider.supportsTools && provider.chatWithTools) {
      const result = await runWithTools({
        provider,
        model,
        systemPrompt,
        initialMessages: toProviderMessages(messages),
        tools: getToolDefinitions(scopedSnapshot),
        snapshot: scopedSnapshot,
      })
      fullReply = result.finalText
      if (fullReply) {
        yield { delta: fullReply, done: false }
      }
      yield { delta: '', done: true }
      return
    }

    for await (const chunk of provider.chat({ model, systemPrompt, messages })) {
      if (chunk.delta) {
        fullReply += chunk.delta
      }
      yield chunk
    }
  } finally {
    if (fullReply) {
      persistMessage(sessionId, 'assistant', fullReply)
    }
  }
}

export async function runAgent(params: RunAgentParams): Promise<string> {
  let fullText = ''
  for await (const chunk of runAgentStream(params)) {
    fullText += chunk.delta
  }
  return fullText
}
