import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { skillsRoutes } from '../routes/skills.js'
import {
  installSkillFromMarket,
  previewSkillFromMarket,
  searchSkillMarket,
} from '../skills/market/index.js'

vi.mock('../skills/market/index.js', () => ({
  searchSkillMarket: vi.fn(),
  previewSkillFromMarket: vi.fn(),
  installSkillFromMarket: vi.fn(),
}))

describe('skills market routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    app = Fastify()
    await app.register(skillsRoutes, { prefix: '/api' })
    vi.mocked(searchSkillMarket).mockReset()
    vi.mocked(previewSkillFromMarket).mockReset()
    vi.mocked(installSkillFromMarket).mockReset()
  })

  afterEach(async () => {
    await app.close()
    vi.restoreAllMocks()
  })

  it('returns retryable 429 payload for preview when upstream rate limits', async () => {
    const upstreamError = Object.assign(
      new Error('Failed to download bundle: HTTP 429'),
      {
        statusCode: 429,
        code: 'UPSTREAM_RATE_LIMIT',
        retryable: true,
      },
    )
    vi.mocked(previewSkillFromMarket).mockRejectedValueOnce(upstreamError)

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/market/preview',
      payload: {
        provider: 'clawhub',
        providerSkillId: 'capcut-mate',
      },
    })

    expect(response.statusCode).toBe(429)
    expect(response.json()).toMatchObject({
      error: 'Market preview failed: Failed to download bundle: HTTP 429',
      code: 'UPSTREAM_RATE_LIMIT',
      retryable: true,
    })
  })

  it('returns retryable 429 payload for install when upstream rate limits', async () => {
    const upstreamError = Object.assign(
      new Error('Failed to download bundle: HTTP 429'),
      {
        statusCode: 429,
        code: 'UPSTREAM_RATE_LIMIT',
        retryable: true,
      },
    )
    vi.mocked(installSkillFromMarket).mockRejectedValueOnce(upstreamError)

    const response = await app.inject({
      method: 'POST',
      url: '/api/skills/market/install',
      payload: {
        provider: 'clawhub',
        providerSkillId: 'capcut-mate',
      },
    })

    expect(response.statusCode).toBe(429)
    expect(response.json()).toMatchObject({
      error: 'Market install failed: Failed to download bundle: HTTP 429',
      code: 'UPSTREAM_RATE_LIMIT',
      retryable: true,
    })
  })
})
