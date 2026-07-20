import React, { useRef, useEffect } from 'react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { MoovierTile } from '@moovier/core';
import { useAppStore } from '../store/appStore';
import { useSessionStore, PaneNode } from '../store/sessionStore';
import { useAiChatStore } from '../store/aiChatStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { AiBridge } from '../services/aiBridge';
import { MarkdownRenderer } from './common/MarkdownRenderer';
import {
  Send, X, ClipboardPaste, Settings,
  Trash2, Bot, User, Plus, History,
  MessageSquare, Clock, Sparkles, RefreshCcw
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getPersonaContent } from '../utils/persona';
import { getTerminalBuffer } from './Terminal';

const SPRING_SNAPPY = { type: 'spring', stiffness: 400, damping: 30, mass: 1.0 } as const;

// ─── Thinking Indicator ───────────────────────────────────────────────────────
const ThinkingIndicator: React.FC = () => (
  <div className="flex items-center gap-3 py-1 px-2">
    <div className="relative flex items-center justify-center w-5 h-5">
      <motion.div
        className="absolute inset-0 rounded-full border-t-2 border-primary"
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
      />
      <Sparkles className="w-3 h-3 text-primary animate-pulse" />
    </div>
    <div className="flex gap-1">
      {[0, 1, 2].map(i => (
        <motion.span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-primary/60"
          animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2, ease: 'easeInOut' }}
        />
      ))}
    </div>
  </div>
);

