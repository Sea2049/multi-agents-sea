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

export function loadAgentSystemPrompt(agentId: string, snapshot?: RegistrySnapshot): string {
  const profile = loadAgentProfile(agentId)

  const parts: string[] = [profile.systemPrompt]

  if (profile.stylePrompt) {
    parts.push('\n\n' + profile.stylePrompt)
  }

  if (profile.outputContract) {
    parts.push('\n\n## Output Format\n' + profile.outputContract)
  }

  return appendSkillsToSystemPrompt(parts.join(''), snapshot)
}
