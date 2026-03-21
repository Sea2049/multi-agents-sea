import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function mockJsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function mockBinaryResponse(text: string, init?: ResponseInit): Response {
  return new Response(text, {
    status: 200,
    headers: { 'content-type': 'application/zip' },
    ...init,
  })
}

describe('clawhub market provider', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    process.env['SEA_MARKET_CLAWHUB_BASE_URL'] = 'https://clawhub.test'
    process.env['SEA_MARKET_RETRY_MAX_ATTEMPTS'] = '1'
    process.env['SEA_MARKET_RETRY_BASE_DELAY_MS'] = '1'
    process.env['SEA_MARKET_RESULT_LIMIT'] = '5'
    process.env['SEA_MARKET_BUNDLE_CACHE_TTL_MS'] = '1'
    process.env['SEA_MARKET_DETAIL_CONCURRENCY'] = '2'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env['SEA_MARKET_CLAWHUB_BASE_URL']
    delete process.env['SEA_MARKET_RETRY_MAX_ATTEMPTS']
    delete process.env['SEA_MARKET_RETRY_BASE_DELAY_MS']
    delete process.env['SEA_MARKET_RESULT_LIMIT']
    delete process.env['SEA_MARKET_BUNDLE_CACHE_TTL_MS']
    delete process.env['SEA_MARKET_DETAIL_CONCURRENCY']
  })

  it('deduplicates concurrent bundle downloads for same skill id', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.includes('/api/v1/download')) {
        await new Promise((resolve) => setTimeout(resolve, 20))
        return mockBinaryResponse('bundle-a')
      }
      throw new Error(`unexpected url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { clawhubProvider } = await import('../skills/market/providers/clawhub.js')
    const [a, b] = await Promise.all([
      clawhubProvider.fetchBundle({ providerSkillId: 'skill-a' }),
      clawhubProvider.fetchBundle({ providerSkillId: 'skill-a' }),
    ])

    expect(a.equals(b)).toBe(true)
    expect(a.toString('utf8')).toBe('bundle-a')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns stale bundle cache when upstream returns 429', async () => {
    const fetchMock = vi
      .fn<(input: string | URL) => Promise<Response>>()
      .mockResolvedValueOnce(mockBinaryResponse('cached-bundle'))
      .mockResolvedValueOnce(mockBinaryResponse('rate-limited', { status: 429 }))
    vi.stubGlobal('fetch', fetchMock)

    const { clawhubProvider } = await import('../skills/market/providers/clawhub.js')
    const first = await clawhubProvider.fetchBundle({ providerSkillId: 'skill-b' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await clawhubProvider.fetchBundle({ providerSkillId: 'skill-b' })

    expect(first.toString('utf8')).toBe('cached-bundle')
    expect(second.toString('utf8')).toBe('cached-bundle')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('limits details fan-out concurrency during market search', async () => {
    let inflightDetails = 0
    let maxInflightDetails = 0
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input)
      if (url.includes('/api/v1/search')) {
        return mockJsonResponse({
          results: [
            { slug: 'a', displayName: 'A', summary: 'A', version: '1.0.0' },
            { slug: 'b', displayName: 'B', summary: 'B', version: '1.0.0' },
            { slug: 'c', displayName: 'C', summary: 'C', version: '1.0.0' },
            { slug: 'd', displayName: 'D', summary: 'D', version: '1.0.0' },
          ],
        })
      }
      if (url.includes('/api/v1/skills/')) {
        inflightDetails += 1
        maxInflightDetails = Math.max(maxInflightDetails, inflightDetails)
        await new Promise((resolve) => setTimeout(resolve, 10))
        inflightDetails -= 1
        return mockJsonResponse({
          skill: {
            summary: 'details',
            displayName: 'skill',
          },
          owner: { handle: 'owner' },
          latestVersion: { version: '1.0.0' },
        })
      }
      throw new Error(`unexpected url: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { clawhubProvider } = await import('../skills/market/providers/clawhub.js')
    const entries = await clawhubProvider.search({ query: 'tools' })

    expect(entries).toHaveLength(4)
    expect(maxInflightDetails).toBeLessThanOrEqual(2)
  })
})
