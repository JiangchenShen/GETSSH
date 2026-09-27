import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { Bot, Settings, X, History, Clock } from 'lucide-react';

import { useAppStore } from '../../store/appStore';
import { useAiChatStore } from '../../store/aiChatStore';

import { SPRING_SNAPPY } from './shared';
import { HistoryView } from './HistoryView';
import { ChatView } from './ChatView';
import { InputArea } from './InputArea';
import { useAiConversation } from './useAiConversation';

export const AiCenter: React.FC = () => {
  const isAiCenterOpen = useAppStore(state => state.isAiCenterOpen);
  const isDark = useAppStore(state => state.isDark);
  const dragControls = useDragControls();

  const setIsAiCenterOpen = useAppStore(state => state.setIsAiCenterOpen);
  const setIsHoveringAiCenter = useAppStore(state => state.setIsHoveringAiCenter);
  const appConfig = useAppStore(state => state.appConfig);

  const view = useAiChatStore(s => s.view);
  const setView = useAiChatStore(s => s.setView);
  const conversations = useAiChatStore(s => s.conversations);
  const activeConversationId = useAiChatStore(s => s.activeConversationId);
  const { prompt, setPrompt, isGenerating, handleSubmit, handleRetry, handleServerSelect, handlePaperPlane } = useAiConversation();
  const [bounds, setBounds] = useState({ left: -60, right: 800, top: -600, bottom: 20 });

  useEffect(() => {
    const updateBounds = () => setBounds({
      left: -60, right: window.innerWidth - 530,
      top: -window.innerHeight + 500, bottom: 20,
    });
    updateBounds();
    window.addEventListener('resize', updateBounds);
    return () => window.removeEventListener('resize', updateBounds);
  }, []);

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
    detail: { type: 'settings', title: '设置', settingsTab: 'AI' },
  }));

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
            <motion.div
              drag
              dragConstraints={bounds}
              dragListener={false}
              dragControls={dragControls}
              dragElastic={0.2}
              dragMomentum
              dragTransition={{ bounceStiffness: 120, bounceDamping: 20, timeConstant: 400 }}
              whileDrag={{ scale: 1.02, cursor: 'grabbing' }}
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
                  <button onClick={openAiSettings} className={`p-2 transition-all rounded-xl ${isDark ? 'text-white/40 hover:text-white hover:bg-white/10' : 'text-slate-400 hover:text-slate-900 hover:bg-black/5'}`} title="AI 设置" aria-label="AI 设置">
                    <Settings size={16} />
                  </button>
                  <button onClick={() => setIsAiCenterOpen(false)} className={`p-2 transition-all rounded-xl ${isDark ? 'text-white/40 hover:text-white hover:bg-white/10' : 'text-slate-400 hover:text-slate-900 hover:bg-black/5'}`}>
                    <X size={16} />
                  </button>
                </div>
              </div>

              {/* ── Conversation breadcrumb ── */}
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
                    <button onClick={openAiSettings} className={`px-6 py-2.5 border text-xs font-bold uppercase tracking-widest transition-colors rounded-full ${isDark ? 'border-white/20 hover:bg-white/10 text-white' : 'border-black/20 hover:bg-black/10 text-slate-800'}`}>
                      前往设置开启
                    </button>
                  </div>
                ) : needsKey ? (
                  <div className={`flex-1 flex flex-col items-center justify-center gap-4 p-8 ${isDark ? 'text-white/40' : 'text-slate-500'}`}>
                    <div className="text-sm font-bold tracking-widest uppercase mb-2">需要绑定 API Key</div>
                    <button onClick={openAiSettings} className={`px-6 py-2.5 border text-xs font-bold uppercase tracking-widest transition-colors rounded-full ${isDark ? 'border-primary/50 hover:bg-primary/20 text-primary bg-primary/10' : 'border-primary/50 hover:bg-primary/10 text-primary bg-primary/5'}`}>
                      配置大模型密钥
                    </button>
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
