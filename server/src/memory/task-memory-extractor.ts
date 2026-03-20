import type { LLMProvider } from '../providers/types.js'
import type { StepResult, TaskPlan } from '../orchestrator/types.js'
import type { Memory } from './store.js'
import { writeMemory, writeTaskReportMemory } from './writer.js'

type DerivedMemoryCategory = 'fact' | 'decision' | 'output'

interface ExtractedMemoryItem {
  content: string
  agentId?: string
  isPinned?: boolean
  pinReason?: string
}

interface ExtractedTaskMemories {
  facts?: ExtractedMemoryItem[]
  decisions?: ExtractedMemoryItem[]
  outputs?: ExtractedMemoryItem[]
}

export interface PersistTaskLongTermMemoriesParams {
  taskId: string
  taskObjective: string
  plan: TaskPlan
  stepResults: Map<string, StepResult>
  report: string
  provider: LLMProvider
  model: string
}

const MEMORY_EXTRACTION_SYSTEM_PROMPT = `You extract durable long-term memory entries from completed AI tasks.

Return ONLY valid JSON with this exact shape:
{
  "facts": [{ "content": "...", "agentId": "optional-agent-id", "isPinned": true, "pinReason": "brief reason why this is high-value" }],
  "decisions": [{ "content": "...", "agentId": "optional-agent-id", "isPinned": false }],
  "outputs": [{ "content": "...", "agentId": "optional-agent-id", "isPinned": true, "pinReason": "..." }]
}

Rules:
- facts = reusable truths, constraints, findings, or stable insights worth remembering later
- decisions = explicit choices, trade-offs, policies, or directions taken in the task
- outputs = reusable deliverables, artifacts, summaries, or conclusions produced by the task
- maximum 3 items per category
- each content must be concise and specific
- avoid markdown, numbering, and duplicates
- omit agentId unless attribution is clear from the provided data
- if a category has no useful entry, return an empty array
- isPinned: set true for high-value entries (important architectural decisions, critical facts, key deliverables); default false
- pinReason: brief phrase explaining why the entry is high-value (only when isPinned is true)`

function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('```')) {
    return trimmed
  }

  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
}

function buildExtractionPrompt(params: PersistTaskLongTermMemoriesParams): string {
  const stepSummaries = params.plan.steps.map((step) => {
    const result = params.stepResults.get(step.id)
    return {
      stepId: step.id,
      title: step.title,
      assignee: step.assignee,
      objective: step.objective,
      summary: result?.summary ?? '',
      output: result?.output ?? '',
      error: result?.error ?? null,
      status: result?.error ? 'failed' : result ? 'completed' : 'missing',
    }
  })

  const allowedAgentIds = [...new Set(params.plan.steps.map((step) => step.assignee))]

  return [
    `Task ID: ${params.taskId}`,
    ``,
    `Task Objective: ${params.taskObjective}`,
    ``,
    `Allowed Agent IDs:`,
    JSON.stringify(allowedAgentIds, null, 2),
    ``,
    `Plan Summary: ${params.plan.summary}`,
    ``,
    `Step Summaries:`,
    JSON.stringify(stepSummaries, null, 2),
    ``,
    `Final Report:`,
    params.report,
  ].join('\n')
}

async function extractTaskMemories(
  params: PersistTaskLongTermMemoriesParams,
): Promise<ExtractedTaskMemories> {
  let fullText = ''

  for await (const chunk of params.provider.chat({
    model: params.model,
    systemPrompt: MEMORY_EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildExtractionPrompt(params) }],
    temperature: 0.1,
    maxTokens: 1200,
  })) {
    if (chunk.delta) {
      fullText += chunk.delta
    }
  }

  const jsonText = stripCodeFence(fullText)
  return JSON.parse(jsonText) as ExtractedTaskMemories
}

function normalizeMemoryItems(
  items: ExtractedMemoryItem[] | undefined,
  validAgentIds: Set<string>,
): ExtractedMemoryItem[] {
  if (!Array.isArray(items)) {
    return []
  }

  const deduped = new Set<string>()
  const normalized: ExtractedMemoryItem[] = []

  for (const item of items) {
    if (!item || typeof item.content !== 'string') {
      continue
    }

    const content = item.content.replace(/\s+/g, ' ').trim().slice(0, 280)
    if (!content) {
      continue
    }

    const dedupeKey = content.toLowerCase()
    if (deduped.has(dedupeKey)) {
      continue
    }
    deduped.add(dedupeKey)

    normalized.push({
      content,
      agentId:
        typeof item.agentId === 'string' && validAgentIds.has(item.agentId)
          ? item.agentId
          : undefined,
      isPinned: item.isPinned === true,
      pinReason: item.isPinned && typeof item.pinReason === 'string' ? item.pinReason.trim().slice(0, 120) : undefined,
    })

    if (normalized.length >= 3) {
      break
    }
  }

  return normalized
}

function writeDerivedMemories(params: {
  taskId: string
  extracted: ExtractedTaskMemories
  validAgentIds: Set<string>
}): Memory[] {
  const byCategory: Array<{ key: keyof ExtractedTaskMemories; category: DerivedMemoryCategory }> = [
    { key: 'facts', category: 'fact' },
    { key: 'decisions', category: 'decision' },
    { key: 'outputs', category: 'output' },
  ]

  const saved: Memory[] = []

  for (const entry of byCategory) {
    const items = normalizeMemoryItems(params.extracted[entry.key], params.validAgentIds)
    for (const item of items) {
      saved.push(writeMemory({
        content: item.content,
        source: entry.category === 'output' && item.agentId ? 'step_summary' : 'task_report',
        taskId: params.taskId,
        agentId: item.agentId,
        category: entry.category,
        isPinned: item.isPinned ?? false,
        pinSource: item.isPinned ? 'auto' : undefined,
        pinReason: item.pinReason,
      }))
    }
  }

  return saved
}

export async function persistTaskLongTermMemories(
  params: PersistTaskLongTermMemoriesParams,
): Promise<Memory[]> {
  const saved: Memory[] = [
    writeTaskReportMemory({
      taskId: params.taskId,
      taskObjective: params.taskObjective,
      report: params.report,
    }),
  ]

  try {
    const extracted = await extractTaskMemories(params)
    const validAgentIds = new Set(params.plan.steps.map((step) => step.assignee))
    saved.push(...writeDerivedMemories({
      taskId: params.taskId,
      extracted,
      validAgentIds,
    }))
  } catch {
    // Fall back to the coarse task_report memory when extraction fails.
  }

  return saved
}
