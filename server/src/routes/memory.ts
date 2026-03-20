import type { FastifyInstance } from 'fastify'
import {
  saveMemory,
  deleteMemory,
  bulkDeleteMemories,
  listMemories,
  searchMemoriesWithFilters,
  getMemoryById,
  pinMemory,
} from '../memory/store.js'

export async function memoryRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/memories - list memories with optional filters and search
  app.get('/memories', async (req, reply) => {
    const { agentId, taskId, category, limit, q } = req.query as {
      agentId?: string
      taskId?: string
      category?: string
      limit?: string
      q?: string
    }

    const parsedLimit = limit ? parseInt(limit) : 200

    if (q?.trim()) {
      const memories = searchMemoriesWithFilters({
        query: q.trim(),
        agentId,
        taskId,
        category,
        limit: parsedLimit,
      })
      return reply.send({ memories })
    }

    const memories = listMemories({
      agentId,
      taskId,
      category,
      limit: parsedLimit,
    })
    return reply.send({ memories })
  })

  // GET /api/memories/:id
  app.get<{ Params: { id: string } }>('/memories/:id', async (req, reply) => {
    const { id } = req.params
    const memory = getMemoryById(id)
    if (!memory) return reply.status(404).send({ error: 'Memory not found' })
    return reply.send({ memory })
  })

  // POST /api/memories - manually save a memory
  app.post('/memories', async (req, reply) => {
    const body = req.body as {
      content: string
      agentId?: string
      taskId?: string
      category?: string
      isPinned?: boolean
      pinReason?: string
    }

    if (!body.content?.trim()) {
      return reply.status(400).send({ error: 'content is required' })
    }

    const memory = saveMemory({
      content: body.content,
      source: 'manual',
      agentId: body.agentId,
      taskId: body.taskId,
      category: body.category ?? 'general',
      isPinned: body.isPinned ?? false,
      pinSource: body.isPinned ? 'manual' : undefined,
      pinReason: body.pinReason,
    })
    return reply.status(201).send({ memory })
  })

  // POST /api/memories/bulk-delete
  app.post('/memories/bulk-delete', async (req, reply) => {
    const body = req.body as { ids?: string[] }
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      return reply.status(400).send({ error: 'ids must be a non-empty array' })
    }

    const deleted = bulkDeleteMemories(body.ids)
    return reply.send({ deleted })
  })

  // POST /api/memories/:id/pin
  app.post<{ Params: { id: string } }>('/memories/:id/pin', async (req, reply) => {
    const { id } = req.params
    const body = req.body as {
      pinned: boolean
      pinReason?: string
    }

    const existing = getMemoryById(id)
    if (!existing) return reply.status(404).send({ error: 'Memory not found' })

    const updated = pinMemory(id, {
      pinned: body.pinned,
      pinSource: 'manual',
      pinReason: body.pinReason,
    })
    return reply.send({ memory: updated })
  })

  // DELETE /api/memories/:id
  app.delete<{ Params: { id: string } }>('/memories/:id', async (req, reply) => {
    const { id } = req.params
    const memory = getMemoryById(id)
    if (!memory) return reply.status(404).send({ error: 'Memory not found' })
    deleteMemory(id)
    return reply.status(204).send()
  })
}
