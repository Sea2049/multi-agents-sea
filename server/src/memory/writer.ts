import { saveMemory } from './store.js'
import type { Memory } from './store.js'

export interface WriteMemoryOptions {
  content: string
  source: Memory['source']
  taskId?: string
  agentId?: string
  category?: string
  isPinned?: boolean
  pinSource?: 'auto' | 'manual'
  pinReason?: string
}

/**
 * Write a high-value memory entry.
 * Only called for final task reports and manually saved memories.
 * Does NOT auto-save every agent response to avoid polluting the memory store.
 */
export function writeMemory(options: WriteMemoryOptions): Memory {
  return saveMemory({
    content: options.content.slice(0, 4000),
    source: options.source,
    taskId: options.taskId,
    agentId: options.agentId,
    category: options.category ?? 'general',
    isPinned: options.isPinned ?? false,
    pinSource: options.pinSource,
    pinReason: options.pinReason,
  })
}

/**
 * Write a final task report as a memory.
 * Called when a task completes successfully.
 */
export function writeTaskReportMemory(params: {
  taskId: string
  taskObjective: string
  report: string
}): Memory {
  const content = `Task: ${params.taskObjective}\n\nReport summary:\n${params.report.slice(0, 2000)}`
  return writeMemory({
    content,
    source: 'task_report',
    taskId: params.taskId,
    category: 'task_report',
  })
}
