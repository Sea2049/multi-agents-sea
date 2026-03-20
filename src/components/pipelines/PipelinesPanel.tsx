import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, Play, Plus, RefreshCw, Save, Trash2, Workflow } from 'lucide-react'
import { apiClient, type PipelineStep, type PipelineSummary, type ProviderConfig } from '../../lib/api-client'

interface PipelinesPanelProps {
  onOpenTask: (taskId: string) => void
}

const SAMPLE_PIPELINE_STEPS: PipelineStep[] = [
  {
    id: 'step-search',
    title: 'Search Context',
    kind: 'tool',
    dependsOn: [],
    objective: 'Search the web for relevant context before planning.',
    toolName: 'web_search',
    inputTemplate: '{\n  "query": "{{task.objective}}"\n}',
  },
  {
    id: 'step-analysis',
    title: 'Draft Analysis',
    kind: 'llm',
    dependsOn: ['step-search'],
    objective: 'Review the tool output and draft a concise analysis.',
    assignee: 'engineering-ai-engineer',
    expectedOutput: 'A concise analysis with recommendations.',
  },
  {
    id: 'step-gate',
    title: 'Manual Review',
    kind: 'gate',
    dependsOn: ['step-analysis'],
    objective: 'Require human approval before shipping the recommendation.',
    instructions: 'Read the draft analysis, then approve to continue or reject to stop the pipeline.',
  },
  {
    id: 'step-condition',
    title: 'Check Ship Readiness',
    kind: 'condition',
    dependsOn: ['step-analysis', 'step-gate'],
    objective: 'Only continue to the final output when the analysis explicitly mentions ship readiness.',
    sourceStepId: 'step-analysis',
    operator: 'contains',
    value: 'ship',
    onFalse: ['step-final'],
  },
  {
    id: 'step-final',
    title: 'Final Output',
    kind: 'llm',
    dependsOn: ['step-condition'],
    objective: 'Produce the final user-facing recommendation.',
    assignee: 'engineering-ai-engineer',
    expectedOutput: 'A polished final recommendation.',
  },
]

function formatStepsJson(steps: PipelineStep[]): string {
  return JSON.stringify(steps, null, 2)
}

function buildDraftSignature(params: {
  name: string
  description: string
  provider: string
  model: string
  stepsJson: string
}): string {
  return JSON.stringify({
    name: params.name.trim(),
    description: params.description.trim(),
    provider: params.provider,
    model: params.model,
    stepsJson: params.stepsJson.trim(),
  })
}

