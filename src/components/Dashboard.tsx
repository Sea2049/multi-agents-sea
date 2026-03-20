import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, LayoutGrid, Sparkles, Target, Users } from 'lucide-react';
import AgentCard from './AgentCard';
import type { Agent, Division } from '../data/agents';

interface DashboardProps {
  divisions: Division[];
  onSelectDivision: (division: Division) => void;
  onOpenTeamBuilder: () => void;
  onAddToTeam: (agent: Agent) => void;
  onSelectAgent: (agent: Agent) => void;
  teamMembers: Agent[];
}

const cardVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
};

function hotnessScore(agent: Agent, division: Division) {
  const normalizedName = agent.name.toLowerCase();
  const normalizedDescription = agent.description.toLowerCase();

  let score = division.agents.length * 2;

  if (!agent.subDivision) score += 8;
  if (/(manager|architect|reviewer|designer|developer|engineer|strategist|orchestrator)/.test(normalizedName)) {
    score += 14;
  }
  if (/(system|platform|workflow|product|frontend|backend|design|growth|quality|security)/.test(normalizedDescription)) {
    score += 8;
  }
  if (/(product manager|frontend developer|backend architect|ui designer|code reviewer|growth hacker|agents orchestrator)/.test(normalizedName)) {
    score += 20;
  }

  return score;
}

