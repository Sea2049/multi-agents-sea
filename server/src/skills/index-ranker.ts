import * as jieba from 'jieba-wasm'
import type { RemoteSkillIndexEntry } from './types.js'

export interface RankedEntry {
  entry: RemoteSkillIndexEntry
  score: number
}

function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text)
}

function splitCamelCase(text: string): string {
  return text.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
}

function tokenizeEnglish(text: string): string[] {
  const normalized = splitCamelCase(text).toLowerCase()
  const matches = normalized.match(/[a-z0-9]+/g)
  if (!matches) {
    return []
  }
  return matches.filter((token) => token.length > 1)
}

function tokenizeChinese(text: string): string[] {
  if (!hasChinese(text)) {
    return []
  }
  try {
    return jieba.cut_for_search(text, true).map((token) => token.trim()).filter((token) => token.length > 1)
  } catch {
    return []
  }
}

function tokenizeQuery(query: string): string[] {
  const tokens = new Set<string>()
  for (const token of tokenizeEnglish(query)) {
    tokens.add(token)
  }
  for (const token of tokenizeChinese(query)) {
    tokens.add(token)
  }
  return [...tokens]
}

function tokenizeTextForFuzzy(text: string): string[] {
  const tokens = new Set<string>()
  for (const token of tokenizeEnglish(text)) {
    tokens.add(token)
  }
  for (const token of tokenizeChinese(text)) {
    tokens.add(token)
  }
  return [...tokens]
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  const matrix: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i += 1) matrix[i]![0] = i
  for (let j = 0; j <= b.length; j += 1) matrix[0]![j] = j

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost,
      )
    }
  }
  return matrix[a.length]![b.length]!
}

function tokenMatches(targetTokens: string[], queryToken: string): { exact: boolean; fuzzy: boolean } {
  for (const targetToken of targetTokens) {
    if (targetToken === queryToken) {
      return { exact: true, fuzzy: false }
    }
    if (Math.abs(targetToken.length - queryToken.length) <= 1 && levenshteinDistance(targetToken, queryToken) <= 1) {
      return { exact: false, fuzzy: true }
    }
  }
  return { exact: false, fuzzy: false }
}

function scoreField(queryTokens: string[], rawText: string, weight: number): number {
  if (!rawText.trim()) {
    return 0
  }
  const text = rawText.toLowerCase()
  const targetTokens = tokenizeTextForFuzzy(rawText)
  let score = 0

  for (const token of queryTokens) {
    if (text.includes(token)) {
      score += weight
      continue
    }
    const match = tokenMatches(targetTokens, token)
    if (match.exact) {
      score += weight
    } else if (match.fuzzy) {
      score += weight * 0.5
    }
  }

  return score
}

export function rankIndexEntries(query: string, entries: RemoteSkillIndexEntry[]): RankedEntry[] {
  const trimmed = query.trim()
  if (!trimmed) {
    return entries.map((entry) => ({ entry, score: 0 }))
  }

  const queryTokens = tokenizeQuery(trimmed)
  if (queryTokens.length === 0) {
    return []
  }

  const ranked = entries.map((entry) => {
    const nameScore = scoreField(queryTokens, entry.name, 3)
    const tagsScore = scoreField(queryTokens, entry.tags.join(' '), 2)
    const descriptionScore = scoreField(queryTokens, entry.description, 1)
    const authorScore = scoreField(queryTokens, entry.author, 0.5)
    return {
      entry,
      score: nameScore + tagsScore + descriptionScore + authorScore,
    }
  }).filter((item) => item.score > 0)

  ranked.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
  return ranked
}
