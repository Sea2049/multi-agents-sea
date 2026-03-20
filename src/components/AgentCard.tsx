import { motion } from 'framer-motion';
import { Check, Plus } from 'lucide-react';
import { useMemo, useState, type MouseEvent } from 'react';
import type { Agent } from '../data/agents';

interface AgentCardProps {
  agent: Agent;
  isInTeam: boolean;
  onSelect?: (agent: Agent) => void;
  onToggleTeam?: (agent: Agent) => void;
  divisionColor: string;
  divisionLabel?: string;
}

export default function AgentCard({
  agent,
  isInTeam,
  onSelect,
  onToggleTeam,
  divisionColor,
  divisionLabel,
}: AgentCardProps) {
  const [hovered, setHovered] = useState(false);
  const handleToggle = useMemo(() => onToggleTeam, [onToggleTeam]);
  const actionLabel = isInTeam ? '已编组' : '加入团队';

  const handleTeamToggle = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    handleToggle?.(agent);
  };

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      whileHover={{ y: -6, scale: 1.01 }}
      whileTap={{ scale: 0.992 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      onClick={() => onSelect?.(agent)}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      className={`group panel-surface network-shell relative overflow-hidden rounded-[26px] p-5 transition duration-200 ${
        onSelect ? 'cursor-pointer' : 'cursor-default'
      }`}
      style={{
        borderColor: hovered ? `${divisionColor}66` : 'rgba(255,255,255,0.08)',
        boxShadow: hovered
          ? `0 0 0 1px ${divisionColor}22, 0 24px 60px rgba(2,6,23,0.42)`
          : '0 18px 50px rgba(2,6,23,0.24)',
        background: `linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.018)), linear-gradient(180deg, ${divisionColor}08 0%, rgba(4,8,15,0.88) 36%, rgba(4,8,15,0.96) 100%)`,
      }}
    >
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-24 opacity-80"
        style={{
          background: `linear-gradient(180deg, ${divisionColor}22 0%, rgba(255,255,255,0) 100%)`,
        }}
      />
      <div
        className="pointer-events-none absolute -right-10 top-3 h-28 w-28 rounded-full blur-2xl transition duration-300"
        style={{
          background: `radial-gradient(circle, ${divisionColor}20 0%, transparent 66%)`,
          opacity: hovered ? 1 : 0.72,
        }}
      />
      <div className="pointer-events-none absolute inset-x-5 bottom-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.2),transparent)]" />

      <div className="relative flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-[18px] border text-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
            style={{
              borderColor: `${divisionColor}33`,
              backgroundColor: `${divisionColor}18`,
            }}
          >
            {agent.emoji}
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
              {divisionLabel ?? agent.division}
            </p>
            <h3 className="mt-1 text-base font-semibold leading-6 text-white">{agent.name}</h3>
          </div>
        </div>

        {handleToggle && (
          <button
            onClick={handleTeamToggle}
            className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition"
            style={{
              borderColor: isInTeam ? '#10b981' : `${divisionColor}44`,
              backgroundColor: isInTeam ? 'rgba(16,185,129,0.16)' : `${divisionColor}18`,
              color: isInTeam ? '#d1fae5' : divisionColor,
            }}
            title={isInTeam ? '移出团队' : '加入团队'}
          >
            {isInTeam ? <Check size={13} /> : <Plus size={13} />}
            <span>{actionLabel}</span>
          </button>
        )}
      </div>

      <div className="relative mt-5 space-y-4">
        <p className="rounded-[20px] border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm leading-6 text-slate-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          {agent.vibe}
        </p>

        <p className="min-h-[72px] text-sm leading-6 text-slate-400">{agent.description}</p>
      </div>

      <div className="relative mt-5 flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-full border px-2.5 py-1 text-[11px] font-semibold"
            style={{
              backgroundColor: `${divisionColor}22`,
              borderColor: `${divisionColor}28`,
              color: divisionColor,
            }}
          >
            {divisionLabel ?? agent.division}
          </span>
          {agent.subDivision && (
            <span className="rounded-full border border-white/[0.08] px-2.5 py-1 text-[11px] text-slate-400">
              {agent.subDivision}
            </span>
          )}
        </div>

        {onSelect && (
          <span className="text-xs uppercase tracking-[0.18em] text-slate-600 transition group-hover:text-slate-300">
            Open Profile
          </span>
        )}
      </div>
    </motion.article>
  );
}
