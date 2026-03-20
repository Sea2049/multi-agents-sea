export interface Session {
  id: string;
  agentId: string;
  provider: string;
  model: string;
  createdAt: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface SessionWithMessages extends Session {
  messages: ChatMessage[];
}

export interface ChatChunk {
  delta: string;
  done: boolean;
  error?: string;
}

export interface ProviderConfig {
  name: string;
  label: string;
  description: string;
  hint: string;
  kind: 'cloud' | 'local';
  iconKey: string;
  configured: boolean;
  hasKey: boolean;
  defaultModel?: string;
  settingsSchema: ProviderFieldSchema[];
}

export interface ProviderFieldSchema {
  key: string;
  label: string;
  inputType: 'secret' | 'url' | 'text';
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  storageKey: string;
  envVar: string;
  currentValue?: string | null;
}

interface ProvidersResponse {
  providers: Array<{
    name: string;
    label: string;
    description: string;
    hint: string;
    kind: 'cloud' | 'local';
    iconKey: string;
    configured: boolean;
    defaultModel: string | null;
    settingsSchema: ProviderFieldSchema[];
  }>;
}

interface ProviderModelsResponse {
  provider: string;
  models: ModelInfo[];
}

export type StepStatus = 'pending' | 'running' | 'pending_approval' | 'completed' | 'failed' | 'skipped';
export type TaskStatus = 'pending' | 'planning' | 'running' | 'completed' | 'failed';

export interface TaskStep {
  id: string;
  title: string;
  kind?: 'agent' | 'tool' | 'gate' | 'condition';
  assignee: string;
  dependsOn: string[];
  objective: string;
  expectedOutput: string;
}

export interface TaskPlan {
  taskId: string;
  summary: string;
  steps: TaskStep[];
}

export interface TaskStepRecord {
  id: string;
  taskId?: string;
  agentId: string;
  status: StepStatus;
  objective: string;
  result?: string;
  summary?: string;
  error?: string;
  tokenCount?: number;
  startedAt?: number;
  completedAt?: number;
}

export interface TaskRecord {
  id: string;
  status: TaskStatus;
  kind?: string;
  teamMembers?: Array<{ agentId: string; provider: string; model: string }>;
  objective: string;
  plan?: TaskPlan;
  pipelineId?: string | null;
  pipelineVersion?: number | null;
  result?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  steps?: TaskStepRecord[];
}

export type PipelineConditionOperator = 'exists' | 'contains' | 'equals' | 'not_contains';

interface PipelineBaseStep {
  id: string;
  title: string;
  kind: 'llm' | 'tool' | 'gate' | 'condition';
  dependsOn?: string[];
  objective: string;
}

export interface PipelineLlmStep extends PipelineBaseStep {
  kind: 'llm';
  assignee: string;
  expectedOutput?: string;
  provider?: string;
  model?: string;
}

export interface PipelineToolStep extends PipelineBaseStep {
  kind: 'tool';
  toolName: string;
  inputTemplate: string;
  expectedOutput?: string;
}

export interface PipelineGateStep extends PipelineBaseStep {
  kind: 'gate';
  instructions?: string;
}

export interface PipelineConditionStep extends PipelineBaseStep {
  kind: 'condition';
  sourceStepId: string;
  operator: PipelineConditionOperator;
  value?: string;
  onTrue?: string[];
  onFalse?: string[];
}

export type PipelineStep = PipelineLlmStep | PipelineToolStep | PipelineGateStep | PipelineConditionStep;

export interface PipelineDefinition {
  id: string;
  name: string;
  description?: string;
  version: number;
  runtimeDefaults?: {
    provider?: string;
    model?: string;
  };
  steps: PipelineStep[];
}

export interface PipelineSummary {
  id: string;
  name: string;
  description?: string;
  version: number;
  runtimeDefaults?: {
    provider?: string;
    model?: string;
  } | null;
  stepCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface TaskExecutionEvent {
  type: 'task_started' | 'step_started' | 'step_waiting' | 'step_completed' | 'step_skipped' | 'step_failed' | 'task_completed' | 'task_failed' | 'tool_call_started' | 'tool_call_completed';
  taskId: string;
  stepId?: string;
  agentId?: string;
  output?: string;
  error?: string;
  timestamp: number;
  toolCallId?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  toolIsError?: boolean;
}

export interface CreateTaskParams {
  objective: string;
  teamMembers: Array<{ agentId: string; provider: string; model: string }>;
}

export interface ModelInfo {
  id: string;
  name: string;
}

export interface MemoryRecord {
  id: string;
  agentId?: string;
  taskId?: string;
  category: string;
  content: string;
  source: string;
  createdAt: number;
  isPinned: boolean;
  pinnedAt?: number;
  pinSource?: 'auto' | 'manual';
  pinReason?: string;
}

export interface SkillRecord {
  id: string;
  name: string;
  description: string;
  version?: string | null;
  source: 'workspace' | 'user' | 'bundled';
  mode: 'prompt-only' | 'tool-contributor';
  homepage?: string | null;
  enabled: boolean;
  trusted: boolean;
  eligible: boolean;
  disabledReasons: string[];
}

async function getBaseUrl(): Promise<string> {
  if (typeof window !== 'undefined') {
    const w = window as unknown as { api?: { getServerBaseUrl?: () => Promise<string> } };
    if (w.api?.getServerBaseUrl) {
      return w.api.getServerBaseUrl();
    }
  }
  return 'http://127.0.0.1:3000';
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const base = await getBaseUrl();
  const headers = new Headers(options?.headers ?? {});
  const hasBody = options?.body !== undefined && options?.body !== null;
  const isFormData =
    typeof FormData !== 'undefined' && options?.body instanceof FormData;

  if (hasBody && !isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${base}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  if (res.status === 204 || res.status === 205) {
    return undefined as T;
  }

  const text = await res.text();
  if (!text.trim()) {
    return undefined as T;
  }

  return JSON.parse(text) as T;
}

export const apiClient = {
  async createSession(agentId: string, provider: string, model: string): Promise<Session> {
    return request<Session>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ agentId, provider, model }),
    });
  },

  async getSession(sessionId: string): Promise<SessionWithMessages> {
    return request<SessionWithMessages>(`/sessions/${sessionId}`);
  },

  async deleteSession(sessionId: string): Promise<void> {
    await request<unknown>(`/sessions/${sessionId}`, { method: 'DELETE' });
  },

  async *chatStream(sessionId: string, message: string): AsyncIterable<ChatChunk> {
    const base = await getBaseUrl();
    const url = `${base}/sessions/${sessionId}/chat`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      yield { delta: '', done: true, error: `HTTP ${res.status}: ${text}` };
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      yield { delta: '', done: true, error: 'No response body' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;

          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') {
            yield { delta: '', done: true };
            return;
          }

          try {
            const chunk = JSON.parse(data) as ChatChunk;
            yield chunk;
            if (chunk.done) return;
          } catch {
            // skip malformed SSE lines
          }
        }
      }

      yield { delta: '', done: true };
    } finally {
      reader.releaseLock();
    }
  },

  async getProviders(): Promise<ProviderConfig[]> {
    const response = await request<ProvidersResponse>('/api/settings/providers');
    return response.providers.map((provider) => ({
      name: provider.name,
      label: provider.label,
      description: provider.description,
      hint: provider.hint,
      kind: provider.kind,
      iconKey: provider.iconKey,
      configured: provider.configured,
      hasKey: provider.configured,
      defaultModel: provider.defaultModel ?? undefined,
      settingsSchema: provider.settingsSchema,
    }));
  },

  async getModels(provider: string): Promise<ModelInfo[]> {
    const response = await request<ProviderModelsResponse>(
      `/api/settings/providers/${encodeURIComponent(provider)}/models`
    );
    return response.models;
  },

  async validateProvider(provider: string): Promise<{ ok: boolean; error?: string }> {
    return request<{ ok: boolean; error?: string }>(
      `/api/settings/providers/${encodeURIComponent(provider)}/validate`,
      { method: 'POST' }
    );
  },

  async setDefaultModel(provider: string, model: string): Promise<void> {
    await request<unknown>(`/api/settings/providers/${encodeURIComponent(provider)}/model`, {
      method: 'POST',
      body: JSON.stringify({ model }),
    });
  },

  // ─── Memory ────────────────────────────────────────────────────────────────

  memory: {
    list(params?: { agentId?: string; taskId?: string; category?: string; q?: string; limit?: number }): Promise<{ memories: MemoryRecord[] }> {
      const query = new URLSearchParams()
      if (params?.agentId) query.set('agentId', params.agentId)
      if (params?.taskId) query.set('taskId', params.taskId)
      if (params?.category) query.set('category', params.category)
      if (params?.q) query.set('q', params.q)
      if (params?.limit !== undefined) query.set('limit', String(params.limit))
      const qs = query.toString()
      return request<{ memories: MemoryRecord[] }>(`/api/memories${qs ? `?${qs}` : ''}`)
    },

    save(data: { content: string; agentId?: string; taskId?: string; category?: string; isPinned?: boolean; pinReason?: string }): Promise<{ memory: MemoryRecord }> {
      return request<{ memory: MemoryRecord }>('/api/memories', {
        method: 'POST',
        body: JSON.stringify(data),
      })
    },

    async delete(id: string): Promise<void> {
      const base = await getBaseUrl()
      const res = await fetch(`${base}/api/memories/${id}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 204) {
        const text = await res.text().catch(() => res.statusText)
        throw new Error(`HTTP ${res.status}: ${text}`)
      }
    },

    bulkDelete(ids: string[]): Promise<{ deleted: number }> {
      return request<{ deleted: number }>('/api/memories/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      })
    },

    pin(id: string, params: { pinned: boolean; pinReason?: string }): Promise<{ memory: MemoryRecord }> {
      return request<{ memory: MemoryRecord }>(`/api/memories/${id}/pin`, {
        method: 'POST',
        body: JSON.stringify(params),
      })
    },
  },

  // ─── Skills ────────────────────────────────────────────────────────────────

  skills: {
    list(): Promise<{ version: number; skills: SkillRecord[] }> {
      return request<{ version: number; skills: SkillRecord[] }>('/api/skills')
    },

    enable(id: string): Promise<{ ok: boolean; skillId: string; enabled: boolean }> {
      return request<{ ok: boolean; skillId: string; enabled: boolean }>(`/api/skills/${encodeURIComponent(id)}/enable`, {
        method: 'POST',
      })
    },

    disable(id: string): Promise<{ ok: boolean; skillId: string; enabled: boolean }> {
      return request<{ ok: boolean; skillId: string; enabled: boolean }>(`/api/skills/${encodeURIComponent(id)}/disable`, {
        method: 'POST',
      })
    },

    trust(id: string): Promise<{ ok: boolean; skillId: string; trusted: boolean }> {
      return request<{ ok: boolean; skillId: string; trusted: boolean }>(`/api/skills/${encodeURIComponent(id)}/trust`, {
        method: 'POST',
      })
    },

    untrust(id: string): Promise<{ ok: boolean; skillId: string; trusted: boolean }> {
      return request<{ ok: boolean; skillId: string; trusted: boolean }>(`/api/skills/${encodeURIComponent(id)}/untrust`, {
        method: 'POST',
      })
    },
  },

  tasks: {
    async create(params: CreateTaskParams): Promise<{ taskId: string }> {
      const created = await request<{ id: string }>('/api/tasks', {
        method: 'POST',
        body: JSON.stringify(params),
      });
      return { taskId: created.id };
    },

    async get(taskId: string): Promise<TaskRecord> {
      return request<TaskRecord>(`/api/tasks/${taskId}`);
    },

    async list(): Promise<TaskRecord[]> {
      return request<TaskRecord[]>('/api/tasks');
    },

    async delete(taskId: string): Promise<void> {
      await request<unknown>(`/api/tasks/${taskId}`, { method: 'DELETE' });
    },

    approveStep(taskId: string, stepId: string): Promise<{ ok: boolean }> {
      return request<{ ok: boolean }>(`/api/tasks/${encodeURIComponent(taskId)}/steps/${encodeURIComponent(stepId)}/approve`, {
        method: 'POST',
      });
    },

    rejectStep(taskId: string, stepId: string): Promise<{ ok: boolean }> {
      return request<{ ok: boolean }>(`/api/tasks/${encodeURIComponent(taskId)}/steps/${encodeURIComponent(stepId)}/reject`, {
        method: 'POST',
      });
    },

    async *streamEvents(taskId: string, options?: { signal?: AbortSignal }): AsyncIterable<TaskExecutionEvent> {
      const base = await getBaseUrl();
      const url = `${base}/api/tasks/${taskId}/stream`;

      const res = await fetch(url, {
        headers: { Accept: 'text/event-stream' },
        signal: options?.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => res.statusText)}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;

            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') return;

            try {
              const event = JSON.parse(data) as TaskExecutionEvent;
              yield event;
            } catch {
              // skip malformed SSE lines
            }
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    },
  },

  pipelines: {
    list(): Promise<{ pipelines: PipelineSummary[] }> {
      return request<{ pipelines: PipelineSummary[] }>('/api/pipelines');
    },

    get(id: string): Promise<{ pipeline: { id: string; name: string; description?: string; version: number; definition: PipelineDefinition; createdAt: number; updatedAt: number } }> {
      return request(`/api/pipelines/${encodeURIComponent(id)}`);
    },

    create(payload: {
      name: string;
      description?: string;
      runtimeDefaults?: { provider?: string; model?: string };
      steps: PipelineStep[];
    }): Promise<{ pipeline: { definition: PipelineDefinition; id: string; name: string; description?: string; version: number; createdAt: number; updatedAt: number } }> {
      return request('/api/pipelines', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    update(id: string, payload: {
      name: string;
      description?: string;
      runtimeDefaults?: { provider?: string; model?: string };
      steps: PipelineStep[];
    }): Promise<{ pipeline: { definition: PipelineDefinition; id: string; name: string; description?: string; version: number; createdAt: number; updatedAt: number } }> {
      return request(`/api/pipelines/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    },

    async delete(id: string): Promise<void> {
      const base = await getBaseUrl();
      const res = await fetch(`${base}/api/pipelines/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
    },

    run(id: string, payload?: {
      objective?: string;
      provider?: string;
      model?: string;
    }): Promise<{ id: string; status: string; kind: string; objective: string; pipelineId: string; pipelineVersion: number; createdAt: number }> {
      return request(`/api/pipelines/${encodeURIComponent(id)}/run`, {
        method: 'POST',
        body: JSON.stringify(payload ?? {}),
      });
    },
  },
};
