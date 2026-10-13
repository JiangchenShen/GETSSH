import React, { memo, useEffect, useMemo, useRef } from 'react';
import { Bot, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AiBridge } from '../../services/aiBridge';
import { useAppStore } from '../../store/appStore';
import { useAppLockStore } from '../../store/appLockStore';
import { useAiStore } from '../../store/aiStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useAiChatStore, type ChatMessage } from '../../store/aiChatStore';
import { MarkdownRenderer } from '../common/MarkdownRenderer';
import { parseThoughtProcess, ThoughtProcessBlock } from '../common/ThoughtProcessBlock';
import { getPersonaContent } from '../../utils/persona';

interface Props {
  onClose: () => void;
  onConnect: (session: any) => void;
  isDark: boolean;
  sessions: any[];
}

const emptyMessages: ChatMessage[] = [];
const CommandMessageView = memo(function CommandMessageView({ msg, isDark, you, thinking }: { msg: ChatMessage; isDark: boolean; you: string; thinking: string }) {
  const { thoughtProcess, actualContent, isThinkingDone } = useMemo(() => parseThoughtProcess(msg.content), [msg.content]);
  return <div data-message-id={msg.id} className="flex gap-3 border-b border-line-soft py-4 last:border-b-0">
    <div className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md border border-line ${msg.role === 'user' ? 'bg-panel text-ink-2' : 'bg-primary/10 text-primary'}`}>
      {msg.role === 'user' ? <User size={14} aria-hidden="true" /> : <Bot size={14} aria-hidden="true" />}
    </div>
    <div className="min-w-0 flex-1 break-words text-sm leading-relaxed text-ink">
      <p className="mb-1.5 text-[10px] font-medium text-ink-3">{msg.role === 'user' ? you : 'AI'}</p>
      {msg.isThinking && !msg.content ? <span className="text-xs text-ink-3">{thinking}</span> : <div className="leading-relaxed">
        {msg.role === 'assistant' && thoughtProcess && <ThoughtProcessBlock thoughtProcess={thoughtProcess} isDark={isDark} isThinkingDone={isThinkingDone} />}
        {actualContent && <MarkdownRenderer content={actualContent} />}
        {msg.isStreaming && <span className="ml-1 inline-block h-3 w-1 bg-primary align-middle motion-safe:animate-pulse" />}
      </div>}
    </div>
  </div>;
});

export const CommandCenterAiChat: React.FC<Props> = ({ isDark, sessions }) => {
  const { t } = useTranslation();
  const messages = useAiChatStore(state => state.conversations.find(c => c.id === state.activeConversationId)?.messages ?? emptyMessages);
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
      const phase = useAppLockStore.getState().state?.phase;
      if (!prompt || useWorkspaceStore.getState().isSwitching || (phase && phase !== 'ready')) return;

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

      let invalidated = false;
      let finished = false;
      const isCurrent = () => !invalidated && useWorkspaceStore.getState().activeWorkspaceId === workspaceName && !useWorkspaceStore.getState().isSwitching
        && (!useAppLockStore.getState().state || useAppLockStore.getState().state?.phase === 'ready');
      const unsubscribeWorkspace = useWorkspaceStore.subscribe(state => {
        if (state.activeWorkspaceId !== workspaceName || state.isSwitching) { invalidated = true; cleanup(); }
      });
      const unsubscribeLock = useAppLockStore.subscribe(state => { if (state.state && state.state.phase !== 'ready') { invalidated = true; cleanup(); } });
      const cleanup = () => { unsubscribeWorkspace(); unsubscribeLock(); };
      const finish = () => {
        if (!isCurrent() || finished) return;
        finished = true;
        useAiChatStore.getState().updateMessage(convId!, aiMsgId, { isThinking: false, isStreaming: false });
        cleanup();
      };
      try {
        await AiBridge.invokePrivileged(
          {
            requestId: crypto.randomUUID(),
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
            mode: appConfig.aiMode || aiConfig.aiMode || 'readonly',
            provider: appConfig.aiProvider || aiConfig.aiProvider,
            model: appConfig.aiModel || aiConfig.aiModel,
            thinkingEffort: appConfig.aiThinkingEffort || aiConfig.aiThinkingEffort || 'medium',
            endpoint: appConfig.aiEndpoint || aiConfig.aiEndpoint,
            aiMaxTokens: appConfig.aiMaxTokens || aiConfig.aiMaxTokens || 200000,
            searchConfig
          },
          (payload) => {
             if (!isCurrent() || finished) return;
             if (payload.chunk) {
               useAiChatStore.getState().appendChunk(convId!, aiMsgId, payload.chunk);
             }
             if (payload.error) {
               finished = true;
               useAiChatStore.getState().updateMessage(convId!, aiMsgId, { content: `[Error] ${payload.error}`, isThinking: false, isStreaming: false });
               cleanup();
             } else if (payload.isDone) finish();
          }
        );
        // The invoke response is only an acknowledgement; streaming completes on isDone.
      } catch (err: any) {
        if (isCurrent() && !finished) {
          finished = true;
          useAiChatStore.getState().updateMessage(convId, aiMsgId, { content: `[Pipeline Error] ${err.message}`, isThinking: false, isStreaming: false });
        }
        cleanup();
      }
    };

    window.addEventListener('command-center:ai-submit', handleAiSubmit);
    return () => window.removeEventListener('command-center:ai-submit', handleAiSubmit);
  }, [sessions]);



  if (messages.length === 0) {
    return (
      <div className="flex min-h-[220px] flex-1 items-center justify-center px-6 py-10 text-center text-sm text-ink-3">
        <div className="flex max-w-sm flex-col items-center gap-2">
          <Bot className="h-5 w-5 text-primary" aria-hidden="true" />
          <p>{t('commandCenter.aiHint', 'Ask AI a question. Tool access follows your selected agent mode.')}</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex min-h-[220px] max-h-[52vh] flex-1 flex-col overflow-y-auto px-4">
      {messages.map(msg => <CommandMessageView key={msg.id} msg={msg} isDark={isDark} you={t('common.you', 'You')} thinking={t('common.thinking', 'Thinking…')} />)}
    </div>
  );
};
