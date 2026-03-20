import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { aggregateResults } from '../orchestrator/aggregator.js'
import { executePlan } from '../orchestrator/scheduler.js'
import type { TaskExecutionEvent, TaskPlan } from '../orchestrator/types.js'
import { retrieveRelevantMemories } from '../memory/retriever.js'
import { flushMemoryIndexingQueue, saveMemory } from '../memory/store.js'
import { MiniMaxProvider, MINIMAX_DEFAULT_MODEL_ID } from '../providers/minimax.js'
import { closeDb, getDbCapabilities, initDb } from '../storage/db.js'
import { checkDockerAvailable } from '../tools/docker-check.js'
import { setWorkspaceRoot } from '../tools/file-read.js'

const API_KEY = process.env['PROVIDER_MINIMAX_KEY']
const SKIP = !API_KEY || API_KEY.length < 10
const MODEL = MINIMAX_DEFAULT_MODEL_ID
const WORKSPACE_ROOT = 'e:\\trae\\multi-agents-sea\\server'

describe.skipIf(SKIP)('MiniMax — Tools + Memory 真实全链路', () => {
  beforeAll(() => {
    closeDb()
    initDb(':memory:')
    setWorkspaceRoot(WORKSPACE_ROOT)
  })

  afterAll(() => {
    closeDb()
  })

  it('固定计划真实触发 memory retrieval、file_read、web_search、code_exec', async () => {
    const docker = await checkDockerAvailable()
    expect(docker.available, docker.message ?? 'Docker should be available').toBe(true)

    const provider = new MiniMaxProvider(API_KEY!)
    console.log('Provider capabilities:', {
      supportsTools: provider.supportsTools,
      hasChatWithTools: typeof provider.chatWithTools === 'function',
    })
    const sqliteVec = getDbCapabilities().sqliteVec
    expect(sqliteVec.available, sqliteVec.error ?? 'sqlite-vec should be available').toBe(true)

    const memoryToken = `MEMORY_HIT_EXACT_${Date.now()}`
    saveMemory({
      content: `Deployment anchor memory: if you retrieved this memory, repeat token ${memoryToken} verbatim. Do not translate it.`,
      source: 'manual',
      category: 'deployment-notes',
    })
    await flushMemoryIndexingQueue()

    const retrieval = await retrieveRelevantMemories({
      query: [
        'deployment anchor memory',
        'Repeat any MEMORY_HIT token from prior knowledge verbatim.',
      ].join('\n'),
      limit: 4,
      maxChars: 1200,
    })
    console.log('\n=== Retrieval Context Preview ===')
    console.log(retrieval.injectedContext)
    console.log('=== End Retrieval Context Preview ===\n')
    expect(retrieval.injectedContext).toContain(memoryToken)

    const plan: TaskPlan = {
      taskId: 'e2e-tools-memory-001',
      summary: 'Use prior memory and all available tools to assemble a validation report.',
      steps: [
        {
          id: 'step-tools-memory',
          title: 'Use all tools and prior memory',
          assignee: 'toolsmith',
          dependsOn: [],
          objective: [
            '你必须严格遵守以下要求，并且每个工具至少真实调用一次；如果未完成全部工具调用，请不要输出最终答案。',
            '1. 使用 file_read 读取 package.json，确认当前服务端一个与向量或 embedding 相关的依赖名。',
            '2. 使用 web_search 搜索 sqlite-vec，并给出一句很短的中文说明。',
            "3. 使用 code_exec 运行 javascript 代码：console.log(['mini','max','tools'].join('-'))。",
            '4. 结合之前的 deployment anchor memory，如果你在历史记忆里看到了以 MEMORY_HIT_ 开头的令牌，请原样逐字输出该令牌，不要改写或翻译。',
            '最终输出一个中文 Markdown 报告，必须包含四个小节：Memory、File、Web、Code。',
          ].join('\n'),
          expectedOutput: 'A markdown report proving all tools and memory retrieval were used.',
        },
      ],
    }

    const events: TaskExecutionEvent[] = []
    const startedAt = Date.now()
    const stepResults = await executePlan({
      plan,
      teamMembers: [{ agentId: 'toolsmith', provider: 'minimax', model: MODEL }],
      providerFactory: () => provider,
      onEvent: (event) => {
        events.push(event)
        if (event.type === 'tool_call_started') {
          console.log(`[tool:start] ${event.toolName}`)
        }
        if (event.type === 'tool_call_completed') {
          console.log(`[tool:done] ${event.toolName} error=${event.toolIsError ? 'yes' : 'no'}`)
        }
      },
      timeoutMs: 300_000,
    })

    const result = stepResults.get('step-tools-memory')
    expect(result).toBeDefined()
    expect(result?.error).toBeUndefined()
    expect(result?.output.length ?? 0).toBeGreaterThan(50)

    console.log('\n=== Step Output Preview ===')
    console.log(result?.output.slice(0, 1200))
    console.log('=== End Step Output Preview ===\n')
    console.log(`Event count: ${events.length}`)

    const toolNames = new Set(
      events
        .filter((event) => event.type === 'tool_call_started' || event.type === 'tool_call_completed')
        .map((event) => event.toolName)
        .filter((value): value is string => Boolean(value)),
    )

    console.log('Triggered tools:', [...toolNames].join(', '))
    expect(toolNames).toContain('file_read')
    expect(toolNames).toContain('web_search')
    expect(toolNames).toContain('code_exec')

    expect(result?.output ?? '').toContain(memoryToken)
    expect((result?.output ?? '').toLowerCase()).toContain('mini-max-tools')

    const report = await aggregateResults({
      taskId: plan.taskId,
      objective: 'Validate the full tool and memory chain in one real MiniMax task.',
      plan,
      stepResults,
      provider,
      model: MODEL,
    })

    console.log('\n=== Final Aggregated Report ===')
    console.log(report)
    console.log('=== End Final Aggregated Report ===\n')
    console.log(`Total elapsed: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)

    expect(report).toContain(memoryToken)
    expect(report.toLowerCase()).toMatch(/sqlite-vec|fastembed/)
    expect(report.toLowerCase()).toContain('mini-max-tools')
  }, 600_000)
})
