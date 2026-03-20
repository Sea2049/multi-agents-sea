import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Database,
  ChevronRight,
  GitBranch,
  History,
  LayoutGrid,
  Radar,
  Settings,
  Sparkles,
  Users,
} from 'lucide-react';
import Dashboard from './components/Dashboard';
import AgentDetailPanel from './components/AgentDetailPanel';
import DivisionDetail from './components/DivisionDetail';
import SearchBar from './components/SearchBar';
import SearchResults, { getSearchResults } from './components/SearchResults';
import TeamBuilder from './components/TeamBuilder';
import ChatPanel from './components/chat/ChatPanel';
import ProviderSettings from './components/settings/ProviderSettings';
import { MemoryLibraryView } from './components/memory/MemoryLibraryView';
import { PipelinesPanel } from './components/pipelines/PipelinesPanel';
import { SkillsPanel } from './components/skills/SkillsPanel';
import TaskLaunchPanel from './components/orchestrator/TaskLaunchPanel';
import TaskProgressView from './components/orchestrator/TaskProgressView';
import TaskHistoryView from './components/orchestrator/TaskHistoryView';
import { divisions } from './data/agents';
import type { Agent, Division } from './data/agents';
import { apiClient } from './lib/api-client';

type BaseView = 'dashboard' | 'detail' | 'team' | 'tasks' | 'memories' | 'skills' | 'pipelines';
type ActiveView = BaseView | 'search';