export function PipelinesPanel({ onOpenTask }: PipelinesPanelProps) {
  const [pipelines, setPipelines] = useState<PipelineSummary[]>([])
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [models, setModels] = useState<string[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null)
  const [editorName, setEditorName] = useState('Sample Pipeline')
  const [editorDescription, setEditorDescription] = useState('A minimal pipeline using tool, llm, gate, and condition nodes.')
  const [editorProvider, setEditorProvider] = useState('')
  const [editorModel, setEditorModel] = useState('')
  const [editorStepsJson, setEditorStepsJson] = useState(formatStepsJson(SAMPLE_PIPELINE_STEPS))
  const [runObjective, setRunObjective] = useState('Research the topic, draft a recommendation, and wait for approval before final output.')
  const [loading, setLoading] = useState(true)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedDraftSignature, setSavedDraftSignature] = useState(
    buildDraftSignature({
      name: 'Sample Pipeline',
      description: 'A minimal pipeline using tool, llm, gate, and condition nodes.',
      provider: '',
      model: '',
      stepsJson: formatStepsJson(SAMPLE_PIPELINE_STEPS),
    }),
  )

  const configuredProviders = useMemo(
    () => providers.filter((provider) => provider.configured),
    [providers],
  )
  const currentDraftSignature = useMemo(
    () =>
      buildDraftSignature({
        name: editorName,
        description: editorDescription,
        provider: editorProvider,
        model: editorModel,
        stepsJson: editorStepsJson,
      }),
    [editorDescription, editorModel, editorName, editorProvider, editorStepsJson],
  )
  const isDirty = currentDraftSignature !== savedDraftSignature

  const loadPipelines = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [pipelineResponse, providerList] = await Promise.all([
        apiClient.pipelines.list(),
        apiClient.getProviders(),
      ])
      setPipelines(pipelineResponse.pipelines)
      setProviders(providerList)

      const preferredProvider = providerList.find((provider) => provider.configured && provider.kind !== 'local')
        ?? providerList.find((provider) => provider.configured)
      if (preferredProvider) {
        setEditorProvider((current) => current || preferredProvider.name)
        setEditorModel((current) => current || preferredProvider.defaultModel || '')
      }

      if (pipelineResponse.pipelines.length > 0 && !selectedPipelineId) {
        setSelectedPipelineId(pipelineResponse.pipelines[0].id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pipeline 列表加载失败')
    } finally {
      setLoading(false)
    }
  }, [selectedPipelineId])

  useEffect(() => {
    void loadPipelines()
  }, [loadPipelines])

  useEffect(() => {
    if (!editorProvider) {
      setModels([])
      setEditorModel('')
      setModelsLoading(false)
      return
    }

    let cancelled = false
    const desiredModel = editorModel
    setModelsLoading(true)
    setModels([])
    setEditorModel('')
    apiClient.getModels(editorProvider)
      .then((list) => {
        if (cancelled) {
          return
        }

        const ids = list.map((model) => model.id)
        setModels(ids)
        setEditorModel(ids.includes(desiredModel) ? desiredModel : (ids[0] ?? ''))
      })
      .catch(() => {
        if (!cancelled) {
          setModels([])
          setEditorModel('')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setModelsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [editorProvider])

  useEffect(() => {
    if (!selectedPipelineId) {
      return
    }

    let cancelled = false
    setDetailsLoading(true)
    apiClient.pipelines.get(selectedPipelineId)
      .then((response) => {
        if (cancelled) {
          return
        }

        const definition = response.pipeline.definition
        setEditorName(definition.name)
        setEditorDescription(definition.description ?? '')
        setEditorProvider(definition.runtimeDefaults?.provider ?? '')
        setEditorModel(definition.runtimeDefaults?.model ?? '')
        setEditorStepsJson(formatStepsJson(definition.steps))
        setRunObjective(`Run pipeline: ${definition.name}`)
        setSavedDraftSignature(
          buildDraftSignature({
            name: definition.name,
            description: definition.description ?? '',
            provider: definition.runtimeDefaults?.provider ?? '',
            model: definition.runtimeDefaults?.model ?? '',
            stepsJson: formatStepsJson(definition.steps),
          }),
        )
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Pipeline 详情加载失败')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [selectedPipelineId])

  const parseEditorSteps = useCallback((): PipelineStep[] => {
    const parsed = JSON.parse(editorStepsJson) as unknown
    if (!Array.isArray(parsed)) {
      throw new Error('steps JSON 必须是数组')
    }
    return parsed as PipelineStep[]
  }, [editorStepsJson])

  const handleCreateNew = useCallback(() => {
    setSelectedPipelineId(null)
    setEditorName('Sample Pipeline')
    setEditorDescription('A minimal pipeline using tool, llm, gate, and condition nodes.')
    setEditorStepsJson(formatStepsJson(SAMPLE_PIPELINE_STEPS))
    setRunObjective('Research the topic, draft a recommendation, and wait for approval before final output.')
    const preferredProvider = configuredProviders.find((provider) => provider.kind !== 'local') ?? configuredProviders[0]
    setEditorProvider(preferredProvider?.name ?? '')
    setEditorModel(preferredProvider?.defaultModel ?? '')
    setSavedDraftSignature(
      buildDraftSignature({
        name: 'Sample Pipeline',
        description: 'A minimal pipeline using tool, llm, gate, and condition nodes.',
        provider: preferredProvider?.name ?? '',
        model: preferredProvider?.defaultModel ?? '',
        stepsJson: formatStepsJson(SAMPLE_PIPELINE_STEPS),
      }),
    )
    setError(null)
  }, [configuredProviders])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      const steps = parseEditorSteps()
      const payload = {
        name: editorName.trim(),
        description: editorDescription.trim(),
        runtimeDefaults: editorProvider && editorModel
          ? { provider: editorProvider, model: editorModel }
          : undefined,
        steps,
      }

      if (selectedPipelineId) {
        const response = await apiClient.pipelines.update(selectedPipelineId, payload)
        setSelectedPipelineId(response.pipeline.id)
      } else {
        const response = await apiClient.pipelines.create(payload)
        setSelectedPipelineId(response.pipeline.id)
      }

      setSavedDraftSignature(currentDraftSignature)
      await loadPipelines()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pipeline 保存失败')
    } finally {
      setSaving(false)
    }
  }, [currentDraftSignature, editorDescription, editorModel, editorName, editorProvider, loadPipelines, parseEditorSteps, selectedPipelineId])

  const handleDelete = useCallback(async () => {
    if (!selectedPipelineId) {
      return
    }

    setSaving(true)
    setError(null)
    try {
      await apiClient.pipelines.delete(selectedPipelineId)
      await loadPipelines()
      handleCreateNew()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pipeline 删除失败')
    } finally {
      setSaving(false)
    }
  }, [handleCreateNew, loadPipelines, selectedPipelineId])

  const handleRun = useCallback(async () => {
    const targetPipelineId = selectedPipelineId
    if (!targetPipelineId) {
      return
    }
    if (isDirty) {
      setError('当前 Pipeline 有未保存改动，请先保存后再运行')
      return
    }

    setRunning(true)
    setError(null)
    try {
      const response = await apiClient.pipelines.run(targetPipelineId, {
        objective: runObjective.trim() || undefined,
        provider: editorProvider || undefined,
        model: editorModel || undefined,
      })
      onOpenTask(response.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pipeline 执行失败')
    } finally {
      setRunning(false)
    }
  }, [editorModel, editorProvider, isDirty, onOpenTask, runObjective, selectedPipelineId])

  return (
    <div className="grid gap-6 px-2 py-2 xl:grid-cols-[320px_minmax(0,1fr)]">
      <section className="panel-surface-strong rounded-[28px] border border-white/[0.08] px-5 py-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="instrument-tag rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.22em]">
                Pipelines
              </span>
            </div>
            <h2 className="mt-2 text-2xl font-semibold text-white" style={{ fontFamily: 'var(--font-display)' }}>
              Pipeline Library
            </h2>
          </div>

          <button
            onClick={() => void loadPipelines()}
            className="interactive-lift inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm text-slate-300 hover:border-white/[0.12] hover:bg-white/[0.05] hover:text-white"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            刷新
          </button>
        </div>

        <button
          onClick={handleCreateNew}
          className="interactive-lift mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full border border-fuchsia-400/18 bg-fuchsia-400/[0.08] px-4 py-2.5 text-sm text-fuchsia-100 hover:bg-fuchsia-400/[0.12]"
        >
          <Plus size={14} />
          新建 Pipeline
        </button>

        <div className="mt-5 space-y-3">
          {loading ? (
            <div className="rounded-[18px] border border-white/[0.08] bg-white/[0.03] px-4 py-4 text-sm text-slate-400">
              正在加载 pipelines...
            </div>
          ) : pipelines.length === 0 ? (
            <div className="rounded-[18px] border border-white/[0.08] bg-white/[0.03] px-4 py-4 text-sm text-slate-400">
              还没有已保存的 pipeline，点击上方按钮创建一个。
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {pipelines.map((pipeline) => (
                <motion.button
                  key={pipeline.id}
                  layout
                  onClick={() => setSelectedPipelineId(pipeline.id)}
                  className={`interactive-lift w-full rounded-[20px] border px-4 py-3.5 text-left ${
                    selectedPipelineId === pipeline.id
                      ? 'border-fuchsia-200/18 bg-[linear-gradient(180deg,rgba(217,70,239,0.16),rgba(217,70,239,0.06))] text-fuchsia-50'
                      : 'border-white/[0.07] bg-white/[0.025] text-slate-300 hover:border-white/[0.12] hover:bg-white/[0.045]'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-black/20">
                      <Workflow size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium">{pipeline.name}</p>
                        <span className="rounded-full border border-white/[0.08] bg-black/20 px-2 py-0.5 text-[10px]">
                          v{pipeline.version}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-500">{pipeline.description || 'No description'}</p>
                      <p className="mt-2 text-[11px] text-slate-600">{pipeline.stepCount} nodes</p>
                    </div>
                  </div>
                </motion.button>
              ))}
            </AnimatePresence>
          )}
        </div>
      </section>

      <section className="panel-surface rounded-[28px] border border-white/[0.08] px-6 py-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="instrument-tag rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.22em]">
                Pipeline Editor
              </span>
              {selectedPipelineId && (
                <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">
                  {selectedPipelineId.slice(0, 8)}
                </span>
              )}
            </div>
            <h2 className="mt-2 text-2xl font-semibold text-white" style={{ fontFamily: 'var(--font-display)' }}>
              DSL 编辑与运行
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {selectedPipelineId && (
              <button
                onClick={() => void handleDelete()}
                disabled={saving}
                className="interactive-lift inline-flex items-center gap-2 rounded-full border border-red-400/18 bg-red-400/[0.08] px-4 py-2 text-sm text-red-100 hover:bg-red-400/[0.12] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 size={14} />
                删除
              </button>
            )}
            <button
              onClick={() => void handleSave()}
              disabled={saving || detailsLoading}
              className="interactive-lift inline-flex items-center gap-2 rounded-full border border-cyan-400/18 bg-cyan-400/[0.08] px-4 py-2 text-sm text-cyan-100 hover:bg-cyan-400/[0.12] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              保存
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-[20px] border border-red-400/16 bg-red-400/[0.08] px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <section className="rounded-[22px] border border-white/[0.08] bg-black/20 p-4">
              <label className="text-[11px] uppercase tracking-[0.18em] text-slate-500">名称</label>
              <input
                value={editorName}
                onChange={(event) => setEditorName(event.target.value)}
                className="mt-2 w-full rounded-[14px] border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-white/20 focus:outline-none"
              />
            </section>

            <section className="rounded-[22px] border border-white/[0.08] bg-black/20 p-4">
              <label className="text-[11px] uppercase tracking-[0.18em] text-slate-500">描述</label>
              <textarea
                value={editorDescription}
                onChange={(event) => setEditorDescription(event.target.value)}
                rows={4}
                className="mt-2 w-full resize-none rounded-[14px] border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-white/20 focus:outline-none"
              />
            </section>

            <section className="rounded-[22px] border border-white/[0.08] bg-black/20 p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">默认运行时</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <select
                  value={editorProvider}
                  onChange={(event) => {
                    setEditorProvider(event.target.value)
                    setEditorModel('')
                    setModels([])
                  }}
                  className="rounded-[14px] border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-slate-100 focus:border-white/20 focus:outline-none"
                >
                  <option value="">选择 Provider</option>
                  {configuredProviders.map((provider) => (
                    <option key={provider.name} value={provider.name}>
                      {provider.label}
                    </option>
                  ))}
                </select>
                <select
                  value={editorModel}
                  onChange={(event) => setEditorModel(event.target.value)}
                  disabled={!editorProvider || modelsLoading}
                  className="rounded-[14px] border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-slate-100 focus:border-white/20 focus:outline-none"
                >
                  <option value="">选择 Model</option>
                  {models.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </div>
            </section>

            <section className="rounded-[22px] border border-white/[0.08] bg-black/20 p-4">
              <label className="text-[11px] uppercase tracking-[0.18em] text-slate-500">运行目标</label>
              <textarea
                value={runObjective}
                onChange={(event) => setRunObjective(event.target.value)}
                rows={4}
                className="mt-2 w-full resize-none rounded-[14px] border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-white/20 focus:outline-none"
              />
              {isDirty && (
                <p className="mt-2 text-xs text-amber-200/85">当前编辑器有未保存改动，运行前请先保存。</p>
              )}
              <button
                onClick={() => void handleRun()}
                disabled={!selectedPipelineId || running || detailsLoading || isDirty}
                className="interactive-lift mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full border border-emerald-400/18 bg-emerald-400/[0.08] px-4 py-2.5 text-sm text-emerald-100 hover:bg-emerald-400/[0.12] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                运行 Pipeline
              </button>
            </section>
          </div>

          <section className="rounded-[22px] border border-white/[0.08] bg-black/20 p-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Steps JSON</p>
            <textarea
              value={editorStepsJson}
              onChange={(event) => setEditorStepsJson(event.target.value)}
              spellCheck={false}
              rows={28}
              className="mt-3 h-full min-h-[520px] w-full resize-none rounded-[16px] border border-white/10 bg-[#02060d] px-4 py-3 font-mono text-[12px] leading-6 text-slate-200 placeholder:text-slate-600 focus:border-white/20 focus:outline-none"
            />
          </section>
        </div>
      </section>
    </div>
  )
}
