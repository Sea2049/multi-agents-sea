import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  Play,
  Wrench,
  Zap,
} from 'lucide-react';
import { type TaskExecutionEvent, type TaskStepRecord } from '../../lib/api-client';
import { divisions } from '../../data/agents';

interface AgentActivityLogProps {
  taskId: string;
  steps: TaskStepRecord[];
  events: TaskExecutionEvent[];
}

function getAgentInfo(agentId: string): { emoji: string; name: string } {
  for (const division of divisions) {
    const agent = division.agents.find((a) => a.id === agentId);
    if (agent) return { emoji: agent.emoji, name: agent.name };
  }
  return { emoji: '🤖', name: agentId };
}

function formatDuration(startMs?: number, endMs?: number): string {
  if (!startMs) return '';
  const end = endMs ?? Date.now();
  const diffMs = end - startMs;
  if (diffMs < 1000) return `${diffMs}ms`;
  if (diffMs < 60000) return `${(diffMs / 1000).toFixed(1)}s`;
  return `${Math.floor(diffMs / 60000)}m ${Math.floor((diffMs % 60000) / 1000)}s`;
}

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  if (diffMs < 5000) return '刚刚';
  if (diffMs < 60000) return `${Math.floor(diffMs / 1000)}秒前`;
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}分钟前`;
  return `${Math.floor(diffMs / 3600000)}小时前`;
}

type EventType = TaskExecutionEvent['type'];

function EventBadge({ type }: { type: EventType }) {
  const styles: Record<EventType, string> = {
    task_started: 'bg-blue-400/10 border-blue-400/20 text-blue-300',
    step_started: 'bg-indigo-400/10 border-indigo-400/20 text-indigo-300',
    step_waiting: 'bg-amber-400/10 border-amber-400/20 text-amber-300',
    step_completed: 'bg-emerald-400/10 border-emerald-400/20 text-emerald-300',
    step_skipped: 'bg-slate-400/10 border-slate-400/20 text-slate-300',
    step_failed: 'bg-red-400/10 border-red-400/20 text-red-300',
    task_completed: 'bg-emerald-400/10 border-emerald-400/20 text-emerald-300',
    task_failed: 'bg-red-400/10 border-red-400/20 text-red-300',
    tool_call_started: 'bg-yellow-400/10 border-yellow-400/20 text-yellow-300',
    tool_call_completed: 'bg-amber-400/10 border-amber-400/20 text-amber-300',
  };
  const labels: Record<EventType, string> = {
    task_started: '任务开始',
    step_started: '步骤开始',
    step_waiting: '等待审批',
    step_completed: '步骤完成',
    step_skipped: '步骤跳过',
    step_failed: '步骤失败',
    task_completed: '任务完成',
    task_failed: '任务失败',
    tool_call_started: '调用开始',
    tool_call_completed: '调用完成',
  };
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] ${styles[type]}`}>
      {labels[type]}
    </span>
  );
}

function EventIcon({ type }: { type: EventType }) {
  switch (type) {
    case 'task_started':
      return <Play size={13} className="text-blue-400" />;
    case 'step_started':
      return <Loader2 size={13} className="animate-spin text-indigo-400" />;
    case 'step_waiting':
      return <Clock size={13} className="text-amber-400" />;
    case 'step_completed':
      return <CheckCircle2 size={13} className="text-emerald-400" />;
    case 'step_skipped':
      return <ChevronRight size={13} className="text-slate-400" />;
    case 'step_failed':
      return <AlertCircle size={13} className="text-red-400" />;
    case 'task_completed':
      return <Zap size={13} className="text-emerald-400" />;
    case 'task_failed':
      return <AlertCircle size={13} className="text-red-400" />;
    case 'tool_call_started':
      return <Wrench size={13} className="text-yellow-400" />;
    case 'tool_call_completed':
      return <Wrench size={13} className="text-amber-400" />;
    default:
      return <Play size={13} className="text-slate-400" />;
  }
}

