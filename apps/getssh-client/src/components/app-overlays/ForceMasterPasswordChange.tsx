import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppLockStore } from '../../store/appLockStore';
import { useRecoveryReminderStore } from '../../store/recoveryReminderStore';
import { storeFailureMessage } from '../../utils/storeFeedback';
import { settingButtonClass, settingFieldClass } from '../settings/SettingsControls';

/** Old, short master passwords must be updated before the user can continue. */
export function ForceMasterPasswordChange({ onActiveChange }: { onActiveChange?: (active: boolean) => void }) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const state = useAppLockStore(store => store.state);
  const [stage, setStage] = useState<'change' | 'refresh' | 'recovery' | 'code' | null>(null);
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [saved, setSaved] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const alive = useRef(true);
  const generation = useRef(0);

  useEffect(() => {
    alive.current = true;
    const unsubscribe = useAppLockStore.subscribe((next, previous) => {
      if (next.state?.phase === previous.state?.phase) return;
      generation.current += 1;
      if (next.state?.phase !== 'ready') {
        setStage(null); setCurrent(''); setPassword(''); setConfirm(''); setCode(''); setSaved(false); setError(''); setBusy(false);
      }
    });
    return () => { alive.current = false; generation.current += 1; unsubscribe(); };
  }, []);
  useEffect(() => {
    if (stage !== 'code' || !code) return;
    useRecoveryReminderStore.getState().setVisible(true);
    return () => useRecoveryReminderStore.getState().setVisible(false);
  }, [stage, code]);
  useEffect(() => {
    onActiveChange?.(stage !== null);
    return () => { onActiveChange?.(false); };
  }, [stage, onActiveChange]);
  useEffect(() => {
    if (state?.phase === 'ready' && state.masterPasswordMustChange && stage === null) setStage('change');
  }, [state?.phase, state?.masterPasswordMustChange, stage]);

  useEffect(() => {
    if (!stage) return;
    const previous = document.activeElement as HTMLElement | null;
    const controls = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)') ?? []);
    const focusFirst = () => (controls()[0] ?? dialog.current)?.focus();
    focusFirst();
    const trap = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); }
      if (event.key !== 'Tab') return;
      const items = controls();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first) { event.preventDefault(); dialog.current?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    const keepFocus = (event: FocusEvent) => {
      if (!dialog.current?.contains(event.target as Node)) focusFirst();
    };
    document.addEventListener('keydown', trap, true);
    document.addEventListener('focusin', keepFocus, true);
    return () => {
      document.removeEventListener('keydown', trap, true);
      document.removeEventListener('focusin', keepFocus, true);
      if (previous?.isConnected) previous.focus();
    };
  }, [stage]);

  const finish = () => { setStage(null); setCurrent(''); setPassword(''); setConfirm(''); setCode(''); setSaved(false); setError(''); };
  const isCurrent = (requestGeneration: number) => alive.current && generation.current === requestGeneration
    && useAppLockStore.getState().state?.phase === 'ready';
  const refreshAfterChange = async (requestGeneration: number) => {
    const refreshed = await window.electronAPI.appLock.getState();
    if (!isCurrent(requestGeneration)) return;
    if (!refreshed) throw new Error('App state unavailable');
    useAppLockStore.getState().setState(refreshed);
    if (!refreshed.masterPasswordMustChange) finish();
    else { setStage('change'); setError(zh ? '主密码仍需要更换，请重试' : 'The master password still needs to be changed. Try again'); }
  };
  const changePassword = async () => {
    if (busy) return;
    const requestGeneration = generation.current;
    if (!isCurrent(requestGeneration)) return;
    if (!current) { setError(zh ? '请输入当前主密码' : 'Enter the current master password'); return; }
    if ([...password.normalize('NFC')].length < 12) { setError(zh ? '新主密码至少需要 12 个字符' : 'The new master password needs at least 12 characters'); return; }
    if (password !== confirm) { setError(zh ? '两次输入的新主密码不一致' : 'The new master passwords do not match'); return; }
    setBusy(true); setError('');
    try {
      const result = await window.electronAPI.security.setMasterPassword({ password, currentPassword: current });
      if (!isCurrent(requestGeneration)) return;
      if (!result.ok) { setError(storeFailureMessage(result.error, zh, result.retryAfterMs)); return; }
      // Keep the recovery notice mounted even if the main process has already broadcast a cleared flag.
      setStage(result.recoveryReset ? 'recovery' : 'refresh');
      setCurrent(''); setPassword(''); setConfirm('');
      if (result.recoveryReset) {
        const refreshed = await window.electronAPI.appLock.getState();
        if (!isCurrent(requestGeneration)) return;
        if (!refreshed) throw new Error('App state unavailable');
        useAppLockStore.getState().setState(refreshed);
      } else await refreshAfterChange(requestGeneration);
    } catch {
      if (isCurrent(requestGeneration)) setError(zh ? '无法确认密码更新状态，请重试' : 'Could not confirm the password update. Try again');
    } finally {
      if (isCurrent(requestGeneration)) setBusy(false);
    }
  };

  const createRecovery = async () => {
    if (busy) return;
    const requestGeneration = generation.current;
    if (!isCurrent(requestGeneration)) return;
    if (!current) { setError(zh ? '请输入刚设置的主密码' : 'Enter the master password you just set'); return; }
    setBusy(true); setError('');
    try {
      const result = await window.electronAPI.security.setupRecovery({ currentPassword: current });
      // As in SafeStorageTab: a code main created counts as unconfirmed until Done, even one that
      // arrives too late to be shown.
      if (result.ok) useRecoveryReminderStore.getState().setUnconfirmed(true);
      if (!isCurrent(requestGeneration)) return;
      if (!result.ok) { setError(storeFailureMessage(result.error, zh, result.retryAfterMs)); return; }
      setCurrent(''); setCode(result.code); setSaved(false); setStage('code');
      const refreshed = await window.electronAPI.appLock.getState().catch(() => null);
      if (!isCurrent(requestGeneration)) return;
      if (refreshed) useAppLockStore.getState().setState(refreshed);
      else setError(zh ? '恢复码已生成，请先保存。应用状态暂时无法确认。' : 'The recovery code was generated; save it now. The app state could not be confirmed.');
    } catch {
      if (isCurrent(requestGeneration)) setError(zh ? '恢复码未能生成，请重试' : 'Could not generate a recovery code. Try again');
    } finally {
      if (isCurrent(requestGeneration)) setBusy(false);
    }
  };

  if (!stage || state?.phase !== 'ready') return null;
  return <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/55 p-4">
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1} className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-line bg-panel p-6 text-ink shadow-2xl">
      <h2 id={titleId} className="text-lg font-semibold">{stage === 'change' ? (zh ? '请更换主密码' : 'Change your master password') : stage === 'refresh' ? (zh ? '主密码已更新' : 'Master password updated') : (zh ? '创建新的恢复码' : 'Create a new recovery code')}</h2>
      <p id={descriptionId} className="mt-2 text-sm leading-relaxed text-ink-2">{stage === 'change'
        ? (zh ? '当前主密码少于 12 个字符。请设置更长的主密码后继续，之后即可导出备份。' : 'Your current master password has fewer than 12 characters. Set a longer password to continue and export backups.')
        : stage === 'refresh' ? (zh ? '正在确认应用状态，确认后即可继续。' : 'Checking the app state before continuing.')
        : (zh ? '主密码已更新，旧恢复码已失效。创建并保存新的恢复码，以便忘记主密码或更换电脑时找回数据。' : 'The master password was updated and the old recovery code no longer works. Create and save a new recovery code to recover data after a forgotten password or a change of computer.')}</p>
      {stage === 'refresh' && <div className="mt-5 space-y-3">
        {error && <p role="alert" className="text-xs text-down">{error}</p>}
        <button type="button" disabled={busy} className={settingButtonClass} onClick={() => {
          const requestGeneration = generation.current;
          if (!isCurrent(requestGeneration)) return;
          setBusy(true); setError('');
          void refreshAfterChange(requestGeneration).catch(() => { if (isCurrent(requestGeneration)) setError(zh ? '无法确认应用状态，请重试' : 'Could not confirm the app state. Try again'); }).finally(() => { if (isCurrent(requestGeneration)) setBusy(false); });
        }}>{busy ? (zh ? '正在确认…' : 'Checking…') : (zh ? '重新确认' : 'Check again')}</button>
      </div>}
      {stage === 'change' && <form className="mt-5 space-y-3" onSubmit={event => { event.preventDefault(); void changePassword(); }}>
        <label className="block text-xs text-ink-2">{zh ? '当前主密码' : 'Current master password'}<input type="password" autoComplete="current-password" disabled={busy} value={current} onChange={event => setCurrent(event.target.value)} className={`mt-1 ${settingFieldClass}`} /></label>
        <label className="block text-xs text-ink-2">{zh ? '新主密码（至少 12 个字符）' : 'New master password (at least 12 characters)'}<input type="password" autoComplete="new-password" disabled={busy} value={password} onChange={event => setPassword(event.target.value)} className={`mt-1 ${settingFieldClass}`} /></label>
        <label className="block text-xs text-ink-2">{zh ? '再次输入新主密码' : 'Repeat the new master password'}<input type="password" autoComplete="new-password" disabled={busy} value={confirm} onChange={event => setConfirm(event.target.value)} className={`mt-1 ${settingFieldClass}`} /></label>
        {error && <p role="alert" className="text-xs text-down">{error}</p>}
        <div className="flex justify-end"><button disabled={busy} type="submit" className={settingButtonClass}>{busy ? (zh ? '正在更新…' : 'Updating…') : (zh ? '更新主密码' : 'Update master password')}</button></div>
      </form>}
      {stage === 'recovery' && <form className="mt-5 space-y-3" onSubmit={event => { event.preventDefault(); void createRecovery(); }}>
        <label className="block text-xs text-ink-2">{zh ? '刚设置的主密码' : 'Master password you just set'}<input type="password" autoComplete="current-password" disabled={busy} value={current} onChange={event => setCurrent(event.target.value)} className={`mt-1 ${settingFieldClass}`} /></label>
        {error && <p role="alert" className="text-xs text-down">{error}</p>}
        <p className="text-xs leading-relaxed text-ink-3">{zh ? '暂不创建时，没有恢复码可用于找回数据。以后可以在设置 → 安全与隐私中创建。' : 'Without a recovery code you cannot use one to recover data. You can create it later in Settings → Security & privacy.'}</p>
        <div className="flex flex-wrap justify-end gap-2"><button type="button" disabled={busy} className={settingButtonClass} onClick={finish}>{zh ? '暂不创建' : 'Create later'}</button><button type="submit" disabled={busy} className={settingButtonClass}>{busy ? (zh ? '正在生成…' : 'Generating…') : (zh ? '生成恢复码' : 'Generate recovery code')}</button></div>
      </form>}
      {stage === 'code' && <div className="mt-5 space-y-3">
        <p className="text-xs leading-relaxed text-ink-3">{zh ? '只显示这一次。请保存到密码管理器，或抄写后放在这台电脑以外的地方。' : 'Shown only once. Save it in a password manager or write it down and keep it somewhere other than this computer.'}</p>
        <code className="block select-all break-all rounded-md border border-line bg-surf-2 px-3 py-3 text-center font-mono text-base tracking-wider">{code}</code>
        <label className="flex items-center gap-2 text-xs text-ink-2"><input type="checkbox" checked={saved} onChange={event => setSaved(event.target.checked)} />{zh ? '我已经妥善保存恢复码' : 'I have saved the recovery code'}</label>
        <div className="flex justify-end"><button type="button" disabled={!saved || busy} onClick={() => { useRecoveryReminderStore.getState().setUnconfirmed(false); finish(); }} className={settingButtonClass}>{zh ? '完成' : 'Done'}</button></div>
        {error && <p role="alert" className="text-xs text-down">{error}</p>}
      </div>}
    </div>
  </div>;
}
