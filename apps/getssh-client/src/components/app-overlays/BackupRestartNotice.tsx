import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBackupRestartStore } from '../../store/backupStore';
import { storeFailureMessage } from '../../utils/storeFeedback';

/** Import disables storage app-wide until restart; this notice stays above every center or terminal. */
export function BackupRestartNotice() {
  const report = useBackupRestartStore(state => state.report);
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!report) return null;
  const restart = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await window.electronAPI.store.backup.relaunch();
      if (!result.ok) setError(storeFailureMessage(result.error, zh, result.retryAfterMs));
    } catch {
      setError(zh ? '未能重启应用，请关闭后重新打开。' : 'Could not restart the app. Close and reopen it.');
    } finally { setBusy(false); }
  };
  return <section role="status" aria-live="polite" className="shrink-0 border-b border-warn/30 bg-warn/10 px-4 py-2 text-xs text-ink">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p>{zh ? '备份已导入。需要重启应用，才能继续使用存储。' : 'Backup imported. Restart the app to use storage again.'}</p>
      <button type="button" disabled={busy} onClick={() => void restart()} className="min-h-8 rounded-md border border-line bg-panel px-3 text-xs text-ink hover:bg-surf-2 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50">
        {busy ? (zh ? '正在重启…' : 'Restarting…') : (zh ? '重启应用' : 'Restart app')}
      </button>
    </div>
    {error && <p role="alert" className="mt-1 text-down">{error}</p>}
  </section>;
}
