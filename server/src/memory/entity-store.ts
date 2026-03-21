import { randomUUID } from 'node:crypto'
import { getDb, getDbCapabilities } from '../storage/db.js'
import { embedPassageText } from '../embedding/index.js'

export interface Entity {
  id: string
  name: string
  type: string
  description?: string
  sourceMemoryId?: string
  embeddingStatus: 'pending' | 'indexed'
  createdAt: number
  updatedAt: number
}

export interface Relation {
  id: string
  sourceEntityId: string
  targetEntityId: string
  relationType: string
  confidence: number
  sourceMemoryId?: string
  createdAt: number
}

interface EntityRow {
  id: string
  name: string
  type: string
  description: string | null
  source_memory_id: string | null
  embedding_status: 'pending' | 'indexed'
  created_at: number
  updated_at: number
}

interface RelationRow {
  id: string
  source_entity_id: string
  target_entity_id: string
  relation_type: string
  confidence: number
  source_memory_id: string | null
  created_at: number
}

interface GraphTraversalRow extends EntityRow {
  relation_type: string
  direction: 'out' | 'in'
  depth: number
}

function rowToEntity(row: EntityRow): Entity {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    description: row.description ?? undefined,
    sourceMemoryId: row.source_memory_id ?? undefined,
    embeddingStatus: row.embedding_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function rowToRelation(row: RelationRow): Relation {
  return {
    id: row.id,
    sourceEntityId: row.source_entity_id,
    targetEntityId: row.target_entity_id,
    relationType: row.relation_type,
    confidence: row.confidence,
    sourceMemoryId: row.source_memory_id ?? undefined,
    createdAt: row.created_at,
  }
}

async function storeEntityEmbedding(entityId: string, name: string, description?: string): Promise<void> {
  const text = description ? `${name} ${description}` : name
  try {
    const vector = await embedPassageText(text)
    if (!vector) return

    const db = getDb()
    const now = Date.now()
    db.prepare(`
      INSERT OR REPLACE INTO entity_embeddings (entity_id, embedding, embedding_model, created_at)
      VALUES (?, vec_f32(?), ?, ?)
    `).run(entityId, JSON.stringify(vector.values), vector.model, now)

    db.prepare(`
      UPDATE entities SET embedding_status = 'indexed', updated_at = ? WHERE id = ?
    `).run(now, entityId)
  } catch (error) {
    console.error('[entity-store] Failed to store entity embedding:', error instanceof Error ? error.message : String(error))
  }
}

export async function findSimilarEntity(name: string, description?: string): Promise<Entity | null> {
  const capabilities = getDbCapabilities()
  if (!capabilities.sqliteVec.available) {
    return null
  }

  const text = description ? `${name} ${description}` : name
  const vector = await embedPassageText(text)
  if (!vector) return null

  const db = getDb()
  try {
    const row = db.prepare(`
      SELECT e.*
      FROM entity_embeddings ee
      JOIN entities e ON e.id = ee.entity_id
      WHERE vec_distance_cosine(ee.embedding, vec_f32(?)) < 0.15
      ORDER BY vec_distance_cosine(ee.embedding, vec_f32(?)) ASC
      LIMIT 1
    `).get(
      JSON.stringify(vector.values),
      JSON.stringify(vector.values),
    ) as EntityRow | undefined

    return row ? rowToEntity(row) : null
  } catch (error) {
    console.error('[entity-store] findSimilarEntity error:', error instanceof Error ? error.message : String(error))
    return null
  }
}

export async function upsertEntity(
  entity: Omit<Entity, 'id' | 'embeddingStatus' | 'createdAt' | 'updatedAt'>,
): Promise<Entity> {
  const existing = await findSimilarEntity(entity.name, entity.description)

  if (existing) {
    const shouldUpdateDescription =
      entity.description &&
      (!existing.description || entity.description.length > existing.description.length)

    if (shouldUpdateDescription) {
      const db = getDb()
      const now = Date.now()
      db.prepare(`
        UPDATE entities SET description = ?, updated_at = ? WHERE id = ?
      `).run(entity.description ?? null, now, existing.id)
      return { ...existing, description: entity.description, updatedAt: now }
    }

    return existing
  }

  const db = getDb()
  const id = randomUUID()
  const now = Date.now()

  db.prepare(`
    INSERT INTO entities (id, name, type, description, source_memory_id, embedding_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(
    id,
    entity.name,
    entity.type,
    entity.description ?? null,
    entity.sourceMemoryId ?? null,
    now,
    now,
  )

  const newEntity: Entity = {
    id,
    name: entity.name,
    type: entity.type,
    description: entity.description,
    sourceMemoryId: entity.sourceMemoryId,
    embeddingStatus: 'pending',
    createdAt: now,
    updatedAt: now,
  }

  void storeEntityEmbedding(id, entity.name, entity.description)

  return newEntity
}

export function insertRelation(
  relation: Omit<Relation, 'id' | 'createdAt'>,
): Relation {
  const db = getDb()
  const id = randomUUID()
  const now = Date.now()

  db.prepare(`
    INSERT INTO relations (id, source_entity_id, target_entity_id, relation_type, confidence, source_memory_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    relation.sourceEntityId,
    relation.targetEntityId,
    relation.relationType,
    relation.confidence,
    relation.sourceMemoryId ?? null,
    now,
  )

  return { ...relation, id, createdAt: now }
}

export function traverseGraph(
  startEntityId: string,
  maxDepth = 2,
): Array<{ entity: Entity; relationType: string; direction: 'out' | 'in'; depth: number }> {
  const safeDepth = Math.min(maxDepth, 2)
  const db = getDb()

  try {
    const rows = db.prepare(`
      WITH RECURSIVE graph(entity_id, relation_type, direction, depth) AS (
        SELECT ?, 'start', 'self', 0
        UNION ALL
        SELECT r.target_entity_id, r.relation_type, 'out', g.depth + 1
        FROM relations r JOIN graph g ON r.source_entity_id = g.entity_id
        WHERE g.depth < ?
        UNION ALL
        SELECT r.source_entity_id, r.relation_type, 'in', g.depth + 1
        FROM relations r JOIN graph g ON r.target_entity_id = g.entity_id
        WHERE g.depth < ?
      )
      SELECT DISTINCT e.*, g.relation_type, g.direction, g.depth
      FROM graph g JOIN entities e ON g.entity_id = e.id
      WHERE g.depth > 0
      ORDER BY g.depth
    `).all(startEntityId, safeDepth, safeDepth) as GraphTraversalRow[]

    return rows.map((row) => ({
      entity: rowToEntity(row),
      relationType: row.relation_type,
      direction: row.direction,
      depth: row.depth,
    }))
  } catch (error) {
    console.error('[entity-store] traverseGraph error:', error instanceof Error ? error.message : String(error))
    return []
  }
}

export function findEntitiesByKeyword(query: string, limit = 10): Entity[] {
  const db = getDb()
  const pattern = `%${query}%`

  try {
    const rows = db.prepare(`
      SELECT * FROM entities
      WHERE name LIKE ? OR description LIKE ?
      ORDER BY name ASC
      LIMIT ?
    `).all(pattern, pattern, limit) as EntityRow[]

    return rows.map(rowToEntity)
  } catch (error) {
    console.error('[entity-store] findEntitiesByKeyword error:', error instanceof Error ? error.message : String(error))
    return []
  }
}

export function getEntityById(id: string): Entity | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as EntityRow | undefined
  return row ? rowToEntity(row) : null
}

export function deleteEntity(id: string): void {
  const db = getDb()
  db.prepare('DELETE FROM entities WHERE id = ?').run(id)
}

export { rowToRelation }
