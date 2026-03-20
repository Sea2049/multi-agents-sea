import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetEmbeddingProviderForTests, setEmbeddingProviderFactoryForTests } from '../embedding/index.js'
import type { EmbeddingProvider, EmbeddingVector } from '../embedding/provider.js'
import { retrieveRelevantMemories } from '../memory/retriever.js'
import { flushMemoryIndexingQueue, saveMemory } from '../memory/store.js'
import { closeDb, initDb } from '../storage/db.js'

function createSemanticProvider(options?: { failQuery?: boolean }): EmbeddingProvider {
  const vectorForText = (text: string): EmbeddingVector => {
    const normalized = text.toLowerCase()

    if (normalized.includes('btree') || normalized.includes('full table scan')) {
      return { model: 'mock-embedding-v1', dimensions: 3, values: [1, 0, 0] }
    }

    if (normalized.includes('oauth') || normalized.includes('session cookie')) {
      return { model: 'mock-embedding-v1', dimensions: 3, values: [0, 1, 0] }
    }

    if (normalized.includes('react hooks') || normalized.includes('alpha')) {
      return { model: 'mock-embedding-v1', dimensions: 3, values: [0, 0, 1] }
    }

    return { model: 'mock-embedding-v1', dimensions: 3, values: [0.2, 0.2, 0.2] }
  }

  return {
    model: 'mock-embedding-v1',
    dimensions: 3,
    async embedPassages(texts) {
      return texts.map((text) => vectorForText(text))
    },
    async embedQuery(text) {
      if (options?.failQuery) {
        throw new Error('mock semantic query failure')
      }

      const normalized = text.toLowerCase()

      if (normalized.includes('database performance') || normalized.includes('slow sql')) {
        return { model: 'mock-embedding-v1', dimensions: 3, values: [1, 0, 0] }
      }

      if (normalized.includes('keep users signed in') || normalized.includes('login persistence')) {
        return { model: 'mock-embedding-v1', dimensions: 3, values: [0, 1, 0] }
      }

      if (normalized.includes('alpha') || normalized.includes('react hooks')) {
        return { model: 'mock-embedding-v1', dimensions: 3, values: [0, 0, 1] }
      }

      return { model: 'mock-embedding-v1', dimensions: 3, values: [0.2, 0.2, 0.2] }
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

describe('memory retriever', () => {
  it('uses FTS-only retrieval when embeddings are unavailable', async () => {
    setEmbeddingProviderFactoryForTests(async () => null)

    saveMemory({
      content: 'React hooks must be called at the top level of a component',
      source: 'manual',
      category: 'general',
    })

    const result = await retrieveRelevantMemories({ query: 'React hooks', limit: 5 })

    expect(result.memories).toHaveLength(1)
    expect(result.memories[0]?.content).toContain('React hooks')
    expect(result.injectedContext).toContain('## Relevant Prior Knowledge')
  })

  it('falls back to semantic-only retrieval when FTS has no lexical match', async () => {
    setEmbeddingProviderFactoryForTests(async () => createSemanticProvider())

    saveMemory({
      content: 'Use BTree indexes to reduce expensive full table scan plans.',
      source: 'task_report',
      category: 'task_report',
    })
    await flushMemoryIndexingQueue()

    const result = await retrieveRelevantMemories({ query: 'database performance tuning', limit: 5 })

    expect(result.memories).toHaveLength(1)
    expect(result.memories[0]?.content).toContain('BTree indexes')
    expect(result.injectedContext).toContain('BTree indexes')
  })

  it('merges lexical and semantic results without duplicates in hybrid retrieval', async () => {
    setEmbeddingProviderFactoryForTests(async () => createSemanticProvider())

    saveMemory({
      content: 'alpha lexical anchor for hybrid retrieval',
      source: 'manual',
      category: 'general',
    })
    saveMemory({
      content: 'Use BTree indexes to reduce expensive full table scan plans.',
      source: 'task_report',
      category: 'task_report',
    })
    await flushMemoryIndexingQueue()

    const result = await retrieveRelevantMemories({
      query: 'alpha database performance tuning',
      limit: 2,
    })

    expect(result.memories).toHaveLength(2)
    expect(new Set(result.memories.map((memory) => memory.id)).size).toBe(2)
    expect(result.injectedContext).toContain('alpha lexical anchor')
    expect(result.injectedContext).toContain('BTree indexes')
  })

  it('falls back to FTS results when semantic query embedding fails', async () => {
    setEmbeddingProviderFactoryForTests(async () => createSemanticProvider({ failQuery: true }))

    saveMemory({
      content: 'beta lexical fallback token for retrieval',
      source: 'manual',
      category: 'general',
    })
    await flushMemoryIndexingQueue()

    const result = await retrieveRelevantMemories({ query: 'beta fallback token', limit: 5 })

    expect(result.memories).toHaveLength(1)
    expect(result.memories[0]?.content).toContain('beta lexical fallback token')
    expect(result.injectedContext).toContain('beta lexical fallback token')
  })

  it('loosens long natural-language lexical queries when strict FTS matching is too restrictive', async () => {
    setEmbeddingProviderFactoryForTests(async () => null)

    saveMemory({
      content: 'Deployment anchor memory: repeat token MEMORY_HIT_TEST verbatim.',
      source: 'manual',
      category: 'general',
    })

    const result = await retrieveRelevantMemories({
      query: 'Use the prior deployment anchor memory and repeat any MEMORY_HIT token verbatim.',
      limit: 5,
    })

    expect(result.memories).toHaveLength(1)
    expect(result.injectedContext).toContain('MEMORY_HIT_TEST')
  })

  it('returns empty context for blank queries', async () => {
    const result = await retrieveRelevantMemories({ query: '   ' })

    expect(result.memories).toHaveLength(0)
    expect(result.injectedContext).toBe('')
  })
})
