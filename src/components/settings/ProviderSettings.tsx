import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Server,
  Sparkles,
  X,
  Zap,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { apiClient, type ModelInfo, type ProviderConfig } from '../../lib/api-client'

interface ProviderSettingsProps {
  onClose: () => void
  onSaved?: () => void
}

type ConnectionStatus = 'idle' | 'testing' | 'ok' | 'error'

interface ProviderState {
  config: ProviderConfig
  models: ModelInfo[]
  status: ConnectionStatus
  statusError?: string
  selectedModel: string
  modelsLoading: boolean
  saving: boolean
  drafts: Record<string, string>
}

interface DesktopSecretsApi {
  saveMany: (entries: Array<{ provider: string; value: string }>) => Promise<boolean>
  removeMany: (providers: string[]) => Promise<boolean>
}

function getDesktopSecretsApi(): DesktopSecretsApi | null {
  if (typeof window === 'undefined') {
    return null
  }

  const api = (window as unknown as { api?: { secrets?: DesktopSecretsApi } }).api
  return api?.secrets ?? null
}

function ProviderIcon({ iconKey }: { iconKey: string }) {
  switch (iconKey) {
    case 'sparkles':
      return <Sparkles size={18} className="text-emerald-300" />
    case 'bot':
      return <Bot size={18} className="text-orange-300" />
    case 'zap':
      return <Zap size={18} className="text-cyan-300" />
    case 'server':
      return <Server size={18} className="text-violet-300" />
    default:
      return <Sparkles size={18} className="text-slate-300" />
  }
}

function StatusBadge({
  configured,
  status,
  error,
}: {
  configured: boolean
  status: ConnectionStatus
  error?: string
}) {
  if (status === 'testing') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[11px] text-cyan-200">
        <Loader2 size={11} className="animate-spin" />
        连接中
      </span>
    )
  }

  if (status === 'ok') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] text-emerald-200">
        <CheckCircle2 size={11} />
        已连接
      </span>
    )
  }

  if (status === 'error') {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-red-400/20 bg-red-400/10 px-2.5 py-1 text-[11px] text-red-300"
        title={error}
      >
        <AlertCircle size={11} />
        错误
      </span>
    )
  }

  if (configured) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[11px] text-emerald-200">
        <CheckCircle2 size={11} />
        已配置
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-slate-400">
      未配置
    </span>
  )
}

function createProviderState(config: ProviderConfig): ProviderState {
  const drafts = Object.fromEntries(
    config.settingsSchema.map((field) => [
      field.key,
      field.inputType === 'secret' ? '' : field.currentValue ?? field.defaultValue ?? '',
    ]),
  )

  return {
    config,
    models: [],
    status: 'idle',
    selectedModel: config.defaultModel ?? '',
    modelsLoading: false,
    saving: false,
    drafts,
  }
}

