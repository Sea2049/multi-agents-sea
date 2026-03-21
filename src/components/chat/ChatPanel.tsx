import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  ChevronDown,
  Loader2,
  MessageSquare,
  Send,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Agent, Division } from '../../data/agents';
import {
  apiClient,
  type ChatMessage,
  type ModelInfo,
  type ProviderConfig,
  type Session,
} from '../../lib/api-client';
import MessageBubble from './MessageBubble';

interface ChatPanelProps {
  agent: Agent | null;
  division: Division | null;
  onClose: () => void;
  onOpenSettings: () => void;
  providerConfigVersion: number;
}

interface StreamingState {
  messageId: string;
  content: string;
}

const SESSION_STORE_KEY = 'chat-session-map';

function sortConfiguredProviders(providers: ProviderConfig[]): ProviderConfig[] {
  return [...providers].sort((left, right) => {
    if (right.priority !== left.priority) {
      return right.priority - left.priority;
    }
    if (left.kind !== right.kind) {
      return left.kind === 'cloud' ? -1 : 1;
    }
    return left.label.localeCompare(right.label);
  });
}

function loadSessionMap(): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(SESSION_STORE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveSessionMap(map: Record<string, string>) {
  try {
    sessionStorage.setItem(SESSION_STORE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export default function ChatPanel({
  agent,
  division,
  onClose,
  onOpenSettings,
  providerConfigVersion,
}: ChatPanelProps) {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [providersLoading, setProvidersLoading] = useState(true);
  const [noProvider, setNoProvider] = useState(false);

  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);

  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sessionMapRef = useRef<Record<string, string>>(loadSessionMap());

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streaming?.content, scrollToBottom]);

  // Load providers when settings change
  useEffect(() => {
    let cancelled = false;

    setProvidersLoading(true);
    apiClient
      .getProviders()
      .then((list) => {
        if (cancelled) return;
        setProviders(list);

        const configured = list.filter((provider) => provider.configured);
        const sortedConfigured = sortConfiguredProviders(configured);
        if (configured.length === 0) {
          setNoProvider(true);
          setSelectedProvider('');
          setSelectedModel('');
          setModels([]);
          setProvidersLoading(false);
          return;
        }

        setNoProvider(false);
        const preferred = sortedConfigured[0];
        setSelectedProvider((current) => {
          if (current && sortedConfigured.some((provider) => provider.name === current)) {
            return current;
          }
          return preferred.name;
        });
        setSelectedModel((current) => current || preferred.defaultModel || '');
        setProvidersLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setNoProvider(true);
        setSelectedProvider('');
        setSelectedModel('');
        setModels([]);
        setProvidersLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [providerConfigVersion]);

  // Load models when provider changes
  useEffect(() => {
    let cancelled = false;

    if (!selectedProvider) {
      setModels([]);
      setSelectedModel('');
      return () => {
        cancelled = true;
      };
    }

    setModels([]);

    apiClient
      .getModels(selectedProvider)
      .then((list) => {
        if (cancelled) return;
        setModels(list);
        setSelectedModel((current) => {
          if (list.length === 0) {
            return '';
          }
          if (current && list.some((model) => model.id === current)) {
            return current;
          }
          return list[0].id;
        });
      })
      .catch(() => {
        if (cancelled) return;
        setModels([]);
        setSelectedModel('');
      });

    return () => {
      cancelled = true;
    };
  }, [selectedProvider]);

  // Restore or create session when agent/provider/model changes
  useEffect(() => {
    if (!agent || !selectedProvider || !selectedModel) return;
    let cancelled = false;

    const sessionKey = `${agent.id}::${selectedProvider}::${selectedModel}`;
    const existingSessionId = sessionMapRef.current[sessionKey];

    setSessionLoading(true);
    setError(null);

    const restore = async () => {
      if (existingSessionId) {
        try {
          const data = await apiClient.getSession(existingSessionId);
          if (!cancelled) {
            setSession(data);
            setMessages(data.messages);
            setSessionLoading(false);
            return;
          }
        } catch {
          // session expired, create new one
        }
      }

      try {
        const newSession = await apiClient.createSession(agent.id, selectedProvider, selectedModel);
        if (!cancelled) {
          sessionMapRef.current[sessionKey] = newSession.id;
          saveSessionMap(sessionMapRef.current);
          setSession(newSession);
          setMessages([]);
          setSessionLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setSessionLoading(false);
        }
      }
    };

    void restore();

    return () => {
      cancelled = true;
    };
  }, [agent, selectedProvider, selectedModel]);

  const handleSend = useCallback(async () => {
    if (!inputText.trim() || sending || !session) return;

    const text = inputText.trim();
    setInputText('');
    setSending(true);
    setError(null);

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);

    const assistantId = `assistant-${Date.now()}`;
    setStreaming({ messageId: assistantId, content: '' });

    let accumulated = '';
    let hasStreamError = false;

    try {
      for await (const chunk of apiClient.chatStream(session.id, text)) {
        if (chunk.error) {
          setError(chunk.error);
          hasStreamError = true;
          break;
        }
        accumulated += chunk.delta;
        setStreaming({ messageId: assistantId, content: accumulated });
        if (chunk.done) break;
      }

      if (!hasStreamError && accumulated.trim()) {
        const assistantMsg: ChatMessage = {
          id: assistantId,
          role: 'assistant',
          content: accumulated,
          createdAt: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStreaming(null);
      setSending(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [inputText, sending, session]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  const handleClearSession = useCallback(async () => {
    if (!session) return;

    try {
      await apiClient.deleteSession(session.id);
    } catch {
      // best-effort
    }

    const sessionKey = `${agent?.id}::${selectedProvider}::${selectedModel}`;
    delete sessionMapRef.current[sessionKey];
    saveSessionMap(sessionMapRef.current);

    setSession(null);
    setMessages([]);
    setError(null);

    // Trigger re-creation
    if (agent && selectedProvider && selectedModel) {
      setSessionLoading(true);
      try {
        const newSession = await apiClient.createSession(agent.id, selectedProvider, selectedModel);
        const newKey = `${agent.id}::${selectedProvider}::${selectedModel}`;
        sessionMapRef.current[newKey] = newSession.id;
        saveSessionMap(sessionMapRef.current);
        setSession(newSession);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSessionLoading(false);
      }
    }
  }, [session, agent, selectedProvider, selectedModel]);

  const configuredProviders = useMemo(
    () => providers.filter((provider) => provider.configured),
    [providers]
  );

  const displayMessages = useMemo((): Array<{ msg: ChatMessage; isStreaming: boolean }> => {
    const base = messages.map((m) => ({ msg: m, isStreaming: false }));
    if (streaming) {
      base.push({
        msg: {
          id: streaming.messageId,
          role: 'assistant',
          content: streaming.content,
          createdAt: Date.now(),
        },
        isStreaming: true,
      });
    }
    return base;
  }, [messages, streaming]);

  return (
    <AnimatePresence>
      {agent && division && (
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
            className="panel-surface-strong fixed right-0 top-0 z-50 flex h-screen w-full max-w-[720px] flex-col border-l border-white/10 bg-[#06101d]/96 shadow-[-24px_0_80px_rgba(2,6,23,0.45)] backdrop-blur-xl"
            style={{ paddingTop: 'env(titlebar-area-height, 0px)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="panel-grid flex items-center justify-between border-b border-white/10 px-6 py-4">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[18px] border text-xl"
                  style={{
                    backgroundColor: `${division.color}18`,
                    borderColor: `${division.color}33`,
                  }}
                >
                  {agent.emoji}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="instrument-tag rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.22em]">
                      Chat
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-slate-400">
                      {division.nameZh}
                    </span>
                  </div>
                  <h2
                    className="mt-1 text-lg font-semibold text-white"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {agent.name}
                  </h2>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleClearSession}
                  title="清空对话"
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-2.5 text-slate-400 transition hover:border-white/16 hover:bg-white/[0.06] hover:text-white"
                >
                  <Trash2 size={16} />
                </button>
                <button
                  onClick={onClose}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-2.5 text-slate-300 transition hover:border-white/16 hover:bg-white/[0.06] hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Provider / Model Toolbar */}
            <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-6 py-3">
              {providersLoading ? (
                <span className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Loader2 size={12} className="animate-spin" />
                  加载 Provider…
                </span>
              ) : noProvider ? (
                <button
                  onClick={onOpenSettings}
                  className="flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/[0.06] px-3 py-1.5 text-xs text-amber-200 transition hover:bg-amber-400/10"
                >
                  <Settings size={12} />
                  未配置 Provider，点击前往设置
                </button>
              ) : (
                <>
                  <div className="relative">
                    <select
                      value={selectedProvider}
                      onChange={(e) => {
                        setSelectedProvider(e.target.value);
                        setSelectedModel('');
                      }}
                      className="appearance-none rounded-full border border-white/10 bg-white/[0.04] py-1.5 pl-3 pr-7 text-xs text-slate-200 focus:border-white/20 focus:outline-none"
                    >
                      {configuredProviders.map((p) => (
                        <option key={p.name} value={p.name} className="bg-slate-900">
                          {p.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={11}
                      className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500"
                    />
                  </div>

                  {models.length > 0 && (
                    <div className="relative">
                      <select
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        className="appearance-none rounded-full border border-white/10 bg-white/[0.04] py-1.5 pl-3 pr-7 text-xs text-slate-200 focus:border-white/20 focus:outline-none"
                      >
                        {models.map((m) => (
                          <option key={m.id} value={m.id} className="bg-slate-900">
                            {m.name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={11}
                        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500"
                      />
                    </div>
                  )}

                  <button
                    onClick={onOpenSettings}
                    className="ml-auto rounded-full border border-white/10 bg-white/[0.03] p-1.5 text-slate-400 transition hover:border-white/16 hover:bg-white/[0.06] hover:text-white"
                    title="Provider 设置"
                  >
                    <Settings size={13} />
                  </button>
                </>
              )}
            </div>

            {/* Messages Area */}
            <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
              {sessionLoading ? (
                <div className="flex h-full items-center justify-center">
                  <div className="flex flex-col items-center gap-3 text-center">
                    <Loader2 size={24} className="animate-spin text-slate-500" />
                    <p className="text-sm text-slate-500">正在建立会话…</p>
                  </div>
                </div>
              ) : displayMessages.length === 0 ? (
                <div className="flex h-full items-center justify-center">
                  <div className="flex flex-col items-center gap-4 text-center">
                    <div
                      className="flex h-16 w-16 items-center justify-center rounded-[24px] border text-3xl"
                      style={{
                        backgroundColor: `${division.color}18`,
                        borderColor: `${division.color}33`,
                      }}
                    >
                      {agent.emoji}
                    </div>
                    <div>
                      <p className="font-medium text-slate-200">{agent.name}</p>
                      <p className="mt-1 max-w-[280px] text-sm text-slate-500">{agent.vibe}</p>
                    </div>
                    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">
                      <MessageSquare size={13} className="text-slate-500" />
                      <span className="text-xs text-slate-500">发送消息开始对话</span>
                    </div>
                  </div>
                </div>
              ) : (
                displayMessages.map(({ msg, isStreaming: streaming }) => (
                  <MessageBubble key={msg.id} message={msg} isStreaming={streaming} />
                ))
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-[18px] border border-red-400/15 bg-red-400/[0.06] px-4 py-3 text-sm text-red-300">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="border-t border-white/10 px-6 py-4">
              <div className="flex items-end gap-3 rounded-[22px] border border-white/10 bg-white/[0.04] px-4 py-3 focus-within:border-white/20 focus-within:bg-white/[0.06]">
                <textarea
                  ref={textareaRef}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={`向 ${agent.name} 发送消息…`}
                  rows={1}
                  disabled={sending || sessionLoading || noProvider}
                  className="max-h-36 flex-1 resize-none bg-transparent text-sm leading-7 text-slate-100 placeholder:text-slate-600 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    scrollbarWidth: 'thin',
                    scrollbarColor: 'rgba(255,255,255,0.1) transparent',
                  }}
                  onInput={(e) => {
                    const target = e.currentTarget;
                    target.style.height = 'auto';
                    target.style.height = `${Math.min(target.scrollHeight, 144)}px`;
                  }}
                />
                <button
                  onClick={() => void handleSend()}
                  disabled={!inputText.trim() || sending || sessionLoading || noProvider}
                  className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-cyan-400/25 bg-cyan-400/15 text-cyan-200 transition hover:bg-cyan-400/25 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {sending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Send size={14} />
                  )}
                </button>
              </div>
              <p className="mt-2 px-1 text-[11px] text-slate-600">
                Enter 发送 · Shift+Enter 换行
              </p>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
