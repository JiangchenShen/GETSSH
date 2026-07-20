import React, { useState, useEffect } from 'react';
import { Database, HardDrive, RefreshCw, AlertTriangle, FileText, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../../store/appStore';
import { useWorkspaceStore } from '../../../store/workspaceStore';

export const StorageAuditTab: React.FC = () => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  
  const [stats, setStats] = useState<{size: number, profileCount: number, runbookCount: number} | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStatsAndLogs = async () => {
    if (!activeWorkspaceId) return;
    setLoading(true);
    try {
      const statsRes = await window.electronAPI.getWorkspaceStats(activeWorkspaceId);
      if (statsRes && statsRes.success && statsRes.stats) {
        setStats(statsRes.stats);
      }
      
      const logsRes = await window.electronAPI.getWorkspaceAuditLogs(activeWorkspaceId);
      if (logsRes && logsRes.success && logsRes.logs) {
        setLogs(logsRes.logs);
      }
    } catch (e) {
      console.error('Failed to fetch storage & audit data', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatsAndLogs();
  }, [activeWorkspaceId]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <h4 className="text-4xl font-black tracking-tight flex items-center gap-4 text-white">
          <Database className="w-10 h-10 text-pink-500"/> 
          {t("workspaceCenter.sidebar.storageAudit", "Storage & Audit")}
        </h4>
        <button 
          onClick={fetchStatsAndLogs}
          disabled={loading}
          className={`p-3 rounded-xl transition-all ${loading ? 'animate-spin opacity-50' : isDark ? 'bg-white/5 hover:bg-white/10 text-white' : 'bg-black/5 hover:bg-black/10 text-black'}`}
        >
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Storage Size Card */}
        <div className="relative overflow-hidden p-6 bg-black/40 border border-pink-500/20 flex flex-col gap-2 rounded-[24px] shadow-lg backdrop-blur-xl group">
          <div className="absolute inset-0 bg-gradient-to-br from-pink-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
          <div className="flex items-center gap-3 opacity-60 mb-2 text-xs font-black uppercase tracking-widest text-pink-500">
            <HardDrive className="w-4 h-4"/> {t("workspaceCenter.dbSizeTitle", "Database Size")}
          </div>
          {loading ? (
            <div className="h-10 w-24 bg-white/10 animate-pulse rounded-lg" />
          ) : (
            <div className="text-4xl font-black text-white">{stats?.size || 0} <span className="text-xl opacity-50">MB</span></div>
          )}
          <p className="text-xs opacity-40 font-medium">{t("workspaceCenter.dbSizeDesc", "Physical SQLite file size on disk")}</p>
        </div>

        {/* Profiles Card */}
        <div className="relative overflow-hidden p-6 bg-black/40 border border-pink-500/20 flex flex-col gap-2 rounded-[24px] shadow-lg backdrop-blur-xl group">
          <div className="absolute inset-0 bg-gradient-to-br from-pink-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
          <div className="flex items-center gap-3 opacity-60 mb-2 text-xs font-black uppercase tracking-widest text-pink-500">
            <FileText className="w-4 h-4"/> {t("workspaceCenter.savedProfilesTitle", "Saved Profiles")}
          </div>
          {loading ? (
            <div className="h-10 w-16 bg-white/10 animate-pulse rounded-lg" />
          ) : (
            <div className="text-4xl font-black text-white">{stats?.profileCount || 0}</div>
          )}
          <p className="text-xs opacity-40 font-medium">{t("workspaceCenter.savedProfilesDesc", "Encrypted connection profiles")}</p>
        </div>

        {/* Runbooks Card */}
        <div className="relative overflow-hidden p-6 bg-black/40 border border-pink-500/20 flex flex-col gap-2 rounded-[24px] shadow-lg backdrop-blur-xl group">
          <div className="absolute inset-0 bg-gradient-to-br from-pink-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
          <div className="flex items-center gap-3 opacity-60 mb-2 text-xs font-black uppercase tracking-widest text-pink-500">
            <FileText className="w-4 h-4"/> {t("workspaceCenter.runbooksTitle", "Runbooks")}
          </div>
          {loading ? (
            <div className="h-10 w-16 bg-white/10 animate-pulse rounded-lg" />
          ) : (
            <div className="text-4xl font-black text-white">{stats?.runbookCount || 0}</div>
          )}
          <p className="text-xs opacity-40 font-medium">{t("workspaceCenter.runbooksDesc", "Automated scripts and tasks")}</p>
        </div>

      </div>

      <div className="relative overflow-hidden p-8 bg-black/40 border border-pink-500/20 flex flex-col gap-6 rounded-[32px] shadow-2xl backdrop-blur-xl">
        <div className="absolute inset-0 bg-gradient-to-br from-pink-500/5 to-transparent opacity-50 pointer-events-none" />
        
        <h5 className="relative z-10 flex items-center gap-3 text-sm font-black uppercase tracking-widest text-white/80">
          <AlertTriangle className="w-5 h-5 text-pink-500"/> {t("workspaceCenter.recentAuditLogTitle", "Recent Audit Log")}
        </h5>

        <div className="space-y-4 relative z-10 max-h-80 overflow-y-auto pr-2 custom-scrollbar">
          {logs.length === 0 && !loading && (
             <div className="text-xs text-white/40 uppercase tracking-widest font-bold">{t("workspaceCenter.noAuditLogs", "No audit logs found for this workspace.")}</div>
          )}
          {logs.map((log) => {
             const isError = log.action.toLowerCase().includes('fail') || log.action.toLowerCase().includes('error');
             return (
               <div key={log.id} className={`p-4 rounded-xl border ${isError ? 'border-red-500/20 bg-red-500/10' : isDark ? 'bg-white/5 border-white/5' : 'bg-black/5 border-black/5'} flex justify-between items-center`}>
                 <div>
                   <div className={`text-sm font-bold ${isError ? 'text-red-400' : 'text-white'}`}>{log.action}: {log.target}</div>
                   <div className={`text-xs font-mono mt-1 ${isError ? 'text-red-400/50' : 'opacity-50'}`}>{log.details}</div>
                 </div>
                 <div className={`text-[10px] uppercase font-bold tracking-widest ${isError ? 'text-red-500 opacity-60' : 'opacity-40'}`}>
                   {new Date(log.created_at).toLocaleString()}
                 </div>
               </div>
             );
          })}
        </div>

        <div className="flex justify-center pt-4 relative z-10">
          <button className="text-xs font-bold uppercase tracking-widest flex items-center gap-2 opacity-50 hover:opacity-100 transition-opacity text-pink-500">
            <Download className="w-4 h-4"/> {t("workspaceCenter.exportAuditLog", "Export Full Audit Log (CSV)")}
          </button>
        </div>

      </div>
    </div>
  );
};
