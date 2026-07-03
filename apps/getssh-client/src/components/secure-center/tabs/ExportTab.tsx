import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileJson, Upload, Shield, Database } from 'lucide-react';
import { useAppStore } from '../../../store/appStore';

export const ExportTab: React.FC = () => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);

  const [profilesStatus, setProfilesStatus] = useState<{ type: 'success' | 'error' | 'loading'; msg: string } | null>(null);
  const [importPwdModal, setImportPwdModal] = useState(false);
  const [importPwd, setImportPwd] = useState('');
  const [dbImportConfirmModal, setDbImportConfirmModal] = useState(false);
  const [pendingDbImportPath, setPendingDbImportPath] = useState<string | null>(null);

  return (
    <>
      <div className="space-y-8">
        <h4 className="text-4xl font-black tracking-tight flex items-center gap-4 text-white"><FileJson className="w-10 h-10 text-emerald-500"/> {t("security.exportTitle")}</h4>
        
        <div className="relative overflow-hidden p-8 bg-black/40 border border-emerald-500/20 flex flex-col gap-6 rounded-[32px] shadow-2xl backdrop-blur-xl">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-50 pointer-events-none" />
          
          <div className="relative z-10">
            <p className="text-sm text-white/50 leading-relaxed font-bold tracking-wide mb-8">
              {t('settings.exportProfilesDesc')}
            </p>

            {profilesStatus && (
              <div className={`mb-8 px-5 py-4 text-xs font-black uppercase tracking-widest shadow-sm rounded-xl ${
                profilesStatus.type === 'success'
                  ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/20'
                  : 'bg-red-500/15 text-red-500 border border-red-500/20'
              }`}>
                {profilesStatus.msg}
              </div>
            )}
            
            <div className="flex flex-col gap-4">
              <div className="flex gap-4">
                <button 
                  onClick={async () => {
                    if (window.electronAPI && window.electronAPI.exportDatabase) {
                      const res = await window.electronAPI.exportDatabase();
                      if (res.success) {
                        setProfilesStatus({ type: 'success', msg: `Database backup saved: ${res.path}` });
                      } else if (res.error !== 'canceled') {
                        setProfilesStatus({ type: 'error', msg: `Backup failed: ${res.error}` });
                      }
                      setTimeout(() => setProfilesStatus(null), 3000);
                    }
                  }}
                  className={`py-4 px-6 text-sm font-black tracking-widest uppercase border transition-all flex items-center justify-center gap-3 rounded-xl flex-1 shadow-sm ${isDark ? 'border-purple-500/30 text-purple-400 bg-purple-500/10 hover:bg-purple-500 hover:text-purple-950' : 'border-purple-500/30 text-purple-600 bg-purple-50 hover:bg-purple-500 hover:text-white'}`}
                >
                  <Database className="w-5 h-5" /> {t('settings.exportDb')}
                </button>
                <button 
                  onClick={async () => {
                    if (window.electronAPI?.exportProfiles) {
                      const res = await window.electronAPI.exportProfiles();
                      if (res.success) {
                        setProfilesStatus({ type: 'success', msg: `Sanitized JSON Template exported (${res.count} profiles).` });
                      } else if (res.reason !== 'canceled') {
                        setProfilesStatus({ type: 'error', msg: `Export failed: ${res.reason}` });
                      }
                      setTimeout(() => setProfilesStatus(null), 3000);
                    }
                  }}
                  className={`py-4 px-6 text-sm font-black tracking-widest uppercase border transition-all flex items-center justify-center gap-3 rounded-xl flex-1 shadow-sm ${isDark ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500 hover:text-emerald-950' : 'border-emerald-500/30 text-emerald-600 bg-emerald-50 hover:bg-emerald-500 hover:text-white'}`}
                >
                  <FileJson className="w-5 h-5" /> {t('settings.exportJson')}
                </button>
              </div>

              <div className="flex gap-4">
                <button
                  onClick={async () => {
                    if (window.electronAPI?.importDatabase) {
                      const res = await window.electronAPI.importDatabase();
                      if (res.requiresConfirmation && res.sourcePath) {
                        setPendingDbImportPath(res.sourcePath);
                        setDbImportConfirmModal(true);
                      } else if (!res.success && res.error !== 'canceled') {
                        setProfilesStatus({ type: 'error', msg: `Import failed: ${res.error}` });
                        setTimeout(() => setProfilesStatus(null), 3000);
                      } else if (res.success && res.merged) {
                        setProfilesStatus({ type: 'success', msg: 'Database merged successfully.' });
                        setTimeout(() => setProfilesStatus(null), 3000);
                      }
                    }
                  }}
                  className={`py-4 px-6 text-sm font-black tracking-widest uppercase border transition-all flex items-center justify-center gap-3 rounded-xl flex-1 shadow-sm ${isDark ? 'border-red-500/30 text-red-400 bg-red-500/10 hover:bg-red-500 hover:text-red-950' : 'border-red-500/30 text-red-600 bg-red-50 hover:bg-red-500 hover:text-white'}`}
                >
                  <Database className="w-5 h-5" /> {t('settings.importDb')}
                </button>
                <button
                  onClick={() => {
                    setProfilesStatus(null);
                    setImportPwd('');
                    setImportPwdModal(true);
                  }}
                  className={`py-4 px-6 text-sm font-black tracking-widest uppercase border transition-all flex items-center justify-center gap-3 rounded-xl flex-1 shadow-sm ${isDark ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500 hover:text-emerald-950' : 'border-emerald-500/30 text-emerald-600 bg-emerald-50 hover:bg-emerald-500 hover:text-white'}`}
                >
                  <Upload className="w-5 h-5" /> {t('settings.importJson')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {importPwdModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className={`w-[22rem] p-6 rounded-2xl shadow-2xl border space-y-4 ${isDark ? 'bg-[#1e1e1e] border-white/10 text-white' : 'bg-white border-black/10 text-black'}`}>
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-emerald-500" />
              <h3 className="text-sm font-bold">{t('settings.importTitle')}</h3>
            </div>
            <p className="text-xs opacity-60 leading-relaxed font-medium">
              {t('settings.importHint')}
            </p>
            <input
              autoFocus
              type="password"
              placeholder={t('settings.importPwdPlaceholder') as string}
              value={importPwd}
              onChange={(e) => setImportPwd(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.closest('div')?.querySelector<HTMLButtonElement>('[data-confirm]')?.click()}
              className={`w-full p-2.5 border rounded-xl text-sm font-medium outline-none transition-all focus:border-emerald-500/50 shadow-inner ${isDark ? 'bg-black/50 border-white/10 focus:bg-black/80' : 'bg-gray-50 border-black/10 focus:bg-white'}`}
            />
            <div className="flex gap-3 pt-2 mt-2 border-t border-white/5">
              <button
                onClick={() => { setImportPwdModal(false); setImportPwd(''); }}
                className={`flex-1 py-2 text-sm font-bold rounded-xl border transition-all ${isDark ? 'border-white/20 hover:bg-white/10' : 'border-black/20 hover:bg-black/5'}`}
              >
                {t('settings.importCancel')}
              </button>
              <button
                data-confirm
                onClick={async () => {
                  setImportPwdModal(false);
                  if (window.electronAPI && window.electronAPI.importProfiles) {
                    const res = await window.electronAPI.importProfiles({ masterPassword: importPwd });
  
                    if (!res.success) {
                      const msgs: Record<string, string> = {
                        canceled:         t('settings.importCanceled') as string,
                        invalid_format:   t('settings.importInvalidFormat') as string,
                        password_required:t('settings.importPwdRequired') as string,
                        wrong_password:   t('settings.importWrongPwd') as string,
                      };
                      setProfilesStatus({ type: 'error', msg: `❌ ${msgs[res.reason ?? ''] ?? res.reason}` });
                      return;
                    }
  
                    if (res.count && res.count > 0) {
                      setProfilesStatus({
                        type: 'success',
                        msg: t('settings.importSuccessNew', { count: res.count, skipped: 0 }) as string,
                      });
                      // Tell user to reload or switch workspace
                      setTimeout(() => {
                        window.location.reload();
                      }, 2000);
                    } else {
                      setProfilesStatus({ type: 'success', msg: t('settings.importSuccessEmpty') as string });
                    }
                  }
                  setImportPwd('');
                }}
                className="flex-1 py-2 text-sm font-bold rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white transition-all shadow-md"
              >
                {t('settings.importConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {dbImportConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className={`w-[26rem] p-6 rounded-2xl shadow-2xl border space-y-4 ${isDark ? 'bg-[#1e1e1e] border-white/10 text-white' : 'bg-white border-black/10 text-black'}`}>
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-yellow-500" />
              <h3 className="text-sm font-bold">{t('settings.importStrategyTitle')}</h3>
            </div>
            <p className="text-xs opacity-80 leading-relaxed font-medium">
              {t('settings.importStrategyDesc')}
            </p>
            <div className="flex gap-3 pt-2 mt-2 border-t border-white/5">
              <button
                onClick={() => {
                  setDbImportConfirmModal(false);
                  setPendingDbImportPath(null);
                }}
                className="flex-1 py-2 rounded-xl text-xs font-bold border transition-colors opacity-70 hover:opacity-100 uppercase tracking-wider"
              >
                {t('settings.importStrategyCancel')}
              </button>
              <button
                onClick={async () => {
                  if (pendingDbImportPath && window.electronAPI?.confirmImportDatabase) {
                    setDbImportConfirmModal(false);
                    const res = await window.electronAPI.confirmImportDatabase(pendingDbImportPath, 'merge');
                    if (res.success) {
                      setProfilesStatus({ type: 'success', msg: 'Merge completed successfully.' });
                      setTimeout(() => setProfilesStatus(null), 3000);
                    } else {
                      setProfilesStatus({ type: 'error', msg: `Merge failed: ${res.error}` });
                      setTimeout(() => setProfilesStatus(null), 3000);
                    }
                  }
                }}
                className="flex-1 py-2 rounded-xl text-xs font-bold transition-colors uppercase tracking-wider border border-emerald-500/30 text-emerald-500 bg-emerald-500/10 hover:bg-emerald-500 hover:text-white"
              >
                {t('settings.importStrategyMergeOnly')}
              </button>
              <button
                onClick={async () => {
                  if (pendingDbImportPath && window.electronAPI?.confirmImportDatabase) {
                    setDbImportConfirmModal(false);
                    await window.electronAPI.confirmImportDatabase(pendingDbImportPath, 'overwrite');
                  }
                }}
                className="flex-1 py-2 rounded-xl text-xs font-bold transition-colors uppercase tracking-wider border border-red-500/30 text-red-500 bg-red-500/10 hover:bg-red-500 hover:text-white"
              >
                {t('settings.importStrategyOverwriteAll')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
