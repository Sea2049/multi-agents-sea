import { describe, expect, it } from 'vitest'
import { rankIndexEntries } from '../skills/index-ranker.js'
import type { RemoteSkillIndexEntry } from '../skills/types.js'

const ENTRIES: RemoteSkillIndexEntry[] = [
  {
    id: 'csv-reader',
    name: 'CSV Reader Tool',
    description: 'Read and parse CSV files from workspace',
    author: 'sea',
    url: 'https://example.com/csv',
    tags: ['data', 'csv', 'files'],
    version: '1.0.0',
  },
  {
    id: 'web-scraper',
    name: 'Web Scraper Skill',
    description: 'Scrape website content and export structured data，支持网页抓取',
    author: 'sea',
    url: 'https://example.com/scraper',
    tags: ['scraping', 'http', 'crawler', '网页抓取'],
    version: '1.0.0',
  },
  {
    id: 'markdown-helper',
    name: 'Markdown Helper',
    description: 'Format markdown text',
    author: 'sea',
    url: 'https://example.com/md',
    tags: ['markdown', 'text'],
    version: '1.0.0',
  },
]

describe('skill index ranker', () => {
  it('ranks entries by english query', () => {
    const ranked = rankIndexEntries('csv export files', ENTRIES)
    expect(ranked.length).toBeGreaterThan(0)
    expect(ranked[0]!.entry.id).toBe('csv-reader')
  })

  it('supports chinese tokenized search', () => {
    const ranked = rankIndexEntries('网页抓取', ENTRIES)
    expect(ranked.length).toBeGreaterThan(0)
    expect(ranked[0]!.entry.id).toBe('web-scraper')
  })

  it('supports fuzzy token matching', () => {
    const ranked = rankIndexEntries('scrapng', ENTRIES)
    expect(ranked.length).toBeGreaterThan(0)
    expect(ranked[0]!.entry.id).toBe('web-scraper')
  })

  it('returns empty for query with no match', () => {
    const ranked = rankIndexEntries('quantum-compiler-optimizer', ENTRIES)
    expect(ranked).toHaveLength(0)
  })
})
