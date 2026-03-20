import { Ollama } from 'ollama'
import type { LLMProvider, ChatParams, ChatChunk, ModelInfo, ProviderHealth } from './types.js'

export class OllamaProvider implements LLMProvider {
  readonly name = 'ollama'
  private client: Ollama
  private baseUrl: string

  constructor(baseUrl = 'http://127.0.0.1:11434') {
    this.baseUrl = baseUrl
    this.client = new Ollama({ host: baseUrl })
  }

  async *chat(params: ChatParams): AsyncIterable<ChatChunk> {
    const messages = [
      { role: 'system' as const, content: params.systemPrompt },
      ...params.messages.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
    ]

    let response: AsyncIterable<{ message: { content: string }; done: boolean }>
    try {
      response = await this.client.chat({
        model: params.model,
        messages,
        stream: true,
        options: {
          temperature: params.temperature,
          num_predict: params.maxTokens,
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ollama chat request failed'
      if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
        throw new Error(
          `Ollama service is not running. Please start Ollama at ${this.baseUrl} before using this provider.`,
        )
      }
      throw new Error(`Ollama chat error: ${message}`)
    }

    for await (const chunk of response) {
      const delta = chunk.message?.content ?? ''
      if (delta) {
        yield { delta, done: false }
      }
      if (chunk.done) {
        yield { delta: '', done: true }
      }
    }
  }

  async models(): Promise<ModelInfo[]> {
    try {
      const result = await this.client.list()
      return result.models.map((m) => ({
        id: m.name,
        name: m.name,
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
        throw new Error(
          `Ollama service is not running. Please start Ollama at ${this.baseUrl}.`,
        )
      }
      throw new Error(`Failed to list Ollama models: ${message}`)
    }
  }

  async validateCredentials(): Promise<ProviderHealth> {
    const start = Date.now()
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)
      let response: Response
      try {
        response = await fetch(`${this.baseUrl}/api/tags`, {
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeout)
      }

      if (!response.ok) {
        return {
          ok: false,
          error: `Ollama /api/tags returned HTTP ${response.status}`,
        }
      }
      return { ok: true, latencyMs: Date.now() - start }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      if (message.includes('ECONNREFUSED') || message.includes('fetch failed') || message.includes('aborted')) {
        return {
          ok: false,
          error: `Ollama service is not running at ${this.baseUrl}. Please start Ollama first.`,
        }
      }
      return { ok: false, error: `Ollama validation failed: ${message}` }
    }
  }
}
