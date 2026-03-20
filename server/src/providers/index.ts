import type { LLMProvider } from './types.js'
import { getProviderRegistry } from '../plugins/provider-registry.js'

export type ProviderName = string

export function createProvider(
  name: ProviderName,
  credentials: Record<string, string>,
): LLMProvider {
  return getProviderRegistry().create(name, credentials)
}

export function getProviderFromEnv(name: ProviderName): LLMProvider {
  return getProviderRegistry().createFromEnv(name)
}

export function listProviderNames(): string[] {
  return getProviderRegistry().listManifests().map((manifest) => manifest.id)
}

export function isProviderName(name: string): boolean {
  return getProviderRegistry().has(name)
}

export type { LLMProvider } from './types.js'
export type { ChatParams, ChatChunk, ModelInfo, ProviderHealth, Message, MessageRole } from './types.js'
