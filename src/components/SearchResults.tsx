import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Command, Search } from 'lucide-react';
import AgentCard from './AgentCard';
import type { Agent, Division } from '../data/agents';

export interface SearchMatch {
  agent: Agent;
  division: Division;
  score: number;
  matchedBy: string[];
}

interface SearchResultsProps {
  divisions: Division[];
  searchQuery: string;
  onAddToTeam: (agent: Agent) => void;
  onSelectAgent: (agent: Agent) => void;
  onSelectDivision: (division: Division) => void;
  teamMembers: Agent[];
}

function scoreText(text: string, query: string, weight: number) {
  if (!text) return 0;
  const normalized = text.toLowerCase();
  if (normalized === query) return weight + 14;
  if (normalized.startsWith(query)) return weight + 8;
  if (normalized.includes(query)) return weight;
  return 0;
}

export function getSearchResults(divisions: Division[], searchQuery: string): SearchMatch[] {
  const query = searchQuery.toLowerCase().trim();
  if (!query) return [];

  return divisions
    .flatMap((division) =>
      division.agents
        .map((agent) => {
          const matchedBy: string[] = [];
          let score = 0;

          const nameScore = scoreText(agent.name, query, 80);
          const vibeScore = scoreText(agent.vibe, query, 48);
          const descScore = scoreText(agent.description, query, 28);
          const divisionScore = Math.max(
            scoreText(division.name, query, 34),
            scoreText(division.nameZh, query, 34)
          );
          const subDivisionScore = scoreText(agent.subDivision ?? '', query, 16);

          if (nameScore > 0) matchedBy.push('名称');
          if (vibeScore > 0) matchedBy.push('定位');
          if (descScore > 0) matchedBy.push('描述');
          if (divisionScore > 0) matchedBy.push('部门');
          if (subDivisionScore > 0) matchedBy.push('分组');

          score += nameScore + vibeScore + descScore + divisionScore + subDivisionScore;

          if (score === 0) return null;

          return {
            agent,
            division,
            score,
            matchedBy,
          };
        })
        .filter((item): item is SearchMatch => item !== null)
    )
    .sort((a, b) => b.score - a.score || a.agent.name.localeCompare(b.agent.name));
}

