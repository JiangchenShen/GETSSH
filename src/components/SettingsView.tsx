import React, { useState } from 'react';
import { Settings, Monitor, Terminal as TerminalIcon, Network, Command, Cpu, Blocks, Info, X, Shield, Upload, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/appStore';
import { useSessionStore } from '../store/sessionStore';
import { PluginSettings } from './PluginSettings';

interface SettingsViewProps {
  settingsActiveTab: 'Appearance'|'Terminal'|'SSH'|'System'|'Security'|'Plugins'|'About';
  setSettingsActiveTab: (tab: 'Appearance'|'Terminal'|'SSH'|'System'|'Security'|'Plugins'|'About') => void;
  masterPassword: string;
  setMasterPassword: (pwd: string) => void;
  encryptionDisabled: boolean;
  setEncryptionDisabled: (disabled: boolean) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settingsActiveTab,
  setSettingsActiveTab,
  masterPassword,
  setMasterPassword,
  encryptionDisabled,
  setEncryptionDisabled,
}) => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const appConfig = useAppStore(state => state.appConfig);
  const updateConfig = useAppStore(state => state.updateConfig);
  
  const tabs = useSessionStore(state => state.tabs);
  const setTabs = useSessionStore(state => state.setTabs);
  const setActiveTabId = useSessionStore(state => state.setActiveTabId);
  const sessions = useSessionStore(state => state.sessions);
  const setSessions = useSessionStore(state => state.setSessions);

  const [safeAction, setSafeAction] = useState<'none'|'change'|'disable'|'enable'>('none');
  const [safeOldPwd, setSafeOldPwd] = useState('');
  const [safeNewPwd, setSafeNewPwd] = useState('');
  const [safeError, setSafeError] = useState('');
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  // Import/Export state
  const [importPwdModal, setImportPwdModal] = useState(false);
  const [importPwd, setImportPwd] = useState('');
  const [profilesStatus, setProfilesStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  return (
    <>
    <div className={`flex-1 flex overflow-hidden ${isDark ? 'bg-[#1e1e1e] text-white' : 'bg-gray-50 text-black'}`}>
      {/* Settings Sidebar */}
      <div className={`w-56 p-6 border-r ${isDark ? 'border-white/10 bg-black/20' : 'border-black/10 bg-gray-100'}`}>
        <h3 className="text-lg font-bold flex items-center gap-2 mb-6">
           <Settings className="w-5 h-5 text-primary" />
           {t('settings.configuration')}
        </h3>
        <nav className="flex flex-col gap-1">
           <button onClick={() => setSettingsActiveTab('Appearance')} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all text-left ${settingsActiveTab === 'Appearance' ? 'bg-primary/20 text-primary font-medium' : 'hover:bg-black/10 dark:hover:bg-white/10 opacity-70 hover:opacity-100'}`}><Monitor className="w-4 h-4"/>{t('settings.appearance')}</button>
           <button onClick={() => setSettingsActiveTab('Terminal')} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all text-left ${settingsActiveTab === 'Terminal' ? 'bg-primary/20 text-primary font-medium' : 'hover:bg-black/10 dark:hover:bg-white/10 opacity-70 hover:opacity-100'}`}><TerminalIcon className="w-4 h-4"/>{t('settings.terminal')}</button>
           <button onClick={() => setSettingsActiveTab('SSH')} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all text-left ${settingsActiveTab === 'SSH' ? 'bg-primary/20 text-primary font-medium' : 'hover:bg-black/10 dark:hover:bg-white/10 opacity-70 hover:opacity-100'}`}><Network className="w-4 h-4"/>{t('settings.ssh')}</button>
           <button onClick={() => setSettingsActiveTab('System')} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all text-left ${settingsActiveTab === 'System' ? 'bg-primary/20 text-primary font-medium' : 'hover:bg-black/10 dark:hover:bg-white/10 opacity-70 hover:opacity-100'}`}><Command className="w-4 h-4"/>{t('settings.system')}</button>
           <button onClick={() => setSettingsActiveTab('Security')} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border-0 text-sm transition-all text-left mt-2 pt-3 ${settingsActiveTab === 'Security' ? 'bg-primary/20 text-primary font-medium' : 'hover:bg-black/10 dark:hover:bg-white/10 opacity-70 hover:opacity-100'}`}><Cpu className="w-4 h-4"/>{t('settings.security')}</button>
           <button onClick={() => setSettingsActiveTab('Plugins')} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all text-left ${settingsActiveTab === 'Plugins' ? 'bg-primary/20 text-primary font-medium' : 'hover:bg-black/10 dark:hover:bg-white/10 opacity-70 hover:opacity-100'}`}><Blocks className="w-4 h-4"/>{t('settings.plugins')}</button>
           <button onClick={() => setSettingsActiveTab('About')} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all text-left ${settingsActiveTab === 'About' ? 'bg-primary/20 text-primary font-medium' : 'hover:bg-black/10 dark:hover:bg-white/10 opacity-70 hover:opacity-100'}`}><Info className="w-4 h-4"/>{t('settings.about')}</button>
        </nav>
      </div>

      {/* Settings Payload */}
      <div className="flex-1 flex flex-col relative bg-transparent">
        {/* Close Button */}
        <button
          onClick={() => { setActiveTabId(null); setTabs(tabs.filter(t => t.id !== 'settings')); }}
          className={`absolute right-6 top-6 z-30 p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-white/10 text-white/50 hover:text-white' : 'hover:bg-black/5 text-black/50 hover:text-black'}`}
          title="Close Settings"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-10 overflow-y-auto w-full h-full pb-32">
          <h3 className="text-2xl font-bold mb-8 opacity-90">{t('settings.' + settingsActiveTab.toLowerCase() as any)} {t('settings.configuration')}</h3>
          
          {settingsActiveTab === 'Appearance' && (
            <div className="space-y-8 max-w-xl">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1 opacity-70">{t('appearance.language')}</label>
                  <select 
                    value={appConfig.language}
                    onChange={(e) => updateConfig('language', e.target.value)}
                    className={`w-full p-2 border rounded-md text-sm outline-none transition-colors ${isDark ? 'bg-black/50 border-white/10 text-white' : 'bg-white border-black/10 text-black'}`}
                  >
                    <option value="en-US">English</option>
                    <option value="zh-CN">简体中文</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 opacity-70">{t('appearance.systemColor')}</label>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    {[
                      { name: 'Cyber Purple', color: '168 85 247', bg: 'bg-[#a855f7]' },
                      { name: 'Geek Green',   color: '34 197 94',  bg: 'bg-[#22c55e]' },
                      { name: 'Deep Blue',    color: '59 130 246', bg: 'bg-[#3b82f6]' },
                      { name: 'Geek Red',     color: '239 68 68',  bg: 'bg-[#ef4444]' },
                    ].map(swatch => (
                      <button 
                        key={swatch.color}
                        onClick={() => updateConfig('themeColor', swatch.color)}
                        className={`w-8 h-8 rounded-full border-2 transition-all ${swatch.bg} ${appConfig.themeColor === swatch.color ? 'border-white scale-110 shadow-lg shadow-black/30' : 'border-transparent hover:scale-105'}`}
                        title={swatch.name}
                      />
                    ))}
                    {/* Custom Color Picker */}
                    <div className="relative" title="Custom Color">
                      <div
                        className={`w-8 h-8 rounded-full border-2 flex items-center justify-center overflow-hidden transition-all hover:scale-105 ${
                          !['168 85 247','34 197 94','59 130 246','239 68 68'].includes(appConfig.themeColor)
                            ? 'border-white scale-110 shadow-lg shadow-black/30'
                            : 'border-transparent'
                        }`}
                        style={{ background: `rgb(${appConfig.themeColor})` }}
                      >
                        <input
                          type="color"
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                          value={`#${appConfig.themeColor.split(' ').map(n => parseInt(n).toString(16).padStart(2,'0')).join('')}`}
                          onChange={(e) => {
                            const hex = e.target.value;
                            const r = parseInt(hex.slice(1,3),16);
                            const g = parseInt(hex.slice(3,5),16);
                            const b = parseInt(hex.slice(5,7),16);
                            updateConfig('themeColor', `${r} ${g} ${b}`);
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 opacity-70">{t('appearance.uiTheme')}</label>
                <div className="grid grid-cols-3 gap-2">
                  <button onClick={() => updateConfig('theme', 'system')} className={`py-1.5 rounded-lg text-sm border transition-all ${appConfig.theme === 'system' ? 'border-primary bg-primary/20 text-primary' : 'border-current opacity-50 hover:opacity-100'}`}>{t('appearance.auto')}</button>
                  <button onClick={() => updateConfig('theme', 'light')} className={`py-1.5 rounded-lg text-sm border transition-all ${appConfig.theme === 'light' ? 'border-primary bg-primary/20 text-primary' : 'border-current opacity-50 hover:opacity-100'}`}>{t('appearance.light')}</button>
                  <button onClick={() => updateConfig('theme', 'dark')} className={`py-1.5 rounded-lg text-sm border transition-all ${appConfig.theme === 'dark' ? 'border-primary bg-primary/20 text-primary' : 'border-current opacity-50 hover:opacity-100'}`}>{t('appearance.dark')}</button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 opacity-70">{t('appearance.bgOpacity')}</label>
                <input 
                   type="range" min="0.1" max="1" step="0.05" 
                   value={appConfig.bgOpacity || 1}
                   onChange={(e) => updateConfig('bgOpacity', parseFloat(e.target.value) || 0.8)}
                   className="w-full accent-primary"
                />
                <div className="text-xs opacity-50 text-right mt-1">{Math.round(appConfig.bgOpacity * 100)}%</div>
              </div>
            </div>
          )}

          {settingsActiveTab === 'Terminal' && (
            <div className="space-y-8 max-w-xl">
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={appConfig.copyOnSelect || false} onChange={(e) => updateConfig('copyOnSelect', e.target.checked)} className="w-4 h-4 accent-primary rounded" />
                <div>
                  <div className="text-sm font-medium">{t('ssh.copyOnSelect')}</div>
                  <div className="text-xs opacity-50">Automatically copy highlighted text to system clipboard.</div>
                </div>
              </label>

              <div>
                <label className="block text-sm font-medium mb-1 opacity-70">{t('terminal.fontFamily')}</label>
                <select 
                  value={appConfig.fontFamily}
                  onChange={(e) => updateConfig('fontFamily', e.target.value)}
                  className={`w-full p-2 border rounded-md text-sm outline-none transition-colors ${isDark ? 'bg-black/50 border-white/10 text-white' : 'bg-white border-black/10 text-black'}`}
                >
                   <option value='"Fira Code", monospace, "Courier New", Courier'>Fira Code (Default)</option>
                   <option value='"Consolas", "Courier New", monospace'>Consolas / Courier</option>
                   <option value='"Menlo", "Monaco", "Courier New", monospace'>Menlo / Monaco</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1 opacity-70">{t('terminal.fontSize')}</label>
                  <input type="number" value={appConfig.fontSize || 14} onChange={(e) => updateConfig('fontSize', parseInt(e.target.value) || 14)} className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/10' : 'bg-white border-black/10'}`} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 opacity-70">{t('terminal.lineHeight')}</label>
                  <input type="number" step="0.1" value={appConfig.lineHeight || 1.2} onChange={(e) => updateConfig('lineHeight', parseFloat(e.target.value) || 1.2)} className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/10' : 'bg-white border-black/10'}`} />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 opacity-70">{t('terminal.cursorStyle')}</label>
                <select 
                  value={appConfig.cursorStyle}
                  onChange={(e) => updateConfig('cursorStyle', e.target.value as any)}
                  className={`w-full p-2 border rounded-md text-sm outline-none transition-colors ${isDark ? 'bg-black/50 border-white/10 text-white' : 'bg-white border-black/10 text-black'}`}
                >
                   <option value="block">{t('terminal.block')}</option>
                   <option value="underline">Underline</option>
                   <option value="bar">Bar (I-Beam)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 opacity-70">Scrollback Lines</label>
                <input type="number" min="1000" step="1000" value={appConfig.scrollback || 10000} onChange={(e) => updateConfig('scrollback', parseInt(e.target.value) || 10000)} className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/10' : 'bg-white border-black/10'}`} />
                <div className="text-xs opacity-50 mt-1 text-yellow-500 dark:text-yellow-400">Note: Modifying scrollback typically only applies to new tabs.</div>
              </div>
            </div>
          )}

          {settingsActiveTab === 'SSH' && (
            <div className="space-y-8 max-w-xl">
              <div>
                 <label className="block text-sm font-medium mb-1 opacity-70">{t('ssh.proxyType')}</label>
                 <div className="flex flex-col gap-3">
                    <select value={appConfig.proxyType} onChange={(e) => updateConfig('proxyType', e.target.value as any)} className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/10' : 'bg-white border-black/10'}`}>
                       <option value="none">{t('ssh.proxyNone')}</option>
                       <option value="http">{t('ssh.proxyHttp')}</option>
                       <option value="socks5">{t('ssh.proxySocks5')}</option>
                    </select>
                    {appConfig.proxyType !== 'none' && (
                        <div className="grid grid-cols-4 gap-2">
                           <div className="col-span-3">
                              <label className="block text-xs font-medium mb-1 opacity-70">{t('ssh.proxyHost')}</label>
                              <input type="text" value={appConfig.proxyHost || ''} onChange={(e) => updateConfig('proxyHost', e.target.value)} className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/10' : 'bg-white border-black/10'}`} />
                           </div>
                           <div className="col-span-1">
                              <label className="block text-xs font-medium mb-1 opacity-70">{t('ssh.proxyPort')}</label>
                              <input type="number" min="1" max="65535" value={appConfig.proxyPort || 1080} onChange={(e) => updateConfig('proxyPort', parseInt(e.target.value) || 1080)} className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/10' : 'bg-white border-black/10'}`} />
                           </div>
                        </div>
                    )}
                 </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 opacity-70">{t('ssh.keepAlive')}</label>
                <input type="number" min="0" value={appConfig.keepalive || 0} onChange={(e) => updateConfig('keepalive', parseInt(e.target.value) || 0)} className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/10' : 'bg-white border-black/10'}`} />
                <div className="text-xs opacity-50 mt-1">{t('ssh.keepAliveDesc')}</div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 opacity-70">{t('ssh.port')}</label>
                <input type="number" min="1" max="65535" value={appConfig.defaultPort || 22} onChange={(e) => updateConfig('defaultPort', parseInt(e.target.value) || 22)} className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/10' : 'bg-white border-black/10'}`} />
              </div>
            </div>
          )}

          {settingsActiveTab === 'System' && (
            <div className="space-y-8 max-w-xl">

              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={appConfig.confirmQuit || false} onChange={(e) => updateConfig('confirmQuit', e.target.checked)} className="w-4 h-4 accent-primary rounded" />
                <div>
                  <div className="text-sm font-medium">{t('system.confirmQuit')}</div>
                  <div className="text-xs opacity-50">{t('system.confirmQuitDesc')}</div>
                </div>
              </label>

              <div>
                <label className="block text-sm font-medium mb-1 opacity-70">{t('system.globalHotkey')}</label>
                <input type="text" value={appConfig.globalHotkey || ''} onChange={(e) => updateConfig('globalHotkey', e.target.value)} placeholder="e.g. Option+Space" className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/10' : 'bg-white border-black/10'}`} />
                <div className="text-xs opacity-50 mt-1">{t('system.globalHotkeyDesc')}</div>
              </div>
            </div>
          )}

          {settingsActiveTab === 'Security' && (
            <div className="space-y-8 max-w-xl">
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={appConfig.privacyMode || false} onChange={(e) => updateConfig('privacyMode', e.target.checked)} className="w-4 h-4 accent-primary rounded" />
                <div>
                  <div className="text-sm font-medium flex items-center gap-2">{t('security.privacyMode')} <Shield className="w-3 h-3 text-primary-400" /></div>
                  <div className="text-xs opacity-50">{t('security.privacyModeDesc')}</div>
                </div>
              </label>

              <div>
                <label className="block text-sm font-medium mb-1 opacity-70 flex items-center gap-2"><Cpu className="w-4 h-4" /> Global Init Script</label>
                <textarea 
                  value={appConfig.initScript || ''} 
                  onChange={(e) => updateConfig('initScript', e.target.value)} 
                  rows={4}
                  placeholder="e.g. neofetch && tmux attach" 
                  className={`w-full p-4 border rounded-[20px] text-sm outline-none resize-none font-mono ${isDark ? 'bg-black/50 border-white/10' : 'bg-white border-black/10'}`} 
                />
                <div className="text-xs opacity-50 mt-1">Commands to automatically execute sequentially when connecting to any session.</div>
              </div>

              <div className="pt-6 border-0 rounded-none">
                 <h4 className="text-sm font-bold mb-3 flex items-center gap-2"><Shield className="w-4 h-4 text-primary"/> {t('security.safeStorageConfig')}</h4>
                 <div className="space-y-3">
                    {safeAction === 'none' ? (
                       <>
                         {!encryptionDisabled && !!masterPassword ? (
                            <>
                              <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSafeAction('change'); setSafeError(''); setSafeOldPwd(''); setSafeNewPwd(''); }} className={`py-2 px-3 text-sm font-medium rounded-lg border-0 transition-all ${isDark ? 'bg-white/10 hover:bg-white/20' : 'bg-black/5 hover:bg-black/10'}`}>
                                 {t('security.changeMasterPwd')}
                              </button>
                              <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSafeAction('disable'); setSafeError(''); setSafeOldPwd(''); }} className="py-2 px-3 text-sm font-medium rounded-lg border-0 text-red-500 hover:bg-red-500/10 transition-all ml-[5px]">
                                 {t('security.disableEncryption')}
                              </button>
                            </>
                         ) : (
                            <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSafeAction('enable'); setSafeError(''); setSafeNewPwd(''); }} className={`py-2 px-3 text-sm font-medium rounded-lg border-0 bg-primary hover:bg-primary/80 text-white transition-all shadow-lg shadow-primary/20`}>
                               {t('security.enableEncryption')}
                            </button>
                         )}
                       </>
                    ) : (
                       <div className="p-6 rounded-none bg-transparent border-0 space-y-3">
                         {safeError && <div className="text-red-500 text-xs font-medium">{safeError}</div>}
                         
                         {(safeAction === 'change' || safeAction === 'disable') && (
                            <div>
                              <label className="block text-xs font-medium mb-1 opacity-70">{t('security.currentPwd')}</label>
                              <input autoFocus type="password" value={safeOldPwd} onChange={e => setSafeOldPwd(e.target.value)} className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/10' : 'bg-white border-black/10'}`} />
                            </div>
                         )}
                         
                         {(safeAction === 'change' || safeAction === 'enable') && (
                            <div>
                              <label className="block text-xs font-medium mb-1 opacity-70">{t('security.newPwd')}</label>
                              <input autoFocus={safeAction === 'enable'} type="password" value={safeNewPwd} onChange={e => setSafeNewPwd(e.target.value)} className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/10' : 'bg-white border-black/10'}`} />
                            </div>
                         )}

                         {safeAction === 'disable' && (
                            <div className="text-xs text-red-500 font-medium">{t('security.warningPlaintext')}</div>
                         )}

                         <div className="flex gap-2 pt-2">
                            <button onClick={() => setSafeAction('none')} className={`flex-1 py-1.5 px-3 text-sm rounded-[20px] border transition-all ${isDark ? 'border-white/20 hover:bg-white/10' : 'border-black/20 hover:bg-black/5'}`}>{t('security.cancel')}</button>
                            <button onClick={() => {
                               if ((safeAction === 'change' || safeAction === 'disable') && safeOldPwd !== masterPassword) {
                                  return setSafeError(t('security.errIncorrectPwd'));
                               }
                               if ((safeAction === 'change' || safeAction === 'enable') && !safeNewPwd) {
                                  return setSafeError(t('security.errEmptyPwd'));
                               }
                               
                               if (safeAction === 'change') {
                                  setMasterPassword(safeNewPwd);
                                  (window as any).electronAPI.saveProfiles({ masterPassword: safeNewPwd, payload: sessions });
                                  setTimeout(() => window.alert('✅ 主密码已安全更新并重加密完成！'), 100);
                               } else if (safeAction === 'disable') {
                                  setEncryptionDisabled(true);
                                  setMasterPassword('');
                                  (window as any).electronAPI.saveProfiles({ masterPassword: '', payload: sessions });
                                  setTimeout(() => window.alert('⚠️ 加密已解除，配置已转为明文存储。'), 100);
                               } else if (safeAction === 'enable') {
                                  setEncryptionDisabled(false);
                                  setMasterPassword(safeNewPwd);
                                  (window as any).electronAPI.saveProfiles({ masterPassword: safeNewPwd, payload: sessions });
                                  setTimeout(() => window.alert('🔒 SafeStorage 零知识加密已启动！'), 100);
                               }
                               
                               setSafeAction('none');
                            }} className="flex-1 py-1.5 px-3 text-sm rounded-[20px] bg-primary hover:bg-primary/80 text-white transition-all shadow-md">{t('security.confirm')}</button>
                         </div>
                       </div>
                    )}
                 </div>
              </div>

              {/* ── Profile Import / Export ──────────────────────────── */}
              <div className="pt-6">
                <h4 className="text-sm font-bold mb-3 flex items-center gap-2">
                  <Upload className="w-4 h-4 text-primary" /> 配置文件管理
                </h4>
                <p className="text-xs opacity-50 mb-4">
                  导出需要先设置主密码，以确保密码/私钥路径得到 AES-256 加密保护。主机名、用户名等基础信息将以明文保存，方便阅读。
                </p>

                {profilesStatus && (
                  <div className={`mb-3 px-4 py-2 rounded-lg text-xs font-medium ${
                    profilesStatus.type === 'success'
                      ? 'bg-green-500/15 text-green-400'
                      : 'bg-red-500/15 text-red-400'
                  }`}>
                    {profilesStatus.msg}
                  </div>
                )}

                {/* No master password → show locked hint for export */}
                {encryptionDisabled && (
                  <div className={`mb-3 px-4 py-2.5 rounded-lg text-xs flex items-center gap-2 ${
                    isDark ? 'bg-yellow-500/10 text-yellow-400' : 'bg-yellow-50 text-yellow-600 border border-yellow-200'
                  }`}>
                    <Shield className="w-3.5 h-3.5 shrink-0" />
                    <span>导出功能需要主密码。请先在上方"SafeStorage 加密配置"中设置主密码，再进行导出。</span>
                  </div>
                )}

                <div className="flex gap-3">
                  {/* Export — only available when master password is set */}
                  <button
                    onClick={async () => {
                      setProfilesStatus(null);
                      const res = await window.electronAPI.exportProfiles({
                        sessions,
                        masterPassword,
                      });
                      if (res.success) {
                        setProfilesStatus({ type: 'success', msg: `✅ 已成功导出 ${res.count} 个配置！` });
                      } else if (res.reason !== 'canceled') {
                        setProfilesStatus({ type: 'error', msg: `❌ 导出失败：${res.reason}` });
                      }
                    }}
                    disabled={encryptionDisabled || sessions.length === 0}
                    title={encryptionDisabled ? '请先设置主密码后再导出' : '导出所有服务器配置'}
                    className={`flex items-center gap-2 py-2 px-4 text-sm font-medium rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                      isDark ? 'bg-white/10 hover:bg-white/20' : 'bg-black/5 hover:bg-black/10'
                    }`}
                  >
                    <Download className="w-4 h-4" /> 导出配置
                  </button>

                  {/* Import — always available */}
                  <button
                    onClick={() => {
                      setProfilesStatus(null);
                      setImportPwd('');
                      setImportPwdModal(true);
                    }}
                    className={`flex items-center gap-2 py-2 px-4 text-sm font-medium rounded-lg transition-all ${
                      isDark ? 'bg-white/10 hover:bg-white/20' : 'bg-black/5 hover:bg-black/10'
                    }`}
                  >
                    <Upload className="w-4 h-4" /> 导入配置
                  </button>
                </div>
              </div>
            </div>
          )}

          {settingsActiveTab === 'Plugins' && (
            <PluginSettings isDark={isDark} />
          )}

          {settingsActiveTab === 'About' && (
            <div className="flex flex-col items-center justify-center pt-20 max-w-xl mx-auto space-y-6 text-center">
              <div className="relative">
                <div className="absolute inset-0 bg-primary blur-2xl opacity-20 rounded-full" />
                <div className="relative z-10 flex flex-col items-center gap-3">
                  <span className="text-5xl font-black tracking-tighter bg-gradient-to-br from-primary/80 to-primary bg-clip-text text-transparent">GETSSH</span>
                </div>
              </div>
              <div className="text-xl font-medium tracking-widest opacity-80">{t('about.version')}</div>
              
              <div className="w-16 h-1 bg-gradient-to-r from-transparent via-primary to-transparent my-4 opacity-50" />
              
              <div className="space-y-2 opacity-70">
                <p>{t('about.author')}</p>
                <p>{t('about.license')}</p>
              </div>

              <div className="mt-6">
                <button 
                  onClick={async () => {
                    setCheckingUpdate(true);
                    try {
                      const res = await window.electronAPI.checkForUpdates();
                      if (res.hasUpdate) {
                         window.alert(`🎉 发现新版本：${res.version}！\n\n新版本已发布，系统将引导您前往下载更新。`);
                         window.electronAPI.openExternal(res.url!);
                      } else if (res.error) {
                         window.alert(`检查更新失败：${res.error}`);
                      } else {
                         window.alert('✅ 当前已经是最新版本！');
                      }
                    } catch (e: any) {
                      window.alert(`网络错误：${e.message}`);
                    } finally {
                      setCheckingUpdate(false);
                    }
                  }}
                  disabled={checkingUpdate}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all shadow-md ${isDark ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-black/5 hover:bg-black/10 text-black'}`}
                >
                  {checkingUpdate ? '正在检查...' : '检查更新'}
                </button>
              </div>

              <div className="mt-12 w-full">
                <h3 className="text-xs font-bold uppercase tracking-widest opacity-40 mb-4">{t('about.poweredBy')}</h3>
                <div className="flex flex-wrap justify-center gap-3">
                  {['Electron', 'Node.js', 'HTML/CSS', 'React/TS', 'xterm.js', 'i18next', 'Tailwind'].map(tech => (
                    <span key={tech} className={`px-3 py-1.5 rounded-md text-xs font-medium border ${isDark ? 'bg-white/5 border-white/10 text-white/70' : 'bg-black/5 border-black/10 text-black/70'}`}>
                      {tech}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>

    {/* ── Import Password Modal ───────────────────────────────────────── */}
    {importPwdModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className={`w-80 p-6 rounded-2xl shadow-2xl border space-y-4 ${isDark ? 'bg-[#1e1e1e] border-white/10 text-white' : 'bg-white border-black/10 text-black'}`}>
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            <h3 className="text-sm font-bold">导入配置</h3>
          </div>
          <p className="text-xs opacity-60">
            如果导出文件已加密，请输入当前主密码以解密凭证；如为明文导出，留空即可。
          </p>
          <input
            autoFocus
            type="password"
            placeholder="主密码（可选）"
            value={importPwd}
            onChange={(e) => setImportPwd(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.closest('div')?.querySelector<HTMLButtonElement>('[data-confirm]')?.click()}
            className={`w-full p-2 border rounded-lg text-sm outline-none ${isDark ? 'bg-black/50 border-white/10' : 'bg-gray-50 border-black/10'}`}
          />
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => { setImportPwdModal(false); setImportPwd(''); }}
              className={`flex-1 py-2 text-sm rounded-xl border transition-all ${isDark ? 'border-white/20 hover:bg-white/10' : 'border-black/20 hover:bg-black/5'}`}
            >
              取消
            </button>
            <button
              data-confirm
              onClick={async () => {
                setImportPwdModal(false);
                const res = await window.electronAPI.importProfiles({ masterPassword: importPwd });

                if (!res.success) {
                  const msgs: Record<string, string> = {
                    canceled:         '操作已取消。',
                    invalid_format:   '文件格式无效，请选择 GETSSH 导出的 JSON 文件。',
                    password_required:'该文件已加密，请输入主密码。',
                    wrong_password:   '主密码错误，解密失败。',
                  };
                  setProfilesStatus({ type: 'error', msg: `❌ ${msgs[res.reason ?? ''] ?? res.reason}` });
                  return;
                }

                if (res.profiles && res.profiles.length > 0) {
                  // Merge: avoid exact duplicates (same host + username)
                  const existing = new Set(sessions.map(s => `${s.host}::${s.username}`));
                  const newOnes  = res.profiles.filter(p => !existing.has(`${p.host}::${p.username}`));
                  const merged   = [...sessions, ...newOnes];
                  setSessions(merged);
                  // Persist to disk
                  await window.electronAPI.saveProfiles({ masterPassword, payload: merged });
                  setProfilesStatus({
                    type: 'success',
                    msg: `✅ 成功导入 ${newOnes.length} 个新配置（跳过 ${res.profiles.length - newOnes.length} 个重复）！`,
                  });
                } else {
                  setProfilesStatus({ type: 'success', msg: '✅ 文件读取成功，但没有新配置需要导入。' });
                }
                setImportPwd('');
              }}
              className="flex-1 py-2 text-sm rounded-xl bg-primary hover:bg-primary/80 text-white transition-all shadow-md"
            >
              选择文件并导入
            </button>
          </div>
        </div>
      </div>
    )}
  </>
  );
};
