import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Settings, X, Zap } from 'lucide-react';
import type { Agent, Division } from '../../data/agents';
import { apiClient } from '../../lib/api-client';
import type { ProviderConfig, SkillRoutingPolicy } from '../../lib/api-client';

interface TaskLaunchPanelProps {
  teamMembers: Agent[];
  divisions: Division[];
  onClose: () => void;
  onOpenSettings: () => void;
  onTaskCreated: (taskId: string) => void;
  providerConfigVersion: number;
}

interface SkillRoutingDraft {
  allow: string[];
  deny: string[];
}

interface SkillSearchDraft {
  allow: string;
  deny: string;
}

interface SkillVisibilityDraft {
  allow: boolean;
  deny: boolean;
}

interface SkillOption {
  id: string;
  name: string;
}

function normalizeSkillIds(values: string[]): string[] | undefined {
  const normalized = values
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (normalized.length === 0) {
    return undefined;
  }
  return [...new Set(normalized)];
}

function buildSkillRoutingPolicy(
  enabled: boolean,
  defaultMode: 'all' | 'none',
  drafts: Record<string, SkillRoutingDraft>,
): SkillRoutingPolicy | undefined {
  if (!enabled) {
    return undefined;
  }

  const perAgent: Record<string, { allow?: string[]; deny?: string[] }> = {};
  for (const [agentId, draft] of Object.entries(drafts)) {
    const allow = normalizeSkillIds(draft.allow);
    const deny = normalizeSkillIds(draft.deny);
    if (!allow && !deny) {
      continue;
    }
    perAgent[agentId] = { allow, deny };
  }

  return {
    defaultMode,
    perAgent: Object.keys(perAgent).length > 0 ? perAgent : undefined,
  };
}

