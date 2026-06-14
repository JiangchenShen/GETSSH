import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, KeyRound, ArrowRight, ShieldAlert } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useAppStore } from '../store/appStore';

const SPRING_FLUID = { type: 'spring', stiffness: 280, damping: 26, mass: 0.9 } as const;

export const UnlockVaultModal: React.FC = () => {
  const isUnlockModalOpen = useWorkspaceStore(state => state.isUnlockModalOpen);
  const setIsUnlockModalOpen = useWorkspaceStore(state => state.setIsUnlockModalOpen);
  const unlockVault = useWorkspaceStore(state => state.unlockVault);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const workspaces = useWorkspaceStore(state => state.workspaces);
  const isDark = useAppStore(state => state.isDark);

  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  const activeWs = workspaces.find(w => w.id === activeWorkspaceId);

  // Reset on open
  useEffect(() => {
    if (isUnlockModalOpen) {
      setPassword('');
      setError('');
      setLoading(false);
    }
  }, [isUnlockModalOpen]);

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 500);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim() || loading) return;
    setLoading(true);
    setError('');

    const success = await unlockVault(password);
    setLoading(false);

    if (!success) {
      setError('密码错误 — 资产金库保持封存状态');
      triggerShake();
    }
  };

  return (
    <AnimatePresence>
      {isUnlockModalOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[99998] flex items-center justify-center"
          style={{ backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)', background: 'rgba(0,0,0,0.75)' }}
        >
          <motion.div
            initial={{ scale: 0.9, y: 32, opacity: 0 }}
            animate={{ scale: shake ? [1, 1.01, 0.99, 1.01, 1] : 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.9, y: 24, opacity: 0 }}
            transition={SPRING_FLUID}
            className={`relative w-full max-w-sm flex flex-col overflow-hidden border rounded-xl shadow-[0_32px_64px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.12)] ${
              isDark
                ? 'bg-[#0a0a0a]/90 border-white/10 text-white'
                : 'bg-white/90 border-black/10 text-slate-900'
            }`}
          >
            {/* Top alert stripe */}
            <div className="h-px bg-gradient-to-r from-transparent via-red-500/60 to-transparent" />

            {/* Header */}
            <div className="flex flex-col items-center gap-3 px-8 pt-10 pb-6 text-center">
              <div className="relative">
                <div className="w-16 h-16 rounded-xl flex items-center justify-center bg-red-500/10 border border-red-500/20">
                  <Lock className="w-8 h-8 text-red-400" />
                </div>
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-xl flex items-center justify-center">
                  <ShieldAlert className="w-2.5 h-2.5 text-white" />
                </div>
              </div>

              <div>
                <h2 className="text-lg font-black tracking-[0.15em] uppercase mb-1">
                  VAULT LOCKED
                </h2>
                <div className={`text-[10px] font-mono tracking-widest uppercase ${isDark ? 'text-white/30' : 'text-black/30'}`}>
                  {activeWs?.name || activeWorkspaceId}
                </div>
              </div>

              <p className={`text-xs leading-relaxed ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                资产数据已由 <span className="text-red-400 font-mono font-bold">AES-256-GCM</span> 加密封存
                <br />
                输入工作区密码以解封金库
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="flex flex-col gap-3 px-8 pb-8">
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-mono"
                >
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                  {error}
                </motion.div>
              )}

              <div className={`flex items-center border rounded-xl transition-colors focus-within:border-primary/50 ${
                isDark ? 'bg-black/40 border-white/10' : 'bg-black/5 border-black/10'
              }`}>
                <KeyRound className="w-4 h-4 mx-3 opacity-40 shrink-0" />
                <input
                  type="password"
                  autoFocus
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(''); }}
                  placeholder="工作区密码"
                  className="flex-1 py-3 pr-3 bg-transparent text-sm outline-none placeholder-current placeholder-opacity-30 font-mono tracking-widest"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !password.trim()}
                className={`flex items-center justify-center gap-2 w-full py-3 font-black text-sm uppercase tracking-[0.2em] transition-all disabled:opacity-30 rounded-xl border ${
                  loading
                    ? 'bg-primary/20 border-primary/30 text-primary'
                    : 'bg-primary border-primary text-white hover:bg-primary/90 shadow-lg shadow-primary/20'
                }`}
              >
                {loading ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-xl animate-spin" />
                    解密中...
                  </>
                ) : (
                  <>
                    <KeyRound className="w-4 h-4" />
                    解锁物理金库
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setIsUnlockModalOpen(false)}
                className={`text-[10px] font-mono uppercase tracking-widest opacity-30 hover:opacity-60 transition-opacity mt-1`}
              >
                取消 — 保持加密状态
              </button>
            </form>

            {/* Bottom alert stripe */}
            <div className="h-px bg-gradient-to-r from-transparent via-red-500/30 to-transparent" />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
