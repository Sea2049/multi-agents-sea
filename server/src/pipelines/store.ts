import { randomUUID } from 'node:crypto'
import { getDb } from '../storage/db.js'
import type { PipelineDefinition, StoredPipelineRecord } from './types.js'

interface PipelineRow {
  id: string
  name: string
  description: string | null
  definition: string
  version: number
  created_at: number
  updated_at: number
}

function parsePipelineRow(row: PipelineRow): StoredPipelineRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    version: row.version,
    definition: JSON.parse(row.definition) as PipelineDefinition,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listPipelines(): StoredPipelineRecord[] {
  const db = getDb()
  const rows = db
    .prepare<[], PipelineRow>(`
      SELECT id, name, description, definition, version, created_at, updated_at
      FROM pipelines
      ORDER BY updated_at DESC
    `)
    .all()

  return rows.map(parsePipelineRow)
}

export function getPipelineById(id: string): StoredPipelineRecord | null {
  const db = getDb()
  const row = db
    .prepare<[string], PipelineRow>(`
      SELECT id, name, description, definition, version, created_at, updated_at
      FROM pipelines
      WHERE id = ?
    `)
    .get(id)

  return row ? parsePipelineRow(row) : null
}

export function createPipeline(input: {
  name: string
  description?: string
  definition: Omit<PipelineDefinition, 'id' | 'version'>
}): StoredPipelineRecord {
  const db = getDb()
  const id = randomUUID()
  const now = Date.now()
  const definition: PipelineDefinition = {
    ...input.definition,
    id,
    version: 1,
  }

  db.prepare(`
    INSERT INTO pipelines (id, name, description, definition, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name.trim(),
    input.description?.trim() || null,
    JSON.stringify(definition),
    definition.version,
    now,
    now,
  )

  return {
    id,
    name: input.name.trim(),
    description: input.description?.trim() || undefined,
    version: definition.version,
    definition,
    createdAt: now,
    updatedAt: now,
  }
}

export function updatePipeline(input: {
  id: string
  name: string
  description?: string
  definition: Omit<PipelineDefinition, 'id' | 'version'>
}): StoredPipelineRecord {
  const existing = getPipelineById(input.id)
  if (!existing) {
    throw new Error(`Pipeline not found: ${input.id}`)
  }

  const db = getDb()
  const now = Date.now()
  const nextVersion = existing.version + 1
  const definition: PipelineDefinition = {
    ...input.definition,
    id: existing.id,
    version: nextVersion,
  }

  db.prepare(`
    UPDATE pipelines
    SET name = ?, description = ?, definition = ?, version = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.name.trim(),
    input.description?.trim() || null,
    JSON.stringify(definition),
    nextVersion,
    now,
    existing.id,
  )

  return {
    id: existing.id,
    name: input.name.trim(),
    description: input.description?.trim() || undefined,
    version: nextVersion,
    definition,
    createdAt: existing.createdAt,
    updatedAt: now,
  }
}

export function deletePipeline(id: string): void {
  const db = getDb()
  db.prepare(`DELETE FROM pipelines WHERE id = ?`).run(id)
}
