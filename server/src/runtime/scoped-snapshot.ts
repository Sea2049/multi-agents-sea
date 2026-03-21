import { randomUUID } from 'node:crypto'
import type { RegistrySnapshot, SkillRoutingPolicy } from './registry-snapshot.js'

function resolveAllowedSkillIds(base: RegistrySnapshot, agentId: string, routing: SkillRoutingPolicy): Set<string> {
  const defaultMode = routing.defaultMode
  const rule = routing.perAgent?.[agentId]
  const allowed = new Set<string>()

  if (defaultMode === 'all') {
    for (const skill of base.skills) {
      allowed.add(skill.id)
    }
  }

  for (const skillId of rule?.allow ?? []) {
    allowed.add(skillId)
  }

  for (const skillId of rule?.deny ?? []) {
    allowed.delete(skillId)
  }

  return allowed
}

function isFullSkillSet(base: RegistrySnapshot, allowedSkillIds: Set<string>): boolean {
  if (allowedSkillIds.size !== base.skills.length) {
    return false
  }

  for (const skill of base.skills) {
    if (!allowedSkillIds.has(skill.id)) {
      return false
    }
  }

  return true
}

export function deriveScopedSnapshot(
  base: RegistrySnapshot,
  agentId: string,
  routing?: SkillRoutingPolicy,
): RegistrySnapshot {
  if (!routing) {
    return base
  }

  const allowedSkillIds = resolveAllowedSkillIds(base, agentId, routing)
  if (isFullSkillSet(base, allowedSkillIds)) {
    return base
  }

  const scopedSkills = base.skills.filter((skill) => allowedSkillIds.has(skill.id))
  const scopedToolBindings = base.toolBindings.filter((binding) => allowedSkillIds.has(binding.sourceSkillId))

  const boundToolNames = new Set(scopedToolBindings.map((binding) => binding.toolName))
  const allBoundToolNames = new Set(base.toolBindings.map((binding) => binding.toolName))

  const scopedToolDefinitions = base.toolDefinitions.filter((tool) => {
    // Keep all builtins/unbound tools, and keep only bound tools mapped to allowed skills.
    if (!allBoundToolNames.has(tool.name)) {
      return true
    }
    return boundToolNames.has(tool.name)
  })

  return {
    ...base,
    id: randomUUID(),
    createdAt: Date.now(),
    skills: scopedSkills,
    toolDefinitions: scopedToolDefinitions,
    toolBindings: scopedToolBindings,
  }
}
