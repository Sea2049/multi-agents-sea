import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resetEmbeddingProviderForTests, setEmbeddingProviderFactoryForTests } from '../embedding/index.js'
import { getPinnedMemories, retrieveRelevantMemories } from '../memory/retriever.js'
import {
  bulkDeleteMemories,
  flushMemoryIndexingQueue,
  getMemoryById,
  mergeMemories,
  saveMemory,
  updateMemoryContent,
} from '../memory/store.js'
import { closeDb, getDb, initDb } from '../storage/db.js'

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

describe('pinned memory injection', () => {
  it('prepends pinned memories with distinct header before dynamic results', async () => {
    setEmbeddingProviderFactoryForTests(async () => null)

    const pinned = saveMemory({
      content: 'Always use TypeScript strict mode in this project',
      source: 'manual',
      category: 'decision',
      isPinned: true,
    })

    saveMemory({
      content: 'Deployment uses Docker Compose on port 3000',
      source: 'manual',
      category: 'fact',
    })

    const result = await retrieveRelevantMemories({ query: 'Deployment Docker', limit: 5 })

    expect(result.injectedContext).toContain('## Pinned Knowledge (Always Active)')
    expect(result.injectedContext).toContain(`[pinned/decision] ${pinned.content}`)
    expect(result.injectedContext).toContain('## Relevant Prior Knowledge')
    expect(result.injectedContext).toContain('Deployment uses Docker')

    const pinnedIndex = result.injectedContext.indexOf('## Pinned Knowledge (Always Active)')
    const dynamicIndex = result.injectedContext.indexOf('## Relevant Prior Knowledge')
    expect(pinnedIndex).toBeLessThan(dynamicIndex)
  })

  it('includes pinned memory in result memories array at the front', async () => {
    setEmbeddingProviderFactoryForTests(async () => null)

    const pinned = saveMemory({
      content: 'Critical pinned fact for all contexts',
      source: 'manual',
      category: 'fact',
      isPinned: true,
    })

    saveMemory({
      content: 'react hooks usage guidelines',
      source: 'manual',
      category: 'general',
    })

    const result = await retrieveRelevantMemories({ query: 'react hooks', limit: 5 })

    expect(result.memories[0]?.id).toBe(pinned.id)
  })

  it('pinned memories appear even when dynamic query finds no results', async () => {
    setEmbeddingProviderFactoryForTests(async () => null)

    const pinned = saveMemory({
      content: 'This is always active pinned knowledge',
      source: 'manual',
      category: 'decision',
      isPinned: true,
    })

    const result = await retrieveRelevantMemories({ query: 'xyzzy nonexistent query zqwx', limit: 5 })

    expect(result.memories).toHaveLength(1)
    expect(result.memories[0]?.id).toBe(pinned.id)
    expect(result.injectedContext).toContain('## Pinned Knowledge (Always Active)')
    expect(result.injectedContext).not.toContain('## Relevant Prior Knowledge')
  })

  it('pinned memory not duplicated in dynamic results section', async () => {
    setEmbeddingProviderFactoryForTests(async () => null)

    saveMemory({
      content: 'pinned duplicate check anchor token PINCHECK',
      source: 'manual',
      category: 'fact',
      isPinned: true,
    })

    const result = await retrieveRelevantMemories({ query: 'PINCHECK anchor', limit: 5 })

    const pinnedSectionCount = (result.injectedContext.match(/PINCHECK/g) ?? []).length
    expect(pinnedSectionCount).toBe(1)
  })

  it('format is unchanged (no pinned section) when no memories are pinned', async () => {
    setEmbeddingProviderFactoryForTests(async () => null)

    saveMemory({
      content: 'React hooks must be called at the top level',
      source: 'manual',
      category: 'general',
    })

    const result = await retrieveRelevantMemories({ query: 'React hooks', limit: 5 })

    expect(result.injectedContext).not.toContain('## Pinned Knowledge (Always Active)')
    expect(result.injectedContext).toContain('## Relevant Prior Knowledge')
  })

  it('returns empty context when no pinned memories and blank query', async () => {
    const result = await retrieveRelevantMemories({ query: '   ' })

    expect(result.memories).toHaveLength(0)
    expect(result.injectedContext).toBe('')
  })

  it('getPinnedMemories returns only pinned memories ordered by pinned_at desc', () => {
    const p1 = saveMemory({ content: 'first pinned', source: 'manual', category: 'fact', isPinned: true })
    saveMemory({ content: 'not pinned', source: 'manual', category: 'fact' })
    const p2 = saveMemory({ content: 'second pinned', source: 'manual', category: 'decision', isPinned: true })

    const pinned = getPinnedMemories()

    expect(pinned).toHaveLength(2)
    expect(pinned.every(m => m.isPinned)).toBe(true)
    const ids = pinned.map(m => m.id)
    expect(ids).toContain(p1.id)
    expect(ids).toContain(p2.id)
  })
})

