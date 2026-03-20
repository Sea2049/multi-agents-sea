import type { ModelInfo, ProviderHealth } from './types.js'
import { AnthropicProvider } from './anthropic.js'

const MINIMAX_BASE_URL = 'https://api.minimaxi.com/anthropic'
export const MINIMAX_DEFAULT_MODEL_ID = 'MiniMax-M2.7'

export const MINIMAX_MODELS: ModelInfo[] = [
  { id: MINIMAX_DEFAULT_MODEL_ID, name: 'MiniMax M2.7', contextWindow: 204800 },
  { id: 'MiniMax-M2.7-highspeed', name: 'MiniMax M2.7 Highspeed', contextWindow: 204800 },
  { id: 'MiniMax-M2.5', name: 'MiniMax M2.5', contextWindow: 204800 },
  { id: 'MiniMax-M2.5-highspeed', name: 'MiniMax M2.5 Highspeed', contextWindow: 204800 },
  { id: 'MiniMax-M2.1', name: 'MiniMax M2.1', contextWindow: 204800 },
  { id: 'MiniMax-M2.1-highspeed', name: 'MiniMax M2.1 Highspeed', contextWindow: 204800 },
  { id: 'MiniMax-M2', name: 'MiniMax M2', contextWindow: 204800 },
]

export class MiniMaxProvider extends AnthropicProvider {
  override readonly name: string = 'minimax'

  constructor(apiKey: string, baseURL: string = MINIMAX_BASE_URL) {
    super(apiKey, baseURL)
  }

  override async models(): Promise<ModelInfo[]> {
    return MINIMAX_MODELS
  }

  override async validateCredentials(): Promise<ProviderHealth> {
    const start = Date.now()
    try {
      const gen = this.chat({
        model: MINIMAX_DEFAULT_MODEL_ID,
        systemPrompt: 'You are a helpful assistant.',
        messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 16,
      })
      for await (const _ of gen) {
        break
      }
      return { ok: true, latencyMs: Date.now() - start }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return { ok: false, error: `MiniMax validation failed: ${message}` }
    }
  }
}
