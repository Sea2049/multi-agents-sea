import { ensureProjectEnvLoaded } from '../config/env.js'
import { getProviderRegistry } from '../plugins/provider-registry.js'
import { DASHSCOPE_DEFAULT_MODEL_ID, DashScopeProvider } from './dashscope.js'
import type {
  ChatChunk,
  ChatChunkWithTools,
  ChatParams,
  ChatParamsWithTools,
  LLMProvider,
  ModelInfo,
  ProviderHealth,
} from './types.js'

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function shouldAttachDashScopeFallback(providerName: string): boolean {
  return providerName !== 'ollama' && providerName !== 'dashscope'
}

function getDashScopeFallbackConfig(): { provider: LLMProvider; model: string } | null {
  ensureProjectEnvLoaded()

  const apiKey = process.env['PROVIDER_DASHSCOPE_KEY']?.trim()
  if (!apiKey) {
    return null
  }

  const model = process.env['PROVIDER_DASHSCOPE_MODEL']?.trim() || DASHSCOPE_DEFAULT_MODEL_ID
  const baseURL = process.env['PROVIDER_DASHSCOPE_URL']?.trim()

  return {
    provider: new DashScopeProvider(apiKey, baseURL),
    model,
  }
}

async function collectToolChunks(stream: AsyncIterable<ChatChunkWithTools>): Promise<ChatChunkWithTools[]> {
  const chunks: ChatChunkWithTools[] = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }
  return chunks
}

export class FailoverProvider implements LLMProvider {
  readonly name: string
  readonly supportsTools: boolean

  constructor(
    private readonly primaryName: string,
    private readonly primary: LLMProvider,
    private readonly fallback: LLMProvider,
    private readonly fallbackModel: string,
  ) {
    this.name = primary.name
    this.supportsTools = Boolean(
      (primary.supportsTools && primary.chatWithTools) ||
      (fallback.supportsTools && fallback.chatWithTools),
    )
  }

  async *chat(params: ChatParams): AsyncIterable<ChatChunk> {
    let emittedPrimaryChunk = false

    try {
      for await (const chunk of this.primary.chat(params)) {
        emittedPrimaryChunk = true
        yield chunk
      }
      return
    } catch (primaryError) {
      if (emittedPrimaryChunk) {
        throw primaryError
      }

      console.warn(
        `[provider-fallback] ${this.primaryName} chat failed before first chunk; retrying with DashScope (${this.fallbackModel}).`,
      )

      try {
        for await (const chunk of this.fallback.chat({
          ...params,
          model: this.fallbackModel,
        })) {
          yield chunk
        }
        return
      } catch (fallbackError) {
        throw new Error(
          `Primary provider "${this.primaryName}" failed: ${toErrorMessage(primaryError)}; ` +
          `DashScope fallback failed: ${toErrorMessage(fallbackError)}`,
        )
      }
    }
  }

  async models(): Promise<ModelInfo[]> {
    return this.primary.models()
  }

  async validateCredentials(): Promise<ProviderHealth> {
    return this.primary.validateCredentials()
  }

  async *chatWithTools(params: ChatParamsWithTools): AsyncGenerator<ChatChunkWithTools> {
    const primaryChatWithTools = this.primary.chatWithTools?.bind(this.primary)
    const fallbackChatWithTools = this.fallback.chatWithTools?.bind(this.fallback)

    if (!primaryChatWithTools && !fallbackChatWithTools) {
      throw new Error(`Provider "${this.primaryName}" does not support tool calls`)
    }

    if (!primaryChatWithTools && fallbackChatWithTools) {
      const fallbackChunks = await collectToolChunks(fallbackChatWithTools({
        ...params,
        model: this.fallbackModel,
      }))
      for (const chunk of fallbackChunks) {
        yield chunk
      }
      return
    }

    try {
      const primaryChunks = await collectToolChunks(primaryChatWithTools!(params))
      for (const chunk of primaryChunks) {
        yield chunk
      }
      return
    } catch (primaryError) {
      if (!fallbackChatWithTools) {
        throw primaryError
      }

      console.warn(
        `[provider-fallback] ${this.primaryName} tool chat failed; retrying with DashScope (${this.fallbackModel}).`,
      )

      try {
        const fallbackChunks = await collectToolChunks(fallbackChatWithTools({
          ...params,
          model: this.fallbackModel,
        }))
        for (const chunk of fallbackChunks) {
          yield chunk
        }
        return
      } catch (fallbackError) {
        throw new Error(
          `Primary provider "${this.primaryName}" failed: ${toErrorMessage(primaryError)}; ` +
          `DashScope fallback failed: ${toErrorMessage(fallbackError)}`,
        )
      }
    }
  }
}

export function getRuntimeProviderFromEnv(providerName: string): LLMProvider {
  const primaryProvider = getProviderRegistry().createFromEnv(providerName)
  const dashScopeFallback = getDashScopeFallbackConfig()

  if (!dashScopeFallback || !shouldAttachDashScopeFallback(providerName)) {
    return primaryProvider
  }

  return new FailoverProvider(
    providerName,
    primaryProvider,
    dashScopeFallback.provider,
    dashScopeFallback.model,
  )
}
