import React, { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MoovierTile } from '@moovier/core';
import { useAppStore } from '../store/appStore';
import { useSessionStore, PaneNode } from '../store/sessionStore';
import { useAiChatStore } from '../store/aiChatStore';
import { AiBridge } from '../services/aiBridge';
import {
  Send, X, ClipboardPaste, Settings,
  Trash2, Bot, User, Plus, History, ChevronRight,
  MessageSquare, Clock,
} from 'lucide-react';

const SPRING_SNAPPY = { type: 'spring', stiffness: 400, damping: 30, mass: 1.0 } as const;

// ─── Thinking Indicator ───────────────────────────────────────────────────────
const ThinkingIndicator: React.FC = () => (
  <div className="flex items-center gap-2 text-white/40 text-xs font-mono tracking-widest">
    <span className="uppercase">THINKING</span>
    <span className="flex gap-[3px] items-center">
      {[0, 1, 2].map(i => (
        <motion.span
          key={i}
          className="w-1 h-1 bg-white/40 rounded-none inline-block"
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2, ease: 'easeInOut' }}
        />
      ))}
    </span>
  </div>
);

const StreamCursor: React.FC = () => (
  <motion.span
    className="inline-block w-[2px] h-[14px] bg-white/60 ml-0.5 align-middle"
    animate={{ opacity: [1, 0, 1] }}
    transition={{ duration: 0.8, repeat: Infinity }}
  />
);

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  return `${days} 天前`;
}

