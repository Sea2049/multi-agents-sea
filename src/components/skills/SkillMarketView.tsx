import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Download, RefreshCw, Search, ShieldAlert, Trash2, Upload, Tag } from 'lucide-react'
import {
  apiClient,
  type RemoteSkillIndexEntry,
  type RemoteSkillRecord,
  type RemoteSkillUpdateCheck,
} from '../../lib/api-client'

function TagBadge({ tag }: { tag: string }) {
  return (
    <span className="rounded-full border border-violet-400/18 bg-violet-400/[0.08] px-2.5 py-0.5 text-[11px] text-violet-300">
      {tag}
    </span>
  )
}

export function SkillMarketView() {
  const [indexEntries, setIndexEntries] = useState<RemoteSkillIndexEntry[]>([])
  const [installedSkills, setInstalledSkills] = useState<RemoteSkillRecord[]>([])
  const [updateChecks, setUpdateChecks] = useState<RemoteSkillUpdateCheck[]>([])
  const [loading, setLoading] = useState(true)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [index, installed] = await Promise.all([
        apiClient.skills.getIndex(),
        apiClient.skills.listRemote(),
      ])
      setIndexEntries(index)
      setInstalledSkills(installed)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载 Skill 市场失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const checkUpdates = useCallback(async () => {
    setCheckingUpdates(true)
    try {
      const checks = await apiClient.skills.checkUpdates()
      setUpdateChecks(checks)
    } catch {
      // silently ignore update check errors
    } finally {
      setCheckingUpdates(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    if (installedSkills.length > 0) {
      void checkUpdates()
    }
  }, [installedSkills, checkUpdates])

  const installedIds = useMemo(() => new Set(installedSkills.map((s) => s.id)), [installedSkills])

  const updateAvailableIds = useMemo(
    () => new Set(updateChecks.filter((c) => c.hasUpdate).map((c) => c.id)),
    [updateChecks],
  )

  const filteredEntries = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()
    if (!q) return indexEntries
    return indexEntries.filter(
      (entry) =>
        entry.name.toLowerCase().includes(q) ||
        entry.description.toLowerCase().includes(q) ||
        entry.author.toLowerCase().includes(q) ||
        entry.tags.some((tag) => tag.toLowerCase().includes(q)),
    )
  }, [indexEntries, searchQuery])

  const handleInstall = useCallback(async (entry: RemoteSkillIndexEntry) => {
    setBusyId(entry.id)
    setError(null)
    try {
      await apiClient.skills.installRemote(entry.url)
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : `安装 "${entry.name}" 失败`)
    } finally {
      setBusyId(null)
    }
  }, [loadData])

  const handleUpdate = useCallback(async (entry: RemoteSkillIndexEntry) => {
    setBusyId(`update:${entry.id}`)
    setError(null)
    try {
      await apiClient.skills.updateRemote(entry.id)
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : `更新 "${entry.name}" 失败`)
    } finally {
      setBusyId(null)
    }
  }, [loadData])

  const handleUninstall = useCallback(async (entry: RemoteSkillIndexEntry) => {
    setBusyId(`uninstall:${entry.id}`)
    setError(null)
    try {
      await apiClient.skills.uninstallRemote(entry.id)
      await loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : `卸载 "${entry.name}" 失败`)
    } finally {
      setBusyId(null)
    }
  }, [loadData])

  const stats = useMemo(() => ({
    total: indexEntries.length,
    installed: installedSkills.length,
    updates: updateChecks.filter((c) => c.hasUpdate).length,
  }), [indexEntries.length, installedSkills.length, updateChecks])

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
              从远程仓库发现、安装和管理 Skills。远程 Skills 在 Worker 沙箱中执行，确保安全隔离。
            </p>
          </div>

          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => void checkUpdates()}
              disabled={checkingUpdates || installedSkills.length === 0}
              className="interactive-lift inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm text-slate-300 hover:border-white/[0.12] hover:bg-white/[0.05] hover:text-white disabled:opacity-40"
            >
              <Upload size={15} className={checkingUpdates ? 'animate-spin' : ''} />
              检查更新
            </button>
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
            { label: '已安装', value: stats.installed },
            { label: '待更新', value: stats.updates },
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
            placeholder="搜索 Skills（名称、描述、标签、作者）…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-[18px] border border-white/[0.08] bg-white/[0.03] py-3 pl-10 pr-4 text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-violet-500/40 focus:bg-white/[0.05]"
          />
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
      {!loading && filteredEntries.length === 0 && (
        <div className="panel-surface rounded-[28px] border border-white/[0.08] px-6 py-10 text-center text-slate-400">
          {searchQuery ? `没有匹配 "${searchQuery}" 的 Skills` : '没有可用的远程 Skills'}
        </div>
      )}

      {/* Skill Cards */}
      <AnimatePresence initial={false}>
        {filteredEntries.map((entry) => {
          const isInstalled = installedIds.has(entry.id)
          const hasUpdate = updateAvailableIds.has(entry.id)
          const isInstallingNow = busyId === entry.id
          const isUpdatingNow = busyId === `update:${entry.id}`
          const isUninstallingNow = busyId === `uninstall:${entry.id}`
          const isBusy = isInstallingNow || isUpdatingNow || isUninstallingNow

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
                        {hasUpdate && (
                          <span className="rounded-full border border-amber-400/18 bg-amber-400/[0.08] px-2.5 py-0.5 text-[11px] text-amber-200">
                            有更新
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-400">by {entry.author}{entry.version ? ` · v${entry.version}` : ''}</p>
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
                    <span>远程 Skills 在 Worker 沙箱中执行</span>
                  </div>
                </div>

                <div className="flex shrink-0 flex-col gap-2">
                  {!isInstalled ? (
                    <button
                      onClick={() => void handleInstall(entry)}
                      disabled={isBusy}
                      className="interactive-lift inline-flex items-center gap-2 rounded-full border border-violet-400/18 bg-violet-400/[0.08] px-3.5 py-2 text-xs text-violet-100 hover:bg-violet-400/[0.15] disabled:opacity-50"
                    >
                      {isInstallingNow ? (
                        <RefreshCw size={13} className="animate-spin" />
                      ) : (
                        <Download size={13} />
                      )}
                      {isInstallingNow ? '安装中…' : '安装'}
                    </button>
                  ) : (
                    <>
                      {hasUpdate && (
                        <button
                          onClick={() => void handleUpdate(entry)}
                          disabled={isBusy}
                          className="interactive-lift inline-flex items-center gap-2 rounded-full border border-amber-400/18 bg-amber-400/[0.08] px-3.5 py-2 text-xs text-amber-100 hover:bg-amber-400/[0.15] disabled:opacity-50"
                        >
                          {isUpdatingNow ? (
                            <RefreshCw size={13} className="animate-spin" />
                          ) : (
                            <Upload size={13} />
                          )}
                          {isUpdatingNow ? '更新中…' : '更新'}
                        </button>
                      )}
                      <button
                        onClick={() => void handleUninstall(entry)}
                        disabled={isBusy}
                        className="interactive-lift inline-flex items-center gap-2 rounded-full border border-rose-400/18 bg-rose-400/[0.08] px-3.5 py-2 text-xs text-rose-200 hover:bg-rose-400/[0.15] disabled:opacity-50"
                      >
                        {isUninstallingNow ? (
                          <RefreshCw size={13} className="animate-spin" />
                        ) : (
                          <Trash2 size={13} />
                        )}
                        {isUninstallingNow ? '卸载中…' : '卸载'}
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
