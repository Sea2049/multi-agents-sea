import { useMemo } from 'react';
import type { ChatMessage } from '../../lib/api-client';
import StreamingMessage from './StreamingMessage';

interface MessageBubbleProps {
  message: ChatMessage;
  isStreaming?: boolean;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);

  if (seconds < 10) return '刚刚';
  if (seconds < 60) return `${seconds}秒前`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;

  const days = Math.floor(hours / 24);
  return `${days}天前`;
}

export default function MessageBubble({ message, isStreaming = false }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  const timeLabel = useMemo(
    () => formatRelativeTime(message.createdAt),
    // recompute only when createdAt changes; caller re-renders periodically if needed
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [message.createdAt]
  );

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[78%]">
          <div className="rounded-[20px] rounded-br-[6px] border border-cyan-400/20 bg-[linear-gradient(180deg,rgba(103,194,255,0.16),rgba(103,194,255,0.08))] px-4 py-3">
            <p className="whitespace-pre-wrap text-sm leading-7 text-slate-100">{message.content}</p>
          </div>
          <p className="mt-1 pr-1 text-right text-[11px] text-slate-600">{timeLabel}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[84%]">
        <div className="rounded-[20px] rounded-bl-[6px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] px-4 py-3">
          <StreamingMessage content={message.content} isStreaming={isStreaming} />
        </div>
        <p className="mt-1 pl-1 text-[11px] text-slate-600">{timeLabel}</p>
      </div>
    </div>
  );
}
