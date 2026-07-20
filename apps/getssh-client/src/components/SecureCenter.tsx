import React, { useState, useEffect } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { useTranslation } from 'react-i18next';
import { SecureSidebar } from './secure-center/SecureSidebar';
import { RaspTab } from './secure-center/tabs/RaspTab';
import { PrivacyTab } from './secure-center/tabs/PrivacyTab';
import { KnownHostsTab } from './secure-center/tabs/KnownHostsTab';
import { ShieldDetailsTab } from './secure-center/tabs/ShieldDetailsTab';
import { SafeStorageTab } from './secure-center/tabs/SafeStorageTab';
import { IsolationRulesTab } from './secure-center/tabs/IsolationRulesTab';
import { useCryptoStore } from '../store/cryptoStore';
import { useSessionStore } from '../store/sessionStore';
import { useWorkspaceStore } from '../store/workspaceStore';

export const SecureCenter: React.FC = () => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const watchdogStatus = useAppStore(state => state.watchdogStatus);
  const pollWatchdogStatus = useAppStore(state => state.pollWatchdogStatus);

  const masterPassword = useCryptoStore(state => state.masterPassword);
  const setMasterPassword = useCryptoStore(state => state.setMasterPassword);
  const setEncryptionDisabled = useCryptoStore(state => state.setEncryptionDisabled);
  const sessions = useSessionStore(state => state.sessions);

  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const workspaces = useWorkspaceStore(state => state.workspaces);
  const activeWs = workspaces.find(w => w.id === activeWorkspaceId);

  const [securePage, setSecurePage] = useState<'rasp' | 'privacy' | 'safe_storage' | 'known_hosts' | 'shield_details' | 'isolation_rules'>('shield_details');
  const [safeAction, setSafeAction] = useState<'none' | 'change' | 'disable' | 'enable'>('none');
  const [safeOldPwd, setSafeOldPwd] = useState('');
  const [safeNewPwd, setSafeNewPwd] = useState('');
  const [safeError, setSafeError] = useState('');

  const handleConfirmSafeAction = async () => {
    if (safeAction === 'change' && safeOldPwd !== masterPassword) {
      return setSafeError(t('security.errWrongOldPwd'));
    }
    if ((safeAction === 'change' || safeAction === 'enable') && !safeNewPwd) {
      return setSafeError(t('security.errEmptyPwd'));
    }
    if ((safeAction === 'change' || safeAction === 'enable') && safeNewPwd.length < 8) {
      return setSafeError(t('crypto.passwordTooShort', 'Password too short (min 8 chars)'));
    }

    if (safeAction === 'change') {
      setMasterPassword(safeNewPwd);
      if (window.electronAPI) {
        await window.electronAPI.saveProfiles({ masterPassword: safeNewPwd, payload: sessions });
      }
      await useWorkspaceStore.getState().initWorkspaces();
      setTimeout(() => window.alert(t('security.pwdUpdated')), 100);
    } else if (safeAction === 'disable') {
      setEncryptionDisabled(true);
      setMasterPassword('');
      if (window.electronAPI) {
        await window.electronAPI.saveProfiles({ masterPassword: '', payload: sessions });
      }
      await useWorkspaceStore.getState().initWorkspaces();
      setTimeout(() => window.alert(t('security.pwdDisabled')), 100);
    } else if (safeAction === 'enable') {
      setEncryptionDisabled(false);
      setMasterPassword(safeNewPwd);
      if (window.electronAPI) {
        await window.electronAPI.saveProfiles({ masterPassword: safeNewPwd, payload: sessions });
      }
      await useWorkspaceStore.getState().initWorkspaces();
      setTimeout(() => window.alert(t('security.pwdEnabled')), 100);
    }

    setSafeAction('none');
  };

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

  const getThemeClass = () => {
    if (isDanger) return { bg: 'bg-transparent', top: 'bg-red-600/15', bottom: 'bg-rose-600/15', border: isDark ? 'border-red-500/20' : 'border-red-900/10' };
    if (isWarning) return { bg: 'bg-transparent', top: 'bg-yellow-600/15', bottom: 'bg-amber-600/15', border: isDark ? 'border-yellow-500/20' : 'border-yellow-900/10' };
    
    if (securePage === 'isolation_rules' || securePage === 'safe_storage') {
      return { bg: 'bg-transparent', top: 'bg-white/5', bottom: 'bg-white/5', border: isDark ? 'border-white/10' : 'border-black/5' };
    }
    
    return { bg: 'bg-transparent', top: 'bg-emerald-600/10', bottom: 'bg-teal-600/10', border: isDark ? 'border-emerald-500/10' : 'border-emerald-900/10' };
  };
  const ambient = getThemeClass();

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
              {securePage === 'safe_storage' && (
                <SafeStorageTab
                  safeAction={safeAction as any}
                  setSafeAction={setSafeAction as any}
                  safeOldPwd={safeOldPwd as any}
                  setSafeOldPwd={setSafeOldPwd}
                  safeNewPwd={safeNewPwd as any}
                  setSafeNewPwd={setSafeNewPwd}
                  safeError={safeError}
                  setSafeError={setSafeError}
                  handleConfirmSafeAction={handleConfirmSafeAction}
                  biometricEnabled={activeWs?.biometricEnabled}
                  onToggleBiometric={async (enabled) => {
                    if (!activeWorkspaceId || !window.electronAPI?.toggleWorkspaceBiometric) return;
                    await window.electronAPI.toggleWorkspaceBiometric(activeWorkspaceId, enabled);
                    await useWorkspaceStore.getState().initWorkspaces();
                  }}
                />
              )}
              {securePage === 'known_hosts' && (
                <KnownHostsTab 
                  knownHosts={knownHosts}
                  revokingHost={revokingHost}
                  setRevokingHost={setRevokingHost}
                  handleRevokeHost={handleRevokeHost}
                />
              )}
              {securePage === 'isolation_rules' && <IsolationRulesTab />}
              {securePage === 'shield_details' && <ShieldDetailsTab setSecurePage={setSecurePage as any} />}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