const StreamCursor: React.FC = () => (
  <motion.span
    className="inline-block w-2 h-4 bg-primary/80 ml-1 align-middle rounded-sm"
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

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    deleteConversation(id);
  };

  if (conversations.length === 0) {
    return (
      <div className={`flex-1 flex flex-col items-center justify-center gap-4 p-8 ${isDark ? 'text-white/40' : 'text-slate-400'}`}>
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-2">
          <MessageSquare className="w-8 h-8 text-primary/50" />
        </div>
        <div className="text-sm font-bold tracking-widest uppercase">暂无对话记录</div>
        <button
          onClick={() => newConversation()}
          className={`mt-4 flex items-center gap-2 px-6 py-2.5 bg-primary text-white text-xs font-bold uppercase tracking-widest transition-transform hover:scale-105 active:scale-95 rounded-full shadow-lg shadow-primary/20`}
        >
          <Plus className="w-4 h-4" /> 开始新对话
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* List */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 scrollbar-hide">
        {conversations.map(conv => {
          const isActive = conv.id === activeConversationId;
          const preview = conv.messages.find(m => m.role === 'assistant')?.content?.slice(0, 60) || '…';
          return (
            <div
              key={conv.id}
              onClick={() => setActiveConversation(conv.id)}
              className={`group flex items-center gap-3 px-4 py-3 cursor-pointer transition-all rounded-2xl border ${
                isActive
                  ? 'border-primary/30 bg-primary/10 shadow-sm'
                  : (isDark ? 'border-white/5 hover:border-white/20 hover:bg-white/5' : 'border-black/5 hover:border-black/20 hover:bg-black/5')
              }`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isActive ? 'bg-primary text-white shadow-md shadow-primary/30' : (isDark ? 'bg-white/10 text-white/50' : 'bg-black/5 text-black/50')}`}>
                <MessageSquare className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-bold truncate ${isActive ? 'text-primary' : (isDark ? 'text-white' : 'text-slate-800')}`}>{conv.title}</div>
                <div className={`text-xs truncate mt-0.5 ${isDark ? 'text-white/40' : 'text-slate-500'}`}>{preview}</div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={`text-[10px] font-mono ${isDark ? 'text-white/30' : 'text-slate-400'}`}>
                  {formatRelativeTime(conv.updatedAt)}
                </span>
                <button
                  onClick={e => handleDelete(e, conv.id)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500 hover:text-white text-red-400 transition-all rounded-lg"
                  title="删除对话"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className={`p-4 border-t flex flex-col gap-2 ${isDark ? 'border-white/10 bg-black/20' : 'border-black/10 bg-slate-50/50'}`}>
        <button
          onClick={() => newConversation()}
          className="w-full py-3 bg-primary hover:bg-primary/90 text-white text-xs font-bold uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" /> 创建新对话
        </button>
        <button
          onClick={clearAllConversations}
          className={`w-full py-2.5 text-xs font-bold uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 ${isDark ? 'text-red-400 hover:bg-red-500/20' : 'text-red-600 hover:bg-red-50'}`}
        >
          <Trash2 className="w-3.5 h-3.5" /> 清空全部记录
        </button>
      </div>
    </div>
  );
};

// ─── Approval Card (High-Risk Interceptor) ──────────────────────────────────────
const ApprovalCard: React.FC<{
  msg: any;
  activeConversationId: string | null;
}> = ({ msg, activeConversationId }) => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  
  const [lockCountdown, setLockCountdown] = React.useState(3);

  const command = msg.approvalRequest?.command || '';
  
  const isHighRisk = React.useMemo(() => {
    const patterns = [
      /rm\s+-rf/,
      /chmod\s+(-R\s+)?777/,
      /mkfs/,
      /dd\s+if=/,
      /(wget|curl)\s+[^|]+\|\s*(bash|sh|zsh)/,
      />\s*\/dev\/[sh]d[a-z]/
    ];
    return patterns.some(p => p.test(command));
  }, [command]);

  useEffect(() => {
    if (msg.approvalRequest?.status !== 'pending' || !isHighRisk) return;
    if (lockCountdown > 0) {
      const timer = setTimeout(() => setLockCountdown(c => c - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [lockCountdown, isHighRisk, msg.approvalRequest?.status]);

  if (msg.approvalRequest?.status === 'approved') {
    return (
      <div className={`mt-3 text-xs font-bold flex items-center gap-1.5 ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        {t('ai.approvedText', '已授权，代理正在执行...')}
      </div>
    );
  }

  if (msg.approvalRequest?.status === 'rejected') {
    return (
      <div className={`mt-3 text-xs font-bold flex items-center gap-1.5 ${isDark ? 'text-rose-400' : 'text-rose-600'}`}>
        <X size={12} />
        {t('ai.rejectedText', '操作已被取消')}
      </div>
    );
  }

  if (msg.approvalRequest?.status === 'pending') {
    const isLocked = isHighRisk && lockCountdown > 0;
    
    return (
      <div className={`mt-4 p-4 rounded-xl border flex flex-col gap-3 transition-colors ${
        isHighRisk 
          ? (isDark ? 'bg-red-500/10 border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.2)]' : 'bg-red-50 border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.2)]')
          : (isDark ? 'bg-amber-500/10 border-amber-500/30' : 'bg-amber-50 border-amber-500/30')
      }`}>
        <div className={`text-xs font-bold uppercase flex items-center gap-2 ${
          isHighRisk ? 'text-red-500 animate-pulse' : (isDark ? 'text-amber-500' : 'text-amber-600')
        }`}>
          ⚠️ {isHighRisk ? t('ai.highRiskWarning', '高危操作警告 (HIGH RISK)') : t('ai.awaitingApproval', '等待您的执行授权')}
        </div>
        <code className={`block p-2 rounded text-xs font-mono break-all ${
          isHighRisk
            ? (isDark ? 'bg-black/40 text-red-300' : 'bg-white text-red-700 border border-red-200')
            : (isDark ? 'bg-black/30 text-amber-200' : 'bg-white text-amber-900 border border-amber-200')
        }`}>
          {command}
        </code>
        <div className="flex gap-2 mt-1">
          <button 
            disabled={isLocked}
            className={`flex-1 py-2 px-4 rounded-lg text-xs font-bold transition-all shadow-lg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 ${
              isHighRisk
                ? 'bg-red-600 hover:bg-red-500 text-white shadow-red-500/20'
                : 'bg-amber-500 hover:bg-amber-400 text-amber-950 shadow-amber-500/20'
            }`}
            onClick={() => {
              window.electronAPI.ai.approveAgentAction(msg.approvalRequest!.requestId, true);
              useAiChatStore.getState().updateMessage(activeConversationId!, msg.id, {
                approvalRequest: { ...msg.approvalRequest!, status: 'approved' }
              });
            }}
          >
            {isLocked ? `${t('ai.lockedBtn', '风险锁定')} (${lockCountdown}s)` : t('ai.approveBtn', '允许执行')}
          </button>
          <button 
            className={`flex-1 py-2 px-4 rounded-lg border text-xs font-bold transition-all active:scale-95 ${
              isHighRisk
                ? (isDark ? 'border-red-500/30 text-red-400 hover:bg-red-500/10' : 'border-red-200 text-red-600 hover:bg-red-50')
                : (isDark ? 'border-white/20 text-white hover:bg-white/10' : 'border-slate-300 text-slate-700 hover:bg-slate-100')
            }`}
            onClick={() => {
              window.electronAPI.ai.approveAgentAction(msg.approvalRequest!.requestId, false);
              useAiChatStore.getState().updateMessage(activeConversationId!, msg.id, {
                approvalRequest: { ...msg.approvalRequest!, status: 'rejected' }
              });
            }}
          >
            {t('ai.rejectBtn', '拒绝')}
          </button>
        </div>
      </div>
    );
  }

  return null;
};

// ─── Chat View ────────────────────────────────────────────────────────────────
const ChatView: React.FC<{ 
  onPaperPlane: (code: string) => void; 
  onRetry: (msgId: string, text: string) => void;
  onServerSelect: (msgId: string, serverId: string, serverName: string) => void;
}> = ({ onPaperPlane, onRetry, onServerSelect }) => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const conversations = useAiChatStore(s => s.conversations);
  const activeConversationId = useAiChatStore(s => s.activeConversationId);
  const scrollEndRef = useRef<HTMLDivElement>(null);

  const activeConv = conversations.find(c => c.id === activeConversationId);
  const messages = activeConv?.messages ?? [];

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, messages[messages.length - 1]?.content]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <Bot className={`w-16 h-16 mb-4 ${isDark ? 'text-white/10' : 'text-slate-200'}`} />
        <div className={`text-lg font-bold mb-2 ${isDark ? 'text-white/60' : 'text-slate-600'}`}>
          {t('ai.waitingInstruction', '有什么我可以帮您的？')}
        </div>
        <p className={`text-xs ${isDark ? 'text-white/30' : 'text-slate-400'}`}>
          直接在下方输入指令或上下文开始对话。<br/>提示：您可以随时向我求助服务器排障或脚本编写。
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6 scrollbar-hide">
      {messages.map(msg => (
        <motion.div
          key={msg.id}
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.3 }}
          className={`group flex gap-3 w-full ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
        >
          <div className={`w-8 h-8 shrink-0 flex items-center justify-center rounded-full shadow-sm mt-1 ${
            msg.role === 'user'
              ? 'bg-primary text-white shadow-primary/30'
              : (isDark ? 'bg-white/10 text-white/80' : 'bg-slate-200 text-slate-700')
          }`}>
            {msg.role === 'user' ? <User size={14} /> : <Bot size={14} />}
          </div>
          
          <div className={`flex flex-col gap-1.5 max-w-[85%] ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-bold px-1 ${isDark ? 'text-white/30' : 'text-slate-400'}`}>
                {msg.role === 'user' ? 'YOU' : 'GETSSH AI'} • {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
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
                  className={`p-1 rounded opacity-0 group-hover:opacity-100 transition-all hover:bg-black/5 dark:hover:bg-white/10 ${isDark ? 'text-white/40 hover:text-white' : 'text-slate-400 hover:text-slate-700'}`}
                  title={t('ai.retry', '重试 (Retry)')}
                >
                  <RefreshCcw size={12} />
                </button>
              )}
            </div>
            
            {msg.isThinking ? (
              <div className={`px-4 py-3 rounded-2xl rounded-tl-sm border shadow-sm ${isDark ? 'bg-white/5 border-white/10' : 'bg-white border-slate-200'}`}>
                <ThinkingIndicator />
              </div>
            ) : (
              <div className={`px-5 py-3.5 text-sm leading-relaxed break-words shadow-md ${
                msg.role === 'user'
                  ? 'bg-primary text-white rounded-3xl rounded-tr-sm shadow-primary/20'
                  : (isDark ? 'bg-[#1a1b26] border border-white/10 text-neutral-200 rounded-3xl rounded-tl-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-3xl rounded-tl-sm')
              }`}>
                {msg.role === 'user'
                  ? <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                  : <MarkdownRenderer content={msg.content} onPaperPlane={onPaperPlane} />
                }
                {msg.isStreaming && <StreamCursor />}
                
                {msg.approvalRequest && <ApprovalCard msg={msg} activeConversationId={activeConversationId} />}

                {msg.serverSelectionRequest && (
                  <div className={`mt-4 p-4 border rounded-xl ${isDark ? 'border-indigo-500/30 bg-indigo-500/10' : 'border-indigo-200 bg-indigo-50'}`}>
                    <div className="font-bold text-sm mb-3 flex items-center gap-2 text-indigo-500">
                      <Bot size={16} /> 检测到多个终端环境，请选择目标：
                    </div>
                    {msg.serverSelectionRequest.status === 'resolved' ? (
                      <div className="text-xs opacity-70">
                        ✓ 已选择: {msg.serverSelectionRequest.availableServers.find((s: any) => s.id === msg.serverSelectionRequest!.selectedServerId)?.name}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {msg.serverSelectionRequest.availableServers.map((server: any) => (
                          <button
                            key={server.id}
                            onClick={() => onServerSelect(msg.id, server.id, server.name)}
                            className={`px-4 py-2.5 text-left text-xs font-bold rounded-lg transition-all ${isDark ? 'bg-black/20 hover:bg-white/10 text-white/80' : 'bg-white hover:bg-indigo-100 text-slate-700 shadow-sm'} flex items-center gap-2`}
                          >
                            <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                            {server.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      ))}
      <div ref={scrollEndRef} className="h-4" />
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────
export const AiCenter: React.FC = () => {
  const isAiCenterOpen = useAppStore(state => state.isAiCenterOpen);
  const isDark = useAppStore(state => state.isDark);
  const dragControls = useDragControls();

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
  const loadWorkspaceChats = useAiChatStore(s => s.loadWorkspaceChats);

  // Load from SQLite when workspace changes
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  useEffect(() => {
    if (activeWorkspaceId) {
      loadWorkspaceChats();
    }
  }, [activeWorkspaceId, loadWorkspaceChats]);

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

  // Handle external submit requests
  useEffect(() => {
    const handleExternalSubmit = (e: any) => {
      const externalPrompt = e.detail;
      if (externalPrompt) {
        setPrompt(externalPrompt);
        setTimeout(() => {
           const form = document.getElementById('ai-chat-form');
           if (form) {
             form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
           }
        }, 100);
      }
    };
    window.addEventListener('ai:submit-prompt', handleExternalSubmit);
    return () => window.removeEventListener('ai:submit-prompt', handleExternalSubmit);
  }, []);

  const getSessionContext = (): { activeSession: { id: string, name: string } | null, allSessions: { id: string, name: string }[] } => {
    const state = useSessionStore.getState();
    if (!state.activeTabId) return { activeSession: null, allSessions: [] };
    const tab = state.tabs.find(t => t.id === state.activeTabId);
    if (!tab || !tab.paneTree) return { activeSession: null, allSessions: [] };

    let activeSession: { id: string, name: string } | null = null;
    const allTerminalSessions: { id: string, name: string }[] = [];

    const traverse = (node: PaneNode) => {
      if (node.type === 'leaf' && node.paneType === 'terminal' && node.sessionId) {
        const config = node.config as any;
        const name = config?.alias || config?.host || node.sessionId;
        allTerminalSessions.push({ id: node.sessionId, name });

        if (node.paneId === state.activePaneId) {
          activeSession = { id: node.sessionId, name };
        }
      } else if (node.type !== 'leaf') {
        traverse(node.children[0]);
        traverse(node.children[1]);
      }
    };
    traverse(tab.paneTree);
    
    if (!activeSession && allTerminalSessions.length === 1) {
      activeSession = allTerminalSessions[0];
    }
    
    return { activeSession, allSessions: allTerminalSessions };
  };

  const handlePaperPlane = (code: string) => {
    const { activeSession, allSessions } = getSessionContext();
    if (!activeSession?.id && allSessions.length !== 1) {
       useAppStore.getState().addToast('多个终端环境可用，请先在此框外激活一个目标', 'warning');
       return;
    }
    const session = activeSession || allSessions[0];
    const sanitized = code.replace(/[\r\n]+/g, ' ').trim();
    if (window.electronAPI?.sshWrite) {
      window.electronAPI.sshWrite(session.id, sanitized);
      useAppStore.getState().addToast('代码已安全填入终端缓冲', 'success');
    }
  };

  const generateResponse = async (convId: string, aiMsgId: string, promptText: string, overrideSessionId?: string) => {
    const appConfig = useAppStore.getState().appConfig;
    const workspaces = useWorkspaceStore.getState().workspaces;
    const activeWsId = useWorkspaceStore.getState().activeWorkspaceId;
    const activeWs = workspaces.find((w: any) => w.id === activeWsId);
    const workspaceName = activeWs?.name || activeWsId;
    
    const runbooks = useWorkspaceStore.getState().runbooks || [];
    const { activeSession, allSessions } = getSessionContext();
    
    let targetSession = activeSession;
    if (overrideSessionId) {
      targetSession = allSessions.find(s => s.id === overrideSessionId) || null;
    }
    
    const sessionId = targetSession?.id || '';
    const sessionName = targetSession?.name || '';
    const aiMode = appConfig.aiMode || 'readonly';
    
    let terminalBuffer = undefined;
    if (aiMode !== 'readonly' && sessionId) {
      terminalBuffer = getTerminalBuffer(sessionId);
    }

    let firstChunk = false;
    try {
      await AiBridge.invokePrivileged(
        {
          requestId: aiMsgId,
          prompt: promptText,
          contextData: { 
            workspaceName, 
            sessionId,
            sessionName,
            language: useAppStore.getState().appConfig.language,
            personaContent: getPersonaContent(appConfig.activePromptId, useAppStore.getState().appConfig.language),
            runbooks: runbooks.map(r => ({ name: r.name, description: r.description || '', dangerLevel: r.dangerLevel })), 
            terminalBuffer 
          },
          mode: aiMode,
          provider: appConfig.aiProvider,
          model: appConfig.aiModel,
          endpoint: appConfig.aiEndpoint,
        },
        (payload) => {
          if (payload.chunk) {
            if (!firstChunk) {
              firstChunk = true;
              updateMessage(convId, aiMsgId, { isThinking: false, isStreaming: true });
            }
            appendChunk(convId, aiMsgId, payload.chunk);
          }
          if (payload.isDone) {
            updateMessage(convId, aiMsgId, { isThinking: false, isStreaming: false });
            setIsGenerating(false);
          }
          if (payload.error) {
            updateMessage(convId, aiMsgId, { content: `[Error] ${payload.error}`, isThinking: false, isStreaming: false });
            setIsGenerating(false);
          }
        },
        (command: string, requestId: string) => {
           updateMessage(convId, aiMsgId, { approvalRequest: { command, requestId, status: 'pending' } });
        }
      );
    } catch (err: any) {
      updateMessage(convId, aiMsgId, { content: `[Pipeline Error] ${err.message}`, isThinking: false, isStreaming: false });
      setIsGenerating(false);
    }
  };

  // ─── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isGenerating) return;

    let convId = activeConversationId;
    const convExists = useAiChatStore.getState().conversations.some(c => c.id === convId);
    if (!convId || !convExists) {
      convId = newConversation();
    }

    const currentPrompt = prompt.trim();
    setPrompt('');
    setIsGenerating(true);
    setView('chat');

    const userMsgId = `user-${Date.now()}`;
    addMessage(convId, { id: userMsgId, role: 'user', content: currentPrompt, timestamp: Date.now() });

    // Ambiguity Check
    const { activeSession, allSessions } = getSessionContext();
    if (!activeSession && allSessions.length > 1) {
      const aiMsgId = `ai-${Date.now() + 1}`;
      addMessage(convId, { 
        id: aiMsgId, 
        role: 'assistant', 
        content: '', 
        timestamp: Date.now(),
        serverSelectionRequest: {
          availableServers: allSessions,
          pendingPrompt: currentPrompt,
          status: 'pending'
        }
      });
      setIsGenerating(false);
      return;
    }

    const aiMsgId = `ai-${Date.now() + 1}`;
    addMessage(convId, { id: aiMsgId, role: 'assistant', content: '', isThinking: true, isStreaming: false, timestamp: Date.now() });

    await generateResponse(convId, aiMsgId, currentPrompt);
  };

  const handleRetry = async (aiMsgId: string, userText: string) => {
    if (isGenerating) return;
    const convId = activeConversationId;
    if (!convId) return;

    setIsGenerating(true);
    updateMessage(convId, aiMsgId, { content: '', isThinking: true, isStreaming: false, approvalRequest: undefined });
    await generateResponse(convId, aiMsgId, userText);
  };

  const handleServerSelect = async (aiMsgId: string, serverId: string, serverName: string) => {
    const convId = activeConversationId;
    if (!convId) return;

    const activeConv = useAiChatStore.getState().conversations.find(c => c.id === convId);
    if (!activeConv) return;
    const aiMsg = activeConv.messages.find(m => m.id === aiMsgId);
    if (!aiMsg || !aiMsg.serverSelectionRequest) return;

    const pendingPrompt = aiMsg.serverSelectionRequest.pendingPrompt;

    updateMessage(convId, aiMsgId, { 
      content: `已锁定目标服务器：**${serverName}**\n正在为您生成操作...`, 
      serverSelectionRequest: { ...aiMsg.serverSelectionRequest, status: 'resolved', selectedServerId: serverId },
      isThinking: true 
    });

    setIsGenerating(true);
    await generateResponse(convId, aiMsgId, pendingPrompt, serverId);
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
              dragListener={false}
              dragControls={dragControls}
              exemptFromFocus
              className={`w-full flex flex-col border backdrop-blur-3xl overflow-hidden ${isDark ? 'bg-[#0f111a]/80 border-white/10 shadow-[0_24px_64px_rgba(0,0,0,0.6)]' : 'bg-white/90 border-black/10 shadow-[0_24px_64px_rgba(0,0,0,0.15)]'}`}
              style={{ borderRadius: '24px', WebkitAppRegion: 'no-drag', height: '620px' } as any}
            >
              {/* ── Header ── */}
              <div 
                className={`px-5 py-4 border-b flex items-center justify-between shrink-0 cursor-move ${isDark ? 'bg-white/[0.02] border-white/10' : 'bg-black/[0.02] border-black/5'}`}
                onPointerDown={(e) => dragControls.start(e)}
                style={{ touchAction: 'none' }}
              >
                <div className="flex items-center bg-black/10 dark:bg-white/10 p-1 rounded-xl">
                  {/* Tab switcher */}
                  <button
                    onClick={() => setView('chat')}
                    className={`flex items-center gap-2 px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-all rounded-lg ${
                      view === 'chat'
                        ? (isDark ? 'bg-[#2a2d3d] text-white shadow-md' : 'bg-white text-slate-900 shadow-sm')
                        : (isDark ? 'text-white/40 hover:text-white' : 'text-slate-500 hover:text-slate-900')
                    }`}
                  >
                    <Bot size={14} /> 对话
                  </button>
                  <button
                    onClick={() => setView('history')}
                    className={`flex items-center gap-2 px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-all rounded-lg relative ${
                      view === 'history'
                        ? (isDark ? 'bg-[#2a2d3d] text-white shadow-md' : 'bg-white text-slate-900 shadow-sm')
                        : (isDark ? 'text-white/40 hover:text-white' : 'text-slate-500 hover:text-slate-900')
                    }`}
                  >
                    <History size={14} /> 历史
                    {conversations.length > 0 && (
                      <span className={`ml-1 text-[9px] font-mono px-1.5 py-0.5 rounded-full ${isDark ? 'bg-white/10 text-white/60' : 'bg-black/10 text-slate-600'}`}>
                        {conversations.length}
                      </span>
                    )}
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button onClick={() => window.dispatchEvent(new CustomEvent('app:open-center', { detail: { type: 'ai', title: 'AI CENTER' } }))} className={`p-2 transition-all rounded-xl ${isDark ? 'text-white/40 hover:text-white hover:bg-white/10' : 'text-slate-400 hover:text-slate-900 hover:bg-black/5'}`}>
                    <Settings size={16} />
                  </button>
                  <button onClick={() => setIsAiCenterOpen(false)} className={`p-2 transition-all rounded-xl ${isDark ? 'text-white/40 hover:text-white hover:bg-white/10' : 'text-slate-400 hover:text-slate-900 hover:bg-black/5'}`}>
                    <X size={16} />
                  </button>
                </div>
              </div>

              {/* ── Conversation breadcrumb (chat view) ── */}
              <AnimatePresence>
                {view === 'chat' && activeConv && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className={`px-5 py-2 border-b flex items-center gap-3 shrink-0 ${isDark ? 'border-white/5 bg-black/20' : 'border-black/5 bg-slate-50/50'}`}
                  >
                    <Clock className={`w-3.5 h-3.5 ${isDark ? 'text-white/30' : 'text-slate-400'}`} />
                    <span className={`text-[11px] font-bold truncate flex-1 ${isDark ? 'text-white/60' : 'text-slate-600'}`}>{activeConv.title}</span>
                    {appConfig.aiModel && (
                      <span className={`text-[9px] font-mono font-bold px-2 py-0.5 shrink-0 rounded-full border ${isDark ? 'text-primary border-primary/30 bg-primary/10' : 'text-primary border-primary/20 bg-primary/5'}`}>
                        {appConfig.aiModel}
                      </span>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* ── Body ── */}
              <div className="flex-1 flex flex-col overflow-hidden" style={{ minHeight: 0 }}>
                {isLocked ? (
                  <div className={`flex-1 flex flex-col items-center justify-center gap-4 p-8 ${isDark ? 'text-white/40' : 'text-slate-500'}`}>
                    <div className="text-sm font-bold tracking-widest uppercase mb-2">AI CENTER 已禁用</div>
                    <button onClick={() => window.dispatchEvent(new CustomEvent('app:open-center', { detail: { type: 'ai', title: 'AI CENTER' } }))} className={`px-6 py-2.5 border text-xs font-bold uppercase tracking-widest transition-colors rounded-full ${isDark ? 'border-white/20 hover:bg-white/10 text-white' : 'border-black/20 hover:bg-black/10 text-slate-800'}`}>
                      前往设置开启
                    </button>
                  </div>
                ) : needsKey ? (
                  <div className={`flex-1 flex flex-col items-center justify-center gap-4 p-8 ${isDark ? 'text-white/40' : 'text-slate-500'}`}>
                    <div className="text-sm font-bold tracking-widest uppercase mb-2">需要绑定 API Key</div>
                    <button onClick={() => window.dispatchEvent(new CustomEvent('app:open-center', { detail: { type: 'ai', title: 'AI CENTER' } }))} className={`px-6 py-2.5 border text-xs font-bold uppercase tracking-widest transition-colors rounded-full ${isDark ? 'border-primary/50 hover:bg-primary/20 text-primary bg-primary/10' : 'border-primary/50 hover:bg-primary/10 text-primary bg-primary/5'}`}>
                      配置大模型密钥
                    </button>
                  </div>
                ) : view === 'history' ? (
                  <HistoryView />
                ) : (
                  <ChatView onPaperPlane={handlePaperPlane} onRetry={handleRetry} onServerSelect={handleServerSelect} />
                )}
              </div>

              {/* ── Input Area (only in chat mode, when not locked) ── */}
              {view === 'chat' && !isLocked && !needsKey && (
                <div className={`relative p-4 border-t shrink-0 ${isDark ? 'border-white/10 bg-[#0a0a0a]/50' : 'border-black/10 bg-slate-100/50'}`}>
                  <AnimatePresence>
                    {currentTerminalSelection && (
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="absolute -top-14 left-4 z-10"
                      >
                        <button
                          onClick={handleInjectSelection}
                          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-500 hover:bg-indigo-400 border border-indigo-400 text-white text-[11px] tracking-wider font-bold rounded-full shadow-lg shadow-indigo-500/30 transition-all active:scale-95"
                        >
                          <ClipboardPaste size={14} />
                          粘贴终端选中文本
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <form id="ai-chat-form" onSubmit={handleSubmit} className="flex gap-3 items-end relative">
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
                      placeholder={isGenerating ? '正在思考中...' : '输入问题或指令... (Enter 发送, Shift+Enter 换行)'}
                      className={`w-full h-[64px] border text-sm p-4 pr-16 outline-none resize-none rounded-2xl transition-colors shadow-inner ${isDark ? 'bg-black/40 border-white/10 text-white placeholder-white/20 focus:border-primary/50' : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400 focus:border-primary/50 shadow-sm'}`}
                    />
                    <button
                      type="submit"
                      disabled={isGenerating || !prompt.trim()}
                      className={`absolute right-2 bottom-2 h-[48px] w-[48px] disabled:opacity-40 transition-all flex items-center justify-center rounded-xl shadow-md ${(!isGenerating && prompt.trim()) ? 'bg-primary hover:bg-primary/90 text-white scale-100 active:scale-90 shadow-primary/30' : (isDark ? 'bg-white/10 text-white/40 shadow-none' : 'bg-slate-100 border border-slate-200 text-slate-400 shadow-none')}`}
                    >
                      {isGenerating
                        ? <motion.div
                            className={`w-5 h-5 border-2 border-t-transparent rounded-full ${isDark ? 'border-primary/60' : 'border-slate-400'}`}
                            animate={{ rotate: 360 }}
                            transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                          />
                        : <Send size={18} className="ml-0.5" />
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