// ─── History View ─────────────────────────────────────────────────────────────
const HistoryView: React.FC = () => {
  const conversations = useAiChatStore(s => s.conversations);
  const activeConversationId = useAiChatStore(s => s.activeConversationId);
  const setActiveConversation = useAiChatStore(s => s.setActiveConversation);
  const deleteConversation = useAiChatStore(s => s.deleteConversation);
  const clearAllConversations = useAiChatStore(s => s.clearAllConversations);
  const newConversation = useAiChatStore(s => s.newConversation);

  if (conversations.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-white/30 p-6">
        <MessageSquare className="w-10 h-10 opacity-20" />
        <div className="text-xs tracking-widest uppercase">暂无对话记录</div>
        <button
          onClick={() => newConversation()}
          className="mt-2 flex items-center gap-2 px-4 py-2 border border-white/20 hover:bg-white/10 text-white/60 hover:text-white text-xs uppercase tracking-widest transition-colors rounded-none"
        >
          <Plus className="w-3.5 h-3.5" /> 开始新对话
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* List */}
      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1 scrollbar-hide">
        {conversations.map(conv => {
          const isActive = conv.id === activeConversationId;
          const preview = conv.messages.find(m => m.role === 'assistant')?.content?.slice(0, 60) || '…';
          return (
            <div
              key={conv.id}
              onClick={() => setActiveConversation(conv.id)}
              className={`group flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-all border-l-2 ${
                isActive
                  ? 'border-primary bg-primary/10 text-white'
                  : 'border-transparent hover:border-white/20 hover:bg-white/5 text-white/60 hover:text-white'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-50" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold truncate">{conv.title}</div>
                <div className="text-[10px] text-white/30 truncate mt-0.5">{preview}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[9px] text-white/20 font-mono">
                  {formatRelativeTime(conv.updatedAt)}
                </span>
                <button
                  onClick={e => { e.stopPropagation(); deleteConversation(conv.id); }}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-all rounded-none"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
                <ChevronRight className="w-3.5 h-3.5 opacity-30" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="border-t border-white/5 p-2 flex items-center gap-2">
        <button
          onClick={() => newConversation()}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] uppercase tracking-widest text-white/40 hover:text-white hover:bg-white/5 transition-all border border-transparent hover:border-white/10 rounded-none"
        >
          <Plus className="w-3 h-3" /> 新对话
        </button>
        <button
          onClick={clearAllConversations}
          className="flex items-center justify-center gap-1.5 py-2 px-3 text-[10px] uppercase tracking-widest text-red-400/50 hover:text-red-400 hover:bg-red-500/5 transition-all border border-transparent hover:border-red-500/20 rounded-none"
        >
          <Trash2 className="w-3 h-3" /> 清空全部
        </button>
      </div>
    </div>
  );
};

// ─── Chat View ────────────────────────────────────────────────────────────────
const ChatView: React.FC<{ onPaperPlane: (code: string) => void }> = ({ onPaperPlane }) => {
  const conversations = useAiChatStore(s => s.conversations);
  const activeConversationId = useAiChatStore(s => s.activeConversationId);
  const scrollEndRef = useRef<HTMLDivElement>(null);

  const activeConv = conversations.find(c => c.id === activeConversationId);
  const messages = activeConv?.messages ?? [];

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, messages[messages.length - 1]?.content]);

  const renderContent = (content: string) => {
    const blocks = content.split('```');
    return blocks.map((block, index) => {
      if (index % 2 === 1) {
        const lines = block.split('\n');
        const lang = lines.shift() || 'shell';
        const code = lines.join('\n').trim();
        return (
          <div key={index} className="relative bg-black/40 p-3 rounded-none my-2 font-mono text-xs group border border-white/5 shadow-inner">
            <span className="text-[10px] text-white/30 absolute top-1.5 right-10 uppercase tracking-wider">{lang}</span>
            <button
              className="absolute top-1.5 right-1.5 p-1 bg-white/10 hover:bg-white/20 text-white rounded-none opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => onPaperPlane(code)}
            >
              <Send size={12} className="text-cyan-400" />
            </button>
            <pre className="whitespace-pre-wrap break-words text-emerald-400">{code}</pre>
          </div>
        );
      }
      return <p key={index} className="whitespace-pre-wrap break-words text-sm text-neutral-200 leading-relaxed my-1">{block}</p>;
    });
  };

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-white/20 text-xs tracking-wider">
        [ 等待指令输入 ]
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4 scrollbar-hide">
      {messages.map(msg => (
        <motion.div
          key={msg.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
        >
          <div className={`w-6 h-6 shrink-0 flex items-center justify-center rounded-none border mt-0.5 ${
            msg.role === 'user'
              ? 'bg-primary/20 border-primary/30 text-primary'
              : 'bg-white/5 border-white/10 text-white/50'
          }`}>
            {msg.role === 'user' ? <User size={12} /> : <Bot size={12} />}
          </div>
          <div className={`flex-1 min-w-0 ${msg.role === 'user' ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
            {msg.isThinking ? (
              <div className="px-3 py-2 bg-white/5 border border-white/5">
                <ThinkingIndicator />
              </div>
            ) : (
              <div className={`px-3 py-2 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-primary/15 border border-primary/20 text-white'
                  : 'bg-white/5 border border-white/5 text-neutral-200'
              }`}>
                {msg.role === 'user'
                  ? <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                  : renderContent(msg.content)
                }
                {msg.isStreaming && <StreamCursor />}
              </div>
            )}
            <span className="text-[9px] text-white/20 font-mono px-1">
              {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </motion.div>
      ))}
      <div ref={scrollEndRef} />
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────
export const AiCenter: React.FC = () => {
  const isAiCenterOpen = useAppStore(state => state.isAiCenterOpen);
  const setIsAiSettingsOpen = useAppStore(state => state.setIsAiSettingsOpen);
  const setIsAiCenterOpen = useAppStore(state => state.setIsAiCenterOpen);
  const setIsHoveringAiCenter = useAppStore(state => state.setIsHoveringAiCenter);
  const currentTerminalSelection = useAppStore(state => state.currentTerminalSelection);
  const setCurrentTerminalSelection = useAppStore(state => state.setCurrentTerminalSelection);
  const appConfig = useAppStore(state => state.appConfig);

  const view = useAiChatStore(s => s.view);
  const setView = useAiChatStore(s => s.setView);
  const conversations = useAiChatStore(s => s.conversations);
  const activeConversationId = useAiChatStore(s => s.activeConversationId);
  const newConversation = useAiChatStore(s => s.newConversation);
  const addMessage = useAiChatStore(s => s.addMessage);
  const updateMessage = useAiChatStore(s => s.updateMessage);
  const appendChunk = useAiChatStore(s => s.appendChunk);

  // Track generating state locally (not persisted)
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [prompt, setPrompt] = React.useState('');

  const [bounds, setBounds] = React.useState({ left: -60, right: 800, top: -600, bottom: 20 });

  useEffect(() => {
    const updateBounds = () => setBounds({
      left: -60, right: window.innerWidth - 530,
      top: -window.innerHeight + 500, bottom: 20,
    });
    updateBounds();
    window.addEventListener('resize', updateBounds);
    return () => window.removeEventListener('resize', updateBounds);
  }, []);

  // Auto-create a conversation on first open
  useEffect(() => {
    if (isAiCenterOpen && conversations.length === 0) {
      newConversation();
    }
    if (isAiCenterOpen && !activeConversationId && conversations.length > 0) {
      useAiChatStore.setState({ activeConversationId: conversations[0].id });
    }
  }, [isAiCenterOpen]);

  // ─── Airplane Filling ─────────────────────────────────────────────────────
  const getActiveSessionId = (): string | null => {
    const state = useSessionStore.getState();
    if (!state.activeTabId || !state.activePaneId) return null;
    const tab = state.tabs.find(t => t.id === state.activeTabId);
    if (!tab || !tab.paneTree) return null;
    let foundSessionId: string | null = null;
    const traverse = (node: PaneNode) => {
      if (node.type === 'leaf') {
        if (node.paneId === state.activePaneId && node.paneType === 'terminal') foundSessionId = node.sessionId;
      } else {
        traverse(node.children[0]);
        traverse(node.children[1]);
      }
    };
    traverse(tab.paneTree);
    return foundSessionId;
  };

  const handlePaperPlane = (code: string) => {
    const sessionId = getActiveSessionId();
    if (!sessionId) { useAppStore.getState().addToast('未找到活动的终端面板', 'warning'); return; }
    const sanitized = code.replace(/[\r\n]+/g, ' ').trim();
    if (window.electronAPI?.sshWrite) {
      window.electronAPI.sshWrite(sessionId, sanitized);
      useAppStore.getState().addToast('代码已安全填入终端缓冲', 'success');
    }
  };

  // ─── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isGenerating) return;

    // Ensure we have an active conversation
    let convId = activeConversationId;
    if (!convId) convId = newConversation();

    const currentPrompt = prompt.trim();
    setPrompt('');
    setIsGenerating(true);
    setView('chat');

    const userMsgId = `user-${Date.now()}`;
    addMessage(convId, { id: userMsgId, role: 'user', content: currentPrompt, timestamp: Date.now() });

    const aiMsgId = `ai-${Date.now() + 1}`;
    addMessage(convId, { id: aiMsgId, role: 'assistant', content: '', isThinking: true, isStreaming: false, timestamp: Date.now() });

    let firstChunk = false;
    try {
      await AiBridge.invokePrivileged(
        {
          requestId: aiMsgId,
          prompt: currentPrompt,
          provider: appConfig.aiProvider,
          model: appConfig.aiModel,
          endpoint: appConfig.aiEndpoint,
          apiKey: appConfig.aiApiKey,
        },
        (payload) => {
          if (payload.chunk) {
            if (!firstChunk) {
              firstChunk = true;
              updateMessage(convId!, aiMsgId, { isThinking: false, isStreaming: true });
            }
            appendChunk(convId!, aiMsgId, payload.chunk);
          }
          if (payload.isDone) {
            updateMessage(convId!, aiMsgId, { isThinking: false, isStreaming: false });
            setIsGenerating(false);
          }
          if (payload.error) {
            updateMessage(convId!, aiMsgId, { content: `[Error] ${payload.error}`, isThinking: false, isStreaming: false });
            setIsGenerating(false);
          }
        }
      );
    } catch (err: any) {
      updateMessage(convId!, aiMsgId, { content: `[Pipeline Error] ${err.message}`, isThinking: false, isStreaming: false });
      setIsGenerating(false);
    }
  };

  const handleInjectSelection = () => {
    if (!currentTerminalSelection) return;
    setPrompt(prev => prev + `\n\`\`\`stderr\n${currentTerminalSelection}\n\`\`\`\n`);
    setCurrentTerminalSelection('');
  };

  const isLocked = !appConfig.aiEnabled;
  const needsKey = !appConfig.aiApiKey && appConfig.aiProvider !== 'ollama';
  const activeConv = conversations.find(c => c.id === activeConversationId);

  return (
    <div className="absolute bottom-6 left-16 ml-4 z-[9999] flex flex-col-reverse items-start gap-4" style={{ WebkitAppRegion: 'no-drag' } as any}>
      <AnimatePresence>
        {isAiCenterOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={SPRING_SNAPPY}
            className="w-[460px]"
            onPointerEnter={() => setIsHoveringAiCenter(true)}
            onPointerLeave={() => setIsHoveringAiCenter(false)}
          >
            <MoovierTile
              dragLevel="global"
              dragConstraints={bounds}
              className="w-full flex flex-col border border-white/10 shadow-[0_16px_32px_rgba(0,0,0,0.4)] bg-[#0a0a0a]/80 backdrop-blur-2xl"
              style={{ borderRadius: '0px', WebkitAppRegion: 'no-drag', minHeight: '480px' } as any}
            >
              {/* ── Header ── */}
              <div className="px-4 py-2.5 border-b border-white/10 flex items-center justify-between bg-white/[0.03] shrink-0">
                <div className="flex items-center gap-1">
                  {/* Tab switcher */}
                  <button
                    onClick={() => setView('chat')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-all rounded-none ${
                      view === 'chat'
                        ? 'bg-white/10 text-white'
                        : 'text-white/30 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <Bot size={11} /> CHAT
                  </button>
                  <button
                    onClick={() => setView('history')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-all rounded-none relative ${
                      view === 'history'
                        ? 'bg-white/10 text-white'
                        : 'text-white/30 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <History size={11} />
                    HISTORY
                    {conversations.length > 0 && (
                      <span className="ml-1 text-[9px] font-mono text-white/30 bg-white/10 px-1">
                        {conversations.length}
                      </span>
                    )}
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {view === 'chat' && (
                    <button
                      onClick={() => newConversation()}
                      className="p-1.5 transition-colors text-white/30 hover:text-white hover:bg-white/10 rounded-none"
                      title="新对话"
                    >
                      <Plus size={13} />
                    </button>
                  )}
                  <button onClick={() => setIsAiSettingsOpen(true)} className="p-1.5 transition-colors text-white/30 hover:text-white hover:bg-white/10 rounded-none">
                    <Settings size={13} />
                  </button>
                  <button onClick={() => setIsAiCenterOpen(false)} className="p-1.5 text-white/30 hover:text-white hover:bg-white/10 transition-all rounded-none">
                    <X size={13} />
                  </button>
                </div>
              </div>

              {/* ── Conversation breadcrumb (chat view) ── */}
              {view === 'chat' && activeConv && (
                <div className="px-4 py-1.5 border-b border-white/5 flex items-center gap-2 shrink-0">
                  <Clock className="w-3 h-3 text-white/20" />
                  <span className="text-[10px] text-white/30 font-mono truncate flex-1">{activeConv.title}</span>
                  {appConfig.aiModel && (
                    <span className="text-[9px] font-mono text-white/20 border border-white/10 px-1.5 py-0.5 shrink-0">
                      {appConfig.aiModel}
                    </span>
                  )}
                </div>
              )}

              {/* ── Body ── */}
              <div className="flex-1 flex flex-col overflow-hidden" style={{ minHeight: 0 }}>
                {isLocked ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-white/40 gap-4 p-6">
                    <div className="text-xs tracking-wider uppercase">[ AI CENTER IS DISABLED ]</div>
                    <button onClick={() => setIsAiSettingsOpen(true)} className="px-4 py-2 border border-white/20 hover:bg-white/10 text-white text-xs uppercase tracking-widest transition-colors rounded-none">
                      Enable in Settings
                    </button>
                  </div>
                ) : needsKey ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-white/40 gap-4 p-6">
                    <div className="text-xs tracking-wider uppercase">[ API KEY REQUIRED ]</div>
                    <button onClick={() => setIsAiSettingsOpen(true)} className="px-4 py-2 border border-white/20 hover:bg-white/10 text-white text-xs uppercase tracking-widest transition-colors rounded-none">
                      Bind API Key
                    </button>
                  </div>
                ) : view === 'history' ? (
                  <HistoryView />
                ) : (
                  <ChatView onPaperPlane={handlePaperPlane} />
                )}
              </div>

              {/* ── Input Area (only in chat mode, when not locked) ── */}
              {view === 'chat' && !isLocked && !needsKey && (
                <div className="relative p-2 border-t border-white/10 bg-black/20 shrink-0">
                  <AnimatePresence>
                    {currentTerminalSelection && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="absolute -top-12 left-2 z-10"
                      >
                        <button
                          onClick={handleInjectSelection}
                          className="flex items-center gap-2 px-4 py-2 bg-indigo-500/80 hover:bg-indigo-500 backdrop-blur-md border border-indigo-400/50 text-white text-xs font-bold rounded-full shadow-lg shadow-indigo-500/20 transition-all"
                        >
                          <ClipboardPaste size={14} />
                          [ 📋 粘贴所选文本 ]
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <form onSubmit={handleSubmit} className="flex gap-2">
                    <textarea
                      value={prompt}
                      onChange={e => setPrompt(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit(e as any);
                      }}
                      disabled={isGenerating}
                      placeholder={isGenerating ? '正在回答中…' : '输入问题或上下文… (⌘↵ 发送)'}
                      className="w-full h-[56px] bg-white/5 border border-white/10 text-white text-sm p-3 outline-none resize-none placeholder-white/25 rounded-none transition-colors focus:border-white/20"
                    />
                    <button
                      type="submit"
                      disabled={isGenerating || !prompt.trim()}
                      className="px-4 bg-white/10 hover:bg-white/20 text-white disabled:opacity-30 transition-colors flex items-center justify-center rounded-none"
                    >
                      {isGenerating
                        ? <motion.div
                            className="w-3.5 h-3.5 border-2 border-primary/60 border-t-transparent rounded-none"
                            animate={{ rotate: 360 }}
                            transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                          />
                        : <Send size={15} />
                      }
                    </button>
                  </form>
                </div>
              )}
            </MoovierTile>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
