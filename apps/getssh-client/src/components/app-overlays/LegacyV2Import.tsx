import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { useAppLockStore } from '../../store/appLockStore';
import { useAppStore } from '../../store/appStore';
import { useSessionStore, type SessionProfile } from '../../store/sessionStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

const buttonClass = 'rounded-md border border-line px-3 py-2 text-sm text-ink hover:bg-surf focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50';

/** The main process imports 2.0 data; this window only asks for its old password and adopts the returned list. */
export function LegacyV2Import() {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const phase = useAppLockStore(state => state.state?.phase);
  const mustChangePassword = useAppLockStore(state => state.state?.masterPasswordMustChange);
  const configLoaded = useAppStore(state => state.isConfigLoaded);
  const defaultPort = useAppStore(state => state.appConfig.defaultPort);
  const workspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const isSwitching = useWorkspaceStore(state => state.isSwitching);
  const vaultLocked = useWorkspaceStore(state => state.isVaultLocked);
  const [prompt, setPrompt] = useState<'password' | 'error' | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingDefaultPort, setPendingDefaultPort] = useState(false);
  const mounted = useRef(false);
  const checkedReady = useRef(false);
  const appGeneration = useRef(0);
  const workspaceGeneration = useRef(0);
  const inFlight = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);

  const describe = (code: string, retryAfterMs?: number) => {
    switch (code) {
      case 'wrong_password': return zh ? 'GETSSH 2.0 的主密码不正确，请重新输入。' : 'The GETSSH 2.0 master password is incorrect. Try again.';
      case 'unreadable': return zh ? '无法读取 GETSSH 2.0 的服务器文件。可以先跳过，再检查原文件或备份。' : 'The GETSSH 2.0 server file cannot be read. You can skip this and check the original file or a backup.';
      case 'rate_limited': {
        const seconds = Math.max(1, Math.ceil((retryAfterMs ?? 1000) / 1000));
        return zh ? `尝试次数过多，请 ${seconds} 秒后再试。` : `Too many attempts. Try again in ${seconds} seconds.`;
      }
      case 'cancelled':
      case 'unauthorized': return '';
      case 'unavailable': return zh ? '导入服务现在不可用。可以先跳过，重启 GETSSH 后再试。' : 'Import is unavailable right now. You can skip this and try again after restarting GETSSH.';
      default: return zh ? 'GETSSH 2.0 的服务器未能导入。可以重试，或先跳过并保留原文件。' : 'The GETSSH 2.0 servers could not be imported. Retry, or skip this and keep the original file.';
    }
  };

  // Invalidate responses even if a workspace is switched away from and back before IPC resolves.
  useEffect(() => {
    mounted.current = true;
    const unsubscribeApp = useAppLockStore.subscribe((next, previous) => {
      if (next.state?.phase === previous.state?.phase && next.state?.masterPasswordMustChange === previous.state?.masterPasswordMustChange) return;
      appGeneration.current++;
      setPassword('');
      if (next.state?.phase !== 'ready' || next.state.masterPasswordMustChange) {
        checkedReady.current = false;
        setPrompt(null);
        setError('');
        setPendingDefaultPort(false);
      }
    });
    const unsubscribeWorkspace = useWorkspaceStore.subscribe((next, previous) => {
      if (next.activeWorkspaceId === previous.activeWorkspaceId && next.isSwitching === previous.isSwitching && next.isVaultLocked === previous.isVaultLocked) return;
      workspaceGeneration.current++;
      setPassword('');
    });
    return () => {
      mounted.current = false;
      appGeneration.current++;
      workspaceGeneration.current++;
      unsubscribeApp();
      unsubscribeWorkspace();
    };
  }, []);

  const isCurrentApp = (generation: number) => mounted.current && generation === appGeneration.current
    && useAppLockStore.getState().state?.phase === 'ready' && !useAppLockStore.getState().state?.masterPasswordMustChange;

  const requestScope = () => ({ app: appGeneration.current, workspace: workspaceGeneration.current, id: useWorkspaceStore.getState().activeWorkspaceId });
  const isCurrentWorkspace = (scope: ReturnType<typeof requestScope>) => {
    const current = useWorkspaceStore.getState();
    return isCurrentApp(scope.app) && scope.workspace === workspaceGeneration.current
      && scope.id === current.activeWorkspaceId && !current.isSwitching && !current.isVaultLocked;
  };
  const adoptProfiles = (scope: ReturnType<typeof requestScope>, result: { workspaceId: string; profiles: SessionProfile[] }) => {
    if (isCurrentWorkspace(scope) && result.workspaceId === useWorkspaceStore.getState().activeWorkspaceId) {
      // Do not save here: the main process already saved this complete list, including its secret metadata.
      useSessionStore.getState().setSessions(result.profiles);
    }
  };

  useEffect(() => {
    if (phase !== 'ready' || mustChangePassword || !configLoaded || checkedReady.current || !window.electronAPI?.store?.legacyV2) return;
    checkedReady.current = true;
    const generation = appGeneration.current;
    void (async () => {
      try {
        const result = await window.electronAPI.store.legacyV2.status();
        if (!isCurrentApp(generation)) return;
        if (!result.ok) {
          const message = describe(result.error, result.retryAfterMs);
          if (message) { setError(message); setPrompt('error'); }
          return;
        }
        if (result.imported && result.imported.portDefaulted > 0) setPendingDefaultPort(true);
        if (result.needsPassword) setPrompt('password');
        else if (result.kind === 'unreadable') { setError(describe('unreadable')); setPrompt('error'); }
      } catch {
        if (isCurrentApp(generation)) { setError(describe('unavailable')); setPrompt('error'); }
      }
    })();
    // One status check per ready lifecycle; language and configuration changes do not repeat it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, mustChangePassword, configLoaded]);

  useEffect(() => {
    if (!pendingDefaultPort || phase !== 'ready' || mustChangePassword || isSwitching || vaultLocked || inFlight.current) return;
    const scope = requestScope();
    setPendingDefaultPort(false);
    inFlight.current = true;
    setBusy(true);
    void (async () => {
      try {
        // Calling with 22 also marks the missing-port migration as handled.
        const result = await window.electronAPI.store.legacyV2.applyDefaultPort({ port: defaultPort });
        if (!isCurrentWorkspace(scope)) return;
        if (result.ok && result.status !== 'failed') adoptProfiles(scope, result);
        else {
          const message = describe(result.ok ? 'failed' : result.error, result.ok ? undefined : result.retryAfterMs);
          if (message) { setError(message); setPrompt(current => current ?? 'error'); }
        }
      } catch {
        if (isCurrentWorkspace(scope)) { setError(describe('failed')); setPrompt(current => current ?? 'error'); }
      } finally {
        inFlight.current = false;
        if (mounted.current) setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDefaultPort, phase, mustChangePassword, isSwitching, vaultLocked, workspaceId, defaultPort, busy]);

  const skip = () => {
    if (inFlight.current) return;
    setPassword('');
    setError('');
    setPrompt(null);
  };

  const importServers = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || inFlight.current || isSwitching || vaultLocked) return;
    const scope = requestScope();
    if (!isCurrentWorkspace(scope)) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    const request = { password, defaultPort: useAppStore.getState().appConfig.defaultPort };
    setPassword('');
    try {
      const result = await window.electronAPI.store.legacyV2.import(request);
      if (!isCurrentWorkspace(scope)) return;
      if (!result.ok) { setError(describe(result.error, result.retryAfterMs)); return; }
      if (result.status === 'imported' || result.status === 'already' || result.status === 'nothing') {
        adoptProfiles(scope, result);
        setPrompt(null);
      } else {
        // Do not echo result.error: it can contain file details and is not user-facing copy.
        setError(describe(result.status === 'needs_password' ? 'wrong_password' : result.status));
      }
    } catch {
      if (isCurrentWorkspace(scope)) setError(describe('failed'));
    } finally {
      request.password = '';
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  useEffect(() => {
    if (!prompt || phase !== 'ready' || mustChangePassword) return;
    const previousFocus = document.activeElement;
    const controls = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []);
    const focusFirst = () => (controls()[0] ?? dialog.current)?.focus();
    focusFirst();
    const handleKeys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); skip(); }
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
    const keepFocus = (event: FocusEvent) => { if (!dialog.current?.contains(event.target as Node)) focusFirst(); };
    document.addEventListener('keydown', handleKeys, true);
    document.addEventListener('focusin', keepFocus, true);
    return () => {
      document.removeEventListener('keydown', handleKeys, true);
      document.removeEventListener('focusin', keepFocus, true);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt, phase, mustChangePassword]);

  if (phase !== 'ready' || mustChangePassword || !prompt) return null;
  return (
    <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/50 p-4">
      <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="legacy-v2-title" aria-describedby="legacy-v2-description"
        className="w-full max-w-md space-y-4 rounded-xl border border-line bg-panel p-6 text-ink shadow-xl">
        <div className="space-y-2">
          <h2 id="legacy-v2-title" className="text-lg font-semibold">{zh ? '导入 GETSSH 2.0 服务器' : 'Import GETSSH 2.0 servers'}</h2>
          <p id="legacy-v2-description" className="text-sm text-ink-2">{prompt === 'password'
            ? (zh ? '输入 GETSSH 2.0 使用的主密码。服务器会加入主工作区，原来的文件会保留。' : 'Enter the master password used by GETSSH 2.0. Servers will be added to the main workspace, and the original file will be kept.')
            : (zh ? '可以先跳过，在检查 GETSSH 2.0 的原文件或备份后重新打开应用。' : 'You can skip this, check the original GETSSH 2.0 file or a backup, and reopen the app.')}</p>
        </div>
        {error && <p role="alert" className="text-sm text-down">{error}</p>}
        {prompt === 'password' ? <form className="space-y-4" onSubmit={event => void importServers(event)}>
          <label className="block space-y-2 text-sm">
            <span>{zh ? 'GETSSH 2.0 主密码' : 'GETSSH 2.0 master password'}</span>
            <input type="password" autoComplete="off" value={password} disabled={busy || isSwitching || vaultLocked}
              onChange={event => setPassword(event.target.value)} className="w-full rounded-md border border-line bg-panel px-3 py-2 text-ink outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50" />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass} disabled={busy} onClick={skip}>{zh ? '先跳过' : 'Skip for now'}</button>
            <button type="submit" className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm text-bg hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50" disabled={busy || !password || isSwitching || vaultLocked}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}{zh ? '导入服务器' : 'Import servers'}
            </button>
          </div>
        </form> : <div className="flex justify-end"><button type="button" className={buttonClass} disabled={busy} onClick={skip}>{zh ? '先跳过' : 'Skip for now'}</button></div>}
      </div>
    </div>
  );
}
