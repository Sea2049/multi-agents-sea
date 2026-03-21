import type { SkillMarketEntry, SkillMarketProviderAdapter } from '../types.js'

const CLAWHUB_BASE_URL = process.env['SEA_MARKET_CLAWHUB_BASE_URL']?.trim() || 'https://clawhub.ai'
const CLAWHUB_TIMEOUT_MS = Number(process.env['SEA_MARKET_HTTP_TIMEOUT_MS'] ?? 20_000)
const CLAWHUB_RESULT_LIMIT = Number(process.env['SEA_MARKET_RESULT_LIMIT'] ?? 30)
const CLAWHUB_RETRY_MAX_ATTEMPTS = Number(process.env['SEA_MARKET_RETRY_MAX_ATTEMPTS'] ?? 3)
const CLAWHUB_RETRY_BASE_DELAY_MS = Number(process.env['SEA_MARKET_RETRY_BASE_DELAY_MS'] ?? 500)
const CLAWHUB_SEARCH_CACHE_TTL_MS = Number(process.env['SEA_MARKET_SEARCH_CACHE_TTL_MS'] ?? 5 * 60 * 1000)
const CLAWHUB_BUNDLE_CACHE_TTL_MS = Number(process.env['SEA_MARKET_BUNDLE_CACHE_TTL_MS'] ?? 30 * 60 * 1000)
const CLAWHUB_SEARCH_CACHE_MAX_ENTRIES = Math.max(1, Number(process.env['SEA_MARKET_SEARCH_CACHE_MAX_ENTRIES'] ?? 80))
const CLAWHUB_BUNDLE_CACHE_MAX_ENTRIES = Math.max(1, Number(process.env['SEA_MARKET_BUNDLE_CACHE_MAX_ENTRIES'] ?? 40))

interface CacheEntry<T> {
  createdAt: number
  value: T
}

const searchCache = new Map<string, CacheEntry<SkillMarketEntry[]>>()
const bundleCache = new Map<string, CacheEntry<Buffer>>()

interface ClawHubSearchResult {
  slug: string
  displayName: string
  summary: string
  version: string | null
}

interface ClawHubSearchResponse {
  results?: ClawHubSearchResult[]
}

interface ClawHubSkillDetailsResponse {
  skill?: {
    slug: string
    displayName: string
    summary: string
    stats?: {
      downloads?: number
      installsCurrent?: number
      installsAllTime?: number
      stars?: number
    }
  }
  latestVersion?: {
    version?: string
  }
  owner?: {
    handle?: string
    displayName?: string
  }
  moderation?: {
    verdict?: string
    summary?: string
  } | null
}

function logMetric(event: string, fields: Record<string, unknown>): void {
  const payload = {
    event,
    provider: 'clawhub',
    ...fields,
  }
  console.info(`[market] ${JSON.stringify(payload)}`)
}

function getCache<T>(
  cache: Map<string, CacheEntry<T>>,
  cacheName: 'search' | 'bundle',
  key: string,
  ttlMs: number,
): T | null {
  const entry = cache.get(key)
  if (!entry) {
    return null
  }
  const ageMs = Date.now() - entry.createdAt
  if (ageMs > ttlMs) {
    cache.delete(key)
    logMetric('cache_expired', { cacheName, key, ageMs, ttlMs })
    return null
  }
  // LRU touch: move to newest
  cache.delete(key)
  cache.set(key, entry)
  logMetric('cache_hit', { cacheName, key, ageMs })
  return entry.value
}

function setCache<T>(
  cache: Map<string, CacheEntry<T>>,
  cacheName: 'search' | 'bundle',
  key: string,
  value: T,
  maxEntries: number,
): void {
  if (cache.has(key)) {
    cache.delete(key)
  }
  cache.set(key, { createdAt: Date.now(), value })
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value as string | undefined
    if (!oldestKey) {
      break
    }
    cache.delete(oldestKey)
    logMetric('cache_evict_lru', {
      cacheName,
      evictedKey: oldestKey,
      maxEntries,
      sizeAfterEvict: cache.size,
    })
  }
}

function getStaleCache<T>(
  cache: Map<string, CacheEntry<T>>,
  cacheName: 'search' | 'bundle',
  key: string,
): T | null {
  const entry = cache.get(key)
  if (!entry) {
    return null
  }
  logMetric('cache_fallback_hit', {
    cacheName,
    key,
    ageMs: Date.now() - entry.createdAt,
  })
  return entry.value
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) {
    return null
  }
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000)
  }
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) {
    return null
  }
  return Math.max(0, timestamp - Date.now())
}

function computeBackoffDelayMs(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs !== null) {
    return Math.max(200, retryAfterMs)
  }
  const exponential = CLAWHUB_RETRY_BASE_DELAY_MS * (2 ** Math.max(0, attempt - 1))
  const jitter = Math.floor(Math.random() * 200)
  return exponential + jitter
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CLAWHUB_TIMEOUT_MS)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchWithRetry(url: string, context: string): Promise<Response> {
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= CLAWHUB_RETRY_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url)
      if (response.ok) {
        return response
      }
      if (!isRetryableStatus(response.status) || attempt === CLAWHUB_RETRY_MAX_ATTEMPTS) {
        throw new Error(`HTTP ${response.status}`)
      }
      const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'))
      const delayMs = computeBackoffDelayMs(attempt, retryAfterMs)
      logMetric('retry_scheduled', {
        context,
        attempt,
        status: response.status,
        delayMs,
      })
      await sleep(delayMs)
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error))
      lastError = normalized
      if (attempt === CLAWHUB_RETRY_MAX_ATTEMPTS) {
        break
      }
      const delayMs = computeBackoffDelayMs(attempt, null)
      logMetric('retry_scheduled', {
        context,
        attempt,
        error: normalized.message,
        delayMs,
      })
      await sleep(delayMs)
    }
  }
  logMetric('retry_exhausted', {
    context,
    attempts: CLAWHUB_RETRY_MAX_ATTEMPTS,
    error: lastError?.message ?? 'fetch failed',
  })
  throw lastError ?? new Error('fetch failed')
}