function SearchResults({
  divisions,
  searchQuery,
  onAddToTeam,
  onSelectAgent,
  onSelectDivision,
  teamMembers,
}: SearchResultsProps) {
  const results = useMemo(() => getSearchResults(divisions, searchQuery), [divisions, searchQuery]);

  const teamIds = useMemo(() => new Set(teamMembers.map((agent) => agent.id)), [teamMembers]);

  const groupedResults = useMemo(() => {
    const map = new Map<string, { division: Division; matches: SearchMatch[] }>();

    for (const result of results) {
      if (!map.has(result.division.id)) {
        map.set(result.division.id, { division: result.division, matches: [] });
      }
      map.get(result.division.id)?.matches.push(result);
    }

    return Array.from(map.values()).sort((a, b) => b.matches.length - a.matches.length);
  }, [results]);

  const topMatches = results.slice(0, 3);
  const inTeamCount = results.filter((result) => teamIds.has(result.agent.id)).length;

  if (!searchQuery.trim()) return null;

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,rgba(14,165,233,0.12),rgba(15,23,42,0.78)_42%,rgba(2,6,23,0.96))] p-6 shadow-[0_24px_80px_rgba(2,6,23,0.45)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-cyan-300/70">
              <Search size={14} />
              <span>Search State</span>
            </div>
            <h3
              className="text-3xl font-semibold text-white"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              “{searchQuery}” 的检索结果
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              全局搜索会匹配 Agent 名称、角色定位、描述，以及所属部门信息。
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <MetricCard label="结果总数" value={results.length} tone="cyan" />
            <MetricCard label="命中部门" value={groupedResults.length} tone="violet" />
            <MetricCard label="已在团队" value={inTeamCount} tone="emerald" />
          </div>
        </div>
      </section>

      {results.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="rounded-[28px] border border-dashed border-white/12 bg-white/[0.03] px-8 py-20 text-center"
        >
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-2xl">
            🔎
          </div>
          <h4 className="mt-5 text-lg font-semibold text-white">没有找到对应 Agent</h4>
          <p className="mt-2 text-sm text-slate-400">
            当前未命中 “{searchQuery}”。可以尝试更短的关键词、部门名，或直接搜索角色名称。
          </p>
        </motion.div>
      ) : (
        <>
          <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
              <div className="mb-4 flex items-center gap-2 text-sm font-medium text-white">
                <Command size={15} className="text-cyan-300" />
                最佳匹配
              </div>
              <div className="grid gap-3 lg:grid-cols-3">
                {topMatches.map((match) => (
                  <div
                    key={match.agent.id}
                    className="rounded-2xl border border-white/10 bg-black/20 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-2xl">{match.agent.emoji}</div>
                        <h4 className="mt-3 text-sm font-semibold text-white">
                          {match.agent.name}
                        </h4>
                      </div>
                      <span
                        className="rounded-full px-2 py-1 text-[11px] font-semibold"
                        style={{
                          backgroundColor: `${match.division.color}22`,
                          color: match.division.color,
                        }}
                      >
                        {match.score}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{match.agent.vibe}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {match.matchedBy.map((field) => (
                        <span
                          key={`${match.agent.id}-${field}`}
                          className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-300"
                        >
                          匹配 {field}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
              <div className="mb-4 flex items-center justify-between">
                <h4 className="text-sm font-medium text-white">命中部门</h4>
                <span className="text-xs text-slate-500">{groupedResults.length} 个</span>
              </div>
              <div className="space-y-3">
                {groupedResults.map(({ division, matches }) => (
                  <button
                    key={division.id}
                    onClick={() => onSelectDivision(division)}
                    className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-left transition hover:border-white/16 hover:bg-white/[0.05]"
                  >
                    <span className="text-2xl">{division.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">{division.nameZh}</p>
                      <p className="truncate text-xs text-slate-500">{division.name}</p>
                    </div>
                    <span
                      className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                      style={{
                        backgroundColor: `${division.color}22`,
                        color: division.color,
                      }}
                    >
                      {matches.length}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="space-y-6">
            {groupedResults.map(({ division, matches }) => (
              <div key={division.id} className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5">
                <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">{division.emoji}</span>
                    <div>
                      <h4 className="text-base font-semibold text-white">{division.nameZh}</h4>
                      <p className="text-sm text-slate-500">{division.name}</p>
                    </div>
                  </div>

                  <button
                    onClick={() => onSelectDivision(division)}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3.5 py-2 text-sm text-slate-300 transition hover:border-white/16 hover:bg-white/[0.05] hover:text-white"
                  >
                    打开部门详情
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-semibold"
                      style={{
                        backgroundColor: `${division.color}22`,
                        color: division.color,
                      }}
                    >
                      {matches.length}
                    </span>
                  </button>
                </div>

                <motion.div
                  className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
                  initial="hidden"
                  animate="visible"
                  variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.04 } } }}
                >
                  {matches.map((match) => (
                    <AgentCard
                      key={match.agent.id}
                      agent={match.agent}
                      divisionColor={division.color}
                      divisionLabel={division.nameZh}
                      isInTeam={teamIds.has(match.agent.id)}
                      onSelect={onSelectAgent}
                      onToggleTeam={onAddToTeam}
                    />
                  ))}
                </motion.div>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'cyan' | 'violet' | 'emerald';
}) {
  const tones = {
    cyan: 'from-cyan-400/20 to-cyan-400/5 text-cyan-200',
    violet: 'from-violet-400/20 to-violet-400/5 text-violet-200',
    emerald: 'from-emerald-400/20 to-emerald-400/5 text-emerald-200',
  } as const;

  return (
    <div className={`rounded-2xl border border-white/10 bg-gradient-to-br px-4 py-3 ${tones[tone]}`}>
      <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}

export default SearchResults;
