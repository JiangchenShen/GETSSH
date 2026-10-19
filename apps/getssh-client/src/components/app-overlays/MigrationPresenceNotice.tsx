import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppLockStore } from '../../store/appLockStore';
import { useAppStore } from '../../store/appStore';
import { useBackupRestartStore } from '../../store/backupStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { SecurityStatus } from '../../types/ipc';
import { storeFailureMessage } from '../../utils/storeFeedback';
import { settingButtonClass } from '../settings/SettingsControls';

const migrationKey = () => (useAppLockStore.getState().state?.migration?.presenceToReenable ?? []).join('\0');

/** Listed workspaces that need nothing more: Touch ID is on, the password is gone, or so is the workspace. */
const finishedIn = (status: SecurityStatus, ids: string[]) => ids.filter(id => {
  const scope = status.scopes.find(item => item.workspaceId === id);
  return !scope || !scope.ownPassword || scope.presence;
});

/**
 * Keep mounted across locks: dismissal belongs to this app run, not to a workspace.
 *
 * security.setPresence is one switch: it turns Touch ID on for every unlocked scope (the master
 * password's too, when there is one) and leaves locked ones as they are without an error. The
 * listed workspaces each have their own password and are locked after the migration, and leaving
 * one locks it again, so only the active one can be turned on at a time. What counts as done is
 * what security.status() reports, never the ok of the call.
 */
