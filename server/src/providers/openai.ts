import OpenAI from 'openai'
import type { LLMProvider, ChatParams, ChatChunk, ModelInfo, ProviderHealth } from './types.js'

export class OpenAIProvider implements LLMProvider {
  readonly name = 'openai'
  private client: OpenAI

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey })
  }

  async *chat(params: ChatParams): AsyncIterable<ChatChunk> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: params.systemPrompt },
      ...params.messages.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
    ]

    let stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>
    try {
      stream = await this.client.chat.completions.create({
        model: params.model,
        messages,
        stream: true,
        temperature: params.temperature,
        max_tokens: params.maxTokens,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'OpenAI chat request failed'
      throw new Error(`OpenAI chat error: ${message}`)
    }

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? ''
      const done = chunk.choices[0]?.finish_reason != null
      if (delta) {
        yield { delta, done: false }
      }
      if (done) {
        yield { delta: '', done: true }
      }
    }
  }

  async models(): Promise<ModelInfo[]> {
    return [
      { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000 },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128000 },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', contextWindow: 128000 },
      { id: 'gpt-4', name: 'GPT-4', contextWindow: 8192 },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', contextWindow: 16385 },
    ]
  }

  async validateCredentials(): Promise<ProviderHealth> {
    const start = Date.now()
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      try {
        await this.client.models.list({ signal: controller.signal })
      } finally {
        clearTimeout(timeout)
      }
      return { ok: true, latencyMs: Date.now() - start }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return { ok: false, error: `OpenAI validation failed: ${message}` }
    }
  }
}
