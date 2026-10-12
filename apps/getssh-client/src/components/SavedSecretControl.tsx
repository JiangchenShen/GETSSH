import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppLockStore } from '../store/appLockStore';
import { useAppStore } from '../store/appStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { RevealRoute, SecretField, StoreResult } from '../types/store';
import { storeFailureMessage } from '../utils/storeFeedback';
import { settingButtonClass, settingFieldClass } from './settings/SettingsControls';

interface SavedSecretControlProps {
  workspaceId: string;
  profileId: string;
  field: SecretField;
  onClear: () => void;
}

// The native store shares reveal grants. Keep old cleanup ahead of later authentication.
let revealQueue: Promise<void> = Promise.resolve();
const queueReveal = (action: () => Promise<void>) => {
  const next = revealQueue.then(action, action);
  revealQueue = next.catch(() => {});
  return next;
};

/** The stored secret stays in the main process's system dialog, including its Copy action. */
export function SavedSecretControl({ workspaceId, profileId, field, onClear }: SavedSecretControlProps) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const isMac = useAppStore(store => store.isMac);
  const [permission, setPermission] = useState<'master' | 'workspace' | 'presence' | null>(null);
  const [panel, setPanel] = useState(false);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(false);
  const generation = useRef(0);
  const identity = useRef({ workspaceId, profileId, field });
  identity.current = { workspaceId, profileId, field };
  const canUsePassword = permission === 'master' || permission === 'workspace';
  const presenceName = isMac ? 'Touch ID' : 'Windows Hello';

  const close = () => {
    const api = window.electronAPI.store.reveal;
    void queueReveal(async () => { await api.close({ workspaceId }); }).catch(() => {});
  };
  useEffect(() => {
    alive.current = true;
    generation.current += 1;
    setPermission(null); setPanel(false); setUsePassword(false); setPassword(''); setError(''); setBusy(false);
    const valid = (requestGeneration: number) => alive.current && generation.current === requestGeneration
      && identity.current.workspaceId === workspaceId && identity.current.profileId === profileId && identity.current.field === field
      && useAppLockStore.getState().state?.phase === 'ready'
      && useWorkspaceStore.getState().activeWorkspaceId === workspaceId && !useWorkspaceStore.getState().isSwitching && !useWorkspaceStore.getState().isVaultLocked;
    const loadPermission = (requestGeneration: number) => {
      void window.electronAPI.security.status().then(status => {
        if (!valid(requestGeneration)) return;
        if (!status) { setPermission('presence'); return; }
        const scope = status.scopes.find(item => item.workspaceId === workspaceId);
        setPermission(status.appProtected ? 'master' : scope?.ownPassword ? 'workspace' : 'presence');
      }).catch(() => { if (valid(requestGeneration)) setPermission('presence'); });
    };
    loadPermission(generation.current);
    const invalidate = () => {
      generation.current += 1; setPermission(null); setPanel(false); setUsePassword(false); setPassword(''); setError(''); setBusy(false); close();
      if (valid(generation.current)) loadPermission(generation.current);
    };
    const stopApp = useAppLockStore.subscribe((next, previous) => {
      if (next.state?.phase !== previous.state?.phase) invalidate();
    });
    const stopWorkspace = useWorkspaceStore.subscribe((next, previous) => {
      if (next.activeWorkspaceId !== previous.activeWorkspaceId || next.isSwitching !== previous.isSwitching || next.isVaultLocked !== previous.isVaultLocked) invalidate();
    });
    return () => { alive.current = false; generation.current += 1; stopApp(); stopWorkspace(); close(); };
  }, [workspaceId, profileId, field]);

  const capture = () => ({ generation: generation.current, workspaceId, profileId, field });
  const valid = (request: ReturnType<typeof capture>) => alive.current && request.generation === generation.current
    && identity.current.workspaceId === request.workspaceId && identity.current.profileId === request.profileId && identity.current.field === request.field
    && useAppLockStore.getState().state?.phase === 'ready'
    && useWorkspaceStore.getState().activeWorkspaceId === request.workspaceId && !useWorkspaceStore.getState().isSwitching && !useWorkspaceStore.getState().isVaultLocked;

  const failure = (result: StoreResult, route: RevealRoute) => {
    if (result.ok) return;
    setPassword('');
    if (result.error === 'unauthorized') { setPanel(false); setError(''); return; }
    if (result.error === 'invalid_argument') {
      setPermission('presence'); setUsePassword(false);
      setError(zh ? `这个工作区没有可用于验证的密码，请使用 ${presenceName}` : `This workspace has no password for verification. Use ${presenceName}`);
      return;
    }
    setError(storeFailureMessage(result.error, zh, result.retryAfterMs));
    if (route.method === 'presence') setUsePassword(true);
  };

  const reveal = async (route: RevealRoute) => {
    if (busy) return;
    const request = capture();
    if (!valid(request)) return;
    if (route.method === 'password' && (!canUsePassword || !route.password)) return;
    setBusy(true); setPanel(true); setError('');
    try {
      const api = window.electronAPI.store.reveal;
      await queueReveal(async () => {
        if (!valid(request)) return;
        let opened = false;
        try {
          const result = await api.open({ workspaceId, ...route });
          opened = result.ok;
          if (!valid(request)) return;
          if (!result.ok) { failure(result, route); return; }
          setPassword('');
          let shown = await api.show({ workspaceId, profileId, field, language: zh ? 'zh-CN' : 'en-US' });
          if (!valid(request)) return;
          if (!shown.ok && shown.error === 'locked') {
            // Reopen once after expiration, without retaining the typed password.
            const reopened = await api.open({ workspaceId, method: 'presence' });
            if (!valid(request)) return;
            if (!reopened.ok) { failure(reopened, { method: 'presence' }); return; }
            shown = await api.show({ workspaceId, profileId, field, language: zh ? 'zh-CN' : 'en-US' });
            if (!valid(request)) return;
          }
          if (!shown.ok) failure(shown, { method: 'presence' });
          else { setPanel(false); setUsePassword(false); }
        } finally {
          // Close directly inside this queue item, never behind a future component's open.
          if (opened) await api.close({ workspaceId }).catch(() => {});
        }
      });
    } catch {
      if (valid(request)) { setPassword(''); setError(zh ? '无法打开查看窗口，请重试' : 'Could not open the viewing dialog. Try again'); }
    } finally {
      if (valid(request)) setBusy(false);
    }
  };

  return <div className="mt-2 space-y-2">
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} className={settingButtonClass} onClick={() => void reveal({ method: 'presence' })}>{field === 'password' ? (zh ? '查看密码' : 'View password') : (zh ? '查看口令' : 'View passphrase')}</button>
      {canUsePassword && <button type="button" disabled={busy} className={settingButtonClass} onClick={() => { setPanel(true); setUsePassword(true); setError(''); }}>{zh ? '输入密码验证' : 'Verify with a password'}</button>}
      <button type="button" disabled={busy} className={settingButtonClass} onClick={onClear}>{field === 'password' ? (zh ? '清除已保存的密码' : 'Clear saved password') : (zh ? '清除已保存的口令' : 'Clear saved passphrase')}</button>
    </div>
    {panel && <div className="space-y-2 border-l-2 border-line pl-3">
      <p className="text-xs leading-relaxed text-ink-3">{zh ? '密码只在系统对话框中显示和复制，不会填入连接表单。' : 'The secret is shown and copied only in the system dialog; it is not filled into this form.'}</p>
      {canUsePassword && usePassword && <>
        <label className="block text-xs text-ink-2">{permission === 'master' ? (zh ? '主密码' : 'Master password') : (zh ? '工作区密码' : 'Workspace password')}
          <input type="password" autoComplete="current-password" value={password} disabled={busy} onChange={event => setPassword(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void reveal({ method: 'password', password }); } }} className={`mt-1 ${settingFieldClass}`} />
        </label>
        <div className="flex flex-wrap gap-2"><button type="button" disabled={busy || !password} className={settingButtonClass} onClick={() => void reveal({ method: 'password', password })}>{zh ? '验证并查看' : 'Verify & view'}</button><button type="button" disabled={busy} className={settingButtonClass} onClick={() => { setPanel(false); setUsePassword(false); setPassword(''); setError(''); }}>{zh ? '取消' : 'Cancel'}</button></div>
      </>}
      {!canUsePassword && !busy && <p className="text-xs text-ink-3">{permission === null ? (zh ? '正在确认密码验证方式…' : 'Checking password verification options…') : (zh ? `请使用 ${presenceName} 验证。` : `Use ${presenceName} for verification.`)}</p>}
      {busy && <p role="status" className="text-xs text-ink-3">{zh ? '请完成系统验证或关闭查看窗口。' : 'Complete system verification or close the viewing dialog.'}</p>}
      {error && <p role="alert" className="text-xs text-down">{error}</p>}
    </div>}
  </div>;
}
