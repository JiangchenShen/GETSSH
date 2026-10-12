import React, { memo, useRef, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Bot, User, RefreshCcw } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useAiChatStore, type ChatMessage } from '../../store/aiChatStore';
import { MarkdownRenderer } from '../common/MarkdownRenderer';
import { parseThoughtProcess, ThoughtProcessBlock } from '../common/ThoughtProcessBlock';
import { ThinkingIndicator, StreamCursor } from './shared';
import { ApprovalCard } from './ApprovalCard';

interface ChatViewProps {
  onPaperPlane: (code: string) => void;
  onRetry: (msgId: string, text: string) => void;
  onServerSelect: (msgId: string, serverId: string, serverName: string) => void;
}
interface MessageProps extends ChatViewProps {
  msg: ChatMessage;
  conversationId: string;
  retryText?: string;
  reduceMotion: boolean | null;
}
const emptyMessages: ChatMessage[] = [];

/** Immutable messages retain their render and parse work while another reply streams. */
export const ChatMessageView = memo(function ChatMessageView({ msg, conversationId, retryText, reduceMotion, onPaperPlane, onRetry, onServerSelect }: MessageProps) {
  const { t, i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const isDark = useAppStore(state => state.isDark);
  const { thoughtProcess, actualContent, isThinkingDone } = useMemo(() => parseThoughtProcess(msg.content), [msg.content]);

  return (
        <motion.div
          data-message-id={msg.id}
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
                    if (retryText !== undefined) onRetry(msg.id, retryText);
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
                
                {msg.approvalRequest && <ApprovalCard msg={msg} activeConversationId={conversationId} />}

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
  );
}, (previous, next) => previous.msg.id === next.msg.id && previous.msg.content === next.msg.content
  && previous.msg.role === next.msg.role && previous.msg.timestamp === next.msg.timestamp
  && previous.msg.isStreaming === next.msg.isStreaming && previous.msg.isThinking === next.msg.isThinking
  && previous.msg.approvalRequest === next.msg.approvalRequest && previous.msg.serverSelectionRequest === next.msg.serverSelectionRequest
  && previous.conversationId === next.conversationId && previous.retryText === next.retryText && previous.reduceMotion === next.reduceMotion
  && previous.onPaperPlane === next.onPaperPlane && previous.onRetry === next.onRetry && previous.onServerSelect === next.onServerSelect);

export const ChatView: React.FC<ChatViewProps> = ({ onPaperPlane, onRetry, onServerSelect }) => {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const reduceMotion = useReducedMotion();
  const activeConversationId = useAiChatStore(state => state.activeConversationId);
  const messages = useAiChatStore(state => state.conversations.find(c => c.id === state.activeConversationId)?.messages ?? emptyMessages);
  const olderMessages = useAiChatStore(state => state.conversations.find(c => c.id === state.activeConversationId)?.olderMessages);
  const loadOlderMessages = useAiChatStore(state => state.loadOlderMessages);
  const [olderLoading, setOlderLoading] = useState(false);
  const [olderError, setOlderError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const olderRequest = useRef<object | null>(null);
  const anchor = useRef<{ id: string; height: number; top: number } | null>(null);
  const lastMessage = messages[messages.length - 1];

  useEffect(() => {
    olderRequest.current = null;
    anchor.current = null;
    followLatest.current = true;
    setOlderLoading(false);
    setOlderError('');
  }, [activeConversationId]);
  useLayoutEffect(() => {
    const saved = anchor.current;
    const scroll = scrollRef.current;
    if (!olderLoading && saved && scroll && saved.id === activeConversationId) {
      scroll.scrollTop = saved.top + scroll.scrollHeight - saved.height;
      anchor.current = null;
    }
  }, [messages, olderLoading, activeConversationId]);
  useEffect(() => {
    if (followLatest.current && !olderRequest.current && !anchor.current) scrollEndRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
    // Prepending history leaves the last id/content unchanged and must not jump to the bottom.
  }, [activeConversationId, lastMessage?.id, lastMessage?.content, reduceMotion]);

  const loadEarlier = async () => {
    if (!activeConversationId || !olderMessages || olderRequest.current) return;
    const token = {};
    olderRequest.current = token;
    const scroll = scrollRef.current;
    if (scroll) anchor.current = { id: activeConversationId, height: scroll.scrollHeight, top: scroll.scrollTop };
    followLatest.current = false;
    setOlderLoading(true);
    setOlderError('');
    try {
      const ok = await loadOlderMessages(activeConversationId);
      if (olderRequest.current !== token || useAiChatStore.getState().activeConversationId !== activeConversationId) return;
      if (!ok) setOlderError(zh ? '更早的消息未能加载，请重试。' : 'Earlier messages could not be loaded. Try again.');
    } catch {
      if (olderRequest.current === token) setOlderError(zh ? '更早的消息未能加载，请重试。' : 'Earlier messages could not be loaded. Try again.');
    } finally {
      if (olderRequest.current === token) { olderRequest.current = null; setOlderLoading(false); }
    }
  };

  if (!messages.length) return <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
    <Bot className="mb-2 h-8 w-8 text-ink-3" /><div className="text-base font-medium text-ink-2">{zh ? '想从哪里开始？' : 'Where would you like to start?'}</div>
    <p className="max-w-sm text-xs leading-relaxed text-ink-3">{zh ? '可以问服务器排障、日志分析或脚本编写。需要终端上下文时，请先选定目标。' : 'Ask about troubleshooting, logs or scripts. Select a target when you need terminal context.'}</p>
  </div>;

  let lastUserText: string | undefined;
  return <div ref={scrollRef} data-testid="ai-chat-scroll" onScroll={() => {
    const scroll = scrollRef.current;
    if (scroll) followLatest.current = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80;
  }} className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-5">
    {!!olderMessages && <div className="flex flex-col items-center gap-2">
      <button type="button" disabled={olderLoading} onClick={() => void loadEarlier()} className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-2 hover:bg-surf focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">{olderLoading ? (zh ? '正在加载…' : 'Loading…') : (zh ? '加载更早的消息' : 'Load earlier messages')}</button>
      {olderError && <p role="alert" className="text-xs text-down">{olderError}</p>}
    </div>}
    {messages.map(msg => {
      if (msg.role === 'user') lastUserText = msg.content;
      return <ChatMessageView key={msg.id} msg={msg} conversationId={activeConversationId!} retryText={msg.role === 'assistant' ? lastUserText : undefined}
        reduceMotion={reduceMotion} onPaperPlane={onPaperPlane} onRetry={onRetry} onServerSelect={onServerSelect} />;
    })}
    <div ref={scrollEndRef} className="h-4" />
  </div>;
};
