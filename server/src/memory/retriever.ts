import { embedQueryText } from '../embedding/index.js'
import { hasIndexedMemoryEmbeddings, normalizeFtsQuery, searchMemoriesFts, searchMemoriesSemantic } from './store.js'
import type { Memory, MemorySearchMatch } from './store.js'

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

function buildInjectedContext(memories: Memory[], maxChars: number): string {
  if (memories.length === 0) {
    return ''
  }

  const lines: string[] = ['## Relevant Prior Knowledge', '']
  let totalChars = 0

  for (const memory of memories) {
    const entry = `- [${memory.category}] ${memory.content}`
    if (totalChars + entry.length > maxChars) {
      break
    }

    lines.push(entry)
    totalChars += entry.length
  }

  if (lines.length === 2) {
    return ''
  }

  lines.push('')
  return lines.join('\n')
}

export async function retrieveRelevantMemories(options: RetrievalOptions): Promise<RetrievalResult> {
  const { query, limit = 5, maxChars = 2000 } = options

  if (!query.trim()) {
    return { memories: [], injectedContext: '' }
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

  const memories = mergeMatches([ftsMatches, semanticMatches], limit)
  if (memories.length === 0) {
    return { memories: [], injectedContext: '' }
  }

  return {
    memories,
    injectedContext: buildInjectedContext(memories, maxChars),
  }
}
