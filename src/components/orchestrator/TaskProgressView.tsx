import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Clock, GitBranch, List, Loader2, LayoutGrid, X, Zap } from 'lucide-react';
import {
  apiClient,
  type StepStatus,
  type TaskExecutionEvent,
  type TaskRecord,
  type TaskStepRecord,
} from '../../lib/api-client';
import MarkdownArticle from '../MarkdownArticle';
import AgentActivityLog from './AgentActivityLog';
import TaskFlowView from './TaskFlowView';
import ResultAggregator from './ResultAggregator';

interface TaskProgressViewProps {
  taskId: string;
  onClose: () => void;
  onOpenTask?: (taskId: string) => void;
}

type TabKey = 'overview' | 'activity' | 'dag';

function statusColor(status: StepStatus): string {
  switch (status) {
    case 'pending': return 'text-slate-500 bg-slate-800/60 border-slate-700/40';
    case 'running': return 'text-blue-300 bg-blue-900/40 border-blue-400/25';
    case 'pending_approval': return 'text-amber-300 bg-amber-900/30 border-amber-400/25';
    case 'completed': return 'text-emerald-300 bg-emerald-900/30 border-emerald-400/25';
    case 'failed': return 'text-red-300 bg-red-900/30 border-red-400/25';
    case 'skipped': return 'text-slate-500 bg-slate-800/40 border-slate-700/30';
    default: return 'text-slate-500 bg-slate-800/60 border-slate-700/40';
  }
}

function StatusIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case 'pending':
      return <Clock size={14} className="text-slate-500" />;
    case 'running':
      return <Loader2 size={14} className="animate-spin text-blue-400" />;
    case 'pending_approval':
      return <AlertCircle size={14} className="text-amber-400" />;
    case 'completed':
      return <CheckCircle2 size={14} className="text-emerald-400" />;
    case 'failed':
      return <AlertCircle size={14} className="text-red-400" />;
    case 'skipped':
      return <ChevronRight size={14} className="text-slate-500" />;
    default:
      return <Clock size={14} className="text-slate-500" />;
  }
}

