import React, { useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
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
            ) : (() => {
              const { thoughtProcess, actualContent, isThinkingDone } = parseThoughtProcess(msg.content);
              return (
              <div className={`px-5 py-3.5 text-sm leading-relaxed break-words shadow-md flex-col flex ${
                msg.role === 'user'
                  ? 'bg-primary text-white rounded-3xl rounded-tr-sm shadow-primary/20'
                  : (isDark ? 'bg-[#1a1b26] border border-white/10 text-neutral-200 rounded-3xl rounded-tl-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-3xl rounded-tl-sm')
              }`}>
                {msg.role === 'assistant' && thoughtProcess && (
                  <ThoughtProcessBlock thoughtProcess={thoughtProcess} isDark={isDark} isThinkingDone={isThinkingDone} />
                )}
                {msg.role === 'user'
                  ? <p className="whitespace-pre-wrap break-words">{actualContent}</p>
                  : (actualContent ? <MarkdownRenderer content={actualContent} onPaperPlane={onPaperPlane} /> : null)
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
            )})()}
          </div>
        </motion.div>
      ))}
      <div ref={scrollEndRef} className="h-4" />
    </div>
  );
};