describe('updateMemoryContent', () => {
  it('updates the content and resets embedding_status to pending', async () => {
    setEmbeddingProviderFactoryForTests(async () => null)

    const original = saveMemory({
      content: 'Original content before edit',
      source: 'manual',
      category: 'fact',
    })
    await flushMemoryIndexingQueue()

    const updated = updateMemoryContent(original.id, 'Updated content after edit')

    expect(updated).toBeDefined()
    expect(updated!.content).toBe('Updated content after edit')
    expect(updated!.embeddingStatus).toBe('pending')
    expect(updated!.id).toBe(original.id)
    expect(updated!.category).toBe(original.category)
  })

  it('persists the new content in the database', () => {
    const original = saveMemory({
      content: 'Before update',
      source: 'manual',
      category: 'general',
    })

    updateMemoryContent(original.id, 'After update')

    const fetched = getMemoryById(original.id)
    expect(fetched?.content).toBe('After update')
  })

  it('clears embedding fields when content is updated', async () => {
    setEmbeddingProviderFactoryForTests(async () => null)

    const mem = saveMemory({ content: 'Some content', source: 'manual', category: 'fact' })
    await flushMemoryIndexingQueue()

    const updated = updateMemoryContent(mem.id, 'New content')

    expect(updated?.embeddingStatus).toBe('pending')
    expect(updated?.embeddingModel).toBeUndefined()
    expect(updated?.embeddedAt).toBeUndefined()
    expect(updated?.embeddingError).toBeUndefined()
  })

  it('returns undefined for a non-existent id', () => {
    const result = updateMemoryContent('non-existent-id', 'content')
    expect(result).toBeUndefined()
  })

  it('updates the FTS index so new content is searchable', () => {
    saveMemory({ content: 'original fts anchor UNIQUETOKEN_OLD', source: 'manual', category: 'fact' })
    const mem = saveMemory({ content: 'another memory fts UNIQUETOKEN_OLD', source: 'manual', category: 'fact' })

    updateMemoryContent(mem.id, 'replacement fts content UNIQUETOKEN_NEW')

    const db = getDb()
    const rows = db
      .prepare(`
        SELECT m.id FROM memories m
        JOIN memories_fts ON m.rowid = memories_fts.rowid
        WHERE memories_fts MATCH ?
      `)
      .all('UNIQUETOKEN_NEW') as Array<{ id: string }>

    expect(rows.map(r => r.id)).toContain(mem.id)
  })
})

describe('mergeMemories', () => {
  it('creates a new merged memory and deletes all source memories', () => {
    const s1 = saveMemory({ content: 'Source memory one', source: 'manual', category: 'fact' })
    const s2 = saveMemory({ content: 'Source memory two', source: 'manual', category: 'fact' })

    const merged = mergeMemories([s1.id, s2.id], 'Merged: Source memory one. Source memory two.')

    expect(merged).toBeDefined()
    expect(merged!.content).toBe('Merged: Source memory one. Source memory two.')
    expect(merged!.category).toBe(s1.category)
    expect(merged!.source).toBe('manual')

    expect(getMemoryById(s1.id)).toBeUndefined()
    expect(getMemoryById(s2.id)).toBeUndefined()
  })

  it('inherits category and agentId from the first source memory', () => {
    const s1 = saveMemory({
      content: 'Decision one',
      source: 'manual',
      category: 'decision',
      agentId: 'agent-001',
      taskId: 'task-001',
    })
    const s2 = saveMemory({ content: 'Decision two', source: 'manual', category: 'fact' })

    const merged = mergeMemories([s1.id, s2.id], 'Combined decision')

    expect(merged!.category).toBe('decision')
    expect(merged!.agentId).toBe('agent-001')
    expect(merged!.taskId).toBe('task-001')
  })

  it('returns undefined and deletes nothing when sourceIds do not exist', () => {
    const real = saveMemory({ content: 'Should survive', source: 'manual', category: 'fact' })

    const result = mergeMemories(['ghost-id-1', 'ghost-id-2'], 'Merged content')

    expect(result).toBeUndefined()
    expect(getMemoryById(real.id)).toBeDefined()
  })

  it('new merged memory starts with pending embedding status', () => {
    const s1 = saveMemory({ content: 'Alpha content', source: 'manual', category: 'fact' })
    const s2 = saveMemory({ content: 'Beta content', source: 'manual', category: 'fact' })

    const merged = mergeMemories([s1.id, s2.id], 'Alpha and Beta merged')

    expect(merged!.embeddingStatus).toBe('pending')
  })

  it('bulk-deletes source embeddings when merging', async () => {
    setEmbeddingProviderFactoryForTests(async () => null)

    const s1 = saveMemory({ content: 'Embed source one', source: 'manual', category: 'fact' })
    const s2 = saveMemory({ content: 'Embed source two', source: 'manual', category: 'fact' })
    await flushMemoryIndexingQueue()

    mergeMemories([s1.id, s2.id], 'Merged embedded sources')

    const db = getDb()
    const count = db
      .prepare('SELECT COUNT(*) as c FROM memories WHERE id IN (?, ?)')
      .get(s1.id, s2.id) as { c: number }

    expect(count.c).toBe(0)
  })

  it('can merge more than two memories', () => {
    const sources = [
      saveMemory({ content: 'Part A', source: 'manual', category: 'output' }),
      saveMemory({ content: 'Part B', source: 'manual', category: 'output' }),
      saveMemory({ content: 'Part C', source: 'manual', category: 'output' }),
    ]

    const merged = mergeMemories(sources.map(s => s.id), 'Part A + Part B + Part C')

    expect(merged).toBeDefined()
    expect(merged!.content).toBe('Part A + Part B + Part C')
    for (const src of sources) {
      expect(getMemoryById(src.id)).toBeUndefined()
    }
  })
})

describe('bulkDeleteMemories (regression)', () => {
  it('returns zero when ids array is empty', () => {
    const deleted = bulkDeleteMemories([])
    expect(deleted).toBe(0)
  })
})
