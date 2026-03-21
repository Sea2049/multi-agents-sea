import type { LLMProvider } from '../providers/types.js'
import type { StepResult, TaskPlan } from '../orchestrator/types.js'
import type { Memory } from './store.js'
import { writeMemory, writeTaskReportMemory } from './writer.js'
import { upsertEntity, insertRelation } from './entity-store.js'

type DerivedMemoryCategory = 'fact' | 'decision' | 'output'

interface ExtractedMemoryItem {
  content: string
  agentId?: string
  isPinned?: boolean
  pinReason?: string
}

interface ExtractedEntityItem {
  name: string
  type: string
  description?: string
}

interface ExtractedRelationItem {
  source: string
  target: string
  relationType: string
}

interface ExtractedTaskMemories {
  facts?: ExtractedMemoryItem[]
  decisions?: ExtractedMemoryItem[]
  outputs?: ExtractedMemoryItem[]
  entities?: ExtractedEntityItem[]
  relations?: ExtractedRelationItem[]
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

const VALID_ENTITY_TYPES = new Set(['person', 'project', 'technology', 'file', 'concept', 'other'])
const VALID_RELATION_TYPES = new Set(['uses', 'depends_on', 'decided', 'created', 'blocked_by', 'related_to'])

const MEMORY_EXTRACTION_SYSTEM_PROMPT = `You extract durable long-term memory entries from completed AI tasks.

You must respond with a single JSON object with these keys:
{
  "facts": [{ "content": "...", "agentId": "optional-agent-id", "isPinned": true, "pinReason": "brief reason why this is high-value" }],
  "decisions": [{ "content": "...", "agentId": "optional-agent-id", "isPinned": false }],
  "outputs": [{ "content": "...", "agentId": "optional-agent-id", "isPinned": true, "pinReason": "..." }],
  "entities": [{ "name": "...", "type": "...", "description": "optional short description" }],
  "relations": [{ "source": "entity name", "target": "entity name", "relationType": "..." }]
}

Rules:
- facts = reusable truths, constraints, findings, or stable insights worth remembering later (max 5)
- decisions = explicit choices, trade-offs, policies, or directions taken in the task (max 3)
- outputs = reusable deliverables, artifacts, summaries, or conclusions produced by the task (max 3)
- entities = named entities mentioned in the task; type must be one of: person, project, technology, file, concept, other (max 10)
- relations = relationships between entities; relationType must be one of: uses, depends_on, decided, created, blocked_by, related_to (max 15)
- source and target in relations must be entity names from the entities array
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
    maxTokens: 1800,
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

function normalizeEntityItems(items: ExtractedEntityItem[] | undefined): ExtractedEntityItem[] {
  if (!Array.isArray(items)) return []

  const seen = new Set<string>()
  const normalized: ExtractedEntityItem[] = []

  for (const item of items) {
    if (!item || typeof item.name !== 'string' || !item.name.trim()) continue
    if (!VALID_ENTITY_TYPES.has(item.type)) continue

    const key = item.name.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    normalized.push({
      name: item.name.trim().slice(0, 120),
      type: item.type,
      description: typeof item.description === 'string' ? item.description.trim().slice(0, 240) : undefined,
    })

    if (normalized.length >= 10) break
  }

  return normalized
}

function normalizeRelationItems(
  items: ExtractedRelationItem[] | undefined,
  validEntityNames: Set<string>,
): ExtractedRelationItem[] {
  if (!Array.isArray(items)) return []

  const normalized: ExtractedRelationItem[] = []

  for (const item of items) {
    if (!item || typeof item.source !== 'string' || typeof item.target !== 'string') continue
    if (!VALID_RELATION_TYPES.has(item.relationType)) continue
    if (!validEntityNames.has(item.source) || !validEntityNames.has(item.target)) continue

    normalized.push({
      source: item.source,
      target: item.target,
      relationType: item.relationType,
    })

    if (normalized.length >= 15) break
  }

  return normalized
}

async function persistGraphData(
  rawEntities: ExtractedEntityItem[],
  rawRelations: ExtractedRelationItem[],
  sourceMemoryId?: string,
): Promise<void> {
  const nameToId = new Map<string, string>()

  for (const raw of rawEntities) {
    try {
      const entity = await upsertEntity({
        name: raw.name,
        type: raw.type,
        description: raw.description,
        sourceMemoryId,
      })
      nameToId.set(raw.name, entity.id)
    } catch (error) {
      console.error('[task-memory-extractor] Failed to upsert entity:', raw.name, error instanceof Error ? error.message : String(error))
    }
  }

  for (const raw of rawRelations) {
    const sourceId = nameToId.get(raw.source)
    const targetId = nameToId.get(raw.target)
    if (!sourceId || !targetId) continue

    try {
      insertRelation({
        sourceEntityId: sourceId,
        targetEntityId: targetId,
        relationType: raw.relationType,
        confidence: 1.0,
        sourceMemoryId,
      })
    } catch (error) {
      console.error('[task-memory-extractor] Failed to insert relation:', raw.source, '->', raw.target, error instanceof Error ? error.message : String(error))
    }
  }
}

function writeDerivedMemories(params: {
  taskId: string
  extracted: ExtractedTaskMemories
  validAgentIds: Set<string>
}): Memory[] {
  const byCategory: Array<{ key: keyof Pick<ExtractedTaskMemories, 'facts' | 'decisions' | 'outputs'>; category: DerivedMemoryCategory }> = [
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
  const taskReportMemory = writeTaskReportMemory({
    taskId: params.taskId,
    taskObjective: params.taskObjective,
    report: params.report,
  })

  const saved: Memory[] = [taskReportMemory]

  try {
    const extracted = await extractTaskMemories(params)
    const validAgentIds = new Set(params.plan.steps.map((step) => step.assignee))
    saved.push(...writeDerivedMemories({
      taskId: params.taskId,
      extracted,
      validAgentIds,
    }))

    const normalizedEntities = normalizeEntityItems(extracted.entities)
    if (normalizedEntities.length > 0) {
      const validEntityNames = new Set(normalizedEntities.map((e) => e.name))
      const normalizedRelations = normalizeRelationItems(extracted.relations, validEntityNames)
      void persistGraphData(normalizedEntities, normalizedRelations, taskReportMemory.id)
    }
  } catch {
    // Fall back to the coarse task_report memory when extraction fails.
  }

  return saved
}
