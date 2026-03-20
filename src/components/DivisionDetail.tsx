import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, Layers3, Users } from 'lucide-react';
import AgentCard from './AgentCard';
import type { Agent, Division } from '../data/agents';

interface DivisionDetailProps {
  division: Division;
  onBack: () => void;
  onAddToTeam: (agent: Agent) => void;
  onSelectAgent: (agent: Agent) => void;
  teamMembers: Agent[];
}

const SUB_DIVISION_ORDER = [
  'cross-engine',
  'unity',
  'unreal-engine',
  'godot',
  'blender',
  'roblox-studio',
];

const SUB_DIVISION_LABELS: Record<string, string> = {
  'cross-engine': 'Cross-Engine',
  'unity': 'Unity',
  'unreal-engine': 'Unreal Engine',
  'godot': 'Godot',
  'blender': 'Blender',
  'roblox-studio': 'Roblox Studio',
};

function DivisionDetail({
  division,
  onBack,
  onAddToTeam,
  onSelectAgent,
  teamMembers,
}: DivisionDetailProps) {
  const teamIds = useMemo(() => new Set(teamMembers.map((a) => a.id)), [teamMembers]);
  const selectedInDivision = useMemo(
    () => teamMembers.filter((member) => member.division === division.id).length,
    [division.id, teamMembers]
  );

  const isGameDev = division.id === 'game-development';

  const grouped = useMemo(() => {
    if (!isGameDev) return null;
    const map = new Map<string, Agent[]>();
    for (const agent of division.agents) {
      const sub = agent.subDivision || 'other';
      if (!map.has(sub)) map.set(sub, []);
      map.get(sub)!.push(agent);
    }
    const orderedKeys = SUB_DIVISION_ORDER.filter((key) => map.has(key));
    const extraKeys = Array.from(map.keys()).filter((key) => !SUB_DIVISION_ORDER.includes(key));

    return [...orderedKeys, ...extraKeys].map((key) => ({
      key,
      label: SUB_DIVISION_LABELS[key] || key,
      agents: map.get(key)!,
    }));
  }, [division, isGameDev]);

  return (
    <div className="space-y-8">
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className="rounded-[30px] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.06),rgba(2,6,23,0.92))] p-6"
      >
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex items-start gap-4">
            <button
              onClick={onBack}
              className="mt-1 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-slate-300 transition hover:border-white/16 hover:bg-white/[0.06] hover:text-white"
            >
              <ArrowLeft size={18} />
            </button>

            <div className="flex items-start gap-4">
              <div
                className="flex h-16 w-16 items-center justify-center rounded-[24px] border text-3xl"
                style={{
                  backgroundColor: `${division.color}18`,
                  borderColor: `${division.color}33`,
                }}
              >
                {division.emoji}
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Division Detail</p>
                <h1
                  className="mt-2 text-3xl font-semibold text-white"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {division.nameZh}
                </h1>
                <p className="mt-1 text-sm text-slate-400">{division.name}</p>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
                  浏览当前部门全部 Agent，按卡片直接加入团队；游戏开发部门会自动按子领域分组展示。
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <StatBadge icon={Layers3} label="部门 Agent" value={division.agents.length} color={division.color} />
            <StatBadge icon={Users} label="已编组" value={selectedInDivision} color="#34d399" />
          </div>
        </div>
      </motion.div>

      {isGameDev && grouped ? (
        <div className="space-y-8">
          {grouped.map((group) => (
            <div key={group.key} className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
              <div className="mb-4 flex items-center gap-2">
                <div
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: division.color }}
                />
                <h3 className="text-sm font-semibold text-white">{group.label}</h3>
                <span className="text-xs text-slate-500">({group.agents.length})</span>
              </div>
              <motion.div
                className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
                initial="hidden"
                animate="visible"
                variants={{
                  hidden: {},
                  visible: { transition: { staggerChildren: 0.04 } },
                }}
              >
                {group.agents.map((agent) => (
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
            </div>
          ))}
        </div>
      ) : (
        <motion.div
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.04 } },
          }}
        >
          {division.agents.map((agent) => (
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
      )}
    </div>
  );
}

function StatBadge({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Layers3;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-2xl"
          style={{ backgroundColor: `${color}22` }}
        >
          <Icon size={18} style={{ color }} />
        </div>
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
        </div>
      </div>
    </div>
  );
}

export default DivisionDetail;
