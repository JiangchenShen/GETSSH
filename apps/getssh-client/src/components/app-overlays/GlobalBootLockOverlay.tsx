import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store/appStore';
import { Shield, Lock, Fingerprint, Loader2 } from 'lucide-react';
import { promptWebAuthn } from '../../utils/webauthn';

export const GlobalBootLockOverlay: React.FC = () => {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasAutoPrompted, setHasAutoPrompted] = useState(false);
  const isAppBootLocked = useAppStore(state => state.isAppBootLocked);
  const setIsAppBootLocked = useAppStore(state => state.setIsAppBootLocked);

  React.useEffect(() => {
    if (isAppBootLocked && !hasAutoPrompted) {
      setHasAutoPrompted(true);
      handleWebAuthn(true);
    }
  }, [isAppBootLocked, hasAutoPrompted]);

  if (!isAppBootLocked) return null;

  const handleUnlock = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!password) return;

    setLoading(true);
    setError('');

    try {
      const hash = await window.electronAPI.getGlobalSetting('app_boot_password_hash');
      // Simple hash check (in a real app, use a proper KDF. For now we use the raw password if it matches the stored hash/password)
      // Actually we'll implement a simple crypto digest for this in the UI.
      const encoder = new TextEncoder();
      const data = encoder.encode(password);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      if (hashHex === hash) {
        setIsAppBootLocked(false);
      } else {
        setError(t('security.errWrongOldPwd', 'Incorrect password'));
      }
    } catch (err) {
      setError('Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleWebAuthn = async (silent = false) => {
    try {
      const type = await window.electronAPI.getGlobalSetting('app_boot_webauthn_type');
      if (!type) {
         if (!silent) setError(t('security.errWebAuthnNotConfigured', 'WebAuthn not configured for Global Lock'));
         return;
      }

      if (type === 'NativeBiometrics') {
        const res = await window.electronAPI.promptTouchID('Authenticate to unlock GETSSH');
        if (res && res.success) {
          setIsAppBootLocked(false);
        } else {
          if (!silent) setError(t('security.errAuthFailed', 'Authentication failed'));
        }
        return;
      }

      const success = await promptWebAuthn(type === 'any' ? undefined : type as any);
      if (success) {
        setIsAppBootLocked(false);
      } else {
        if (!silent) setError(t('security.errAuthFailed', 'Authentication failed'));
      }
    } catch (e: any) {
      if (e?.message === 'MAC_WEBAUTHN_BLOCKED') {
        if (!silent) setError(t('security.errMacWebAuthnBlocked', 'macOS blocked FIDO/Passkey. App needs Apple Developer Entitlements.'));
      } else {
        if (!silent) setError(t('security.errAuthError', 'Authentication error'));
      }
    }
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-3xl text-white">
      {/* Ambient glowing orb for the lock screen */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-purple-600/10 rounded-full blur-[150px] pointer-events-none" />
      <div className="max-w-md w-full p-8 border border-white/10 bg-white/5 rounded-[32px] shadow-2xl backdrop-blur-xl flex flex-col items-center">
        <div className="w-20 h-20 bg-purple-500/20 rounded-full flex items-center justify-center mb-6 ring-1 ring-purple-500/50">
          <Shield className="w-10 h-10 text-purple-400" />
        </div>
        <h2 className="text-2xl font-black mb-2 tracking-tight uppercase">{t('security.getsshLocked', 'GETSSH Locked')}</h2>
        <p className="text-sm text-white/50 mb-8 text-center">{t('security.verifyIdentity', 'Please verify your identity to access your workspaces and environments.')}</p>

        <form onSubmit={handleUnlock} className="w-full flex flex-col gap-4">
          <div className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
            <input 
              type="password"
              placeholder={t('security.appBootPwdPlaceholder', 'App Boot Password')}
              className="w-full bg-black/50 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-white placeholder-white/30 outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 transition-all font-mono"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoFocus
            />
          </div>

          {error && <div className="text-red-400 text-sm font-bold text-center animate-pulse">{error}</div>}

          <button 
            type="submit" 
            disabled={loading || !password}
            className="w-full py-4 bg-purple-600 hover:bg-purple-500 text-white font-black uppercase tracking-widest text-sm rounded-2xl transition-all shadow-[0_0_20px_rgba(147,51,234,0.3)] disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : t('security.unlockApp', 'Unlock Application')}
          </button>
        </form>

        <div className="mt-8 flex flex-col items-center gap-4 w-full border-t border-white/10 pt-8">
          <button 
            onClick={() => handleWebAuthn(false)}
            className="w-full py-4 bg-white/5 hover:bg-white/10 text-white font-bold text-sm rounded-2xl transition-all border border-white/10 flex justify-center items-center gap-3"
          >
            <Fingerprint className="w-5 h-5" />
            {t('security.useBiometrics', 'Use Biometrics / Security Key')}
          </button>
        </div>
      </div>
    </div>
  );
};
