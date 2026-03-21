import { AnimatePresence, motion } from 'framer-motion';
import { BookOpenText, ExternalLink, FolderTree, Layers3, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Agent, Division } from '../data/agents';
import { divisions } from '../data/agents';
import MarkdownArticle from './MarkdownArticle';

interface AgentMarkdownEntry {
  sourcePath: string;
  headings: string[];
  markdown: string;
}

interface AgentDetailPanelProps {
  agent: Agent | null;
  division: Division | null;
  isInTeam: boolean;
  onClose: () => void;
  onToggleTeam: (agent: Agent) => void;
  onStartChat?: (agent: Agent) => void;
}

function AgentDetailPanel({
  agent,
  division,
  isInTeam,
  onClose,
  onToggleTeam,
  onStartChat,
}: AgentDetailPanelProps) {
  const [markdownEntry, setMarkdownEntry] = useState<AgentMarkdownEntry | null>(null);
  const [isMarkdownLoading, setIsMarkdownLoading] = useState(false);

  useEffect(() => {
    let isActive = true;

    if (!agent) {
      setMarkdownEntry(null);
      setIsMarkdownLoading(false);
      return () => {
        isActive = false;
      };
    }

    setIsMarkdownLoading(true);

    import('../data/agentMarkdown')
      .then((module) => {
        if (!isActive) return;
        setMarkdownEntry(module.agentMarkdownById[agent.id] ?? null);
      })
      .finally(() => {
        if (isActive) setIsMarkdownLoading(false);
      });

    return () => {
      isActive = false;
    };
  }, [agent]);

  const relatedAgents = useMemo(() => {
    if (!agent || !division) return [];

    const crossDivisionPriority = ['product', 'engineering', 'design', 'testing', 'project-management'];
    const suggestions = crossDivisionPriority
      .filter((divisionId) => divisionId !== division.id)
      .map((divisionId) => divisions.find((item) => item.id === divisionId))
      .filter((item): item is Division => Boolean(item))
      .flatMap((item) => item.agents.slice(0, 1))
      .filter((candidate) => candidate.id !== agent.id)
      .slice(0, 4);

    return suggestions;
  }, [agent, division]);

  const markdownStats = useMemo(() => {
    if (!markdownEntry) {
      return {
        sectionCount: 0,
        sourcePath: agent?.fileName ?? '',
      };
    }

    const sectionCount = (markdownEntry.markdown.match(/^##?\s+/gm) ?? []).length;

    return {
      sectionCount,
      sourcePath: markdownEntry.sourcePath,
    };
  }, [agent?.fileName, markdownEntry]);

  return (
    <AnimatePresence>
      {agent && division && (
        <>
          <motion.div
            key="agent-detail-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-slate-950/55 backdrop-blur-sm"
            onClick={onClose}
          />

          <motion.aside
            key="agent-detail-drawer"
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            transition={{ duration: 0.22 }}
            className="panel-surface-strong fixed right-0 top-0 z-50 flex h-screen w-full max-w-[760px] flex-col border-l border-white/10 bg-[#06101d]/96 shadow-[-24px_0_80px_rgba(2,6,23,0.45)] backdrop-blur-xl"
            style={{ paddingTop: 'env(titlebar-area-height, 0px)' }}
          >
            <div className="panel-grid flex items-center justify-between border-b border-white/10 px-6 py-5">
              <div>
                <div className="flex items-center gap-2">
                  <span className="instrument-tag rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.22em]">
                    Agent Profile
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-400">
                    Hybrid View
                  </span>
                </div>
                <h2
                  className="mt-2 text-2xl font-semibold text-white"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {agent.name}
                </h2>
              </div>
              <button
                onClick={onClose}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-slate-300 transition hover:border-white/16 hover:bg-white/[0.06] hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
              <section className="panel-surface network-shell rounded-[30px] p-5">
                <div className="flex items-start gap-4">
                  <div
                    className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[24px] border text-3xl"
                    style={{
                      backgroundColor: `${division.color}18`,
                      borderColor: `${division.color}33`,
                    }}
                  >
                    {agent.emoji}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="instrument-tag rounded-full px-2.5 py-1 text-[11px] font-semibold">
                        {division.nameZh}
                      </span>
                      {agent.subDivision && (
                        <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-slate-300">
                          {agent.subDivision}
                        </span>
                      )}
                      <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-slate-400">
                        {markdownStats.sectionCount} sections
                      </span>
                    </div>
                    <p className="mt-4 text-base leading-7 text-slate-100">{agent.vibe}</p>
                    <p className="mt-3 text-sm leading-7 text-slate-400">{agent.description}</p>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  <button
                    onClick={() => onToggleTeam(agent)}
                    className={`rounded-full border px-4 py-2.5 text-sm font-medium transition ${
                      isInTeam
                        ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/15'
                        : 'border-cyan-400/20 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/15'
                    }`}
                  >
                    {isInTeam ? '移出团队' : '加入团队'}
                  </button>
                  {onStartChat && (
                    <button
                      onClick={() => onStartChat(agent)}
                      className="rounded-full border border-violet-400/20 bg-violet-400/10 text-violet-100 hover:bg-violet-400/15 px-4 py-2.5 text-sm font-medium transition"
                    >
                      开始对话
                    </button>
                  )}
                  <div className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-slate-300">
                    Source: <span className="font-mono text-xs text-slate-200">{markdownStats.sourcePath}</span>
                  </div>
                </div>
              </section>

              <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="panel-surface rounded-[28px] p-5">
                  <div className="mb-4 flex items-center gap-2 text-sm font-medium text-white">
                    <Sparkles size={16} className="text-cyan-300" />
                    精修摘要
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">核心定位</p>
                      <p className="mt-3 text-sm leading-7 text-slate-200">{agent.vibe}</p>
                    </div>
                    <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">阅读情报</p>
                      <p className="mt-3 text-sm leading-7 text-slate-300">
                        原文已接入富文本渲染，适合直接查看角色规则、工作流和交付物说明。
                      </p>
                    </div>
                  </div>
                </div>

                <div className="panel-surface rounded-[28px] p-5">
                  <div className="mb-4 flex items-center gap-2 text-sm font-medium text-white">
                    <Layers3 size={16} className="text-violet-300" />
                    推荐协同
                  </div>
                  <div className="space-y-3">
                    {relatedAgents.map((relatedAgent) => (
                      <div
                        key={relatedAgent.id}
                        className="rounded-[22px] border border-white/10 bg-black/20 p-4"
                      >
                        <div className="flex items-start gap-3">
                          <div className="text-2xl">{relatedAgent.emoji}</div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-white">{relatedAgent.name}</p>
                            <p className="mt-1 text-xs text-slate-500">{relatedAgent.division}</p>
                            <p className="mt-2 text-sm leading-6 text-slate-400">{relatedAgent.vibe}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="panel-surface rounded-[28px] p-5">
                <div className="mb-4 flex items-center gap-2 text-sm font-medium text-white">
                  <FolderTree size={16} className="text-violet-300" />
                  来源信息
                </div>
                <div className="space-y-3 text-sm text-slate-300">
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Division</p>
                    <p className="mt-2 text-sm text-white">{division.nameZh}</p>
                    <p className="mt-1 text-xs text-slate-500">{division.name}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Source File</p>
                    <p className="mt-2 break-all font-mono text-xs text-slate-300">
                      {markdownStats.sourcePath || agent.fileName}
                    </p>
                  </div>
                </div>
              </section>

              <section className="panel-surface rounded-[28px] p-5">
                <div className="mb-4 flex items-center gap-2 text-sm font-medium text-white">
                  <ExternalLink size={16} className="text-emerald-300" />
                  使用建议
                </div>
                <div className="space-y-2 text-sm leading-7 text-slate-300">
                  <p>适合先从该 Agent 的定位文案判断职责，再与其他部门角色组合形成跨职能小队。</p>
                  <p>如果你正在组团队，优先补齐产品、工程、设计、测试四类基本链路，再加垂直专家。</p>
                </div>
              </section>

              <section className="panel-surface rounded-[28px] p-5">
                <div className="mb-4 flex items-center gap-2 text-sm font-medium text-white">
                  <BookOpenText size={16} className="text-cyan-300" />
                  原始 Markdown 文档
                </div>
                {markdownEntry ? (
                  <MarkdownArticle markdown={markdownEntry.markdown} />
                ) : isMarkdownLoading ? (
                  <div className="rounded-[22px] border border-white/10 bg-black/20 p-6 text-sm text-slate-400">
                    正在加载原始 markdown 文档...
                  </div>
                ) : (
                  <div className="rounded-[22px] border border-dashed border-white/12 bg-black/20 p-6 text-sm text-slate-400">
                    当前 Agent 还没有匹配到原始 markdown 文档。
                  </div>
                )}
              </section>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

export default AgentDetailPanel;
