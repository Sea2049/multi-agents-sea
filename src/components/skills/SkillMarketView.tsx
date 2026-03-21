import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertTriangle, Ban, CheckCircle2, Download, RefreshCw, Search, ShieldAlert, Tag } from 'lucide-react'
import { apiClient, type SkillMarketEntry, type SkillMarketPreview, type SkillRecord } from '../../lib/api-client'

function TagBadge({ tag }: { tag: string }) {
  return (
    <span className="rounded-full border border-violet-400/18 bg-violet-400/[0.08] px-2.5 py-0.5 text-[11px] text-violet-300">
      {tag}
    </span>
  )
}

export function SkillMarketView() {
  const [indexEntries, setIndexEntries] = useState<SkillMarketEntry[]>([])
  const [displayEntries, setDisplayEntries] = useState<SkillMarketEntry[]>([])
  const [installedSkills, setInstalledSkills] = useState<SkillRecord[]>([])
  const [previewMap, setPreviewMap] = useState<Record<string, SkillMarketPreview>>({})
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const normalizeError = useCallback((raw: unknown, fallback: string): string => {
    if (!(raw instanceof Error)) return fallback
    const text = raw.message
    const marker = text.indexOf(':')
    if (marker === -1) return text
    const payload = text.slice(marker + 1).trim()
    if (!payload.startsWith('{')) return text
    try {
      const parsed = JSON.parse(payload) as { error?: string }
      if (typeof parsed.error === 'string' && parsed.error.trim()) {
        return parsed.error
      }
      return text
    } catch {
      return text
    }
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [index, installed] = await Promise.all([
        apiClient.skills.getIndex(),
        apiClient.skills.list(),
      ])
      setIndexEntries(index)
      setDisplayEntries(index)
      setInstalledSkills(installed.skills)
      setPreviewMap({})
    } catch (err) {
      setError(normalizeError(err, '加载 Skill 市场失败'))
    } finally {
      setLoading(false)
    }
  }, [normalizeError])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const installedIds = useMemo(() => new Set(installedSkills.map((s) => s.id)), [installedSkills])

  useEffect(() => {
    const query = searchQuery.trim()
    if (!query) {
      setDisplayEntries(indexEntries)
      return
    }
    setSearching(true)
    const timer = setTimeout(() => {
      void apiClient.skills.searchIndex(query)
        .then((entries) => {
          setDisplayEntries(entries)
        })
        .catch((err) => {
          setError(normalizeError(err, '自然语言搜索失败'))
        })
        .finally(() => {
          setSearching(false)
        })
    }, 300)

    return () => {
      clearTimeout(timer)
      setSearching(false)
    }
  }, [indexEntries, normalizeError, searchQuery])

  const handlePreview = useCallback(async (entry: SkillMarketEntry) => {
    setBusyId(`preview:${entry.id}`)
    setError(null)
    try {
      const preview = await apiClient.skills.previewMarket(entry.provider, entry.providerSkillId)
      setPreviewMap((prev) => ({ ...prev, [entry.id]: preview }))
    } catch (err) {
      setError(normalizeError(err, `预检 "${entry.name}" 失败`))
    } finally {
      setBusyId(null)
    }
  }, [normalizeError])

  const handleInstall = useCallback(async (entry: SkillMarketEntry) => {
    setBusyId(`install:${entry.id}`)
    setError(null)
    try {
      await apiClient.skills.installMarket(entry.provider, entry.providerSkillId)
      await loadData()
    } catch (err) {
      setError(normalizeError(err, `安装 "${entry.name}" 失败`))
    } finally {
      setBusyId(null)
    }
  }, [loadData, normalizeError])

  const stats = useMemo(() => ({
    total: indexEntries.length,
    installed: installedSkills.filter((skill) => skill.source === 'imported').length,
    ready: Object.values(previewMap).filter((preview) => preview.installability === 'installable').length,
  }), [indexEntries.length, installedSkills, previewMap])

  return (
    <div className="space-y-6 px-2 py-2">
      {/* Header */}
      <section className="panel-surface-strong rounded-[28px] border border-white/[0.08] px-6 py-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="instrument-tag rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.22em]">
                Market
              </span>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">
                Remote Skills
              </span>
            </div>
            <h2 className="mt-2 text-2xl font-semibold text-white" style={{ fontFamily: 'var(--font-display)' }}>
              Skill 市场
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-400">
              聚合外部 Skill 市场并执行兼容性与安全预检。第三方技能安装后默认禁用，需你确认后再启用。
            </p>
          </div>

          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => void loadData()}
              disabled={loading}
              className="interactive-lift inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm text-slate-300 hover:border-white/[0.12] hover:bg-white/[0.05] hover:text-white"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              刷新
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {[
            { label: '可用 Skills', value: stats.total },
            { label: '已安装(导入)', value: stats.installed },
            { label: '可直接安装', value: stats.ready },
          ].map((item) => (
            <div
              key={item.label}
              className="soft-ring rounded-[22px] border border-white/[0.06] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.015))] px-4 py-4"
            >
              <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">{item.label}</p>
              <p className="mt-3 text-[30px] font-semibold leading-none text-white">{item.value}</p>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="mt-4 relative">
          <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <input
            type="text"
            placeholder="用自然语言描述你需要的能力…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-[18px] border border-white/[0.08] bg-white/[0.03] py-3 pl-10 pr-4 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-violet-500/40 focus:bg-white/[0.05]"
          />
          {searching && (
            <p className="mt-2 text-xs text-slate-500">正在进行自然语言检索…</p>
          )}
        </div>
      </section>

      {/* Error Banner */}
      {error && (
        <div className="rounded-[22px] border border-rose-400/16 bg-rose-400/[0.08] px-5 py-4 text-sm text-rose-200">
          {error}
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="panel-surface animate-pulse rounded-[26px] border border-white/[0.08] px-6 py-5 h-32"
            />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && displayEntries.length === 0 && (
        <div className="panel-surface rounded-[28px] border border-white/[0.08] px-6 py-10 text-center text-slate-400">
          {searchQuery ? `没有匹配 "${searchQuery}" 的 Skills` : '没有可用的远程 Skills'}
        </div>
      )}

      {/* Skill Cards */}
      <AnimatePresence initial={false}>
        {displayEntries.map((entry) => {
          const preview = previewMap[entry.id]
          const isInstalled = preview ? installedIds.has(preview.localPreview.skillId) : false
          const isPreviewing = busyId === `preview:${entry.id}`
          const isInstalling = busyId === `install:${entry.id}`
          const isBusy = isPreviewing || isInstalling

          return (
            <motion.section
              key={entry.id}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="panel-surface rounded-[26px] border border-white/[0.08] px-6 py-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-violet-400/20 bg-violet-900/20 text-violet-300">
                      <Tag size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-lg font-semibold text-white">{entry.name}</h3>
                        {isInstalled && (
                          <span className="rounded-full border border-emerald-400/18 bg-emerald-400/[0.08] px-2.5 py-0.5 text-[11px] text-emerald-200">
                            已安装
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-400">by {entry.author}{entry.version ? ` · v${entry.version}` : ''} · {entry.provider}</p>
                    </div>
                  </div>

                  <p className="mt-3 text-sm leading-6 text-slate-300">{entry.description}</p>

                  {entry.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {entry.tags.map((tag) => (
                        <TagBadge key={tag} tag={tag} />
                      ))}
                    </div>
                  )}

                  <div className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
                    <ShieldAlert size={12} />
                    <span>先预检再安装，第三方技能默认禁用</span>
                  </div>

                  {entry.moderation && (
                    <div className="mt-2">
                      <span
                        className={`rounded-full border px-2.5 py-0.5 text-[11px] ${
                          entry.moderation.verdict === 'clean'
                            ? 'border-emerald-400/18 bg-emerald-400/[0.08] text-emerald-200'
                            : entry.moderation.verdict === 'suspicious'
                              ? 'border-rose-400/18 bg-rose-400/[0.08] text-rose-200'
                              : 'border-amber-400/18 bg-amber-400/[0.08] text-amber-200'
                        }`}
                      >
                        {entry.moderation.verdict === 'clean'
                          ? '已审计'
                          : entry.moderation.verdict === 'suspicious'
                            ? '疑似风险'
                            : '未知风险'}
                      </span>
                    </div>
                  )}

                  {preview && (
                    <div className="mt-3 rounded-[16px] border border-white/[0.08] bg-white/[0.03] px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span
                          className={`rounded-full border px-2.5 py-0.5 ${
                            preview.compatibility === 'compatible'
                              ? 'border-emerald-400/18 bg-emerald-400/[0.08] text-emerald-200'
                              : preview.compatibility === 'needs_review'
                                ? 'border-amber-400/18 bg-amber-400/[0.08] text-amber-200'
                                : 'border-rose-400/18 bg-rose-400/[0.08] text-rose-200'
                          }`}
                        >
                          兼容性: {preview.compatibility}
                        </span>
                        <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-0.5 text-slate-300">
                          安装状态: {preview.installability}
                        </span>
                      </div>
                      {preview.reasons.length > 0 && (
                        <ul className="mt-2 space-y-1 text-xs text-rose-200">
                          {preview.reasons.map((reason) => (
                            <li key={reason}>- {reason}</li>
                          ))}
                        </ul>
                      )}
                      {preview.warnings.length > 0 && (
                        <ul className="mt-2 space-y-1 text-xs text-amber-200">
                          {preview.warnings.map((warning) => (
                            <li key={warning}>- {warning}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 flex-col gap-2">
                  {isInstalled ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/18 bg-emerald-400/[0.08] px-3.5 py-2 text-xs text-emerald-100">
                      <CheckCircle2 size={13} />
                      已安装
                    </span>
                  ) : (
                    <>
                      <button
                        onClick={() => void handlePreview(entry)}
                        disabled={isBusy}
                        className="interactive-lift inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-xs text-slate-200 hover:bg-white/[0.06] disabled:opacity-50"
                      >
                        {isPreviewing ? (
                          <RefreshCw size={13} className="animate-spin" />
                        ) : (
                          <AlertTriangle size={13} />
                        )}
                        {isPreviewing ? '预检中…' : '预检'}
                      </button>
                      <button
                        onClick={() => void handleInstall(entry)}
                        disabled={isBusy || preview?.installability !== 'installable'}
                        className="interactive-lift inline-flex items-center gap-2 rounded-full border border-violet-400/18 bg-violet-400/[0.08] px-3.5 py-2 text-xs text-violet-100 hover:bg-violet-400/[0.15] disabled:opacity-50"
                      >
                        {isInstalling ? (
                          <RefreshCw size={13} className="animate-spin" />
                        ) : preview?.installability === 'installable' ? (
                          <Download size={13} />
                        ) : (
                          <Ban size={13} />
                        )}
                        {isInstalling ? '安装中…' : '安装'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </motion.section>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
