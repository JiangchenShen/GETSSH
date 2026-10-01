import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Fingerprint, KeyRound, Loader2, Lock, ShieldAlert } from 'lucide-react';
import { useAppLockStore } from '../../store/appLockStore';
import { useAppStore } from '../../store/appStore';

/**
 * Lock screen for the master password (and the recovery code). The main process does all the
 * checking; this screen only collects what the user types and shows the outcome.
 */
export const AppLockScreen: React.FC = () => {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const state = useAppLockStore(store => store.state);
  const isMac = useAppStore(store => store.isMac);
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
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (state?.phase === 'locked' && state.presenceEnabled && !autoPrompted.current) {
      autoPrompted.current = true;
      void unlock({ method: 'presence' });
    }
    if (state?.phase === 'ready') autoPrompted.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.phase, state?.presenceEnabled]);

  const shell = (children: React.ReactNode) => (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-panel text-ink" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm px-6">{children}</div>
    </div>
  );

  if (!state || state.phase === 'starting') {
    return shell(<div className="flex items-center justify-center gap-2 text-sm text-ink-3"><Loader2 className="h-4 w-4 animate-spin" />{zh ? '正在打开 GETSSH…' : 'Opening GETSSH…'}</div>);
  }

  if (state.phase === 'error') {
    return shell(<div className="space-y-3 text-center">
      <ShieldAlert className="mx-auto h-8 w-8 text-down" />
      <h1 className="text-lg font-semibold">{zh ? 'GETSSH 无法打开加密数据' : 'GETSSH could not open its encrypted data'}</h1>
      <p className="text-sm text-ink-3">{zh ? '没有做任何修改。请重新启动 GETSSH；问题仍在时请联系支持并附上下面的信息。' : 'Nothing was changed. Restart GETSSH; if the problem stays, contact support with the details below.'}</p>
      {state.error && <code className="block break-all rounded-md bg-surf-2 px-3 py-2 text-xs text-ink-2">{state.error}</code>}
    </div>);
  }

  const showRecovery = useRecovery || recoveryOnly;
  return shell(<div className="space-y-5">
    <div className="space-y-2 text-center">
      <Lock className="mx-auto h-8 w-8 text-ink-2" />
      <h1 className="text-lg font-semibold">{zh ? 'GETSSH 已锁定' : 'GETSSH is locked'}</h1>
      <p className="text-sm text-ink-3">{recoveryOnly
        ? (zh ? '这份数据来自另一台电脑，或这台电脑的安全芯片已重置。输入恢复码以继续。' : 'This data comes from another computer, or this computer’s security chip was reset. Enter your recovery code to continue.')
        : showRecovery
          ? (zh ? '输入恢复码。解锁后请在设置中重新设置主密码。' : 'Enter your recovery code. Set a new master password in Settings afterwards.')
          : (zh ? '输入主密码以打开你的服务器和工作区。' : 'Enter your master password to open your servers and workspaces.')}</p>
    </div>

    {showRecovery ? (
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (code.trim()) void unlock({ method: 'recovery', code }); }}>
        <input autoFocus value={code} onChange={event => setCode(event.target.value)} spellCheck={false} autoComplete="off"
          placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
          className="w-full rounded-md border border-line bg-panel px-3 py-2 font-mono text-sm tracking-wider text-ink outline-none focus:border-primary" />
        <button type="submit" disabled={busy || !code.trim()} className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}{zh ? '用恢复码解锁' : 'Unlock with recovery code'}
        </button>
      </form>
    ) : (
      <form className="space-y-3" onSubmit={event => { event.preventDefault(); if (password) void unlock({ method: 'password', password }); }}>
        <input autoFocus type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password"
          placeholder={zh ? '主密码' : 'Master password'}
          className="w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink outline-none focus:border-primary" />
        <button type="submit" disabled={busy || !password} className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}{zh ? '解锁' : 'Unlock'}
        </button>
        {state.presenceEnabled && <button type="button" disabled={busy} onClick={() => void unlock({ method: 'presence' })} className="flex w-full items-center justify-center gap-2 rounded-md border border-line px-3 py-2 text-sm text-ink-2 hover:bg-surf disabled:opacity-50">
          <Fingerprint className="h-4 w-4" />{zh ? `使用 ${presenceName}` : `Use ${presenceName}`}
        </button>}
      </form>
    )}

    {error && <p role="alert" className="text-center text-sm text-down">{error}</p>}
    {!recoveryOnly && <button type="button" onClick={() => { setUseRecovery(!useRecovery); setError(''); }} className="block w-full text-center text-xs text-ink-3 underline">
      {showRecovery ? (zh ? '改用主密码' : 'Use the master password instead') : (zh ? '忘记主密码？使用恢复码' : 'Forgot the master password? Use the recovery code')}
    </button>}
  </div>);
};
