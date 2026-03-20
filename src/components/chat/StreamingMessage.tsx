import ReactMarkdown from 'react-markdown';

interface StreamingMessageProps {
  content: string;
  isStreaming: boolean;
}

export default function StreamingMessage({ content, isStreaming }: StreamingMessageProps) {
  return (
    <div className="relative min-h-[1.5em]">
      <div className="prose prose-invert prose-sm max-w-none leading-7 text-slate-200 [&_a]:text-cyan-300 [&_blockquote]:border-l-cyan-400/40 [&_blockquote]:text-slate-400 [&_code]:rounded [&_code]:bg-white/[0.08] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-sm [&_code]:text-cyan-100 [&_h1]:text-white [&_h2]:text-white [&_h3]:text-slate-100 [&_li]:text-slate-300 [&_pre]:rounded-[14px] [&_pre]:border [&_pre]:border-white/10 [&_pre]:bg-black/30 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:text-white">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
      {isStreaming && (
        <span
          aria-hidden="true"
          className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 rounded-sm bg-cyan-300 align-middle"
          style={{ animation: 'cursor-blink 0.9s step-end infinite' }}
        />
      )}

      <style>{`
        @keyframes cursor-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