async function fetchJson<T>(url: string, context: string): Promise<T> {
  const response = await fetchWithRetry(url, context)
  return await response.json() as T
}

function normalizeModeration(details: ClawHubSkillDetailsResponse): SkillMarketEntry['moderation'] {
  const verdict = details.moderation?.verdict
  if (!verdict) {
    return { verdict: 'unknown' }
  }
  if (verdict === 'suspicious') {
    return {
      verdict: 'suspicious',
      summary: details.moderation?.summary,
    }
  }
  return {
    verdict: 'clean',
    summary: details.moderation?.summary,
  }
}

function normalizeSkillEntry(searchItem: ClawHubSearchResult, details: ClawHubSkillDetailsResponse): SkillMarketEntry {
  const owner = details.owner?.displayName?.trim()
    || details.owner?.handle?.trim()
    || 'unknown'
  const latestVersion = details.latestVersion?.version?.trim()
    || searchItem.version?.trim()
    || undefined

  return {
    id: `${CLAWHUB_BASE_URL}#${searchItem.slug}`,
    provider: 'clawhub',
    providerSkillId: searchItem.slug,
    name: details.skill?.displayName?.trim() || searchItem.displayName.trim(),
    description: details.skill?.summary?.trim() || searchItem.summary.trim(),
    author: owner,
    url: `${CLAWHUB_BASE_URL}/skills/${encodeURIComponent(searchItem.slug)}`,
    tags: ['clawhub'],
    version: latestVersion,
    stats: details.skill?.stats,
    moderation: normalizeModeration(details),
  }
}

export const clawhubProvider: SkillMarketProviderAdapter = {
  provider: 'clawhub',

  async search({ query }): Promise<SkillMarketEntry[]> {
    const normalizedQuery = query?.trim()
    const cacheKey = normalizedQuery ? normalizedQuery.toLowerCase() : '__default__'
    const cached = getCache(searchCache, 'search', cacheKey, CLAWHUB_SEARCH_CACHE_TTL_MS)
    if (cached) {
      return cached
    }

    const searchUrl = new URL('/api/v1/search', CLAWHUB_BASE_URL)
    if (normalizedQuery) {
      searchUrl.searchParams.set('q', normalizedQuery)
    } else {
      searchUrl.searchParams.set('q', 'skills')
    }
    searchUrl.searchParams.set('nonSuspicious', 'true')

    try {
      const searchResponse = await fetchJson<ClawHubSearchResponse>(
        searchUrl.toString(),
        `search:${cacheKey}`,
      )
      const baseResults = (searchResponse.results ?? []).slice(0, CLAWHUB_RESULT_LIMIT)
      if (baseResults.length === 0) {
        setCache(searchCache, 'search', cacheKey, [], CLAWHUB_SEARCH_CACHE_MAX_ENTRIES)
        return []
      }

      const entries = await Promise.all(baseResults.map(async (item) => {
        const detailsUrl = new URL(`/api/v1/skills/${encodeURIComponent(item.slug)}`, CLAWHUB_BASE_URL)
        try {
          const details = await fetchJson<ClawHubSkillDetailsResponse>(
            detailsUrl.toString(),
            `details:${item.slug}`,
          )
          return normalizeSkillEntry(item, details)
        } catch {
          return normalizeSkillEntry(item, {})
        }
      }))

      setCache(
        searchCache,
        'search',
        cacheKey,
        entries,
        CLAWHUB_SEARCH_CACHE_MAX_ENTRIES,
      )
      return entries
    } catch (error) {
      const stale = getStaleCache(searchCache, 'search', cacheKey)
      if (stale) {
        return stale
      }
      throw error
    }
  },

  async fetchBundle({ providerSkillId }): Promise<Buffer> {
    const cached = getCache(bundleCache, 'bundle', providerSkillId, CLAWHUB_BUNDLE_CACHE_TTL_MS)
    if (cached) {
      return cached
    }

    const downloadUrl = new URL('/api/v1/download', CLAWHUB_BASE_URL)
    downloadUrl.searchParams.set('slug', providerSkillId)

    try {
      const response = await fetchWithRetry(
        downloadUrl.toString(),
        `bundle:${providerSkillId}`,
      )
      const data = await response.arrayBuffer()
      const bundle = Buffer.from(data)
      setCache(
        bundleCache,
        'bundle',
        providerSkillId,
        bundle,
        CLAWHUB_BUNDLE_CACHE_MAX_ENTRIES,
      )
      return bundle
    } catch (error) {
      const stale = getStaleCache(bundleCache, 'bundle', providerSkillId)
      if (stale) {
        return stale
      }
      throw error instanceof Error
        ? new Error(`Failed to download bundle: ${error.message}`)
        : new Error(`Failed to download bundle: ${String(error)}`)
    }
  },
}