function TaskLaunchPanel({
  teamMembers,
  divisions,
  onClose,
  onOpenSettings,
  onTaskCreated,
  providerConfigVersion,
}: TaskLaunchPanelProps) {
  const [objective, setObjective] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [needsProviderOnboarding, setNeedsProviderOnboarding] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skillRoutingEnabled, setSkillRoutingEnabled] = useState(false);
  const [skillRoutingDefaultMode, setSkillRoutingDefaultMode] = useState<'all' | 'none'>('all');
  const [skillRoutingDrafts, setSkillRoutingDrafts] = useState<Record<string, SkillRoutingDraft>>({});
  const [skillSearchDrafts, setSkillSearchDrafts] = useState<Record<string, SkillSearchDraft>>({});
  const [skillVisibilityDrafts, setSkillVisibilityDrafts] = useState<Record<string, SkillVisibilityDraft>>({});
  const [availableSkills, setAvailableSkills] = useState<SkillOption[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsLoadError, setSkillsLoadError] = useState<string | null>(null);

  useEffect(() => {
    setSkillRoutingDrafts((previous) => {
      const next: Record<string, SkillRoutingDraft> = {};
      for (const agent of teamMembers) {
        next[agent.id] = previous[agent.id] ?? { allow: [], deny: [] };
      }
      return next;
    });

    setSkillSearchDrafts((previous) => {
      const next: Record<string, SkillSearchDraft> = {};
      for (const agent of teamMembers) {
        next[agent.id] = previous[agent.id] ?? { allow: '', deny: '' };
      }
      return next;
    });

    setSkillVisibilityDrafts((previous) => {
      const next: Record<string, SkillVisibilityDraft> = {};
      for (const agent of teamMembers) {
        next[agent.id] = previous[agent.id] ?? { allow: false, deny: false };
      }
      return next;
    });
  }, [teamMembers]);

  useEffect(() => {
    if (!skillRoutingEnabled || availableSkills.length > 0 || skillsLoading) {
      return;
    }

    let cancelled = false;
    setSkillsLoading(true);
    setSkillsLoadError(null);
    apiClient.skills.list()
      .then((response) => {
        if (cancelled) {
          return;
        }
        const options = response.skills
          .map((skill) => ({ id: skill.id, name: skill.name }))
          .sort((left, right) => left.name.localeCompare(right.name));
        setAvailableSkills(options);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        setSkillsLoadError(err instanceof Error ? err.message : '技能列表加载失败');
      })
      .finally(() => {
        if (!cancelled) {
          setSkillsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [availableSkills.length, skillRoutingEnabled, skillsLoading]);

  useEffect(() => {
    let cancelled = false;

    setProvidersLoading(true);

    apiClient
      .getProviders()
      .then((list) => {
        if (cancelled) return;

        const available = list.filter((item) => item.configured);
        const hasConfiguredCloudProvider = list.some(
          (item) => item.configured && item.kind !== 'local'
        );
        const sorted = [...available].sort((left, right) => {
          if (right.priority !== left.priority) {
            return right.priority - left.priority;
          }
          if (left.kind !== right.kind) {
            return left.kind === 'cloud' ? -1 : 1;
          }
          return left.label.localeCompare(right.label);
        });

        setProviders(sorted);
        setNeedsProviderOnboarding(!hasConfiguredCloudProvider);

        if (sorted.length > 0) {
          const preferred = sorted[0];
          setProvider(preferred.name);
          setModel(preferred.defaultModel ?? '');
        } else {
          setProvider('');
          setModel('');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setProviders([]);
        setProvider('');
        setModel('');
        setNeedsProviderOnboarding(true);
      })
      .finally(() => {
        if (!cancelled) {
          setProvidersLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [providerConfigVersion]);

  useEffect(() => {
    if (!provider) {
      setModels([]);
      setModel('');
      setModelsLoading(false);
      return;
    }

    let cancelled = false;
    const desiredModel = model;
    setModelsLoading(true);
    setModels([]);
    setModel('');

    apiClient.getModels(provider).then((list) => {
      if (cancelled) return;
      const ids = list.map((m) => m.id);
      setModels(ids);
      setModel(ids.includes(desiredModel) ? desiredModel : (ids[0] ?? ''));
    }).catch(() => {
      if (cancelled) return;
      setModels([]);
      setModel('');
    }).finally(() => {
      if (!cancelled) {
        setModelsLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [provider]);

  const handleSubmit = async () => {
    if (!objective.trim()) {
      setError('请输入任务描述');
      return;
    }
    if (!provider || !model) {
      setError('请选择 Provider 和 Model');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const skillRouting = buildSkillRoutingPolicy(
        skillRoutingEnabled,
        skillRoutingDefaultMode,
        skillRoutingDrafts,
      );
      const result = await apiClient.tasks.create({
        objective: objective.trim(),
        teamMembers: teamMembers.map((agent) => ({
          agentId: agent.id,
          provider,
          model,
        })),
        skillRouting,
      });
      onTaskCreated(result.taskId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '任务创建失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getDivision = (agent: Agent) =>
    divisions.find((d) => d.id === agent.division) ?? null;

  const updateSkillSelection = (
    agentId: string,
    list: 'allow' | 'deny',
    skillId: string,
  ) => {
    setSkillRoutingDrafts((previous) => {
      const current = previous[agentId] ?? { allow: [], deny: [] };
      const target = new Set(current[list]);
      const oppositeKey = list === 'allow' ? 'deny' : 'allow';
      const opposite = new Set(current[oppositeKey]);

      if (target.has(skillId)) {
        target.delete(skillId);
      } else {
        target.add(skillId);
        // Keep the policy intuitive: same skill cannot exist in both lists.
        opposite.delete(skillId);
      }

      return {
        ...previous,
        [agentId]: {
          ...current,
          [list]: [...target],
          [oppositeKey]: [...opposite],
        },
      };
    });
  };

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
          className="panel-surface-strong fixed right-0 top-0 z-50 flex h-screen w-full max-w-[560px] flex-col border-l border-white/10 bg-[#06101d]/96 shadow-[-24px_0_80px_rgba(2,6,23,0.45)] backdrop-blur-xl"
          style={{ paddingTop: 'env(titlebar-area-height, 0px)' }}
        >
          <div className="panel-grid flex items-center justify-between border-b border-white/10 px-6 py-5">
            <div>
              <div className="flex items-center gap-2">
                <span className="instrument-tag rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.22em]">
                  Task Launch
                </span>
                <span className="rounded-full border border-violet-400/20 bg-violet-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-violet-300">
                  {teamMembers.length} 名 Agent
                </span>
              </div>
              <h2
                className="mt-2 text-2xl font-semibold text-white"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                发起任务
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
            {/* 团队成员列表 */}
            <section className="panel-surface rounded-[26px] p-5">
              <p className="mb-3 text-xs uppercase tracking-[0.2em] text-slate-500">当前团队成员</p>
              <div className="max-h-48 space-y-2 overflow-y-auto">
                {teamMembers.map((agent) => {
                  const division = getDivision(agent);
                  const color = division?.color ?? '#6366f1';
                  return (
                    <div
                      key={agent.id}
                      className="flex items-center gap-3 rounded-[18px] border border-white/[0.06] bg-black/20 px-4 py-3"
                    >
                      <div
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-base"
                        style={{ backgroundColor: `${color}18`, borderColor: `${color}28` }}
                      >
                        {agent.emoji}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">{agent.name}</p>
                        <p className="text-xs text-slate-500">{division?.nameZh ?? agent.division}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 任务描述 */}
            <section className="space-y-2">
              <label className="text-xs uppercase tracking-[0.2em] text-slate-500">任务目标</label>
              <textarea
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
                placeholder="描述你想完成的任务…"
                rows={5}
                className="w-full resize-none rounded-[20px] border border-white/[0.08] bg-black/20 px-4 py-3.5 text-sm text-slate-200 placeholder-slate-600 outline-none transition focus:border-violet-400/30 focus:bg-black/30"
              />
            </section>

            {needsProviderOnboarding && !providersLoading && (
              <section className="rounded-[24px] border border-amber-400/18 bg-amber-400/[0.06] px-5 py-4 text-amber-100">
                <p className="text-sm font-medium">首次启动建议先配置 Provider</p>
                <p className="mt-1 text-sm leading-6 text-amber-200/80">
                  如果你准备使用 MiniMax、OpenAI 或 Anthropic，请先前往设置保存 API Key。保存后这里会自动刷新可选模型。
                </p>
                <button
                  onClick={onOpenSettings}
                  className="mt-3 inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/10 px-3.5 py-2 text-xs font-medium text-amber-100 transition hover:bg-amber-300/14"
                >
                  <Settings size={13} />
                  前往 Provider 设置
                </button>
              </section>
            )}

            {/* Provider & Model */}
            <section className="space-y-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">模型配置（统一适用所有 Agent）</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-[11px] text-slate-500">Provider</label>
                  <select
                    value={provider}
                    onChange={(e) => {
                      if (e.target.value === provider) {
                        return;
                      }
                      setProvider(e.target.value);
                      setModel('');
                      setModels([]);
                    }}
                    disabled={providersLoading || providers.length === 0}
                    className="w-full rounded-[16px] border border-white/[0.08] bg-black/20 px-3.5 py-2.5 text-sm text-slate-200 outline-none transition focus:border-violet-400/30"
                  >
                    {providers.length === 0 && (
                      <option value="">
                        {providersLoading ? '正在检查 Provider…' : '请先完成 Provider 配置'}
                      </option>
                    )}
                    {providers.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] text-slate-500">Model</label>
                  <select
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    disabled={providersLoading || modelsLoading || !provider}
                    className="w-full rounded-[16px] border border-white/[0.08] bg-black/20 px-3.5 py-2.5 text-sm text-slate-200 outline-none transition focus:border-violet-400/30"
                  >
                    {models.length === 0 && (
                      <option value="">
                        {providersLoading
                          ? '等待 Provider 检查完成'
                          : provider
                            ? modelsLoading
                              ? '正在加载模型…'
                              : '当前 Provider 暂无模型'
                            : '完成配置后自动加载模型'}
                      </option>
                    )}
                    {model && !models.includes(model) && (
                      <option value={model}>{model}</option>
                    )}
                    {models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </section>

            <section className="space-y-3 rounded-[22px] border border-white/[0.08] bg-black/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Per-Agent Skills Routing</p>
                  <p className="mt-1 text-xs text-slate-400">
                    可为每个 Agent 设置 allow/deny skill 列表（多选 + 搜索）
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSkillRoutingEnabled((value) => !value)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition ${
                    skillRoutingEnabled
                      ? 'border-emerald-400/35 bg-emerald-400/18 text-emerald-100'
                      : 'border-white/12 bg-white/[0.05] text-slate-300'
                  }`}
                >
                  {skillRoutingEnabled ? '已启用' : '未启用'}
                </button>
              </div>

              {skillRoutingEnabled && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-500">默认策略</label>
                    <select
                      value={skillRoutingDefaultMode}
                      onChange={(event) => setSkillRoutingDefaultMode(event.target.value as 'all' | 'none')}
                      className="w-full rounded-[14px] border border-white/[0.08] bg-black/30 px-3 py-2 text-xs text-slate-200 outline-none transition focus:border-violet-400/30"
                    >
                      <option value="all">all（默认允许全部技能）</option>
                      <option value="none">none（默认不允许任何技能）</option>
                    </select>
                  </div>

                  <div className="rounded-[14px] border border-white/[0.08] bg-black/25 px-3 py-2 text-[11px] text-slate-400">
                    {skillsLoading ? '正在加载技能列表…' : `已加载 ${availableSkills.length} 个技能`}
                    {skillsLoadError ? ` · 加载失败：${skillsLoadError}` : ''}
                  </div>

                  <div className="max-h-56 space-y-3 overflow-y-auto pr-1">
                    {teamMembers.map((agent) => {
                      const draft = skillRoutingDrafts[agent.id] ?? { allow: [], deny: [] };
                      const search = skillSearchDrafts[agent.id] ?? { allow: '', deny: '' };
                      const visibility = skillVisibilityDrafts[agent.id] ?? { allow: false, deny: false };
                      const allowKeyword = search.allow.trim().toLowerCase();
                      const denyKeyword = search.deny.trim().toLowerCase();
                      const allowMatches = availableSkills.filter((skill) =>
                        !allowKeyword
                          || skill.id.toLowerCase().includes(allowKeyword)
                          || skill.name.toLowerCase().includes(allowKeyword),
                      );
                      const denyMatches = availableSkills.filter((skill) =>
                        !denyKeyword
                          || skill.id.toLowerCase().includes(denyKeyword)
                          || skill.name.toLowerCase().includes(denyKeyword),
                      );
                      const allowList = visibility.allow
                        ? allowMatches
                        : allowMatches.filter((skill) => !draft.allow.includes(skill.id));
                      const denyList = visibility.deny
                        ? denyMatches
                        : denyMatches.filter((skill) => !draft.deny.includes(skill.id));
                      return (
                        <div
                          key={agent.id}
                          className="rounded-[16px] border border-white/[0.08] bg-black/25 p-3"
                        >
                          <p className="text-xs font-medium text-white">{agent.name}</p>
                          <p className="mt-0.5 text-[11px] text-slate-500">{agent.id}</p>
                          <div className="mt-2 grid gap-3 md:grid-cols-2">
                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-300/80">Allow</p>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSkillVisibilityDrafts((previous) => ({
                                      ...previous,
                                      [agent.id]: {
                                        ...visibility,
                                        allow: !visibility.allow,
                                      },
                                    }))
                                  }
                                  className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-100"
                                >
                                  {visibility.allow ? '隐藏已选' : '显示已选'}
                                </button>
                              </div>
                              <input
                                value={search.allow}
                                onChange={(event) =>
                                  setSkillSearchDrafts((previous) => ({
                                    ...previous,
                                    [agent.id]: {
                                      ...search,
                                      allow: event.target.value,
                                    },
                                  }))
                                }
                                placeholder="搜索 skill 名称或 id"
                                className="w-full rounded-[12px] border border-emerald-400/20 bg-black/30 px-3 py-2 text-xs text-slate-200 placeholder-slate-600 outline-none transition focus:border-emerald-400/40"
                              />
                              <div className="max-h-24 space-y-1 overflow-y-auto rounded-[12px] border border-white/[0.08] bg-black/20 p-2">
                                {allowList.length === 0 && (
                                  <p className="text-[11px] text-slate-500">
                                    {allowKeyword ? '无匹配技能' : '无可选技能（已隐藏已选项）'}
                                  </p>
                                )}
                                {allowList.map((skill) => {
                                  const selected = draft.allow.includes(skill.id);
                                  return (
                                    <button
                                      key={`${agent.id}:allow:${skill.id}`}
                                      type="button"
                                      onClick={() => updateSkillSelection(agent.id, 'allow', skill.id)}
                                      className={`flex w-full items-center justify-between rounded-[10px] px-2 py-1.5 text-left text-[11px] transition ${
                                        selected
                                          ? 'bg-emerald-400/20 text-emerald-100'
                                          : 'bg-white/[0.02] text-slate-300 hover:bg-white/[0.06]'
                                      }`}
                                    >
                                      <span className="truncate pr-2">{skill.name}</span>
                                      <span className="shrink-0 text-[10px] text-slate-500">{skill.id}</span>
                                    </button>
                                  );
                                })}
                              </div>
                              {draft.allow.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                  {draft.allow.map((skillId) => (
                                    <button
                                      key={`${agent.id}:allow-tag:${skillId}`}
                                      type="button"
                                      onClick={() => updateSkillSelection(agent.id, 'allow', skillId)}
                                      className="rounded-full border border-emerald-400/25 bg-emerald-400/14 px-2 py-1 text-[10px] text-emerald-100"
                                      title="点击移除"
                                    >
                                      {skillId} ×
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-[11px] uppercase tracking-[0.18em] text-rose-300/80">Deny</p>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSkillVisibilityDrafts((previous) => ({
                                      ...previous,
                                      [agent.id]: {
                                        ...visibility,
                                        deny: !visibility.deny,
                                      },
                                    }))
                                  }
                                  className="rounded-full border border-rose-400/25 bg-rose-400/10 px-2 py-0.5 text-[10px] text-rose-100"
                                >
                                  {visibility.deny ? '隐藏已选' : '显示已选'}
                                </button>
                              </div>
                              <input
                                value={search.deny}
                                onChange={(event) =>
                                  setSkillSearchDrafts((previous) => ({
                                    ...previous,
                                    [agent.id]: {
                                      ...search,
                                      deny: event.target.value,
                                    },
                                  }))
                                }
                                placeholder="搜索 skill 名称或 id"
                                className="w-full rounded-[12px] border border-rose-400/20 bg-black/30 px-3 py-2 text-xs text-slate-200 placeholder-slate-600 outline-none transition focus:border-rose-400/40"
                              />
                              <div className="max-h-24 space-y-1 overflow-y-auto rounded-[12px] border border-white/[0.08] bg-black/20 p-2">
                                {denyList.length === 0 && (
                                  <p className="text-[11px] text-slate-500">
                                    {denyKeyword ? '无匹配技能' : '无可选技能（已隐藏已选项）'}
                                  </p>
                                )}
                                {denyList.map((skill) => {
                                  const selected = draft.deny.includes(skill.id);
                                  return (
                                    <button
                                      key={`${agent.id}:deny:${skill.id}`}
                                      type="button"
                                      onClick={() => updateSkillSelection(agent.id, 'deny', skill.id)}
                                      className={`flex w-full items-center justify-between rounded-[10px] px-2 py-1.5 text-left text-[11px] transition ${
                                        selected
                                          ? 'bg-rose-400/20 text-rose-100'
                                          : 'bg-white/[0.02] text-slate-300 hover:bg-white/[0.06]'
                                      }`}
                                    >
                                      <span className="truncate pr-2">{skill.name}</span>
                                      <span className="shrink-0 text-[10px] text-slate-500">{skill.id}</span>
                                    </button>
                                  );
                                })}
                              </div>
                              {draft.deny.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                  {draft.deny.map((skillId) => (
                                    <button
                                      key={`${agent.id}:deny-tag:${skillId}`}
                                      type="button"
                                      onClick={() => updateSkillSelection(agent.id, 'deny', skillId)}
                                      className="rounded-full border border-rose-400/25 bg-rose-400/14 px-2 py-1 text-[10px] text-rose-100"
                                      title="点击移除"
                                    >
                                      {skillId} ×
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            {error && (
              <div className="rounded-[18px] border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}
          </div>

          <div className="border-t border-white/[0.06] px-6 py-5">
            {providersLoading ? (
              <button
                disabled
                className="interactive-lift flex w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-6 py-3 text-sm font-medium text-slate-300 opacity-70"
              >
                <Loader2 size={15} className="animate-spin" />
                正在检查 Provider…
              </button>
            ) : providers.length === 0 ? (
              <button
                onClick={onOpenSettings}
                className="interactive-lift flex w-full items-center justify-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-6 py-3 text-sm font-medium text-amber-100 transition hover:bg-amber-400/14"
              >
                <Settings size={15} />
                先去配置 Provider
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || providersLoading || modelsLoading || !objective.trim() || !provider || !model}
                className="interactive-lift flex w-full items-center justify-center gap-2 rounded-full border border-violet-400/20 bg-[linear-gradient(180deg,rgba(167,139,250,0.18),rgba(167,139,250,0.07))] px-6 py-3 text-sm font-medium text-violet-100 shadow-[0_8px_20px_rgba(0,0,0,0.18)] transition hover:border-violet-400/30 hover:bg-violet-400/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    正在创建任务…
                  </>
                ) : (
                  <>
                    <Zap size={15} />
                    执行任务
                  </>
                )}
              </button>
            )}
          </div>
        </motion.aside>
      </>
    </AnimatePresence>
  );
}

export default TaskLaunchPanel;
