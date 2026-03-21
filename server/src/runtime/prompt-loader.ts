import { agentRuntimeProfiles } from '../../../shared/agents/runtime-profiles.js'
import type { AgentRuntimeProfile } from '../../../shared/agents/types.js'
import type { RegistrySnapshot } from './registry-snapshot.js'
import { appendSkillsToSystemPrompt } from '../skills/prompt-injector.js'

export function loadAgentProfile(agentId: string): AgentRuntimeProfile {
  const profile = agentRuntimeProfiles[agentId]
  if (!profile) {
    throw new Error(
      `Agent profile not found: "${agentId}". Available agents: ${Object.keys(agentRuntimeProfiles).length} total.`,
    )
  }
  return profile
}

function parseNumberEnv(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, parsed)
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff_]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
}

function selectReferenceSections(profile: AgentRuntimeProfile, referenceQuery?: string): Array<{ title: string; content: string }> {
  if (process.env.AGENT_REFERENCE_SECTIONS_ENABLED !== 'true') {
    return []
  }

  const maxSections = parseNumberEnv(process.env.AGENT_REFERENCE_MAX_SECTIONS, 2)
  if (maxSections <= 0 || profile.referenceSections.length === 0) {
    return []
  }

  const maxChars = parseNumberEnv(process.env.AGENT_REFERENCE_MAX_CHARS, 2_400)
  if (maxChars <= 0) {
    return []
  }

  // Rough conversion to prevent reference payloads from swallowing prompt budget.
  const budgetCharsByToken = Math.max(0, (profile.tokenBudget.reference || 0) * 4)
  const effectiveMaxChars = budgetCharsByToken > 0 ? Math.min(maxChars, budgetCharsByToken) : maxChars
  if (effectiveMaxChars <= 0) {
    return []
  }

  const queryTokens = new Set(tokenize(referenceQuery ?? ''))
  const scored = profile.referenceSections.map((section, index) => {
    let score = 0
    if (queryTokens.size > 0) {
      const haystack = `${section.title}\n${section.content}`.toLowerCase()
      for (const token of queryTokens) {
        if (haystack.includes(token)) score += 1
      }
    }
    return { section, score, index }
  })

  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    return left.index - right.index
  })

  const selected: Array<{ title: string; content: string }> = []
  let totalChars = 0
  for (const item of scored) {
    if (selected.length >= maxSections) break
    if (queryTokens.size > 0 && item.score <= 0) continue
    const sectionText = `### ${item.section.title}\n${item.section.content}`
    if (totalChars + sectionText.length > effectiveMaxChars) {
      continue
    }
    selected.push(item.section)
    totalChars += sectionText.length
  }

  if (selected.length > 0) {
    return selected
  }

  // Fallback: if no keyword match, include first section within budget.
  const first = profile.referenceSections[0]
  if (!first) return []
  const firstText = `### ${first.title}\n${first.content}`
  return firstText.length <= effectiveMaxChars ? [first] : []
}

export function loadAgentSystemPrompt(
  agentId: string,
  snapshot?: RegistrySnapshot,
  options?: { referenceQuery?: string },
): string {
  const profile = loadAgentProfile(agentId)

  const parts: string[] = [profile.systemPrompt]

  if (profile.stylePrompt) {
    parts.push('\n\n' + profile.stylePrompt)
  }

  if (profile.outputContract) {
    parts.push('\n\n## Output Format\n' + profile.outputContract)
  }

  const referenceSections = selectReferenceSections(profile, options?.referenceQuery)
  if (referenceSections.length > 0) {
    const referenceBlock = referenceSections
      .map((section) => `### ${section.title}\n${section.content}`)
      .join('\n\n')
    parts.push('\n\n## Reference Context\n' + referenceBlock)
  }

  return appendSkillsToSystemPrompt(parts.join(''), snapshot)
}
