import React from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Send, Copy, Check, Terminal, PlayCircle, AlertTriangle } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useTranslation } from 'react-i18next';

interface MarkdownRendererProps {
  content: string;
  onPaperPlane?: (code: string) => void;
  className?: string;
}

const remarkPlugins = [remarkGfm];

export const MarkdownRenderer = React.memo(function MarkdownRenderer({ content, onPaperPlane, className = '' }: MarkdownRendererProps) {
  const isDark = useAppStore(state => state.isDark);
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const [copiedCode, setCopiedCode] = React.useState<string | null>(null);

  const handleCopy = React.useCallback((code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  }, []);

  const components = React.useMemo<Components>(() => ({
          pre({ children }) {
            return <div className="not-prose min-w-0 max-w-full overflow-x-auto whitespace-pre-wrap">{children}</div>;
          },
          code({ node, inline, className: childClassName, children, ...props }: any) {
            const match = /language-(\w+)/.exec(childClassName || '');
            const codeString = String(children).replace(/\n$/, '');

            if (!inline && match) {
              // ── AGENT IS EXECUTING COMMAND ──────────────────────────
              if (codeString.startsWith('# [AGENT IS EXECUTING COMMAND]')) {
                const cmd = codeString.replace('# [AGENT IS EXECUTING COMMAND]', '').trim();
                return (
                  <div className="my-2.5 border border-primary/30 bg-primary/5 rounded-lg p-3 flex flex-col gap-2 transition-colors">
                    <div className="flex items-center gap-2 text-[11px] font-semibold text-primary">
                      <PlayCircle size={14} className="text-primary animate-pulse" />
                      <span>EXECUTING</span>
                    </div>
                    <code className="text-[11px] font-mono p-2 rounded-md border border-line-soft bg-bg text-ink break-all block">
                      {cmd}
                    </code>
                  </div>
                );
              }

              // ── AGENT PROPOSES COMMAND (agent_semi approval) ────────
              if (codeString.startsWith('# [AGENT PROPOSES COMMAND]')) {
                const cmd = codeString.replace('# [AGENT PROPOSES COMMAND]', '').trim();
                return (
                  <div className="my-2.5 border border-warn/30 bg-warn/5 rounded-lg p-3 flex flex-col gap-2">
                    <div className="flex items-center gap-2 text-[11px] font-semibold text-warn">
                      <AlertTriangle size={14} className="text-warn" />
                      <span>AWAITING APPROVAL</span>
                    </div>
                    <code className="text-[11px] font-mono p-2 rounded-md border border-line-soft bg-bg text-ink break-all block">
                      {cmd}
                    </code>
                  </div>
                );
              }
              
              // ── AGENT COMMAND OUTPUT (final result) ────────────────
              if (codeString.startsWith('# [AGENT COMMAND OUTPUT]')) {
                const output = codeString.replace('# [AGENT COMMAND OUTPUT]', '').trim();
                return (
                  <div className="my-2.5 border border-line rounded-lg overflow-hidden">
                    <div className="px-3 py-1.5 text-[10px] font-mono border-b border-line-soft bg-panel text-ok flex items-center gap-2">
                      <Check size={12} /> RESULT
                    </div>
                    <div className="p-3 overflow-x-auto max-h-[300px] overflow-y-auto text-[11px] font-mono leading-relaxed whitespace-pre-wrap bg-bg text-ink">
                      {output}
                    </div>
                  </div>
                );
              }

              // ── AGENT LIVE OUTPUT (real-time stream) ───────────────
              if (codeString.startsWith('# [AGENT LIVE OUTPUT]')) {
                const output = codeString.replace('# [AGENT LIVE OUTPUT]', '').trim();
                return (
                  <div className="my-2.5 border border-line rounded-lg overflow-hidden">
                    <div className="px-3 py-1.5 text-[10px] font-mono border-b border-line-soft bg-panel text-primary flex items-center gap-2">
                      <Terminal size={12} className="animate-pulse" /> LIVE OUTPUT
                    </div>
                    <div className="p-3 overflow-x-auto max-h-[400px] overflow-y-auto text-[11px] font-mono leading-relaxed whitespace-pre-wrap bg-bg text-ink">
                      {output || <span className="text-ink-3">Waiting for output...</span>}
                    </div>
                  </div>
                );
              }

              // ── Standard code block ────────────────────────────────
              return (
                <div className="relative group my-3 rounded-lg border border-line overflow-hidden bg-bg">
                  <div className="flex items-center justify-between px-3 py-1.5 text-[11px] font-mono border-b border-line-soft bg-panel text-ink-3">
                    <span>{match[1]}</span>
                    <div className="flex items-center gap-1">
                      {onPaperPlane && (
                        <button
                          type="button"
                          onClick={() => onPaperPlane(codeString)}
                          className="rounded p-1 text-ink-2 hover:bg-surf-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
                          title={zh ? '注入目标终端' : 'Inject to terminal'}
                          aria-label={zh ? '注入目标终端' : 'Inject to terminal'}
                        >
                          <Send size={12} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleCopy(codeString)}
                        className="rounded p-1 text-ink-2 hover:bg-surf-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
                        title={zh ? '复制代码' : 'Copy code'}
                        aria-label={zh ? '复制代码' : 'Copy code'}
                      >
                        {copiedCode === codeString ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
                      </button>
                    </div>
                  </div>
                  <SyntaxHighlighter
                    {...props}
                    style={isDark ? vscDarkPlus : vs}
                    language={match[1]}
                    PreTag="div"
                    customStyle={{ margin: 0, padding: '12px', background: 'transparent', fontSize: '11px', borderRadius: 0 }}
                  >
                    {codeString}
                  </SyntaxHighlighter>
                </div>
              );
            }
            return (
              <code {...props} className={`${childClassName} px-1.5 py-0.5 rounded border border-line-soft bg-surf-2 text-ink text-[11px] font-mono`}>
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
            return <a href={href} target="_blank" rel="noreferrer" className="text-primary hover:underline">{children}</a>;
          }
  }), [isDark, zh, copiedCode, handleCopy, onPaperPlane]);

  return (
    <div className={`prose prose-sm max-w-none break-words ${isDark ? 'prose-invert' : ''} ${className}`}>
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
});
