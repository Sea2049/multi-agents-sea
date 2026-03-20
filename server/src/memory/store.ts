import { randomUUID } from 'node:crypto'
import { embedPassageText, getLastEmbeddingError } from '../embedding/index.js'
import type { EmbeddingVector } from '../embedding/provider.js'
import { getDb, getDbCapabilities } from '../storage/db.js'

export interface Memory {
  id: string
  agentId?: string
  taskId?: string
  category: string
  content: string
  source: 'manual' | 'task_report' | 'step_summary'
  createdAt: number
  embeddingStatus: MemoryEmbeddingStatus
  embeddingModel?: string
  embeddedAt?: number
  embeddingError?: string
  isPinned: boolean
  pinnedAt?: number
  pinSource?: 'auto' | 'manual'
  pinReason?: string
}

export type MemoryEmbeddingStatus = 'pending' | 'indexed' | 'failed' | 'skipped'

export interface MemorySearchMatch {
  memory: Memory
  rank: number
  source: 'fts' | 'semantic'
  score: number
}

type MemoryInput = Omit<
  Memory,
  'id' | 'createdAt' | 'embeddingStatus' | 'embeddingModel' | 'embeddedAt' | 'embeddingError' | 'isPinned' | 'pinnedAt' | 'pinSource' | 'pinReason'
> & {
  isPinned?: boolean
  pinSource?: 'auto' | 'manual'
  pinReason?: string
}

interface MemoryRow {
  id: string
  agent_id: string | null
  task_id: string | null
  category: string
  content: string
  source: string
  created_at: number
  embedding_status: MemoryEmbeddingStatus
  embedding_model: string | null
  embedded_at: number | null
  embedding_error: string | null
  is_pinned: number
  pinned_at: number | null
  pin_source: string | null
  pin_reason: string | null
}

function rowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    agentId: row.agent_id ?? undefined,
    taskId: row.task_id ?? undefined,
    category: row.category,
    content: row.content,
    source: row.source as Memory['source'],
    createdAt: row.created_at,
    embeddingStatus: row.embedding_status,
    embeddingModel: row.embedding_model ?? undefined,
    embeddedAt: row.embedded_at ?? undefined,
    embeddingError: row.embedding_error ?? undefined,
    isPinned: row.is_pinned === 1,
    pinnedAt: row.pinned_at ?? undefined,
    pinSource: (row.pin_source as Memory['pinSource']) ?? undefined,
    pinReason: row.pin_reason ?? undefined,
  }
}

