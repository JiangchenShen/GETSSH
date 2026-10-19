import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppLockStore } from '../../store/appLockStore';
import { useAppStore } from '../../store/appStore';
import { useBackupRestartStore } from '../../store/backupStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { storeFailureMessage } from '../../utils/storeFeedback';
import { settingButtonClass } from '../settings/SettingsControls';

const migrationKey = () => (useAppLockStore.getState().state?.migration?.presenceToReenable ?? []).join('\0');

/** Keep mounted across locks: dismissal belongs to this app run, not to a workspace. */
export function MigrationPresenceNotice({ suppressed = false }: { suppressed?: boolean }) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const isMac = useAppStore(state => state.isMac);
  const app = useAppLockStore(state => state.state);
  const workspaces = useWorkspaceStore(state => state.workspaces);
  const isSwitching = useWorkspaceStore(state => state.isSwitching);
  const isVaultLocked = useWorkspaceStore(state => state.isVaultLocked);
  const restartRequired = useBackupRestartStore(state => !!state.report);
  const [dismissed, setDismissed] = useState(false);
  const [completed, setCompleted] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const alive = useRef(false);
  const generation = useRef(0);
  const running = useRef(false);
  const hidden = useRef(suppressed);
  hidden.current = suppressed;
  const remaining = [...new Set(app?.migration?.presenceToReenable ?? [])].filter(id => !completed.includes(id));
  const presenceName = isMac ? 'Touch ID' : 'Windows Hello';
  useEffect(() => {
    alive.current = true;
    const invalidate = () => { generation.current += 1; running.current = false; setBusy(false); setErrors({}); };
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
    if (suppressed) { generation.current += 1; running.current = false; setBusy(false); setErrors({}); }
  }, [suppressed]);

  const capture = () => ({ generation: generation.current, workspaceId: useWorkspaceStore.getState().activeWorkspaceId, migration: migrationKey() });
  const current = (request: ReturnType<typeof capture>) => alive.current && generation.current === request.generation && !hidden.current
    && useAppLockStore.getState().state?.phase === 'ready' && !useAppLockStore.getState().state?.masterPasswordMustChange
    && request.migration === migrationKey() && !useBackupRestartStore.getState().report
    && useWorkspaceStore.getState().activeWorkspaceId === request.workspaceId && !useWorkspaceStore.getState().isSwitching && !useWorkspaceStore.getState().isVaultLocked;
  const enable = async () => {
    const request = capture();
    if (running.current || !current(request) || !app?.presenceSupported) return;
    running.current = true; setBusy(true); setErrors({});
    try {
      for (const workspaceId of remaining) {
        try {
          const result = await window.electronAPI.security.setPresence({ workspaceId, enabled: true });
          if (!current(request)) return;
          if (result.ok) setCompleted(ids => [...new Set([...ids, workspaceId])]);
          else if (result.error === 'cancelled') return;
          else setErrors(previous => ({ ...previous, [workspaceId]: storeFailureMessage(result.error, zh, result.retryAfterMs) }));
        } catch {
          if (!current(request)) return;
          setErrors(previous => ({ ...previous, [workspaceId]: zh ? '未能更新此工作区，请重试。' : 'Could not update this workspace. Try again.' }));
          return;
        }
      }
    } finally {
      if (current(request)) { running.current = false; setBusy(false); }
    }
  };

  if (dismissed || !remaining.length || suppressed || app?.phase !== 'ready' || app.masterPasswordMustChange || isSwitching || isVaultLocked || restartRequired) return null;
  return <aside aria-label={zh ? '迁移后的系统验证' : 'System verification after migration'} className="fixed bottom-12 right-4 z-[80] max-h-[60vh] w-[min(26rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-line bg-panel p-4 text-ink shadow-xl">
    <h2 className="text-sm font-semibold">{zh ? `迁移后重新开启 ${presenceName}` : `Re-enable ${presenceName} after migration`}</h2>
    <p className="mt-2 text-xs leading-relaxed text-ink-2">{zh ? '以下工作区需要重新开启系统验证。请先解锁这些工作区，再选择开启。' : 'These workspaces need system verification enabled again. Unlock them before choosing Enable.'}</p>
    <ul className="my-3 space-y-2 text-xs text-ink-2">{remaining.map(id => <li key={id}><span>{workspaces.find(workspace => workspace.id === id)?.name || id}</span>{errors[id] && <p role="alert" className="mt-1 text-down">{errors[id]}</p>}</li>)}</ul>
    {!app.presenceSupported && <p className="mb-3 text-xs text-ink-3">{zh ? `这台设备不支持 ${presenceName}，可以继续使用密码解锁。` : `This device does not support ${presenceName}. You can continue unlocking with a password.`}</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy || !app.presenceSupported} onClick={() => void enable()} className={settingButtonClass}>{busy ? (zh ? '正在开启…' : 'Enabling…') : (zh ? `开启 ${presenceName}` : `Enable ${presenceName}`)}</button>
      <button type="button" onClick={() => { generation.current += 1; running.current = false; setBusy(false); setErrors({}); setDismissed(true); }} className={settingButtonClass}>{zh ? '本次不再提醒' : 'Dismiss for this run'}</button>
    </div>
  </aside>;
}
