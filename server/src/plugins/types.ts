import type { LLMProvider } from '../providers/types.js'

export type ProviderKind = 'cloud' | 'local'
export type ProviderFieldInputType = 'secret' | 'url' | 'text'

export interface ProviderFieldSchema {
  key: string
  label: string
  inputType: ProviderFieldInputType
  required?: boolean
  placeholder?: string
  defaultValue?: string
  storageKey: string
  envVar: string
}

export interface ProviderManifest {
  id: string
  label: string
  description: string
  hint: string
  kind: ProviderKind
  iconKey: string
  adapter: string
  fields: ProviderFieldSchema[]
}

export interface ProviderFactory {
  create(credentials: Record<string, string>): LLMProvider
}

export interface ProviderPluginModule {
  manifest?: ProviderManifest
  create?: (credentials: Record<string, string>) => LLMProvider
}
