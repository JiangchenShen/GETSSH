import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence, useDragControls, useReducedMotion } from 'framer-motion';
import { Bot, Settings, X, History, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useAppStore } from '../../store/appStore';
import { useAiChatStore } from '../../store/aiChatStore';

import { HistoryView } from './HistoryView';
import { ChatView } from './ChatView';
import { InputArea } from './InputArea';
import { useAiConversation } from './useAiConversation';
import { settingButtonClass } from '../settings/SettingsControls';

export const AiCenter: React.FC = () => {
  const { t, i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const isAiCenterOpen = useAppStore(state => state.isAiCenterOpen);
  const dragControls = useDragControls();
  const reduceMotion = useReducedMotion();
  const bounds = useRef<HTMLDivElement>(null);

  const setIsAiCenterOpen = useAppStore(state => state.setIsAiCenterOpen);
  const setIsHoveringAiCenter = useAppStore(state => state.setIsHoveringAiCenter);
  const appConfig = useAppStore(state => state.appConfig);

  const view = useAiChatStore(s => s.view);
  const setView = useAiChatStore(s => s.setView);
  const conversations = useAiChatStore(s => s.conversations);
  const activeConversationId = useAiChatStore(s => s.activeConversationId);
  const { prompt, setPrompt, isGenerating, handleSubmit, handleRetry, handleServerSelect, handlePaperPlane } = useAiConversation();

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

  const isLocked = !appConfig.aiEnabled;
  const needsKey = !appConfig.hasAiApiKey && appConfig.aiProvider !== 'ollama';
  const activeConv = conversations.find(c => c.id === activeConversationId);
  const openAiSettings = () => window.dispatchEvent(new CustomEvent('app:open-center', {
    detail: { type: 'settings', title: t('statusBar.settings'), settingsTab: 'AI' },
  }));
  const settingsLabel = zh ? 'AI 配置' : 'AI settings';

  return (
    <div ref={bounds} className="management-overlay ai-companion-bounds">
      <AnimatePresence>
        {isAiCenterOpen && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: 5 }}
            transition={{ duration: 0.15 }}
            className="ai-companion-anchor"
            onPointerEnter={() => setIsHoveringAiCenter(true)}
            onPointerLeave={() => setIsHoveringAiCenter(false)}
          >
            <motion.div
              drag
              dragConstraints={bounds}
              dragListener={false}
              dragControls={dragControls}
              dragElastic={0}
              dragMomentum={false}
              className="ai-companion-panel"
              role="region"
              aria-label={zh ? 'AI 助手' : 'AI assistant'}
            >
              <header className="ai-companion-header">
                <div className="ai-companion-title" onPointerDown={event => dragControls.start(event)}>
                  <Bot size={16} aria-hidden="true" />
                  <span>{zh ? 'AI 助手' : 'AI assistant'}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" onClick={openAiSettings} className="management-icon-button" title={settingsLabel} aria-label={settingsLabel}>
                    <Settings size={15} aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => setIsAiCenterOpen(false)} className="management-icon-button" title={zh ? '关闭' : 'Close'} aria-label={zh ? '关闭' : 'Close'}>
                    <X size={15} aria-hidden="true" />
                  </button>
                </div>
              </header>
              <div className="ai-companion-tabs" role="group" aria-label={zh ? '助手视图' : 'Assistant views'}>
                  <button
                    type="button"
                    onClick={() => setView('chat')}
                    aria-pressed={view === 'chat'}
                  >
                    <Bot size={14} aria-hidden="true" />{zh ? '对话' : 'Chat'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setView('history')}
                    aria-pressed={view === 'history'}
                  >
                    <History size={14} aria-hidden="true" />{zh ? '历史' : 'History'}
                    {conversations.length > 0 && <span className="font-mono text-ink-3">{conversations.length}</span>}
                  </button>
              </div>

              {view === 'chat' && activeConv && (
                <div className="flex shrink-0 flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-line-soft bg-surf-2 px-4 py-2 text-xs text-ink-2">
                  <Clock className="size-3.5 shrink-0 self-center text-ink-3" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate" title={activeConv.title}>{activeConv.title}</span>
                  {appConfig.aiModel && <span className="max-w-[50%] truncate font-mono text-[11px] text-ink-3" title={appConfig.aiModel}>{appConfig.aiModel}</span>}
                </div>
              )}

              {/* ── Body ── */}
              <div key={isLocked || needsKey ? 'unconfigured' : view} className="ui-section-enter flex min-h-0 flex-1 flex-col overflow-hidden">
                {isLocked || needsKey ? (
                  <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-4 py-5 text-center">
                    <p className="text-sm font-medium text-ink">{isLocked ? (zh ? 'AI 已关闭' : 'AI is off') : (zh ? '需要设置 API 密钥' : 'An API key is required')}</p>
                    <button type="button" onClick={openAiSettings} className={settingButtonClass}>{settingsLabel}</button>
                  </div>
                ) : view === 'history' ? (
                  <HistoryView />
                ) : (
                  <ChatView onPaperPlane={handlePaperPlane} onRetry={handleRetry} onServerSelect={handleServerSelect} />
                )}
              </div>

              {/* ── Input Area ── */}
              {view === 'chat' && !isLocked && !needsKey && (
                <InputArea
                  prompt={prompt}
                  setPrompt={setPrompt}
                  isGenerating={isGenerating}
                  onSubmit={handleSubmit}
                />
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
