import type { LLMProvider } from '../providers/types.js'
import type { RegistrySnapshot } from '../runtime/registry-snapshot.js'
import { appendSkillsToSystemPrompt } from '../skills/prompt-injector.js'
import type { TaskPlan, StepResult } from './types.js'

const AGGREGATOR_SYSTEM_PROMPT = `You are a synthesis coordinator. You will receive the results of multiple AI agents that worked on different parts of a task. Your job is to integrate their outputs into a single, well-structured final report.

The report should:
1. Start with a concise executive summary
2. Present each step's contribution in a logical order
3. Highlight key findings, decisions, or outputs
4. End with a conclusion or next steps if applicable

Use clear headings and formatting. Be comprehensive but avoid redundancy.`

export interface AggregatorParams {
  taskId: string
  objective: string
  plan: TaskPlan
  stepResults: Map<string, StepResult>
  provider: LLMProvider
  model: string
  snapshot?: RegistrySnapshot
}

function buildFallbackReport(params: AggregatorParams): string {
  const { objective, plan, stepResults } = params
  const lines: string[] = [
    `# Task Report`,
    ``,
    `**Objective:** ${objective}`,
    ``,
    `**Summary:** ${plan.summary}`,
    ``,
    `## Steps`,
  ]

  for (const step of plan.steps) {
    const result = stepResults.get(step.id)
    lines.push(``, `### ${step.title} (${step.id})`)
    lines.push(`**Assigned to:** ${step.assignee}`)
    if (result?.error) {
      lines.push(`**Status:** Failed`)
      lines.push(`**Error:** ${result.error}`)
    } else if (result) {
      lines.push(`**Status:** Completed`)
      lines.push(``)
      lines.push(result.summary ?? result.output)
    } else {
      lines.push(`**Status:** No result`)
    }
  }

  return lines.join('\n')
}

export async function aggregateResults(params: AggregatorParams): Promise<string> {
  const { objective, plan, stepResults, provider, model, snapshot } = params

  const stepSummaries = plan.steps.map((step) => {
    const result = stepResults.get(step.id)
    return {
      stepId: step.id,
      title: step.title,
      assignee: step.assignee,
      objective: step.objective,
      output: result?.summary ?? result?.output ?? '',
      error: result?.error,
      status: result?.error ? 'failed' : result ? 'completed' : 'unknown',
    }
  })

  const userPrompt = `Task Objective: ${objective}

Plan Summary: ${plan.summary}

Step Results:
${JSON.stringify(stepSummaries, null, 2)}

Please synthesize these results into a final comprehensive report.`

  try {
    let fullText = ''
    for await (const chunk of provider.chat({
      model,
      systemPrompt: appendSkillsToSystemPrompt(AGGREGATOR_SYSTEM_PROMPT, snapshot),
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.4,
    })) {
      if (chunk.delta) fullText += chunk.delta
    }
    return fullText || buildFallbackReport(params)
  } catch {
    return buildFallbackReport(params)
  }
}
