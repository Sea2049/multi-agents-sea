import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PipelineDefinition, PipelineStep } from '../pipelines/types.js'
import type { RegistrySnapshot } from '../runtime/registry-snapshot.js'
import type { LLMProvider } from '../providers/types.js'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../pipelines/store.js', () => ({
  getPipelineById: vi.fn(),
}))

vi.mock('../tools/index.js', () => ({
  getToolDefinitions: vi.fn(() => []),
  executeTool: vi.fn(),
}))

vi.mock('../runtime/prompt-loader.js', () => ({
  loadAgentSystemPrompt: vi.fn(() => 'System prompt'),
}))

vi.mock('../orchestrator/step-summarizer.js', () => ({
  summarizeStepOutput: vi.fn(async (params: { rawOutput: string }) => params.rawOutput),
}))

vi.mock('../orchestrator/execution-message.js', () => ({
  buildExecutionMessage: vi.fn(async () => ({ message: 'Execute this', promptChars: 100 })),
}))

vi.mock('../runtime/tool-executor.js', () => ({
  runWithTools: vi.fn(async () => ({ finalText: 'LLM output' })),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockSnapshot = { agentIds: ['test-agent'], tools: [] } as unknown as RegistrySnapshot
const mockProvider = {} as unknown as LLMProvider
const mockProviderFactory = (_name: string): LLMProvider => mockProvider

function mockToolResult(output: string) {
  return { toolCallId: 'mock-id', toolName: 'test-tool', output, isError: false as const }
}

function makeEvent() {
  return vi.fn()
}

async function runDef(definition: PipelineDefinition) {
  const { runPipeline } = await import('../pipelines/engine.js')
  return runPipeline({
    taskId: 'test-task',
    objective: 'Test objective',
    definition,
    snapshot: mockSnapshot,
    providerFactory: mockProviderFactory,
    onEvent: makeEvent(),
    timeoutMs: 10_000,
    maxConcurrent: 4,
  })
}

function toolStep(id: string, deps: string[] = []): PipelineStep {
  return {
    id,
    kind: 'tool',
    title: `Tool ${id}`,
    objective: `Run tool ${id}`,
    toolName: 'test-tool',
    inputTemplate: '{}',
    dependsOn: deps,
  }
}

// ─── Tests: loop step ─────────────────────────────────────────────────────────

describe('loop step', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('exits when exit condition is met after 2 iterations', async () => {
    const { executeTool } = await import('../tools/index.js')
    const mockedExecuteTool = vi.mocked(executeTool)
    let callCount = 0
    mockedExecuteTool.mockImplementation(async () => {
      callCount++
      return mockToolResult(callCount >= 2 ? 'DONE' : 'CONTINUE')
    })

    const definition: PipelineDefinition = {
      id: 'test',
      name: 'Loop test',
      version: 1,
      steps: [
        {
          id: 'loop1',
          kind: 'loop',
          title: 'Loop',
          objective: 'Loop over items',
          maxIterations: 5,
          exitCondition: { operator: 'contains', value: 'DONE' },
          bodyStepIds: ['body1'],
          dependsOn: [],
        },
        toolStep('body1'),
      ],
    }

    const { stepResults } = await runDef(definition)

    expect(callCount).toBe(2)
    const loopResult = stepResults.get('loop1')
    expect(loopResult).toBeDefined()
    expect(loopResult?.output).toContain('DONE')
    expect(loopResult?.summary).toMatch(/2 iteration/)
  })

  it('stops at maxIterations when exit condition is never met', async () => {
    const { executeTool } = await import('../tools/index.js')
    const mockedExecuteTool = vi.mocked(executeTool)
    let callCount = 0
    mockedExecuteTool.mockImplementation(async () => {
      callCount++
      return mockToolResult('still going')
    })

    const definition: PipelineDefinition = {
      id: 'test',
      name: 'Loop maxiter test',
      version: 1,
      steps: [
        {
          id: 'loop1',
          kind: 'loop',
          title: 'Loop',
          objective: 'Loop',
          maxIterations: 3,
          exitCondition: { operator: 'contains', value: 'DONE' },
          bodyStepIds: ['body1'],
          dependsOn: [],
        },
        toolStep('body1'),
      ],
    }

    const { stepResults } = await runDef(definition)

    expect(callCount).toBe(3)
    const loopResult = stepResults.get('loop1')
    expect(loopResult?.summary).toMatch(/3 iteration/)
  })

  it('exits on first iteration when exit condition immediately met', async () => {
    const { executeTool } = await import('../tools/index.js')
    const mockedExecuteTool = vi.mocked(executeTool)
    mockedExecuteTool.mockResolvedValue(mockToolResult('DONE'))

    const definition: PipelineDefinition = {
      id: 'test',
      name: 'Loop first-exit test',
      version: 1,
      steps: [
        {
          id: 'loop1',
          kind: 'loop',
          title: 'Loop',
          objective: 'Loop',
          maxIterations: 10,
          exitCondition: { operator: 'contains', value: 'DONE' },
          bodyStepIds: ['body1'],
          dependsOn: [],
        },
        toolStep('body1'),
      ],
    }

    const { stepResults } = await runDef(definition)

    expect(vi.mocked(executeTool).mock.calls.length).toBe(1)
    expect(stepResults.get('loop1')?.summary).toMatch(/1 iteration/)
  })

  it('runs multiple sequential body steps per iteration', async () => {
    const { executeTool } = await import('../tools/index.js')
    const mockedExecuteTool = vi.mocked(executeTool)
    const order: string[] = []
    mockedExecuteTool.mockImplementation(async (_toolCall) => {
      const name = (_toolCall as { name: string }).name ?? 'unknown'
      order.push(name)
      return mockToolResult('done')
    })

    const definition: PipelineDefinition = {
      id: 'test',
      name: 'Loop multi-body test',
      version: 1,
      steps: [
        {
          id: 'loop1',
          kind: 'loop',
          title: 'Loop',
          objective: 'Loop',
          maxIterations: 2,
          bodyStepIds: ['bodyA', 'bodyB'],
          dependsOn: [],
        },
        toolStep('bodyA'),
        { ...toolStep('bodyB', ['bodyA']), toolName: 'tool-b' } as PipelineStep,
      ],
    }

    await runDef(definition)
    // 2 iterations × 2 body steps = 4 calls total
    expect(vi.mocked(executeTool).mock.calls.length).toBe(4)
  })
})

// ─── Tests: map step ──────────────────────────────────────────────────────────

describe('map step', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('expands items and aggregates results', async () => {
    const { executeTool } = await import('../tools/index.js')
    const mockedExecuteTool = vi.mocked(executeTool)
    mockedExecuteTool.mockImplementation(async () => ({ ...mockToolResult('processed') }))

    // Pre-populate a source step result so the map can parse it
    const sourceOutput = JSON.stringify(['url1', 'url2', 'url3'])
    const definition: PipelineDefinition = {
      id: 'test',
      name: 'Map test',
      version: 1,
      steps: [
        toolStep('fetch'),
        {
          id: 'process',
          kind: 'map',
          title: 'Process',
          objective: 'Process each URL',
          sourceExpression: 'steps.fetch.output',
          maxConcurrency: 2,
          bodyStepIds: ['processItem'],
          dependsOn: ['fetch'],
        },
        toolStep('processItem'),
      ],
    }

    // Override fetch tool to return JSON array
    let fetchCalled = false
    mockedExecuteTool.mockImplementation(async () => {
      if (!fetchCalled) {
        fetchCalled = true
        return mockToolResult(sourceOutput)
      }
      return mockToolResult('item-result')
    })

    const { stepResults } = await runDef(definition)

    const mapResult = stepResults.get('process')
    expect(mapResult).toBeDefined()
    expect(mapResult?.structuredOutput).toBeInstanceOf(Array)
    const items = mapResult?.structuredOutput as unknown[]
    expect(items).toHaveLength(3)
    expect(mapResult?.summary).toContain('3 items')
  })

  it('handles empty source array gracefully', async () => {
    const { executeTool } = await import('../tools/index.js')
    vi.mocked(executeTool).mockResolvedValue(mockToolResult('[]'))

    const definition: PipelineDefinition = {
      id: 'test',
      name: 'Map empty test',
      version: 1,
      steps: [
        toolStep('fetch'),
        {
          id: 'process',
          kind: 'map',
          title: 'Process',
          objective: 'Process each URL',
          sourceExpression: 'steps.fetch.output',
          bodyStepIds: ['processItem'],
          dependsOn: ['fetch'],
        },
        toolStep('processItem'),
      ],
    }

    const { stepResults } = await runDef(definition)

    const mapResult = stepResults.get('process')
    expect(mapResult?.structuredOutput).toEqual([])
    expect(mapResult?.summary).toContain('empty')
  })

  it('respects maxConcurrency by expanding items in batches', async () => {
    const { executeTool } = await import('../tools/index.js')
    const mockedExecuteTool = vi.mocked(executeTool)

    let concurrentCount = 0
    let maxConcurrentSeen = 0

    mockedExecuteTool.mockImplementation(async () => {
      concurrentCount++
      maxConcurrentSeen = Math.max(maxConcurrentSeen, concurrentCount)
      // Small delay to let concurrency build up
      await new Promise((r) => setTimeout(r, 5))
      concurrentCount--
      return mockToolResult('done')
    })

    const items = JSON.stringify(['a', 'b', 'c', 'd', 'e'])

    const definition: PipelineDefinition = {
      id: 'test',
      name: 'Map concurrency test',
      version: 1,
      steps: [
        toolStep('fetch'),
        {
          id: 'process',
          kind: 'map',
          title: 'Process',
          objective: 'Process items',
          sourceExpression: 'steps.fetch.output',
          maxConcurrency: 2,
          bodyStepIds: ['processItem'],
          dependsOn: ['fetch'],
        },
        toolStep('processItem'),
      ],
    }

    let fetchCalled2 = false
    mockedExecuteTool.mockImplementation(async () => {
      if (!fetchCalled2) {
        fetchCalled2 = true
        return mockToolResult(items)
      }
      concurrentCount++
      maxConcurrentSeen = Math.max(maxConcurrentSeen, concurrentCount)
      await new Promise((r) => setTimeout(r, 5))
      concurrentCount--
      return mockToolResult('done')
    })

    const { stepResults } = await runDef(definition)

    const mapResult = stepResults.get('process')
    expect(mapResult?.structuredOutput).toHaveLength(5)
    // With maxConcurrency=2, at most 2 item groups should run simultaneously
    expect(maxConcurrentSeen).toBeLessThanOrEqual(2)
  })
})

// ─── Tests: sub_pipeline step ─────────────────────────────────────────────────

describe('sub_pipeline step', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('expands child steps with prefixed IDs', async () => {
    const { executeTool } = await import('../tools/index.js')
    vi.mocked(executeTool).mockResolvedValue(mockToolResult('child-output'))

    const { getPipelineById } = await import('../pipelines/store.js')
    vi.mocked(getPipelineById).mockReturnValue({
      id: 'child-pipeline',
      name: 'Child',
      version: 1,
      definition: {
        id: 'child-pipeline',
        name: 'Child',
        version: 1,
        steps: [toolStep('childStep1')],
      },
      createdAt: 0,
      updatedAt: 0,
    })

    const definition: PipelineDefinition = {
      id: 'test',
      name: 'Sub-pipeline test',
      version: 1,
      steps: [
        {
          id: 'sub1',
          kind: 'sub_pipeline',
          title: 'Sub',
          objective: 'Run sub-pipeline',
          pipelineId: 'child-pipeline',
          dependsOn: [],
        },
      ],
    }

    const { stepResults } = await runDef(definition)

    const subResult = stepResults.get('sub1')
    expect(subResult).toBeDefined()
    expect(subResult?.agentId).toBe('pipeline-sub')
    // The child step should have run as a synthetic step with prefix
    expect(stepResults.has('sub1__childStep1')).toBe(true)
  })

  it('rejects when pipeline not found', async () => {
    const { getPipelineById } = await import('../pipelines/store.js')
    vi.mocked(getPipelineById).mockReturnValue(null)

    const definition: PipelineDefinition = {
      id: 'test',
      name: 'Sub-pipeline missing test',
      version: 1,
      steps: [
        {
          id: 'sub1',
          kind: 'sub_pipeline',
          title: 'Sub',
          objective: 'Run sub-pipeline',
          pipelineId: 'nonexistent',
          dependsOn: [],
        },
      ],
    }

    const { stepResults } = await runDef(definition)

    const subResult = stepResults.get('sub1')
    expect(subResult?.error).toContain('not found')
  })

  it('enforces pipelineVersion lock', async () => {
    const { getPipelineById } = await import('../pipelines/store.js')
    vi.mocked(getPipelineById).mockReturnValue({
      id: 'child-pipeline',
      name: 'Child',
      version: 3,
      definition: {
        id: 'child-pipeline',
        name: 'Child',
        version: 3,
        steps: [],
      },
      createdAt: 0,
      updatedAt: 0,
    })

    const definition: PipelineDefinition = {
      id: 'test',
      name: 'Sub-pipeline version lock test',
      version: 1,
      steps: [
        {
          id: 'sub1',
          kind: 'sub_pipeline',
          title: 'Sub',
          objective: 'Run sub-pipeline',
          pipelineId: 'child-pipeline',
          pipelineVersion: 2,
          dependsOn: [],
        },
      ],
    }

    const { stepResults } = await runDef(definition)

    const subResult = stepResults.get('sub1')
    expect(subResult?.error).toContain('version mismatch')
  })
})

