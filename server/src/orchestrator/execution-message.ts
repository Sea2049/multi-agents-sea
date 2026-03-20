import { retrieveRelevantMemories } from '../memory/retriever.js'
import type { ContextCompressionMode, StepResult, TaskStep } from './types.js'

export const DEFAULT_CONTEXT_COMPRESSION_MODE: ContextCompressionMode =
  process.env['TASK_CONTEXT_COMPRESSION_MODE'] === 'summary' ? 'summary' : 'full'

function buildVerbatimMemoryReminder(injectedContext: string): string {
  const exactTokens = [...new Set(injectedContext.match(/\bMEMORY_HIT_[A-Z0-9_]+\b/g) ?? [])]
  if (exactTokens.length === 0) {
    return ''
  }

  return [
    '## Exact Memory Tokens',
    'If the current step asks you to repeat or preserve any retrieved token, you must copy it verbatim exactly as shown below.',
    'Do not translate, paraphrase, normalize, or omit these values.',
    ...exactTokens.map((token) => `- ${token}`),
    '',
  ].join('\n')
}

function getDependencyContent(result: StepResult, mode: ContextCompressionMode): string {
  return mode === 'summary' ? result.summary ?? result.output : result.output
}

export function buildContextualStepMessage(
  step: TaskStep,
  completedResults: Map<string, StepResult>,
  contextCompressionMode: ContextCompressionMode = DEFAULT_CONTEXT_COMPRESSION_MODE,
): string {
  if (step.dependsOn.length === 0) {
    return step.objective
  }

  const contextParts: string[] = []
  for (const depId of step.dependsOn) {
    const depResult = completedResults.get(depId)
    if (depResult) {
      const dependencyContent = getDependencyContent(depResult, contextCompressionMode)
      const dependencyLabel =
        contextCompressionMode === 'summary' && depResult.summary ? 'summary' : 'output'
      contextParts.push(`[${depId} ${dependencyLabel}]\n${dependencyContent}`)
    }
  }

  if (contextParts.length === 0) {
    return step.objective
  }

  return `${step.objective}\n\n---\nContext from previous steps:\n${contextParts.join('\n\n')}`
}

export async function buildExecutionMessage(
  step: TaskStep,
  completedResults: Map<string, StepResult>,
  contextCompressionMode: ContextCompressionMode = DEFAULT_CONTEXT_COMPRESSION_MODE,
): Promise<{ message: string; promptChars: number }> {
  const baseMessage = buildContextualStepMessage(step, completedResults, contextCompressionMode)
  const retrieval = await retrieveRelevantMemories({
    query: [step.title, step.objective].filter(Boolean).join('\n'),
    limit: 4,
    maxChars: 1200,
  })
  const verbatimReminder = buildVerbatimMemoryReminder(retrieval.injectedContext)

  const message = retrieval.injectedContext
    ? `${retrieval.injectedContext}\n\n${verbatimReminder}## Current Step\n${baseMessage}`
    : baseMessage

  return {
    message,
    promptChars: message.length,
  }
}
