import React from 'react';
import { Activity, Shield, Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../../store/appStore';

interface AuditLog {
  id: string;
  alias: string;
  host: string;
  port: number;
  connectedAt: string;
  disconnectedAt: string;
  duration: string;
}

export const AuditTab: React.FC = () => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const appConfig = useAppStore(state => state.appConfig);
  const updateConfig = useAppStore(state => state.updateConfig);

  const [auditLogs, setAuditLogs] = React.useState<AuditLog[]>([]);
  const [auditPage, setAuditPage] = React.useState(1);
  const ITEMS_PER_PAGE = 10;
  
  const reversedAuditLogs = React.useMemo(() => [...auditLogs].reverse(), [auditLogs]);
  const totalAuditPages = Math.max(1, Math.ceil(reversedAuditLogs.length / ITEMS_PER_PAGE));
  
  React.useEffect(() => {
    if (auditPage > totalAuditPages) setAuditPage(totalAuditPages);
  }, [totalAuditPages, auditPage]);
  
  const paginatedAuditLogs = reversedAuditLogs.slice((auditPage - 1) * ITEMS_PER_PAGE, auditPage * ITEMS_PER_PAGE);
  
  React.useEffect(() => {
    let auditInterval: NodeJS.Timeout | undefined;
    if (window.electronAPI?.getConnectionLogs) {
      const fetchLogs = () => window.electronAPI.getConnectionLogs().then(setAuditLogs);
      fetchLogs();
      auditInterval = setInterval(fetchLogs, 3000);
    }

    return () => {
      if (auditInterval) clearInterval(auditInterval);
    };
  }, []);

  return (
    <div className="max-w-4xl mx-auto w-full px-8 pt-8 pb-24 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Immersive Header */}
      <div className="flex flex-col gap-2 mb-10 relative group">
        <div className={`absolute -left-10 top-0 w-40 h-40 rounded-full blur-[60px] opacity-0 group-hover:opacity-100 transition-opacity duration-1000 pointer-events-none ${isDark ? 'bg-indigo-500/20' : 'bg-indigo-500/10'}`} />
        <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-4 relative z-10">
          <div className={`p-2.5 rounded-[1.25rem] ${isDark ? 'bg-indigo-500/20 text-indigo-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]' : 'bg-indigo-500/10 text-indigo-600'}`}>
            <Activity className="w-7 h-7" />
          </div>
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-600 pb-1">
            {t('settings.auditLogs')}
          </span>
        </h1>
        <p className={`text-sm ml-[4.5rem] ${isDark ? 'text-white/50' : 'text-black/50'}`}>
          {t('settings.auditHeaderDesc')}
        </p>
      </div>

      <div className="flex flex-col gap-6">
        {/* Header Controls */}
        <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between">
          {/* Enable Audit Toggle */}
          <label className={`flex-1 flex items-center justify-between p-5 rounded-2xl border cursor-pointer group transition-colors ${isDark ? 'bg-white/[0.02] hover:bg-white/[0.04] border-white/10' : 'bg-white hover:bg-black/[0.02] border-black/10'}`}>
            <div className="flex items-center gap-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${appConfig.enableAuditLogging ? 'bg-indigo-500/20 text-indigo-500' : (isDark ? 'bg-white/5 text-white/40' : 'bg-black/5 text-black/40')}`}>
                <Shield className="w-5 h-5" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-bold flex items-center gap-2">
                  {appConfig.enableAuditLogging && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />}
                  启用终端指令与物理级审计录屏
                </span>
                <span className={`text-[10px] mt-0.5 ${isDark ? 'text-white/50' : 'text-black/50'}`}>在底层引擎接管记录所有终端会话输出。遵循零信任，默认关闭且需您主动开启。</span>
              </div>
            </div>
            <div 
              onClick={() => updateConfig('enableAuditLogging', !appConfig.enableAuditLogging)} 
              className={`relative w-12 h-6 rounded-xl border border-black/20 dark:border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-colors flex-shrink-0 ml-4 ${appConfig.enableAuditLogging ? 'bg-indigo-500' : 'bg-black/20 dark:bg-white/10'}`}
            >
              <div className={`absolute top-1 left-1 bg-white shadow-sm w-4 h-4 rounded-xl transition-transform ${appConfig.enableAuditLogging ? 'translate-x-6' : 'translate-x-0'}`} />
            </div>
          </label>

          {/* Export Button */}
          <button 
            onClick={async () => {
              const ok = await window.electronAPI.exportConnectionLogs();
              if (ok) alert(t('settings.auditExportSuccess'));
            }}
            className={`flex items-center justify-center h-[72px] px-6 gap-3 rounded-2xl border transition-all ${isDark ? 'bg-white/5 hover:bg-white/10 border-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]' : 'bg-black/5 hover:bg-black/10 border-black/10 text-black'}`}
          >
            <Download className="w-5 h-5 opacity-70" />
            <span className="text-sm font-bold uppercase tracking-wider">{t('settings.auditExport')}</span>
          </button>
        </div>

        {/* Audit Table */}
        <div className={`rounded-3xl border overflow-hidden ${isDark ? 'bg-white/[0.02] border-white/10' : 'bg-white border-black/5'}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead>
                <tr className={`${isDark ? 'bg-white/5 text-white/40' : 'bg-black/5 text-black/40'} uppercase text-[10px] tracking-wider font-bold`}>
                  <th className={`p-4 border-b ${isDark ? 'border-white/10' : 'border-black/5'}`}>{t('settings.auditSession')}</th>
                  <th className={`p-4 border-b ${isDark ? 'border-white/10' : 'border-black/5'}`}>{t('settings.auditHost')}</th>
                  <th className={`p-4 border-b ${isDark ? 'border-white/10' : 'border-black/5'}`}>{t('settings.auditConnectedAt')}</th>
                  <th className={`p-4 border-b ${isDark ? 'border-white/10' : 'border-black/5'}`}>{t('settings.auditDisconnectedAt')}</th>
                  <th className={`p-4 border-b text-right ${isDark ? 'border-white/10' : 'border-black/5'}`}>{t('settings.auditDuration')}</th>
                </tr>
              </thead>
              <tbody>
                {paginatedAuditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-12 text-center">
                      <div className="flex flex-col items-center justify-center gap-3 opacity-40">
                        <Activity className="w-8 h-8" />
                        <span className="text-sm font-bold uppercase tracking-wider">{t('settings.noAuditLogsFound')}</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  paginatedAuditLogs.map((log, i) => (
                    <tr key={i} className={`border-b last:border-b-0 transition-colors ${isDark ? 'border-white/5 hover:bg-white/5' : 'border-black/5 hover:bg-black/5'} text-sm font-medium`}>
                      <td className="p-4 truncate max-w-[150px] font-bold" title={log.alias}>{log.alias}</td>
                      <td className="p-4 opacity-60 font-mono text-xs truncate max-w-[150px]" title={`${log.host}:${log.port}`}>{log.host}:{log.port}</td>
                      <td className="p-4 opacity-60 font-mono text-xs">{log.connectedAt}</td>
                      <td className="p-4 font-mono text-xs">
                        <span className={`px-2.5 py-1 rounded-lg ${log.disconnectedAt === 'Online' ? (isDark ? 'bg-green-500/20 text-green-400' : 'bg-green-500/10 text-green-600') : 'opacity-60'}`}>
                          {log.disconnectedAt === 'Online' ? t('settings.auditOnline') : log.disconnectedAt}
                        </span>
                      </td>
                      <td className="p-4 opacity-90 text-right font-mono text-xs font-bold">{log.duration}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {auditLogs.length > ITEMS_PER_PAGE && (
            <div className={`flex items-center justify-between p-4 border-t ${isDark ? 'border-white/10 text-white/60 bg-white/5' : 'border-black/5 text-black/60 bg-black/5'}`}>
              <div className="text-[10px] font-bold uppercase tracking-wider opacity-60">
                Total {auditLogs.length} logs
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setAuditPage(p => Math.max(1, p - 1))}
                  disabled={auditPage === 1}
                  className={`w-8 h-8 flex items-center justify-center rounded-xl border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${isDark ? 'border-white/20 hover:bg-white/10 text-white' : 'border-black/20 hover:bg-black/10 text-black'}`}
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs font-bold mx-2">
                  {t('settings.page')} {auditPage} / {Math.ceil(auditLogs.length / ITEMS_PER_PAGE)}
                </span>
                <button 
                  onClick={() => setAuditPage(p => Math.min(Math.ceil(auditLogs.length / ITEMS_PER_PAGE), p + 1))}
                  disabled={auditPage >= Math.ceil(auditLogs.length / ITEMS_PER_PAGE)}
                  className={`w-8 h-8 flex items-center justify-center rounded-xl border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${isDark ? 'border-white/20 hover:bg-white/10 text-white' : 'border-black/20 hover:bg-black/10 text-black'}`}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
