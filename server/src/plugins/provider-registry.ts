import { AnthropicProvider } from '../providers/anthropic.js'
import { DashScopeProvider } from '../providers/dashscope.js'
import { MiniMaxProvider } from '../providers/minimax.js'
import { OllamaProvider } from '../providers/ollama.js'
import { OpenAIProvider } from '../providers/openai.js'
import type { LLMProvider } from '../providers/types.js'
import { ensureProjectEnvLoaded } from '../config/env.js'
import type { ProviderFactory, ProviderManifest } from './types.js'

interface ProviderRegistryEntry {
  manifest: ProviderManifest
  factory: ProviderFactory
}

function createBuiltinManifests(): ProviderRegistryEntry[] {
  return [
    {
      manifest: {
        id: 'openai',
        label: 'OpenAI',
        description: 'OpenAI Chat Completions provider',
        hint: '需要 API Key（sk-...）',
        kind: 'cloud',
        iconKey: 'sparkles',
        adapter: 'openai',
        fields: [
          {
            key: 'apiKey',
            label: 'API Key',
            inputType: 'secret',
            required: true,
            placeholder: 'sk-...',
            storageKey: 'openai',
            envVar: 'PROVIDER_OPENAI_KEY',
          },
        ],
      },
      factory: {
        create(credentials) {
          const apiKey = credentials['apiKey']
          if (!apiKey) {
            throw new Error('OpenAI provider requires credentials.apiKey')
          }
          return new OpenAIProvider(apiKey)
        },
      },
    },
    {
      manifest: {
        id: 'anthropic',
        label: 'Anthropic',
        description: 'Anthropic Messages API provider',
        hint: '需要 API Key（sk-ant-...）',
        kind: 'cloud',
        iconKey: 'bot',
        adapter: 'anthropic',
        fields: [
          {
            key: 'apiKey',
            label: 'API Key',
            inputType: 'secret',
            required: true,
            placeholder: 'sk-ant-...',
            storageKey: 'anthropic',
            envVar: 'PROVIDER_ANTHROPIC_KEY',
          },
        ],
      },
      factory: {
        create(credentials) {
          const apiKey = credentials['apiKey']
          if (!apiKey) {
            throw new Error('Anthropic provider requires credentials.apiKey')
          }
          return new AnthropicProvider(apiKey)
        },
      },
    },
    {
      manifest: {
        id: 'minimax',
        label: 'MiniMax',
        description: 'MiniMax Anthropic-compatible provider',
        hint: '国产大模型，兼容 Anthropic 接口',
        kind: 'cloud',
        iconKey: 'zap',
        adapter: 'minimax',
        fields: [
          {
            key: 'apiKey',
            label: 'API Key',
            inputType: 'secret',
            required: true,
            placeholder: 'sk-...',
            storageKey: 'minimax',
            envVar: 'PROVIDER_MINIMAX_KEY',
          },
          {
            key: 'baseUrl',
            label: 'Base URL',
            inputType: 'url',
            placeholder: 'https://api.minimaxi.com/anthropic',
            defaultValue: 'https://api.minimaxi.com/anthropic',
            storageKey: 'minimax:baseUrl',
            envVar: 'PROVIDER_MINIMAX_URL',
          },
        ],
      },
      factory: {
        create(credentials) {
          const apiKey = credentials['apiKey']
          if (!apiKey) {
            throw new Error('MiniMax provider requires credentials.apiKey')
          }
          const baseUrl = credentials['baseUrl'] ?? 'https://api.minimaxi.com/anthropic'
          return new MiniMaxProvider(apiKey, baseUrl)
        },
      },
    },
    {
      manifest: {
        id: 'dashscope',
        label: 'DashScope',
        description: 'Alibaba Cloud DashScope OpenAI-compatible provider',
        hint: '阿里云百炼 / Qwen，兼容 OpenAI Chat Completions',
        kind: 'cloud',
        iconKey: 'cloud',
        adapter: 'openai',
        fields: [
          {
            key: 'apiKey',
            label: 'API Key',
            inputType: 'secret',
            required: true,
            placeholder: 'sk-...',
            storageKey: 'dashscope',
            envVar: 'PROVIDER_DASHSCOPE_KEY',
          },
          {
            key: 'baseUrl',
            label: 'Base URL',
            inputType: 'url',
            placeholder: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            defaultValue: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            storageKey: 'dashscope:baseUrl',
            envVar: 'PROVIDER_DASHSCOPE_URL',
          },
        ],
      },
      factory: {
        create(credentials) {
          const apiKey = credentials['apiKey']
          if (!apiKey) {
            throw new Error('DashScope provider requires credentials.apiKey')
          }
          const baseUrl = credentials['baseUrl'] ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1'
          return new DashScopeProvider(apiKey, baseUrl)
        },
      },
    },
    {
      manifest: {
        id: 'ollama',
        label: 'Ollama',
        description: 'Local Ollama provider',
        hint: '本地运行，无需 API Key',
        kind: 'local',
        iconKey: 'server',
        adapter: 'ollama',
        fields: [
          {
            key: 'baseUrl',
            label: 'Base URL',
            inputType: 'url',
            placeholder: 'http://127.0.0.1:11434',
            defaultValue: 'http://127.0.0.1:11434',
            storageKey: 'ollama:baseUrl',
            envVar: 'PROVIDER_OLLAMA_URL',
          },
        ],
      },
      factory: {
        create(credentials) {
          const baseUrl = credentials['baseUrl'] ?? 'http://127.0.0.1:11434'
          return new OllamaProvider(baseUrl)
        },
      },
    },
  ]
}

