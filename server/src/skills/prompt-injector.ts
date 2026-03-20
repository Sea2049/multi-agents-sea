import type { RegistrySnapshot } from '../runtime/registry-snapshot.js'
import type { SkillState } from './types.js'

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function normalizePromptText(text: string): string {
  return text.trim().replace(/\r\n/g, '\n')
}

export function buildSkillPromptBlock(skill: Pick<SkillState, 'name' | 'description' | 'instructions' | 'source'>): string {
  const instructions = normalizePromptText(skill.instructions)
  return [
    `<skill name="${escapeXml(skill.name)}" description="${escapeXml(skill.description)}" source="${skill.source}">`,
    escapeXml(instructions),
    `</skill>`,
  ].join('\n')
}

export function formatSkillsForPromptFromStates(skills: SkillState[]): string {
  const promptEligibleSkills = skills.filter(
    (skill) => skill.enabled && skill.eligible && (skill.metadata.mode ?? 'prompt-only') === 'prompt-only',
  )
  if (promptEligibleSkills.length === 0) {
    return ''
  }

  const body = promptEligibleSkills.map((skill) => buildSkillPromptBlock(skill)).join('\n')
  return ['## Available Skills', '<available_skills>', body, '</available_skills>'].join('\n')
}

export function formatSkillsForPromptFromSnapshot(snapshot?: RegistrySnapshot): string {
  if (!snapshot || snapshot.skills.length === 0) {
    return ''
  }

  const body = snapshot.skills.map((skill) => skill.promptBlock).join('\n')
  return ['## Available Skills', '<available_skills>', body, '</available_skills>'].join('\n')
}

export function appendSkillsToSystemPrompt(systemPrompt: string, snapshot?: RegistrySnapshot): string {
  const block = formatSkillsForPromptFromSnapshot(snapshot)
  if (!block) {
    return systemPrompt
  }

  return [systemPrompt, block].join('\n\n')
}