function App() {
  const [currentView, setCurrentView] = useState<BaseView>('dashboard');
  const [selectedDivision, setSelectedDivision] = useState<Division | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [teamMembers, setTeamMembers] = useState<Agent[]>([]);
  const [chatAgent, setChatAgent] = useState<Agent | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showTaskLaunch, setShowTaskLaunch] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [providerConfigVersion, setProviderConfigVersion] = useState(0);
  const [showProviderSetupHint, setShowProviderSetupHint] = useState(false);

  const totalAgents = useMemo(
    () => divisions.reduce((sum, division) => sum + division.agents.length, 0),
    []
  );

  const populatedDivisions = useMemo(
    () => divisions.filter((division) => division.agents.length > 0).length,
    []
  );

  const teamDivisionCoverage = useMemo(
    () => new Set(teamMembers.map((agent) => agent.division)).size,
    [teamMembers]
  );

  const searchResults = useMemo(
    () => getSearchResults(divisions, searchQuery),
    [searchQuery]
  );

  const activeView: ActiveView = searchQuery.trim() ? 'search' : currentView;

  useEffect(() => {
    let cancelled = false;

    apiClient
      .getProviders()
      .then((providers) => {
        if (cancelled) return;

        const hasConfiguredCloudProvider = providers.some(
          (provider) => provider.configured && provider.kind !== 'local'
        );
        setShowProviderSetupHint(!hasConfiguredCloudProvider);
      })
      .catch(() => {
        if (!cancelled) {
          setShowProviderSetupHint(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [providerConfigVersion]);

  const toggleTeamMember = useCallback((agent: Agent) => {
    setTeamMembers((prev) => {
      const exists = prev.some((member) => member.id === agent.id);
      return exists ? prev.filter((member) => member.id !== agent.id) : [...prev, agent];
    });
  }, []);

  const addTeamMember = useCallback((agent: Agent) => {
    setTeamMembers((prev) => {
      if (prev.some((member) => member.id === agent.id)) return prev;
      return [...prev, agent];
    });
  }, []);

  const reorderTeamMember = useCallback((draggedId: string, targetId: string | null) => {
    setTeamMembers((prev) => {
      const fromIndex = prev.findIndex((member) => member.id === draggedId);
      if (fromIndex === -1) return prev;

      const next = [...prev];
      const [draggedMember] = next.splice(fromIndex, 1);

      if (!targetId) {
        next.push(draggedMember);
        return next;
      }

      const targetIndex = next.findIndex((member) => member.id === targetId);
      if (targetIndex === -1) {
        next.push(draggedMember);
        return next;
      }

      next.splice(targetIndex, 0, draggedMember);
      return next;
    });
  }, []);

  const handleSelectAgent = useCallback((agent: Agent) => {
    setSelectedAgent(agent);
    setChatAgent(null);
  }, []);

  const handleCloseAgent = useCallback(() => {
    setSelectedAgent(null);
  }, []);

  const handleStartChat = useCallback((agent: Agent) => {
    setSelectedAgent(null);
    setChatAgent(agent);
  }, []);

  const handleCloseChat = useCallback(() => {
    setChatAgent(null);
  }, []);

  const handleExecuteTask = useCallback(() => {
    setShowTaskLaunch(true);
  }, []);

  const handleTaskCreated = useCallback((taskId: string) => {
    setShowTaskLaunch(false);
    setActiveTaskId(taskId);
  }, []);

  const handleProviderSettingsSaved = useCallback(() => {
    setProviderConfigVersion((prev) => prev + 1);
  }, []);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
  }, []);

  const handleSelectDivision = useCallback((division: Division) => {
    clearSearch();
    setSelectedDivision(division);
    setCurrentView('detail');
  }, [clearSearch]);

  const handleGoToDivision = useCallback((divisionId: string) => {
    const division = divisions.find((item) => item.id === divisionId);
    if (!division) return;
    clearSearch();
    setSelectedDivision(division);
    setCurrentView('detail');
  }, [clearSearch]);

  const handleGoToDashboard = useCallback(() => {
    clearSearch();
    setSelectedDivision(null);
    setCurrentView('dashboard');
  }, [clearSearch]);

  const handleGoToTeam = useCallback(() => {
    clearSearch();
    setCurrentView('team');
  }, [clearSearch]);

  const handleGoToMemories = useCallback(() => {
    clearSearch();
    setCurrentView('memories');
  }, [clearSearch]);

  const handleGoToSkills = useCallback(() => {
    clearSearch();
    setCurrentView('skills');
  }, [clearSearch]);

  const handleGoToPipelines = useCallback(() => {
    clearSearch();
    setCurrentView('pipelines');
  }, [clearSearch]);

  const headerMeta = useMemo(() => {
    if (activeView === 'search') {
      return {
        eyebrow: 'Global Search',
        title: '实时检索所有 Agent',
        subtitle: `正在扫描 ${populatedDivisions} 个部门，当前命中 ${searchResults.length} 个结果。`,
      };
    }

    if (activeView === 'team') {
      return {
        eyebrow: 'Team Builder',
        title: '编组你的执行小队',
        subtitle: `当前团队 ${teamMembers.length} 人，跨 ${teamDivisionCoverage} 个部门协作。`,
      };
    }

    if (activeView === 'tasks') {
      return {
        eyebrow: 'Task History',
        title: '任务执行历史',
        subtitle: '查看所有历史任务的执行记录与详情。',
      };
    }

    if (activeView === 'memories') {
      return {
        eyebrow: 'Memory Library',
        title: '跨任务长期记忆库',
        subtitle: '集中浏览任务沉淀的 facts、decisions、outputs，并按任务、Agent、分类回看与清理。',
      };
    }

    if (activeView === 'skills') {
      return {
        eyebrow: 'Skill Registry',
        title: 'Skill 插件化控制台',
        subtitle: '统一管理 prompt-only skills 与可执行 skills 的启用、信任、gating 与热更新状态。',
      };
    }

    if (activeView === 'pipelines') {
      return {
        eyebrow: 'Pipeline Registry',
        title: 'Deterministic Pipeline 控制台',
        subtitle: '用最小 DSL 管理 tool / llm / gate / condition 节点，并直接复用现有任务、SSE 与长期记忆链路。',
      };
    }

    if (activeView === 'detail' && selectedDivision) {
      return {
        eyebrow: 'Division Intel',
        title: `${selectedDivision.nameZh} Agent 清单`,
        subtitle: `${selectedDivision.name} · ${selectedDivision.agents.length} 名可用专家。`,
      };
    }

    return {
      eyebrow: 'Agency Command',
      title: '桌面指挥中枢',
      subtitle: `已接入 ${totalAgents} 名 Agent，覆盖 ${populatedDivisions} 个业务部门。`,
    };
  }, [
    activeView,
    populatedDivisions,
    searchResults.length,
    selectedDivision,
    teamDivisionCoverage,
    teamMembers.length,
    totalAgents,
  ]);

  const topTabs = useMemo(() => {
    const tabs: Array<{
      key: ActiveView | 'division';
      label: string;
      active: boolean;
      onClick: () => void;
      badge?: number;
    }> = [
      {
        key: 'dashboard',
        label: 'Dashboard',
        active: activeView === 'dashboard',
        onClick: handleGoToDashboard,
      },
    ];

    if (activeView === 'detail' && selectedDivision) {
      tabs.push({
        key: 'division',
        label: selectedDivision.nameZh,
        active: true,
        onClick: () => handleSelectDivision(selectedDivision),
        badge: selectedDivision.agents.length,
      });
    }

    if (searchQuery.trim()) {
      tabs.push({
        key: 'search',
        label: 'Search',
        active: activeView === 'search',
        onClick: () => undefined,
        badge: searchResults.length,
      });
    }

    tabs.push({
      key: 'team',
      label: 'Team Builder',
      active: activeView === 'team',
      onClick: handleGoToTeam,
      badge: teamMembers.length > 0 ? teamMembers.length : undefined,
    });

    return tabs;
  }, [
    activeView,
    handleGoToDashboard,
    handleGoToTeam,
    handleSelectDivision,
    searchQuery,
    searchResults.length,
    selectedDivision,
    teamMembers.length,
  ]);

  const chatAgentDivision = useMemo(
    () =>
      chatAgent
        ? (divisions.find((d) => d.id === chatAgent.division) ?? null)
        : null,
    [chatAgent]
  );

  const selectedAgentDivision = useMemo(() => {
    if (!selectedAgent) return null;
    return divisions.find((division) => division.id === selectedAgent.division) ?? null;
  }, [selectedAgent]);

  const commandSignals = useMemo(
    () => [
      {
        label: 'Mesh Nodes',
        value: populatedDivisions.toString().padStart(2, '0'),
        hint: '在线部门',
      },
      {
        label: 'Live Agents',
        value: totalAgents.toString().padStart(3, '0'),
        hint: '可调度专家',
      },
      {
        label: 'Squad Links',
        value: teamMembers.length.toString().padStart(2, '0'),
        hint: '当前编组',
      },
    ],
    [populatedDivisions, teamMembers.length, totalAgents]
  );

  const sidebarSignals = useMemo(
    () => [
      {
        label: '当前视图',
        value:
          activeView === 'dashboard'
            ? '总览'
            : activeView === 'detail'
              ? '部门'
              : activeView === 'team'
                ? '组队'
                : activeView === 'tasks'
                  ? '任务历史'
                  : activeView === 'memories'
                    ? '记忆库'
                    : activeView === 'skills'
                      ? '技能库'
                      : activeView === 'pipelines'
                        ? '流水线'
                  : '搜索',
      },
      {
        label: '搜索状态',
        value: searchQuery.trim() ? `${searchResults.length} 命中` : '待命',
      },
    ],
    [activeView, searchQuery, searchResults.length]
  );

  return (
    <div
      className="relative flex h-screen overflow-hidden bg-[var(--bg-app)] text-slate-100"
      style={{ paddingTop: 'env(titlebar-area-height, 0px)' }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_18%,rgba(141,211,255,0.14),transparent_0_24%),radial-gradient(circle_at_84%_10%,rgba(121,147,255,0.14),transparent_0_22%),radial-gradient(circle_at_60%_112%,rgba(71,145,201,0.12),transparent_0_30%),linear-gradient(180deg,rgba(4,7,13,0.92),rgba(4,7,13,0.98))]" />
      <div className="panel-grid pointer-events-none absolute inset-0 opacity-40" />
      <div className="pointer-events-none absolute -left-40 top-24 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(138,208,255,0.14),transparent_64%)] blur-3xl" />
      <div className="pointer-events-none absolute right-[-160px] top-[-120px] h-[360px] w-[360px] rounded-full bg-[radial-gradient(circle,rgba(151,162,255,0.12),transparent_68%)] blur-3xl" />

      <aside className="panel-surface-strong network-shell relative z-10 flex w-[308px] shrink-0 flex-col border-r border-[var(--border-soft)] bg-[rgba(5,10,18,0.78)]">
        <div className="border-b border-[var(--border-soft)] px-5 py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-[18px] border border-cyan-200/15 bg-[linear-gradient(180deg,rgba(143,219,255,0.18),rgba(143,219,255,0.06))] text-cyan-100 shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_16px_32px_rgba(5,12,20,0.32)]">
                <Sparkles size={20} />
              </div>
              <div>
                <p
                  className="text-[11px] uppercase tracking-[0.32em] text-cyan-100/58"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  Agency Agents
                </p>
                <h1
                  className="text-[22px] font-semibold tracking-[0.04em] text-white"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  Mission Control
                </h1>
              </div>
            </div>

            <div className="instrument-tag rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.24em]">
              Online
            </div>
          </div>

          <p className="mt-4 text-sm leading-6 text-slate-400">
            面向多节点 Agent 集群的桌面指挥台，统一浏览部门、检索角色并编排任务网络。
          </p>

          <div className="mt-5 grid grid-cols-2 gap-3">
            {sidebarSignals.map((signal) => (
              <div
                key={signal.label}
                className="soft-ring rounded-[18px] border border-white/[0.06] bg-white/[0.03] px-3.5 py-3"
              >
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{signal.label}</p>
                <p className="mt-2 text-sm font-medium text-slate-100">{signal.value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2 px-4 py-4">
          <button
            onClick={handleGoToDashboard}
            className={`interactive-lift flex w-full items-center gap-3 rounded-[20px] border px-4 py-3.5 text-left ${
              activeView === 'dashboard'
                ? 'border-cyan-200/18 bg-[linear-gradient(180deg,rgba(130,208,255,0.14),rgba(130,208,255,0.06))] text-cyan-50 shadow-[0_16px_34px_rgba(3,10,18,0.24)]'
                : 'border-white/[0.07] bg-white/[0.025] text-slate-300 hover:border-white/[0.12] hover:bg-white/[0.045]'
            }`}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-black/20">
              <LayoutGrid size={18} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">Dashboard</p>
              <p className="text-xs text-slate-500">部门总览与快速入口</p>
            </div>
            {activeView === 'dashboard' && <ChevronRight size={16} className="text-cyan-200" />}
          </button>

          <button
            onClick={handleGoToTeam}
            className={`interactive-lift flex w-full items-center gap-3 rounded-[20px] border px-4 py-3.5 text-left ${
              activeView === 'team'
                ? 'border-emerald-200/18 bg-[linear-gradient(180deg,rgba(120,230,197,0.15),rgba(120,230,197,0.06))] text-emerald-50 shadow-[0_16px_34px_rgba(3,10,18,0.24)]'
                : 'border-white/[0.07] bg-white/[0.025] text-slate-300 hover:border-white/[0.12] hover:bg-white/[0.045]'
            }`}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-black/20">
              <Users size={18} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">Team Builder</p>
              <p className="text-xs text-slate-500">编组、补位与摘要</p>
            </div>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-slate-200">
              {teamMembers.length}
            </span>
          </button>

          <button
            onClick={() => setCurrentView('tasks')}
            className={`interactive-lift flex w-full items-center gap-3 rounded-[20px] border px-4 py-3.5 text-left ${
              activeView === 'tasks'
                ? 'border-amber-200/18 bg-[linear-gradient(180deg,rgba(251,191,36,0.15),rgba(251,191,36,0.06))] text-amber-50 shadow-[0_16px_34px_rgba(3,10,18,0.24)]'
                : 'border-white/[0.07] bg-white/[0.025] text-slate-300 hover:border-white/[0.12] hover:bg-white/[0.045]'
            }`}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-black/20">
              <History size={18} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">任务历史</p>
              <p className="text-xs text-slate-500">历史任务记录与回溯</p>
            </div>
            {activeView === 'tasks' && <ChevronRight size={16} className="text-amber-200" />}
          </button>

          <button
            onClick={handleGoToMemories}
            className={`interactive-lift flex w-full items-center gap-3 rounded-[20px] border px-4 py-3.5 text-left ${
              activeView === 'memories'
                ? 'border-cyan-200/18 bg-[linear-gradient(180deg,rgba(34,211,238,0.16),rgba(34,211,238,0.06))] text-cyan-50 shadow-[0_16px_34px_rgba(3,10,18,0.24)]'
                : 'border-white/[0.07] bg-white/[0.025] text-slate-300 hover:border-white/[0.12] hover:bg-white/[0.045]'
            }`}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-black/20">
              <Database size={18} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">记忆库</p>
              <p className="text-xs text-slate-500">跨任务记忆浏览与清理</p>
            </div>
            {activeView === 'memories' && <ChevronRight size={16} className="text-cyan-200" />}
          </button>

          <button
            onClick={handleGoToSkills}
            className={`interactive-lift flex w-full items-center gap-3 rounded-[20px] border px-4 py-3.5 text-left ${
              activeView === 'skills'
                ? 'border-fuchsia-200/18 bg-[linear-gradient(180deg,rgba(217,70,239,0.16),rgba(217,70,239,0.06))] text-fuchsia-50 shadow-[0_16px_34px_rgba(3,10,18,0.24)]'
                : 'border-white/[0.07] bg-white/[0.025] text-slate-300 hover:border-white/[0.12] hover:bg-white/[0.045]'
            }`}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-black/20">
              <Sparkles size={18} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">技能库</p>
              <p className="text-xs text-slate-500">Skills 启停、信任与 gating</p>
            </div>
            {activeView === 'skills' && <ChevronRight size={16} className="text-fuchsia-200" />}
          </button>

          <button
            onClick={handleGoToPipelines}
            className={`interactive-lift flex w-full items-center gap-3 rounded-[20px] border px-4 py-3.5 text-left ${
              activeView === 'pipelines'
                ? 'border-emerald-200/18 bg-[linear-gradient(180deg,rgba(16,185,129,0.16),rgba(16,185,129,0.06))] text-emerald-50 shadow-[0_16px_34px_rgba(3,10,18,0.24)]'
                : 'border-white/[0.07] bg-white/[0.025] text-slate-300 hover:border-white/[0.12] hover:bg-white/[0.045]'
            }`}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-black/20">
              <GitBranch size={18} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">流水线</p>
              <p className="text-xs text-slate-500">Pipeline DSL 与运行入口</p>
            </div>
            {activeView === 'pipelines' && <ChevronRight size={16} className="text-emerald-200" />}
          </button>
        </div>

        <div className="border-t border-[var(--border-soft)] px-4 py-4">
          <div className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-[0.28em] text-slate-500">
            <span>Divisions Mesh</span>
            <span>{populatedDivisions}</span>
          </div>
          <div className="space-y-2 overflow-y-auto pr-1">
            {divisions.map((division) => {
              const isActive = activeView === 'detail' && selectedDivision?.id === division.id;
              return (
                <button
                  key={division.id}
                  onClick={() => handleSelectDivision(division)}
                  className={`interactive-lift flex w-full items-center gap-3 rounded-[18px] border px-3.5 py-3 text-left ${
                    isActive
                      ? 'border-white/[0.12] bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.03))] text-white'
                      : 'border-transparent bg-transparent text-slate-300 hover:border-white/[0.08] hover:bg-white/[0.035]'
                  }`}
                >
                  <div
                    className="h-9 w-1 rounded-full"
                    style={{
                      background: `linear-gradient(180deg, ${division.color}, rgba(255,255,255,0.12))`,
                      opacity: isActive ? 1 : 0.56,
                    }}
                  />
                  <span className="text-lg">{division.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{division.nameZh}</p>
                    <p className="truncate text-xs text-slate-500">{division.name}</p>
                  </div>
                  <span
                    className="rounded-full border px-2.5 py-1 text-[11px] font-semibold"
                    style={{
                      backgroundColor: `${division.color}18`,
                      borderColor: `${division.color}22`,
                      color: division.color,
                    }}
                  >
                    {division.agents.length}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-auto border-t border-[var(--border-soft)] px-4 py-4">
          {showProviderSetupHint && (
            <div className="mb-4 rounded-[24px] border border-amber-400/18 bg-amber-400/[0.07] px-4 py-4 text-amber-100">
              <p className="text-sm font-medium">首次启动建议先配置 Provider</p>
              <p className="mt-1 text-xs leading-6 text-amber-200/80">
                保存 MiniMax、OpenAI 或 Anthropic 的 API Key 后，聊天与任务流会自动出现可用模型。
              </p>
              <button
                onClick={() => setShowSettings(true)}
                className="mt-3 inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/10 px-3.5 py-2 text-xs font-medium text-amber-100 transition hover:bg-amber-300/14"
              >
                <Settings size={13} />
                打开 Provider 设置
              </button>
            </div>
          )}

          <button
            onClick={() => setShowSettings(true)}
            className="interactive-lift mb-4 flex w-full items-center gap-3 rounded-[20px] border border-white/[0.07] bg-white/[0.025] px-4 py-3.5 text-left text-slate-300 hover:border-white/[0.12] hover:bg-white/[0.045]"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-black/20">
              <Settings size={18} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">Provider 设置</p>
              <p className="text-xs text-slate-500">API Key 与模型配置</p>
            </div>
          </button>

          <div className="rounded-[24px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-4 shadow-[0_16px_40px_rgba(0,0,0,0.22)]">
            <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-slate-500">
              <span>Coverage Matrix</span>
              <span>{teamDivisionCoverage}/{populatedDivisions}</span>
            </div>
            <div className="mt-4 h-2 rounded-full bg-white/[0.05]">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,rgba(227,239,247,0.78),rgba(129,212,255,0.95),rgba(126,255,220,0.82))]"
                style={{
                  width: `${populatedDivisions === 0 ? 0 : (teamDivisionCoverage / populatedDivisions) * 100}%`,
                }}
              />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-[18px] border border-white/[0.06] bg-black/20 px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Fleet</p>
                <p className="mt-1 text-sm font-medium text-slate-100">{totalAgents} agents</p>
              </div>
              <div className="rounded-[18px] border border-white/[0.06] bg-black/20 px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Team</p>
                <p className="mt-1 text-sm font-medium text-slate-100">{teamMembers.length} linked</p>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <main className="relative z-10 flex-1 overflow-y-auto">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),transparent_16%,transparent_78%,rgba(255,255,255,0.015)_100%)]" />
        <div className="pointer-events-none absolute inset-x-10 top-8 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.12),transparent)]" />

        <header className="sticky top-0 z-20 px-8 pt-6">
          <div className="mx-auto max-w-[1440px]">
            <div className="panel-surface-strong panel-grid rounded-[30px] border border-white/[0.08]">
              <div className="flex flex-col gap-6 px-8 py-7">
                <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
                  <div className="max-w-3xl">
                    <div className="mb-3 flex flex-wrap items-center gap-2.5">
                      <div className="instrument-tag inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] uppercase tracking-[0.24em]">
                        <Radar size={13} />
                        <span>{headerMeta.eyebrow}</span>
                      </div>
                      <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">
                        Agent Cluster / Desktop Console
                      </span>
                    </div>

                    <h2
                      className="text-4xl font-semibold tracking-[0.03em] text-white xl:text-[44px]"
                      style={{ fontFamily: 'var(--font-display)' }}
                    >
                      {headerMeta.title}
                    </h2>
                    <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
                      {headerMeta.subtitle}
                    </p>
                  </div>

                  <div className="w-full max-w-[540px] rounded-[24px] border border-white/[0.08] bg-black/20 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                    <SearchBar
                      value={searchQuery}
                      onChange={setSearchQuery}
                      resultCount={searchQuery.trim() ? searchResults.length : undefined}
                    />
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  {commandSignals.map((signal) => (
                    <div
                      key={signal.label}
                      className="soft-ring rounded-[22px] border border-white/[0.06] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.015))] px-4 py-4"
                    >
                      <p className="text-[11px] uppercase tracking-[0.24em] text-slate-500">{signal.label}</p>
                      <div className="mt-3 flex items-end justify-between gap-3">
                        <p className="text-[30px] font-semibold leading-none text-white">{signal.value}</p>
                        <p className="pb-1 text-sm text-slate-400">{signal.hint}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-5">
                  {topTabs.map((tab) => (
                    <button
                      key={tab.key}
                      onClick={tab.onClick}
                      className={`interactive-lift inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm ${
                        tab.active
                          ? 'border-cyan-200/18 bg-[linear-gradient(180deg,rgba(135,214,255,0.16),rgba(135,214,255,0.07))] text-cyan-50 shadow-[0_10px_24px_rgba(0,0,0,0.18)]'
                          : 'border-white/[0.08] bg-white/[0.03] text-slate-300 hover:border-white/[0.14] hover:bg-white/[0.05]'
                      }`}
                    >
                      <span>{tab.label}</span>
                      {typeof tab.badge === 'number' && (
                        <span className="rounded-full border border-white/[0.08] bg-black/20 px-2 py-0.5 text-[11px] font-semibold text-slate-200">
                          {tab.badge}
                        </span>
                      )}
                      {tab.active && <ChevronRight size={14} className="text-cyan-100" />}
                    </button>
                  ))}

                  {searchQuery.trim() && (
                    <button
                      onClick={clearSearch}
                      className="interactive-lift rounded-full border border-white/[0.08] px-4 py-2 text-sm text-slate-400 hover:border-white/[0.14] hover:bg-white/[0.05] hover:text-white"
                    >
                      清除搜索
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="relative mx-auto max-w-[1440px] px-8 py-8">
          <AnimatePresence mode="wait">
            {activeView === 'dashboard' && (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.22 }}
              >
                <Dashboard
                  divisions={divisions}
                  onSelectDivision={handleSelectDivision}
                  onOpenTeamBuilder={handleGoToTeam}
                  onAddToTeam={toggleTeamMember}
                  onSelectAgent={handleSelectAgent}
                  teamMembers={teamMembers}
                />
              </motion.div>
            )}

            {activeView === 'search' && (
              <motion.div
                key="search"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.22 }}
              >
                <SearchResults
                  divisions={divisions}
                  searchQuery={searchQuery}
                  onAddToTeam={toggleTeamMember}
                  onSelectAgent={handleSelectAgent}
                  onSelectDivision={handleSelectDivision}
                  teamMembers={teamMembers}
                />
              </motion.div>
            )}

            {activeView === 'detail' && selectedDivision && (
              <motion.div
                key={`detail-${selectedDivision.id}`}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.22 }}
              >
                <DivisionDetail
                  division={selectedDivision}
                  onBack={handleGoToDashboard}
                  onAddToTeam={toggleTeamMember}
                  onSelectAgent={handleSelectAgent}
                  teamMembers={teamMembers}
                />
              </motion.div>
            )}

            {activeView === 'team' && (
              <motion.div
                key="team"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.22 }}
              >
                <TeamBuilder
                  teamMembers={teamMembers}
                  onAddToTeam={addTeamMember}
                  onInspectAgent={handleSelectAgent}
                  onRemoveFromTeam={toggleTeamMember}
                  onReorderTeam={reorderTeamMember}
                  onClearTeam={() => setTeamMembers([])}
                  onGoToDivision={handleGoToDivision}
                  divisions={divisions}
                  onExecuteTask={handleExecuteTask}
                />
              </motion.div>
            )}

            {activeView === 'tasks' && (
              <motion.div
                key="tasks"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.22 }}
                className="px-2 py-2"
              >
                <TaskHistoryView onOpenTask={(id) => setActiveTaskId(id)} />
              </motion.div>
            )}

            {activeView === 'memories' && (
              <motion.div
                key="memories"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.22 }}
                className="px-2 py-2"
              >
                <MemoryLibraryView />
              </motion.div>
            )}

            {activeView === 'skills' && (
              <motion.div
                key="skills"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.22 }}
                className="px-2 py-2"
              >
                <SkillsPanel />
              </motion.div>
            )}

            {activeView === 'pipelines' && (
              <motion.div
                key="pipelines"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.22 }}
                className="px-2 py-2"
              >
                <PipelinesPanel onOpenTask={(id) => setActiveTaskId(id)} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      <AgentDetailPanel
        agent={selectedAgent}
        division={selectedAgentDivision}
        isInTeam={Boolean(selectedAgent && teamMembers.some((member) => member.id === selectedAgent.id))}
        onClose={handleCloseAgent}
        onToggleTeam={toggleTeamMember}
        onStartChat={handleStartChat}
      />

      <ChatPanel
        agent={chatAgent}
        division={chatAgentDivision}
        onClose={handleCloseChat}
        onOpenSettings={() => setShowSettings(true)}
        providerConfigVersion={providerConfigVersion}
      />

      <AnimatePresence>
        {showSettings && (
          <ProviderSettings
            onClose={() => setShowSettings(false)}
            onSaved={handleProviderSettingsSaved}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showTaskLaunch && (
          <TaskLaunchPanel
            teamMembers={teamMembers}
            divisions={divisions}
            onClose={() => setShowTaskLaunch(false)}
            onOpenSettings={() => setShowSettings(true)}
            onTaskCreated={handleTaskCreated}
            providerConfigVersion={providerConfigVersion}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activeTaskId && (
          <TaskProgressView
            taskId={activeTaskId}
            onClose={() => setActiveTaskId(null)}
            onOpenTask={setActiveTaskId}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
