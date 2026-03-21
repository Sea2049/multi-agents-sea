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

type SearchProviderName = 'duckduckgo' | 'serper' | 'tavily'

function resolveSearchProvider(): SearchProviderName {
  const raw = (process.env.WEB_SEARCH_PROVIDER ?? '').trim().toLowerCase()
  if (raw === 'serper' || raw === 'tavily' || raw === 'duckduckgo') {
    return raw
  }
  return 'duckduckgo'
}

function formatNoResult(query: string, provider: SearchProviderName): string {
  return `No results found for: ${query} (provider: ${provider})`
}

async function executeDuckDuckGoSearch(query: string, signal?: AbortSignal): Promise<string> {
  const encodedQuery = encodeURIComponent(query)
  const url = `https://api.duckduckgo.com/?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`
  const response = await fetch(url, {
    headers: { 'User-Agent': 'MultiAgentSea/1.0' },
    signal,
  })
  if (!response.ok) {
    return `Search request failed with status ${response.status}`
  }
  const data = await response.json() as {
    AbstractText?: string
    AbstractURL?: string
    RelatedTopics?: Array<{ Text?: string; FirstURL?: string } | { Topics?: Array<{ Text?: string; FirstURL?: string }> }>
  }

  const lines: string[] = ['Provider: duckduckgo']
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

  return lines.length > 1 ? lines.join('\n') : formatNoResult(query, 'duckduckgo')
}

async function executeSerperSearch(query: string, signal?: AbortSignal): Promise<string> {
  const apiKey = process.env.SERPER_API_KEY?.trim()
  if (!apiKey) {
    return 'Serper API key is missing. Set SERPER_API_KEY or switch WEB_SEARCH_PROVIDER to duckduckgo.'
  }

  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey,
      'User-Agent': 'MultiAgentSea/1.0',
    },
    body: JSON.stringify({ q: query, num: 5 }),
    signal,
  })
  if (!response.ok) {
    return `Serper request failed with status ${response.status}`
  }

  const data = await response.json() as {
    answerBox?: { snippet?: string; answer?: string }
    organic?: Array<{ title?: string; link?: string; snippet?: string }>
  }

  const lines: string[] = ['Provider: serper']
  const answer = data.answerBox?.answer ?? data.answerBox?.snippet
  if (answer) {
    lines.push(`Answer: ${answer}`)
    lines.push('')
  }

  const organic = data.organic ?? []
  if (organic.length > 0) {
    lines.push('Top Results:')
    for (const item of organic.slice(0, 5)) {
      lines.push(`- ${item.title ?? '(untitled)'}`)
      if (item.link) lines.push(`  URL: ${item.link}`)
      if (item.snippet) lines.push(`  Snippet: ${item.snippet}`)
    }
  }

  return lines.length > 1 ? lines.join('\n') : formatNoResult(query, 'serper')
}

async function executeTavilySearch(query: string, signal?: AbortSignal): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY?.trim()
  if (!apiKey) {
    return 'Tavily API key is missing. Set TAVILY_API_KEY or switch WEB_SEARCH_PROVIDER to duckduckgo.'
  }

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'MultiAgentSea/1.0',
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: 5,
      include_answer: true,
    }),
    signal,
  })

  if (!response.ok) {
    return `Tavily request failed with status ${response.status}`
  }

  const data = await response.json() as {
    answer?: string
    results?: Array<{ title?: string; url?: string; content?: string }>
  }

  const lines: string[] = ['Provider: tavily']
  if (data.answer) {
    lines.push(`Answer: ${data.answer}`)
    lines.push('')
  }

  const results = data.results ?? []
  if (results.length > 0) {
    lines.push('Top Results:')
    for (const item of results.slice(0, 5)) {
      lines.push(`- ${item.title ?? '(untitled)'}`)
      if (item.url) lines.push(`  URL: ${item.url}`)
      if (item.content) lines.push(`  Snippet: ${item.content}`)
    }
  }

  return lines.length > 1 ? lines.join('\n') : formatNoResult(query, 'tavily')
}

export async function executeWebSearch(input: { query: string }): Promise<string> {
  const { query } = input
  const provider = resolveSearchProvider()

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    try {
      switch (provider) {
        case 'serper':
          return await executeSerperSearch(query, controller.signal)
        case 'tavily':
          return await executeTavilySearch(query, controller.signal)
        default:
          return await executeDuckDuckGoSearch(query, controller.signal)
      }
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return `Search timed out for query: ${query}`
    }
    if (provider !== 'duckduckgo') {
      try {
        return await executeDuckDuckGoSearch(query)
      } catch {
        // ignore fallback error and return original error below
      }
    }
    return `Search failed (${provider}): ${err instanceof Error ? err.message : String(err)}`
  }
}
