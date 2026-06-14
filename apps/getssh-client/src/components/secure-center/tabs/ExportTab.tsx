import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileJson, Download, Upload, Shield } from 'lucide-react';
import { useAppStore } from '../../../store/appStore';
import { useCryptoStore } from '../../../store/cryptoStore';
import { useSessionStore } from '../../../store/sessionStore';

export const ExportTab: React.FC = () => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const masterPassword = useCryptoStore(state => state.masterPassword);
  const sessions = useSessionStore(state => state.sessions);
  const setSessions = useSessionStore(state => state.setSessions);

  const [profilesStatus, setProfilesStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [importPwdModal, setImportPwdModal] = useState(false);
  const [importPwd, setImportPwd] = useState('');

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
            
            <div className="flex gap-6">
              <button 
                onClick={() => {
                  const data = JSON.stringify(sessions, null, 2);
                  const blob = new Blob([data], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `getssh-profiles-${new Date().toISOString().slice(0,10)}.json`;
                  a.click();
                  setProfilesStatus({ type: 'success', msg: t('settings.exportSuccess') });
                  setTimeout(() => setProfilesStatus(null), 3000);
                }}
                disabled={!masterPassword || sessions.length === 0}
                title={!masterPassword ? (t('settings.exportTooltipDisabled') as string) : (t('settings.exportTooltipEnabled') as string)}
                className={`py-4 px-6 text-sm font-black tracking-widest uppercase border transition-all flex items-center justify-center gap-3 rounded-xl flex-1 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed ${isDark ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500 hover:text-emerald-950' : 'border-emerald-500/30 text-emerald-600 bg-emerald-50 hover:bg-emerald-500 hover:text-white'}`}
              >
                <Download className="w-5 h-5" /> {t('settings.exportBtn')}
              </button>

              <button
                onClick={() => {
                  setProfilesStatus(null);
                  setImportPwd('');
                  setImportPwdModal(true);
                }}
                className={`py-4 px-6 text-sm font-black tracking-widest uppercase border transition-all flex items-center justify-center gap-3 rounded-xl flex-1 shadow-sm ${isDark ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500 hover:text-emerald-950' : 'border-emerald-500/30 text-emerald-600 bg-emerald-50 hover:bg-emerald-500 hover:text-white'}`}
              >
                <Upload className="w-5 h-5" /> {t('settings.importBtn')}
              </button>
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
  
                    if (res.profiles && res.profiles.length > 0) {
                      // Merge: avoid exact duplicates (same host + username)
                      const existing = new Set<string>();
                      for (const s of sessions) {
                        existing.add(`${s.host}::${s.username}`);
                      }
                      const newOnes  = res.profiles.filter((p: any) => !existing.has(`${p.host}::${p.username}`));
                      const merged   = [...sessions, ...newOnes];
                      setSessions(merged);
                      // Persist to disk
                      if (window.electronAPI.saveProfiles) {
                        await window.electronAPI.saveProfiles({ masterPassword, payload: merged });
                      }
                      setProfilesStatus({
                        type: 'success',
                        msg: t('settings.importSuccessNew', { count: newOnes.length, skipped: res.profiles.length - newOnes.length }) as string,
                      });
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
    </>
  );
};