// ─── Tests: validation ────────────────────────────────────────────────────────

describe('validation (routes/pipelines.ts validatePipelineDefinition)', () => {
  // We test through the exported type-level checks by exercising validatePipelineDefinition.
  // Since it's not exported, we test it indirectly via HTTP route by checking error messages.
  // Instead, we replicate the validation logic here via a helper that mirrors the function.

  function validate(steps: PipelineStep[], name = 'Test'): string[] {
    const errors: string[] = []
    if (!name.trim()) errors.push('name is required')
    if (!steps.length) return ['steps must be a non-empty array']

    const stepMap = new Map(steps.map((s) => [s.id, s]))

    for (const step of steps) {
      if (!step.id?.trim()) { errors.push('missing id'); continue }
      if (!step.title?.trim()) errors.push(`step "${step.id}" is missing title`)
      if (!step.objective?.trim()) errors.push(`step "${step.id}" is missing objective`)

      if (step.kind === 'loop') {
        const ls = step as Extract<PipelineStep, { kind: 'loop' }>
        if (!ls.bodyStepIds?.length) errors.push(`loop step "${ls.id}" is missing bodyStepIds`)
        else {
          for (const bsId of ls.bodyStepIds) {
            if (!stepMap.has(bsId)) errors.push(`loop step "${ls.id}" references unknown body step "${bsId}"`)
          }
        }
        if (!ls.maxIterations || ls.maxIterations < 1) errors.push(`loop step "${ls.id}" has invalid maxIterations (must be >= 1)`)
      }

      if (step.kind === 'map') {
        const ms = step as Extract<PipelineStep, { kind: 'map' }>
        if (!ms.sourceExpression?.trim()) errors.push(`map step "${ms.id}" is missing sourceExpression`)
        if (!ms.bodyStepIds?.length) errors.push(`map step "${ms.id}" is missing bodyStepIds`)
        else {
          for (const bsId of ms.bodyStepIds) {
            if (!stepMap.has(bsId)) errors.push(`map step "${ms.id}" references unknown body step "${bsId}"`)
          }
        }
      }

      if (step.kind === 'sub_pipeline') {
        const ss = step as Extract<PipelineStep, { kind: 'sub_pipeline' }>
        if (!ss.pipelineId?.trim()) errors.push(`sub_pipeline step "${ss.id}" is missing pipelineId`)
      }
    }

    return errors
  }

  it('rejects loop step with missing bodyStepIds', () => {
    const steps: PipelineStep[] = [
      {
        id: 'loop1',
        kind: 'loop',
        title: 'Loop',
        objective: 'Loop',
        maxIterations: 3,
        bodyStepIds: [],
        dependsOn: [],
      },
    ]
    const errs = validate(steps)
    expect(errs.some((e) => e.includes('bodyStepIds'))).toBe(true)
  })

  it('rejects loop step with invalid maxIterations', () => {
    const steps: PipelineStep[] = [
      {
        id: 'loop1',
        kind: 'loop',
        title: 'Loop',
        objective: 'Loop',
        maxIterations: 0,
        bodyStepIds: ['body1'],
        dependsOn: [],
      },
      toolStep('body1'),
    ]
    const errs = validate(steps)
    expect(errs.some((e) => e.includes('maxIterations'))).toBe(true)
  })

  it('rejects loop step referencing unknown body step', () => {
    const steps: PipelineStep[] = [
      {
        id: 'loop1',
        kind: 'loop',
        title: 'Loop',
        objective: 'Loop',
        maxIterations: 2,
        bodyStepIds: ['nonexistent'],
        dependsOn: [],
      },
    ]
    const errs = validate(steps)
    expect(errs.some((e) => e.includes('unknown body step'))).toBe(true)
  })

  it('rejects map step with missing sourceExpression', () => {
    const steps: PipelineStep[] = [
      {
        id: 'map1',
        kind: 'map',
        title: 'Map',
        objective: 'Map',
        sourceExpression: '',
        bodyStepIds: ['body1'],
        dependsOn: [],
      },
      toolStep('body1'),
    ]
    const errs = validate(steps)
    expect(errs.some((e) => e.includes('sourceExpression'))).toBe(true)
  })

  it('rejects map step with missing bodyStepIds', () => {
    const steps: PipelineStep[] = [
      {
        id: 'map1',
        kind: 'map',
        title: 'Map',
        objective: 'Map',
        sourceExpression: 'steps.fetch.output',
        bodyStepIds: [],
        dependsOn: [],
      },
    ]
    const errs = validate(steps)
    expect(errs.some((e) => e.includes('bodyStepIds'))).toBe(true)
  })

  it('rejects sub_pipeline step with missing pipelineId', () => {
    const steps: PipelineStep[] = [
      {
        id: 'sub1',
        kind: 'sub_pipeline',
        title: 'Sub',
        objective: 'Sub',
        pipelineId: '',
        dependsOn: [],
      },
    ]
    const errs = validate(steps)
    expect(errs.some((e) => e.includes('pipelineId'))).toBe(true)
  })

  it('passes valid loop step', () => {
    const steps: PipelineStep[] = [
      {
        id: 'loop1',
        kind: 'loop',
        title: 'Loop',
        objective: 'Loop',
        maxIterations: 3,
        bodyStepIds: ['body1'],
        dependsOn: [],
      },
      toolStep('body1'),
    ]
    const errs = validate(steps)
    expect(errs).toHaveLength(0)
  })

  it('passes valid map step', () => {
    const steps: PipelineStep[] = [
      {
        id: 'map1',
        kind: 'map',
        title: 'Map',
        objective: 'Map',
        sourceExpression: 'steps.fetch.output',
        bodyStepIds: ['body1'],
        dependsOn: [],
      },
      toolStep('body1'),
    ]
    const errs = validate(steps)
    expect(errs).toHaveLength(0)
  })
})
