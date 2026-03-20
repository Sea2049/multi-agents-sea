import { useMemo, useState, type DragEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, GripVertical, Minus, Sparkles, Users, Wand2, X, Zap } from 'lucide-react';
import type { Agent, Division } from '../data/agents';

interface TeamBuilderProps {
  teamMembers: Agent[];
  onAddToTeam: (agent: Agent) => void;
  onRemoveFromTeam: (agent: Agent) => void;
  onInspectAgent: (agent: Agent) => void;
  onReorderTeam: (draggedId: string, targetId: string | null) => void;
  onClearTeam: () => void;
  onGoToDivision: (divisionId: string) => void;
  divisions: Division[];
  onExecuteTask?: () => void;
}

function TeamBuilder({
  teamMembers,
  onAddToTeam,
  onRemoveFromTeam,
  onInspectAgent,
  onReorderTeam,
  onClearTeam,
  onGoToDivision,
  divisions,
  onExecuteTask,
}: TeamBuilderProps) {
  const [draggedAgent, setDraggedAgent] = useState<Agent | null>(null);
  const [dragOrigin, setDragOrigin] = useState<'team' | 'recommendation' | null>(null);
  const [isDropActive, setIsDropActive] = useState(false);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const divisionStats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const agent of teamMembers) {
      counts.set(agent.division, (counts.get(agent.division) || 0) + 1);
    }
    return divisions
      .filter((d) => counts.has(d.id))
      .map((d) => ({ ...d, count: counts.get(d.id)! }))
      .sort((a, b) => b.count - a.count || a.nameZh.localeCompare(b.nameZh));
  }, [teamMembers, divisions]);

  const teamIds = useMemo(() => new Set(teamMembers.map((member) => member.id)), [teamMembers]);

  const dominantDivision = divisionStats[0] ?? null;

  const recommendationPool = useMemo(() => {
    const byId = new Map(
      divisions.flatMap((division) => division.agents.map((agent) => [agent.id, agent] as const))
    );
    const coveredDivisions = new Set(teamMembers.map((agent) => agent.division));

    const recommendationIds = [
      !coveredDivisions.has('product') ? 'product-manager' : null,
      !coveredDivisions.has('engineering') ? 'engineering-frontend-developer' : null,
      coveredDivisions.has('engineering') && !coveredDivisions.has('design') ? 'design-ui-designer' : null,
      teamMembers.length >= 2 && !coveredDivisions.has('testing') ? 'testing-evidence-collector' : null,
      teamMembers.length >= 3 && !coveredDivisions.has('project-management') ? 'project-manager-senior' : null,
      teamMembers.length >= 4 && !coveredDivisions.has('marketing') ? 'marketing-growth-hacker' : null,
    ]
      .filter((id): id is string => Boolean(id))
      .map((id) => byId.get(id))
      .filter((agent): agent is Agent => Boolean(agent))
      .filter((agent) => !teamIds.has(agent.id));

    return recommendationIds.slice(0, 4);
  }, [divisions, teamIds, teamMembers]);

  const summary = useMemo(() => {
    if (teamMembers.length === 0) {
      return {
        posture: '待命',
        description: '当前还没有成员，适合先从产品、工程、设计或测试中拉起一个最小作战单元。',
        capabilities: ['建议先补一个负责定义任务的人，再补执行与验证角色。'],
      };
    }

    const coveredDivisions = new Set(teamMembers.map((agent) => agent.division));
    const capabilities: string[] = [];

    if (coveredDivisions.has('product') && coveredDivisions.has('engineering')) {
      capabilities.push('已具备从需求到实现的推进链路。');
    }
    if (coveredDivisions.has('engineering') && coveredDivisions.has('design')) {
      capabilities.push('具备界面体验与工程落地的协同能力。');
    }
    if (coveredDivisions.has('testing')) {
      capabilities.push('已经纳入质量验证角色，适合做交付前收口。');
    }
    if (coveredDivisions.has('marketing') || coveredDivisions.has('sales') || coveredDivisions.has('support')) {
      capabilities.push('团队具备外部增长、客户反馈或运营感知能力。');
    }
    if (capabilities.length === 0) {
      capabilities.push('目前更像一支专业纵深队伍，适合单点突破。');
    }

    const posture =
      teamMembers.length <= 2
        ? '轻量突击队'
        : teamMembers.length <= 5
          ? '跨职能小队'
          : '完整战术编组';

    const description = dominantDivision
      ? `当前以 ${dominantDivision.nameZh} 为主轴，覆盖 ${divisionStats.length} 个部门，适合继续补齐缺失环节。`
      : `当前已覆盖 ${divisionStats.length} 个部门。`;

    return { posture, description, capabilities };
  }, [divisionStats, dominantDivision, teamMembers]);

  const compositionScore = useMemo(() => {
    const raw = teamMembers.length * 14 + divisionStats.length * 18 + summary.capabilities.length * 12;
    return Math.min(100, raw);
  }, [divisionStats.length, summary.capabilities.length, teamMembers.length]);

  const dragDescriptor = useMemo(() => {
    if (!draggedAgent || !dragOrigin) return null;
    return dragOrigin === 'recommendation'
      ? `准备将 ${draggedAgent.name} 投放到团队编组中`
      : `正在调整 ${draggedAgent.name} 的团队顺序`;
  }, [dragOrigin, draggedAgent]);

  const resetDragState = () => {
    setDraggedAgent(null);
    setDragOrigin(null);
    setIsDropActive(false);
    setDropTargetId(null);
  };

  const handleRecommendationDragStart = (agent: Agent) => {
    setDraggedAgent(agent);
    setDragOrigin('recommendation');
    setDropTargetId(null);
  };

  const handleTeamDragStart = (agent: Agent) => {
    setDraggedAgent(agent);
    setDragOrigin('team');
    setDropTargetId(agent.id);
  };

  const handleTeamZoneDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDropActive(true);
    if (dragOrigin === 'recommendation') {
      setDropTargetId(null);
    }
  };

  const handleTeamZoneDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!draggedAgent || !dragOrigin) return;

    if (dragOrigin === 'recommendation' && !teamIds.has(draggedAgent.id)) {
      onAddToTeam(draggedAgent);
    }

    if (dragOrigin === 'team' && teamIds.has(draggedAgent.id)) {
      onReorderTeam(draggedAgent.id, null);
    }

    resetDragState();
  };

  const handleTeamItemDrop = (event: DragEvent<HTMLDivElement>, targetAgent: Agent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!draggedAgent || !dragOrigin) return;

    if (dragOrigin === 'team' && draggedAgent.id !== targetAgent.id) {
      onReorderTeam(draggedAgent.id, targetAgent.id);
    }

    if (dragOrigin === 'recommendation' && !teamIds.has(draggedAgent.id)) {
      onAddToTeam(draggedAgent);
    }

    resetDragState();
  };

  return (
    <div className="space-y-6">
      <motion.section
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="panel-surface-strong panel-grid network-shell rounded-[32px] p-6"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(136,240,208,0.14),transparent_0_24%),linear-gradient(140deg,rgba(255,255,255,0.04),transparent_36%,rgba(2,6,23,0.12)_100%)]" />
        <div className="relative">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="instrument-tag mb-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs uppercase tracking-[0.24em]">
                <Wand2 size={14} />
                <span>Team Builder</span>
              </div>
              <h1
                className="text-3xl font-semibold tracking-[0.03em] text-white"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {summary.posture}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">{summary.description}</p>
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="rounded-[22px] border border-white/[0.08] bg-black/20 px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Composition Score</p>
                <p className="mt-2 text-2xl font-semibold text-white">{compositionScore}</p>
              </div>
              {teamMembers.length >= 2 && onExecuteTask && (
                <button
                  onClick={onExecuteTask}
                  className="interactive-lift flex items-center gap-2 rounded-full border border-violet-400/20 bg-[linear-gradient(180deg,rgba(167,139,250,0.18),rgba(167,139,250,0.07))] px-4 py-2.5 text-sm font-medium text-violet-100 shadow-[0_8px_20px_rgba(0,0,0,0.18)] hover:border-violet-400/30 hover:bg-violet-400/20"
                >
                  <Zap size={15} />
                  执行任务
                </button>
              )}
              {teamMembers.length > 0 && (
                <button
                  onClick={onClearTeam}
                  className="interactive-lift inline-flex items-center gap-1.5 self-start rounded-full border border-red-400/18 bg-red-400/10 px-4 py-2.5 text-sm font-medium text-red-100 hover:bg-red-400/14"
                >
                  <X size={14} />
                  清空团队
                </button>
              )}
            </div>
          </div>

          {dragDescriptor && (
            <div className="mt-5 rounded-[20px] border border-emerald-200/18 bg-[linear-gradient(180deg,rgba(136,240,208,0.16),rgba(136,240,208,0.05))] px-4 py-3 text-sm text-emerald-50">
              {dragDescriptor}
            </div>
          )}

          <div className="mt-6 grid gap-4 md:grid-cols-3">
          <OverviewCard label="成员数" value={teamMembers.length} icon={Users} tone="emerald" />
          <OverviewCard label="覆盖部门" value={divisionStats.length} icon={Sparkles} tone="cyan" />
          <OverviewCard
            label="主导部门"
            value={dominantDivision?.count ?? 0}
            icon={Wand2}
            tone="violet"
            suffix={dominantDivision?.nameZh ?? '待定'}
          />
          </div>
        </div>
      </motion.section>

      <section className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
        <div className="panel-surface rounded-[30px] p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="mb-2 inline-flex rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-slate-400">
                Assembly Zone
              </div>
              <h3 className="text-xl font-semibold text-white">团队成员</h3>
              <p className="mt-1 text-xs text-slate-500">支持将右侧推荐角色拖入此处，也可拖动成员重排顺序。</p>
            </div>
            <span className="text-sm text-slate-500">{teamMembers.length} 名</span>
          </div>

          {teamMembers.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              onDragOver={handleTeamZoneDragOver}
              onDragLeave={() => {
                setIsDropActive(false);
                setDropTargetId(null);
              }}
              onDrop={handleTeamZoneDrop}
              className={`rounded-[26px] border border-dashed px-6 py-16 text-center transition ${
                isDropActive
                  ? 'border-emerald-200/26 bg-[linear-gradient(180deg,rgba(136,240,208,0.16),rgba(136,240,208,0.06))]'
                  : 'border-white/12 bg-black/20'
              }`}
            >
              <div className="text-5xl">👥</div>
              <p className="mt-4 text-sm text-slate-300">当前还没有任何成员</p>
              <p className="mt-2 text-sm text-slate-500">可以从右侧推荐列表直接补位，或返回 division 挑选。</p>
            </motion.div>
          ) : (
            <div
              className={`space-y-3 rounded-[26px] border border-dashed p-3 transition ${
                isDropActive ? 'border-emerald-200/26 bg-emerald-400/5' : 'border-white/[0.04]'
              }`}
              onDragOver={handleTeamZoneDragOver}
              onDragLeave={() => {
                setIsDropActive(false);
                setDropTargetId(null);
              }}
              onDrop={handleTeamZoneDrop}
            >
              <div className="flex items-center justify-between rounded-[20px] border border-white/[0.06] bg-black/20 px-4 py-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Drag Routing</p>
                  <p className="mt-1 text-sm text-slate-300">
                    将推荐角色拖入团队，或拖动现有成员改变执行顺序。
                  </p>
                </div>
                <div className="rounded-full border border-white/[0.08] px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-slate-500">
                  drop enabled
                </div>
              </div>
              <AnimatePresence mode="popLayout">
                {teamMembers.map((agent) => {
                  const division = divisions.find((item) => item.id === agent.division);
                  const color = division?.color || '#6366f1';
                  const isCurrentDrag = draggedAgent?.id === agent.id;
                  const isDropTarget = dropTargetId === agent.id && draggedAgent?.id !== agent.id;
                  return (
                    <motion.div
                      key={agent.id}
                      layout
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20, scale: 0.96 }}
                      draggable
                      onDragStart={() => handleTeamDragStart(agent)}
                      onDragEnd={resetDragState}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setDropTargetId(agent.id);
                        setIsDropActive(true);
                      }}
                      onDrop={(event) => handleTeamItemDrop(event, agent)}
                      className={`group flex cursor-grab items-center gap-4 rounded-[24px] border p-4 active:cursor-grabbing ${
                        isDropTarget
                          ? 'border-emerald-200/28 bg-[linear-gradient(180deg,rgba(136,240,208,0.12),rgba(136,240,208,0.04))]'
                          : 'border-white/[0.08] bg-black/20'
                      }`}
                      style={{
                        opacity: isCurrentDrag ? 0.72 : 1,
                        boxShadow: isDropTarget ? '0 18px 42px rgba(5, 12, 20, 0.32)' : undefined,
                      }}
                      onClick={() => onInspectAgent(agent)}
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-slate-500">
                        <GripVertical size={16} />
                      </div>
                      <div
                        className="h-11 w-11 shrink-0 rounded-2xl border text-center text-2xl leading-[42px]"
                        style={{
                          backgroundColor: `${color}18`,
                          borderColor: `${color}33`,
                        }}
                      >
                        {agent.emoji}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">{agent.name}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <button
                            onClick={(event) => {
                              event.stopPropagation();
                              if (division) onGoToDivision(division.id);
                            }}
                            className="rounded-full border border-white/[0.08] px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-white/[0.16] hover:bg-white/[0.05]"
                          >
                            {division?.nameZh || agent.division}
                          </button>
                          <span className="truncate text-[11px] text-slate-500">{agent.vibe}</span>
                        </div>
                      </div>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          onRemoveFromTeam(agent);
                        }}
                        className="rounded-full border border-red-400/20 bg-red-400/10 p-2 text-red-200 opacity-0 transition group-hover:opacity-100"
                      >
                        <Minus size={14} />
                      </button>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <section className="panel-surface rounded-[30px] p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="mb-2 inline-flex rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-slate-400">
                  Analysis Card
                </div>
                <h3 className="text-xl font-semibold text-white">团队摘要</h3>
              </div>
              <span className="text-xs uppercase tracking-[0.2em] text-slate-500">
                {summary.capabilities.length} 条能力
              </span>
            </div>
            <div className="rounded-[24px] border border-white/[0.08] bg-black/20 p-4">
              <p className="text-sm leading-7 text-slate-300">{summary.description}</p>
              <div className="mt-4 space-y-2">
                {summary.capabilities.map((line) => (
                  <div
                    key={line}
                    className="rounded-[18px] border border-white/[0.08] bg-white/[0.03] px-3.5 py-3 text-sm text-slate-300"
                  >
                    {line}
                  </div>
                ))}
              </div>
              <div className="mt-5 rounded-[18px] border border-white/[0.08] bg-white/[0.03] px-4 py-3">
                <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-slate-500">
                  <span>Cross-Functional Index</span>
                  <span>{compositionScore}%</span>
                </div>
                <div className="mt-3 h-2 rounded-full bg-white/[0.05]">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,rgba(227,239,247,0.8),rgba(136,240,208,0.9),rgba(139,215,255,0.86))]"
                    style={{ width: `${compositionScore}%` }}
                  />
                </div>
              </div>
            </div>

            {divisionStats.length > 0 && (
              <div className="mt-5">
                <p className="mb-3 text-sm font-medium text-slate-400">部门构成</p>
                <div className="flex flex-wrap gap-2">
                  {divisionStats.map((division) => (
                    <button
                      key={division.id}
                      onClick={() => onGoToDivision(division.id)}
                      className="interactive-lift inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-black/20 px-3 py-2 text-xs text-slate-300 hover:border-white/[0.16] hover:bg-white/[0.05]"
                    >
                      <span>{division.emoji}</span>
                      <span>{division.nameZh}</span>
                      <span
                        className="rounded-full px-1.5 py-0.5 font-semibold"
                        style={{ backgroundColor: `${division.color}22`, color: division.color }}
                      >
                        {division.count}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className="panel-surface rounded-[30px] p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="mb-2 inline-flex rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-slate-400">
                  Recommended Nodes
                </div>
                <h3 className="text-xl font-semibold text-white">建议补位</h3>
                <p className="text-sm text-slate-500">根据当前团队覆盖自动推荐。</p>
              </div>
              <span className="text-xs uppercase tracking-[0.2em] text-slate-600">
                {recommendationPool.length} 条
              </span>
            </div>

            {recommendationPool.length === 0 ? (
              <div className="mt-4 rounded-[24px] border border-dashed border-white/12 bg-black/20 p-5 text-sm text-slate-400">
                当前团队已具备较完整的跨职能覆盖，可以继续精细化补充垂直专家。
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {recommendationPool.map((agent) => {
                  const division = divisions.find((item) => item.id === agent.division);
                  const color = division?.color || '#6366f1';
                  return (
                    <div
                      key={agent.id}
                      draggable
                      onDragStart={() => handleRecommendationDragStart(agent)}
                      onDragEnd={resetDragState}
                      className={`rounded-[24px] border p-4 ${
                        draggedAgent?.id === agent.id
                          ? 'border-emerald-200/24 bg-[linear-gradient(180deg,rgba(136,240,208,0.14),rgba(136,240,208,0.05))]'
                          : 'border-white/[0.08] bg-black/20'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className="flex h-11 w-11 items-center justify-center rounded-2xl border text-xl"
                          style={{
                            backgroundColor: `${color}18`,
                            borderColor: `${color}33`,
                          }}
                        >
                          {agent.emoji}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-white">{agent.name}</p>
                          <p className="mt-1 text-xs text-slate-500">{division?.nameZh || agent.division}</p>
                          <p className="mt-2 text-sm leading-6 text-slate-400">{agent.vibe}</p>
                          <p className="mt-2 text-xs leading-5 text-slate-500">{agent.description}</p>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          onClick={() => onAddToTeam(agent)}
                          className="interactive-lift rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3.5 py-2 text-sm text-emerald-200 hover:bg-emerald-400/15"
                        >
                          加入团队
                        </button>
                        {division && (
                          <button
                            onClick={() => onGoToDivision(division.id)}
                            className="interactive-lift rounded-full border border-white/[0.08] px-3.5 py-2 text-sm text-slate-300 hover:border-white/[0.16] hover:bg-white/[0.05]"
                          >
                            查看部门
                          </button>
                        )}
                        <div className="ml-auto inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                          Drag to slot
                          <ArrowRight size={12} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

function OverviewCard({
  label,
  value,
  icon: Icon,
  tone,
  suffix,
}: {
  label: string;
  value: number;
  icon: typeof Users;
  tone: 'emerald' | 'cyan' | 'violet';
  suffix?: string;
}) {
  const tones = {
    emerald: '#34d399',
    cyan: '#38bdf8',
    violet: '#8b5cf6',
  } as const;

  const color = tones[tone];

  return (
    <div className="soft-ring rounded-[24px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.015))] p-4">
      <div
        className="flex h-11 w-11 items-center justify-center rounded-2xl border"
        style={{ backgroundColor: `${color}18`, borderColor: `${color}26` }}
      >
        <Icon size={18} style={{ color }} />
      </div>
      <p className="mt-4 text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <div className="mt-2 flex items-end gap-2">
        <p className="text-3xl font-semibold text-white">{value}</p>
        {suffix && <span className="pb-1 text-sm text-slate-400">{suffix}</span>}
      </div>
      <div className="mt-4 h-px bg-[linear-gradient(90deg,rgba(255,255,255,0.14),transparent)]" />
    </div>
  );
}

export default TeamBuilder;
