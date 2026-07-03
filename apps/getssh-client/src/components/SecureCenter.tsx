import React, { useState, useEffect } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { useTranslation } from 'react-i18next';
import { SecureSidebar } from './secure-center/SecureSidebar';
import { RaspTab } from './secure-center/tabs/RaspTab';
import { PrivacyTab } from './secure-center/tabs/PrivacyTab';
import { SafeStorageTab } from './secure-center/tabs/SafeStorageTab';
import { ExportTab } from './secure-center/tabs/ExportTab';
import { KnownHostsTab } from './secure-center/tabs/KnownHostsTab';
import { ShieldDetailsTab } from './secure-center/tabs/ShieldDetailsTab';
import { useCryptoStore } from '../store/cryptoStore';
import { useSessionStore } from '../store/sessionStore';

export const SecureCenter: React.FC = () => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const watchdogStatus = useAppStore(state => state.watchdogStatus);
  const pollWatchdogStatus = useAppStore(state => state.pollWatchdogStatus);

  const masterPassword = useCryptoStore(state => state.masterPassword);
  const setMasterPassword = useCryptoStore(state => state.setMasterPassword);
  const setEncryptionDisabled = useCryptoStore(state => state.setEncryptionDisabled);
  const sessions = useSessionStore(state => state.sessions);

  const [securePage, setSecurePage] = useState<'rasp' | 'privacy' | 'safestorage' | 'export' | 'known_hosts' | 'shield_details'>('shield_details');

  const [safeAction, setSafeAction] = useState<'none'|'change'|'disable'|'enable'>('none');
  const [safeOldPwd, setSafeOldPwd] = useState('');
  const [safeNewPwd, setSafeNewPwd] = useState('');
  const [safeError, setSafeError] = useState('');

  const [knownHosts, setKnownHosts] = useState<{host: string, port: number, fingerprint: string, trustedAt: number}[]>([]);
  const [revokingHost, setRevokingHost] = useState<string | null>(null);

  useEffect(() => {
    pollWatchdogStatus();
    const interval = setInterval(pollWatchdogStatus, 3000);
    return () => clearInterval(interval);
  }, [pollWatchdogStatus]);

  useEffect(() => {
    if (securePage === 'known_hosts' && window.electronAPI?.getKnownHosts) {
      window.electronAPI.getKnownHosts().then(setKnownHosts);
    }
  }, [securePage]);

  const handleConfirmSafeAction = () => {
    if ((safeAction === 'change' || safeAction === 'disable') && safeOldPwd !== masterPassword) {
      return setSafeError(t('security.errIncorrectPwd'));
    }
    if ((safeAction === 'change' || safeAction === 'enable') && !safeNewPwd) {
      return setSafeError(t('security.errEmptyPwd'));
    }

    if (safeAction === 'change') {
      setMasterPassword(safeNewPwd);
      window.electronAPI.saveProfiles({ masterPassword: safeNewPwd, payload: sessions });
      setTimeout(() => window.alert(t('security.pwdUpdated')), 100);
    } else if (safeAction === 'disable') {
      setEncryptionDisabled(true);
      setMasterPassword('');
      window.electronAPI.saveProfiles({ masterPassword: '', payload: sessions });
      setTimeout(() => window.alert(t('security.pwdDisabled')), 100);
    } else if (safeAction === 'enable') {
      setEncryptionDisabled(false);
      setMasterPassword(safeNewPwd);
      window.electronAPI.saveProfiles({ masterPassword: safeNewPwd, payload: sessions });
      setTimeout(() => window.alert(t('security.pwdEnabled')), 100);
    }

    setSafeAction('none');
  };

  const handleRevokeHost = async (host: string, port: number) => {
    if (!window.electronAPI?.deleteKnownHost) return;
    try {
      await window.electronAPI.deleteKnownHost(host, port);
      setKnownHosts(prev => prev.filter(h => !(h.host === host && h.port === port)));
      setRevokingHost(null);
    } catch (e) {
      console.error(e);
    }
  };

  const isWatchdogDisabled = !!watchdogStatus?.watchdogDisabled;
  const isDanger = !!watchdogStatus && (
    isWatchdogDisabled ||
    (watchdogStatus.status !== 'secure' && (
      watchdogStatus.level === 'red' || 
      (watchdogStatus.status === 'warning' && watchdogStatus.level !== 'yellow')
    ))
  );
  const isWarning = !!watchdogStatus && !isWatchdogDisabled && watchdogStatus.status !== 'secure' && watchdogStatus.level === 'yellow';

  const getAmbientColors = () => {
    if (isDanger) return { bg: isDark ? 'bg-[#110505]/95' : 'bg-red-50/95', top: 'bg-red-600/15', bottom: 'bg-rose-600/15', border: isDark ? 'border-red-500/20' : 'border-red-900/10' };
    if (isWarning) return { bg: isDark ? 'bg-[#111105]/95' : 'bg-yellow-50/95', top: 'bg-yellow-600/15', bottom: 'bg-amber-600/15', border: isDark ? 'border-yellow-500/20' : 'border-yellow-900/10' };
    
    if (isWatchdogDisabled) {
      return { bg: isDark ? 'bg-[#0a0a0a]/95' : 'bg-slate-50/95', top: 'bg-white/5', bottom: 'bg-white/5', border: isDark ? 'border-white/10' : 'border-black/5' };
    }

    return { bg: isDark ? 'bg-[#05110d]/95' : 'bg-emerald-50/95', top: 'bg-emerald-600/10', bottom: 'bg-teal-600/10', border: isDark ? 'border-emerald-500/10' : 'border-emerald-900/10' };
  };
  const ambient = getAmbientColors();

  return (
    <>
      <div className={`w-full h-full flex flex-col overflow-hidden border shadow-2xl rounded-xl relative ${ambient.bg} ${ambient.border} ${isDark ? 'text-white' : 'text-slate-800'} backdrop-blur-3xl transition-colors duration-1000`}>
        
        {/* Ambient Lighting (The Vault) */}
        {isDark && (
          <>
            <div className={`absolute top-[-20%] right-[-10%] w-[70%] h-[70%] ${ambient.top} rounded-full blur-[150px] pointer-events-none mix-blend-screen transition-colors duration-1000`} />
            <div className={`absolute bottom-[-20%] left-[-10%] w-[60%] h-[60%] ${ambient.bottom} rounded-full blur-[150px] pointer-events-none mix-blend-screen transition-colors duration-1000`} />
          </>
        )}

        {/* Content Area - Split Pane */}
        <div className={`flex-1 flex overflow-hidden bg-transparent z-10 relative`}>
          <SecureSidebar 
            securePage={securePage} 
            setSecurePage={setSecurePage as any} 
            setSafeAction={setSafeAction as any} 
          />

          {/* Right Payload Area */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden relative">
            <div className={`w-full p-4 flex items-center gap-3 border-b ${
              isDanger ? 'bg-red-500/20 border-red-500/30' : 
              isWarning ? 'bg-yellow-500/20 border-yellow-500/30' : 
              isWatchdogDisabled ? 'bg-slate-500/20 border-slate-500/30' :
              'bg-green-500/20 border-green-500/30'
            }`}>
              <ShieldAlert className={`w-6 h-6 shrink-0 ${
                isDanger ? 'text-red-500 animate-bounce' : 
                isWarning ? 'text-yellow-500 animate-pulse' : 
                isWatchdogDisabled ? 'text-slate-500' :
                'text-green-500 animate-[pulse_3s_ease-in-out_infinite]'
              }`} />
              <div className="flex flex-col">
                <span className={`text-sm font-bold tracking-wide uppercase ${
                  isDanger ? 'text-red-500' : 
                  isWarning ? 'text-yellow-500' : 
                  isWatchdogDisabled ? 'text-slate-500' :
                  'text-green-500'
                }`}>
                  {isDanger ? t('security.pollutedTitle', '⚠️ 当前系统已被污染 (高危)') : 
                   isWarning ? '⚠️ 插件高危操作已阻断 (警告)' :
                   isWatchdogDisabled ? 'WATCHDOG DISABLED' :
                   '系统安全'}
                </span>
                <span className={`text-xs font-medium ${
                  isDanger ? 'text-red-500/80' : 
                  isWarning ? 'text-yellow-500/80' : 
                  isWatchdogDisabled ? 'text-slate-500/80' :
                  'text-green-500/80'
                }`}>
                  {isDanger ? t('security.pollutedDesc', '系统已被污染，部分安全措施失效。请立即检查并清理异常进程。') : 
                   isWarning ? '系统拦截了部分插件的高危操作请求，但核心运行状态正常。' :
                   isWatchdogDisabled ? '安全守护进程已禁用。' :
                   '系统安全，所有防御模块正常运行'}
                </span>
              </div>
            </div>

            <div className="max-w-3xl mx-auto p-12 pb-24 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {securePage === 'rasp' && <RaspTab />}
              {securePage === 'privacy' && <PrivacyTab />}
              {securePage === 'safestorage' && (
                <SafeStorageTab 
                  safeAction={safeAction}
                  setSafeAction={setSafeAction}
                  safeOldPwd={safeOldPwd as any}
                  setSafeOldPwd={setSafeOldPwd}
                  safeNewPwd={safeNewPwd as any}
                  setSafeNewPwd={setSafeNewPwd}
                  safeError={safeError}
                  setSafeError={setSafeError}
                  handleConfirmSafeAction={handleConfirmSafeAction}
                />
              )}
              {securePage === 'export' && <ExportTab />}
              {securePage === 'known_hosts' && (
                <KnownHostsTab 
                  knownHosts={knownHosts}
                  revokingHost={revokingHost}
                  setRevokingHost={setRevokingHost}
                  handleRevokeHost={handleRevokeHost}
                />
              )}
              {securePage === 'shield_details' && <ShieldDetailsTab setSecurePage={setSecurePage as any} />}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
