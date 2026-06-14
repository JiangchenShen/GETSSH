import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useTranslation } from 'react-i18next';
import { X, Lock, Unlock, Loader2 } from 'lucide-react';

const PRESET_COLORS = ['#f43f5e', '#f59e0b', '#10b981', '#0ea5e9', '#8b5cf6', '#64748b'];

const CINEMATIC_IN = {
  initial: { opacity: 0, scale: 0.95, y: 20 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.95, y: 20 },
  transition: { type: 'spring' as const, damping: 25, stiffness: 300, mass: 0.5 }
};

export const CreateWorkspaceModal: React.FC = () => {
  const { t } = useTranslation();
  const isCreateModalOpen = useWorkspaceStore(state => state.isCreateModalOpen);
  const setIsCreateModalOpen = useWorkspaceStore(state => state.setIsCreateModalOpen);
  const switchWorkspace = useWorkspaceStore(state => state.switchWorkspace);

  const [name, setName] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [encryption, setEncryption] = useState(false);
  const [masterKey, setMasterKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Workspace ID cannot be empty.');
      return;
    }
    
    // Validate ID: alphanumeric and dashes only
    if (!/^[a-zA-Z0-9-]+$/.test(name)) {
       setError('Workspace ID can only contain letters, numbers, and dashes.');
       return;
    }

    if (encryption && !masterKey) {
      setError('Vault Master Key is required when encryption is enabled.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      if (window.electronAPI?.workspace?.createWorkspace) {
        const payload = {
          themeColor: color,
          hasPassword: encryption,
          ...(encryption && { password: masterKey })
        };
        const res = await window.electronAPI.workspace.createWorkspace(name.trim(), payload);
        
        if (res && res.success) {
          // refresh and close
          await useWorkspaceStore.getState().initWorkspaces();
          setIsCreateModalOpen(false);
          // Jump!
          switchWorkspace(name.trim());
          
          // reset form
          setName('');
          setEncryption(false);
          setMasterKey('');
        } else {
          setError(res?.error || 'Failed to create workspace.');
        }
      } else {
          setError('IPC not ready');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-[999999] flex items-center justify-center p-8 bg-black/60 backdrop-blur-2xl">
          <motion.div
            {...CINEMATIC_IN}
            className="relative w-full max-w-[540px] flex flex-col shadow-[0_40px_80px_rgba(0,0,0,0.8)] border border-white/10 border-t-white/30 rounded-xl bg-[#050505]/95 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-8 pb-4">
              <h2 className="text-2xl font-black tracking-[0.2em] uppercase text-white">
                {t('workspaceCenter.createTitle')}
              </h2>
              <button 
                onClick={() => setIsCreateModalOpen(false)}
                className="text-white/40 hover:text-white transition-colors p-2"
                disabled={loading}
              >
                <X size={24} />
              </button>
            </div>

            {/* Form Content */}
            <div className="flex flex-col p-8 pt-4 gap-10">
              
              {/* Field 1: Name */}
              <div className="flex flex-col group">
                <label className="text-xs font-bold tracking-widest text-white/40 uppercase mb-2 group-focus-within:text-white transition-colors">
                  {t('workspaceCenter.workspaceIdLabel')}
                </label>
                <input 
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={t('workspaceCenter.workspaceIdPlaceholder')}
                  className="bg-transparent border-b border-white/20 focus:border-white w-full outline-none py-2 text-2xl font-bold tracking-widest text-white transition-colors placeholder:text-white/10"
                  disabled={loading}
                />
              </div>

              {/* Field 2: Color */}
              <div className="flex flex-col">
                <label className="text-xs font-bold tracking-widest text-white/40 uppercase mb-4">
                  {t('workspaceCenter.identityColorLabel')}
                </label>
                <div className="flex items-center gap-4">
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setColor(c)}
                      className="w-8 h-8 rounded-full transition-all hover:scale-110"
                      style={{ 
                        backgroundColor: c,
                        boxShadow: color === c ? `0 0 0 2px #050505, 0 0 0 4px ${c}` : 'none'
                      }}
                      disabled={loading}
                    />
                  ))}
                </div>
              </div>

              {/* Field 3: Encryption Toggle */}
              <div className="flex flex-col p-6 bg-white/[0.02] border border-white/5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {encryption ? <Lock className="text-amber-500" size={20} /> : <Unlock className="text-white/40" size={20} />}
                    <label className="text-sm font-bold tracking-widest uppercase text-white">
                      {t('workspaceCenter.vaultEncryptionLabel')}
                    </label>
                  </div>
                  
                  {/* Framer Motion Toggle */}
                  <div 
                    className={`w-12 h-6 rounded-full p-1 cursor-pointer transition-colors ${encryption ? 'bg-amber-500' : 'bg-white/20'}`}
                    onClick={() => !loading && setEncryption(!encryption)}
                  >
                    <motion.div 
                      className="w-4 h-4 bg-white rounded-full shadow-md"
                      animate={{ x: encryption ? 24 : 0 }}
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    />
                  </div>
                </div>

                <p className="mt-3 text-xs text-white/40 leading-relaxed">
                  {encryption 
                    ? t('workspaceCenter.vaultEncryptedDesc') 
                    : t('workspaceCenter.vaultPlaintextDesc')}
                </p>

                <AnimatePresence>
                  {encryption && (
                    <motion.div
                      initial={{ height: 0, opacity: 0, marginTop: 0 }}
                      animate={{ height: 'auto', opacity: 1, marginTop: 16 }}
                      exit={{ height: 0, opacity: 0, marginTop: 0 }}
                      className="overflow-hidden"
                    >
                      <input 
                        type="password"
                        value={masterKey}
                        onChange={e => setMasterKey(e.target.value)}
                        placeholder={t('workspaceCenter.masterKeyPlaceholder')}
                        className="w-full bg-black/50 border border-amber-500/30 focus:border-amber-500 outline-none p-3 text-sm font-mono tracking-widest text-amber-500 placeholder:text-amber-500/20"
                        disabled={loading}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {error && (
                <div className="text-red-500 text-sm font-bold bg-red-500/10 p-3 border border-red-500/20">
                  {error}
                </div>
              )}

              {/* Action */}
              <button
                onClick={handleCreate}
                disabled={loading}
                className="w-full bg-white text-black font-black tracking-[0.2em] uppercase py-4 mt-2 transition-all hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="animate-spin" size={20} /> : t('workspaceCenter.initializeWorkspaceBtn')}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
