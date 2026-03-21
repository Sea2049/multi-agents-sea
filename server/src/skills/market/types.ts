export type SkillMarketProvider = 'clawhub' | 'skillhub'

export interface SkillMarketEntry {
  id: string
  provider: SkillMarketProvider
  providerSkillId: string
  name: string
  description: string
  author: string
  url: string
  tags: string[]
  version?: string
  stats?: {
    downloads?: number
    installsCurrent?: number
    installsAllTime?: number
    stars?: number
  }
  moderation?: {
    verdict: 'clean' | 'suspicious' | 'unknown'
    summary?: string
  }
}

export type MarketCompatibility = 'compatible' | 'needs_review' | 'incompatible'
export type MarketInstallability = 'installable' | 'preview_only' | 'blocked'

export interface SkillMarketPreview {
  provider: SkillMarketProvider
  providerSkillId: string
  compatibility: MarketCompatibility
  installability: MarketInstallability
  reasons: string[]
  warnings: string[]
  localPreview: {
    skillId: string
    name: string
    description: string
    version?: string
    mode: 'prompt-only' | 'tool-contributor'
    files: string[]
    handlers: string[]
    conflict: {
      hasConflict: boolean
      existingSource?: 'workspace' | 'user' | 'imported' | 'remote' | 'bundled'
      existingFilePath?: string
      willOverride: boolean
    }
  }
}

export interface SkillMarketInstallResult {
  provider: SkillMarketProvider
  providerSkillId: string
  skillId: string
  name: string
  importedAt: number
  enabled: boolean
}

export interface SkillMarketProviderAdapter {
  provider: SkillMarketProvider
  search(params: { query?: string }): Promise<SkillMarketEntry[]>
  fetchBundle(params: { providerSkillId: string }): Promise<Buffer>
}
