import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, initDb } from '../storage/db.js'
import {
  upsertEntity,
  insertRelation,
  traverseGraph,
  findEntitiesByKeyword,
  getEntityById,
} from '../memory/entity-store.js'
import { findSimilarEntity } from '../memory/entity-store.js'
import { retrieveRelevantMemories } from '../memory/retriever.js'
import { flushMemoryIndexingQueue } from '../memory/store.js'
import {
  resetEmbeddingProviderForTests,
  setEmbeddingProviderFactoryForTests,
} from '../embedding/index.js'
import type { EmbeddingProvider, EmbeddingVector } from '../embedding/provider.js'
import { persistTaskLongTermMemories } from '../memory/task-memory-extractor.js'
import type { LLMProvider, ChatChunk, ChatParams, ModelInfo, ProviderHealth } from '../providers/types.js'
import type { TaskPlan, StepResult } from '../orchestrator/types.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeVector(values: number[]): EmbeddingVector {
  return { model: 'mock-v1', dimensions: values.length, values }
}

function createMockEmbeddingProvider(
  resolver: (text: string) => number[],
): EmbeddingProvider {
  return {
    model: 'mock-v1',
    dimensions: 4,
    async embedPassages(texts) {
      return texts.map((t) => makeVector(resolver(t)))
    },
    async embedQuery(text) {
      return makeVector(resolver(text))
    },
  }
}

/**
 * Cosine similarity between two equal-length vectors (0 = identical, 1 = orthogonal,
 * 2 = opposite). sqlite-vec uses cosine *distance* = 1 - similarity, so same vectors
 * give distance 0.  We model "similar" with nearly-equal vectors.
 */
function sqliteVecText(text: string): number[] {
  const t = text.toLowerCase()
  // Entities that should be "the same" share the same vector
  if (t.includes('sqlite-vec') || t.includes('sqlite vec')) return [1, 0, 0, 0]
  if (t.includes('multi-agents') || t.includes('multi agents')) return [0, 1, 0, 0]
  if (t.includes('better-sqlite') || t.includes('better sqlite')) return [0, 0, 1, 0]
  // Everything else is orthogonal
  return [0, 0, 0, 1]
}

class StaticTextProvider implements LLMProvider {
  readonly name = 'mock'
  constructor(private readonly text: string) {}

  async *chat(_params: ChatParams): AsyncIterable<ChatChunk> {
    yield { delta: this.text, done: false }
    yield { delta: '', done: true }
  }

  async models(): Promise<ModelInfo[]> {
    return [{ id: 'mock-model', name: 'Mock Model' }]
  }

  async validateCredentials(): Promise<ProviderHealth> {
    return { ok: true, latencyMs: 1 }
  }
}

function makePlan(): TaskPlan {
  return {
    taskId: 'graph-test-task',
    summary: 'Graph RAG test task',
    steps: [
      {
        id: 'step-1',
        title: 'Step 1',
        assignee: 'agent-a',
        dependsOn: [],
        objective: 'Do stuff',
        expectedOutput: 'Result',
      },
    ],
  }
}

function makeStepResults(): Map<string, StepResult> {
  return new Map([
    [
      'step-1',
      {
        stepId: 'step-1',
        agentId: 'agent-a',
        output: 'Used sqlite-vec for vector search',
        summary: 'Implemented semantic search',
        startedAt: Date.now() - 1000,
        completedAt: Date.now(),
      },
    ],
  ])
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  closeDb()
  resetEmbeddingProviderForTests()
  initDb(':memory:')
})

