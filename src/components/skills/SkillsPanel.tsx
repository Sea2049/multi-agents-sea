import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type DragEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { RefreshCw, ShieldCheck, ShieldOff, Sparkles, Store, ToggleLeft, ToggleRight, Upload } from 'lucide-react'
import { apiClient, type LocalSkillPreview, type SkillRecord } from '../../lib/api-client'
import { SkillMarketView } from './SkillMarketView'

const SOURCE_LABELS: Record<SkillRecord['source'], string> = {
  bundled: '内置',
  user: '用户',
  workspace: '工作区',
  imported: '导入',
  remote: '远程',
}

const MODE_LABELS: Record<SkillRecord['mode'], string> = {
  'prompt-only': 'Prompt Only',
  'tool-contributor': 'Tool Contributor',
}

export function SkillsPanel() {
  const [skills, setSkills] = useState<SkillRecord[]>([])
  const [version, setVersion] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const [importFiles, setImportFiles] = useState<File[]>([])
  const [previewResult, setPreviewResult] = useState<LocalSkillPreview | null>(null)

  const loadSkills = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await apiClient.skills.list()
      setSkills(response.skills)
      setVersion(response.version)
    } catch (err) {
      setError(err instanceof Error ? err.message : '技能列表加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSkills()
  }, [loadSkills])

  const stats = useMemo(() => ({
    total: skills.length,
    enabled: skills.filter((skill) => skill.enabled).length,
    eligible: skills.filter((skill) => skill.eligible).length,
    trusted: skills.filter((skill) => skill.trusted).length,
  }), [skills])

  const updateSkill = useCallback((nextSkillId: string, patch: Partial<SkillRecord>) => {
    setSkills((prev) => prev.map((skill) => skill.id === nextSkillId ? { ...skill, ...patch } : skill))
  }, [])

  const handleToggleEnabled = useCallback(async (skill: SkillRecord) => {
    setBusyKey(`${skill.id}:enabled`)
    try {
      if (skill.enabled) {
        await apiClient.skills.disable(skill.id)
        updateSkill(skill.id, { enabled: false, eligible: false })
      } else {
        await apiClient.skills.enable(skill.id)
      }
      await loadSkills()
    } catch (err) {
      setError(err instanceof Error ? err.message : '切换启用状态失败')
    } finally {
      setBusyKey(null)
    }
  }, [loadSkills, updateSkill])

  const handleToggleTrust = useCallback(async (skill: SkillRecord) => {
    setBusyKey(`${skill.id}:trusted`)
    try {
      if (skill.trusted) {
        await apiClient.skills.untrust(skill.id)
      } else {
        await apiClient.skills.trust(skill.id)
      }
      await loadSkills()
    } catch (err) {
      setError(err instanceof Error ? err.message : '切换信任状态失败')
    } finally {
      setBusyKey(null)
    }
  }, [loadSkills])

  const [activeTab, setActiveTab] = useState<'installed' | 'market'>('installed')

  const handlePreviewImport = useCallback(async (files: File[]) => {
    if (files.length === 0) return
    setBusyKey('local:preview')
    setError(null)
    try {
      const preview = await apiClient.skills.previewLocal(files)
      setImportFiles(files)
      setPreviewResult(preview)
    } catch (err) {
      setError(err instanceof Error ? err.message : '技能导入预检失败')
    } finally {
      setBusyKey(null)
    }
  }, [])

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDropActive(false)
    const files = Array.from(event.dataTransfer.files)
    void handlePreviewImport(files)
  }, [handlePreviewImport])

  const handleLocalFileInput = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    void handlePreviewImport(files)
    event.currentTarget.value = ''
  }, [handlePreviewImport])

  const handleConfirmImport = useCallback(async () => {
    if (importFiles.length === 0) return
    setBusyKey('local:import')
    setError(null)
    try {
      await apiClient.skills.importLocal(importFiles)
      setImportFiles([])
      setPreviewResult(null)
      await loadSkills()
    } catch (err) {
      setError(err instanceof Error ? err.message : '技能导入失败')
    } finally {
      setBusyKey(null)
    }
  }, [importFiles, loadSkills])

  const handleUninstallImported = useCallback(async (skillId: string) => {
    setBusyKey(`local:uninstall:${skillId}`)
    setError(null)
    try {
      await apiClient.skills.uninstallImported(skillId)
      await loadSkills()
    } catch (err) {
      setError(err instanceof Error ? err.message : '卸载导入技能失败')
    } finally {
      setBusyKey(null)
    }
  }, [loadSkills])

  return (
    <div className="space-y-6 px-2 py-2">
      {/* Tab navigation */}
      <div className="flex gap-1 rounded-[16px] border border-white/[0.07] bg-white/[0.025] p-1">
        <button
          onClick={() => setActiveTab('installed')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-[12px] py-2.5 text-sm font-medium transition-all ${
            activeTab === 'installed'
              ? 'bg-white/[0.08] text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sparkles size={14} />
          已安装
        </button>
        <button
          onClick={() => setActiveTab('market')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-[12px] py-2.5 text-sm font-medium transition-all ${
            activeTab === 'market'
              ? 'bg-white/[0.08] text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Store size={14} />
          发现市场
        </button>
      </div>

      {activeTab === 'market' && <SkillMarketView />}

      {activeTab === 'installed' && (
        <>
        <section
          onDragOver={(event) => {
            event.preventDefault()
            setDropActive(true)
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={handleDrop}
          className={`panel-surface rounded-[24px] border px-6 py-5 transition ${
            dropActive
              ? 'border-cyan-300/40 bg-cyan-300/[0.08]'
              : 'border-white/[0.08]'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-white">本地导入 Skill</h3>
              <p className="mt-1 text-sm text-slate-400">
                支持拖拽 zip / SKILL.md / 文件集合，导入前会先做预检和冲突分析。
              </p>
            </div>
            <label className="interactive-lift inline-flex cursor-pointer items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/[0.1] px-3.5 py-2 text-xs text-cyan-100">
              <Upload size={14} />
              选择文件
              <input
                type="file"
                multiple
                className="hidden"
                onChange={handleLocalFileInput}
              />
            </label>
          </div>

          {previewResult && (
            <div className="mt-4 rounded-[18px] border border-white/[0.08] bg-white/[0.03] p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-white">{previewResult.name}</p>
                  <p className="text-xs text-slate-400">{previewResult.skillId} · {previewResult.mode}</p>
                </div>
                {previewResult.conflict.hasConflict && (
                  <span className="rounded-full border border-amber-400/18 bg-amber-400/[0.08] px-2.5 py-1 text-[11px] text-amber-200">
                    检测到同名冲突
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-slate-300">{previewResult.description}</p>
              {previewResult.warnings.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-amber-200">
                  {previewResult.warnings.map((warning) => (
                    <li key={warning}>- {warning}</li>
                  ))}
                </ul>
              )}
              <div className="mt-4 flex items-center gap-2">
                <button
                  onClick={() => void handleConfirmImport()}
                  disabled={busyKey === 'local:import'}
                  className="interactive-lift rounded-full border border-cyan-300/20 bg-cyan-300/[0.1] px-3.5 py-2 text-xs text-cyan-100 disabled:opacity-50"
                >
                  {busyKey === 'local:import' ? '导入中…' : '确认导入'}
                </button>
                <button
                  onClick={() => {
                    setPreviewResult(null)
                    setImportFiles([])
                  }}
                  className="interactive-lift rounded-full border border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-xs text-slate-300"
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="panel-surface-strong rounded-[28px] border border-white/[0.08] px-6 py-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="instrument-tag rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.22em]">
                  Skills
                </span>
                <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-slate-400">
                  Registry v{version}
                </span>
              </div>
              <h2 className="mt-2 text-2xl font-semibold text-white" style={{ fontFamily: 'var(--font-display)' }}>
                Skill 插件库
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-400">
                统一管理 prompt-only skills 与可执行 skill 的启用、信任和 gating 状态。技能热更新只会影响新会话、新任务和新的 pipeline 运行。
              </p>
            </div>

            <button
              onClick={() => void loadSkills()}
              className="interactive-lift inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm text-slate-300 hover:border-white/[0.12] hover:bg-white/[0.05] hover:text-white"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              刷新
            </button>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-4">
            {[
              { label: '总数', value: stats.total },
              { label: '已启用', value: stats.enabled },
              { label: '可生效', value: stats.eligible },
              { label: '已信任', value: stats.trusted },
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
        </section>

      {error && (
        <div className="rounded-[22px] border border-rose-400/16 bg-rose-400/[0.08] px-5 py-4 text-sm text-rose-200">
          {error}
        </div>
      )}

      {!loading && skills.length === 0 && (
        <div className="panel-surface rounded-[28px] border border-white/[0.08] px-6 py-10 text-center text-slate-400">
          当前没有发现任何 Skills。你可以在工作区 `skills/` 或用户目录 `~/.sea/skills` 下添加 `SKILL.md`。
        </div>
      )}

      <AnimatePresence initial={false}>
        {skills.map((skill) => (
          <motion.section
            key={skill.id}
            data-skill-id={skill.id}
            layout
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="panel-surface rounded-[26px] border border-white/[0.08] px-6 py-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-cyan-100">
                    <Sparkles size={18} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate text-lg font-semibold text-white">{skill.name}</h3>
                    <p className="truncate text-sm text-slate-400">{skill.description}</p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-slate-300">
                    {SOURCE_LABELS[skill.source]}
                  </span>
                  <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-slate-300">
                    {MODE_LABELS[skill.mode]}
                  </span>
                  <span
                    className={`rounded-full border px-3 py-1 ${
                      skill.eligible
                        ? 'border-emerald-400/18 bg-emerald-400/[0.08] text-emerald-200'
                        : 'border-amber-400/18 bg-amber-400/[0.08] text-amber-200'
                    }`}
                  >
                    {skill.eligible ? '可生效' : 'Gated'}
                  </span>
                  {skill.version && (
                    <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-slate-300">
                      v{skill.version}
                    </span>
                  )}
                </div>

                {skill.disabledReasons.length > 0 && (
                  <div className="mt-4 rounded-[18px] border border-amber-400/16 bg-amber-400/[0.06] px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-amber-200/80">Gating Reasons</p>
                    <ul className="mt-2 space-y-1 text-sm text-amber-100/90">
                      {skill.disabledReasons.map((reason) => (
                        <li key={reason}>- {reason}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="flex shrink-0 flex-col gap-2">
                <button
                  onClick={() => void handleToggleEnabled(skill)}
                  disabled={busyKey === `${skill.id}:enabled`}
                  className={`interactive-lift inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-xs ${
                    skill.enabled
                      ? 'border-emerald-400/18 bg-emerald-400/[0.08] text-emerald-100'
                      : 'border-white/[0.08] bg-white/[0.03] text-slate-300'
                  }`}
                >
                  {skill.enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                  {skill.enabled ? '已启用' : '已禁用'}
                </button>

                {skill.mode === 'tool-contributor' && (
                  <button
                    onClick={() => void handleToggleTrust(skill)}
                    disabled={busyKey === `${skill.id}:trusted`}
                    className={`interactive-lift inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-xs ${
                      skill.trusted
                        ? 'border-cyan-400/18 bg-cyan-400/[0.08] text-cyan-100'
                        : 'border-white/[0.08] bg-white/[0.03] text-slate-300'
                    }`}
                  >
                    {skill.trusted ? <ShieldCheck size={14} /> : <ShieldOff size={14} />}
                    {skill.trusted ? '已信任' : '未信任'}
                  </button>
                )}

                {skill.source === 'imported' && (
                  <button
                    onClick={() => void handleUninstallImported(skill.id)}
                    disabled={busyKey === `local:uninstall:${skill.id}`}
                    className="interactive-lift inline-flex items-center gap-2 rounded-full border border-rose-400/18 bg-rose-400/[0.08] px-3.5 py-2 text-xs text-rose-200 disabled:opacity-50"
                  >
                    {busyKey === `local:uninstall:${skill.id}` ? '卸载中…' : '卸载导入'}
                  </button>
                )}
              </div>
            </div>
          </motion.section>
        ))}
      </AnimatePresence>
        </>
      )}
    </div>
  )
}
