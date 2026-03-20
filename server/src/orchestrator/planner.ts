import type { LLMProvider } from '../providers/types.js'
import type { RegistrySnapshot } from '../runtime/registry-snapshot.js'
import { appendSkillsToSystemPrompt } from '../skills/prompt-injector.js'
import type { TaskPlan } from './types.js'

const PLANNER_SYSTEM_PROMPT = `You are a task planning coordinator. Your job is to decompose a user objective into a structured plan.

Given:
- A task objective
- A team of available agents with their capabilities

Output ONLY valid JSON matching this schema (no markdown, no explanation):
{
  "taskId": "<same as input>",
  "summary": "<one sentence summary>",
  "steps": [
    {
      "id": "step-1",
      "title": "<short title>",
      "assignee": "<agentId from team>",
      "dependsOn": [],
      "objective": "<what this agent should accomplish>",
      "expectedOutput": "<what the output should look like>"
    }
  ]
}

Rules:
- Use only agentIds from the provided team
- 2-4 steps maximum for MVP
- Steps that can run in parallel should have no dependsOn
- Steps that need previous output must list dependency ids in dependsOn
- Keep objectives focused and specific`

export interface PlannerTeamMember {
  agentId: string
  name: string
  description: string
  division: string
}

export interface PlannerParams {
  taskId: string
  objective: string
  teamMembers: PlannerTeamMember[]
  provider: LLMProvider
  model: string
  snapshot?: RegistrySnapshot
  repairHints?: string
}

export async function createPlan(params: PlannerParams): Promise<TaskPlan> {
  const { taskId, objective, teamMembers, provider, model, snapshot, repairHints } = params

  const teamJson = JSON.stringify(
    teamMembers.map((m) => ({
      agentId: m.agentId,
      name: m.name,
      description: m.description,
      division: m.division,
    })),
    null,
    2,
  )

  let userPrompt = `Task ID: ${taskId}

Objective: ${objective}

Available Team Members:
${teamJson}`

  if (repairHints) {
    userPrompt += `\n\nPrevious plan had validation errors. Please fix them:\n${repairHints}`
  }

  let fullText = ''
  for await (const chunk of provider.chat({
    model,
    systemPrompt: appendSkillsToSystemPrompt(PLANNER_SYSTEM_PROMPT, snapshot),
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0.3,
  })) {
    if (chunk.delta) {
      fullText += chunk.delta
    }
  }

  const trimmed = fullText.trim()

  // 剥离可能的 markdown code fence
  const jsonStr = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    : trimmed

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    throw new Error(`Planner returned invalid JSON: ${jsonStr.slice(0, 200)}`)
  }

  return parsed as TaskPlan
}
