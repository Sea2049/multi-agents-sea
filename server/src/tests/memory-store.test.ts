import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetEmbeddingProviderForTests, setEmbeddingProviderFactoryForTests } from '../embedding/index.js'
import type { EmbeddingProvider, EmbeddingVector } from '../embedding/provider.js'
import { deleteMemory, flushMemoryIndexingQueue, getMemoryById, saveMemory } from '../memory/store.js'
import { closeDb, getDb, initDb } from '../storage/db.js'

function createMockProvider(): EmbeddingProvider {
  const toVector = (text: string): EmbeddingVector => {
    const normalized = text.toLowerCase()
    if (normalized.includes('typescript')) {
      return { model: 'mock-embedding-v1', dimensions: 3, values: [1, 0, 0] }
    }

    if (normalized.includes('task')) {
      return { model: 'mock-embedding-v1', dimensions: 3, values: [0, 1, 0] }
    }

    return { model: 'mock-embedding-v1', dimensions: 3, values: [0, 0, 1] }
  }

  return {
    model: 'mock-embedding-v1',
    dimensions: 3,
    async embedPassages(texts) {
      return texts.map((text) => toVector(text))
    },
    async embedQuery(text) {
      return toVector(text)
    },
  }
}

beforeEach(() => {
  closeDb()
  resetEmbeddingProviderForTests()
  initDb(':memory:')
})

afterEach(async () => {
  await flushMemoryIndexingQueue()
  resetEmbeddingProviderForTests()
  closeDb()
})

describe('memory store background indexing', () => {
  it('returns pending immediately and becomes indexed after the async worker finishes', async () => {
    setEmbeddingProviderFactoryForTests(async () => createMockProvider())

    const saved = saveMemory({
      content: 'TypeScript generics allow type-safe data structures',
      source: 'manual',
      category: 'general',
    })

    expect(saved.embeddingStatus).toBe('pending')
    expect(saved.embeddingModel).toBeUndefined()
    expect(saved.embeddedAt).toBeUndefined()

    const immediate = getMemoryById(saved.id)
    expect(immediate?.embeddingStatus).toBe('pending')

    await flushMemoryIndexingQueue()

    const indexed = getMemoryById(saved.id)
    expect(indexed?.embeddingStatus).toBe('indexed')
    expect(indexed?.embeddingModel).toBe('mock-embedding-v1')
    expect(indexed?.embeddedAt).toEqual(expect.any(Number))
    expect(indexed?.embeddingError).toBeUndefined()

    const vectorRow = getDb()
      .prepare('SELECT dimensions FROM memory_embeddings WHERE memory_id = ?')
      .get(saved.id) as { dimensions: number } | undefined

    expect(vectorRow?.dimensions).toBe(3)
  })

  it('marks a memory as skipped when no embedding provider is available', async () => {
    setEmbeddingProviderFactoryForTests(async () => null)

    const saved = saveMemory({
      content: 'Task-scoped memory entry',
      source: 'task_report',
      category: 'task_report',
      taskId: 'task-001',
      agentId: 'agent-001',
    })

    await flushMemoryIndexingQueue()

    const stored = getMemoryById(saved.id)
    expect(stored?.embeddingStatus).toBe('skipped')
    expect(stored?.embeddingModel).toBeUndefined()
    expect(stored?.embeddedAt).toBeUndefined()
    expect(stored?.embeddingError).toContain('unavailable')
  })

  it('marks a memory as failed when the background embedding job throws', async () => {
    setEmbeddingProviderFactoryForTests(async () => ({
      model: 'mock-embedding-v1',
      dimensions: 3,
      async embedPassages() {
        throw new Error('mock embedding runtime failure')
      },
      async embedQuery() {
        return { model: 'mock-embedding-v1', dimensions: 3, values: [1, 0, 0] }
      },
    }))

    const saved = saveMemory({
      content: 'TypeScript memory that will fail embedding',
      source: 'manual',
      category: 'general',
    })

    await flushMemoryIndexingQueue()

    const stored = getMemoryById(saved.id)
    expect(stored?.embeddingStatus).toBe('failed')
    expect(stored?.embeddingError).toContain('mock embedding runtime failure')

    const vectorCountRow = getDb()
      .prepare('SELECT COUNT(*) as count FROM memory_embeddings WHERE memory_id = ?')
      .get(saved.id) as { count: number }

    expect(vectorCountRow.count).toBe(0)
  })

  it('deletes the memory embedding row together with the memory record', async () => {
    setEmbeddingProviderFactoryForTests(async () => createMockProvider())

    const saved = saveMemory({
      content: 'Task memory that will be deleted',
      source: 'manual',
      category: 'general',
    })

    await flushMemoryIndexingQueue()

    const beforeDelete = getDb()
      .prepare('SELECT COUNT(*) as count FROM memory_embeddings WHERE memory_id = ?')
      .get(saved.id) as { count: number }

    expect(beforeDelete.count).toBe(1)

    deleteMemory(saved.id)

    const afterDelete = getDb()
      .prepare('SELECT COUNT(*) as count FROM memory_embeddings WHERE memory_id = ?')
      .get(saved.id) as { count: number }

    expect(getMemoryById(saved.id)).toBeUndefined()
    expect(afterDelete.count).toBe(0)
  })
})
