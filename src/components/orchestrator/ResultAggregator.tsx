import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Coins,
  RefreshCw,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { type TaskRecord, type TaskStepRecord } from '../../lib/api-client';
import MarkdownArticle from '../MarkdownArticle';
import { divisions } from '../../data/agents';

interface ResultAggregatorProps {
  task: TaskRecord;
  onClose: () => void;
  onContinue?: (message: string) => Promise<void>;
  onChat?: (message: string) => Promise<string>;
  onReplay?: () => void;
  replayLabel?: string;
}

function getAgentInfo(agentId: string): { emoji: string; name: string } {
  for (const division of divisions) {
    const agent = division.agents.find((a) => a.id === agentId);
    if (agent) return { emoji: agent.emoji, name: agent.name };
  }
  return { emoji: '🤖', name: agentId };
}

function formatDuration(startMs?: number, endMs?: number): string {
  if (!startMs) return '—';
  const end = endMs ?? Date.now();
  const diffMs = end - startMs;
  if (diffMs < 1000) return `${diffMs}ms`;
  if (diffMs < 60000) return `${(diffMs / 1000).toFixed(1)}s`;
  return `${Math.floor(diffMs / 60000)}m ${Math.floor((diffMs % 60000) / 1000)}s`;
}

function StepResultItem({ step }: { step: TaskStepRecord }) {
  const [expanded, setExpanded] = useState(false);
  const agentInfo = getAgentInfo(step.agentId);
  const hasOutput = Boolean(step.result ?? step.error);
  const isSuccess = step.status === 'completed';
  const isSkipped = step.status === 'skipped';
  const isWaiting = step.status === 'pending_approval';
  const containerClass = isSuccess
    ? 'border-emerald-400/15 bg-emerald-900/10'
    : isSkipped
      ? 'border-slate-400/15 bg-slate-900/10'
      : isWaiting
        ? 'border-amber-400/15 bg-amber-900/10'
        : 'border-red-400/15 bg-red-900/10';

  return (
    <div className={`rounded-[16px] border p-3.5 ${containerClass}`}>
      <div className="flex items-start gap-3">
        <span className="text-base leading-none mt-0.5 shrink-0">{agentInfo.emoji}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium text-white truncate">{step.objective}</p>
            {hasOutput && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="shrink-0 text-slate-500 hover:text-slate-300 transition"
              >
                {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-[10px] text-slate-500">{agentInfo.name}</span>
            {step.tokenCount && (
              <span className="rounded border border-violet-400/20 bg-violet-400/10 px-1.5 py-0.5 text-[10px] text-violet-300">
                {step.tokenCount.toLocaleString()} tokens
              </span>
            )}
            {step.startedAt && (
              <span className="text-[10px] text-slate-600">
                {formatDuration(step.startedAt, step.completedAt)}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0">
          {isSuccess
            ? <CheckCircle2 size={14} className="text-emerald-400" />
            : isSkipped
              ? <ChevronRight size={14} className="text-slate-400" />
              : isWaiting
                ? <Clock size={14} className="text-amber-400" />
                : <AlertCircle size={14} className="text-red-400" />}
        </div>
      </div>

      <AnimatePresence>
        {expanded && hasOutput && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="mt-3 rounded-[12px] border border-white/[0.05] bg-black/20 px-3 py-2.5 space-y-2.5">
              {step.summary && (
                <div>
                  <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">摘要</p>
                  <p className="text-[11px] leading-5 text-slate-300 whitespace-pre-wrap">{step.summary}</p>
                </div>
              )}
              {step.result && (
                <div>
                  {step.summary && (
                    <p className="mb-1 text-[10px] uppercase tracking-[0.14em] text-slate-500">完整输出</p>
                  )}
                  <p className="text-[11px] leading-5 text-slate-400 whitespace-pre-wrap">{step.result}</p>
                </div>
              )}
              {step.error && (
                <p className="text-[11px] leading-5 text-red-300/80 whitespace-pre-wrap">{step.error}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function ResultAggregator({
  task,
  onClose,
  onContinue,
  onChat,
  onReplay,
  replayLabel = '重新运行',
}: ResultAggregatorProps) {
  const [showSteps, setShowSteps] = useState(false);
  const [followupInput, setFollowupInput] = useState('');
  const [followupBusy, setFollowupBusy] = useState<'chat' | 'continue' | null>(null);
  const [followupError, setFollowupError] = useState<string | null>(null);
  const [latestReply, setLatestReply] = useState<string | null>(null);

  const steps = useMemo(() => task.steps ?? [], [task.steps]);

  const completedCount = steps.filter((s) => s.status === 'completed').length;
  const failedCount = steps.filter((s) => s.status === 'failed').length;
  const skippedCount = steps.filter((s) => s.status === 'skipped').length;
  const totalTokens = steps.reduce((sum, s) => sum + (s.tokenCount ?? 0), 0);

  const uniqueAgents = useMemo(
    () => new Set(steps.map((s) => s.agentId)).size,
    [steps]
  );

  const taskDuration = useMemo(() => {
    const firstStep = steps.find((s) => s.startedAt);
    const lastDone = steps.filter((s) => s.completedAt).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0];
    if (!firstStep?.startedAt) return '—';
    return formatDuration(firstStep.startedAt, lastDone?.completedAt);
  }, [steps]);

  const isSuccess = task.status === 'completed';
  const threadMessages = task.threadMessages ?? [];

  const handleFollowupAction = async (mode: 'chat' | 'continue') => {
    const message = followupInput.trim();
    if (!message) return;
    if (mode === 'chat' && !onChat) return;
    if (mode === 'continue' && !onContinue) return;

    setFollowupBusy(mode);
    setFollowupError(null);
    try {
      if (mode === 'chat' && onChat) {
        const reply = await onChat(message);
        setLatestReply(reply.trim() || '（无输出）');
      } else if (mode === 'continue' && onContinue) {
        await onContinue(message);
        setLatestReply(null);
      }
      setFollowupInput('');
    } catch (err) {
      setFollowupError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setFollowupBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* 顶部状态标题 */}
      <div className={`rounded-[24px] border p-5 ${isSuccess ? 'border-emerald-400/20 bg-emerald-400/8' : 'border-red-400/20 bg-red-400/8'}`}>
        <div className="flex items-start gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] ${isSuccess ? 'bg-emerald-400/20' : 'bg-red-400/20'}`}>
            {isSuccess
              ? <CheckCircle2 size={20} className="text-emerald-400" />
              : <AlertCircle size={20} className="text-red-400" />}
          </div>
          <div>
            <p className={`text-sm font-semibold ${isSuccess ? 'text-emerald-300' : 'text-red-300'}`}>
              {isSuccess ? '任务执行完成' : '任务执行失败'}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-400 line-clamp-2">{task.objective}</p>
          </div>
        </div>

        {/* 统计网格 */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { icon: <Clock size={14} />, label: '耗时', value: taskDuration },
            { icon: <Users size={14} />, label: 'Agent 数', value: uniqueAgents },
            { icon: <Zap size={14} />, label: '步骤数', value: steps.length },
            { icon: <Coins size={14} />, label: 'Tokens', value: totalTokens > 0 ? totalTokens.toLocaleString() : '—' },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-[14px] border border-white/[0.06] bg-black/20 px-3 py-2.5 text-center"
            >
              <div className="flex items-center justify-center gap-1 text-slate-500 mb-1">
                {item.icon}
                <span className="text-[10px] uppercase tracking-[0.16em]">{item.label}</span>
              </div>
              <p className="text-sm font-semibold text-white">{item.value}</p>
            </div>
          ))}
        </div>

        {/* 成功/失败步骤统计 */}
        {steps.length > 0 && (
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1 rounded-full bg-black/30 h-1.5 overflow-hidden">
              <div
                className="h-full bg-emerald-400 rounded-full transition-all"
                style={{ width: `${steps.length > 0 ? (completedCount / steps.length) * 100 : 0}%` }}
              />
            </div>
            <span className="text-[10px] text-slate-500 shrink-0">
              {completedCount}/{steps.length} 成功
              {failedCount > 0 && ` · ${failedCount} 失败`}
              {skippedCount > 0 && ` · ${skippedCount} 跳过`}
            </span>
          </div>
        )}
      </div>

      {/* 错误详情 */}
      {!isSuccess && task.error && (
        <div className="rounded-[18px] border border-red-400/20 bg-red-400/8 px-4 py-3.5">
          <p className="mb-1.5 text-xs font-medium text-red-300">错误详情</p>
          <p className="text-xs leading-5 text-red-200/70 whitespace-pre-wrap">{task.error}</p>
        </div>
      )}

      {/* 最终报告 */}
      {task.result && (
        <section className="panel-surface rounded-[24px] p-5">
          <div className="mb-4 flex items-center gap-2">
            <Zap size={15} className={isSuccess ? 'text-emerald-400' : 'text-amber-300'} />
            <p className="text-sm font-medium text-slate-200">{isSuccess ? '最终报告' : '失败前产出 / 最终报告'}</p>
          </div>
          <div className="rounded-[16px] border border-white/[0.05] bg-black/20 px-4 py-4">
            <MarkdownArticle markdown={task.result} />
          </div>
        </section>
      )}

      {/* 后续互动 */}
      {(onChat || onContinue) && (
        <section className="panel-surface rounded-[24px] p-5 space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-200">后续互动</p>
            {task.runVersion && (
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-slate-400">
                Run v{task.runVersion}
              </span>
            )}
          </div>
          <textarea
            value={followupInput}
            onChange={(event) => setFollowupInput(event.target.value)}
            rows={3}
            placeholder="继续提问结果，或输入下一步执行指令..."
            className="w-full rounded-[14px] border border-white/[0.08] bg-black/20 px-3.5 py-3 text-sm text-slate-200 outline-none transition focus:border-blue-400/40"
          />
          {followupError && (
            <p className="rounded-[12px] border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-200">
              {followupError}
            </p>
          )}
          {latestReply && (
            <div className="rounded-[12px] border border-emerald-400/20 bg-emerald-400/10 px-3 py-2.5">
              <p className="mb-1 text-[10px] uppercase tracking-[0.16em] text-emerald-200/80">最新回复</p>
              <p className="text-xs leading-5 text-emerald-100/90 whitespace-pre-wrap">{latestReply}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {onChat && (
              <button
                onClick={() => void handleFollowupAction('chat')}
                disabled={followupBusy !== null || !followupInput.trim()}
                className="interactive-lift rounded-full border border-blue-400/20 bg-blue-400/10 px-4 py-2 text-xs font-medium text-blue-200 transition hover:border-blue-400/35 hover:bg-blue-400/18 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {followupBusy === 'chat' ? '正在回复...' : '继续聊天'}
              </button>
            )}
            {onContinue && (
              <button
                onClick={() => void handleFollowupAction('continue')}
                disabled={followupBusy !== null || !followupInput.trim()}
                className="interactive-lift rounded-full border border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs font-medium text-amber-200 transition hover:border-amber-400/35 hover:bg-amber-400/18 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {followupBusy === 'continue' ? '正在续跑...' : '继续执行'}
              </button>
            )}
          </div>
          {threadMessages.length > 0 && (
            <div className="rounded-[14px] border border-white/[0.06] bg-black/20 px-3 py-2.5 space-y-2 max-h-[220px] overflow-y-auto">
              {threadMessages.slice(-8).map((message) => (
                <div key={message.id} className="text-xs leading-5">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
                    {message.role} · {message.mode} · run v{message.runVersion}
                  </p>
                  <p className="text-slate-300 whitespace-pre-wrap">{message.content}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 步骤详情展开区域 */}
      {steps.length > 0 && (
        <section className="panel-surface rounded-[24px] p-5">
          <button
            onClick={() => setShowSteps((v) => !v)}
            className="flex w-full items-center justify-between text-left"
          >
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-slate-200">步骤详情</p>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-slate-400">
                {steps.length}
              </span>
            </div>
            {showSteps ? <ChevronDown size={15} className="text-slate-400" /> : <ChevronRight size={15} className="text-slate-400" />}
          </button>

          <AnimatePresence>
            {showSteps && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-4 space-y-2.5">
                  {steps.map((step) => (
                    <StepResultItem key={step.id} step={step} />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      )}

      {/* 操作按钮 */}
      <div className="flex gap-3">
        {onReplay && (
          <button
            onClick={onReplay}
            className="interactive-lift flex flex-1 items-center justify-center gap-2 rounded-full border border-blue-400/20 bg-blue-400/10 px-4 py-3 text-sm font-medium text-blue-200 transition hover:border-blue-400/35 hover:bg-blue-400/18"
          >
            <RefreshCw size={15} />
            {replayLabel}
          </button>
        )}
        <button
          onClick={onClose}
          className={`interactive-lift flex items-center justify-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm font-medium text-slate-300 transition hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-white ${onReplay ? 'flex-1' : 'w-full'}`}
        >
          <X size={15} />
          关闭
        </button>
      </div>
    </div>
  );
}
