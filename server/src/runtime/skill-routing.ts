import type { SkillRoutingPolicy } from './registry-snapshot.js'

interface SkillRoutingRule {
  allow?: string[]
  deny?: string[]
}

function toUniqueStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const normalized = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)

  if (normalized.length === 0) {
    return undefined
  }

  return [...new Set(normalized)]
}

function sanitizeSkillRoutingRule(value: unknown): SkillRoutingRule | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const candidate = value as { allow?: unknown; deny?: unknown }
  const allow = toUniqueStringArray(candidate.allow)
  const deny = toUniqueStringArray(candidate.deny)

  if (!allow && !deny) {
    return undefined
  }

  return { allow, deny }
}

export function sanitizeSkillRoutingPolicy(value: unknown): SkillRoutingPolicy | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const candidate = value as { defaultMode?: unknown; perAgent?: unknown }
  const defaultMode = candidate.defaultMode === 'none' ? 'none' : 'all'

  const perAgent = (() => {
    if (!candidate.perAgent || typeof candidate.perAgent !== 'object') {
      return undefined
    }
    const entries = Object.entries(candidate.perAgent as Record<string, unknown>)
      .map(([agentId, rule]) => [agentId.trim(), sanitizeSkillRoutingRule(rule)] as const)
      .filter((entry): entry is readonly [string, SkillRoutingRule] => Boolean(entry[0]) && Boolean(entry[1]))

    if (entries.length === 0) {
      return undefined
    }

    return Object.fromEntries(entries)
  })()

  return {
    defaultMode,
    perAgent,
  }
}

export function parseSkillRoutingPolicy(value: string | null | undefined): SkillRoutingPolicy | undefined {
  if (!value) {
    return undefined
  }

  try {
    const parsed = JSON.parse(value) as unknown
    return sanitizeSkillRoutingPolicy(parsed)
  } catch {
    return undefined
  }
}

export function serializeSkillRoutingPolicy(policy: SkillRoutingPolicy | undefined): string | null {
  if (!policy) {
    return null
  }

  return JSON.stringify(policy)
}
