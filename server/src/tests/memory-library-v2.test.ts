import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  bulkDeleteMemories,
  deleteMemory,
  flushMemoryIndexingQueue,
  getMemoryById,
  listMemories,
  pinMemory,
  saveMemory,
  searchMemoriesWithFilters,
} from '../memory/store.js'
import { closeDb, initDb } from '../storage/db.js'
import { resetEmbeddingProviderForTests, setEmbeddingProviderFactoryForTests } from '../embedding/index.js'

beforeEach(() => {
  closeDb()
  resetEmbeddingProviderForTests()
  setEmbeddingProviderFactoryForTests(async () => null) // skip embeddings in these tests
  initDb(':memory:')
})

afterEach(async () => {
  await flushMemoryIndexingQueue()
  resetEmbeddingProviderForTests()
  closeDb()
})

describe('pin memory', () => {
  it('saves is_pinned=false by default', () => {
    const m = saveMemory({ content: 'hello', source: 'manual', category: 'general' })
    expect(m.isPinned).toBe(false)
    expect(m.pinnedAt).toBeUndefined()
    expect(m.pinSource).toBeUndefined()
  })

  it('saves is_pinned=true with auto source when requested', () => {
    const m = saveMemory({
      content: 'critical insight',
      source: 'task_report',
      category: 'fact',
      isPinned: true,
      pinSource: 'auto',
      pinReason: 'Key architectural decision',
    })
    expect(m.isPinned).toBe(true)
    expect(m.pinnedAt).toBeGreaterThan(0)
    expect(m.pinSource).toBe('auto')
    expect(m.pinReason).toBe('Key architectural decision')
  })

  it('pin and unpin via pinMemory()', () => {
    const m = saveMemory({ content: 'to be pinned', source: 'manual', category: 'general' })
    expect(m.isPinned).toBe(false)

    const pinned = pinMemory(m.id, { pinned: true, pinSource: 'manual', pinReason: 'important' })
    expect(pinned?.isPinned).toBe(true)
    expect(pinned?.pinSource).toBe('manual')
    expect(pinned?.pinReason).toBe('important')
    expect(pinned?.pinnedAt).toBeGreaterThan(0)

    const unpinned = pinMemory(m.id, { pinned: false })
    expect(unpinned?.isPinned).toBe(false)
    expect(unpinned?.pinSource).toBeUndefined()
    expect(unpinned?.pinReason).toBeUndefined()
    expect(unpinned?.pinnedAt).toBeUndefined()
  })

  it('pinMemory returns undefined for non-existent id', () => {
    const result = pinMemory('no-such-id', { pinned: true })
    expect(result).toBeUndefined()
  })

  it('pinned memories sort before unpinned in listMemories', async () => {
    const a = saveMemory({ content: 'normal entry', source: 'manual', category: 'general' })
    await new Promise(r => setTimeout(r, 2))
    const b = saveMemory({ content: 'another normal', source: 'manual', category: 'general' })
    await new Promise(r => setTimeout(r, 2))
    pinMemory(a.id, { pinned: true })

    const list = listMemories({ limit: 10 })
    expect(list[0].id).toBe(a.id)
    expect(list[0].isPinned).toBe(true)
    expect(list[1].id).toBe(b.id)
    expect(list[1].isPinned).toBe(false)
  })

  it('persists pinned state across getMemoryById', () => {
    const m = saveMemory({
      content: 'persisted pin',
      source: 'manual',
      category: 'decision',
      isPinned: true,
      pinSource: 'auto',
      pinReason: 'Key decision',
    })
    const fetched = getMemoryById(m.id)
    expect(fetched?.isPinned).toBe(true)
    expect(fetched?.pinSource).toBe('auto')
    expect(fetched?.pinReason).toBe('Key decision')
  })
})

describe('bulkDeleteMemories', () => {
  it('deletes multiple memories at once', () => {
    const a = saveMemory({ content: 'a', source: 'manual', category: 'general' })
    const b = saveMemory({ content: 'b', source: 'manual', category: 'general' })
    const c = saveMemory({ content: 'c', source: 'manual', category: 'general' })

    const deleted = bulkDeleteMemories([a.id, b.id])
    expect(deleted).toBe(2)

    expect(getMemoryById(a.id)).toBeUndefined()
    expect(getMemoryById(b.id)).toBeUndefined()
    expect(getMemoryById(c.id)).toBeDefined()
  })

  it('returns 0 when given empty array', () => {
    saveMemory({ content: 'stay', source: 'manual', category: 'general' })
    expect(bulkDeleteMemories([])).toBe(0)
  })

  it('handles unknown ids without throwing', () => {
    const m = saveMemory({ content: 'real', source: 'manual', category: 'general' })
    const deleted = bulkDeleteMemories([m.id, 'ghost-id'])
    expect(deleted).toBe(1)
  })
})

describe('searchMemoriesWithFilters', () => {
  beforeEach(() => {
    saveMemory({ content: 'TypeScript generics are powerful', source: 'manual', category: 'fact', taskId: 'task-1', agentId: 'agent-a' })
    saveMemory({ content: 'Use async/await for async operations', source: 'manual', category: 'decision', taskId: 'task-1', agentId: 'agent-b' })
    saveMemory({ content: 'Python is used for data science', source: 'manual', category: 'fact', taskId: 'task-2', agentId: 'agent-a' })
    saveMemory({ content: 'Deploy to production on Fridays is risky', source: 'task_report', category: 'decision', taskId: 'task-2' })
  })

  it('returns all matching category without query (no search fallback)', () => {
    const results = searchMemoriesWithFilters({ query: '', category: 'fact' })
    expect(results.every(m => m.category === 'fact')).toBe(true)
    expect(results.length).toBe(2)
  })

  it('filters by taskId', () => {
    const results = searchMemoriesWithFilters({ query: '', taskId: 'task-1' })
    expect(results.every(m => m.taskId === 'task-1')).toBe(true)
    expect(results.length).toBe(2)
  })

  it('filters by agentId', () => {
    const results = searchMemoriesWithFilters({ query: '', agentId: 'agent-a' })
    expect(results.every(m => m.agentId === 'agent-a')).toBe(true)
    expect(results.length).toBe(2)
  })

  it('combines taskId and category filter', () => {
    const results = searchMemoriesWithFilters({ query: '', taskId: 'task-1', category: 'fact' })
    expect(results.length).toBe(1)
    expect(results[0].content).toContain('TypeScript')
  })

  it('full-text search with query', () => {
    const results = searchMemoriesWithFilters({ query: 'TypeScript' })
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results.some(m => m.content.includes('TypeScript'))).toBe(true)
  })

  it('full-text search combined with category filter', () => {
    const results = searchMemoriesWithFilters({ query: 'async', category: 'decision' })
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results.every(m => m.category === 'decision')).toBe(true)
  })
})

describe('listMemories with limit', () => {
  it('respects limit parameter', () => {
    for (let i = 0; i < 10; i++) {
      saveMemory({ content: `memory ${i}`, source: 'manual', category: 'general' })
    }
    const result = listMemories({ limit: 3 })
    expect(result.length).toBe(3)
  })
})

describe('deleteMemory', () => {
  it('deletes a pinned memory without error', () => {
    const m = saveMemory({ content: 'pinned one', source: 'manual', category: 'fact', isPinned: true })
    deleteMemory(m.id)
    expect(getMemoryById(m.id)).toBeUndefined()
  })
})
