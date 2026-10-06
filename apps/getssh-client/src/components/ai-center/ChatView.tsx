import React, { useRef, useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Bot, User, RefreshCcw } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useAiChatStore } from '../../store/aiChatStore';
import { MarkdownRenderer } from '../common/MarkdownRenderer';
import { parseThoughtProcess, ThoughtProcessBlock } from '../common/ThoughtProcessBlock';
import { ThinkingIndicator, StreamCursor } from './shared';
import { ApprovalCard } from './ApprovalCard';

export const ChatView: React.FC<{ 
  onPaperPlane: (code: string) => void; 
  onRetry: (msgId: string, text: string) => void;
  onServerSelect: (msgId: string, serverId: string, serverName: string) => void;
}> = ({ onPaperPlane, onRetry, onServerSelect }) => {
  const { t, i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const reduceMotion = useReducedMotion();
  const isDark = useAppStore(state => state.isDark);
  const conversations = useAiChatStore(s => s.conversations);
  const activeConversationId = useAiChatStore(s => s.activeConversationId);
  const scrollEndRef = useRef<HTMLDivElement>(null);

  const activeConv = conversations.find(c => c.id === activeConversationId);
  const messages = activeConv?.messages ?? [];

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [messages.length, messages[messages.length - 1]?.content, reduceMotion]);

  if (messages.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <Bot className="mb-2 h-8 w-8 text-ink-3" />
        <div className="text-base font-medium text-ink-2">
          {zh ? '想从哪里开始？' : 'Where would you like to start?'}
        </div>
        <p className="max-w-sm text-xs leading-relaxed text-ink-3">
          {zh ? '可以问服务器排障、日志分析或脚本编写。需要终端上下文时，请先选定目标。' : 'Ask about troubleshooting, logs or scripts. Select a target when you need terminal context.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-5">
      {messages.map(msg => (
        <motion.div
          key={msg.id}
          initial={reduceMotion ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
          className={`group flex gap-3 w-full ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
        >
          <div className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
            msg.role === 'user'
              ? 'bg-primary/15 text-primary'
              : 'bg-surf-2 text-ink-2'
          }`}>
            {msg.role === 'user' ? <User size={14} /> : <Bot size={14} />}
          </div>
          
          <div className={`flex min-w-0 max-w-[85%] flex-col gap-1.5 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div className="flex items-center gap-2">
              <span className="px-1 text-[10px] text-ink-3">
                {msg.role === 'user' ? (zh ? '你' : 'You') : 'GETSSH AI'} · {new Date(msg.timestamp).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })}
              </span>
              {msg.role === 'assistant' && !msg.isThinking && !msg.isStreaming && (
                <button
                  onClick={() => {
                    const idx = messages.findIndex(m => m.id === msg.id);
                    const before = messages.slice(0, idx);
                    const lastUser = [...before].reverse().find(m => m.role === 'user');
                    if (lastUser) {
                      onRetry(msg.id, lastUser.content);
                    }
                  }}
                  type="button"
                  className="rounded p-1 text-ink-3 transition-colors hover:bg-surf-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"
                  title={t('ai.retry', '重试 (Retry)')}
                  aria-label={t('ai.retry', '重试 (Retry)')}
                >
                  <RefreshCcw size={12} />
                </button>
              )}
            </div>
            
            {msg.isThinking ? (
              <div className="rounded-md border border-line bg-surf px-3 py-2">
                <ThinkingIndicator />
              </div>
            ) : (() => {
              const { thoughtProcess, actualContent, isThinkingDone } = parseThoughtProcess(msg.content);
              return (
              <div className={`flex min-w-0 max-w-full flex-col break-words rounded-lg px-4 py-3 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-primary/10 text-ink'
                  : 'border border-line bg-surf text-ink'
              }`}>
                {msg.role === 'assistant' && thoughtProcess && (
                  <ThoughtProcessBlock thoughtProcess={thoughtProcess} isDark={isDark} isThinkingDone={isThinkingDone} />
                )}
                {msg.role === 'user'
                  ? <p className="whitespace-pre-wrap break-words">{actualContent}</p>
                  : (actualContent ? <MarkdownRenderer content={actualContent} onPaperPlane={onPaperPlane} className="min-w-0 max-w-full" /> : null)
                }
                {msg.isStreaming && <StreamCursor />}
                
                {msg.approvalRequest && <ApprovalCard msg={msg} activeConversationId={activeConversationId} />}

                {msg.serverSelectionRequest && (
                  <div className="mt-4 rounded-md border border-line bg-panel p-3">
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-ink">
                      <Bot size={16} /> {zh ? '选择目标终端' : 'Select a target terminal'}
                    </div>
                    {msg.serverSelectionRequest.status === 'resolved' ? (
                      <div className="text-xs opacity-70">
                        ✓ {zh ? '已选择' : 'Selected'}: {msg.serverSelectionRequest.availableServers.find((s: any) => s.id === msg.serverSelectionRequest!.selectedServerId)?.name}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {msg.serverSelectionRequest.availableServers.map((server: any) => (
                          <button
                            key={server.id}
                            onClick={() => onServerSelect(msg.id, server.id, server.name)}
                            type="button"
                            className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-left text-xs text-ink-2 transition-colors hover:bg-surf-2 focus-visible:outline-2 focus-visible:outline-primary"
                          >
                            <Bot size={13} className="shrink-0 text-ink-3" />
                            {server.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )})()}
          </div>
        </motion.div>
      ))}
      <div ref={scrollEndRef} className="h-4" />
    </div>
  );
};