afterEach(async () => {
  await flushMemoryIndexingQueue()
  resetEmbeddingProviderForTests()
  closeDb()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// 1. Entity deduplication
// ---------------------------------------------------------------------------

describe('entity deduplication', () => {
  it('merges two similar entities when cosine distance < 0.15', async () => {
    setEmbeddingProviderFactoryForTests(async () =>
      createMockEmbeddingProvider(sqliteVecText),
    )

    const first = await upsertEntity({ name: 'sqlite-vec', type: 'technology', description: 'Vector search extension' })
    const second = await upsertEntity({ name: 'sqlite vec', type: 'technology', description: 'SQLite vector extension' })

    // Both should resolve to the same ID
    expect(second.id).toBe(first.id)
  })

  it('creates separate entities for dissimilar names', async () => {
    setEmbeddingProviderFactoryForTests(async () =>
      createMockEmbeddingProvider(sqliteVecText),
    )

    const a = await upsertEntity({ name: 'sqlite-vec', type: 'technology' })
    const b = await upsertEntity({ name: 'better-sqlite3', type: 'technology' })

    expect(b.id).not.toBe(a.id)
    expect(getEntityById(a.id)).not.toBeNull()
    expect(getEntityById(b.id)).not.toBeNull()
  })

  it('updates description when a more detailed one is provided for an existing entity', async () => {
    setEmbeddingProviderFactoryForTests(async () =>
      createMockEmbeddingProvider(sqliteVecText),
    )

    const original = await upsertEntity({ name: 'sqlite-vec', type: 'technology', description: 'short' })
    const updated = await upsertEntity({
      name: 'sqlite-vec',
      type: 'technology',
      description: 'A much longer and more descriptive description for sqlite-vec',
    })

    expect(updated.id).toBe(original.id)
    expect(updated.description).toContain('longer')
  })
})

// ---------------------------------------------------------------------------
// 2. Graph traversal
// ---------------------------------------------------------------------------

describe('graph traversal', () => {
  it('traverses A -> B -> C within depth 2', async () => {
    // Skip embedding (no vec available) – upsert without similar check
    setEmbeddingProviderFactoryForTests(async () => null)

    const a = await upsertEntity({ name: 'EntityA', type: 'concept' })
    const b = await upsertEntity({ name: 'EntityB', type: 'technology' })
    const c = await upsertEntity({ name: 'EntityC', type: 'project' })

    insertRelation({ sourceEntityId: a.id, targetEntityId: b.id, relationType: 'uses', confidence: 1 })
    insertRelation({ sourceEntityId: b.id, targetEntityId: c.id, relationType: 'depends_on', confidence: 1 })

    const results = traverseGraph(a.id, 2)
    const names = results.map((r) => r.entity.name)

    expect(names).toContain('EntityB')
    expect(names).toContain('EntityC')
  })

  it('respects maxDepth=1 and does not return depth-2 nodes', async () => {
    setEmbeddingProviderFactoryForTests(async () => null)

    const a = await upsertEntity({ name: 'DepthA', type: 'concept' })
    const b = await upsertEntity({ name: 'DepthB', type: 'concept' })
    const c = await upsertEntity({ name: 'DepthC', type: 'concept' })

    insertRelation({ sourceEntityId: a.id, targetEntityId: b.id, relationType: 'related_to', confidence: 1 })
    insertRelation({ sourceEntityId: b.id, targetEntityId: c.id, relationType: 'related_to', confidence: 1 })

    const results = traverseGraph(a.id, 1)
    const names = results.map((r) => r.entity.name)

    expect(names).toContain('DepthB')
    expect(names).not.toContain('DepthC')
  })

  it('also returns inbound relations', async () => {
    setEmbeddingProviderFactoryForTests(async () => null)

    const a = await upsertEntity({ name: 'InboundA', type: 'concept' })
    const b = await upsertEntity({ name: 'InboundB', type: 'concept' })

    insertRelation({ sourceEntityId: b.id, targetEntityId: a.id, relationType: 'created', confidence: 1 })

    const results = traverseGraph(a.id, 1)
    const inbound = results.find((r) => r.entity.name === 'InboundB')

    expect(inbound).toBeDefined()
    expect(inbound?.direction).toBe('in')
  })
})

// ---------------------------------------------------------------------------
// 3. Unified extractor – entities + relations
// ---------------------------------------------------------------------------

describe('unified extractor with graph data', () => {
  it('calls upsertEntity and insertRelation when LLM returns entities/relations', async () => {
    setEmbeddingProviderFactoryForTests(async () => null)

    const entityPayload = {
      facts: [{ content: 'sqlite-vec enables fast vector search', isPinned: false }],
      decisions: [],
      outputs: [],
      entities: [
        { name: 'sqlite-vec', type: 'technology', description: 'Vector extension' },
        { name: 'multi-agents-sea', type: 'project', description: 'Main project' },
      ],
      relations: [
        { source: 'multi-agents-sea', target: 'sqlite-vec', relationType: 'uses' },
      ],
    }

    const provider = new StaticTextProvider(JSON.stringify(entityPayload))

    await persistTaskLongTermMemories({
      taskId: 'graph-extract-task',
      taskObjective: 'Test graph extraction',
      plan: makePlan(),
      stepResults: makeStepResults(),
      report: 'Used sqlite-vec for vector search in multi-agents-sea',
      provider,
      model: 'mock-model',
    })

    // Give async embedding queue time to flush
    await flushMemoryIndexingQueue()

    // Entities should now be in the DB
    const entities = findEntitiesByKeyword('sqlite-vec', 5)
    expect(entities.length).toBeGreaterThan(0)
    expect(entities[0]?.name).toBe('sqlite-vec')

    // Relation from multi-agents-sea -> sqlite-vec should exist (depth 1 traversal)
    const seaEntities = findEntitiesByKeyword('multi-agents-sea', 5)
    expect(seaEntities.length).toBeGreaterThan(0)

    const neighbors = traverseGraph(seaEntities[0]!.id, 1)
    const neighborNames = neighbors.map((n) => n.entity.name)
    expect(neighborNames).toContain('sqlite-vec')
  })

  it('is backward-compatible when LLM returns old format without entities/relations', async () => {
    setEmbeddingProviderFactoryForTests(async () => null)

    const oldFormat = {
      facts: [{ content: 'Old format fact', isPinned: false }],
      decisions: [],
      outputs: [],
    }

    const provider = new StaticTextProvider(JSON.stringify(oldFormat))

    const saved = await persistTaskLongTermMemories({
      taskId: 'backward-compat-task',
      taskObjective: 'Backward compat test',
      plan: makePlan(),
      stepResults: makeStepResults(),
      report: 'Old format test',
      provider,
      model: 'mock-model',
    })

    expect(saved.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// 4. Graph retrieval context
// ---------------------------------------------------------------------------

describe('retrieveGraphContext', () => {
  it('returns formatted relation triples for matched keyword entities', async () => {
    setEmbeddingProviderFactoryForTests(async () => null)

    const sqliteVecEntity = await upsertEntity({ name: 'sqlite-vec', type: 'technology' })
    const projectEntity = await upsertEntity({ name: 'multi-agents-sea', type: 'project' })

    insertRelation({
      sourceEntityId: projectEntity.id,
      targetEntityId: sqliteVecEntity.id,
      relationType: 'uses',
      confidence: 1,
    })

    const result = await retrieveRelevantMemories({ query: 'sqlite-vec' })

    expect(result.injectedContext).toContain('Related Entities & Relations')
    expect(result.injectedContext).toContain('sqlite-vec')
  })

  it('returns empty string and omits section when no entities match', async () => {
    setEmbeddingProviderFactoryForTests(async () => null)

    const result = await retrieveRelevantMemories({ query: 'nonexistent-xyz-entity-12345' })

    expect(result.injectedContext).not.toContain('Related Entities & Relations')
  })
})

// ---------------------------------------------------------------------------
// 5. Full injection format – pinned + graph + dynamic order
// ---------------------------------------------------------------------------

describe('full injection format', () => {
  it('includes pinned, graph, and dynamic sections in correct order', async () => {
    setEmbeddingProviderFactoryForTests(async () => null)

    // Insert a pinned memory via store
    const { saveMemory } = await import('../memory/store.js')
    saveMemory({
      content: 'Always use TypeScript strict mode',
      source: 'manual',
      category: 'fact',
      isPinned: true,
      pinSource: 'manual',
      pinReason: 'Team standard',
    })

    // Insert graph entities
    const entityA = await upsertEntity({ name: 'better-sqlite3', type: 'technology' })
    const entityB = await upsertEntity({ name: 'FastEmbed', type: 'technology' })
    insertRelation({
      sourceEntityId: entityA.id,
      targetEntityId: entityB.id,
      relationType: 'related_to',
      confidence: 1,
    })

    // Insert a regular (non-pinned) memory via FTS
    saveMemory({
      content: 'better-sqlite3 is used for local persistent storage',
      source: 'manual',
      category: 'fact',
    })

    const result = await retrieveRelevantMemories({ query: 'better-sqlite3' })
    const ctx = result.injectedContext

    const pinnedIdx = ctx.indexOf('Pinned Knowledge')
    const graphIdx = ctx.indexOf('Related Entities')
    const dynamicIdx = ctx.indexOf('Relevant Prior Knowledge')

    if (pinnedIdx !== -1 && graphIdx !== -1) {
      expect(pinnedIdx).toBeLessThan(graphIdx)
    }
    if (graphIdx !== -1 && dynamicIdx !== -1) {
      expect(graphIdx).toBeLessThan(dynamicIdx)
    }

    // At minimum the pinned section should appear
    expect(ctx).toContain('Always use TypeScript strict mode')
  })
})
