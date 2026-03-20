import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Database,
  Pin,
  PinOff,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import type { MemoryRecord, TaskRecord } from '../../lib/api-client'
import { apiClient } from '../../lib/api-client'

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  fact: { label: 'FACT', color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
  decision: { label: 'DECISION', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
  output: { label: 'OUTPUT', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  task_report: { label: 'REPORT', color: 'text-purple-400 bg-purple-500/10 border-purple-500/20' },
  general: { label: 'GENERAL', color: 'text-slate-400 bg-slate-500/10 border-slate-500/20' },
}

const SOURCE_LABELS: Record<string, string> = {
  manual: '手动',
  task_report: '任务报告',
  step_summary: '步骤摘要',
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function truncateText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function categoryLabel(cat: string): { label: string; color: string } {
  return CATEGORY_META[cat] ?? { label: cat.toUpperCase(), color: 'text-slate-400 bg-slate-500/10 border-slate-500/20' }
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

export function MemoryLibraryView() {
  const [memories, setMemories] = useState<MemoryRecord[]>([])
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebounce(searchInput, 300)

  const [taskFilter, setTaskFilter] = useState('')
  const [agentFilter, setAgentFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkDeleting, setIsBulkDeleting] = useState(false)
  const [togglingPin, setTogglingPin] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [memResult, taskList] = await Promise.all([
        apiClient.memory.list({ limit: 500 }),
        apiClient.tasks.list(),
      ])
      setMemories(memResult.memories)
      setTasks(taskList)
      setSelected(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const tasksById = useMemo(() => {
    const m = new Map<string, TaskRecord>()
    for (const t of tasks) m.set(t.id, t)
    return m
  }, [tasks])

  const taskOptions = useMemo(() => {
    const seen = new Set<string>()
    const opts: Array<{ id: string; label: string }> = []
    for (const m of memories) {
      if (m.taskId && !seen.has(m.taskId)) {
        seen.add(m.taskId)
        const task = tasksById.get(m.taskId)
        opts.push({ id: m.taskId, label: task ? truncateText(task.objective, 30) : m.taskId.slice(0, 12) })
      }
    }
    return opts
  }, [memories, tasksById])

  const agentOptions = useMemo(() => {
    const seen = new Set<string>()
    const opts: Array<{ id: string }> = []
    for (const m of memories) {
      if (m.agentId && !seen.has(m.agentId)) {
        seen.add(m.agentId)
        opts.push({ id: m.agentId })
      }
    }
    return opts
  }, [memories])

  const categoryOptions = useMemo(() => {
    const seen = new Set<string>()
    const opts: string[] = []
    for (const m of memories) {
      if (!seen.has(m.category)) {
        seen.add(m.category)
        opts.push(m.category)
      }
    }
    return opts
  }, [memories])

  const filteredMemories = useMemo(() => {
    let result = memories
    if (taskFilter) result = result.filter(m => m.taskId === taskFilter)
    if (agentFilter) result = result.filter(m => m.agentId === agentFilter)
    if (categoryFilter) result = result.filter(m => m.category === categoryFilter)

    if (debouncedSearch.trim()) {
      const q = debouncedSearch.trim().toLowerCase()
      result = result.filter(m =>
        m.content.toLowerCase().includes(q) ||
        (m.pinReason ?? '').toLowerCase().includes(q)
      )
    }

    return result
  }, [memories, taskFilter, agentFilter, categoryFilter, debouncedSearch])

  const stats = useMemo(() => ({
    total: memories.length,
    pinned: memories.filter(m => m.isPinned).length,
    facts: memories.filter(m => m.category === 'fact').length,
    decisions: memories.filter(m => m.category === 'decision').length,
    outputs: memories.filter(m => m.category === 'output').length,
  }), [memories])

  const allFilteredSelected = filteredMemories.length > 0 && filteredMemories.every(m => selected.has(m.id))

  const toggleSelectAll = useCallback(() => {
    if (allFilteredSelected) {
      setSelected(prev => {
        const next = new Set(prev)
        filteredMemories.forEach(m => next.delete(m.id))
        return next
      })
    } else {
      setSelected(prev => {
        const next = new Set(prev)
        filteredMemories.forEach(m => next.add(m.id))
        return next
      })
    }
  }, [allFilteredSelected, filteredMemories])

  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleBulkDelete = useCallback(async () => {
    const ids = [...selected]
    if (ids.length === 0) return
    if (!confirm(`确认删除选中的 ${ids.length} 条记忆？`)) return
    setIsBulkDeleting(true)
    try {
      await apiClient.memory.bulkDelete(ids)
      setMemories(prev => prev.filter(m => !selected.has(m.id)))
      setSelected(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : '批量删除失败')
    } finally {
      setIsBulkDeleting(false)
    }
  }, [selected])

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('确认删除此记忆？')) return
    try {
      await apiClient.memory.delete(id)
      setMemories(prev => prev.filter(m => m.id !== id))
      setSelected(prev => { const next = new Set(prev); next.delete(id); return next })
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败')
    }
  }, [])

  const handlePin = useCallback(async (id: string, currentlyPinned: boolean) => {
    setTogglingPin(id)
    try {
      const { memory: updated } = await apiClient.memory.pin(id, { pinned: !currentlyPinned })
      setMemories(prev => {
        const next = prev.map(m => m.id === id ? updated : m)
        next.sort((a, b) => {
          if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
          if (a.pinnedAt !== b.pinnedAt) return (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0)
          return b.createdAt - a.createdAt
        })
        return next
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : '置顶操作失败')
    } finally {
      setTogglingPin(null)
    }
  }, [])

  const searchRef = useRef<HTMLInputElement>(null)

  return (
    <div className="flex flex-col h-full bg-black text-white overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-5 border-b border-white/8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Database className="w-5 h-5 text-indigo-400" />
            <div>
              <h1 className="text-base font-semibold text-white">记忆库</h1>
              <p className="text-xs text-white/40 mt-0.5">长期记忆 · 自动提炼 · 跨任务可用</p>
            </div>
          </div>
          <button
            onClick={loadData}
            disabled={isLoading}
            className="p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/8 transition-colors disabled:opacity-40"
            title="刷新"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Stats */}
        <div className="flex gap-4 mt-4">
          {[
            { label: '全部', count: stats.total },
            { label: '已置顶', count: stats.pinned, accent: 'text-amber-400' },
            { label: 'FACT', count: stats.facts, accent: 'text-blue-400' },
            { label: 'DECISION', count: stats.decisions, accent: 'text-amber-400' },
            { label: 'OUTPUT', count: stats.outputs, accent: 'text-emerald-400' },
          ].map(s => (
            <div key={s.label} className="flex flex-col items-center">
              <span className={`text-lg font-bold leading-none ${s.accent ?? 'text-white'}`}>{s.count}</span>
              <span className="text-[10px] text-white/30 mt-0.5">{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Search + Filters */}
      <div className="flex-shrink-0 px-6 py-3 border-b border-white/6 space-y-2">
        <div className="relative flex items-center">
          <Search className="absolute left-3 w-3.5 h-3.5 text-white/30 pointer-events-none" />
          <input
            ref={searchRef}
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="搜索记忆内容…"
            className="w-full pl-9 pr-8 py-1.5 text-sm bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/25 focus:outline-none focus:border-indigo-500/60 focus:bg-white/8 transition"
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput('')}
              className="absolute right-2.5 text-white/30 hover:text-white/60 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex gap-2">
          <select
            value={taskFilter}
            onChange={e => setTaskFilter(e.target.value)}
            className="flex-1 py-1 px-2 text-xs bg-white/5 border border-white/10 rounded text-white/70 focus:outline-none focus:border-indigo-500/40"
          >
            <option value="">全部任务</option>
            {taskOptions.map(t => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>

          <select
            value={agentFilter}
            onChange={e => setAgentFilter(e.target.value)}
            className="flex-1 py-1 px-2 text-xs bg-white/5 border border-white/10 rounded text-white/70 focus:outline-none focus:border-indigo-500/40"
          >
            <option value="">全部 Agent</option>
            {agentOptions.map(a => (
              <option key={a.id} value={a.id}>{a.id}</option>
            ))}
          </select>

          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="flex-1 py-1 px-2 text-xs bg-white/5 border border-white/10 rounded text-white/70 focus:outline-none focus:border-indigo-500/40"
          >
            <option value="">全部分类</option>
            {categoryOptions.map(c => (
              <option key={c} value={c}>{categoryLabel(c).label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Bulk Action Bar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex-shrink-0 overflow-hidden"
          >
            <div className="flex items-center justify-between px-6 py-2 bg-red-500/10 border-b border-red-500/20">
              <span className="text-xs text-red-400">已选 {selected.size} 条</span>
              <button
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="flex items-center gap-1.5 px-3 py-1 rounded text-xs font-medium bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-3 h-3" />
                {bulkDeleting ? '删除中…' : '批量删除'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Select All Row */}
      {filteredMemories.length > 1 && (
        <div className="flex-shrink-0 flex items-center gap-2 px-6 py-1.5 border-b border-white/4">
          <input
            type="checkbox"
            checked={allFilteredSelected}
            onChange={toggleSelectAll}
            className="w-3.5 h-3.5 accent-indigo-500 cursor-pointer"
          />
          <span className="text-[11px] text-white/30">
            {allFilteredSelected ? '取消全选' : `全选当前结果（${filteredMemories.length} 条）`}
          </span>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2.5">
        {error && (
          <div className="text-sm text-red-400 bg-red-500/10 rounded-lg px-4 py-3">{error}</div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-16 text-white/30 text-sm">加载中…</div>
        )}

        {!isLoading && filteredMemories.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-white/25">
            <Database className="w-10 h-10 opacity-30" />
            <p className="text-sm">
              {memories.length === 0 ? '暂无记忆，完成一个任务后会自动提炼' : '没有匹配的记忆'}
            </p>
          </div>
        )}

        <AnimatePresence initial={false}>
          {filteredMemories.map(memory => {
            const cat = categoryLabel(memory.category)
            const isSelected = selected.has(memory.id)
            const task = memory.taskId ? tasksById.get(memory.taskId) : undefined

            return (
              <motion.div
                key={memory.id}
                data-memory-id={memory.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.15 }}
                className={`relative rounded-xl border transition-colors ${
                  memory.isPinned
                    ? 'border-amber-500/25 bg-amber-500/5'
                    : 'border-white/8 bg-white/3 hover:bg-white/5'
                } ${isSelected ? 'ring-1 ring-indigo-500/50' : ''}`}
              >
                {memory.isPinned && (
                  <div className="absolute top-0 left-0 w-1 h-full rounded-l-xl bg-amber-500/50" />
                )}

                <div className="flex items-start gap-3 px-4 pt-3 pb-3">
                  {/* Checkbox */}
                  <div className="flex-shrink-0 mt-0.5">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(memory.id)}
                      className="w-3.5 h-3.5 accent-indigo-500 cursor-pointer"
                    />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white/85 leading-relaxed break-words">
                      {memory.content}
                    </p>

                    {memory.isPinned && memory.pinReason && (
                      <p className="mt-1 text-[11px] text-amber-400/60 italic">
                        置顶原因：{memory.pinReason}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${cat.color}`}>
                        {cat.label}
                      </span>

                      {memory.isPinned && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium border border-amber-500/30 text-amber-400 bg-amber-500/8">
                          <Pin className="w-2.5 h-2.5" />
                          {memory.pinSource === 'auto' ? '自动置顶' : '手动置顶'}
                        </span>
                      )}

                      <span className="text-[11px] text-white/25">
                        {SOURCE_LABELS[memory.source] ?? memory.source}
                      </span>

                      {task && (
                        <span className="text-[11px] text-white/25" title={task.objective}>
                          任务: {truncateText(task.objective, 20)}
                        </span>
                      )}

                      {memory.agentId && (
                        <span className="text-[11px] text-white/25">
                          Agent: {memory.agentId}
                        </span>
                      )}

                      <span className="text-[11px] text-white/20 ml-auto">
                        {formatTime(memory.createdAt)}
                      </span>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex-shrink-0 flex items-center gap-1">
                    <button
                      onClick={() => handlePin(memory.id, memory.isPinned)}
                      disabled={togglingPin === memory.id}
                      className={`p-1.5 rounded-lg transition-colors disabled:opacity-40 ${
                        memory.isPinned
                          ? 'text-amber-400 hover:bg-amber-500/20'
                          : 'text-white/25 hover:text-amber-400 hover:bg-amber-500/10'
                      }`}
                      title={memory.isPinned ? '取消置顶' : '置顶记忆'}
                      aria-label={memory.isPinned ? '取消置顶' : '置顶记忆'}
                    >
                      {memory.isPinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
                    </button>

                    <button
                      onClick={() => handleDelete(memory.id)}
                      className="p-1.5 rounded-lg text-white/25 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title="删除记忆"
                      aria-label="删除记忆"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}
