import { describe, it, expect, vi, beforeEach } from 'vitest'
import { summarizeStepOutput } from '../orchestrator/step-summarizer.js'

const mockProvider = {
  name: 'mock',
  chat: vi.fn(),
  models: vi.fn(),
  validateCredentials: vi.fn(),
}

async function* mockChatStream(chunks: string[]) {
  for (const c of chunks) {
    yield { delta: c, done: false }
  }
  yield { delta: '', done: true }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('summarizeStepOutput', () => {
  it('短输出直接复用：rawOutput ≤ 500 应返回原文，不调用 provider.chat', async () => {
    const shortOutput = 'A'.repeat(500)

    const result = await summarizeStepOutput({
      provider: mockProvider as any,
      model: 'gpt-4',
      stepTitle: 'Test Step',
      rawOutput: shortOutput,
    })

    expect(result).toBe(shortOutput)
    expect(mockProvider.chat).not.toHaveBeenCalled()
  })

  it('长输出调用 LLM：rawOutput > 500 应调用 provider.chat 并返回摘要', async () => {
    const longOutput = 'B'.repeat(501)
    mockProvider.chat.mockReturnValue(mockChatStream(['Summary ', 'here.']))

    const result = await summarizeStepOutput({
      provider: mockProvider as any,
      model: 'gpt-4',
      stepTitle: 'Long Step',
      rawOutput: longOutput,
    })

    expect(mockProvider.chat).toHaveBeenCalledOnce()
    expect(result).toBe('Summary here.')
  })

  it('LLM 调用失败时回退：provider.chat 抛出异常，应返回原始 rawOutput 不抛出错误', async () => {
    const longOutput = 'C'.repeat(501)
    mockProvider.chat.mockImplementation(() => {
      throw new Error('LLM unavailable')
    })

    const result = await summarizeStepOutput({
      provider: mockProvider as any,
      model: 'gpt-4',
      stepTitle: 'Failing Step',
      rawOutput: longOutput,
    })

    expect(result).toBe(longOutput)
  })

  it('LLM 返回空串时回退：provider.chat 返回空 delta，应返回原始 rawOutput', async () => {
    const longOutput = 'D'.repeat(501)
    mockProvider.chat.mockReturnValue(mockChatStream([]))

    const result = await summarizeStepOutput({
      provider: mockProvider as any,
      model: 'gpt-4',
      stepTitle: 'Empty LLM Step',
      rawOutput: longOutput,
    })

    expect(result).toBe(longOutput)
  })
})
