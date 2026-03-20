import React, { useState, useEffect, useCallback } from 'react'
import { apiClient, type MemoryRecord } from '../../lib/api-client'
import { Search, Trash2, Plus, BookOpen } from 'lucide-react'

export function MemoryPanel() {
  const [memories, setMemories] = useState<MemoryRecord[]>([])
  const [query, setQuery] = useState('')
  const [newContent, setNewContent] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [loading, setLoading] = useState(false)

  const fetchMemories = useCallback(async (q?: string) => {
    setLoading(true)
    try {
      const res = await apiClient.memory.list(q ? { q } : { limit: 20 })
      setMemories(res.memories)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchMemories()
  }, [fetchMemories])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    void fetchMemories(query || undefined)
  }

  const handleAdd = async () => {
    if (!newContent.trim()) return
    await apiClient.memory.save({ content: newContent.trim() })
    setNewContent('')
    setIsAdding(false)
    void fetchMemories(query || undefined)
  }

  const handleDelete = async (id: string) => {
    await apiClient.memory.delete(id)
    setMemories(prev => prev.filter(m => m.id !== id))
  }

  return (
    <div className="flex flex-col h-full bg-[#0d0d0f] text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <BookOpen size={15} className="text-indigo-400" />
          <span className="text-sm font-medium text-slate-200">记忆库</span>
          <span className="text-xs text-slate-500">{memories.length} 条</span>
        </div>
        <button
          onClick={() => setIsAdding(v => !v)}
          className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          <Plus size={13} />
          添加
        </button>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="px-4 py-2 border-b border-white/[0.04]">
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索记忆..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white/[0.04] border border-white/[0.06] rounded-lg text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50"
          />
        </div>
      </form>

      {/* Add memory form */}
      {isAdding && (
        <div className="px-4 py-2 border-b border-white/[0.04] space-y-2">
          <textarea
            value={newContent}
            onChange={e => setNewContent(e.target.value)}
            placeholder="输入要保存的记忆..."
            className="w-full px-3 py-2 text-xs bg-white/[0.04] border border-white/[0.06] rounded-lg text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50 resize-none"
            rows={3}
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setIsAdding(false)}
              className="px-3 py-1 text-xs text-slate-400 hover:text-slate-300"
            >
              取消
            </button>
            <button
              onClick={() => void handleAdd()}
              className="px-3 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-md transition-colors"
            >
              保存
            </button>
          </div>
        </div>
      )}

      {/* Memory list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading && (
          <div className="text-center text-xs text-slate-600 py-4">加载中...</div>
        )}
        {!loading && memories.length === 0 && (
          <div className="text-center text-xs text-slate-600 py-8">
            暂无记忆。任务完成后，系统会自动保存报告摘要。
          </div>
        )}
        {memories.map(memory => (
          <MemoryItem key={memory.id} memory={memory} onDelete={() => void handleDelete(memory.id)} />
        ))}
      </div>
    </div>
  )
}

function MemoryItem({ memory, onDelete }: { memory: MemoryRecord; onDelete: () => void }) {
  const categoryColors: Record<string, string> = {
    task_report: 'text-emerald-400',
    general: 'text-slate-400',
    step_summary: 'text-blue-400',
  }

  return (
    <div className="group relative rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 hover:border-white/[0.1] transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className={`text-[10px] uppercase tracking-[0.1em] ${categoryColors[memory.category] ?? 'text-slate-500'}`}>
              {memory.category}
            </span>
            <span className="text-[10px] text-slate-600">·</span>
            <span className="text-[10px] text-slate-600">{memory.source}</span>
          </div>
          <p className="text-xs text-slate-300 leading-5 line-clamp-3">{memory.content}</p>
        </div>
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 shrink-0 p-1 text-slate-600 hover:text-red-400 transition-all"
        >
          <Trash2 size={12} />
        </button>
      </div>
      <div className="mt-1.5 text-[10px] text-slate-600">
        {new Date(memory.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  )
}
