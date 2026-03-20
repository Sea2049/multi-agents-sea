import type { LLMProvider } from '../providers/types.js'
import type { RegistrySnapshot } from '../runtime/registry-snapshot.js'
import type { ContextCompressionMode, TaskPlan, TaskStep, StepResult, TaskExecutionEvent } from './types.js'
import { loadAgentSystemPrompt } from '../runtime/prompt-loader.js'
import { runWithTools } from '../runtime/tool-executor.js'
import { getToolDefinitions } from '../tools/index.js'
import { summarizeStepOutput } from './step-summarizer.js'
import { buildExecutionMessage, DEFAULT_CONTEXT_COMPRESSION_MODE } from './execution-message.js'

export interface SchedulerTeamMember {
  agentId: string
  provider: string
  model: string
}

export interface SchedulerParams {
  plan: TaskPlan
  teamMembers: SchedulerTeamMember[]
  providerFactory: (provider: string) => LLMProvider
  snapshot?: RegistrySnapshot
  onEvent: (event: TaskExecutionEvent) => void
  timeoutMs?: number
  maxConcurrent?: number
}

async function executeStep(
  step: TaskStep,
  teamMember: SchedulerTeamMember,
  completedResults: Map<string, StepResult>,
  providerFactory: (provider: string) => LLMProvider,
  snapshot: RegistrySnapshot | undefined,
  timeoutMs: number,
  taskId: string,
  onEvent: (event: TaskExecutionEvent) => void,
): Promise<StepResult> {
  const startedAt = Date.now()
  const provider = providerFactory(teamMember.provider)

  let systemPrompt: string
  try {
    systemPrompt = loadAgentSystemPrompt(step.assignee, snapshot)
  } catch {
    systemPrompt = `You are ${step.assignee}. Complete the given task thoroughly and clearly.`
  }

  const { message, promptChars } = await buildExecutionMessage(
    step,
    completedResults,
    DEFAULT_CONTEXT_COMPRESSION_MODE,
  )
  const tools = getToolDefinitions(snapshot)

  const chatPromise = (async () => {
    const result = await runWithTools({
      provider,
      model: teamMember.model,
      systemPrompt,
      initialMessages: [{ role: 'user', content: message }],
      tools,
      snapshot,
      onToolCallStarted: (toolCall) => {
        onEvent({
          type: 'tool_call_started',
          taskId,
          stepId: step.id,
          agentId: step.assignee,
          timestamp: Date.now(),
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          toolInput: toolCall.input,
        })
      },
      onToolCallCompleted: (toolCall, toolOutput, isError) => {
        onEvent({
          type: 'tool_call_completed',
          taskId,
          stepId: step.id,
          agentId: step.assignee,
          timestamp: Date.now(),
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          toolInput: toolCall.input,
          toolOutput,
          toolIsError: isError,
        })
      },
    })
    return result.finalText
  })()

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Step "${step.id}" timed out after ${timeoutMs}ms`)), timeoutMs),
  )

  const output = await Promise.race([chatPromise, timeoutPromise])

  // 生成摘要（失败不影响 step 成功）
  let summary: string | undefined
  try {
    summary = await summarizeStepOutput({
      provider,
      model: teamMember.model,
      stepTitle: step.title,
      rawOutput: output,
    })
    // 如果 summary 与 output 相同（短输出复用），则不存储（节省空间）
    if (summary === output) summary = undefined
  } catch {
    summary = undefined
  }

  return {
    stepId: step.id,
    agentId: step.assignee,
    output,
    summary,
    promptChars,
    startedAt,
    completedAt: Date.now(),
  }
}

export async function executePlan(params: SchedulerParams): Promise<Map<string, StepResult>> {
  const {
    plan,
    teamMembers,
    providerFactory,
    snapshot,
    onEvent,
    timeoutMs = 120_000,
    maxConcurrent = 2,
  } = params

  const teamMap = new Map<string, SchedulerTeamMember>()
  for (const m of teamMembers) {
    teamMap.set(m.agentId, m)
  }

  const pendingSteps = new Set<string>(plan.steps.map((s) => s.id))
  const runningSteps = new Set<string>()
  const completedSteps = new Set<string>()
  const failedSteps = new Set<string>()
  const completedResults = new Map<string, StepResult>()
  const stepMap = new Map<string, TaskStep>(plan.steps.map((s) => [s.id, s]))

  let hasFailure = false

  onEvent({ type: 'task_started', taskId: plan.taskId, timestamp: Date.now() })

  return new Promise((resolve) => {
    // Guard flag: ensures terminal events (task_completed / task_failed) and
    // resolve() are only emitted once, no matter how many times checkCompletion
    // is called due to concurrent step callbacks.
    let terminated = false

    function getReadySteps(): TaskStep[] {
      if (runningSteps.size >= maxConcurrent) return []
      const ready: TaskStep[] = []
      const skipped: string[] = []

      for (const stepId of pendingSteps) {
        const step = stepMap.get(stepId)!
        const depsAllDone = step.dependsOn.every((dep) => completedSteps.has(dep))
        // 如果依赖中有 failed 的，标记为跳过（收集后统一处理，避免在迭代中修改 Set）
        const depsHasFailed = step.dependsOn.some((dep) => failedSteps.has(dep))
        if (depsHasFailed) {
          skipped.push(stepId)
          continue
        }
        if (depsAllDone) {
          ready.push(step)
          if (ready.length + runningSteps.size >= maxConcurrent) break
        }
      }

      // 处理因依赖失败而需跳过的步骤：统一在迭代结束后修改集合
      for (const stepId of skipped) {
        const step = stepMap.get(stepId)!
        pendingSteps.delete(stepId)
        failedSteps.add(stepId)
        hasFailure = true
        onEvent({
          type: 'step_failed',
          taskId: plan.taskId,
          stepId,
          agentId: step.assignee,
          error: `Skipped because dependency failed`,
          timestamp: Date.now(),
        })
      }

      return ready
    }

    function checkCompletion() {
      if (terminated) return
      if (pendingSteps.size === 0 && runningSteps.size === 0) {
        terminated = true
        const eventType = hasFailure ? 'task_failed' : 'task_completed'
        onEvent({ type: eventType, taskId: plan.taskId, timestamp: Date.now() })
        resolve(completedResults)
      }
    }

    function scheduleNext() {
      const ready = getReadySteps()

      if (ready.length === 0) {
        if (pendingSteps.size > 0 && runningSteps.size === 0) {
          for (const stepId of [...pendingSteps]) {
            pendingSteps.delete(stepId)
            failedSteps.add(stepId)
            hasFailure = true
            const step = stepMap.get(stepId)
            if (!step) {
              continue
            }
            onEvent({
              type: 'step_failed',
              taskId: plan.taskId,
              stepId,
              agentId: step.assignee,
              error: 'Task plan is deadlocked because one or more dependencies can never be satisfied',
              timestamp: Date.now(),
            })
          }
        }
        // No new steps to launch; check if everything is done
        checkCompletion()
        return
      }

      for (const step of ready) {
        pendingSteps.delete(step.id)
        runningSteps.add(step.id)

        const teamMember = teamMap.get(step.assignee)
        if (!teamMember) {
          // 找不到 team member 直接 fail，继续调度剩余步骤
          runningSteps.delete(step.id)
          failedSteps.add(step.id)
          hasFailure = true
          onEvent({
            type: 'step_failed',
            taskId: plan.taskId,
            stepId: step.id,
            agentId: step.assignee,
            error: `No team member found for agentId: ${step.assignee}`,
            timestamp: Date.now(),
          })
          // 继续处理本批 ready 中的下一个 step，不提前 return
          continue
        }

        onEvent({
          type: 'step_started',
          taskId: plan.taskId,
          stepId: step.id,
          agentId: step.assignee,
          timestamp: Date.now(),
        })

        executeStep(step, teamMember, completedResults, providerFactory, snapshot, timeoutMs, plan.taskId, onEvent)
          .then((result) => {
            runningSteps.delete(step.id)
            completedSteps.add(step.id)
            completedResults.set(step.id, result)
            onEvent({
              type: 'step_completed',
              taskId: plan.taskId,
              stepId: step.id,
              agentId: step.assignee,
              output: result.output,
              timestamp: Date.now(),
            })
            scheduleNext()
          })
          .catch((err: unknown) => {
            runningSteps.delete(step.id)
            failedSteps.add(step.id)
            hasFailure = true
            const errorMsg = err instanceof Error ? err.message : String(err)
            completedResults.set(step.id, {
              stepId: step.id,
              agentId: step.assignee,
              output: '',
              startedAt: Date.now(),
              completedAt: Date.now(),
              error: errorMsg,
            })
            onEvent({
              type: 'step_failed',
              taskId: plan.taskId,
              stepId: step.id,
              agentId: step.assignee,
              error: errorMsg,
              timestamp: Date.now(),
            })
            scheduleNext()
          })
      }

      // After launching all ready steps, check if there's nothing left to do
      // (covers the case where all remaining steps were no-team-member failures)
      checkCompletion()
    }

    scheduleNext()
  })
}
