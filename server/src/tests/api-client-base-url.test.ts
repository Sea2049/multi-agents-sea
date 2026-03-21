import { describe, expect, it } from 'vitest'
import { DEFAULT_SERVER_BASE_URL } from '../../../src/lib/api-client.js'

describe('api-client default base URL', () => {
  it('matches backend default port to avoid frontend fallback mismatch', () => {
    expect(DEFAULT_SERVER_BASE_URL).toBe('http://127.0.0.1:3701')
  })
})
