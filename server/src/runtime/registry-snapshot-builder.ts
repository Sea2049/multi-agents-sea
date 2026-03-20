import { randomUUID } from 'node:crypto'
import { getSkillRegistry } from '../skills/registry.js'
import { getToolDefinitions, getToolRegistryVersion } from '../tools/index.js'
import type { RegistrySnapshot } from './registry-snapshot.js'

export function createRegistrySnapshot(): RegistrySnapshot {
  const skillRegistry = getSkillRegistry()
  return {
    id: randomUUID(),
    createdAt: Date.now(),
    skillsVersion: skillRegistry.getVersion(),
    toolsVersion: getToolRegistryVersion(),
    skills: skillRegistry.getSnapshotSkills(),
    toolDefinitions: getToolDefinitions(),
  }
}
