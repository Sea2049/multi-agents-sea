import type { ToolDefinition } from '../providers/types.js'

export type SkillSource = 'workspace' | 'user' | 'remote' | 'bundled'
export type SkillMode = 'prompt-only' | 'tool-contributor'

export interface SkillRequires {
  bins?: string[]
  env?: string[]
  config?: string[]
}

export interface SkillToolDeclaration {
  name: string
  description: string
  handler: string
  inputSchema: ToolDefinition['inputSchema']
}

export interface SkillMetadata {
  mode?: SkillMode
  requires?: SkillRequires
  os?: Array<'win32' | 'linux' | 'darwin'>
  homepage?: string
  tools?: SkillToolDeclaration[]
  sandbox?: 'worker' | 'docker'
}

export interface RemoteSkillIndexEntry {
  id: string
  name: string
  description: string
  author: string
  url: string
  tags: string[]
  version?: string
}

export interface RemoteSkillRecord {
  id: string
  url: string
  sha256: string
  name: string
  installedAt: number
  updatedAt: number
}

export interface SkillDefinition {
  id: string
  name: string
  description: string
  version?: string
  metadata: SkillMetadata
  instructions: string
  source: SkillSource
  dirPath: string
  filePath: string
}

export interface SkillState extends SkillDefinition {
  enabled: boolean
  trusted: boolean
  eligible: boolean
  disabledReasons: string[]
}

export interface SkillSettings {
  enabled?: boolean
  trusted?: boolean
}
