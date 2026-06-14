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
          className="w-1 h-1 bg-white/40 rounded-xl inline-block"
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
  const isDark = useAppStore(state => state.isDark);
  const conversations = useAiChatStore(s => s.conversations);
  const activeConversationId = useAiChatStore(s => s.activeConversationId);
  const setActiveConversation = useAiChatStore(s => s.setActiveConversation);
  const deleteConversation = useAiChatStore(s => s.deleteConversation);
  const clearAllConversations = useAiChatStore(s => s.clearAllConversations);
  const newConversation = useAiChatStore(s => s.newConversation);

  if (conversations.length === 0) {
    return (
      <div className={`flex-1 flex flex-col items-center justify-center gap-3 p-6 ${isDark ? 'text-white/30' : 'text-slate-400'}`}>
        <MessageSquare className="w-10 h-10 opacity-20" />
        <div className="text-xs tracking-widest uppercase">暂无对话记录</div>
        <button
          onClick={() => newConversation()}
          className={`mt-2 flex items-center gap-2 px-4 py-2 border text-xs uppercase tracking-widest transition-colors rounded-xl ${isDark ? 'border-white/20 hover:bg-white/10 text-white/60 hover:text-white' : 'border-black/20 hover:bg-black/5 text-slate-500 hover:text-slate-900'}`}
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
                  ? 'border-primary bg-primary/10 text-primary'
                  : (isDark ? 'border-transparent hover:border-white/20 hover:bg-white/5 text-white/60 hover:text-white' : 'border-transparent hover:border-black/20 hover:bg-black/5 text-slate-500 hover:text-slate-900')
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-50" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold truncate">{conv.title}</div>
                <div className={`text-[10px] truncate mt-0.5 ${isDark ? 'text-white/30' : 'text-slate-400'}`}>{preview}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-[9px] font-mono ${isDark ? 'text-white/20' : 'text-slate-400'}`}>
                  {formatRelativeTime(conv.updatedAt)}
                </span>
                <button
                  onClick={e => { e.stopPropagation(); deleteConversation(conv.id); }}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-all rounded-xl"
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
      <div className={`border-t p-2 flex items-center gap-2 ${isDark ? 'border-white/5' : 'border-black/5'}`}>
        <button
          onClick={() => newConversation()}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] uppercase tracking-widest transition-all border border-transparent rounded-xl ${isDark ? 'text-white/40 hover:text-white hover:bg-white/5 hover:border-white/10' : 'text-slate-500 hover:text-slate-900 hover:bg-black/5 hover:border-black/10'}`}
        >
          <Plus className="w-3 h-3" /> 新对话
        </button>
        <button
          onClick={clearAllConversations}
          className="flex items-center justify-center gap-1.5 py-2 px-3 text-[10px] uppercase tracking-widest text-red-400/80 hover:text-red-500 hover:bg-red-500/10 transition-all border border-transparent hover:border-red-500/20 rounded-xl"
        >
          <Trash2 className="w-3 h-3" /> 清空全部
        </button>
      </div>
    </div>
  );
};

