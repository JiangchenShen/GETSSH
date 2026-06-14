import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useSessionStore } from '../store/sessionStore';
import { Cpu, ShieldAlert, X, ChevronDown } from 'lucide-react';

export const AgentProposalOverlay: React.FC = () => {
  const proposal = useWorkspaceStore(state => state.pendingAgentProposal);
  const setProposal = useWorkspaceStore(state => state.setPendingAgentProposal);
  const activeTabId = useSessionStore(state => state.activeTabId);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (proposal) setIsExpanded(false);
  }, [proposal]);

  if (!proposal) return null;

  const handleAuthorize = () => {
    if (activeTabId && window.electronAPI?.sshWrite) {
      // 飞行员回填原则 (Airplane Filling Principle): Remove trailing newlines
      const sanitized = proposal.command.replace(/[\r\n]+$/, '');
      window.electronAPI.sshWrite(activeTabId, sanitized);
    }
    setProposal(null);
  };

  return (
    <>
      {/* 边缘潜伏态 (Collapsed State) */}
      <AnimatePresence>
        {!isExpanded && (
          <motion.button
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -50, opacity: 0 }}
            onClick={() => setIsExpanded(true)}
            className="fixed top-6 right-6 flex items-center gap-2 px-3 py-1.5 bg-[#0a0a0a]/80 backdrop-blur-md border border-cyan-500/50 rounded-xl z-[120] text-cyan-400 animate-pulse shadow-[0_0_15px_rgba(6,182,212,0.5)] cursor-pointer hover:bg-cyan-950/30 transition-colors"
          >
            <Cpu className="w-3.5 h-3.5" />
            <span className="font-mono text-xs font-bold tracking-widest uppercase">1 Pending Agent Proposal</span>
            <ChevronDown className="w-3.5 h-3.5 ml-1 opacity-70" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* 展开审查态 (Expanded State) */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div 
            initial={{ scale: 0.95, opacity: 0, y: -20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: -20 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed top-16 right-6 w-96 bg-[#0a0a0a]/90 backdrop-blur-2xl border border-cyan-500/30 shadow-[0_0_40px_rgba(6,182,212,0.15)] rounded-xl z-[120] text-slate-200 overflow-hidden"
          >
            {/* Geek Blue Breathing Light Accent */}
            <div className="absolute top-0 left-0 w-full h-[2px] bg-cyan-400 animate-pulse shadow-[0_0_10px_rgba(34,211,238,1)]" />
            
            <div className="p-5 border-b border-white/5 relative">
              <button 
                onClick={() => setIsExpanded(false)}
                className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors"
                title="Collapse"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-3 text-cyan-400 mb-2">
                <Cpu className="w-5 h-5 animate-pulse" />
                <h3 className="font-mono text-sm font-bold tracking-widest uppercase">Agent Proposal</h3>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed mt-3">
                <span className="text-cyan-400 font-bold">INTENT // </span> {proposal.intent}
              </p>
            </div>

            <div className="p-5 bg-black/50 border-b border-white/5 font-mono text-xs overflow-x-auto max-h-48">
              <pre className="text-emerald-400 whitespace-pre-wrap break-all selection:bg-cyan-500/30">
                {proposal.command}
              </pre>
            </div>

            <div className="p-5 flex flex-col gap-4 bg-gradient-to-b from-transparent to-cyan-950/20">
              <div className="flex items-start gap-2 text-[10px] text-amber-500/90">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                <p className="uppercase tracking-wider font-mono">
                  Human-In-The-Loop Required.<br/>Command will be written to active terminal buffer without auto-execution.
                </p>
              </div>
              
              <div className="flex justify-end gap-3 mt-2">
                <button 
                  onClick={() => setProposal(null)} 
                  className="px-4 py-2 font-mono text-xs text-slate-400 hover:text-white hover:bg-white/5 border border-transparent hover:border-white/10 transition-all rounded-xl"
                >
                  [ ✕ DISMISS ]
                </button>
                <button 
                  onClick={handleAuthorize}
                  className="px-4 py-2 font-mono text-xs font-bold text-black bg-emerald-500 hover:bg-emerald-400 border border-emerald-400 transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)] rounded-xl"
                >
                  [ ⬜ AUTHORIZE ]
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
