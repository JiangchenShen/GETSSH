import React from 'react';
import { ChevronLeft, ChevronRight, Download, FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../../store/appStore';
import { SettingsRow, SettingsSection, SettingsToggle, settingButtonClass } from '../SettingsControls';

interface AuditLog {
  id: string;
  alias: string;
  host: string;
  port: number;
  connectedAt: string;
  disconnectedAt: string;
  duration: string;
}

const ITEMS_PER_PAGE = 10;

export const AuditTab: React.FC = () => {
  const { t, i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const enabled = useAppStore(state => !!state.appConfig.enableAuditLogging);
  const updateConfig = useAppStore(state => state.updateConfig);
  const [logs, setLogs] = React.useState<AuditLog[]>([]);
  const [page, setPage] = React.useState(1);
  const [loadError, setLoadError] = React.useState(false);
  const orderedLogs = React.useMemo(() => [...logs].reverse(), [logs]);
  const pageCount = Math.max(1, Math.ceil(orderedLogs.length / ITEMS_PER_PAGE));
  const pageLogs = orderedLogs.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  React.useEffect(() => {
    setPage(current => Math.min(current, pageCount));
  }, [pageCount]);

  React.useEffect(() => {
    if (!window.electronAPI?.getConnectionLogs) return;
    let active = true;
    const refresh = async () => {
      try {
        const result = await window.electronAPI.getConnectionLogs();
        if (active) { setLogs(result); setLoadError(false); }
      } catch {
        if (active) setLoadError(true);
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 3000);
    return () => { active = false; clearInterval(interval); };
  }, []);

  return <div className="space-y-8">
    <SettingsSection title={zh ? '终端录屏' : 'Terminal recording'} description={zh ? '仅在开启后记录新会话的终端输出；连接元数据会单独列在下方。' : 'Record terminal output for new sessions only when enabled. Connection metadata is listed separately below.'}>
      <SettingsRow label={zh ? '记录终端输出' : 'Record terminal output'} description={zh ? '默认关闭。录屏保存在本机。' : 'Off by default. Recordings stay on this device.'}>
        <SettingsToggle checked={enabled} onChange={checked => updateConfig('enableAuditLogging', checked)} label={zh ? '记录终端输出' : 'Record terminal output'} />
      </SettingsRow>
      <SettingsRow label={zh ? '录屏文件' : 'Recording files'} description={zh ? '在文件管理器中打开本机录屏目录。' : 'Open the local recording folder.'}>
        <button type="button" onClick={() => void window.electronAPI.openAuditFolder()} className={settingButtonClass}><FolderOpen className="h-3.5 w-3.5" />{t('settings.auditOpenFolder', zh ? '打开录屏目录' : 'Open folder')}</button>
      </SettingsRow>
    </SettingsSection>

    <SettingsSection title={zh ? '连接记录' : 'Connection history'} description={zh ? '只读连接元数据；可导出备份。' : 'Read-only connection metadata; export a copy when needed.'}>
      <SettingsRow label={t('settings.auditExport')} description={zh ? '导出当前保存的连接日志。' : 'Export the saved connection logs.'}>
        <button type="button" onClick={async () => {
          try {
            const ok = await window.electronAPI.exportConnectionLogs();
            window.alert(t(ok ? 'settings.auditExportSuccess' : 'settings.auditExportFailed'));
          } catch {
            window.alert(t('settings.auditExportFailed'));
          }
        }} className={settingButtonClass}><Download className="h-3.5 w-3.5" />{t('settings.auditExport')}</button>
      </SettingsRow>
      <div className="overflow-x-auto py-3">
        {loadError && <p role="status" className="px-1 pb-3 text-xs text-down">{zh ? '连接记录暂时无法读取，正在重试。' : 'Connection history is unavailable; retrying.'}</p>}
        <table className="w-full min-w-[650px] border-collapse text-left text-xs">
          <thead className="text-ink-3"><tr className="border-b border-line-soft">
            <th scope="col" className="px-2 py-2 font-medium">{t('settings.auditSession')}</th>
            <th scope="col" className="px-2 py-2 font-medium">{t('settings.auditHost')}</th>
            <th scope="col" className="px-2 py-2 font-medium">{t('settings.auditConnectedAt')}</th>
            <th scope="col" className="px-2 py-2 font-medium">{t('settings.auditDisconnectedAt')}</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">{t('settings.auditDuration')}</th>
          </tr></thead>
          <tbody className="text-ink-2">
            {pageLogs.map(log => <tr key={log.id} className="border-b border-line-soft last:border-b-0 hover:bg-surf/60">
              <td className="max-w-36 truncate px-2 py-2 font-medium text-ink" title={log.alias}>{log.alias}</td>
              <td className="max-w-40 truncate px-2 py-2 font-mono" title={`${log.host}:${log.port}`}>{log.host}:{log.port}</td>
              <td className="whitespace-nowrap px-2 py-2 font-mono">{log.connectedAt}</td>
              <td className="whitespace-nowrap px-2 py-2 font-mono">{log.disconnectedAt === 'Online' ? <span className="text-ok">{t('settings.auditOnline')}</span> : log.disconnectedAt}</td>
              <td className="whitespace-nowrap px-2 py-2 text-right font-mono">{log.duration}</td>
            </tr>)}
            {!pageLogs.length && <tr><td colSpan={5} className="px-2 py-8 text-center text-ink-3">{loadError ? (zh ? '暂无可显示的记录' : 'No records to display') : t('settings.noAuditLogsFound')}</td></tr>}
          </tbody>
        </table>
      </div>
      {logs.length > ITEMS_PER_PAGE && <div className="flex items-center justify-between gap-3 border-t border-line-soft px-1 py-2 text-xs text-ink-3">
        <span>{zh ? `共 ${logs.length} 条` : `${logs.length} records`}</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setPage(current => Math.max(1, current - 1))} disabled={page === 1} aria-label={zh ? '上一页' : 'Previous page'} className={settingButtonClass}><ChevronLeft className="h-3.5 w-3.5" /></button>
          <span>{t('settings.page')} {page} / {pageCount}</span>
          <button type="button" onClick={() => setPage(current => Math.min(pageCount, current + 1))} disabled={page === pageCount} aria-label={zh ? '下一页' : 'Next page'} className={settingButtonClass}><ChevronRight className="h-3.5 w-3.5" /></button>
        </div>
      </div>}
    </SettingsSection>
  </div>;
};