function StepCard({ step }: { step: TaskStepRecord }) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = Boolean(step.result ?? step.error);

  return (
    <div className={`rounded-[22px] border p-4 transition ${statusColor(step.status)}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          <StatusIcon status={step.status} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-white">{step.objective}</p>
            {hasContent && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="shrink-0 text-slate-400 transition hover:text-slate-200"
              >
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            )}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">{step.agentId}</p>
        </div>
      </div>

      <AnimatePresence>
        {expanded && hasContent && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="mt-3 rounded-[16px] border border-white/[0.06] bg-black/20 px-3.5 py-3 text-xs leading-6 text-slate-300">
              {step.result && <p className="whitespace-pre-wrap">{step.result}</p>}
              {step.error && <p className="text-red-300 whitespace-pre-wrap">{step.error}</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TaskProgressView({ taskId, onClose, onOpenTask }: TaskProgressViewProps) {
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [steps, setSteps] = useState<TaskStepRecord[]>([]);
  const [events, setEvents] = useState<TaskExecutionEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [approvalBusyStepId, setApprovalBusyStepId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [streamEpoch, setStreamEpoch] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const refreshTask = useCallback(async () => {
    const record = await apiClient.tasks.get(taskId);
    setTask(record);
    setSteps(record.steps ?? []);
  }, [taskId]);

  useEffect(() => {
    let isActive = true;

    setIsLoading(true);
    refreshTask().then(() => {
      if (!isActive) return;
      setIsLoading(false);
    }).catch((err: unknown) => {
      if (!isActive) return;
      setStreamError(err instanceof Error ? err.message : '加载任务失败');
      setIsLoading(false);
    });

    return () => {
      isActive = false;
    };
  }, [refreshTask]);

  useEffect(() => {
    let isActive = true;
    abortRef.current = new AbortController();

    const stream = async () => {
      try {
        for await (const event of apiClient.tasks.streamEvents(taskId, { signal: abortRef.current?.signal })) {
          if (!isActive) break;
          handleEvent(event);
          setEvents((prev) => [...prev, event]);
        }
      } catch (err) {
        if (!isActive) return;
        if (err instanceof Error && err.name !== 'AbortError') {
          setStreamError(err.message);
        }
      }
    };

    stream();

    return () => {
      isActive = false;
      abortRef.current?.abort();
    };
  }, [taskId, streamEpoch]);

  const handleEvent = (event: TaskExecutionEvent) => {
    setTask((prev) => {
      if (!prev) return prev;
      switch (event.type) {
        case 'task_started':
          return { ...prev, status: 'running', runVersion: event.runVersion ?? prev.runVersion };
        case 'task_completed':
          return {
            ...prev,
            status: 'completed',
            runVersion: event.runVersion ?? prev.runVersion,
            result: event.output ?? prev.result,
          };
        case 'task_failed':
          return {
            ...prev,
            status: 'failed',
            runVersion: event.runVersion ?? prev.runVersion,
            result: event.output ?? prev.result,
            error: event.error ?? prev.error,
          };
        default:
          return prev;
      }
    });

    const stepId = event.stepId;
    if (stepId) {
      setSteps((prev) => {
        const existing = prev.find((s) => s.id === stepId);
        const updated: TaskStepRecord = existing
          ? { ...existing }
          : {
            id: stepId,
            runVersion: event.runVersion,
            agentId: event.agentId ?? 'unknown',
            status: 'pending',
            objective: stepId,
          };
        if (event.type === 'step_started') {
          updated.status = 'running';
          updated.startedAt = event.timestamp;
        } else if (event.type === 'step_waiting') {
          updated.status = 'pending_approval';
          updated.result = event.output;
          updated.startedAt = event.timestamp;
        } else if (event.type === 'step_completed') {
          updated.status = 'completed';
          updated.result = event.output;
          updated.completedAt = event.timestamp;
        } else if (event.type === 'step_skipped') {
          updated.status = 'skipped';
          updated.result = event.output;
          updated.completedAt = event.timestamp;
        } else if (event.type === 'step_failed') {
          updated.status = 'failed';
          updated.error = event.error;
          updated.completedAt = event.timestamp;
        }
        if (!existing) {
          return [...prev, updated];
        }
        return prev.map((s) => (s.id === stepId ? updated : s));
      });
    }

    // Auto-switch to result view when task finishes
    if (event.type === 'task_completed' || event.type === 'task_failed') {
      setActiveTab('overview');
      void refreshTask().catch(() => undefined);
    }
  };

  const handleGateDecision = async (stepId: string, action: 'approve' | 'reject') => {
    setApprovalBusyStepId(stepId);
    setStreamError(null);
    try {
      if (action === 'approve') {
        await apiClient.tasks.approveStep(taskId, stepId);
      } else {
        await apiClient.tasks.rejectStep(taskId, stepId);
      }
    } catch (err) {
      setStreamError(err instanceof Error ? err.message : '审批操作失败');
    } finally {
      setApprovalBusyStepId(null);
    }
  };

  const handleReplay = async () => {
    if (!task?.pipelineId || !onOpenTask) {
      return;
    }

    setStreamError(null);
    try {
      const response = await apiClient.pipelines.run(task.pipelineId, {
        objective: task.objective,
      });
      onOpenTask(response.id);
    } catch (err) {
      setStreamError(err instanceof Error ? err.message : '重新运行 Pipeline 失败');
    }
  };

  const handleContinueTask = async (message: string) => {
    setStreamError(null);
    await apiClient.tasks.continueTask(taskId, message);
    setEvents((prev) => prev.slice(-30));
    await refreshTask();
    setActiveTab('overview');
    setStreamEpoch((prev) => prev + 1);
  };

  const handleFollowupChat = async (message: string): Promise<string> => {
    setStreamError(null);
    let output = '';
    for await (const chunk of apiClient.tasks.chat(taskId, message)) {
      if (chunk.error) {
        throw new Error(chunk.error);
      }
      output += chunk.delta;
    }
    await refreshTask();
    return output;
  };

  const taskStatusLabel = (status: string) => {
    switch (status) {
      case 'pending': return '等待中';
      case 'planning': return '规划中';
      case 'running': return '执行中';
      case 'completed': return '已完成';
      case 'failed': return '执行失败';
      default: return status;
    }
  };

  const taskStatusStyle = (status: string) => {
    switch (status) {
      case 'completed': return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300';
      case 'failed': return 'border-red-400/20 bg-red-400/10 text-red-300';
      case 'running': return 'border-blue-400/20 bg-blue-400/10 text-blue-300';
      default: return 'border-white/10 bg-white/[0.03] text-slate-400';
    }
  };

  const isFinished = task?.status === 'completed' || task?.status === 'failed';

  const tabs: Array<{ key: TabKey; label: string; icon: React.ReactNode; hidden?: boolean }> = [
    { key: 'overview', label: '概览', icon: <LayoutGrid size={13} /> },
    { key: 'activity', label: '活动日志', icon: <List size={13} /> },
    { key: 'dag', label: 'DAG 视图', icon: <GitBranch size={13} />, hidden: !task?.plan },
  ];

  return (
    <AnimatePresence>
      <>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 bg-slate-950/55 backdrop-blur-sm"
          onClick={onClose}
        />

        <motion.aside
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 40 }}
          transition={{ duration: 0.22 }}
          className="panel-surface-strong fixed right-0 top-0 z-50 flex h-screen w-full max-w-[680px] flex-col border-l border-white/10 bg-[#06101d]/96 shadow-[-24px_0_80px_rgba(2,6,23,0.45)] backdrop-blur-xl"
          style={{ paddingTop: 'env(titlebar-area-height, 0px)' }}
        >
          {/* 顶部标题 */}
          <div className="panel-grid flex items-center justify-between border-b border-white/10 px-6 py-5">
            <div>
              <div className="flex items-center gap-2">
                <span className="instrument-tag rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.22em]">
                  Task Execution
                </span>
                {task && (
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${taskStatusStyle(task.status)}`}>
                    {taskStatusLabel(task.status)}
                  </span>
                )}
              </div>
              <h2
                className="mt-2 text-2xl font-semibold text-white"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                任务进度
              </h2>
            </div>
            <button
              onClick={onClose}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-slate-300 transition hover:border-white/16 hover:bg-white/[0.06] hover:text-white"
            >
              <X size={18} />
            </button>
          </div>

          {/* Tab 导航 */}
          {task && !isLoading && (
            <div className="flex items-center gap-1 border-b border-white/[0.06] px-6 py-2">
              {tabs.filter((t) => !t.hidden).map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium transition ${
                    activeTab === tab.key
                      ? 'bg-white/[0.08] text-white border border-white/10'
                      : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>
          )}

          {/* 内容区域 */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 size={24} className="animate-spin text-slate-500" />
              </div>
            ) : streamError && !task ? (
              <div className="rounded-[20px] border border-red-400/20 bg-red-400/10 px-4 py-4 text-sm text-red-200">
                {streamError}
              </div>
            ) : task ? (
              <AnimatePresence mode="wait">
                {/* 概览标签 */}
                {activeTab === 'overview' && (
                  <motion.div
                    key="overview"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.18 }}
                    className="space-y-6"
                  >
                    {/* 任务完成后显示 ResultAggregator */}
                    {isFinished ? (
                      <ResultAggregator
                        task={{ ...task, steps }}
                        onClose={onClose}
                        onContinue={handleContinueTask}
                        onChat={handleFollowupChat}
                        onReplay={task.kind === 'pipeline' && task.pipelineId ? () => void handleReplay() : undefined}
                        replayLabel="重新运行 Pipeline"
                      />
                    ) : (
                      <>
                        {/* 任务目标 */}
                        <section className="panel-surface rounded-[26px] p-5">
                          <p className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-500">任务目标</p>
                          <p className="text-sm leading-7 text-slate-200">{task.objective}</p>
                          <p className="mt-2 text-[11px] text-slate-600">Task ID: {task.id}</p>
                        </section>

                        {/* 计划摘要 */}
                        {task.plan && (
                          <section className="panel-surface rounded-[26px] p-5">
                            <p className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-500">执行计划</p>
                            <p className="text-sm leading-7 text-slate-300">{task.plan.summary}</p>
                          </section>
                        )}

                        {/* 步骤列表 */}
                        {steps.length > 0 && (
                          <section>
                            <p className="mb-3 text-xs uppercase tracking-[0.2em] text-slate-500">
                              执行步骤 · {steps.length} 步
                            </p>
                            <div className="space-y-3">
                              {steps.map((step) => (
                                <div key={step.id} className="space-y-2">
                                  <StepCard step={step} />
                                  {task.kind === 'pipeline' && step.status === 'pending_approval' && (
                                    <div className="flex gap-2 rounded-[18px] border border-amber-400/16 bg-amber-400/[0.06] px-4 py-3">
                                      <button
                                        onClick={() => void handleGateDecision(step.id, 'approve')}
                                        disabled={approvalBusyStepId === step.id}
                                        className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-xs text-emerald-100 transition hover:bg-emerald-400/16 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        {approvalBusyStepId === step.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                                        批准
                                      </button>
                                      <button
                                        onClick={() => void handleGateDecision(step.id, 'reject')}
                                        disabled={approvalBusyStepId === step.id}
                                        className="inline-flex items-center gap-2 rounded-full border border-red-400/20 bg-red-400/10 px-4 py-2 text-xs text-red-100 transition hover:bg-red-400/16 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        {approvalBusyStepId === step.id ? <Loader2 size={12} className="animate-spin" /> : <AlertCircle size={12} />}
                                        拒绝
                                      </button>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </section>
                        )}

                        {/* 运行中的状态提示 */}
                        {(task.status === 'running' || task.status === 'planning') && (
                          <div className="flex items-center gap-3 rounded-[18px] border border-blue-400/16 bg-blue-400/8 px-4 py-3 text-sm text-blue-200">
                            <Zap size={14} className="shrink-0 text-blue-400" />
                            {task.status === 'planning' ? '正在规划执行方案…' : '任务正在执行中，实时接收进展…'}
                          </div>
                        )}

                        {streamError && (
                          <div className="rounded-[18px] border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-xs text-amber-200">
                            SSE 连接中断：{streamError}
                          </div>
                        )}
                      </>
                    )}
                  </motion.div>
                )}

                {/* 活动日志标签 */}
                {activeTab === 'activity' && (
                  <motion.div
                    key="activity"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.18 }}
                    className="max-h-[500px] overflow-y-auto"
                  >
                    <AgentActivityLog
                      taskId={taskId}
                      steps={steps}
                      events={events}
                    />
                  </motion.div>
                )}

                {/* DAG 视图标签 */}
                {activeTab === 'dag' && task.plan && (
                  <motion.div
                    key="dag"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.18 }}
                  >
                    <TaskFlowView plan={task.plan} steps={steps} />
                  </motion.div>
                )}
              </AnimatePresence>
            ) : null}
          </div>

          {/* 底部按钮（仅在非完成状态下显示） */}
          {!isFinished && (
            <div className="border-t border-white/[0.06] px-6 py-5">
              <button
                onClick={onClose}
                className="interactive-lift w-full rounded-full border border-white/[0.08] bg-white/[0.03] px-6 py-3 text-sm font-medium text-slate-300 transition hover:border-white/[0.14] hover:bg-white/[0.06] hover:text-white"
              >
                关闭
              </button>
            </div>
          )}
        </motion.aside>
      </>
    </AnimatePresence>
  );
}

export default TaskProgressView;