function Dashboard({
  divisions,
  onSelectDivision,
  onOpenTeamBuilder,
  onAddToTeam,
  onSelectAgent,
  teamMembers,
}: DashboardProps) {
  const totalAgents = useMemo(
    () => divisions.reduce((sum, division) => sum + division.agents.length, 0),
    [divisions]
  );

  const teamIds = useMemo(() => new Set(teamMembers.map((agent) => agent.id)), [teamMembers]);

  const teamDivisionCoverage = useMemo(
    () => new Set(teamMembers.map((agent) => agent.division)).size,
    [teamMembers]
  );

  const topDivisions = useMemo(
    () =>
      [...divisions]
        .filter((division) => division.agents.length > 0)
        .sort((a, b) => b.agents.length - a.agents.length)
        .slice(0, 4),
    [divisions]
  );

  const hotAgents = useMemo(
    () =>
      divisions
        .flatMap((division) =>
          division.agents.map((agent) => ({
            agent,
            division,
            score: hotnessScore(agent, division),
          }))
        )
        .sort((a, b) => b.score - a.score)
        .slice(0, 6),
    [divisions]
  );

  const stats = [
    { label: '总 Agents', value: totalAgents, icon: Users, color: '#8bd7ff' },
    { label: '在线部门', value: divisions.filter((division) => division.agents.length > 0).length, icon: LayoutGrid, color: '#aab6ff' },
    { label: '已编组成员', value: teamMembers.length, icon: Sparkles, color: '#88f0d0' },
    { label: '团队覆盖', value: teamDivisionCoverage, icon: Target, color: '#e8f1ff' },
  ];

  const quickEntries = [
    {
      title: '产品到交付闭环',
      description: '先看产品部，再补工程部与测试部，形成可落地的最小执行链。',
      detail: 'Discovery -> Build -> Verify',
      onClick: () => onSelectDivision(divisions.find((division) => division.id === 'product') ?? divisions[0]),
    },
    {
      title: '界面与实现联动',
      description: '优先进入设计部，再联动工程部，适合 UI 方案与前端实现协作。',
      detail: 'Design -> Frontend',
      onClick: () => onSelectDivision(divisions.find((division) => division.id === 'design') ?? divisions[0]),
    },
    {
      title: '增长信号捕捉',
      description: '直达市场部，快速筛选 SEO、社媒、增长与内容能力节点。',
      detail: 'Content -> Growth -> Distribution',
      onClick: () => onSelectDivision(divisions.find((division) => division.id === 'marketing') ?? divisions[0]),
    },
    {
      title: '进入编组台',
      description: '查看当前团队、补齐缺口并生成摘要，是最常用的收口入口。',
      detail: 'Assemble -> Review',
      onClick: onOpenTeamBuilder,
    },
  ];

  return (
    <div className="space-y-8">
      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="panel-surface-strong panel-grid network-shell rounded-[32px] p-7">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(141,215,255,0.14),transparent_0_24%),linear-gradient(140deg,rgba(255,255,255,0.04),transparent_36%,rgba(2,6,23,0.14)_100%)]" />
          <div className="relative">
            <div className="instrument-tag inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs uppercase tracking-[0.22em]">
            <Sparkles size={13} />
            Command Overview
            </div>
            <div className="mt-5 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-2xl">
                <h3
                  className="text-4xl font-semibold tracking-[0.03em] text-white"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  多节点 Agent 集群总览
                </h3>
                <p className="mt-4 text-sm leading-7 text-slate-300">
                  Dashboard 现在更像一块旗舰级控制台: 用密度、覆盖与高频角色快速判断当前资源结构，再进入对应 division 精细挑选成员。
                </p>
              </div>

              <div className="rounded-[24px] border border-white/[0.08] bg-black/20 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Primary Density</p>
                <p className="mt-3 text-2xl font-semibold text-white">
                  {topDivisions[0]?.nameZh ?? '暂无'}
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  {topDivisions[0]?.agents.length ?? 0} 名高密度 Agent
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                onClick={() => onSelectDivision(topDivisions[0] ?? divisions[0])}
                className="interactive-lift inline-flex items-center gap-2 rounded-full border border-cyan-200/18 bg-[linear-gradient(180deg,rgba(141,215,255,0.16),rgba(141,215,255,0.06))] px-4 py-2.5 text-sm font-medium text-cyan-50"
              >
                打开热门部门
                <ArrowRight size={15} />
              </button>
              <button
                onClick={onOpenTeamBuilder}
                className="interactive-lift inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-slate-200 hover:border-white/[0.14] hover:bg-white/[0.06]"
              >
                进入 Team Builder
              </button>
            </div>

            <div className="mt-7 grid gap-3 sm:grid-cols-3">
              <div className="rounded-[22px] border border-white/[0.08] bg-white/[0.03] px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Network Reach</p>
                <p className="mt-3 text-2xl font-semibold text-white">{totalAgents}</p>
                <p className="mt-1 text-sm text-slate-400">已接入可调度专家</p>
              </div>
              <div className="rounded-[22px] border border-white/[0.08] bg-white/[0.03] px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Team Coverage</p>
                <p className="mt-3 text-2xl font-semibold text-white">{teamDivisionCoverage}</p>
                <p className="mt-1 text-sm text-slate-400">当前团队覆盖部门</p>
              </div>
              <div className="rounded-[22px] border border-white/[0.08] bg-white/[0.03] px-4 py-4">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Hot Pool</p>
                <p className="mt-3 text-2xl font-semibold text-white">{hotAgents.length}</p>
                <p className="mt-1 text-sm text-slate-400">高优先级推荐角色</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="panel-surface soft-ring rounded-[24px] p-5"
            >
              <div
                className="flex h-11 w-11 items-center justify-center rounded-2xl border"
                style={{ backgroundColor: `${stat.color}16`, borderColor: `${stat.color}24` }}
              >
                <stat.icon size={19} style={{ color: stat.color }} />
              </div>
              <p className="mt-5 text-3xl font-semibold text-white">{stat.value}</p>
              <p className="mt-1 text-sm text-slate-400">{stat.label}</p>
              <div className="mt-4 h-px bg-[linear-gradient(90deg,rgba(255,255,255,0.14),transparent)]" />
            </div>
          ))}
        </div>
      </section>

      <section className="panel-surface rounded-[30px] p-6">
        <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-slate-400">
              <Sparkles size={12} />
              Hot Agents
            </div>
            <h3 className="text-xl font-semibold text-white">热门 Agent</h3>
            <p className="text-sm text-slate-400">
              基于角色通用度、部门规模与跨职能价值自动排序，优先展示适合作为枢纽节点的角色。
            </p>
          </div>
          <button
            onClick={onOpenTeamBuilder}
            className="interactive-lift inline-flex items-center gap-2 self-start rounded-full border border-white/[0.08] px-3.5 py-2 text-sm text-slate-300 hover:border-white/[0.16] hover:bg-white/[0.05] hover:text-white"
          >
            查看已选团队
            <ArrowRight size={14} />
          </button>
        </div>

        <motion.div
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
          initial="hidden"
          animate="visible"
          variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.05 } } }}
        >
          {hotAgents.map(({ agent, division }) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              divisionColor={division.color}
              divisionLabel={division.nameZh}
              isInTeam={teamIds.has(agent.id)}
              onSelect={onSelectAgent}
              onToggleTeam={onAddToTeam}
            />
          ))}
        </motion.div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="panel-surface rounded-[30px] p-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <div className="mb-2 inline-flex rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-slate-400">
                Division Intel
              </div>
              <h3 className="text-xl font-semibold text-white">部门情报</h3>
              <p className="text-sm text-slate-400">优先浏览 Agent 最密集的 division。</p>
            </div>
            <span className="text-xs uppercase tracking-[0.22em] text-slate-600">
              Top 4
            </span>
          </div>

          <div className="space-y-3">
            {topDivisions.map((division, index) => (
              <motion.button
                key={division.id}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                onClick={() => onSelectDivision(division)}
                className="interactive-lift flex w-full items-center gap-4 rounded-[24px] border border-white/[0.08] bg-black/20 px-4 py-4 text-left hover:border-white/[0.16] hover:bg-white/[0.05]"
              >
                <div
                  className="flex h-11 w-11 items-center justify-center rounded-2xl border text-lg"
                  style={{ backgroundColor: `${division.color}18`, borderColor: `${division.color}22` }}
                >
                  {division.emoji}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white">
                    #{index + 1} {division.nameZh}
                  </p>
                  <p className="truncate text-xs text-slate-500">{division.name}</p>
                </div>
                <span
                  className="rounded-full border px-2.5 py-1 text-xs font-semibold"
                  style={{ backgroundColor: `${division.color}16`, borderColor: `${division.color}24`, color: division.color }}
                >
                  {division.agents.length}
                </span>
              </motion.button>
            ))}
          </div>
        </div>

        <div className="panel-surface rounded-[30px] p-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <div className="mb-2 inline-flex rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-slate-400">
                Quick Access
              </div>
              <h3 className="text-xl font-semibold text-white">快速入口</h3>
              <p className="text-sm text-slate-400">按常见工作流直接跳转。</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {quickEntries.map((entry) => (
              <button
                key={entry.title}
                onClick={entry.onClick}
                className="interactive-lift rounded-[24px] border border-white/[0.08] bg-black/20 p-4 text-left hover:border-white/[0.16] hover:bg-white/[0.05]"
              >
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-sm font-semibold text-white">{entry.title}</h4>
                  <ArrowRight size={15} className="text-slate-500" />
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-400">{entry.description}</p>
                <p className="mt-4 text-[11px] uppercase tracking-[0.2em] text-slate-500">{entry.detail}</p>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

export default Dashboard;
