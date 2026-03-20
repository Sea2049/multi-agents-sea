import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { apiClient, type TaskRecord, type TaskStatus } from '../../lib/api-client';

interface TaskHistoryViewProps {
  onOpenTask: (taskId: string) => void;
}

function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusIcon(status: TaskStatus) {
  switch (status) {
    case 'pending':
      return <Clock size={15} className="text-slate-500" />;
    case 'planning':
      return <Loader2 size={15} className="animate-spin text-indigo-400" />;
    case 'running':
      return <Loader2 size={15} className="animate-spin text-blue-400" />;
    case 'completed':
      return <CheckCircle2 size={15} className="text-emerald-400" />;
    case 'failed':
      return <AlertCircle size={15} className="text-red-400" />;
  }
}

function statusLabel(status: TaskStatus): string {
  switch (status) {
    case 'pending': return '等待中';
    case 'planning': return '规划中';
    case 'running': return '执行中';
    case 'completed': return '已完成';
    case 'failed': return '失败';
  }
}

function statusStyle(status: TaskStatus): string {
  switch (status) {
    case 'completed': return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
    case 'failed': return 'text-red-400 bg-red-400/10 border-red-400/20';
    case 'running': return 'text-blue-400 bg-blue-400/10 border-blue-400/20';
    case 'planning': return 'text-indigo-400 bg-indigo-400/10 border-indigo-400/20';
    default: return 'text-slate-500 bg-slate-800/40 border-slate-700/30';
  }
}

function TaskRow({
  task,
  onOpen,
  onDelete,
}: {
  task: TaskRecord;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const stepCount = task.steps?.length ?? 0;
  const completedSteps = task.steps?.filter((s) => s.status === 'completed').length ?? 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.2 }}
      className="group flex items-start gap-3 rounded-[20px] border border-white/[0.06] bg-white/[0.02] px-4 py-4 transition hover:border-white/[0.1] hover:bg-white/[0.04]"
    >
      <div className="mt-0.5 shrink-0">{statusIcon(task.status)}</div>

      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm leading-6 text-slate-200">{task.objective}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusStyle(task.status)}`}>
            {statusLabel(task.status)}
          </span>
          {stepCount > 0 && (
            <span className="text-[10px] text-slate-500">
              {completedSteps}/{stepCount} 步
            </span>
          )}
          <span className="text-[10px] text-slate-600">{formatTime(task.createdAt)}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 opacity-0 transition group-hover:opacity-100">
        <button
          onClick={onDelete}
          className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-2 text-slate-500 transition hover:border-red-400/20 hover:bg-red-400/10 hover:text-red-400"
          title="删除"
        >
          <Trash2 size={13} />
        </button>
        <button
          onClick={onOpen}
          className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-2 text-slate-400 transition hover:border-white/[0.12] hover:bg-white/[0.06] hover:text-white"
          title="查看详情"
        >
          <ExternalLink size={13} />
        </button>
      </div>

      <button
        onClick={onOpen}
        className="mt-1 shrink-0 text-slate-600 transition hover:text-slate-300"
      >
        <ChevronRight size={15} />
      </button>
    </motion.div>
  );
}

export default function TaskHistoryView({ onOpenTask }: TaskHistoryViewProps) {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTasks = () => {
    setIsLoading(true);
    setError(null);
    apiClient.tasks.list()
      .then((list) => {
        setTasks(list.sort((a, b) => b.createdAt - a.createdAt));
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : '加载失败');
        setIsLoading(false);
      });
  };

  useEffect(() => {
    loadTasks();
  }, []);

  const handleDelete = async (taskId: string) => {
    try {
      await apiClient.tasks.delete(taskId);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } catch {
      // silent
    }
  };

  return (
    <div className="space-y-5">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Task History</p>
          <h3 className="mt-1 text-lg font-semibold text-white" style={{ fontFamily: 'var(--font-display)' }}>
            任务历史
          </h3>
        </div>
        <button
          onClick={loadTasks}
          disabled={isLoading}
          className="rounded-[14px] border border-white/[0.08] bg-white/[0.03] p-2.5 text-slate-400 transition hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-white disabled:opacity-50"
        >
          <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* 统计摘要 */}
      {!isLoading && tasks.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: '全部任务', value: tasks.length, color: 'text-slate-300' },
            { label: '已完成', value: tasks.filter((t) => t.status === 'completed').length, color: 'text-emerald-400' },
            { label: '执行中', value: tasks.filter((t) => t.status === 'running' || t.status === 'planning').length, color: 'text-blue-400' },
          ].map((item) => (
            <div key={item.label} className="rounded-[16px] border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-center">
              <p className={`text-lg font-semibold ${item.color}`}>{item.value}</p>
              <p className="mt-0.5 text-[10px] text-slate-600">{item.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* 内容区域 */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={22} className="animate-spin text-slate-500" />
        </div>
      ) : error ? (
        <div className="rounded-[18px] border border-red-400/20 bg-red-400/10 px-4 py-4 text-sm text-red-200">
          {error}
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-[18px] border border-white/[0.06] bg-white/[0.02]">
            <Clock size={22} className="text-slate-500" />
          </div>
          <p className="text-sm text-slate-500">暂无任务记录</p>
          <p className="mt-1 text-xs text-slate-600">在 Team Builder 中执行任务后，历史记录将显示在这里</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          <AnimatePresence initial={false}>
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onOpen={() => onOpenTask(task.id)}
                onDelete={() => handleDelete(task.id)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
