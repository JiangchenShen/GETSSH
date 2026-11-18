import React, { useEffect, useState } from 'react';
import { ShieldAlert, RefreshCcw, Save, ShieldOff, Terminal, Key, Unlock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/appStore';

export const SecurityOverlay: React.FC = () => {
  const { t } = useTranslation();
  const [lockdownInfo, setLockdownInfo] = useState<{ reason: string; countdown: number; level?: 'red' | 'yellow' } | null>(null);
  const setIsPolluted = useAppStore(state => state.setIsPolluted);

  const [pwdPrompt, setPwdPrompt] = useState(false);
  const [pwdInput, setPwdInput] = useState('');
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (window.electronAPI?.onSecurityLockdown) {
      const remove = window.electronAPI.onSecurityLockdown((data) => {
        setLockdownInfo(data);
      });
      return remove;
    }
  }, []);

  // The main process reports when the lockdown ended (any window resolved it, or the ocean-sentinel did).
  useEffect(() => {
    if (!window.electronAPI?.onSecurityLockdownResolved) return;
    return window.electronAPI.onSecurityLockdownResolved(() => {
      setLockdownInfo(null);
      setPwdPrompt(false);
      setPwdInput('');
      setPwdError(null);
    });
  }, []);

  useEffect(() => {
    if (!lockdownInfo) return;
    
    let timerId: NodeJS.Timeout;
    if (lockdownInfo.countdown > 0) {
      timerId = setInterval(() => {
        setLockdownInfo(prev => prev ? { ...prev, countdown: prev.countdown - 1 } : null);
      }, 1000);
    }

    return () => {
      if (timerId) clearInterval(timerId);
    };
  }, [lockdownInfo]);

  const handleRestartSafe = () => {
    window.electronAPI.resolveSecurityLockdown('restart-safe');
  };

  const handleSave15s = () => {
    window.electronAPI.resolveSecurityLockdown('save-15s');
    setLockdownInfo(null);
  };

  // The main process verifies the owner before ignoring: Touch ID where the Mac has it, otherwise
  // the master password. Nothing is asked when no workspace has a master password.
  const requestIgnore = async (masterPassword?: string) => {
    if (verifying) return;
    setVerifying(true);
    try {
      const res = await window.electronAPI.resolveSecurityLockdown('ignore', masterPassword);
      if (res?.ok) {
        setIsPolluted(true);
        setLockdownInfo(null);
        setPwdPrompt(false);
        setPwdInput('');
        setPwdError(null);
        return;
      }
      if (res?.reason === 'password_required') {
        setPwdPrompt(true);
        if (masterPassword !== undefined) setPwdError(t('securityLockdown.enterPassword'));
        return;
      }
      if (masterPassword !== undefined) setPwdError(t('securityLockdown.incorrectPassword'));
    } finally {
      setVerifying(false);
    }
  };

  const handleIgnore = () => requestIgnore();
  const submitIgnore = () => requestIgnore(pwdInput);

  if (!lockdownInfo) return null;

  const isRed = lockdownInfo.level !== 'yellow';
  const title = t('settings.secureCenter');
  const severity = isRed ? 'text-down bg-down/10' : 'text-warn bg-warn/10';
  const button = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-semibold disabled:opacity-50';
  const secondary = `${button} border border-line hover:bg-surf-2`;
  const primary = `${button} bg-primary text-[var(--primary-ink)] hover:brightness-95`;

  return (
    <div role="dialog" aria-modal="true" aria-label={title}
      className="ui-motion-managed no-drag-region fixed inset-0 z-[99999] grid place-items-center bg-scrim p-4">
      <div className="ui-dialog-enter max-h-full w-full max-w-[640px] overflow-y-auto rounded-xl border border-line bg-surf text-ink shadow-2xl">
        <header className="flex flex-wrap items-start gap-3 border-b border-line-soft px-5 py-4">
          <span className={`grid size-9 shrink-0 place-items-center rounded-md ${severity}`}>
            <ShieldAlert size={19} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold">{title}</h1>
            <p className="mt-1 text-sm text-ink-2">{t(isRed ? 'securityLockdown.integrity' : 'securityLockdown.plugin')}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[11px] text-ink-3">{t('securityLockdown.remaining')}</p>
            <p className={`mt-1 rounded-md px-2 py-1 font-mono text-sm ${severity}`}>
              {Math.floor(lockdownInfo.countdown / 60).toString().padStart(2, '0')}:{(lockdownInfo.countdown % 60).toString().padStart(2, '0')}
            </p>
          </div>
        </header>

        <section className="grid gap-3 px-5 py-4">
          {!isRed && <p className="text-xs text-ink-3">{t('securityLockdown.warningHint')}</p>}
          <h2 className="flex items-center gap-2 text-xs font-semibold"><Terminal size={14} aria-hidden="true" />{t('securityLockdown.details')}</h2>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-line-soft bg-bg p-3 font-mono text-xs text-ink-2 [overflow-wrap:anywhere]">
            {lockdownInfo.reason}
          </pre>
        </section>

        {pwdPrompt ? (
          <form className="ui-section-enter grid gap-3 border-t border-line-soft px-5 py-4"
            onSubmit={event => { event.preventDefault(); void submitIgnore(); }}>
            <h2 className="flex items-center gap-2 text-sm font-semibold"><Key size={16} aria-hidden="true" />{t('securityLockdown.verifyTitle')}</h2>
            <p className="text-xs text-ink-3">{t('securityLockdown.verifyHint')}</p>
            <input type="password" autoComplete="current-password" aria-label={t('securityLockdown.verifyTitle')}
              value={pwdInput} onChange={event => setPwdInput(event.target.value)}
              className="h-10 w-full rounded-md border border-line bg-bg px-3 font-mono text-sm focus:border-primary" autoFocus />
            {pwdError && <p role="alert" className="text-xs text-down">{pwdError}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className={secondary} onClick={() => { setPwdPrompt(false); setPwdInput(''); setPwdError(null); }}>{t('common.cancel')}</button>
              <button type="submit" disabled={verifying} className={primary}><Unlock size={14} aria-hidden="true" />{t('securityLockdown.verify')}</button>
            </div>
          </form>
        ) : (
          <div className="ui-section-enter flex flex-wrap items-center justify-end gap-2 border-t border-line-soft px-5 py-4">
            <button type="button" onClick={handleIgnore} disabled={verifying} className={`${secondary} text-ink-3`}>
              <ShieldOff size={14} aria-hidden="true" />{t(isRed ? 'securityLockdown.ignoreRisk' : 'securityLockdown.ignoreWarning')}
            </button>
            {isRed ? (
              <>
                <button type="button" onClick={handleSave15s} className={secondary}><Save size={14} aria-hidden="true" />{t('securityLockdown.save')}</button>
                <button type="button" onClick={handleRestartSafe} className={primary}><RefreshCcw size={14} aria-hidden="true" />{t('securityLockdown.restart')}</button>
              </>
            ) : (
              <>
                <button type="button" className={secondary} onClick={() => {
                  window.electronAPI.resolveSecurityLockdown('continue');
                  setIsPolluted(false);
                  setLockdownInfo(null);
                }}>{t('securityLockdown.continue')}</button>
                <button type="button" className={primary} onClick={() => {
                  window.electronAPI.resolveSecurityLockdown('deactivate-plugin');
                  setIsPolluted(false);
                  setLockdownInfo(null);
                }}>{t('securityLockdown.deactivate')}</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
