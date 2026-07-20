import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Bot, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AiBridge } from '../../services/aiBridge';
import { useAppStore } from '../../store/appStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { MarkdownRenderer } from '../common/MarkdownRenderer';
import { getPersonaContent } from '../../utils/persona';

interface Props {
  onClose: () => void;
  onConnect: (session: any) => void;
  isDark: boolean;
  sessions: any[];
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

export const CommandCenterAiChat: React.FC<Props> = ({ onClose, onConnect, isDark, sessions }) => {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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

      const userMsgId = Date.now().toString();
      const aiMsgId = (Date.now() + 1).toString();

      setMessages(prev => [
        ...prev,
        { id: userMsgId, role: 'user', content: prompt },
        { id: aiMsgId, role: 'assistant', content: '', isStreaming: true }
      ]);

      const appConfig = useAppStore.getState().appConfig;
      const workspaceName = useWorkspaceStore.getState().activeWorkspaceId;

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
              personaContent: getPersonaContent(appConfig.activePromptId, appConfig.language),
              terminalBuffer: JSON.stringify(sessions.map(s => ({ alias: s.alias, host: s.host }))) 
            },
            mode: 'agent_full', // Always full autonomy for global actions
            provider: appConfig.aiProvider,
            model: appConfig.aiModel,
            endpoint: appConfig.aiEndpoint,
          },
          (payload) => {
            setMessages(prev => prev.map(msg => {
              if (msg.id === aiMsgId) {
                return { 
                  ...msg, 
                  content: msg.content + payload.chunk, 
                  isStreaming: !payload.isDone 
                };
              }
              return msg;
            }));
          }
        );
      } catch (err: any) {
        setMessages(prev => prev.map(msg => {
          if (msg.id === aiMsgId) {
            return { ...msg, content: msg.content + `\n\n**Error**: ${err.message}`, isStreaming: false };
          }
          return msg;
        }));
      }
    };

    window.addEventListener('command-center:ai-submit', handleAiSubmit);
    return () => window.removeEventListener('command-center:ai-submit', handleAiSubmit);
  }, [sessions]);

  // Handle global session opens
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.ai || !(window.electronAPI.ai as any).onAgentGlobalAction) return;

    const removeListener = (window.electronAPI.ai as any).onAgentGlobalAction((payload: { action: string, target: string, execute: string }) => {
       if (payload.action === 'open_session') {
          // Find the session
          const session = sessions.find(s => s.alias === payload.target || s.host === payload.target);
          if (session) {
             const sessionToOpen = { ...session };
             onClose();
             onConnect(sessionToOpen);

             // If AI provided a follow-up command, track it locally via AiCenter
             if (payload.execute) {
                setTimeout(() => {
                   useAppStore.getState().setIsAiCenterOpen(true);
                   setTimeout(() => {
                      const prompt = t('commandCenter.aiFollowup', { command: payload.execute, defaultValue: `Execute the following command: {{command}}` }).replace('{{command}}', payload.execute);
                      window.dispatchEvent(new CustomEvent('ai:submit-prompt', { detail: prompt }));
                   }, 300);
                }, 1000); // Give terminal enough time to initialize
             }
          } else {
             // Let the user know the session wasn't found
             const errorMsg = t('commandCenter.hostNotFound', { target: payload.target, defaultValue: `❌ 找不到主机: {{target}}` }).replace('{{target}}', payload.target);
             setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: errorMsg }]);
          }
       }
    });
    return () => removeListener();
  }, [sessions, onClose, onConnect, t]);

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
            {msg.isStreaming && !msg.content ? (
              <ThinkingIndicator />
            ) : (
              <div className="leading-relaxed">
                <MarkdownRenderer content={msg.content} />
                {msg.isStreaming && <span className="inline-block w-1.5 h-3 ml-1 bg-current animate-pulse align-middle" />}
              </div>
            )}
          </div>
        </motion.div>
      ))}
    </div>
  );
};
