import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Bot, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AiBridge } from '../../services/aiBridge';
import { useAppStore } from '../../store/appStore';
import { useAiStore } from '../../store/aiStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useAiChatStore } from '../../store/aiChatStore';
import { MarkdownRenderer } from '../common/MarkdownRenderer';
import { parseThoughtProcess, ThoughtProcessBlock } from '../common/ThoughtProcessBlock';
import { getPersonaContent } from '../../utils/persona';

interface Props {
  onClose: () => void;
  onConnect: (session: any) => void;
  isDark: boolean;
  sessions: any[];
}


export const CommandCenterAiChat: React.FC<Props> = ({ isDark, sessions }) => {
  const { t } = useTranslation();
  const { activeConversationId, conversations } = useAiChatStore();
  const activeConversation = conversations.find(c => c.id === activeConversationId);
  const messages = activeConversation ? activeConversation.messages : [];
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const handleAiSubmit = async (e: Event) => {
      const customEvent = e as CustomEvent;
      const prompt = customEvent.detail;
      if (!prompt) return;

      let convId = useAiChatStore.getState().activeConversationId;
      const convExists = useAiChatStore.getState().conversations.some(c => c.id === convId);
      if (!convId || !convExists) {
        convId = useAiChatStore.getState().newConversation();
      }

      const userMsgId = `user-${Date.now()}`;
      const aiMsgId = `ai-${Date.now()}`;

      useAiChatStore.getState().addMessage(convId, { id: userMsgId, role: 'user', content: prompt, timestamp: Date.now() });
      useAiChatStore.getState().addMessage(convId, { id: aiMsgId, role: 'assistant', content: '', timestamp: Date.now() + 1, isStreaming: true, isThinking: true });

      const appConfig = useAppStore.getState().appConfig;
      const aiConfig = useAiStore.getState().aiConfig;
      const searchConfig = useAiStore.getState().getSearchPayload();
      const workspaceName = useWorkspaceStore.getState().activeWorkspaceId;

      let firstChunk = false;
      try {
        await AiBridge.invokePrivileged(
          {
            requestId: aiMsgId,
            prompt,
            contextData: { 
              workspaceName, 
              sessionId: '', // Empty means global context
              sessionName: '',
              runbooks: [], 
              language: appConfig.language,
              personaContent: getPersonaContent(aiConfig.activePromptId, appConfig.language),
              terminalBuffer: JSON.stringify(sessions.map(s => ({ alias: s.alias, host: s.host }))),
              aiSearchEnabled: searchConfig.enabled
            },
            mode: 'agent_full', // Global Dispatch Center ALWAYS uses AgentEngine regardless of user's aiMode setting
            provider: appConfig.aiProvider || aiConfig.aiProvider,
            model: appConfig.aiModel || aiConfig.aiModel,
            thinkingEffort: appConfig.aiThinkingEffort || aiConfig.aiThinkingEffort || 'medium',
            endpoint: appConfig.aiEndpoint || aiConfig.aiEndpoint,
            aiMaxTokens: appConfig.aiMaxTokens || aiConfig.aiMaxTokens || 200000,
            searchConfig
          },
          (payload) => {
             if (payload.chunk) {
               if (!firstChunk) {
                 firstChunk = true;
                 useAiChatStore.getState().updateMessage(convId!, aiMsgId, { isThinking: false, isStreaming: true });
               }
               useAiChatStore.getState().appendChunk(convId!, aiMsgId, payload.chunk);
             }
             if (payload.isDone) {
               useAiChatStore.getState().updateMessage(convId!, aiMsgId, { isThinking: false, isStreaming: false });
             }
             if (payload.error) {
               useAiChatStore.getState().updateMessage(convId!, aiMsgId, { content: `[Error] ${payload.error}`, isThinking: false, isStreaming: false });
             }
          }
        );
      } catch (err: any) {
        useAiChatStore.getState().updateMessage(convId, aiMsgId, { content: `[Pipeline Error] ${err.message}`, isThinking: false, isStreaming: false });
      }
    };

    window.addEventListener('command-center:ai-submit', handleAiSubmit);
    return () => window.removeEventListener('command-center:ai-submit', handleAiSubmit);
  }, [sessions]);



  const ThinkingIndicator: React.FC = () => (
    <div className={`flex items-center gap-2 text-xs font-mono tracking-widest ${isDark ? 'text-white/40' : 'text-slate-400'}`}>
      <span className="uppercase">THINKING</span>
      <span className="flex gap-[3px] items-center">
        {[0, 1, 2].map(i => (
          <motion.span
            key={i}
            className={`w-1 h-1 rounded-xl inline-block ${isDark ? 'bg-white/40' : 'bg-slate-400'}`}
            animate={{ opacity: [0.2, 1, 0.2] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2, ease: 'easeInOut' }}
          />
        ))}
      </span>
    </div>
  );

  if (messages.length === 0) {
    return (
      <div className={`flex-1 min-h-[300px] max-h-[400px] flex items-center justify-center text-sm ${isDark ? 'text-white/40' : 'text-slate-400'}`}>
        <div className="flex flex-col items-center gap-2">
          <Bot className="w-8 h-8 opacity-50" />
          <p>{t('commandCenter.aiHint', 'Ask me to open servers, run commands, or answer questions...')}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 min-h-[300px] max-h-[400px] overflow-y-auto p-4 flex flex-col gap-4">
      {messages.map(msg => (
        <motion.div
          key={msg.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
        >
          <div className={`w-6 h-6 shrink-0 flex items-center justify-center rounded-xl border mt-0.5 ${
            msg.role === 'user'
              ? (isDark ? 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400' : 'bg-cyan-500/10 border-cyan-500/20 text-cyan-600')
              : (isDark ? 'bg-purple-500/20 border-purple-500/30 text-purple-400' : 'bg-purple-500/10 border-purple-500/20 text-purple-600')
          }`}>
            {msg.role === 'user' ? <User size={12} /> : <Bot size={12} />}
          </div>
          <div className={`px-4 py-2 text-sm leading-relaxed max-w-[85%] break-words shadow-sm ${
            msg.role === 'user'
              ? (isDark ? 'bg-cyan-500/10 border border-cyan-500/20 text-cyan-50 rounded-2xl rounded-tr-sm' : 'bg-cyan-50 border border-cyan-500/20 text-slate-800 rounded-2xl rounded-tr-sm')
              : (isDark ? 'bg-white/5 border border-white/10 text-neutral-200 rounded-2xl rounded-tl-sm' : 'bg-white border border-black/10 text-slate-800 rounded-2xl rounded-tl-sm')
          }`}>
            {msg.isThinking && !msg.content ? (
              <ThinkingIndicator />
            ) : (() => {
              const { thoughtProcess, actualContent, isThinkingDone } = parseThoughtProcess(msg.content);
              return (
                <div className="leading-relaxed">
                  {msg.role === 'assistant' && thoughtProcess && (
                    <ThoughtProcessBlock thoughtProcess={thoughtProcess} isDark={isDark} isThinkingDone={isThinkingDone} />
                  )}
                  {actualContent && <MarkdownRenderer content={actualContent} />}
                  {msg.isStreaming && <span className="inline-block w-1.5 h-3 ml-1 bg-current animate-pulse align-middle" />}
                </div>
              );
            })()}
          </div>
        </motion.div>
      ))}
    </div>
  );
};
