import type { ToolDefinition } from '../providers/types.js'

export const WEB_SEARCH_DEFINITION: ToolDefinition = {
  name: 'web_search',
  description: 'Search the web for current information. Returns a list of search result snippets.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query' },
    },
    required: ['query'],
  },
}

export async function executeWebSearch(input: { query: string }): Promise<string> {
  const { query } = input
  const encodedQuery = encodeURIComponent(query)

  // 使用 DuckDuckGo 的轻量 JSON API（不需要 API key）
  const url = `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)

    const response = await fetch(url, {
      headers: { 'User-Agent': 'MultiAgentSea/1.0' },
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!response.ok) {
      return `Search request failed with status ${response.status}`
    }

    const data = await response.json() as {
      AbstractText?: string
      AbstractURL?: string
      RelatedTopics?: Array<{ Text?: string; FirstURL?: string } | { Topics?: Array<{ Text?: string; FirstURL?: string }> }>
    }

    const lines: string[] = []

    if (data.AbstractText) {
      lines.push(`Summary: ${data.AbstractText}`)
      if (data.AbstractURL) lines.push(`Source: ${data.AbstractURL}`)
      lines.push('')
    }

    if (data.RelatedTopics?.length) {
      lines.push('Related Results:')
      let count = 0
      for (const topic of data.RelatedTopics) {
        if (count >= 5) break
        if ('Text' in topic && topic.Text) {
          lines.push(`- ${topic.Text}`)
          if (topic.FirstURL) lines.push(`  URL: ${topic.FirstURL}`)
          count++
        } else if ('Topics' in topic && topic.Topics) {
          for (const sub of topic.Topics) {
            if (count >= 5) break
            if (sub.Text) {
              lines.push(`- ${sub.Text}`)
              if (sub.FirstURL) lines.push(`  URL: ${sub.FirstURL}`)
              count++
            }
          }
        }
      }
    }

    return lines.length > 0 ? lines.join('\n') : `No results found for: ${query}`
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return `Search timed out for query: ${query}`
    }
    return `Search failed: ${err instanceof Error ? err.message : String(err)}`
  }
}
