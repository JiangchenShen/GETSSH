import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSessionStore } from '../store/sessionStore';
import { useAppStore } from '../store/appStore';
import { Send, TerminalSquare, ClipboardPaste, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AiBridge } from '../services/aiBridge';

// Simple custom Markdown parser for the floating window to isolate code blocks
const renderMarkdownWithPaperPlane = (text: string, onExecute: (code: string) => void, isDark: boolean) => {
  const parts = text.split(/(```[\w]*\s*[\s\S]*?```)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('```')) {
      const match = part.match(/```([\w]*)\s*([\s\S]*?)```/);
      if (match) {
        const lang = match[1];
        const code = match[2].trim();
        const isShell = ['bash', 'sh', ''].includes(lang.toLowerCase());
        
        return (
          <div key={idx} className={`relative my-2 rounded border overflow-hidden group ${isDark ? 'border-white/10 bg-black/50' : 'border-black/10 bg-slate-100'}`}>
            <div className={`flex items-center justify-between px-3 py-1 border-b ${isDark ? 'bg-white/5 border-white/10' : 'bg-white border-black/10'}`}>
              <span className={`text-[10px] font-mono uppercase ${isDark ? 'text-cyan-400' : 'text-cyan-600'}`}>{lang || 'sh'}</span>
              {isShell && (
                <button 
                  onClick={() => onExecute(code)}
                  title="Send to Terminal (No trailing newline)"
                  className={`transition-colors p-1 rounded ${isDark ? 'text-white/50 hover:text-cyan-400' : 'text-slate-400 hover:text-cyan-600'}`}
                >
                  <Send className="w-3.5 h-3.5 -rotate-45" />
                </button>
              )}
            </div>
            <pre className={`p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all ${isDark ? 'text-emerald-400' : 'text-emerald-700'}`}>
              {code}
            </pre>
          </div>
        );
      }
    }
    return <span key={idx} className="whitespace-pre-wrap leading-relaxed">{part}</span>;
  });
};

export const FloatingAiCenter: React.FC = () => {
  const { t, i18n } = useTranslation();
  const floatingCtx = useSessionStore(state => state.floatingAiContext);
  const setFloatingCtx = useSessionStore(state => state.setFloatingAiContext);
  const activeTabId = useSessionStore(state => state.activeTabId);
  const addToast = useAppStore(state => state.addToast);
  const isDark = useAppStore(state => state.isDark);
  
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  
  // Boundary collision logic
  const width = 500;
  const height = 400; // estimated max height
  
  let x = floatingCtx?.x || 0;
  let y = floatingCtx?.y || 0;
  
  if (typeof window !== 'undefined') {
    if (x + width > window.innerWidth - 20) x = window.innerWidth - width - 20;
    if (y + height > window.innerHeight - 20) y = window.innerHeight - height - 20;
    if (y < 20) y = 20;
  }

  useEffect(() => {
    if (floatingCtx) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setResponse('');
      setPrompt('');
    }
  }, [floatingCtx]);

  if (!floatingCtx) return null;

  const handlePasteSelection = () => {
    if (floatingCtx.selection) {
      setPrompt(prev => prev + (prev ? '\n' : '') + `\`\`\`\n${floatingCtx.selection}\n\`\`\`\n`);
    }
  };

  const handlePaperPlaneFill = (code: string) => {
    if (activeTabId && window.electronAPI?.sshWrite) {
      // 飞行员回填原则 (Airplane Filling Principle): Remove trailing \r \n
      const sanitized = code.replace(/[\r\n]+$/, '');
      window.electronAPI.sshWrite(activeTabId, sanitized);
      addToast(t('ai.codeInjected', '代码已安全填入终端缓冲，请核对后按回车执行') as string, 'success');
      setFloatingCtx(null);
    }
  };

  const handleSubmit = async () => {
    if (!prompt.trim() || isLoading) return;
    setIsLoading(true);
    setResponse('');
    
    try {
      const requestId = Date.now().toString();
      const appConfig = useAppStore.getState().appConfig;
      const finalPrompt = i18n.language === 'zh-CN' ? prompt + '\n\n(请尽量用中文回答我)' : prompt;
      
      await AiBridge.invokePrivileged({
        requestId,
        prompt: finalPrompt,
        provider: appConfig.aiProvider,
        model: appConfig.aiModel,
        endpoint: appConfig.aiEndpoint,
      }, (payload) => {
        if (payload.error) {
          setResponse(prev => prev + `\n\n**Error**: ${payload.error}`);
        } else if (payload.chunk) {
          setResponse(prev => prev + payload.chunk);
        }
        if (payload.isDone) {
          setIsLoading(false);
        }
      });
      
    } catch (e: any) {
      setResponse(`**Request Failed**: ${e.message}`);
      setIsLoading(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        style={{ left: x, top: y }}
        className={`fixed z-[9999] w-[500px] backdrop-blur-3xl border rounded-xl flex flex-col font-sans ${isDark ? 'bg-[#0a0a0a]/80 shadow-[0_0_50px_rgba(0,0,0,0.8)] border-white/10' : 'bg-white/90 shadow-[0_20px_50px_rgba(0,0,0,0.2)] border-black/10'}`}
      >
        <div className={`absolute inset-0 ring-1 ring-inset pointer-events-none ${isDark ? 'ring-white/5' : 'ring-black/5'}`} />
        
        {/* Header */}
        <div className={`flex items-center justify-between px-4 py-2 border-b ${isDark ? 'border-white/10 bg-black/20' : 'border-black/5 bg-slate-50'}`}>
          <div className={`flex items-center gap-2 ${isDark ? 'text-cyan-400' : 'text-cyan-600'}`}>
            <TerminalSquare className="w-4 h-4" />
            <span className="text-xs font-bold font-mono uppercase tracking-widest">GETSSH AI</span>
          </div>
          <button onClick={() => setFloatingCtx(null)} className={`transition-colors ${isDark ? 'text-white/50 hover:text-white' : 'text-slate-400 hover:text-slate-900'}`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Dynamic Capsule Button */}
        {floatingCtx.selection && (
          <div className="px-4 pt-3 pb-1">
            <button
              onClick={handlePasteSelection}
              className="w-full flex items-center justify-center gap-2 py-1.5 px-3 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded-full text-xs font-medium transition-all"
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
              {t('ai.pasteSelection', '粘贴所选文本')} ({floatingCtx.selection.length} chars)
            </button>
          </div>
        )}

        {/* Output Area */}
        {response && (
          <div className={`px-4 py-3 max-h-80 overflow-y-auto text-sm custom-scrollbar ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
            {renderMarkdownWithPaperPlane(response, handlePaperPlaneFill, isDark)}
          </div>
        )}

        {/* Input Area */}
        <div className="p-4 pt-2">
          <div className="relative">
            <textarea
              ref={inputRef}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={t('ai.inputPlaceholder', 'Ask AI (Enter to send)')}
              className={`w-full border text-sm px-3 py-2 pr-10 focus:outline-none focus:border-cyan-500/50 resize-none rounded-xl ${isDark ? 'bg-black/40 border-white/10 text-white placeholder-white/30' : 'bg-slate-50 border-black/10 text-slate-900 placeholder-slate-400'}`}
              rows={3}
            />
            <button
              onClick={handleSubmit}
              disabled={isLoading || !prompt.trim()}
              className="absolute bottom-2 right-2 p-1.5 bg-cyan-500 text-black hover:bg-cyan-400 disabled:opacity-50 disabled:bg-white/10 disabled:text-white/30 transition-all rounded-xl"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