export class ProviderRegistry {
  private readonly providers = new Map<string, ProviderRegistryEntry>()

  registerProvider(manifest: ProviderManifest, factory: ProviderFactory): void {
    this.providers.set(manifest.id, { manifest, factory })
  }

  has(id: string): boolean {
    return this.providers.has(id)
  }

  getManifest(id: string): ProviderManifest | undefined {
    return this.providers.get(id)?.manifest
  }

  listManifests(): ProviderManifest[] {
    return [...this.providers.values()].map((entry) => entry.manifest)
  }

  create(id: string, credentials: Record<string, string>): LLMProvider {
    const entry = this.providers.get(id)
    if (!entry) {
      throw new Error(`Unknown provider: ${id}`)
    }

    return entry.factory.create(credentials)
  }

  createFromEnv(id: string): LLMProvider {
    ensureProjectEnvLoaded()

    const manifest = this.getManifest(id)
    if (!manifest) {
      throw new Error(`Unknown provider: ${id}`)
    }

    const credentials: Record<string, string> = {}
    for (const field of manifest.fields) {
      const envValue = process.env[field.envVar]?.trim()
      const resolved = envValue || field.defaultValue
      if (resolved) {
        credentials[field.key] = resolved
      }

      if (field.required && !resolved) {
        throw new Error(`${field.envVar} env var is not set`)
      }
    }

    return this.create(id, credentials)
  }

  isConfigured(id: string): boolean {
    ensureProjectEnvLoaded()

    const manifest = this.getManifest(id)
    if (!manifest) {
      return false
    }

    return manifest.fields.every((field) => {
      if (!field.required) {
        return true
      }

      return Boolean(process.env[field.envVar]?.trim() || field.defaultValue)
    })
  }
}

let providerRegistrySingleton: ProviderRegistry | null = null

export function initProviderRegistry(): ProviderRegistry {
  if (!providerRegistrySingleton) {
    providerRegistrySingleton = new ProviderRegistry()
    for (const entry of createBuiltinManifests()) {
      providerRegistrySingleton.registerProvider(entry.manifest, entry.factory)
    }
  }

  return providerRegistrySingleton
}

export function getProviderRegistry(): ProviderRegistry {
  if (!providerRegistrySingleton) {
    return initProviderRegistry()
  }

  return providerRegistrySingleton
}