function normalizeFtsQuery(query: string): string {
  return query.replace(/['"*\[\](){}^~?\\]/g, ' ').replace(/\s+/g, ' ').trim()
}

function updateMemoryEmbeddingState(params: {
  id: string
  status: MemoryEmbeddingStatus
  embeddingModel?: string
  embeddedAt?: number
  embeddingError?: string
}): void {
  const db = getDb()

  db.prepare(`
    UPDATE memories
    SET embedding_status = ?,
        embedding_model = ?,
        embedded_at = ?,
        embedding_error = ?
    WHERE id = ?
  `).run(
    params.status,
    params.embeddingModel ?? null,
    params.embeddedAt ?? null,
    params.embeddingError ?? null,
    params.id,
  )
}

function getUnavailableEmbeddingReason(): string {
  const embeddingError = getLastEmbeddingError()
  if (embeddingError) {
    return `Embedding provider unavailable: ${embeddingError}`
  }

  return 'Embedding provider unavailable'
}

function getSqliteVecUnavailableReason(): string {
  const capabilities = getDbCapabilities()
  if (capabilities.sqliteVec.error) {
    return `sqlite-vec unavailable: ${capabilities.sqliteVec.error}`
  }

  return 'sqlite-vec unavailable'
}

function writeMemoryEmbedding(memoryId: string, vector: EmbeddingVector): void {
  const db = getDb()
  const now = Date.now()

  db.transaction(() => {
    db.prepare('DELETE FROM memory_embeddings WHERE memory_id = ?').run(memoryId)
    db.prepare(`
      INSERT INTO memory_embeddings (
        memory_id,
        embedding,
        embedding_model,
        dimensions,
        created_at,
        updated_at
      )
      VALUES (?, vec_f32(?), ?, ?, ?, ?)
    `).run(
      memoryId,
      JSON.stringify(vector.values),
      vector.model,
      vector.dimensions,
      now,
      now,
    )

    updateMemoryEmbeddingState({
      id: memoryId,
      status: 'indexed',
      embeddingModel: vector.model,
      embeddedAt: now,
    })
  })()
}

async function indexMemory(memoryId: string): Promise<void> {
  const db = getDb()
  const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(memoryId) as MemoryRow | undefined

  if (!row) {
    return
  }

  if (!row.content.trim()) {
    updateMemoryEmbeddingState({
      id: memoryId,
      status: 'skipped',
      embeddingError: 'Memory content is empty',
    })
    return
  }

  const capabilities = getDbCapabilities()
  if (!capabilities.sqliteVec.available) {
    updateMemoryEmbeddingState({
      id: memoryId,
      status: 'skipped',
      embeddingError: getSqliteVecUnavailableReason(),
    })
    return
  }

  let vector: EmbeddingVector | null = null
  try {
    vector = await embedPassageText(row.content)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    updateMemoryEmbeddingState({
      id: memoryId,
      status: 'failed',
      embeddingError: message,
    })
    return
  }

  if (!vector) {
    updateMemoryEmbeddingState({
      id: memoryId,
      status: 'skipped',
      embeddingError: getUnavailableEmbeddingReason(),
    })
    return
  }

  try {
    writeMemoryEmbedding(memoryId, vector)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    updateMemoryEmbeddingState({
      id: memoryId,
      status: 'failed',
      embeddingModel: vector.model,
      embeddingError: message,
    })
  }
}

let indexingQueue: Promise<void> = Promise.resolve()

function enqueueMemoryIndexing(memoryId: string): void {
  indexingQueue = indexingQueue
    .catch(() => undefined)
    .then(async () => {
      await indexMemory(memoryId)
    })
}

export function saveMemory(memory: MemoryInput): Memory {
  const db = getDb()
  const id = randomUUID()
  const createdAt = Date.now()
  const isPinned = memory.isPinned ? 1 : 0
  const pinnedAt = memory.isPinned ? createdAt : null

  db.prepare(`
    INSERT INTO memories (
      id,
      agent_id,
      task_id,
      category,
      content,
      source,
      created_at,
      embedding_status,
      is_pinned,
      pinned_at,
      pin_source,
      pin_reason
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    memory.agentId ?? null,
    memory.taskId ?? null,
    memory.category,
    memory.content,
    memory.source,
    createdAt,
    'pending',
    isPinned,
    pinnedAt,
    memory.pinSource ?? null,
    memory.pinReason ?? null,
  )

  enqueueMemoryIndexing(id)

  return {
    ...memory,
    id,
    createdAt,
    embeddingStatus: 'pending',
    isPinned: memory.isPinned ?? false,
    pinnedAt: isPinned ? createdAt : undefined,
  }
}

export function deleteMemory(id: string): void {
  const db = getDb()
  db.prepare('DELETE FROM memory_embeddings WHERE memory_id = ?').run(id)
  db.prepare('DELETE FROM memories WHERE id = ?').run(id)
}

export function listMemories(filter?: {
  agentId?: string
  taskId?: string
  category?: string
  limit?: number
}): Memory[] {
  const db = getDb()
  const conditions: string[] = []
  const params: unknown[] = []

  if (filter?.agentId) {
    conditions.push('agent_id = ?')
    params.push(filter.agentId)
  }
  if (filter?.taskId) {
    conditions.push('task_id = ?')
    params.push(filter.taskId)
  }
  if (filter?.category) {
    conditions.push('category = ?')
    params.push(filter.category)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = filter?.limit ?? 50
  const rows = db
    .prepare(`SELECT * FROM memories ${where} ORDER BY is_pinned DESC, pinned_at DESC, created_at DESC LIMIT ?`)
    .all(...params, limit) as MemoryRow[]
  return rows.map(rowToMemory)
}

export function searchMemoriesWithFilters(params: {
  query: string
  agentId?: string
  taskId?: string
  category?: string
  limit?: number
}): Memory[] {
  const safeQuery = normalizeFtsQuery(params.query)
  if (!safeQuery) {
    return listMemories({ agentId: params.agentId, taskId: params.taskId, category: params.category, limit: params.limit })
  }

  const db = getDb()
  const conditions: string[] = ['memories_fts MATCH ?']
  const sqlParams: unknown[] = [safeQuery]

  if (params.agentId) {
    conditions.push('m.agent_id = ?')
    sqlParams.push(params.agentId)
  }
  if (params.taskId) {
    conditions.push('m.task_id = ?')
    sqlParams.push(params.taskId)
  }
  if (params.category) {
    conditions.push('m.category = ?')
    sqlParams.push(params.category)
  }

  const limit = params.limit ?? 50
  sqlParams.push(limit)

  const where = `WHERE ${conditions.join(' AND ')}`

  try {
    const rows = db
      .prepare(`
        SELECT m.*, bm25(memories_fts) AS lexical_score
        FROM memories m
        JOIN memories_fts ON m.rowid = memories_fts.rowid
        ${where}
        ORDER BY m.is_pinned DESC, lexical_score ASC, m.created_at DESC
        LIMIT ?
      `)
      .all(...sqlParams) as Array<MemoryRow & { lexical_score: number }>
    return rows.map(rowToMemory)
  } catch {
    return listMemories({ agentId: params.agentId, taskId: params.taskId, category: params.category, limit: params.limit })
  }
}

export function pinMemory(id: string, params: {
  pinned: boolean
  pinSource?: 'auto' | 'manual'
  pinReason?: string
}): Memory | undefined {
  const db = getDb()
  const now = Date.now()

  if (params.pinned) {
    db.prepare(`
      UPDATE memories
      SET is_pinned = 1, pinned_at = ?, pin_source = ?, pin_reason = ?
      WHERE id = ?
    `).run(now, params.pinSource ?? 'manual', params.pinReason ?? null, id)
  } else {
    db.prepare(`
      UPDATE memories
      SET is_pinned = 0, pinned_at = NULL, pin_source = NULL, pin_reason = NULL
      WHERE id = ?
    `).run(id)
  }

  return getMemoryById(id)
}

export function bulkDeleteMemories(ids: string[]): number {
  if (ids.length === 0) return 0

  const db = getDb()
  const placeholders = ids.map(() => '?').join(', ')

  db.prepare(`DELETE FROM memory_embeddings WHERE memory_id IN (${placeholders})`).run(...ids)
  const result = db.prepare(`DELETE FROM memories WHERE id IN (${placeholders})`).run(...ids)

  return result.changes
}

export function searchMemories(query: string, limit = 5): Memory[] {
  const safeQuery = normalizeFtsQuery(query)
  if (!safeQuery) {
    return []
  }

  try {
    return searchMemoriesFts(safeQuery, limit).map((match) => match.memory)
  } catch {
    return []
  }
}

export function searchMemoriesFts(query: string, limit = 5): MemorySearchMatch[] {
  const db = getDb()
  const rows = db
    .prepare(`
      SELECT m.*, bm25(memories_fts) AS lexical_score
      FROM memories m
      JOIN memories_fts ON m.rowid = memories_fts.rowid
      WHERE memories_fts MATCH ?
      ORDER BY lexical_score ASC, m.created_at DESC
      LIMIT ?
    `)
    .all(query, limit) as Array<MemoryRow & { lexical_score: number }>

  return rows.map((row, index) => ({
    memory: rowToMemory(row),
    rank: index + 1,
    source: 'fts',
    score: row.lexical_score,
  }))
}

export function searchMemoriesSemantic(queryVector: EmbeddingVector, limit = 5): MemorySearchMatch[] {
  const capabilities = getDbCapabilities()
  if (!capabilities.sqliteVec.available) {
    return []
  }

  const db = getDb()
  const rows = db
    .prepare(`
      SELECT m.*, vec_distance_cosine(me.embedding, vec_f32(?)) AS semantic_distance
      FROM memory_embeddings me
      JOIN memories m ON m.id = me.memory_id
      WHERE me.dimensions = ?
        AND m.embedding_status = 'indexed'
      ORDER BY semantic_distance ASC, m.created_at DESC
      LIMIT ?
    `)
    .all(
      JSON.stringify(queryVector.values),
      queryVector.dimensions,
      limit,
    ) as Array<MemoryRow & { semantic_distance: number }>

  return rows.map((row, index) => ({
    memory: rowToMemory(row),
    rank: index + 1,
    source: 'semantic',
    score: row.semantic_distance,
  }))
}

export function hasIndexedMemoryEmbeddings(): boolean {
  const capabilities = getDbCapabilities()
  if (!capabilities.sqliteVec.available) {
    return false
  }

  const db = getDb()
  const row = db
    .prepare(`
      SELECT 1 AS value
      FROM memory_embeddings me
      JOIN memories m ON m.id = me.memory_id
      WHERE m.embedding_status = 'indexed'
      LIMIT 1
    `)
    .get() as { value: number } | undefined

  return row?.value === 1
}

export function getMemoryById(id: string): Memory | undefined {
  const db = getDb()
  const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow | undefined
  return row ? rowToMemory(row) : undefined
}

export async function flushMemoryIndexingQueue(): Promise<void> {
  await indexingQueue.catch(() => undefined)
}

export { normalizeFtsQuery }
