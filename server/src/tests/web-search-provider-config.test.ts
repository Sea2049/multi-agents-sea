import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeWebSearch } from '../tools/web-search.js'

describe('web_search provider config', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.WEB_SEARCH_PROVIDER
    delete process.env.SERPER_API_KEY
    delete process.env.TAVILY_API_KEY
  })

  it('uses serper provider when configured', async () => {
    process.env.WEB_SEARCH_PROVIDER = 'serper'
    process.env.SERPER_API_KEY = 'fake-serper-key'

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => {
        expect(url).toBe('https://google.serper.dev/search')
        return {
          ok: true,
          json: async () => ({
            answerBox: { answer: 'Serper answer' },
            organic: [{ title: 'Serper Result', link: 'https://example.com', snippet: 'snippet' }],
          }),
        } as Response
      }),
    )

    const output = await executeWebSearch({ query: 'test query' })
    expect(output).toContain('Provider: serper')
    expect(output).toContain('Serper answer')
    expect(output).toContain('Serper Result')
  })

  it('falls back to duckduckgo when tavily provider fails', async () => {
    process.env.WEB_SEARCH_PROVIDER = 'tavily'
    process.env.TAVILY_API_KEY = 'fake-tavily-key'

    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => {
        throw new Error('tavily failed')
      })
      .mockImplementationOnce(async (url: string) => {
        expect(url).toContain('api.duckduckgo.com')
        return {
          ok: true,
          json: async () => ({
            AbstractText: 'Duck fallback summary',
            AbstractURL: 'https://duck.example',
          }),
        } as Response
      })

    vi.stubGlobal('fetch', fetchMock)

    const output = await executeWebSearch({ query: 'fallback query' })
    expect(output).toContain('Provider: duckduckgo')
    expect(output).toContain('Duck fallback summary')
  })
})

