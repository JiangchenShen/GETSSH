import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Fingerprint, KeyRound, Loader2, Lock, ShieldAlert } from 'lucide-react';
import { useAppLockStore } from '../../store/appLockStore';
import { useAppStore } from '../../store/appStore';
import { useBackupRestartStore } from '../../store/backupStore';
import { BackupRestartNotice } from './BackupRestartNotice';
import '../TrustDialog.css';

/**
 * Lock screen for the master password (and the recovery code). The main process does all the
 * checking; this screen only collects what the user types and shows the outcome.
 */
export const AppLockScreen: React.FC = () => {
  const { i18n, t } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const state = useAppLockStore(store => store.state);
  const isMac = useAppStore(store => store.isMac);
  const restartReport = useBackupRestartStore(store => store.report);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const autoPrompted = useRef(false);

  const presenceName = isMac ? 'Touch ID' : 'Windows Hello';
  const recoveryOnly = !!state?.deviceKeyLost && !state.appProtected;

  const describe = (failure: string, retryAfterMs?: number): string => {
    switch (failure) {
      case 'wrong_password': return zh ? '密码不正确' : 'Incorrect password';
      case 'rate_limited': {
        const seconds = Math.max(1, Math.ceil((retryAfterMs ?? 1000) / 1000));
        return zh ? `尝试次数过多，请 ${seconds} 秒后再试` : `Too many attempts. Try again in ${seconds} s`;
      }
      case 'invalid_recovery_code': return zh ? '恢复码不正确' : 'This recovery code does not match';
      case 'cancelled': return '';
      case 'unavailable': return zh ? `${presenceName} 现在不可用` : `${presenceName} is not available right now`;
      case 'device_key_lost': return zh ? '这台电脑上没有这份数据的设备密钥，请使用恢复码' : 'This computer does not have the device key for this data. Use the recovery code';
      default: return zh ? `无法解锁（${failure}）` : `Could not unlock (${failure})`;
    }
  };

  const unlock = async (request: Parameters<typeof window.electronAPI.appLock.unlock>[0]) => {
    setBusy(true);
    setError('');
    try {
      const result = await window.electronAPI.appLock.unlock(request);
      if (!result.ok) setError(describe(result.error, result.retryAfterMs));
      else {
        setPassword('');
        setCode('');
      }
    } catch {
      setError(t('crypto.requestFailed'));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!restartReport && state?.phase === 'locked' && state.presenceEnabled && !autoPrompted.current) {
      autoPrompted.current = true;
      void unlock({ method: 'presence' });
    }
    if (state?.phase === 'ready') autoPrompted.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.phase, state?.presenceEnabled, restartReport]);

  useEffect(() => {
    if (restartReport) { setPassword(''); setCode(''); setError(''); }
  }, [restartReport]);

  const shell = (label: string, children: React.ReactNode, danger = false) => (
    <div className="trust-layer trust-layer--app">
      <div className="trust-card trust-card--compact trust-card--app" role="dialog" aria-modal="true" aria-label={label} data-danger={danger || undefined}>
        {children}
      </div>
    </div>
  );

  // The replaced store cannot unlock again until restart. Keep that action reachable
  // inside the lock screen without exposing the workbench underneath it.
  if (restartReport) return shell('GETSSH', <BackupRestartNotice />);

  if (!state || state.phase === 'starting') {
    const label = zh ? '正在打开 GETSSH…' : 'Opening GETSSH…';
    return shell(label, <div role="status" className="flex items-center gap-2 text-sm text-ink-2"><Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />{label}</div>);
  }

  if (state.phase === 'error') {
    const label = zh ? 'GETSSH 无法打开加密数据' : 'GETSSH could not open its encrypted data';
    return shell(label, <>
      <header className="trust-header">
        <div className="trust-emblem"><ShieldAlert size={19} aria-hidden="true" /></div>
        <div className="trust-heading">
          <h1>{label}</h1>
          <p>{zh ? '请重新启动 GETSSH。如果问题仍在，请联系支持并附上下方信息。' : 'Restart GETSSH. If the problem persists, contact support with the details below.'}</p>
        </div>
      </header>
      {state.error && <code className="trust-error">{state.error}</code>}
    </>, true);
  }

  const showRecovery = useRecovery || recoveryOnly;
  const title = zh ? 'GETSSH 已锁定' : 'GETSSH is locked';
  const fieldName = showRecovery ? (zh ? '恢复码' : 'Recovery code') : t('crypto.masterPassword');
  return shell(title, <>
    <header className="trust-header">
      <div className="trust-emblem"><Lock size={19} aria-hidden="true" /></div>
      <div className="trust-heading">
        <h1>{title}</h1>
        <p>{recoveryOnly
        ? (zh ? '这份数据来自另一台电脑，或这台电脑的安全芯片已重置。输入恢复码以继续。' : 'This data comes from another computer, or this computer’s security chip was reset. Enter your recovery code to continue.')
        : showRecovery
          ? (zh ? '输入恢复码。解锁后请在设置中重新设置主密码。' : 'Enter your recovery code. Set a new master password in Settings afterwards.')
          : (zh ? '输入主密码以打开您的服务器和工作区。' : 'Enter your master password to open your servers and workspaces.')}</p>
      </div>
    </header>

    <form className="trust-form" onSubmit={event => {
      event.preventDefault();
      if (busy) return;
      if (showRecovery && code.trim()) void unlock({ method: 'recovery', code });
      else if (!showRecovery && password) void unlock({ method: 'password', password });
    }}>
      <label className="trust-field">
        <span>{fieldName}</span>
        <span className="trust-input-wrap">
          <KeyRound size={16} aria-hidden="true" />
          {showRecovery ? (
            <input key="recovery" autoFocus value={code} onChange={event => setCode(event.target.value)} spellCheck={false} autoComplete="off"
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" className="font-mono" />
          ) : (
            <input key="password" autoFocus type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" />
          )}
        </span>
      </label>
      {error && <p role="alert" className="trust-error">{error}</p>}
      <div className="trust-actions">
        {!showRecovery && state.presenceEnabled && (
          <button type="button" disabled={busy} className="trust-button" onClick={() => void unlock({ method: 'presence' })}>
            <Fingerprint size={16} aria-hidden="true" />{zh ? `使用 ${presenceName}` : `Use ${presenceName}`}
          </button>
        )}
        <button type="submit" disabled={busy || (showRecovery ? !code.trim() : !password)} className="trust-button trust-button-primary">
          {busy && <Loader2 size={16} className="motion-safe:animate-spin" aria-hidden="true" />}
          {busy ? t('crypto.unlocking') : showRecovery ? (zh ? '用恢复码解锁' : 'Unlock with recovery code') : t('crypto.unlock')}
        </button>
      </div>
    </form>
    {!recoveryOnly && <button type="button" onClick={() => { setUseRecovery(!useRecovery); setError(''); }} className="trust-text-button" disabled={busy}>
      {showRecovery ? (zh ? '改用主密码' : 'Use the master password instead') : (zh ? '忘记主密码？使用恢复码' : 'Forgot the master password? Use the recovery code')}
    </button>}
  </>);
};
