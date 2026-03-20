import { randomUUID } from 'node:crypto'
import type { ToolDefinition } from '../providers/types.js'

export interface SnapshotSkill {
  id: string
  name: string
  description: string
  source: 'workspace' | 'user' | 'bundled'
  mode: 'prompt-only' | 'tool-contributor'
  promptBlock: string
}

export interface RegistrySnapshot {
  id: string
  createdAt: number
  skillsVersion: number
  toolsVersion: number
  skills: SnapshotSkill[]
  toolDefinitions: ToolDefinition[]
}

export function createEmptyRegistrySnapshot(): RegistrySnapshot {
  return {
    id: randomUUID(),
    createdAt: Date.now(),
    skillsVersion: 0,
    toolsVersion: 0,
    skills: [],
    toolDefinitions: [],
  }
}

export function parseRegistrySnapshot(value: string | null | undefined): RegistrySnapshot {
  if (!value) {
    return createEmptyRegistrySnapshot()
  }

  try {
    const parsed = JSON.parse(value) as RegistrySnapshot
    if (
      parsed &&
      typeof parsed.id === 'string' &&
      typeof parsed.createdAt === 'number' &&
      Array.isArray(parsed.skills) &&
      Array.isArray(parsed.toolDefinitions)
    ) {
      return parsed
    }
  } catch {
    // Ignore invalid persisted payloads and fall back to an empty snapshot.
  }

  return createEmptyRegistrySnapshot()
}

export function serializeRegistrySnapshot(snapshot: RegistrySnapshot): string {
  return JSON.stringify(snapshot)
}
