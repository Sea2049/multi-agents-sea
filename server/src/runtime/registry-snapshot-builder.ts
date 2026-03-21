import { randomUUID } from 'node:crypto'
import { getSkillRegistry } from '../skills/registry.js'
import { getToolDefinitions, getToolDefinitionsWithOwner, getToolRegistryVersion } from '../tools/index.js'
import type { RegistrySnapshot } from './registry-snapshot.js'

export function createRegistrySnapshot(): RegistrySnapshot {
  const skillRegistry = getSkillRegistry()
  const toolDefinitionsWithOwner = getToolDefinitionsWithOwner()
  return {
    id: randomUUID(),
    createdAt: Date.now(),
    skillsVersion: skillRegistry.getVersion(),
    toolsVersion: getToolRegistryVersion(),
    skills: skillRegistry.getSnapshotSkills(),
    toolDefinitions: getToolDefinitions(),
    toolBindings: toolDefinitionsWithOwner
      .filter((entry) => entry.ownerId !== 'builtin')
      .map((entry) => ({
        toolName: entry.definition.name,
        sourceSkillId: entry.ownerId,
      })),
  }
}
