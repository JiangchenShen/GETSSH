import React, { useId, useState } from 'react';
import { motion, AnimatePresence, useIsPresent, useReducedMotion } from 'framer-motion';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useTranslation } from 'react-i18next';
import { X, Layers3, Lock, Unlock, Loader2 } from 'lucide-react';

const PRESET_COLORS = ['#f43f5e', '#f59e0b', '#10b981', '#0ea5e9', '#8b5cf6', '#64748b'];

function CreateWorkspaceDialog({ label, children }: React.PropsWithChildren<{ label: string }>) {
  const isPresent = useIsPresent();
  const reduceMotion = useReducedMotion();

  return (
    <div inert={!isPresent} className="fixed inset-0 z-[999999] flex items-center justify-center p-4 sm:p-8 bg-scrim">
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduceMotion ? undefined : { opacity: 0, y: 5 }}
        transition={{ duration: 0.165, ease: 'easeOut' }}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="ui-motion-managed relative max-h-full w-full max-w-[460px] overflow-y-auto rounded-xl border border-line bg-surf text-ink shadow-2xl"
      >
        {children}
      </motion.div>
    </div>
  );
}

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
  const idField = useId();

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
        <CreateWorkspaceDialog label={t('workspaceCenter.createTitle')}>
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-line-soft px-5 py-4">
              <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surf-2 text-primary"><Layers3 size={16} aria-hidden="true" /></span>
              <h2 className="min-w-0 flex-1 text-lg font-semibold">
                {t('workspaceCenter.createTitle')}
              </h2>
              <button type="button" aria-label={t('common.close')}
                onClick={() => setIsCreateModalOpen(false)}
                className="grid size-8 shrink-0 place-items-center rounded-md text-ink-3 hover:bg-surf-2 hover:text-ink"
                disabled={loading}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            {/* Form Content */}
            <form className="flex flex-col gap-5 p-5" onSubmit={event => { event.preventDefault(); if (!loading) void handleCreate(); }}>
              
              {/* Field 1: Name */}
              <div className="flex flex-col group">
                <label htmlFor={idField} className="mb-2 text-xs font-medium text-ink-2">
                  {t('workspaceCenter.workspaceIdLabel')}
                </label>
                <input 
                  id={idField}
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={t('workspaceCenter.workspaceIdPlaceholder')}
                  className="h-10 w-full rounded-md border border-line bg-bg px-3 font-mono text-sm text-ink placeholder:text-ink-3 focus:border-primary"
                  disabled={loading}
                />
              </div>

              {/* Field 2: Color */}
              <div className="flex flex-col">
                <label className="mb-3 text-xs font-medium text-ink-2">
                  {t('workspaceCenter.identityColorLabel')}
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`${t('workspaceCenter.identityColorLabel')} ${c}`}
                      aria-pressed={color === c}
                      onClick={() => setColor(c)}
                      className="size-6 shrink-0 rounded-full motion-safe:transition-shadow"
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
              <div className="flex flex-col rounded-md border border-line-soft bg-bg p-3.5">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {encryption ? <Lock className="shrink-0 text-warn" size={20} /> : <Unlock className="shrink-0 text-ink-3" size={20} />}
                    <span className="min-w-0 break-words text-xs font-semibold text-ink">
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

                {encryption && (
                  <input
                    type="password"
                    value={masterKey}
                    onChange={e => setMasterKey(e.target.value)}
                    placeholder={t('workspaceCenter.masterKeyPlaceholder')}
                    aria-label={t('workspaceCenter.masterKeyPlaceholder')}
                    className="ui-section-enter mt-4 w-full rounded-md border border-line bg-surf p-2.5 font-mono text-sm text-ink placeholder:text-ink-3 focus:border-primary"
                    disabled={loading}
                  />
                )}
              </div>

              {error && (
                <div role="alert" className="rounded-md border-l-2 border-down bg-down/10 px-3 py-2 text-xs text-down">
                  {error}
                </div>
              )}

              {/* Action */}
              <div className="flex justify-end gap-2 border-t border-line-soft pt-4">
                <button type="button" className="rounded-md border border-line px-3 py-2 text-xs hover:bg-surf-2" disabled={loading} onClick={() => setIsCreateModalOpen(false)}>{t('common.cancel')}</button>
                <button type="submit" disabled={loading} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-xs font-semibold text-[var(--primary-ink)] hover:brightness-95 disabled:opacity-50">
                  {loading && <Loader2 className="motion-safe:animate-spin" size={14} aria-hidden="true" />}{t('workspaceCenter.initializeWorkspaceBtn')}
                </button>
              </div>
            </form>
        </CreateWorkspaceDialog>
      )}
    </AnimatePresence>
  );
};