export default function ProviderSettings({ onClose, onSaved }: ProviderSettingsProps) {
  const [providerStates, setProviderStates] = useState<ProviderState[]>([])
  const [loading, setLoading] = useState(true)
  const [topLevelError, setTopLevelError] = useState<string | null>(null)

  const desktopSecretsApi = getDesktopSecretsApi()
  const isElectron = desktopSecretsApi !== null

  const loadProviders = useCallback(async () => {
    setLoading(true)
    setTopLevelError(null)
    try {
      const providers = await apiClient.getProviders()
      setProviderStates(providers.map((provider) => createProviderState(provider)))
    } catch (err) {
      setTopLevelError(err instanceof Error ? err.message : 'Provider 列表加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadProviders()
  }, [loadProviders])

  const updateProviderState = useCallback((providerName: string, updater: (state: ProviderState) => ProviderState) => {
    setProviderStates((prev) => prev.map((state) => state.config.name === providerName ? updater(state) : state))
  }, [])

  const loadModels = useCallback(async (providerName: string) => {
    updateProviderState(providerName, (state) => ({ ...state, modelsLoading: true }))

    try {
      const models = await apiClient.getModels(providerName)
      updateProviderState(providerName, (state) => ({
        ...state,
        models,
        modelsLoading: false,
        selectedModel: models.some((model) => model.id === state.selectedModel)
          ? state.selectedModel
          : models[0]?.id ?? '',
      }))
    } catch (err) {
      updateProviderState(providerName, (state) => ({
        ...state,
        modelsLoading: false,
        status: 'error',
        statusError: err instanceof Error ? err.message : '模型加载失败',
      }))
    }
  }, [updateProviderState])

  const handleDraftChange = useCallback((providerName: string, fieldKey: string, value: string) => {
    updateProviderState(providerName, (state) => ({
      ...state,
      drafts: {
        ...state.drafts,
        [fieldKey]: value,
      },
    }))
  }, [updateProviderState])

  const handleSaveProvider = useCallback(async (state: ProviderState) => {
    if (!desktopSecretsApi) {
      return
    }

    const saveEntries: Array<{ provider: string; value: string }> = []
    const removeEntries: string[] = []

    for (const field of state.config.settingsSchema) {
      const nextValue = state.drafts[field.key]?.trim() ?? ''
      const currentValue = field.currentValue?.trim() ?? ''

      if (field.inputType === 'secret') {
        if (nextValue) {
          saveEntries.push({ provider: field.storageKey, value: nextValue })
        }
        continue
      }

      if (nextValue && nextValue !== currentValue) {
        saveEntries.push({ provider: field.storageKey, value: nextValue })
      } else if (!nextValue && currentValue && currentValue !== (field.defaultValue ?? '')) {
        removeEntries.push(field.storageKey)
      }
    }

    if (saveEntries.length === 0 && removeEntries.length === 0) {
      return
    }

    updateProviderState(state.config.name, (current) => ({ ...current, saving: true }))

    try {
      if (saveEntries.length > 0) {
        await desktopSecretsApi.saveMany(saveEntries)
      }
      if (removeEntries.length > 0) {
        await desktopSecretsApi.removeMany(removeEntries)
      }

      await loadProviders()
      await loadModels(state.config.name)
      onSaved?.()
    } catch (err) {
      updateProviderState(state.config.name, (current) => ({
        ...current,
        status: 'error',
        statusError: err instanceof Error ? err.message : '保存配置失败',
      }))
    } finally {
      updateProviderState(state.config.name, (current) => ({ ...current, saving: false }))
    }
  }, [desktopSecretsApi, loadModels, loadProviders, onSaved, updateProviderState])

  const handleRemoveSecrets = useCallback(async (state: ProviderState) => {
    if (!desktopSecretsApi) {
      return
    }

    const secretStorageKeys = state.config.settingsSchema
      .filter((field) => field.inputType === 'secret')
      .map((field) => field.storageKey)

    if (secretStorageKeys.length === 0) {
      return
    }

    updateProviderState(state.config.name, (current) => ({ ...current, saving: true }))

    try {
      await desktopSecretsApi.removeMany(secretStorageKeys)
      await loadProviders()
      onSaved?.()
    } catch (err) {
      updateProviderState(state.config.name, (current) => ({
        ...current,
        status: 'error',
        statusError: err instanceof Error ? err.message : '移除密钥失败',
      }))
    } finally {
      updateProviderState(state.config.name, (current) => ({ ...current, saving: false }))
    }
  }, [desktopSecretsApi, loadProviders, onSaved, updateProviderState])

  const handleTestConnection = useCallback(async (providerName: string) => {
    updateProviderState(providerName, (state) => ({ ...state, status: 'testing', statusError: undefined }))

    try {
      const result = await apiClient.validateProvider(providerName)
      updateProviderState(providerName, (state) => ({
        ...state,
        status: result.ok ? 'ok' : 'error',
        statusError: result.error,
      }))

      if (result.ok) {
        await loadModels(providerName)
      }
    } catch (err) {
      updateProviderState(providerName, (state) => ({
        ...state,
        status: 'error',
        statusError: err instanceof Error ? err.message : '连接测试失败',
      }))
    }
  }, [loadModels, updateProviderState])

  const handleSelectModel = useCallback(async (providerName: string, modelId: string) => {
    updateProviderState(providerName, (state) => ({ ...state, selectedModel: modelId }))
    try {
      await apiClient.setDefaultModel(providerName, modelId)
    } catch {
      // best effort
    }
  }, [updateProviderState])

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm"
        onClick={onClose}
      />

      <motion.aside
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 40 }}
        transition={{ duration: 0.22 }}
        className="panel-surface-strong fixed right-0 top-0 z-50 flex h-screen w-full max-w-[720px] flex-col border-l border-white/10 bg-[#06101d]/96 shadow-[-24px_0_80px_rgba(2,6,23,0.45)] backdrop-blur-xl"
        style={{ paddingTop: 'env(titlebar-area-height, 0px)' }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="panel-grid flex items-center justify-between border-b border-white/10 px-6 py-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="instrument-tag rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.22em]">
                Provider Settings
              </span>
            </div>
            <h2 className="mt-2 text-2xl font-semibold text-white" style={{ fontFamily: 'var(--font-display)' }}>
              AI Provider 配置
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              由后端 schema 驱动的动态设置页。新增 provider 或字段后，这里会自动适配。
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-slate-300 transition hover:border-white/16 hover:bg-white/[0.06] hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-6">
          {!isElectron && (
            <div className="rounded-[22px] border border-amber-400/20 bg-amber-400/[0.06] px-5 py-4 text-sm text-amber-200">
              <p className="font-medium">仅在桌面版可用</p>
              <p className="mt-1 text-amber-300/70">
                Provider 凭据保存需要 Electron 桌面应用提供加密存储与本地服务重载。
              </p>
            </div>
          )}

          {topLevelError && (
            <div className="rounded-[22px] border border-red-400/20 bg-red-400/[0.06] px-5 py-4 text-sm text-red-200">
              {topLevelError}
            </div>
          )}

          {loading && (
            <div className="rounded-[22px] border border-white/10 bg-white/[0.03] px-5 py-4 text-sm text-slate-300">
              正在加载 Provider 配置...
            </div>
          )}

          {providerStates.map((state) => (
            <section key={state.config.name} className="panel-surface network-shell rounded-[30px] p-5">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-black/20">
                    <ProviderIcon iconKey={state.config.iconKey} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{state.config.label}</p>
                    <p className="text-xs text-slate-500">{state.config.hint}</p>
                  </div>
                </div>
                <StatusBadge configured={state.config.configured} status={state.status} error={state.statusError} />
              </div>

              <p className="mb-4 text-sm leading-6 text-slate-400">{state.config.description}</p>

              <div className="space-y-3">
                {state.config.settingsSchema.map((field) => (
                  <div key={field.key} className="rounded-[18px] border border-white/10 bg-black/20 p-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{field.label}</p>
                      {field.required && (
                        <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">
                          Required
                        </span>
                      )}
                    </div>

                    <input
                      type={field.inputType === 'secret' ? 'password' : 'text'}
                      value={state.drafts[field.key] ?? ''}
                      onChange={(event) => handleDraftChange(state.config.name, field.key, event.target.value)}
                      placeholder={
                        field.inputType === 'secret' && state.config.configured
                          ? '已保存（输入新值可更新）'
                          : field.placeholder ?? ''
                      }
                      disabled={!isElectron || state.saving}
                      className="w-full rounded-[14px] border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-white/20 focus:outline-none focus:ring-0"
                    />

                    <p className="mt-1.5 text-[11px] text-slate-600">
                      {field.inputType === 'secret'
                        ? '留空表示保留当前已保存值'
                        : `环境变量: ${field.envVar}${field.defaultValue ? `，默认值: ${field.defaultValue}` : ''}`}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <button
                  onClick={() => void handleSaveProvider(state)}
                  disabled={!isElectron || state.saving}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2.5 text-sm text-cyan-100 transition hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {state.saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  保存配置
                </button>

                {state.config.settingsSchema.some((field) => field.inputType === 'secret') && (
                  <button
                    onClick={() => void handleRemoveSecrets(state)}
                    disabled={!isElectron || state.saving}
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-slate-300 transition hover:border-white/16 hover:bg-white/[0.05] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <AlertCircle size={14} />
                    清除密钥
                  </button>
                )}
              </div>

              <div className="mt-4 space-y-3">
                {state.models.length > 0 && (
                  <div className="rounded-[18px] border border-white/10 bg-black/20 p-4">
                    <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">默认模型</p>
                    <div className="relative">
                      <select
                        value={state.selectedModel}
                        onChange={(event) => void handleSelectModel(state.config.name, event.target.value)}
                        className="w-full appearance-none rounded-[14px] border border-white/10 bg-white/[0.04] px-3.5 py-2.5 pr-8 text-sm text-slate-100 focus:border-white/20 focus:outline-none"
                      >
                        {state.models.map((model) => (
                          <option key={model.id} value={model.id} className="bg-slate-900">
                            {model.name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={14}
                        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
                      />
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => void handleTestConnection(state.config.name)}
                    disabled={state.status === 'testing'}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-slate-300 transition hover:border-white/16 hover:bg-white/[0.05] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {state.status === 'testing' ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Zap size={14} />
                    )}
                    测试连接
                  </button>

                  {(state.config.configured || state.config.kind === 'local') && state.models.length === 0 && (
                    <button
                      onClick={() => void loadModels(state.config.name)}
                      disabled={state.modelsLoading}
                      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm text-slate-300 transition hover:border-white/16 hover:bg-white/[0.05] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {state.modelsLoading ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <ChevronDown size={14} />
                      )}
                      加载模型列表
                    </button>
                  )}
                </div>

                {state.status === 'error' && state.statusError && (
                  <p className="rounded-[14px] border border-red-400/15 bg-red-400/[0.06] px-3 py-2.5 text-xs text-red-300">
                    {state.statusError}
                  </p>
                )}
              </div>
            </section>
          ))}
        </div>
      </motion.aside>
    </AnimatePresence>
  )
}