export function MigrationPresenceNotice({ suppressed = false }: { suppressed?: boolean }) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const isMac = useAppStore(state => state.isMac);
  const app = useAppLockStore(state => state.state);
  const workspaces = useWorkspaceStore(state => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const isSwitching = useWorkspaceStore(state => state.isSwitching);
  const isVaultLocked = useWorkspaceStore(state => state.isVaultLocked);
  const restartRequired = useBackupRestartStore(state => !!state.report);
  const [dismissed, setDismissed] = useState(false);
  const [completed, setCompleted] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(false);
  const generation = useRef(0);
  const running = useRef(false);
  const hidden = useRef(suppressed);
  hidden.current = suppressed;
  const listed = [...new Set(app?.migration?.presenceToReenable ?? [])];
  const remaining = listed.filter(id => !completed.includes(id));
  const presenceName = isMac ? 'Touch ID' : 'Windows Hello';
  const shown = !dismissed && remaining.length > 0 && !suppressed && app?.phase === 'ready' && !app.masterPasswordMustChange && !isSwitching && !isVaultLocked && !restartRequired;
  const canEnable = shown && !!app?.presenceSupported && remaining.includes(activeWorkspaceId);
  const invalidate = () => { generation.current += 1; running.current = false; setBusy(false); setError(''); };
  useEffect(() => {
    alive.current = true;
    const stopApp = useAppLockStore.subscribe((next, previous) => {
      if (next.state?.phase !== previous.state?.phase || next.state?.masterPasswordMustChange !== previous.state?.masterPasswordMustChange
        || (next.state?.migration?.presenceToReenable ?? []).join('\0') !== (previous.state?.migration?.presenceToReenable ?? []).join('\0')) invalidate();
    });
    const stopWorkspace = useWorkspaceStore.subscribe((next, previous) => {
      if (next.activeWorkspaceId !== previous.activeWorkspaceId || next.isSwitching !== previous.isSwitching || next.isVaultLocked !== previous.isVaultLocked) invalidate();
    });
    const stopBackup = useBackupRestartStore.subscribe((next, previous) => { if (next.report !== previous.report) invalidate(); });
    return () => { alive.current = false; generation.current += 1; stopApp(); stopWorkspace(); stopBackup(); };
  }, []);
  useEffect(() => {
    if (suppressed) invalidate();
  }, [suppressed]);

  const capture = () => ({ generation: generation.current, workspaceId: useWorkspaceStore.getState().activeWorkspaceId, migration: migrationKey() });
  const current = (request: ReturnType<typeof capture>) => alive.current && generation.current === request.generation && !hidden.current
    && useAppLockStore.getState().state?.phase === 'ready' && !useAppLockStore.getState().state?.masterPasswordMustChange
    && request.migration === migrationKey() && !useBackupRestartStore.getState().report
    && useWorkspaceStore.getState().activeWorkspaceId === request.workspaceId && !useWorkspaceStore.getState().isSwitching && !useWorkspaceStore.getState().isVaultLocked;
  /** Marks what the main process reports as done; returns those ids, or null for a stale answer. */
  const refresh = async (request: ReturnType<typeof capture>, ids: string[]) => {
    const status = await window.electronAPI.security.status();
    if (!current(request) || !status) return null;
    const finished = finishedIn(status, ids);
    if (finished.length) setCompleted(previous => [...new Set([...previous, ...finished])]);
    return finished;
  };
  // Workspaces turned on elsewhere (Settings) or no longer needing it drop out when the notice shows.
  useEffect(() => {
    if (!shown) return;
    void refresh(capture(), remaining).catch(() => {});
  }, [shown, activeWorkspaceId, isVaultLocked, listed.join('\0')]);

  const enable = async () => {
    const request = capture();
    if (running.current || !canEnable || !current(request)) return;
    running.current = true; setBusy(true); setError('');
    try {
      const result = await window.electronAPI.security.setPresence({ workspaceId: request.workspaceId, enabled: true });
      if (!current(request)) return;
      if (!result.ok) {
        if (result.error !== 'cancelled') setError(storeFailureMessage(result.error, zh, result.retryAfterMs));
        return;
      }
      const finished = await refresh(request, remaining);
      if (finished && !finished.includes(request.workspaceId)) setError(zh ? '没有开启成功，请重试。' : 'It was not turned on. Try again.');
    } catch {
      if (current(request)) setError(zh ? '未能开启，请重试。' : 'Could not turn it on. Try again.');
    } finally {
      if (current(request)) { running.current = false; setBusy(false); }
    }
  };

  if (!shown) return null;
  return <aside aria-label={zh ? '迁移后的系统验证' : 'System verification after migration'} className="fixed bottom-12 right-4 z-[80] max-h-[60vh] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-line bg-panel p-4 text-ink shadow-xl">
    <h2 className="text-sm font-semibold">{zh ? `迁移后重新开启 ${presenceName}` : `Re-enable ${presenceName} after migration`}</h2>
    <p className="mt-2 text-xs leading-relaxed text-ink-2">{zh
      ? `这些工作区各有自己的密码，迁移后要重新开启 ${presenceName}。一次只能开当前这一个：切换过去、解锁，再点开启。${app.appProtected ? `主密码解锁也会一起改用 ${presenceName}。` : ''}`
      : `These workspaces have their own passwords and need ${presenceName} turned on again after the migration. Only the current one can be turned on at a time: switch to it, unlock it, then choose Enable.${app.appProtected ? ` Unlocking with the master password will use ${presenceName} too.` : ''}`}</p>
    <ul className="my-3 space-y-2 text-xs text-ink-2">{remaining.map(id => <li key={id}>
      <span className="text-ink">{workspaces.find(workspace => workspace.id === id)?.name || id}</span>
      <span className="ml-2 text-ink-3">{id === activeWorkspaceId ? (zh ? '当前工作区' : 'Current workspace') : (zh ? '切换到这个工作区并解锁后再开启' : 'Switch to it and unlock it first')}</span>
    </li>)}</ul>
    {error && <p role="alert" className="mb-3 text-xs text-down">{error}</p>}
    {!app.presenceSupported && <p className="mb-3 text-xs text-ink-3">{zh ? `这台设备不支持 ${presenceName}，可以继续使用密码解锁。` : `This device does not support ${presenceName}. You can continue unlocking with a password.`}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy || !canEnable} onClick={() => void enable()} className={settingButtonClass}>{busy ? (zh ? '正在开启…' : 'Enabling…') : (zh ? `开启 ${presenceName}` : `Enable ${presenceName}`)}</button>
      <button type="button" onClick={() => { invalidate(); setDismissed(true); }} className={settingButtonClass}>{zh ? '本次不再提醒' : 'Dismiss for this run'}</button>
    </div>
  </aside>;
}
