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
        <div className="fixed inset-0 z-[999999] flex items-center justify-center p-4 sm:p-8 bg-scrim">
          <motion.div
            {...CINEMATIC_IN}
            role="dialog"
            aria-modal="true"
            aria-label={t('workspaceCenter.createTitle')}
            className="relative max-h-full w-full max-w-[540px] flex flex-col shadow-2xl border border-line rounded-xl bg-panel text-ink overflow-y-auto"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-8 pb-4">
              <h2 className="text-2xl font-black tracking-[0.2em] uppercase text-ink">
                {t('workspaceCenter.createTitle')}
              </h2>
              <button 
                onClick={() => setIsCreateModalOpen(false)}
                className="text-ink-3 hover:text-ink transition-colors p-2"
                disabled={loading}
              >
                <X size={24} />
              </button>
            </div>

            {/* Form Content */}
            <div className="flex flex-col p-8 pt-4 gap-10">
              
              {/* Field 1: Name */}
              <div className="flex flex-col group">
                <label className="text-xs font-bold tracking-widest text-ink-3 uppercase mb-2 group-focus-within:text-ink transition-colors">
                  {t('workspaceCenter.workspaceIdLabel')}
                </label>
                <input 
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={t('workspaceCenter.workspaceIdPlaceholder')}
                  className="bg-panel border-b border-line focus:border-primary w-full outline-none py-2 text-2xl font-bold tracking-widest text-ink transition-colors placeholder:text-ink-3"
                  disabled={loading}
                />
              </div>

              {/* Field 2: Color */}
              <div className="flex flex-col">
                <label className="text-xs font-bold tracking-widest text-ink-3 uppercase mb-4">
                  {t('workspaceCenter.identityColorLabel')}
                </label>
                <div className="flex flex-wrap items-center gap-4">
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`${t('workspaceCenter.identityColorLabel')} ${c}`}
                      aria-pressed={color === c}
                      onClick={() => setColor(c)}
                      className="w-8 h-8 shrink-0 rounded-full transition-all hover:scale-110"
                      style={{ 
                        backgroundColor: c,
                        boxShadow: color === c ? `0 0 0 2px var(--v2-panel), 0 0 0 4px ${c}` : 'none'
                      }}
                      disabled={loading}
                    />
                  ))}
                </div>
              </div>

              {/* Field 3: Encryption Toggle */}
              <div className="flex flex-col p-6 bg-surf border border-line">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {encryption ? <Lock className="shrink-0 text-warn" size={20} /> : <Unlock className="shrink-0 text-ink-3" size={20} />}
                    <span className="min-w-0 break-words text-sm font-bold tracking-widest uppercase text-ink">
                      {t('workspaceCenter.vaultEncryptionLabel')}
                    </span>
                  </div>
                  
                  {/* Native switch keeps its dimensions and keyboard behavior. */}
                  <button
                    type="button"
                    role="switch"
                    aria-label={t('workspaceCenter.vaultEncryptionLabel')}
                    aria-checked={encryption}
                    disabled={loading}
                    className={`w-12 h-6 shrink-0 rounded-full p-1 cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${encryption ? 'bg-warn' : 'bg-surf-2'}`}
                    onClick={() => !loading && setEncryption(!encryption)}
                  >
                    <span
                      aria-hidden="true"
                      className={`block w-4 h-4 bg-white rounded-full shadow-md transition-transform motion-reduce:transition-none ${encryption ? 'translate-x-6' : ''}`}
                    />
                  </button>
                </div>

                <p className="mt-3 text-xs text-ink-3 leading-relaxed">
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
                        className="w-full bg-panel border border-line focus:border-primary outline-none p-3 text-sm font-mono tracking-widest text-ink placeholder:text-ink-3"
                        disabled={loading}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {error && (
                <div className="text-down text-sm font-bold bg-down/10 p-3 border border-down/20">
                  {error}
                </div>
              )}

              {/* Action */}
              <button
                onClick={handleCreate}
                disabled={loading}
                className="w-full bg-primary text-bg font-black tracking-[0.2em] uppercase py-4 mt-2 transition-all hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
