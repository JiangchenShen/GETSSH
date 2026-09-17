import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Send, Copy, Check, Terminal, PlayCircle, AlertTriangle } from 'lucide-react';
import { useAppStore } from '../../store/appStore';

interface MarkdownRendererProps {
  content: string;
  onPaperPlane?: (code: string) => void;
  className?: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, onPaperPlane, className = '' }) => {
  const isDark = useAppStore(state => state.isDark);
  const [copiedCode, setCopiedCode] = React.useState<string | null>(null);

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  return (
    <div className={`prose prose-sm max-w-none break-words ${isDark ? 'prose-invert' : ''} ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ node, inline, className: childClassName, children, ...props }: any) {
            const match = /language-(\w+)/.exec(childClassName || '');
            const codeString = String(children).replace(/\n$/, '');

            if (!inline && match) {
              // ── AGENT IS EXECUTING COMMAND ──────────────────────────
              if (codeString.startsWith('# [AGENT IS EXECUTING COMMAND]')) {
                const cmd = codeString.replace('# [AGENT IS EXECUTING COMMAND]', '').trim();
                return (
                  <div className={`my-3 border rounded-xl p-3 flex flex-col gap-2 shadow-sm transition-colors ${isDark ? 'bg-cyan-950/20 border-cyan-800/40' : 'bg-cyan-50 border-cyan-200'}`}>
                    <div className="flex items-center gap-2 text-[11px] font-bold tracking-wide uppercase">
                      <PlayCircle size={14} className="text-cyan-500 animate-pulse" />
                      <span className={isDark ? 'text-cyan-400' : 'text-cyan-600'}>EXECUTING</span>
                    </div>
                    <code className={`text-[11px] font-mono p-2 rounded-lg break-all block ${isDark ? 'bg-black/50 text-cyan-300' : 'bg-white shadow-sm text-cyan-700'}`}>
                      {cmd}
                    </code>
                  </div>
                );
              }

              // ── AGENT PROPOSES COMMAND (agent_semi approval) ────────
              if (codeString.startsWith('# [AGENT PROPOSES COMMAND]')) {
                const cmd = codeString.replace('# [AGENT PROPOSES COMMAND]', '').trim();
                return (
                  <div className={`my-3 border rounded-xl p-3 flex flex-col gap-2 shadow-sm ${isDark ? 'bg-amber-950/20 border-amber-800/40' : 'bg-amber-50 border-amber-200'}`}>
                    <div className="flex items-center gap-2 text-[11px] font-bold tracking-wide uppercase">
                      <AlertTriangle size={14} className={isDark ? 'text-amber-400' : 'text-amber-500'} />
                      <span className={isDark ? 'text-amber-400' : 'text-amber-600'}>AWAITING APPROVAL</span>
                    </div>
                    <code className={`text-[11px] font-mono p-2 rounded-lg break-all block ${isDark ? 'bg-black/50 text-amber-300' : 'bg-white shadow-sm text-amber-700'}`}>
                      {cmd}
                    </code>
                  </div>
                );
              }
              
              // ── AGENT COMMAND OUTPUT (final result) ────────────────
              if (codeString.startsWith('# [AGENT COMMAND OUTPUT]')) {
                const output = codeString.replace('# [AGENT COMMAND OUTPUT]', '').trim();
                return (
                  <div className={`my-3 border rounded-xl overflow-hidden shadow-sm ${isDark ? 'border-white/10' : 'border-black/10'}`}>
                    <div className={`px-3 py-1.5 text-[10px] font-mono tracking-wider uppercase border-b flex items-center gap-2 ${isDark ? 'bg-black/40 text-emerald-400/70 border-white/5' : 'bg-slate-100 text-emerald-600 border-black/5'}`}>
                      <Check size={12} /> RESULT
                    </div>
                    <div className={`p-3 overflow-x-auto max-h-[300px] overflow-y-auto text-[11px] font-mono leading-relaxed whitespace-pre-wrap ${isDark ? 'bg-[#0d0d0d] text-gray-300' : 'bg-white text-slate-700'}`}>
                      {output}
                    </div>
                  </div>
                );
              }

              // ── AGENT LIVE OUTPUT (real-time stream) ───────────────
              if (codeString.startsWith('# [AGENT LIVE OUTPUT]')) {
                const output = codeString.replace('# [AGENT LIVE OUTPUT]', '').trim();
                return (
                  <div className={`my-3 border rounded-xl overflow-hidden shadow-sm ${isDark ? 'border-cyan-900/40' : 'border-slate-200'}`}>
                    <div className={`px-3 py-1.5 text-[10px] font-mono tracking-wider uppercase border-b flex items-center gap-2 ${isDark ? 'bg-black/50 text-cyan-500/70 border-cyan-900/30' : 'bg-slate-50 text-cyan-600 border-slate-200'}`}>
                      <Terminal size={12} className="animate-pulse" /> LIVE OUTPUT
                    </div>
                    <div className={`p-3 overflow-x-auto max-h-[400px] overflow-y-auto text-[11px] font-mono leading-relaxed whitespace-pre-wrap ${isDark ? 'bg-[#080808] text-green-300/80' : 'bg-[#fafafa] text-slate-700'}`}>
                      {output || <span className={isDark ? 'text-white/20' : 'text-slate-300'}>Waiting for output...</span>}
                    </div>
                  </div>
                );
              }

              // ── Standard code block ────────────────────────────────
              return (
                <div className={`relative group my-4 rounded-xl border overflow-hidden shadow-sm ${isDark ? 'border-white/10' : 'border-black/10'}`}>
                  <div className={`flex items-center justify-between px-3 py-1.5 text-[10px] font-mono tracking-wider uppercase border-b ${isDark ? 'bg-black/40 text-white/40 border-white/5' : 'bg-slate-100 text-slate-500 border-black/5'}`}>
                    <span>{match[1]}</span>
                    <div className="flex items-center gap-1">
                      {onPaperPlane && (
                        <button
                          onClick={() => onPaperPlane(codeString)}
                          className={`p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity ${isDark ? 'hover:bg-white/10 text-cyan-400' : 'hover:bg-black/5 text-cyan-600'}`}
                          title="Inject to Terminal"
                        >
                          <Send size={12} />
                        </button>
                      )}
                      <button
                        onClick={() => handleCopy(codeString)}
                        className={`p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity ${isDark ? 'hover:bg-white/10 text-white/70' : 'hover:bg-black/5 text-slate-600'}`}
                        title="Copy code"
                      >
                        {copiedCode === codeString ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                      </button>
                    </div>
                  </div>
                  <SyntaxHighlighter
                    {...props}
                    style={isDark ? vscDarkPlus : vs}
                    language={match[1]}
                    PreTag="div"
                    customStyle={{ margin: 0, padding: '12px', background: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.5)', fontSize: '11px', borderRadius: 0 }}
                  >
                    {codeString}
                  </SyntaxHighlighter>
                </div>
              );
            }
            return (
              <code {...props} className={`${childClassName} px-1.5 py-0.5 rounded-md text-[11px] font-mono ${isDark ? 'bg-white/10 text-pink-300' : 'bg-black/5 text-pink-600'}`}>
                {children}
              </code>
            );
          },
          p({ children }) {
            return <p className="my-1.5 leading-relaxed">{children}</p>;
          },
          ul({ children }) {
            return <ul className="list-disc pl-4 my-2">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal pl-4 my-2">{children}</ol>;
          },
          li({ children }) {
            return <li className="my-0.5">{children}</li>;
          },
          a({ href, children }) {
            return <a href={href} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">{children}</a>;
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
