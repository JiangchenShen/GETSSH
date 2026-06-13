import React, { useState, useEffect } from 'react';
import { Shield, ShieldAlert, X, Activity, Lock, Cpu, EyeOff, FileJson, Server, ArrowLeft, Trash2, Download } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { useSessionStore } from '../store/sessionStore';
import { useTranslation } from 'react-i18next';

export interface SecureCenterProps {
  masterPassword?: string;
  setMasterPassword?: (pwd: string) => void;
  encryptionDisabled?: boolean;
  setEncryptionDisabled?: (disabled: boolean) => void;
}

export const SecureCenter: React.FC<SecureCenterProps> = ({
  masterPassword = '',
  setMasterPassword = () => {},
  encryptionDisabled = false,
  setEncryptionDisabled = () => {}
}) => {
  const { t } = useTranslation();
  const setIsSecureCenterOpen = useAppStore(state => state.setIsSecureCenterOpen);
  const isDark = useAppStore(state => state.isDark);
  const watchdogStatus = useAppStore(state => state.watchdogStatus);
  const pollWatchdogStatus = useAppStore(state => state.pollWatchdogStatus);
  const isPolluted = useAppStore(state => state.isPolluted);
  const appConfig = useAppStore(state => state.appConfig);
  const updateConfig = useAppStore(state => state.updateConfig);
  
  const sessions = useSessionStore(state => state.sessions);

  const [securePage, setSecurePage] = useState<'dashboard' | 'rasp' | 'privacy' | 'safestorage' | 'export' | 'known_hosts' | 'shield_details'>('dashboard');

  const [safeAction, setSafeAction] = useState<'none'|'change'|'disable'|'enable'>('none');
  const [safeOldPwd, setSafeOldPwd] = useState('');
  const [safeNewPwd, setSafeNewPwd] = useState('');
  const [safeError, setSafeError] = useState('');

  const [knownHosts, setKnownHosts] = useState<{host: string, port: number, fingerprint: string, trustedAt: number}[]>([]);
  const [revokingHost, setRevokingHost] = useState<string | null>(null);

  const [profilesStatus, setProfilesStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

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

  return (
    <div className={`fixed inset-0 z-[99999] flex flex-col items-center justify-center backdrop-blur-2xl transition-all animate-in fade-in duration-300 ${isDark ? 'bg-black/90 text-white' : 'bg-zinc-100/90 text-black'}`}>
      <div className={`relative w-[90vw] h-[90vh] max-w-[1200px] flex flex-col overflow-hidden border shadow-2xl rounded-none ${isDark ? 'bg-[#0A0A0A]/95 border-white/10' : 'bg-white/95 border-black/10'} backdrop-blur-3xl`}>
        
        {/* Header */}
        <div className={`shrink-0 flex items-center justify-between p-8 border-b ${isDark ? 'border-white/5 bg-white/5' : 'border-black/5 bg-black/5'}`} style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <h2 className="text-3xl font-black flex items-center gap-4 uppercase tracking-widest">
            <Shield className="w-8 h-8 text-red-500" />
            SECURE CENTER
          </h2>
          <button 
            onClick={() => setIsSecureCenterOpen(false)}
            className={`p-3 transition-colors rounded-none ${isDark ? 'hover:bg-white/10 text-white' : 'hover:bg-black/10 text-black'}`}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto flex justify-center p-8">
          <div className="w-full max-w-4xl flex flex-col gap-6">
            {securePage === 'dashboard' ? (
              <>
                {isPolluted && (
                  <div className={`w-full mb-2 p-4 flex items-center gap-3 border rounded-none ${
                    watchdogStatus?.level === 'red' ? 'bg-red-500/10 border-red-500/20' : 'bg-yellow-500/10 border-yellow-500/20'
                  }`}>
                    <ShieldAlert className={`w-6 h-6 animate-pulse shrink-0 ${
                      watchdogStatus?.level === 'red' ? 'text-red-500' : 'text-yellow-500'
                    }`} />
                    <div className="flex flex-col">
                      <span className={`text-sm font-bold tracking-wide uppercase ${
                        watchdogStatus?.level === 'red' ? 'text-red-500' : 'text-yellow-500'
                      }`}>
                        {watchdogStatus?.level === 'red' ? t('security.pollutedTitle', 'System Polluted') : 'Operation Blocked'}
                      </span>
                      <span className={`text-xs font-medium ${
                        watchdogStatus?.level === 'red' ? 'text-red-500/80' : 'text-yellow-500/80'
                      }`}>
                        {watchdogStatus?.level === 'red' 
                          ? t('security.pollutedDesc', '系统已被污染，部分安全措施已经失效。请立即检查并清理异常进程。')
                          : '系统拦截了部分插件的高危操作请求，但核心运行状态正常。'}
                      </span>
                    </div>
                  </div>
                )}
                
                {/* Hero Shield Section */}
                <button onClick={() => setSecurePage('shield_details')} className={`w-full p-8 flex flex-col items-center justify-center gap-4 transition-all shadow-inner group cursor-pointer border rounded-none ${
                  !watchdogStatus ? (isDark ? 'bg-white/5 border-transparent hover:bg-white/10 hover:border-white/20' : 'bg-black/5 border-transparent hover:bg-black/10 hover:border-black/20') :
                  watchdogStatus.watchdogDisabled ? (watchdogStatus.level === 'yellow' ? 'bg-yellow-500/10 border-yellow-500/30 hover:bg-yellow-500/20 hover:border-yellow-500/50' : 'bg-red-500/10 border-red-500/30 hover:bg-red-500/20 hover:border-red-500/50') :
                  watchdogStatus.status === 'secure' ? 'bg-green-500/10 border-transparent hover:bg-green-500/20 hover:border-green-500/30' : 
                  (watchdogStatus.level === 'yellow' ? 'bg-yellow-500/10 border-transparent hover:bg-yellow-500/20 hover:border-yellow-500/30' : 'bg-red-500/10 border-transparent hover:bg-red-500/20 hover:border-red-500/30')
                }`}>
                  {watchdogStatus?.watchdogDisabled ? (
                    <ShieldAlert className={`w-32 h-32 group-hover:scale-105 transition-transform ${
                      watchdogStatus.level === 'yellow' ? 'text-yellow-500 drop-shadow-[0_0_20px_rgba(234,179,8,0.6)]' : 'text-red-500 drop-shadow-[0_0_20px_rgba(239,68,68,0.6)]'
                    }`} />
                  ) : watchdogStatus?.status === 'secure' ? (
                    <Shield className="w-32 h-32 text-green-500 drop-shadow-[0_0_20px_rgba(34,197,94,0.6)] animate-pulse group-hover:scale-105 transition-transform" />
                  ) : watchdogStatus?.status === 'warning' ? (
                    <ShieldAlert className={`w-32 h-32 group-hover:scale-105 transition-transform ${
                      watchdogStatus.level === 'yellow' ? 'text-yellow-500 drop-shadow-[0_0_20px_rgba(234,179,8,0.6)] animate-pulse' : 'text-red-500 drop-shadow-[0_0_20px_rgba(239,68,68,0.6)] animate-bounce'
                    }`} />
                  ) : (
                    <Shield className="w-32 h-32 opacity-20 animate-pulse group-hover:scale-105 transition-transform" />
                  )}
                  <div className="text-center mt-2">
                    <h3 className="text-2xl font-black tracking-tight mb-2">
                      {!watchdogStatus ? t("security.watchdogConnecting") : 
                       watchdogStatus.watchdogDisabled 
                         ? (watchdogStatus.level === 'red' ? t("security.pollutedDesc", "系统已被污染，部分安全措施已经失效。请立即检查并清理异常进程。") : '系统处于带警告的运行状态')
                         : watchdogStatus.status === 'secure' ? t("security.watchdogSecure") : 
                       t("security.watchdogWarning")}
                    </h3>
                    <p className="text-xs opacity-50 font-bold uppercase tracking-widest">{t("security.shieldClickToDetails", "Click to view protection details")}</p>
                  </div>
                </button>

                {/* Matrix Cards */}
                <div className="grid grid-cols-2 gap-4 mt-2">
                  <button onClick={() => setSecurePage('rasp')} className={`p-6 border text-left transition-all group rounded-none ${isDark ? 'border-white/10 hover:bg-white/5' : 'border-black/10 hover:bg-black/5 hover:border-black/20'}`}>
                    <div className="flex items-center gap-3 mb-3"><Cpu className="w-6 h-6 text-red-500 drop-shadow-md" /><span className="font-bold text-lg">{t("security.raspTitle")}</span></div>
                    <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.raspDesc")}</p>
                  </button>
                  <button onClick={() => setSecurePage('privacy')} className={`p-6 border text-left transition-all group rounded-none ${isDark ? 'border-white/10 hover:bg-white/5' : 'border-black/10 hover:bg-black/5 hover:border-black/20'}`}>
                    <div className="flex items-center gap-3 mb-3"><EyeOff className="w-6 h-6 text-blue-500 drop-shadow-md" /><span className="font-bold text-lg">{t("security.privacyTitle")}</span></div>
                    <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.privacyDesc")}</p>
                  </button>
                  <button onClick={() => { setSafeAction('none'); setSecurePage('safestorage'); }} className={`p-6 border text-left transition-all group rounded-none ${isDark ? 'border-white/10 hover:bg-white/5' : 'border-black/10 hover:bg-black/5 hover:border-black/20'}`}>
                    <div className="flex items-center gap-3 mb-3"><Lock className="w-6 h-6 text-green-500 drop-shadow-md" /><span className="font-bold text-lg">{t("security.safeStorageTitle")}</span></div>
                    <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.safeStorageDesc")}</p>
                  </button>
                  <button onClick={() => setSecurePage('export')} className={`p-6 border text-left transition-all group rounded-none ${isDark ? 'border-white/10 hover:bg-white/5' : 'border-black/10 hover:bg-black/5 hover:border-black/20'}`}>
                    <div className="flex items-center gap-3 mb-3"><FileJson className="w-6 h-6 text-orange-500 drop-shadow-md" /><span className="font-bold text-lg">{t("security.exportTitle")}</span></div>
                    <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.exportDesc")}</p>
                  </button>
                  <button onClick={() => setSecurePage('known_hosts')} className={`p-6 border text-left transition-all group col-span-2 rounded-none ${isDark ? 'border-white/10 hover:bg-white/5' : 'border-black/10 hover:bg-black/5 hover:border-black/20'}`}>
                    <div className="flex items-center gap-3 mb-3"><Server className="w-6 h-6 text-purple-500 drop-shadow-md" /><span className="font-bold text-lg">{t("security.knownHostsTitle")}</span></div>
                    <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.knownHostsDesc")}</p>
                  </button>
                </div>
              </>
            ) : (
              <div className="space-y-6 max-w-3xl">
                {/* Breadcrumbs */}
                <button onClick={() => setSecurePage('dashboard')} className="flex items-center gap-2 text-sm font-bold opacity-60 hover:opacity-100 transition-opacity">
                  <ArrowLeft className="w-4 h-4" /> {t("security.backToDashboard")}
                </button>
                <div className={`pt-2 border-t ${isDark ? 'border-white/10' : 'border-black/10'}`}></div>

                {securePage === 'rasp' && (
                  <div className="space-y-6">
                    <h4 className="text-xl font-black flex items-center gap-2"><Cpu className="w-6 h-6 text-red-500"/> {t("security.raspTitle")}</h4>
                    <div>
                      <label className="block text-sm font-medium mb-2 opacity-70 flex items-center gap-2"><Cpu className="w-4 h-4" /> {t('security.globalInitScript')}</label>
                      <textarea 
                        value={appConfig.initScript || ''} 
                        onChange={(e) => updateConfig('initScript', e.target.value)} 
                        rows={4}
                        placeholder={t('security.globalInitScriptPlaceholder') as string} 
                        className={`w-full p-4 border rounded-none text-sm outline-none resize-none font-mono ${isDark ? 'bg-black/50 border-white/10' : 'bg-white border-black/10'}`} 
                      />
                      <div className="text-xs opacity-50 mt-2 font-medium">{t('security.globalInitScriptDesc')}</div>
                    </div>
                  </div>
                )}

                {securePage === 'shield_details' && (
                  <div className="space-y-6">
                    <h4 className="text-2xl font-black flex items-center gap-3"><Shield className="w-8 h-8 text-green-500"/> {t("security.shieldDetailsTitle", "六大方位保护您的数据安全")}</h4>
                    <p className="text-sm opacity-70 leading-relaxed font-medium">
                      {t("security.shieldDetailsIntro", "GETSSH v2.0 采用了全套由底向上的物理级防御体系，确保您的任何核心资产都不会暴露在传统的内存劫持攻击中。")}
                    </p>
                    <div className="grid grid-cols-1 gap-4">
                      <div className={`relative p-6 border flex gap-4 rounded-none ${isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'} ${watchdogStatus?.watchdogDisabled ? 'grayscale opacity-50 cursor-not-allowed' : ''}`}>
                        {watchdogStatus?.watchdogDisabled && (
                          <div className="absolute top-2 right-4 px-2 py-1 bg-red-500/20 text-red-500 border border-red-500/30 text-[10px] font-black uppercase tracking-widest shadow-sm rounded-none">
                            Unavailable
                          </div>
                        )}
                        <div className="shrink-0"><Cpu className="w-6 h-6 text-red-500 drop-shadow-md"/></div>
                        <div>
                          <h5 className="font-bold text-lg mb-1">{t("security.shieldDetailsWatchdog", "The Rust Watchdog")}</h5>
                          <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.shieldDetailsWatchdogDesc", "底层的 Rust 二进制看门狗进程。若主进程引擎被恶意代码挂起或停止心跳超过 5 秒，系统将立刻触发底层系统调用 (SIGKILL) 将被污染的内存物理强杀。")}</p>
                        </div>
                      </div>
                      <div className={`p-6 border flex gap-4 rounded-none ${isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'}`}>
                        <div className="shrink-0"><Lock className="w-6 h-6 text-green-500 drop-shadow-md"/></div>
                        <div>
                          <h5 className="font-bold text-lg mb-1">{t("security.shieldDetailsCrypto", "AES-256-GCM 物理加密")}</h5>
                          <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.shieldDetailsCryptoDesc", "您的所有连接凭证与私钥均使用 SafeStorage 与 AES-256-GCM 算法进行极强度的本地加密，密钥不会上传至任何云端。")}</p>
                        </div>
                      </div>
                      <div className={`p-6 border flex gap-4 rounded-none ${isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'}`}>
                        <div className="shrink-0"><EyeOff className="w-6 h-6 text-blue-500 drop-shadow-md"/></div>
                        <div>
                          <h5 className="font-bold text-lg mb-1">{t("security.shieldDetailsZeroize", "内存即焚 (Zeroize)")}</h5>
                          <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.shieldDetailsZeroizeDesc", "当数据不再使用时，系统通过底层的 zeroize 机制在微秒级别内覆写内存地址，防止通过内存快照 (Memory Dump) 还原您的机密信息。")}</p>
                        </div>
                      </div>
                      <div className={`p-6 border flex gap-4 rounded-none ${isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'}`}>
                        <div className="shrink-0"><Server className="w-6 h-6 text-purple-500 drop-shadow-md"/></div>
                        <div>
                          <h5 className="font-bold text-lg mb-1">{t("security.shieldDetailsNetwork", "Zero-copy (零拷贝) 网络引擎")}</h5>
                          <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.shieldDetailsNetworkDesc", "抛弃低效不安全的传统 Node.js I/O 流，全面转向底层 Rust N-API 原生 Buffer 共享直连，阻断流量在 JS 引擎中的滞留泄露风险。")}</p>
                        </div>
                      </div>
                      <div className={`p-6 border flex gap-4 rounded-none ${isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'}`}>
                        <div className="shrink-0"><ShieldAlert className="w-6 h-6 text-orange-500 drop-shadow-md"/></div>
                        <div>
                          <h5 className="font-bold text-lg mb-1">{t("security.shieldDetailsRasp", "RASP 运行态主动防御")}</h5>
                          <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.shieldDetailsRaspDesc", "动态监控应用运行时的系统调用与执行流，精准拦截针对 Node.js 引擎的恶意代码注入及越权访问。")}</p>
                        </div>
                      </div>
                      <div className={`p-6 border flex flex-col gap-4 rounded-none ${isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'}`}>
                        <div className="flex gap-4">
                          <div className="shrink-0"><Activity className="w-6 h-6 text-cyan-500 drop-shadow-md"/></div>
                          <div className="flex-1">
                            <h5 className="font-bold text-lg mb-1">{t("security.shieldDetailsMemory", "底层内存完整性校验 (Native Memory Scanner)")}</h5>
                            <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.shieldDetailsMemoryDesc", "直接穿透进程边界，定期校验关键系统函数内存首字节，从根本上粉碎任何 Inline Hook 企图。")}</p>
                          </div>
                        </div>
                        <div className="mt-2 flex justify-end">
                          <button 
                            className="px-4 py-2 bg-cyan-600/20 hover:bg-cyan-600/40 text-cyan-500 border border-cyan-500/30 text-xs font-bold transition-all flex items-center gap-2 rounded-none"
                            onClick={() => window.alert(t("security.memoryScannerRootHint", "提示：在 macOS 系统中，底层内存完整性校验需要内核级权限。请在终端中使用 `sudo` 运行此应用程序的二进制文件来激活它。") as string)}
                          >
                            <Lock className="w-3 h-3" />
                            {t("security.enableMemoryScanner", "启用极客内存校验 (需 Root 重启)")}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {securePage === 'privacy' && (
                  <div className="space-y-8">
                    <h4 className="text-xl font-black flex items-center gap-2"><EyeOff className="w-6 h-6 text-blue-500"/> {t("security.privacyTitle")}</h4>
                    <label className="flex items-center gap-4 cursor-pointer p-4 border border-transparent hover:border-black/5 dark:hover:border-white/5 transition-colors rounded-none">
                      <input type="checkbox" checked={appConfig.privacyMode || false} onChange={(e) => updateConfig('privacyMode', e.target.checked)} className="w-5 h-5 accent-primary rounded-none" />
                      <div>
                        <div className="text-sm font-bold flex items-center gap-2">{t('security.privacyMode')} <Shield className="w-3 h-3 text-primary-400" /></div>
                        <div className="text-xs opacity-60 mt-1 font-medium">{t('security.privacyModeDesc')}</div>
                      </div>
                    </label>
                    <div className="p-4">
                      <label className="block text-sm font-bold mb-3 opacity-90 flex items-center gap-2">
                        <Lock className="w-4 h-4" /> {t('security.autoLockTimeout')}
                      </label>
                      <select 
                        value={appConfig.autoLockTimeout || 0}
                        onChange={(e) => updateConfig('autoLockTimeout', parseInt(e.target.value) || 0)}
                        className={`w-full p-3 border text-sm font-medium outline-none shadow-sm transition-colors rounded-none ${isDark ? 'bg-black/50 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-800'}`}
                      >
                        <option value={0}>{t('security.autoLockOff')}</option>
                        <option value={5}>5 {t('security.minutes')}</option>
                        <option value={15}>15 {t('security.minutes')}</option>
                        <option value={30}>30 {t('security.minutes')}</option>
                        <option value={60}>60 {t('security.minutes')}</option>
                      </select>
                      <div className="text-xs opacity-50 mt-2 font-medium">{t('security.autoLockTimeoutDesc')}</div>
                    </div>
                  </div>
                )}

                {securePage === 'safestorage' && (
                  <div className="space-y-6">
                    <h4 className="text-xl font-black flex items-center gap-2"><Lock className="w-6 h-6 text-green-500"/> {t("security.safeStorageTitle")}</h4>
                    <div className="space-y-4 max-w-xl">
                      {safeAction === 'none' ? (
                         <div className="flex gap-3 mt-4">
                           {!encryptionDisabled && !!masterPassword ? (
                              <>
                                <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSafeAction('change'); setSafeError(''); setSafeOldPwd(''); setSafeNewPwd(''); }} className={`py-3 px-5 text-sm font-bold border-0 transition-all shadow-sm rounded-none ${isDark ? 'bg-white/10 hover:bg-white/20' : 'bg-black/5 hover:bg-black/10'}`}>
                                   {t('security.changeMasterPwd')}
                                </button>
                                <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSafeAction('disable'); setSafeError(''); setSafeOldPwd(''); }} className="py-3 px-5 text-sm font-bold border-0 text-red-500 hover:bg-red-500/10 transition-all rounded-none">
                                   {t('security.disableEncryption')}
                                </button>
                              </>
                           ) : (
                              <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSafeAction('enable'); setSafeError(''); setSafeNewPwd(''); }} className={`py-3 px-5 text-sm font-bold border-0 bg-primary hover:bg-primary/90 text-white transition-all shadow-lg shadow-primary/30 rounded-none`}>
                                 {t('security.enableEncryption')}
                              </button>
                           )}
                         </div>
                      ) : (
                         <div className={`p-6 border space-y-4 shadow-sm rounded-none ${isDark ? 'border-white/10 bg-black/20' : 'border-black/10 bg-white'}`}>
                           {safeError && <div className="text-red-500 text-xs font-bold bg-red-500/10 p-2 leading-relaxed rounded-none">{safeError}</div>}
                           
                           {(safeAction === 'change' || safeAction === 'disable') && (
                              <div>
                                <label className="block text-xs font-bold mb-2 opacity-70">{t('security.currentPwd')}</label>
                                <input autoFocus type="password" value={safeOldPwd} onChange={e => setSafeOldPwd(e.target.value)} className={`w-full p-3 border text-sm font-medium outline-none transition-all rounded-none ${isDark ? 'bg-black/50 border-white/10' : 'bg-white border-black/10'}`} />
                              </div>
                           )}
                           
                           {(safeAction === 'change' || safeAction === 'enable') && (
                              <div>
                                <label className="block text-xs font-bold mb-2 opacity-70">{t('security.newPwd')}</label>
                                <input autoFocus={safeAction === 'enable'} type="password" value={safeNewPwd} onChange={e => setSafeNewPwd(e.target.value)} className={`w-full p-3 border text-sm font-medium outline-none transition-all rounded-none ${isDark ? 'bg-black/50 border-white/10' : 'bg-white border-black/10'}`} />
                              </div>
                           )}

                           {safeAction === 'disable' && (
                              <div className="text-xs text-red-500 font-bold bg-red-500/10 p-3 leading-relaxed rounded-none">{t('security.warningPlaintext')}</div>
                           )}

                           <div className="flex gap-3 pt-3">
                              <button onClick={() => setSafeAction('none')} className={`flex-1 py-2.5 px-4 text-sm font-bold border transition-all rounded-none ${isDark ? 'border-white/20 hover:bg-white/10' : 'border-black/20 hover:bg-black/5'}`}>{t('security.cancel')}</button>
                              <button onClick={handleConfirmSafeAction} className="flex-1 py-2.5 px-4 text-sm font-bold bg-primary hover:bg-primary/90 text-white transition-all shadow-md rounded-none">{t('security.confirm')}</button>
                           </div>
                         </div>
                      )}
                    </div>
                  </div>
                )}

                {securePage === 'export' && (
                  <div className="space-y-6">
                    <h4 className="text-xl font-black flex items-center gap-2"><FileJson className="w-6 h-6 text-orange-500"/> {t("security.exportTitle")}</h4>
                    <div className="max-w-xl">
                      <p className="text-sm opacity-60 mb-6 font-medium leading-relaxed">
                        {t('settings.exportHint')}
                      </p>

                      {profilesStatus && (
                        <div className={`mb-4 px-4 py-3 text-sm font-bold shadow-sm rounded-none ${
                          profilesStatus.type === 'success'
                            ? 'bg-green-500/15 text-green-500 border border-green-500/20'
                            : 'bg-red-500/15 text-red-500 border border-red-500/20'
                        }`}>
                          {profilesStatus.msg}
                        </div>
                      )}

                      <button 
                        onClick={() => {
                          const dataStr = JSON.stringify(sessions, null, 2);
                          const blob = new Blob([dataStr], { type: "application/json" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `getssh_profiles_${new Date().toISOString().split('T')[0]}.json`;
                          a.click();
                          setProfilesStatus({ type: 'success', msg: t('settings.exportSuccess') });
                          setTimeout(() => setProfilesStatus(null), 3000);
                        }}
                        className={`py-3 px-5 text-sm font-bold border transition-all flex items-center gap-2 rounded-none ${isDark ? 'border-white/20 hover:bg-white/10' : 'border-black/20 hover:bg-black/5'}`}
                      >
                        <Download className="w-4 h-4" /> {t('settings.exportProfiles')}
                      </button>
                    </div>
                  </div>
                )}

                {securePage === 'known_hosts' && (
                  <div className="space-y-6">
                    <h4 className="text-xl font-black flex items-center gap-2"><Server className="w-6 h-6 text-purple-500"/> {t("security.knownHostsTitle")}</h4>
                    <div className="max-w-3xl">
                      {knownHosts.length === 0 ? (
                        <div className="text-sm opacity-50 py-8 text-center border border-dashed rounded-none border-white/10">{t('settings.noKnownHosts')}</div>
                      ) : (
                        <div className="space-y-2 max-h-[400px] overflow-y-auto no-scrollbar">
                          {knownHosts.map(h => (
                            <div key={`${h.host}:${h.port}`} className={`flex items-center justify-between p-4 border rounded-none ${isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'}`}>
                              <div>
                                <div className="font-bold text-sm mb-1">{h.host}:{h.port}</div>
                                <div className="text-xs opacity-50 font-mono">{h.fingerprint}</div>
                              </div>
                              <button
                                onClick={() => {
                                  if (revokingHost === `${h.host}:${h.port}`) {
                                    handleRevokeHost(h.host, h.port);
                                  } else {
                                    setRevokingHost(`${h.host}:${h.port}`);
                                    setTimeout(() => setRevokingHost(null), 3000);
                                  }
                                }}
                                className={`px-3 py-1.5 text-xs font-bold border rounded-none transition-all flex items-center gap-2 ${
                                  revokingHost === `${h.host}:${h.port}`
                                  ? 'bg-red-500 text-white border-red-500'
                                  : isDark ? 'border-white/20 hover:bg-white/10 hover:border-red-500 hover:text-red-500' : 'border-black/20 hover:bg-black/5 hover:border-red-500 hover:text-red-500'
                                }`}
                              >
                                <Trash2 className="w-3 h-3" />
                                {revokingHost === `${h.host}:${h.port}` ? t('settings.confirmRevoke') : t('settings.revokeTrust')}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
