import React, { useEffect, useState } from 'react';
import { RefreshCw, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../../store/workspaceStore';

type AuditRecord = { id: string | number; action: string; target: string; details: string; created_at: string | number };

export const StorageAuditTab: React.FC = () => {
  const { t } = useTranslation();
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const [stats, setStats] = useState<{ size: number; profileCount: number; runbookCount: number } | null>(null);
  const [logs, setLogs] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = async () => {
    if (!activeWorkspaceId) return;
    setLoading(true); setError('');
    try {
      const [statsResult, logsResult] = await Promise.all([
        window.electronAPI.getWorkspaceStats(activeWorkspaceId),
        window.electronAPI.getWorkspaceAuditLogs(activeWorkspaceId),
      ]);
      if (!statsResult?.success || !logsResult?.success) throw new Error('Workspace audit data unavailable');
      setStats(statsResult.stats || null);
      setLogs(logsResult.logs || []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Workspace audit data unavailable'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, [activeWorkspaceId]);

  const exportCsv = () => {
    if (!logs.length) return;
    const field = (value: unknown) => {
      const raw = String(value ?? '');
      // Spreadsheet apps may evaluate formulas even when the CSV field is quoted.
      const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const rows = [['ID', 'Action', 'Target', 'Details', 'Timestamp'], ...logs.map(log => [log.id, log.action, log.target, log.details, new Date(log.created_at).toISOString()])];
    const blob = new Blob([rows.map(row => row.map(field).join(',')).join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `audit_logs_${activeWorkspaceId}_${Date.now()}.csv`;
    link.click(); URL.revokeObjectURL(url);
  };

  return <div className="space-y-7">
    <div className="flex items-center justify-end"><button type="button" onClick={() => void refresh()} disabled={loading} className="flex min-h-8 items-center gap-1.5 rounded-md border border-line px-3 text-xs text-ink-2 hover:bg-surf-2 disabled:opacity-50"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} />{t('common.refresh', '刷新')}</button></div>
    {error && <p role="alert" className="border-l-2 border-down bg-down/10 px-3 py-2 text-sm text-down">{error}</p>}
    <section className="grid grid-cols-3 gap-4 border-y border-line py-4 max-[700px]:grid-cols-1">
      {[
        [t('workspaceCenter.dbSizeTitle', 'Database size'), stats && `${stats.size} MB`],
        [t('workspaceCenter.savedProfilesTitle', 'Saved profiles'), stats && String(stats.profileCount)],
        [t('workspaceCenter.runbooksTitle', 'Runbooks'), stats && String(stats.runbookCount)],
      ].map(([label, value]) => <div key={label} className="min-w-0"><div className="text-xs text-ink-3">{label}</div><div className="mt-2 font-mono text-lg text-ink">{loading ? '…' : value || '—'}</div></div>)}
    </section>
    <section><div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-sm font-medium">{t('workspaceCenter.recentAuditLogTitle', 'Recent audit log')}</h3><button type="button" onClick={exportCsv} disabled={!logs.length} className="flex items-center gap-1.5 text-xs text-ink-2 hover:text-primary disabled:opacity-40"><Download size={13} />{t('workspaceCenter.exportAuditLog', 'Export CSV')}</button></div>
      <div className="max-h-80 overflow-y-auto border-y border-line">
        {!loading && logs.length === 0 && <p className="py-7 text-center text-xs text-ink-3">{t('workspaceCenter.noAuditLogs', 'No audit logs found for this workspace.')}</p>}
        {logs.map(log => <div key={log.id} className="flex items-start justify-between gap-4 border-b border-line-soft py-3 last:border-b-0"><div className="min-w-0"><p className={`text-sm ${/fail|error/i.test(log.action) ? 'text-down' : 'text-ink'}`}>{log.action}: {log.target}</p><p className="mt-1 break-all font-mono text-xs text-ink-3">{log.details}</p></div><time className="shrink-0 text-xs text-ink-3">{new Date(log.created_at).toLocaleString()}</time></div>)}
      </div>
    </section>
  </div>;
};
