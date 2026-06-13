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
  /** Context-aware unlock: shows workspace name and ambient color in lock screen */
  workspaceName?: string;
  themeColor?: string;
  /** Escape hatch: switch back to default workspace */
  onSwitchWorkspace?: () => void;
}

export function CryptoModal({ mode, isDark, onUnlock, onSetup, onCancel, onSkip, onRetryBiometric, encryptionDisabled, workspaceName, themeColor, onSwitchWorkspace }: CryptoModalProps) {
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
    <div className={`fixed inset-0 z-[100] flex items-center justify-center bg-black/70 transition-all`} style={{ backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)' }}>
      {/* Context-aware ambient glow from workspace themeColor */}
      {mode === 'locked' && themeColor && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse 60% 50% at 50% 0%, ${themeColor}22 0%, transparent 70%)`,
            transition: 'background 0.8s ease',
          }}
        />
      )}
      <div className={`w-full max-w-md p-8 rounded-[20px] shadow-2xl border flex flex-col relative ${isDark ? 'bg-black/60 border-white/10 text-white' : 'bg-white/90 border-black/10 text-black'}`}
           style={mode === 'locked' && themeColor ? { boxShadow: `0 0 0 1px ${themeColor}30, 0 32px 64px rgba(0,0,0,0.6)` } : undefined}>
        
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
          <div
               className="w-16 h-16 rounded-full flex items-center justify-center"
               style={{ background: themeColor ? `${themeColor}25` : 'rgba(var(--primary-rgb,99,102,241),0.2)' }}>
            {mode === 'locked' ? <Lock className="w-8 h-8" style={{ color: themeColor || '' }} /> : <ShieldAlert className="w-8 h-8 text-primary" />}
          </div>
        </div>

        {/* Context-aware workspace label */}
        {mode === 'locked' && workspaceName && (
          <div className="text-center mb-1">
            <span className="text-[10px] font-mono uppercase tracking-[0.25em] px-3 py-1 rounded-none border"
                  style={{ color: themeColor || '', borderColor: `${themeColor}40`, background: `${themeColor}10` }}>
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
                className={`w-full pl-10 ${mode === 'locked' && onRetryBiometric ? 'pr-12' : 'pr-4'} py-3 rounded-[20px] border outline-none transition-colors ${isDark ? 'bg-black/40 border-white/10 focus:border-primary' : 'bg-black/5 border-black/10 focus:border-primary'}`}
                required
              />
              {mode === 'locked' && onRetryBiometric && (
                <button
                  type="button"
                  onClick={onRetryBiometric}
                  className={`absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-full transition-colors ${isDark ? 'hover:bg-white/10 text-primary' : 'hover:bg-black/5 text-primary'}`}
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
                  className={`w-full pl-10 pr-4 py-3 rounded-[20px] border outline-none transition-colors ${isDark ? 'bg-black/40 border-white/10 focus:border-primary' : 'bg-black/5 border-black/10 focus:border-primary'}`}
                  required
                />
              </div>
            )}

            <button 
              type="submit" 
              disabled={loading || !password || (mode === 'setup' && !confirm)}
              className="mt-4 flex items-center justify-center gap-2 w-full py-3 rounded-[20px] bg-primary hover:bg-primary/80 text-white font-medium transition-all disabled:opacity-50"
              style={themeColor && mode === 'locked' ? { background: themeColor, boxShadow: `0 8px 24px ${themeColor}40` } : undefined}
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
