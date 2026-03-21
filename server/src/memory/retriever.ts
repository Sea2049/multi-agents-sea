import { embedQueryText } from '../embedding/index.js'
import { hasIndexedMemoryEmbeddings, normalizeFtsQuery, searchMemoriesFts, searchMemoriesSemantic, getPinnedMemories } from './store.js'
import type { Memory, MemorySearchMatch } from './store.js'
import { findEntitiesByKeyword, traverseGraph } from './entity-store.js'
import type { Entity } from './entity-store.js'

export { getPinnedMemories } from './store.js'

export interface RetrievalOptions {
  query: string
  limit?: number
  maxChars?: number
}

export interface RetrievalResult {
  memories: Memory[]
  injectedContext: string
}

const RRF_K = 60

function buildLooseFtsQuery(query: string): string {
  const terms = [...new Set(
    query
      .split(/\s+/)
      .map(term => term.trim())
      .filter(term => term.length >= 3 || term.includes('_')),
  )]

  if (terms.length <= 1) {
    return query
  }

  return terms.map(term => `"${term}"`).join(' OR ')
}

function mergeMatches(lists: MemorySearchMatch[][], limit: number): Memory[] {
  const merged = new Map<string, { memory: Memory; score: number; bestRank: number }>()

  for (const list of lists) {
    for (const match of list) {
      const existing = merged.get(match.memory.id)
      const rrfScore = 1 / (RRF_K + match.rank)

      if (existing) {
        existing.score += rrfScore
        existing.bestRank = Math.min(existing.bestRank, match.rank)
        continue
      }

      merged.set(match.memory.id, {
        memory: match.memory,
        score: rrfScore,
        bestRank: match.rank,
      })
    }
  }

  return [...merged.values()]
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      if (left.bestRank !== right.bestRank) {
        return left.bestRank - right.bestRank
      }

      return right.memory.createdAt - left.memory.createdAt
    })
    .slice(0, limit)
    .map((entry) => entry.memory)
}

async function retrieveGraphContext(query: string): Promise<string> {
  const matchedEntities = findEntitiesByKeyword(query, 5)
  if (matchedEntities.length === 0) return ''

  const allRelations: Array<{ startEntity: Entity; entity: Entity; relationType: string; direction: string }> = []
  for (const entity of matchedEntities.slice(0, 3)) {
    const neighbors = traverseGraph(entity.id, 2)
    for (const neighbor of neighbors) {
      allRelations.push({ startEntity: entity, ...neighbor })
    }
  }

  const lines: string[] = []
  const seen = new Set<string>()
  for (const { startEntity, entity, relationType, direction } of allRelations) {
    const triple = direction === 'out'
      ? `${startEntity.name} -[${relationType}]-> ${entity.name}`
      : `${entity.name} -[${relationType}]-> ${startEntity.name}`
    if (!seen.has(triple)) {
      seen.add(triple)
      lines.push(`- ${triple}`)
    }
  }

  return lines.length > 0
    ? `## Related Entities & Relations\n\n${lines.join('\n')}`
    : ''
}

function buildInjectedContext(
  pinnedMemories: Memory[],
  graphContext: string,
  dynamicMemories: Memory[],
  maxChars: number,
): string {
  let totalChars = 0
  const parts: string[] = []

  if (pinnedMemories.length > 0) {
    const lines: string[] = ['## Pinned Knowledge (Always Active)', '']
    for (const memory of pinnedMemories) {
      const entry = `- [pinned/${memory.category}] ${memory.content}`
      if (totalChars + entry.length > maxChars) break
      lines.push(entry)
      totalChars += entry.length
    }
    if (lines.length > 2) {
      lines.push('')
      parts.push(lines.join('\n'))
    }
  }

  if (graphContext) {
    if (totalChars + graphContext.length <= maxChars) {
      parts.push(graphContext + '\n')
      totalChars += graphContext.length
    }
  }

  if (dynamicMemories.length > 0) {
    const lines: string[] = ['## Relevant Prior Knowledge', '']
    for (const memory of dynamicMemories) {
      const entry = `- [${memory.category}] ${memory.content}`
      if (totalChars + entry.length > maxChars) break
      lines.push(entry)
      totalChars += entry.length
    }
    if (lines.length > 2) {
      lines.push('')
      parts.push(lines.join('\n'))
    }
  }

  return parts.join('\n')
}

export async function retrieveRelevantMemories(options: RetrievalOptions): Promise<RetrievalResult> {
  const { query, limit = 5, maxChars = 2000 } = options

  const pinnedMemories = getPinnedMemories()

  if (!query.trim()) {
    if (pinnedMemories.length === 0) {
      return { memories: [], injectedContext: '' }
    }
    return {
      memories: pinnedMemories,
      injectedContext: buildInjectedContext(pinnedMemories, '', [], maxChars),
    }
  }

  const lexicalLimit = Math.max(limit * 2, limit)
  const safeQuery = normalizeFtsQuery(query)

  let ftsMatches: MemorySearchMatch[] = []
  if (safeQuery) {
    try {
      ftsMatches = searchMemoriesFts(safeQuery, lexicalLimit)
    } catch {
      ftsMatches = []
    }

    if (ftsMatches.length === 0) {
      const looseQuery = buildLooseFtsQuery(safeQuery)
      if (looseQuery !== safeQuery) {
        try {
          ftsMatches = searchMemoriesFts(looseQuery, lexicalLimit)
        } catch {
          ftsMatches = []
        }
      }
    }
  }

  let semanticMatches: MemorySearchMatch[] = []
  if (hasIndexedMemoryEmbeddings()) {
    try {
      const queryVector = await embedQueryText(query)
      if (queryVector) {
        semanticMatches = searchMemoriesSemantic(queryVector, lexicalLimit)
      }
    } catch {
      semanticMatches = []
    }
  }

  let graphContext = ''
  try {
    graphContext = await retrieveGraphContext(query)
  } catch {
    graphContext = ''
  }

  const pinnedIds = new Set(pinnedMemories.map(m => m.id))
  const allDynamic = mergeMatches([ftsMatches, semanticMatches], limit)
  const dynamicMemories = allDynamic.filter(m => !pinnedIds.has(m.id))

  if (dynamicMemories.length === 0 && pinnedMemories.length === 0 && !graphContext) {
    return { memories: [], injectedContext: '' }
  }

  return {
    memories: [...pinnedMemories, ...dynamicMemories],
    injectedContext: buildInjectedContext(pinnedMemories, graphContext, dynamicMemories, maxChars),
  }
}
