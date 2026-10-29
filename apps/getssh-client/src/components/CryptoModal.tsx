import React, { useState } from 'react';
import { Lock, ShieldAlert, KeyRound, ArrowRight, Fingerprint } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface CryptoModalProps {
  mode: 'locked' | 'setup';
  isDark: boolean;
  onUnlock: (password: string) => Promise<boolean>;
  onSetup: (password: string) => Promise<void>;
  onCancel?: () => void;
  onSkip?: () => void;
  onRetryBiometric?: () => void;
  encryptionDisabled?: boolean;
  /** Context-aware unlock: shows workspace name and an identity color on the lock icon. */
  workspaceName?: string;
  themeColor?: string;
  /** Escape hatch: switch back to default workspace */
  onSwitchWorkspace?: () => void;
}

export function CryptoModal({ mode, onUnlock, onSetup, onCancel, onSkip, onRetryBiometric, encryptionDisabled, workspaceName, themeColor, onSwitchWorkspace }: CryptoModalProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (mode === 'setup') {
      if (password !== confirm) {
        setError(t('crypto.passwordMismatch', 'Passwords do not match'));
        return;
      }
      // [M-08] Security Fix: Enforce minimum password length of 8 characters
      if (password.length < 8) {
        setError(t('crypto.passwordTooShort', 'Password too short (min 8 chars)'));
        return;
      }
      setLoading(true);
      await onSetup(password);
      setLoading(false);
    } else {
      setLoading(true);
      const success = await onUnlock(password);
      setLoading(false);
      if (!success) {
        setError(t('crypto.invalidPassword', 'Invalid master password or corrupted file'));
      }
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-bg text-ink">
      <div className="relative flex w-full max-w-md flex-col rounded-[20px] border border-line bg-panel p-8 shadow-2xl">
        
        {/* Top-right action buttons for setup mode */}
        {mode === 'setup' && (onSkip || onCancel) && (
          <div className="absolute top-4 right-4 flex items-center gap-3">
            {onSkip && (
              <button
                onClick={onSkip}
                className="opacity-50 hover:opacity-100 text-sm transition-opacity"
                title={t('crypto.skipTip', 'Skip for now — will be prompted again next time')}
              >
                {t('crypto.skip', 'Skip')}
              </button>
            )}
            {onCancel && (
              <button
                onClick={onCancel}
                className="opacity-50 hover:opacity-100 text-sm transition-opacity"
                title={t('crypto.cancelTip', "Cancel — won't be prompted again")}
              >
                {t('crypto.cancel', 'Cancel')}
              </button>
            )}
          </div>
        )}

        <div className="flex justify-center mb-6">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surf">
            {mode === 'locked' ? <Lock className="w-8 h-8 text-primary" style={{ color: themeColor || undefined }} /> : <ShieldAlert className="w-8 h-8 text-primary" />}
          </div>
        </div>

        {/* Context-aware workspace label */}
        {mode === 'locked' && workspaceName && (
          <div className="text-center mb-1">
            <span className="rounded-xl border border-line bg-surf px-3 py-1 font-mono text-[10px] uppercase tracking-[0.25em] text-ink-2">
              {workspaceName}
            </span>
          </div>
        )}

        <h2 className="text-2xl font-bold text-center mb-2">
          {mode === 'locked'
            ? (workspaceName ? `Unlock ${workspaceName}` : t('crypto.lockedTitle', 'Zero-Knowledge Storage Locked'))
            : t('crypto.setupTitle', 'Initialize Secure Storage')}
        </h2>
        <p className="text-sm opacity-60 text-center mb-8">
          {mode === 'locked' 
            ? t('crypto.lockedDesc', 'Your SSH profiles are locally encrypted using AES-256-GCM. Enter your Master Password to decrypt.')
            : t('crypto.setupDesc', 'Set a Master Password to encrypt your SSH profiles. This password is never saved or transmitted.')}
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 text-red-500 rounded-lg text-sm text-center">
            {error}
          </div>
        )}

        {mode === 'locked' && encryptionDisabled ? (
          <button 
            onClick={() => {
              setLoading(true);
              onUnlock('');
            }}
            disabled={loading}
            className="flex items-center justify-center gap-2 w-full py-4 rounded-[20px] bg-primary hover:bg-primary/80 text-white font-bold transition-all shadow-xl shadow-primary/20 disabled:opacity-50 text-lg"
          >
            {loading ? t('crypto.unlocking', 'Unlocking...') : t('crypto.unlockScreen', 'Unlock Screen')}
          </button>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-50" />
              <input 
                type="password" 
                autoFocus
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={t('crypto.masterPassword', 'Master Password')} 
                className={`w-full pl-10 ${mode === 'locked' && onRetryBiometric ? 'pr-12' : 'pr-4'} rounded-[20px] border border-line bg-surf py-3 text-ink outline-none transition-colors focus:border-primary`}
                required
              />
              {mode === 'locked' && onRetryBiometric && (
                <button
                  type="button"
                  onClick={onRetryBiometric}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-primary transition-colors hover:bg-surf-2"
                  title={t('crypto.retryBiometric', 'Retry TouchID')}
                >
                  <Fingerprint className="w-5 h-5" />
                </button>
              )}
            </div>

            {mode === 'setup' && (
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-50" />
                <input 
                  type="password" 
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder={t('crypto.confirmPassword', 'Confirm Master Password')} 
                  className="w-full rounded-[20px] border border-line bg-surf py-3 pl-10 pr-4 text-ink outline-none transition-colors focus:border-primary"
                  required
                />
              </div>
            )}

            <button 
              type="submit" 
              disabled={loading || !password || (mode === 'setup' && !confirm)}
              className="mt-4 flex items-center justify-center gap-2 w-full py-3 rounded-[20px] bg-primary hover:bg-primary/80 text-white font-medium transition-all disabled:opacity-50"
            >
              {loading ? t('crypto.processing', 'Processing...') : (mode === 'locked' ? t('crypto.decrypt', 'Decrypt Profiles') : t('crypto.encrypt', 'Encrypt & Save'))}
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>

            {/* Escape Hatch: Switch Workspace */}
            {mode === 'locked' && onSwitchWorkspace && (
              <button
                type="button"
                onClick={onSwitchWorkspace}
                className="mt-3 w-full text-center text-xs opacity-40 hover:opacity-70 transition-opacity tracking-widest uppercase font-mono py-1"
              >
                ↩ Return to Default Workspace
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