// ─── Chat View ────────────────────────────────────────────────────────────────
const ChatView: React.FC<{ onPaperPlane: (code: string) => void }> = ({ onPaperPlane }) => {
  const isDark = useAppStore(state => state.isDark);
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
          <div key={index} className={`relative p-3 rounded-xl my-2 font-mono text-xs group border shadow-inner max-w-full overflow-hidden ${isDark ? 'bg-black/40 border-white/5' : 'bg-slate-100/50 border-black/5'}`}>
            <span className={`text-[10px] absolute top-1.5 right-10 uppercase tracking-wider ${isDark ? 'text-white/30' : 'text-slate-400'}`}>{lang}</span>
            <button
              className={`absolute top-1.5 right-1.5 p-1 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity ${isDark ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-black/5 hover:bg-black/10 text-slate-700'}`}
              onClick={() => onPaperPlane(code)}
            >
              <Send size={12} className={isDark ? 'text-cyan-400' : 'text-cyan-600'} />
            </button>
            <pre className={`whitespace-pre-wrap break-all max-w-full overflow-hidden ${isDark ? 'text-emerald-400' : 'text-emerald-700'}`}>{code}</pre>
          </div>
        );
      }
      return <p key={index} className={`whitespace-pre-wrap break-words max-w-full text-sm leading-relaxed my-1 ${isDark ? 'text-neutral-200' : 'text-slate-800'}`}>{block}</p>;
    });
  };

  if (messages.length === 0) {
    return (
      <div className={`flex-1 flex items-center justify-center text-xs tracking-wider ${isDark ? 'text-white/20' : 'text-slate-400'}`}>
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
          <div className={`w-6 h-6 shrink-0 flex items-center justify-center rounded-xl border mt-0.5 ${
            msg.role === 'user'
              ? (isDark ? 'bg-primary/20 border-primary/30 text-primary' : 'bg-primary/10 border-primary/20 text-slate-700')
              : (isDark ? 'bg-white/5 border-white/10 text-white/50' : 'bg-white border-black/10 text-slate-500 shadow-sm')
          }`}>
            {msg.role === 'user' ? <User size={12} /> : <Bot size={12} />}
          </div>
          <div className={`flex-1 min-w-0 ${msg.role === 'user' ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
            {msg.isThinking ? (
              <div className={`px-3 py-2 border rounded-2xl ${isDark ? 'bg-white/5 border-white/5' : 'bg-black/5 border-black/5'}`}>
                <ThinkingIndicator />
              </div>
            ) : (
              <div className={`px-4 py-2.5 text-sm leading-relaxed max-w-[95%] break-words shadow-sm ${
                msg.role === 'user'
                  ? (isDark ? 'bg-primary/20 border border-primary/30 text-primary rounded-2xl rounded-tr-sm' : 'bg-primary/10 border border-primary/20 text-slate-800 rounded-2xl rounded-tr-sm shadow-[0_2px_10px_rgba(0,0,0,0.02)]')
                  : (isDark ? 'bg-white/5 border border-white/10 text-neutral-200 rounded-2xl rounded-tl-sm' : 'bg-white border border-black/10 text-slate-800 rounded-2xl rounded-tl-sm shadow-[0_2px_10px_rgba(0,0,0,0.02)]')
              }`}>
                {msg.role === 'user'
                  ? <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                  : renderContent(msg.content)
                }
                {msg.isStreaming && <StreamCursor />}
              </div>
            )}
            <span className={`text-[9px] font-mono px-1 ${isDark ? 'text-white/20' : 'text-slate-400'}`}>
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
  const isDark = useAppStore(state => state.isDark);

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
  const needsKey = !appConfig.hasAiApiKey && appConfig.aiProvider !== 'ollama';
  const activeConv = conversations.find(c => c.id === activeConversationId);

  return (
    <div className="absolute bottom-6 left-16 ml-4 z-[9999] flex flex-col-reverse items-start gap-4 pointer-events-none" style={{ WebkitAppRegion: 'no-drag' } as any}>
      <AnimatePresence>
        {isAiCenterOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={SPRING_SNAPPY}
            className="w-[560px] pointer-events-auto"
            onPointerEnter={() => setIsHoveringAiCenter(true)}
            onPointerLeave={() => setIsHoveringAiCenter(false)}
          >
            <MoovierTile
              dragLevel="global"
              dragConstraints={bounds}
              exemptFromFocus
              className={`w-full flex flex-col border backdrop-blur-2xl overflow-hidden ${isDark ? 'bg-[#0a0a0a]/80 border-white/10 shadow-[0_16px_32px_rgba(0,0,0,0.4)]' : 'bg-slate-50/80 border-black/10 shadow-[0_16px_40px_rgba(0,0,0,0.1)]'}`}
              style={{ borderRadius: '16px', WebkitAppRegion: 'no-drag', height: '580px' } as any}
            >
              {/* ── Header ── */}
              <div className={`px-4 py-2.5 border-b flex items-center justify-between shrink-0 ${isDark ? 'bg-white/[0.03] border-white/10' : 'bg-black/[0.02] border-black/10'}`}>
                <div className="flex items-center gap-1">
                  {/* Tab switcher */}
                  <button
                    onClick={() => setView('chat')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-all rounded-xl ${
                      view === 'chat'
                        ? (isDark ? 'bg-white/10 text-white' : 'bg-black/10 text-slate-900')
                        : (isDark ? 'text-white/30 hover:text-white hover:bg-white/5' : 'text-slate-500 hover:text-slate-900 hover:bg-black/5')
                    }`}
                  >
                    <Bot size={11} /> CHAT
                  </button>
                  <button
                    onClick={() => setView('history')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-all rounded-xl relative ${
                      view === 'history'
                        ? (isDark ? 'bg-white/10 text-white' : 'bg-black/10 text-slate-900')
                        : (isDark ? 'text-white/30 hover:text-white hover:bg-white/5' : 'text-slate-500 hover:text-slate-900 hover:bg-black/5')
                    }`}
                  >
                    <History size={11} />
                    HISTORY
                    {conversations.length > 0 && (
                      <span className={`ml-1 text-[9px] font-mono px-1 ${isDark ? 'text-white/30 bg-white/10' : 'text-slate-500 bg-black/10'}`}>
                        {conversations.length}
                      </span>
                    )}
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {view === 'chat' && (
                    <button
                      onClick={() => newConversation()}
                      className={`p-1.5 transition-colors rounded-xl ${isDark ? 'text-white/30 hover:text-white hover:bg-white/10' : 'text-slate-400 hover:text-slate-900 hover:bg-black/10'}`}
                      title="新对话"
                    >
                      <Plus size={13} />
                    </button>
                  )}
                  <button onClick={() => window.dispatchEvent(new CustomEvent('app:open-center', { detail: { type: 'ai', title: 'AI CENTER' } }))} className={`p-1.5 transition-colors rounded-xl ${isDark ? 'text-white/30 hover:text-white hover:bg-white/10' : 'text-slate-400 hover:text-slate-900 hover:bg-black/10'}`}>
                    <Settings size={13} />
                  </button>
                  <button onClick={() => setIsAiCenterOpen(false)} className={`p-1.5 transition-all rounded-xl ${isDark ? 'text-white/30 hover:text-white hover:bg-white/10' : 'text-slate-400 hover:text-slate-900 hover:bg-black/10'}`}>
                    <X size={13} />
                  </button>
                </div>
              </div>

              {/* ── Conversation breadcrumb (chat view) ── */}
              {view === 'chat' && activeConv && (
                <div className={`px-4 py-1.5 border-b flex items-center gap-2 shrink-0 ${isDark ? 'border-white/5' : 'border-black/5'}`}>
                  <Clock className={`w-3 h-3 ${isDark ? 'text-white/20' : 'text-slate-400'}`} />
                  <span className={`text-[10px] font-mono truncate flex-1 ${isDark ? 'text-white/30' : 'text-slate-500'}`}>{activeConv.title}</span>
                  {appConfig.aiModel && (
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 shrink-0 border ${isDark ? 'text-white/20 border-white/10' : 'text-slate-400 border-black/10'}`}>
                      {appConfig.aiModel}
                    </span>
                  )}
                </div>
              )}

              {/* ── Body ── */}
              <div className="flex-1 flex flex-col overflow-hidden" style={{ minHeight: 0 }}>
                {isLocked ? (
                  <div className={`flex-1 flex flex-col items-center justify-center gap-4 p-6 ${isDark ? 'text-white/40' : 'text-slate-500'}`}>
                    <div className="text-xs tracking-wider uppercase">[ AI CENTER IS DISABLED ]</div>
                    <button onClick={() => window.dispatchEvent(new CustomEvent('app:open-center', { detail: { type: 'ai', title: 'AI CENTER' } }))} className={`px-4 py-2 border text-xs uppercase tracking-widest transition-colors rounded-xl ${isDark ? 'border-white/20 hover:bg-white/10 text-white' : 'border-black/20 hover:bg-black/10 text-slate-800'}`}>
                      Enable in Settings
                    </button>
                  </div>
                ) : needsKey ? (
                  <div className={`flex-1 flex flex-col items-center justify-center gap-4 p-6 ${isDark ? 'text-white/40' : 'text-slate-500'}`}>
                    <div className="text-xs tracking-wider uppercase">[ API KEY REQUIRED ]</div>
                    <button onClick={() => window.dispatchEvent(new CustomEvent('app:open-center', { detail: { type: 'ai', title: 'AI CENTER' } }))} className={`px-4 py-2 border text-xs uppercase tracking-widest transition-colors rounded-xl ${isDark ? 'border-white/20 hover:bg-white/10 text-white' : 'border-black/20 hover:bg-black/10 text-slate-800'}`}>
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
                <div className={`relative p-2 border-t shrink-0 ${isDark ? 'border-white/10 bg-black/20' : 'border-black/10 bg-slate-50'}`}>
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

                  <form onSubmit={handleSubmit} className="flex gap-2 items-end">
                    <textarea
                      value={prompt}
                      onChange={e => setPrompt(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSubmit(e as any);
                        }
                      }}
                      disabled={isGenerating}
                      placeholder={isGenerating ? '正在回答中…' : '输入问题或上下文… (Enter 发送, Shift+Enter 换行)'}
                      className={`w-full h-[56px] border text-sm p-3 outline-none resize-none rounded-xl transition-colors ${isDark ? 'bg-white/5 border-white/10 text-white placeholder-white/25 focus:border-white/20' : 'bg-white border-black/10 text-slate-900 placeholder-slate-400 focus:border-black/20 shadow-[0_2px_10px_rgba(0,0,0,0.02)]'}`}
                    />
                    <button
                      type="submit"
                      disabled={isGenerating || !prompt.trim()}
                      className={`h-[56px] px-5 disabled:opacity-30 transition-all flex items-center justify-center rounded-xl shadow-sm ${(!isGenerating && prompt.trim()) ? 'bg-cyan-500 hover:bg-cyan-400 text-black' : (isDark ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-white border border-black/10 hover:bg-slate-50 text-slate-400')}`}
                    >
                      {isGenerating
                        ? <motion.div
                            className={`w-4 h-4 border-2 border-t-transparent rounded-full ${isDark ? 'border-primary/60' : 'border-slate-400'}`}
                            animate={{ rotate: 360 }}
                            transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                          />
                        : <Send size={16} />
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
