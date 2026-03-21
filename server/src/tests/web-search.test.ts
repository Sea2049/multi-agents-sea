import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeTool } from '../tools/index.js'

function createAbortError(): Error {
  const error = new Error('aborted')
  error.name = 'AbortError'
  return error
}

describe('web_search timeout handling', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('should surface a fetch timeout as non-error tool output', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init?: RequestInit) => new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(createAbortError()), { once: true })
      })),
    )

    const resultPromise = executeTool({
      id: 'call-web-timeout',
      name: 'web_search',
      input: { query: '温度传感器' },
    })

    await vi.advanceTimersByTimeAsync(8_000)

    await expect(resultPromise).resolves.toMatchObject({
      toolCallId: 'call-web-timeout',
      toolName: 'web_search',
      output: 'Search timed out for query: 温度传感器',
    })

    const result = await resultPromise
    expect(result.isError).toBeUndefined()
  })
})
