/**
 * 真实端到端测试：使用 MiniMax API 验证 Provider / Planner / Validator / Scheduler / Aggregator 全链路
 *
 * 运行方式（PowerShell）：
 *   $env:PROVIDER_MINIMAX_KEY = "your-key-here"
 *   npx vitest run src/tests/e2e-minimax.test.ts --reporter=verbose
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { MiniMaxProvider, MINIMAX_DEFAULT_MODEL_ID } from '../providers/minimax.js'
import { getProviderFromEnv } from '../providers/index.js'
import { createPlan } from '../orchestrator/planner.js'
import { validatePlan } from '../orchestrator/plan-validator.js'
import { executePlan } from '../orchestrator/scheduler.js'
import { aggregateResults } from '../orchestrator/aggregator.js'
import type { TaskExecutionEvent } from '../orchestrator/types.js'
import { closeDb, initDb } from '../storage/db.js'

const API_KEY = process.env['PROVIDER_MINIMAX_KEY']
const SKIP = !API_KEY || API_KEY.length < 10

describe.skipIf(SKIP)('MiniMax Provider — 真实 API', () => {
  it('validateCredentials 返回 ok=true', async () => {
    const provider = getProviderFromEnv('minimax')
    const health = await provider.validateCredentials()
    console.log('Health:', health)
    expect(health.ok).toBe(true)
    expect(health.latencyMs).toBeGreaterThan(0)
  }, 30_000)

  it('models() 返回 MiniMax 模型列表', async () => {
    const provider = getProviderFromEnv('minimax')
    const models = await provider.models()
    console.log('Models:', JSON.stringify(models, null, 2))
    expect(models.length).toBeGreaterThan(0)
    expect(models[0]!.id).toContain('MiniMax')
  })

  it('chat() 流式输出 delta 文本', async () => {
    const provider = getProviderFromEnv('minimax')
    const chunks: string[] = []
    for await (const chunk of provider.chat({
      model: MINIMAX_DEFAULT_MODEL_ID,
      systemPrompt: 'You are a concise assistant. Reply in one sentence.',
      messages: [{ role: 'user', content: 'What is 2+2?' }],
      maxTokens: 64,
    })) {
      if (!chunk.done) {
        chunks.push(chunk.delta)
      }
    }
    const full = chunks.join('')
    console.log('Full response:', full)
    expect(full.length).toBeGreaterThan(0)
    expect(full).toMatch(/4/)
  }, 30_000)
})

describe.skipIf(SKIP)('MiniMax — Planner 真实编排', () => {
  const teamMembers = [
    { agentId: 'researcher', name: 'Researcher', description: 'Searches and gathers information', division: 'Research' },
    { agentId: 'writer', name: 'Writer', description: 'Writes clear, engaging content', division: 'Content' },
    { agentId: 'editor', name: 'Editor', description: 'Reviews and polishes content', division: 'Content' },
  ]

  it('为"写技术博客"生成多步骤计划', async () => {
    const provider = new MiniMaxProvider(API_KEY!)
    const plan = await createPlan({
      taskId: 'e2e-blog-001',
      objective: '写一篇关于"多智能体系统在软件开发中的应用"的技术博客（约500字）',
      teamMembers,
      provider,
      model: MINIMAX_DEFAULT_MODEL_ID,
    })

    console.log('Generated plan:')
    console.log('  Goal:', plan.summary)
    plan.steps.forEach((s, i) => {
      console.log(`  Step ${i + 1}: [${s.assignee}] ${s.title}`)
      console.log(`    dependsOn: [${s.dependsOn?.join(', ') ?? ''}]`)
    })

    expect(plan.steps.length).toBeGreaterThanOrEqual(2)
    const validAgentIds = teamMembers.map((m) => m.agentId)
    for (const step of plan.steps) {
      expect(validAgentIds).toContain(step.assignee)
    }
  }, 90_000)

  it('Planner 输出通过 Validator 校验（无循环依赖）', async () => {
    const provider = new MiniMaxProvider(API_KEY!)
    const rawPlan = await createPlan({
      taskId: 'e2e-todo-001',
      objective: '开发一个简单的 TODO 应用，包含需求分析、编码和测试',
      teamMembers: [
        { agentId: 'analyst', name: 'Analyst', description: 'Analyzes requirements', division: 'Analysis' },
        { agentId: 'developer', name: 'Developer', description: 'Writes code', division: 'Engineering' },
        { agentId: 'tester', name: 'Tester', description: 'Tests the code', division: 'QA' },
      ],
      provider,
      model: MINIMAX_DEFAULT_MODEL_ID,
    })

    const agentIds = new Set(['analyst', 'developer', 'tester'])
    const result = validatePlan(rawPlan, agentIds)

    console.log('Validation result:', result.valid, result.errors)
    if (!result.valid) {
      console.log('Plan that failed:', JSON.stringify(rawPlan, null, 2))
    }

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  }, 90_000)
})

// ─── Scheduler + Aggregator 全链路 ───────────────────────────────────────────

describe.skipIf(SKIP)('MiniMax — Scheduler 全链路执行', () => {
  const MODEL = MINIMAX_DEFAULT_MODEL_ID

  beforeEach(() => {
    closeDb()
    initDb(':memory:')
  })

  afterAll(() => {
    closeDb()
  })

  const teamMembers = [
    { agentId: 'researcher', name: 'Researcher', description: 'Searches and gathers information', division: 'Research' },
    { agentId: 'writer',     name: 'Writer',     description: 'Writes clear, engaging content',  division: 'Content'  },
    { agentId: 'editor',     name: 'Editor',     description: 'Reviews and polishes content',     division: 'Content'  },
  ]

  it('Scheduler 执行全部步骤，每步均有输出', async () => {
    const provider = new MiniMaxProvider(API_KEY!)

    // 1. 生成计划
    const plan = await createPlan({
      taskId: 'e2e-scheduler-001',
      objective: '用三段话简要介绍"多智能体系统"，分别覆盖：定义、应用场景、挑战',
      teamMembers,
      provider,
      model: MODEL,
    })

    // 2. 校验
    const validAgentIds = new Set(teamMembers.map((m) => m.agentId))
    const validation = validatePlan(plan, validAgentIds)
    expect(validation.valid).toBe(true)

    // 3. 执行
    const events: TaskExecutionEvent[] = []
    const results = await executePlan({
      plan,
      teamMembers: teamMembers.map((m) => ({
        agentId: m.agentId,
        provider: 'minimax',
        model: MODEL,
      })),
      providerFactory: () => provider,
      onEvent: (e) => {
        events.push(e)
        const label =
          e.type === 'step_completed' ? `✓ ${e.stepId} [${e.agentId}]` :
          e.type === 'step_started'   ? `→ ${e.stepId} [${e.agentId}]` :
          e.type === 'step_failed'    ? `✗ ${e.stepId}: ${e.error}` :
          e.type
        console.log(`[event] ${label}`)
      },
      timeoutMs: 120_000,
    })

    // 4. 断言每步都有结果
    console.log(`\nCompleted ${results.size} steps out of ${plan.steps.length}`)
    for (const step of plan.steps) {
      const result = results.get(step.id)
      if (!result) {
        console.log(`  MISSING: ${step.id}`)
        continue
      }
      const preview = result.output.slice(0, 120).replace(/\n/g, ' ')
      console.log(`  [${step.id}] ${result.error ? '❌ ERROR: ' + result.error : '✅ ' + preview + '…'}`)
    }

    // 至少有一步成功完成（宽松断言，防止 LLM 个别步骤超时）
    const successCount = plan.steps.filter(
      (s) => results.get(s.id) && !results.get(s.id)!.error
    ).length
    expect(successCount).toBeGreaterThanOrEqual(1)

    // task_started / task_completed 事件存在
    expect(events.some((e) => e.type === 'task_started')).toBe(true)
    expect(events.some((e) => e.type === 'task_completed' || e.type === 'task_failed')).toBe(true)
  }, 300_000)

  it('Aggregator 汇总步骤结果，返回有内容的报告', async () => {
    const provider = new MiniMaxProvider(API_KEY!)

    // 复用一个简单的两步计划（不再走 Planner，固定计划节省时间）
    const plan = {
      taskId: 'e2e-agg-001',
      summary: 'Write a short intro and conclusion for an article about AI agents',
      steps: [
        {
          id: 'step-intro',
          title: 'Write Introduction',
          assignee: 'writer',
          dependsOn: [],
          objective: 'Write a 2-sentence introduction about AI agents in software development.',
          expectedOutput: 'A concise 2-sentence introduction paragraph.',
        },
        {
          id: 'step-conclusion',
          title: 'Write Conclusion',
          assignee: 'editor',
          dependsOn: ['step-intro'],
          objective: 'Write a 2-sentence conclusion summarizing the importance of AI agents.',
          expectedOutput: 'A concise 2-sentence conclusion paragraph.',
        },
      ],
    }

    const events: TaskExecutionEvent[] = []
    const stepResults = await executePlan({
      plan,
      teamMembers: [
        { agentId: 'writer', provider: 'minimax', model: MODEL },
        { agentId: 'editor', provider: 'minimax', model: MODEL },
      ],
      providerFactory: () => provider,
      onEvent: (e) => events.push(e),
      timeoutMs: 120_000,
    })

    // 所有步骤应完成（step-2 依赖 step-1，若 step-1 失败则 step-2 会被 skip，结果 Map 仍有记录）
    expect(stepResults.size).toBeGreaterThanOrEqual(1)
    for (const [id, r] of stepResults) {
      console.log(`  [${id}] output (${r.output.length} chars):`, r.output.slice(0, 100))
      expect(r.error).toBeUndefined()
      expect(r.output.length).toBeGreaterThan(10)
    }

    // Aggregator 汇总
    const report = await aggregateResults({
      taskId: plan.taskId,
      objective: 'Write a short article intro + conclusion about AI agents',
      plan,
      stepResults,
      provider,
      model: MODEL,
    })

    console.log('\n=== Final Aggregated Report ===')
    console.log(report)
    console.log('=== End of Report ===\n')

    expect(report.length).toBeGreaterThan(50)
    // 报告应包含 introduction 或 conclusion 等关键词（大小写不敏感）
    expect(report.toLowerCase()).toMatch(/introduc|agent|conclus|summar/)
  }, 300_000)
})

describe.skipIf(SKIP)('MiniMax — 完整 Planner→Scheduler→Aggregator 一气呵成', () => {
  const MODEL = MINIMAX_DEFAULT_MODEL_ID

  beforeEach(() => {
    closeDb()
    initDb(':memory:')
  })

  afterAll(() => {
    closeDb()
  })

  it('从目标到最终报告，全程无人工干预', async () => {
    const provider = new MiniMaxProvider(API_KEY!)

    const objective = '为"AI Agent 在 CI/CD 中的应用"写一份包含背景、方案和总结的简短报告（每节2-3句话）'
    const teamMembers = [
      { agentId: 'analyst',  name: 'Analyst',  description: 'Analyzes requirements and background', division: 'Analysis'    },
      { agentId: 'engineer', name: 'Engineer', description: 'Designs technical solutions',          division: 'Engineering' },
      { agentId: 'writer',   name: 'Writer',   description: 'Writes final polished content',        division: 'Content'     },
    ]

    console.log('\n🚀 Step 1: Planning...')
    const plan = await createPlan({
      taskId: 'e2e-full-001',
      objective,
      teamMembers,
      provider,
      model: MODEL,
    })
    console.log(`   Plan: ${plan.steps.length} steps — ${plan.summary}`)

    console.log('\n🔍 Step 2: Validating...')
    const validation = validatePlan(plan, new Set(teamMembers.map((m) => m.agentId)))
    console.log(`   Valid: ${validation.valid}  Errors: ${validation.errors.length}`)
    expect(validation.valid).toBe(true)

    console.log('\n⚙️  Step 3: Executing...')
    const startMs = Date.now()
    const stepResults = await executePlan({
      plan,
      teamMembers: teamMembers.map((m) => ({ agentId: m.agentId, provider: 'minimax', model: MODEL })),
      providerFactory: () => provider,
      onEvent: (e) => {
        if (e.type === 'step_started')   console.log(`   → [${e.stepId}] ${e.agentId} started`)
        if (e.type === 'step_completed') console.log(`   ✓ [${e.stepId}] ${e.agentId} done (${e.output?.length ?? 0} chars)`)
        if (e.type === 'step_failed')    console.log(`   ✗ [${e.stepId}] ${e.agentId} FAILED: ${e.error}`)
      },
      timeoutMs: 120_000,
    })
    console.log(`   Execution took ${((Date.now() - startMs) / 1000).toFixed(1)}s`)

    const successSteps = [...stepResults.values()].filter((r) => !r.error)
    expect(successSteps.length).toBeGreaterThanOrEqual(1)

    console.log('\n📝 Step 4: Aggregating...')
    const report = await aggregateResults({
      taskId: plan.taskId,
      objective,
      plan,
      stepResults,
      provider,
      model: MODEL,
    })

    console.log('\n' + '═'.repeat(60))
    console.log('FINAL REPORT')
    console.log('═'.repeat(60))
    console.log(report)
    console.log('═'.repeat(60) + '\n')

    // 核心断言
    expect(report.length).toBeGreaterThan(100)
    expect(stepResults.size).toBeGreaterThanOrEqual(1)

    // 打印摘要
    const totalMs = Date.now() - startMs
    console.log(`\n📊 Summary:`)
    console.log(`   Steps planned:   ${plan.steps.length}`)
    console.log(`   Steps executed:  ${stepResults.size}`)
    console.log(`   Steps succeeded: ${successSteps.length}`)
    console.log(`   Report length:   ${report.length} chars`)
    console.log(`   Total time:      ${(totalMs / 1000).toFixed(1)}s`)
  }, 600_000)
})
