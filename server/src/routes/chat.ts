import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { getDb } from '../storage/db.js'
import { runAgentStream } from '../runtime/agent-runner.js'
import { getRuntimeProviderFromEnv, isProviderName, listProviderNames } from '../providers/index.js'
import type { ProviderName } from '../providers/index.js'
import { createRegistrySnapshot } from '../runtime/registry-snapshot-builder.js'
import { parseRegistrySnapshot, serializeRegistrySnapshot } from '../runtime/registry-snapshot.js'

interface CreateSessionBody {
  agentId: string
  provider: ProviderName
  model: string
}

interface SessionRow {
  id: string
  agent_id: string
  created_at: number
  updated_at: number
  metadata: string | null
  registry_snapshot: string | null
}

interface MessageRow {
  id: string
  session_id: string
  role: string
  content: string
  created_at: number
  token_count: number | null
}

interface SessionMetadata {
  provider: ProviderName
  model: string
}

interface ChatBody {
  message: string
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: CreateSessionBody }>('/sessions', async (request, reply) => {
    const { agentId, provider, model } = request.body

    if (!agentId || !provider || !model) {
      return reply.status(400).send({ error: 'agentId, provider, and model are required' })
    }

    const validProviders = listProviderNames()
    if (!isProviderName(provider)) {
      return reply.status(400).send({ error: `Invalid provider. Must be one of: ${validProviders.join(', ')}` })
    }

    const db = getDb()
    const id = randomUUID()
    const now = Date.now()
    const metadata: SessionMetadata = { provider, model }
    const snapshot = createRegistrySnapshot()

    db.prepare(
      `INSERT INTO sessions (id, agent_id, created_at, updated_at, metadata, registry_snapshot)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, agentId, now, now, JSON.stringify(metadata), serializeRegistrySnapshot(snapshot))

    return reply.status(201).send({ id, agentId, provider, model, createdAt: now })
  })

  app.get<{ Params: { id: string } }>('/sessions/:id', async (request, reply) => {
    const { id } = request.params
    const db = getDb()

    const session = db.prepare<string, SessionRow>(
      `SELECT * FROM sessions WHERE id = ?`,
    ).get(id)

    if (!session) {
      return reply.status(404).send({ error: `Session not found: ${id}` })
    }

    const messages = db.prepare<string, MessageRow>(
      `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC`,
    ).all(id)

    const meta = session.metadata ? (JSON.parse(session.metadata) as SessionMetadata) : {}

    return reply.send({
      id: session.id,
      agentId: session.agent_id,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      ...meta,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.created_at,
      })),
    })
  })

  app.post<{ Params: { id: string }; Body: ChatBody }>(
    '/sessions/:id/chat',
    async (request, reply) => {
      const { id } = request.params
      const { message } = request.body
      const origin = request.headers.origin
      const allowLocalOrigin =
        typeof origin === 'string' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)

      if (!message?.trim()) {
        return reply.status(400).send({ error: 'message is required and cannot be empty' })
      }

      const db = getDb()
      const session = db.prepare<string, SessionRow>(
        `SELECT * FROM sessions WHERE id = ?`,
      ).get(id)

      if (!session) {
        return reply.status(404).send({ error: `Session not found: ${id}` })
      }

      const meta = session.metadata
        ? (JSON.parse(session.metadata) as SessionMetadata)
        : null
      const snapshot = parseRegistrySnapshot(session.registry_snapshot)

      if (!meta?.provider || !meta?.model) {
        return reply.status(400).send({ error: 'Session is missing provider or model metadata' })
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

      const write = (data: string) => {
        reply.raw.write(`data: ${data}\n\n`)
      }

      try {
        const provider = getRuntimeProviderFromEnv(meta.provider)

        for await (const chunk of runAgentStream({
          agentId: session.agent_id,
          sessionId: id,
          message: message.trim(),
          provider,
          model: meta.model,
          snapshot,
        })) {
          write(JSON.stringify(chunk))
          if (chunk.done) break
        }
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : 'Internal server error'
        write(JSON.stringify({ error: errMessage, done: true }))
      } finally {
        reply.raw.end()
      }
    },
  )

  app.delete<{ Params: { id: string } }>('/sessions/:id', async (request, reply) => {
    const { id } = request.params
    const db = getDb()

    const session = db.prepare<string, SessionRow>(
      `SELECT id FROM sessions WHERE id = ?`,
    ).get(id)

    if (!session) {
      return reply.status(404).send({ error: `Session not found: ${id}` })
    }

    db.prepare(`DELETE FROM messages WHERE session_id = ?`).run(id)
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id)

    return reply.status(204).send()
  })
}