function StepDetailCard({ step }: { step: TaskStepRecord }) {
  const [expanded, setExpanded] = useState(false);
  const agentInfo = getAgentInfo(step.agentId);
  const duration = formatDuration(step.startedAt, step.completedAt);
  const hasOutput = Boolean(step.result || step.error);
  const outputPreview = (step.result ?? step.error ?? '').slice(0, 200);
  const needsExpand = (step.result ?? step.error ?? '').length > 200;
  const toneClass =
    step.status === 'failed'
      ? 'text-red-300/80'
      : step.status === 'pending_approval'
        ? 'text-amber-200/80'
        : step.status === 'skipped'
          ? 'text-slate-500'
          : 'text-slate-400';

  return (
    <div className="rounded-[18px] border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] border border-white/[0.08] bg-black/20 text-base">
          {agentInfo.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-medium text-slate-200">{agentInfo.name}</p>
            {duration && (
              <span className="flex items-center gap-1 text-[10px] text-slate-500">
                <Clock size={10} />
                {duration}
              </span>
            )}
            {step.tokenCount && (
              <span className="rounded border border-violet-400/20 bg-violet-400/10 px-1.5 py-0.5 text-[10px] text-violet-300">
                {step.tokenCount.toLocaleString()} tokens
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] leading-5 text-slate-400">{step.objective}</p>

          {hasOutput && (
            <div className="mt-2.5">
              <p className={`text-[11px] leading-5 ${step.error ? 'text-red-300/80' : toneClass} whitespace-pre-wrap`}>
                {outputPreview}
                {!expanded && needsExpand && <span className="text-slate-600">…</span>}
              </p>
              {!expanded && needsExpand && step.result && (
                <p className={`mt-1 text-[11px] leading-5 text-slate-400 whitespace-pre-wrap`}>
                  {/* full result shown when expanded */}
                </p>
              )}
              {expanded && needsExpand && (
                <p className={`text-[11px] leading-5 ${step.error ? 'text-red-300/80' : toneClass} whitespace-pre-wrap`}>
                  {(step.result ?? step.error ?? '').slice(200)}
                </p>
              )}
              {needsExpand && (
                <button
                  onClick={() => setExpanded((v) => !v)}
                  className="mt-1.5 flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 transition"
                >
                  {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  {expanded ? '收起' : '展开全文'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EventRow({ event, steps }: { event: TaskExecutionEvent; steps: TaskStepRecord[] }) {
  const relStep = event.stepId ? steps.find((s) => s.id === event.stepId) : null;
  const agentInfo = event.agentId ? getAgentInfo(event.agentId) : null;
  const isStepEvent =
    event.type === 'step_started' ||
    event.type === 'step_waiting' ||
    event.type === 'step_completed' ||
    event.type === 'step_skipped' ||
    event.type === 'step_failed';

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
      className="flex gap-3"
    >
      {/* timeline line + dot */}
      <div className="flex flex-col items-center">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-black/30">
          <EventIcon type={event.type} />
        </div>
        <div className="w-px flex-1 bg-white/[0.05] mt-1" />
      </div>

      <div className="min-w-0 flex-1 pb-4">
        <div className="flex flex-wrap items-center gap-2 mb-1.5">
          <EventBadge type={event.type} />
          {agentInfo && (
            <span className="text-[11px] text-slate-400">
              {agentInfo.emoji} {agentInfo.name}
            </span>
          )}
          <span className="ml-auto text-[10px] text-slate-600">
            {formatRelativeTime(event.timestamp)}
          </span>
        </div>

        {isStepEvent && relStep && (
          event.type === 'step_completed' || event.type === 'step_waiting' || event.type === 'step_skipped' || event.type === 'step_failed'
            ? <StepDetailCard step={relStep} />
            : <p className="text-[11px] text-slate-500 leading-5 truncate">{relStep.objective}</p>
        )}

        {(event.type === 'tool_call_started') && (
          <div className="rounded-[14px] border border-yellow-400/10 bg-yellow-400/[0.04] px-3 py-2">
            <p className="text-[11px] text-yellow-300/80 font-medium">
              🔧 {event.toolName}
            </p>
            {event.toolInput && Object.keys(event.toolInput).length > 0 && (
              <p className="mt-1 text-[10px] text-slate-500 font-mono truncate">
                {JSON.stringify(event.toolInput).slice(0, 120)}
              </p>
            )}
          </div>
        )}

        {(event.type === 'tool_call_completed') && (
          <div className={`rounded-[14px] border px-3 py-2 ${event.toolIsError ? 'border-red-400/10 bg-red-400/[0.04]' : 'border-emerald-400/10 bg-emerald-400/[0.04]'}`}>
            <p className={`text-[11px] font-medium ${event.toolIsError ? 'text-red-300/80' : 'text-emerald-300/80'}`}>
              {event.toolIsError ? '❌' : '✅'} {event.toolName}
            </p>
            {event.toolOutput && (
              <p className="mt-1 text-[10px] text-slate-500 font-mono truncate">
                {event.toolOutput.slice(0, 120)}
              </p>
            )}
          </div>
        )}

        {(event.type === 'task_completed' || event.type === 'task_failed') && (
          <p className={`text-[11px] leading-5 ${event.type === 'task_failed' ? 'text-red-300/80' : 'text-emerald-300/80'}`}>
            {event.type === 'task_completed' ? '所有步骤执行完成' : (event.error ?? '任务执行异常')}
          </p>
        )}
      </div>
    </motion.div>
  );
}

export default function AgentActivityLog({ steps, events }: AgentActivityLogProps) {
  const completedSteps = steps.filter((s) => s.status === 'completed').length;
  const failedSteps = steps.filter((s) => s.status === 'failed').length;
  const totalTokens = steps.reduce((sum, s) => sum + (s.tokenCount ?? 0), 0);
  const toolCallCount = events.filter(
    (event) => event.type === 'tool_call_started' || event.type === 'tool_call_completed'
  ).length;

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-[16px] border border-white/[0.06] bg-white/[0.02]">
          <Clock size={20} className="text-slate-500" />
        </div>
        <p className="text-sm text-slate-500">暂无活动记录</p>
        <p className="mt-1 text-xs text-slate-600">任务开始后将在这里实时记录执行日志</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 统计摘要 */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: '完成步骤', value: completedSteps, color: 'text-emerald-400' },
          { label: '失败步骤', value: failedSteps, color: 'text-red-400' },
          { label: 'Token 用量', value: totalTokens > 0 ? totalTokens.toLocaleString() : '—', color: 'text-violet-400' },
        ].map((item) => (
          <div key={item.label} className="rounded-[16px] border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-center">
            <p className={`text-sm font-semibold ${item.color}`}>{item.value}</p>
            <p className="mt-0.5 text-[10px] text-slate-600">{item.label}</p>
          </div>
        ))}
      </div>

      {toolCallCount > 0 && (
        <div className="rounded-[16px] border border-yellow-400/12 bg-yellow-400/[0.05] px-3.5 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-yellow-200">工具调用</p>
            <span className="text-[10px] text-yellow-300/70">{toolCallCount} 条事件</span>
          </div>
        </div>
      )}

      {/* 时间线 */}
      <div className="space-y-0">
        <AnimatePresence initial={false}>
          {events.map((event) => (
            <EventRow key={`${event.type}-${event.timestamp}-${event.stepId ?? ''}`} event={event} steps={steps} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
