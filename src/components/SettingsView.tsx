import React, { useState } from 'react';
import { Settings, Monitor, Terminal as TerminalIcon, Network, Command, Cpu, Blocks, Info, Shield, ShieldAlert, Upload, Download, Copy, Archive, ChevronLeft, ChevronRight, Lock, Trash2, EyeOff, FileJson, Server, ArrowLeft, Activity } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/appStore';
import { useSessionStore } from '../store/sessionStore';
import { PluginSettings } from './PluginSettings';
import { parseCustomTheme } from '../utils/themes';
import logoSrc from '../assets/logo.png';

interface SettingsViewProps {
  settingsActiveTab: 'Appearance'|'Terminal'|'SSH'|'System'|'Security'|'Plugins'|'About'|'Audit';
  setSettingsActiveTab: (tab: 'Appearance'|'Terminal'|'SSH'|'System'|'Security'|'Plugins'|'About'|'Audit') => void;
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
  const isPolluted = useAppStore(state => state.isPolluted);
  const watchdogStatus = useAppStore(state => state.watchdogStatus);
  const pollWatchdogStatus = useAppStore(state => state.pollWatchdogStatus);
  const appConfig = useAppStore(state => state.appConfig);
  const updateConfig = useAppStore(state => state.updateConfig);
  
  const sessions = useSessionStore(state => state.sessions);
  const setSessions = useSessionStore(state => state.setSessions);

  // History Stack for Navigation
  const [history, setHistory] = useState<string[]>([settingsActiveTab]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [securePage, setSecurePage] = useState<'dashboard' | 'rasp' | 'privacy' | 'safestorage' | 'export' | 'known_hosts' | 'shield_details'>('dashboard');

  React.useEffect(() => {
    let interval: NodeJS.Timeout;
    if (settingsActiveTab === 'Security') {
      pollWatchdogStatus();
      interval = setInterval(pollWatchdogStatus, 3000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [settingsActiveTab, pollWatchdogStatus]);

  React.useEffect(() => {
    if (history[historyIndex] !== settingsActiveTab) {
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(settingsActiveTab);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    }
  }, [settingsActiveTab]);

  const handleImportTheme = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const raw = event.target?.result as string;
      const theme = parseCustomTheme(raw);
      if (theme) {
        const themeName = file.name.replace(/\.json$/i, '');
        const key = `custom_${themeName}`;
        const newThemes = { ...(appConfig.customThemes || {}), [key]: theme };
        updateConfig('customThemes', newThemes);
        updateConfig('terminalTheme', key);
        window.alert(t('appearance.importSuccess') || 'Theme imported successfully!');
      } else {
        window.alert(t('appearance.importFail') || 'Failed to parse theme. Invalid format.');
      }
      // Reset input
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  const goBack = () => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1];
      setHistoryIndex(historyIndex - 1);
      setSettingsActiveTab(prev as any);
    }
  };

  const goForward = () => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      setHistoryIndex(historyIndex + 1);
      setSettingsActiveTab(next as any);
    }
  };

  const [safeAction, setSafeAction] = useState<'none'|'change'|'disable'|'enable'>('none');
  const [safeOldPwd, setSafeOldPwd] = useState('');
  const [safeNewPwd, setSafeNewPwd] = useState('');
  const [safeError, setSafeError] = useState('');
  const [checkingUpdate, setCheckingUpdate] = useState(false);

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

  // Import/Export state
  const [importPwdModal, setImportPwdModal] = useState(false);
  const [importPwd, setImportPwd] = useState('');
  const [profilesStatus, setProfilesStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // Known Hosts State
  const [knownHosts, setKnownHosts] = React.useState<{host: string, port: number, fingerprint: string, trustedAt: number}[]>([]);
  const [revokingHost, setRevokingHost] = React.useState<string | null>(null);

  // Audit Logs State
  const [auditLogs, setAuditLogs] = React.useState<{ id: string, alias: string, host: string, port: number, connectedAt: string, disconnectedAt: string, duration: string }[]>([]);
  const [auditPage, setAuditPage] = React.useState(1);
  const ITEMS_PER_PAGE = 10;
  
  const reversedAuditLogs = React.useMemo(() => [...auditLogs].reverse(), [auditLogs]);
  const totalAuditPages = Math.max(1, Math.ceil(reversedAuditLogs.length / ITEMS_PER_PAGE));
  React.useEffect(() => {
    if (auditPage > totalAuditPages) setAuditPage(totalAuditPages);
  }, [totalAuditPages, auditPage]);
  const paginatedAuditLogs = reversedAuditLogs.slice((auditPage - 1) * ITEMS_PER_PAGE, auditPage * ITEMS_PER_PAGE);

  React.useEffect(() => {
    if (settingsActiveTab === 'Security' && window.electronAPI?.getKnownHosts) {
      window.electronAPI.getKnownHosts().then(setKnownHosts);
    }
    
    let auditInterval: NodeJS.Timeout | undefined;
    if (settingsActiveTab === 'Audit' && window.electronAPI?.getConnectionLogs) {
      const fetchLogs = () => window.electronAPI.getConnectionLogs().then(setAuditLogs);
      fetchLogs();
      auditInterval = setInterval(fetchLogs, 3000);
    }

    return () => {
      if (auditInterval) clearInterval(auditInterval);
    };
  }, [settingsActiveTab]);

  return (
    <>
    <div className={`flex-1 flex overflow-hidden bg-transparent ${isDark ? 'text-white' : 'text-slate-800'}`}>
      {/* Settings Sidebar */}
      <div className={`w-72 p-8 border-r flex flex-col ${isDark ? 'border-white/5 bg-black/10' : 'border-black/5 bg-slate-100/30'}`}>
        <h3 className="text-xl font-bold flex items-center gap-3 mb-8 tracking-wide">
           <Settings className="w-6 h-6 text-primary" />
           {t('settings.configuration')}
        </h3>
        <nav className="flex flex-col gap-2 overflow-y-auto">
           <button onClick={() => setSettingsActiveTab('Appearance')} className={`flex items-center gap-4 px-4 py-3 rounded-xl text-sm transition-all text-left font-medium ${settingsActiveTab === 'Appearance' ? 'bg-primary text-white shadow-lg shadow-primary/30' : 'hover:bg-white/10 dark:hover:bg-white/10 opacity-70 hover:opacity-100'}`}><Monitor className="w-5 h-5"/>{t('settings.appearance')}</button>
           <button onClick={() => setSettingsActiveTab('Terminal')} className={`flex items-center gap-4 px-4 py-3 rounded-xl text-sm transition-all text-left font-medium ${settingsActiveTab === 'Terminal' ? 'bg-primary text-white shadow-lg shadow-primary/30' : 'hover:bg-white/10 dark:hover:bg-white/10 opacity-70 hover:opacity-100'}`}><TerminalIcon className="w-5 h-5"/>{t('settings.terminal')}</button>
           <button onClick={() => setSettingsActiveTab('SSH')} className={`flex items-center gap-4 px-4 py-3 rounded-xl text-sm transition-all text-left font-medium ${settingsActiveTab === 'SSH' ? 'bg-primary text-white shadow-lg shadow-primary/30' : 'hover:bg-white/10 dark:hover:bg-white/10 opacity-70 hover:opacity-100'}`}><Network className="w-5 h-5"/>{t('settings.ssh')}</button>
           <button onClick={() => setSettingsActiveTab('System')} className={`flex items-center gap-4 px-4 py-3 rounded-xl text-sm transition-all text-left font-medium ${settingsActiveTab === 'System' ? 'bg-primary text-white shadow-lg shadow-primary/30' : 'hover:bg-white/10 dark:hover:bg-white/10 opacity-70 hover:opacity-100'}`}><Command className="w-5 h-5"/>{t('settings.general')}</button>
           
           <div className={`mt-4 pt-4 border-t ${isDark ? 'border-white/5' : 'border-black/5'}`}></div>
           
          <button onClick={() => setSettingsActiveTab('Security')} className={`flex items-center gap-4 px-4 py-3 rounded-xl text-sm transition-all text-left font-medium ${settingsActiveTab === 'Security' ? 'bg-red-500 text-white shadow-lg shadow-red-500/30' : 'hover:bg-white/10 dark:hover:bg-white/10 opacity-70 hover:opacity-100'}`}><ShieldAlert className="w-5 h-5"/>{t("settings.secureCenter")}</button>
           <button onClick={() => setSettingsActiveTab('Audit')} className={`flex items-center gap-4 px-4 py-3 rounded-xl text-sm transition-all text-left font-medium ${settingsActiveTab === 'Audit' ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/30' : 'hover:bg-white/10 dark:hover:bg-white/10 opacity-70 hover:opacity-100'}`}><Archive className="w-5 h-5"/>{t('settings.auditLogs')}</button>
           <button onClick={() => setSettingsActiveTab('Plugins')} className={`flex items-center gap-4 px-4 py-3 rounded-xl text-sm transition-all text-left font-medium ${settingsActiveTab === 'Plugins' ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/30' : 'hover:bg-white/10 dark:hover:bg-white/10 opacity-70 hover:opacity-100'}`}><Blocks className="w-5 h-5"/>{t('settings.plugins')}</button>
           
           <div className={`mt-4 pt-4 border-t ${isDark ? 'border-white/5' : 'border-black/5'}`}></div>
           
           <button onClick={() => setSettingsActiveTab('About')} className={`flex items-center gap-4 px-4 py-3 rounded-xl text-sm transition-all text-left font-medium ${settingsActiveTab === 'About' ? 'bg-primary text-white shadow-lg shadow-primary/30' : 'hover:bg-white/10 dark:hover:bg-white/10 opacity-70 hover:opacity-100'}`}><Info className="w-5 h-5"/>{t('settings.about')}</button>
        </nav>
      </div>

      {/* Settings Payload */}
      <div className="flex-1 flex flex-col relative bg-transparent min-w-0">
        {/* Navigation Buttons */}
        <div className="absolute right-10 top-10 z-30 flex items-center gap-3">
          <button
            onClick={goBack}
            disabled={historyIndex === 0}
            className={`p-2 rounded-xl transition-all border ${isDark ? 'border-white/10 bg-white/5 text-white/70 hover:bg-white/20 hover:text-white disabled:opacity-30 disabled:hover:bg-white/5' : 'border-black/10 bg-black/5 text-black/70 hover:bg-black/10 hover:text-black disabled:opacity-30 disabled:hover:bg-black/5'}`}
            title="Go Back"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={goForward}
            disabled={historyIndex === history.length - 1}
            className={`p-2 rounded-xl transition-all border ${isDark ? 'border-white/10 bg-white/5 text-white/70 hover:bg-white/20 hover:text-white disabled:opacity-30 disabled:hover:bg-white/5' : 'border-black/10 bg-black/5 text-black/70 hover:bg-black/10 hover:text-black disabled:opacity-30 disabled:hover:bg-black/5'}`}
            title="Go Forward"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Content Scroll Area */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="max-w-4xl mx-auto p-12 pb-24 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header Title */}
            <div className="mb-12">
              <h1 className="text-4xl font-black tracking-tight mb-2 flex items-center gap-4">
                {settingsActiveTab === 'Appearance' && <><Monitor className="w-8 h-8 text-primary"/> {t('settings.appearance')}</>}
                {settingsActiveTab === 'Terminal' && <><TerminalIcon className="w-8 h-8 text-primary"/> {t('settings.terminal')}</>}
                {settingsActiveTab === 'SSH' && <><Network className="w-8 h-8 text-primary"/> {t('settings.ssh')}</>}
                {settingsActiveTab === 'System' && <><Command className="w-8 h-8 text-primary"/> {t('settings.general')}</>}
                {settingsActiveTab === 'Security' && <><ShieldAlert className="w-8 h-8 text-red-500"/> {t("settings.secureCenter")}</>}
                {settingsActiveTab === 'Audit' && <><Archive className="w-8 h-8 text-orange-500"/> {t('settings.auditLogs')}</>}
                {settingsActiveTab === 'Plugins' && <><Blocks className="w-8 h-8 text-purple-500"/> {t('settings.plugins')}</>}
                {settingsActiveTab === 'About' && <><Info className="w-8 h-8 text-primary"/> {t('settings.about')}</>}
              </h1>
              <p className={`text-sm ${isDark ? 'text-white/50' : 'text-black/50'}`}>
                 Manage your GETSSH configuration and preferences.
              </p>
            </div>
          
          {settingsActiveTab === 'Appearance' && (
            <div className="space-y-8 max-w-xl">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1 opacity-70">{t('settings.language')}</label>
                  <select 
                    value={appConfig.language}
                    onChange={(e) => updateConfig('language', e.target.value)}
                    className={`w-full p-2 border rounded-lg text-sm outline-none shadow-sm focus:ring-2 focus:ring-primary/50 transition-colors ${isDark ? 'bg-black/50 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-800'}`}
                  >
                    <option value="en-US">English</option>
                    <option value="zh-CN">{t('appearance.langZh')}</option>
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
                        className={`w-8 h-8 rounded-full transition-all ${swatch.bg} ${
                          appConfig.themeColor === swatch.color 
                            ? 'ring-2 ring-offset-2 ring-primary dark:ring-offset-[#1e1e1e] ring-offset-slate-50 scale-105' 
                            : 'hover:scale-105'
                        }`}
                        title={swatch.name}
                      />
                    ))}
                    {/* Custom Color Picker */}
                    <div className="relative" title="Custom Color">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center overflow-hidden transition-all hover:scale-105 ${
                          !['168 85 247','34 197 94','59 130 246','239 68 68'].includes(appConfig.themeColor)
                            ? 'ring-2 ring-offset-2 ring-primary dark:ring-offset-[#1e1e1e] ring-offset-slate-50 scale-105'
                            : ''
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
                <label className="block text-sm font-medium mb-2 opacity-70">{t('settings.theme')}</label>
                <div className={`flex p-1 rounded-lg ${isDark ? 'bg-white/5' : 'bg-slate-200/50'}`}>
                  {(['system', 'light', 'dark'] as const).map(themeOpt => {
                     const active = appConfig.theme === themeOpt;
                     return (
                        <button 
                           key={themeOpt}
                           onClick={() => updateConfig('theme', themeOpt)} 
                           className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
                              active 
                                 ? (isDark ? 'bg-white/10 text-white shadow-sm' : 'bg-white text-slate-900 shadow-sm') 
                                 : (isDark ? 'text-white/50 hover:text-white/80' : 'text-slate-500 hover:text-slate-700')
                           }`}
                        >
                           {t(`settings.${themeOpt === 'system' ? 'systemTheme' : themeOpt}`)}
                        </button>
                     );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 opacity-70">{t('appearance.terminalTheme')}</label>
                <div className="flex gap-2">
                  <select 
                    value={appConfig.terminalTheme || 'default'}
                    onChange={(e) => updateConfig('terminalTheme', e.target.value)}
                    className={`flex-1 p-2 border rounded-lg text-sm outline-none shadow-sm focus:ring-2 focus:ring-primary/50 transition-colors ${isDark ? 'bg-black/50 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-800'}`}
                  >
                    <option value="default">{t('appearance.themeDefault')} (Transparent)</option>
                    <option disabled>───── Built-in ─────</option>
                    <option value="dracula">Dracula (Dark)</option>
                    <option value="nord">Nord (Arctic Blue)</option>
                    <option value="gruvbox">Gruvbox (Retro Warm)</option>
                    <option value="tokyo-night">Tokyo Night (Neon)</option>
                    <option value="catppuccin">Catppuccin (Pastel)</option>
                    <option value="monokai">Monokai (Sublime Classic)</option>
                    <option value="solarized">Solarized (Precision)</option>
                    {Object.keys(appConfig.customThemes || {}).length > 0 && (
                      <>
                        <option disabled>───── Custom ─────</option>
                        {Object.keys(appConfig.customThemes || {}).map(key => (
                          <option key={key} value={key}>{key.replace('custom_', '')}</option>
                        ))}
                      </>
                    )}
                  </select>
                  
                  <div className="relative flex items-center">
                    <input
                      type="file"
                      accept=".json"
                      onChange={handleImportTheme}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      title={t('appearance.importTheme') || 'Import Custom Theme'}
                    />
                    <button
                      className={`px-3 py-2 h-full rounded-lg text-sm font-medium border transition-colors flex items-center gap-2 ${isDark ? 'border-white/20 hover:bg-white/10 text-white' : 'border-black/20 hover:bg-black/5 text-black'}`}
                    >
                      <Download size={16} />
                    </button>
                  </div>
                  
                  {appConfig.terminalTheme?.startsWith('custom_') && (
                    <button
                      onClick={() => {
                        const newCustom = { ...(appConfig.customThemes || {}) };
                        delete newCustom[appConfig.terminalTheme];
                        updateConfig('customThemes', newCustom);
                        updateConfig('terminalTheme', 'default');
                      }}
                      className="px-3 py-2 rounded-lg text-sm font-medium border border-red-500/50 hover:bg-red-500/10 text-red-500 transition-colors"
                      title={t('appearance.deleteTheme') || 'Delete Theme'}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-2 pt-2 border-t border-black/5 dark:border-white/5">
                <div className="flex items-center justify-between">
                  <label className={`text-sm font-medium ${!isDark ? 'opacity-40' : 'opacity-70'}`}>
                    {t('appearance.enableGlassmorphism')}
                  </label>
                  <button 
                    disabled={!isDark}
                    onClick={() => updateConfig('enableGlassmorphism', !appConfig.enableGlassmorphism)}
                    className={`relative w-11 h-6 rounded-full transition-colors ${!isDark ? 'bg-slate-200 cursor-not-allowed' : appConfig.enableGlassmorphism ? 'bg-primary' : 'bg-black/20 dark:bg-white/10'}`}
                  >
                    <div className={`absolute top-1 left-1 bg-white shadow-sm w-4 h-4 rounded-full transition-transform ${appConfig.enableGlassmorphism && isDark ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
                {!isDark ? (
                  <div className="text-xs text-orange-500/80 font-medium">
                    * {t('appearance.glassmorphismOnlyDark')}
                  </div>
                ) : (
                  appConfig.enableGlassmorphism && (
                    <div className="mt-4">
                      <div className="flex justify-between items-center mb-3">
                        <label className="text-sm font-medium opacity-70">{t('appearance.glassmorphismOpacity')}</label>
                        <span className="text-xs font-bold opacity-50">{Math.round((appConfig.bgOpacity || 1) * 100)}%</span>
                      </div>
                      <input 
                        type="range" min="0.3" max="1" step="0.05" 
                        value={appConfig.bgOpacity || 1}
                        onChange={(e) => updateConfig('bgOpacity', parseFloat(e.target.value) || 0.8)}
                        className="w-full h-1.5 bg-slate-200 dark:bg-white/10 rounded-lg appearance-none cursor-pointer accent-primary"
                      />
                    </div>
                  )
                )}
                <div className="pt-4 border-t border-black/5 dark:border-white/5">
                  <label className="flex items-center justify-between cursor-pointer">
                    <div className="flex flex-col">
                      <span className={`text-sm font-medium ${!isDark ? 'opacity-40' : 'opacity-70'}`}>{t('settings.antiGlare')}</span>
                      <span className="text-xs opacity-50">{t('settings.antiGlareDesc')}</span>
                    </div>
                    <button 
                      disabled={!isDark}
                      onClick={() => updateConfig('antiGlare', !appConfig.antiGlare)} 
                      className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${!isDark ? 'bg-slate-200 cursor-not-allowed' : appConfig.antiGlare ? 'bg-primary' : 'bg-black/20 dark:bg-white/10'}`}
                    >
                      <div className={`absolute top-1 left-1 bg-white shadow-sm w-4 h-4 rounded-full transition-transform ${appConfig.antiGlare ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </label>
                </div>
              </div>
            </div>
          )}

          {settingsActiveTab === 'Terminal' && (
            <div className="space-y-8 max-w-xl">
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={appConfig.copyOnSelect || false} onChange={(e) => updateConfig('copyOnSelect', e.target.checked)} className="w-4 h-4 accent-primary rounded" />
                <div>
                  <div className="text-sm font-medium">{t('terminal.copyOnSelect')}</div>
                  <div className="text-xs opacity-50">{t('terminal.copyOnSelectDesc')}</div>
                </div>
              </label>

              <div>
                <label className="block text-sm font-medium mb-1 opacity-70">{t('terminal.rightClickBehavior')}</label>
                <select 
                  value={appConfig.rightClickBehavior || 'menu'}
                  onChange={(e) => updateConfig('rightClickBehavior', e.target.value as any)}
                  className={`w-full p-2 border rounded-none text-sm outline-none transition-colors ${isDark ? 'bg-black/50 border-white/10 text-white' : 'bg-white border-black/10 text-black'}`}
                >
                   <option value="menu">{t('terminal.rightClickMenu')}</option>
                   <option value="paste">{t('terminal.rightClickPaste')}</option>
                </select>
              </div>

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
                  className={`w-full p-2 border rounded-none text-sm outline-none transition-colors ${isDark ? 'bg-black/50 border-white/10 text-white' : 'bg-white border-black/10 text-black'}`}
                >
                   <option value="block">{t('terminal.block')}</option>
                   <option value="underline">{t('terminal.underline')}</option>
                   <option value="bar">{t('terminal.bar')}</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 opacity-70 flex justify-between">
                  <span>{t('terminal.terminalPadding')}</span>
                  <span>{appConfig.terminalPadding ?? 8}px</span>
                </label>
                <input 
                  type="range" 
                  min="0" max="32" step="2" 
                  value={appConfig.terminalPadding ?? 8} 
                  onChange={(e) => updateConfig('terminalPadding', parseInt(e.target.value))} 
                  className={`w-full h-2 rounded-none appearance-none outline-none ${isDark ? 'bg-white/10' : 'bg-black/10'}`} 
                />
                <div className="text-xs opacity-50 mt-1">{t('terminal.terminalPaddingDesc')}</div>
              </div>

              <label className="flex items-center gap-3 cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={appConfig.cursorBlink ?? true} 
                  onChange={(e) => updateConfig('cursorBlink', e.target.checked)} 
                  className="w-4 h-4 rounded-none accent-primary border-none" 
                />
                <div>
                  <div className="text-sm font-medium">{t('terminal.cursorBlink')}</div>
                  <div className="text-xs opacity-50">{t('terminal.cursorBlinkDesc')}</div>
                </div>
              </label>

              <div>
                <label className="block text-sm font-medium mb-1 opacity-70">{t('terminal.bellStyle')}</label>
                <select 
                  value={appConfig.bellStyle || 'visual'}
                  onChange={(e) => updateConfig('bellStyle', e.target.value as any)}
                  className={`w-full p-2 border rounded-none text-sm outline-none transition-colors ${isDark ? 'bg-black/50 border-white/10 text-white' : 'bg-white border-black/10 text-black'}`}
                >
                   <option value="none">{t('terminal.bellNone')}</option>
                   <option value="audible">{t('terminal.bellAudible')}</option>
                   <option value="visual">{t('terminal.bellVisual')}</option>
                </select>
                <div className="text-xs opacity-50 mt-1">{t('terminal.bellStyleDesc')}</div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 opacity-70">{t('terminal.scrollback')}</label>
                <input type="number" min="1000" step="1000" value={appConfig.scrollback || 10000} onChange={(e) => updateConfig('scrollback', parseInt(e.target.value) || 10000)} className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/10' : 'bg-white border-black/10'}`} />
                <div className="text-xs opacity-50 mt-1 text-yellow-500 dark:text-yellow-400">{t('terminal.scrollbackNote')}</div>
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
              <div>
                <label className="block text-sm font-medium mb-1 opacity-70">SFTP Default Download Path</label>
                <div className="flex gap-2">
                  <input type="text" readOnly value={appConfig.sftpDownloadPath || ''} placeholder="Default (Downloads Folder)" className={`flex-1 p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/10' : 'bg-white border-black/10'}`} />
                  <button onClick={async () => {
                    const p = await window.electronAPI.selectFolder();
                    if (p) updateConfig('sftpDownloadPath', p);
                  }} className={`px-3 py-1 rounded text-sm transition-all ${isDark ? 'bg-white/10 hover:bg-white/20' : 'bg-black/5 hover:bg-black/10'}`}>
                    Browse
                  </button>
                  {appConfig.sftpDownloadPath && (
                    <button onClick={() => updateConfig('sftpDownloadPath', '')} className="px-3 py-1 rounded text-sm transition-all text-red-500 hover:bg-red-500/20">
                      Clear
                    </button>
                  )}
                </div>
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
                <input type="text" value={appConfig.globalHotkey || 'Control+`'} onChange={(e) => updateConfig('globalHotkey', e.target.value)} className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/10' : 'bg-white border-black/10'}`} />
                <div className="text-xs opacity-50 mt-1">{t('system.globalHotkeyDesc')}</div>
              </div>

              {/* Added Danger Zone */}
              <div className="pt-6 border-t border-red-500/20">
                <h4 className="text-red-500 font-bold text-sm mb-4 flex items-center gap-2"><Shield className="w-4 h-4"/>{t('settings.pluginSecurityMode')}</h4>
                <label className="flex items-center justify-between p-4 rounded-xl border border-red-500/20 bg-red-500/5">
                  <div className="flex flex-col w-2/3 pr-4">
                    <span className="text-sm font-bold text-red-500">{t('settings.pluginSecurityStrategy')}</span>
                    <span className="text-xs opacity-70 mt-1">
                      {t('settings.pluginSecurityDesc')}
                    </span>
                  </div>
                  <div className="w-1/3">
                    <select 
                      value={appConfig.pluginSecurityMode || 'normal'}
                      onChange={async (e) => {
                        const newMode = e.target.value as 'safe' | 'strict' | 'normal' | 'developer';
                        let finalToken = undefined;
                        if (newMode === 'developer') {
                          if (!window.confirm(
                            "🚨 警告: 开发者模式 (Developer Mode) 🚨\n\n" +
                            "启用此模式将完全关闭 Node.js VM 沙箱隔离！\n" +
                            "插件将获得原生 require() 能力，可直接访问文件系统与系统进程。\n" +
                            "仅在调试您自己编写的信任代码时开启此模式。\n\n" +
                            "您确定要继续吗？"
                          )) return;
                        }

                        if (newMode === 'safe' || newMode === 'developer') {
                          // Intercept with Biometric / Master Password ONLY if encryption is enabled
                          if (!encryptionDisabled) {
                            if (window.electronAPI?.promptBiometricUnlock) {
                              const res = await window.electronAPI.promptBiometricUnlock();
                              if (!res.success) {
                                if (res.reason === 'unsupported' || res.reason === 'no_key') {
                                  // Fallback to Master Password prompt
                                  const inputPwd = window.prompt("Biometric unlock unavailable. Please enter your Master Password to verify your identity:");
                                  if (!inputPwd) return; // Cancelled
                                  finalToken = inputPwd;
                                } else {
                                  return; // Cancelled or failed, do not update state
                                }
                              }
                            } else {
                              if (!window.confirm(`WARNING: Are you sure you want to change to ${newMode} mode?`)) return;
                            }
                          } else {
                            if (newMode === 'safe' && !window.confirm(`WARNING: You are switching to safe mode without a Master Password set. Are you sure?`)) return;
                          }
                        }
                        
                        if (window.electronAPI?.updateBackendConfig) {
                          window.electronAPI.updateBackendConfig({ pluginSecurityMode: newMode }, finalToken);
                        }
                        updateConfig('pluginSecurityMode', newMode);
                        
                        if (newMode === 'safe') {
                          setTimeout(() => window.alert(t('settings.pluginSecurityRestartReq')), 100);
                        } else {
                          // Hot Swap
                          if (window.electronAPI?.reloadPlugins) {
                            await window.electronAPI.reloadPlugins();
                            window.alert("Plugins reloaded successfully under the new security mode.");
                          }
                        }
                      }}
                      className={`w-full p-2 border border-red-500/30 rounded-md text-sm outline-none transition-colors ${isDark ? 'bg-black/50 text-red-400' : 'bg-white text-red-600'}`}
                    >
                      <option value="safe">{t('settings.pluginSecuritySafe')}</option>
                      <option value="strict">{t('settings.pluginSecurityStrict')}</option>
                      <option value="normal">{t('settings.pluginSecurityNormal')}</option>
                      <option value="developer">{t('settings.pluginSecurityDeveloper')}</option>
                    </select>
                  </div>
                </label>
              </div>
            </div>
          )}

          {settingsActiveTab === 'Security' && (
            <div className="w-full max-w-4xl flex flex-col gap-6">
              {securePage === 'dashboard' ? (
                <>
                  {isPolluted && (
                    <div className={`w-full mb-2 p-4 rounded-2xl flex items-center gap-3 border ${
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
                  <button onClick={() => setSecurePage('shield_details')} className={`w-full p-8 rounded-[30px] flex flex-col items-center justify-center gap-4 transition-all shadow-inner group cursor-pointer border ${
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
                    <button onClick={() => setSecurePage('rasp')} className={`p-6 rounded-[20px] border text-left transition-all group ${isDark ? 'border-white/10 hover:bg-white/5' : 'border-black/10 hover:bg-black/5 hover:border-black/20'}`}>
                      <div className="flex items-center gap-3 mb-3"><Cpu className="w-6 h-6 text-red-500 drop-shadow-md" /><span className="font-bold text-lg">{t("security.raspTitle")}</span></div>
                      <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.raspDesc")}</p>
                    </button>
                    <button onClick={() => setSecurePage('privacy')} className={`p-6 rounded-[20px] border text-left transition-all group ${isDark ? 'border-white/10 hover:bg-white/5' : 'border-black/10 hover:bg-black/5 hover:border-black/20'}`}>
                      <div className="flex items-center gap-3 mb-3"><EyeOff className="w-6 h-6 text-blue-500 drop-shadow-md" /><span className="font-bold text-lg">{t("security.privacyTitle")}</span></div>
                      <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.privacyDesc")}</p>
                    </button>
                    <button onClick={() => { setSafeAction('none'); setSecurePage('safestorage'); }} className={`p-6 rounded-[20px] border text-left transition-all group ${isDark ? 'border-white/10 hover:bg-white/5' : 'border-black/10 hover:bg-black/5 hover:border-black/20'}`}>
                      <div className="flex items-center gap-3 mb-3"><Lock className="w-6 h-6 text-green-500 drop-shadow-md" /><span className="font-bold text-lg">{t("security.safeStorageTitle")}</span></div>
                      <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.safeStorageDesc")}</p>
                    </button>
                    <button onClick={() => setSecurePage('export')} className={`p-6 rounded-[20px] border text-left transition-all group ${isDark ? 'border-white/10 hover:bg-white/5' : 'border-black/10 hover:bg-black/5 hover:border-black/20'}`}>
                      <div className="flex items-center gap-3 mb-3"><FileJson className="w-6 h-6 text-orange-500 drop-shadow-md" /><span className="font-bold text-lg">{t("security.exportTitle")}</span></div>
                      <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.exportDesc")}</p>
                    </button>
                    <button onClick={() => setSecurePage('known_hosts')} className={`p-6 rounded-[20px] border text-left transition-all group col-span-2 ${isDark ? 'border-white/10 hover:bg-white/5' : 'border-black/10 hover:bg-black/5 hover:border-black/20'}`}>
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
                          className={`w-full p-4 border rounded-[20px] text-sm outline-none resize-none font-mono ${isDark ? 'bg-black/50 border-white/10' : 'bg-white border-black/10'}`} 
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
                        <div className={`relative p-6 rounded-[20px] border flex gap-4 ${isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'} ${watchdogStatus?.watchdogDisabled ? 'grayscale opacity-50 cursor-not-allowed' : ''}`}>
                          {watchdogStatus?.watchdogDisabled && (
                            <div className="absolute top-2 right-4 px-2 py-1 bg-red-500/20 text-red-500 border border-red-500/30 rounded-md text-[10px] font-black uppercase tracking-widest shadow-sm">
                              Unavailable
                            </div>
                          )}
                          <div className="shrink-0"><Cpu className="w-6 h-6 text-red-500 drop-shadow-md"/></div>
                          <div>
                            <h5 className="font-bold text-lg mb-1">{t("security.shieldDetailsWatchdog", "The Rust Watchdog")}</h5>
                            <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.shieldDetailsWatchdogDesc", "底层的 Rust 二进制看门狗进程。若主进程引擎被恶意代码挂起或停止心跳超过 5 秒，系统将立刻触发底层系统调用 (SIGKILL) 将被污染的内存物理强杀。")}</p>
                          </div>
                        </div>
                        <div className={`p-6 rounded-[20px] border flex gap-4 ${isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'}`}>
                          <div className="shrink-0"><Lock className="w-6 h-6 text-green-500 drop-shadow-md"/></div>
                          <div>
                            <h5 className="font-bold text-lg mb-1">{t("security.shieldDetailsCrypto", "AES-256-GCM 物理加密")}</h5>
                            <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.shieldDetailsCryptoDesc", "您的所有连接凭证与私钥均使用 SafeStorage 与 AES-256-GCM 算法进行极强度的本地加密，密钥不会上传至任何云端。")}</p>
                          </div>
                        </div>
                        <div className={`p-6 rounded-[20px] border flex gap-4 ${isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'}`}>
                          <div className="shrink-0"><EyeOff className="w-6 h-6 text-blue-500 drop-shadow-md"/></div>
                          <div>
                            <h5 className="font-bold text-lg mb-1">{t("security.shieldDetailsZeroize", "内存即焚 (Zeroize)")}</h5>
                            <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.shieldDetailsZeroizeDesc", "当数据不再使用时，系统通过底层的 zeroize 机制在微秒级别内覆写内存地址，防止通过内存快照 (Memory Dump) 还原您的机密信息。")}</p>
                          </div>
                        </div>
                        <div className={`p-6 rounded-[20px] border flex gap-4 ${isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'}`}>
                          <div className="shrink-0"><Server className="w-6 h-6 text-purple-500 drop-shadow-md"/></div>
                          <div>
                            <h5 className="font-bold text-lg mb-1">{t("security.shieldDetailsNetwork", "Zero-copy (零拷贝) 网络引擎")}</h5>
                            <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.shieldDetailsNetworkDesc", "抛弃低效不安全的传统 Node.js I/O 流，全面转向底层 Rust N-API 原生 Buffer 共享直连，阻断流量在 JS 引擎中的滞留泄露风险。")}</p>
                          </div>
                        </div>
                        <div className={`p-6 rounded-[20px] border flex gap-4 ${isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'}`}>
                          <div className="shrink-0"><ShieldAlert className="w-6 h-6 text-orange-500 drop-shadow-md"/></div>
                          <div>
                            <h5 className="font-bold text-lg mb-1">{t("security.shieldDetailsRasp", "RASP 运行态主动防御")}</h5>
                            <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.shieldDetailsRaspDesc", "动态监控应用运行时的系统调用与执行流，精准拦截针对 Node.js 引擎的恶意代码注入及越权访问。")}</p>
                          </div>
                        </div>
                        <div className={`p-6 rounded-[20px] border flex flex-col gap-4 ${isDark ? 'bg-white/5 border-white/10' : 'bg-black/5 border-black/10'}`}>
                          <div className="flex gap-4">
                            <div className="shrink-0"><Activity className="w-6 h-6 text-cyan-500 drop-shadow-md"/></div>
                            <div className="flex-1">
                              <h5 className="font-bold text-lg mb-1">{t("security.shieldDetailsMemory", "底层内存完整性校验 (Native Memory Scanner)")}</h5>
                              <p className="text-sm opacity-60 leading-relaxed font-medium">{t("security.shieldDetailsMemoryDesc", "直接穿透进程边界，定期校验关键系统函数内存首字节，从根本上粉碎任何 Inline Hook 企图。")}</p>
                            </div>
                          </div>
                          {/* Placeholder button for future Native Scanner activation */}
                          <div className="mt-2 flex justify-end">
                            <button className="px-4 py-2 bg-cyan-600/20 hover:bg-cyan-600/40 text-cyan-500 border border-cyan-500/30 rounded-xl text-xs font-bold transition-all flex items-center gap-2">
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
                      <label className="flex items-center gap-4 cursor-pointer p-4 rounded-xl border border-transparent hover:border-black/5 dark:hover:border-white/5 transition-colors">
                        <input type="checkbox" checked={appConfig.privacyMode || false} onChange={(e) => updateConfig('privacyMode', e.target.checked)} className="w-5 h-5 accent-primary rounded" />
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
                          className={`w-full p-3 border rounded-xl text-sm font-medium outline-none shadow-sm focus:ring-2 focus:ring-primary/50 transition-colors ${isDark ? 'bg-black/50 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-800'}`}
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
                                  <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSafeAction('change'); setSafeError(''); setSafeOldPwd(''); setSafeNewPwd(''); }} className={`py-3 px-5 text-sm font-bold rounded-xl border-0 transition-all shadow-sm ${isDark ? 'bg-white/10 hover:bg-white/20' : 'bg-black/5 hover:bg-black/10'}`}>
                                     {t('security.changeMasterPwd')}
                                  </button>
                                  <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSafeAction('disable'); setSafeError(''); setSafeOldPwd(''); }} className="py-3 px-5 text-sm font-bold rounded-xl border-0 text-red-500 hover:bg-red-500/10 transition-all">
                                     {t('security.disableEncryption')}
                                  </button>
                                </>
                             ) : (
                                <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSafeAction('enable'); setSafeError(''); setSafeNewPwd(''); }} className={`py-3 px-5 text-sm font-bold rounded-xl border-0 bg-primary hover:bg-primary/90 text-white transition-all shadow-lg shadow-primary/30`}>
                                   {t('security.enableEncryption')}
                                </button>
                             )}
                           </div>
                        ) : (
                           <div className={`p-6 rounded-2xl border space-y-4 shadow-sm ${isDark ? 'border-white/10 bg-black/20' : 'border-black/10 bg-white'}`}>
                             {safeError && <div className="text-red-500 text-xs font-bold bg-red-500/10 p-2 rounded-lg">{safeError}</div>}
                             
                             {(safeAction === 'change' || safeAction === 'disable') && (
                                <div>
                                  <label className="block text-xs font-bold mb-2 opacity-70">{t('security.currentPwd')}</label>
                                  <input autoFocus type="password" value={safeOldPwd} onChange={e => setSafeOldPwd(e.target.value)} className={`w-full p-3 border rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-primary/50 transition-all ${isDark ? 'bg-black/50 border-white/10' : 'bg-white border-black/10'}`} />
                                </div>
                             )}
                             
                             {(safeAction === 'change' || safeAction === 'enable') && (
                                <div>
                                  <label className="block text-xs font-bold mb-2 opacity-70">{t('security.newPwd')}</label>
                                  <input autoFocus={safeAction === 'enable'} type="password" value={safeNewPwd} onChange={e => setSafeNewPwd(e.target.value)} className={`w-full p-3 border rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-primary/50 transition-all ${isDark ? 'bg-black/50 border-white/10' : 'bg-white border-black/10'}`} />
                                </div>
                             )}

                             {safeAction === 'disable' && (
                                <div className="text-xs text-red-500 font-bold bg-red-500/10 p-3 rounded-lg leading-relaxed">{t('security.warningPlaintext')}</div>
                             )}

                             <div className="flex gap-3 pt-3">
                                <button onClick={() => setSafeAction('none')} className={`flex-1 py-2.5 px-4 text-sm font-bold rounded-xl border transition-all ${isDark ? 'border-white/20 hover:bg-white/10' : 'border-black/20 hover:bg-black/5'}`}>{t('security.cancel')}</button>
                                <button onClick={handleConfirmSafeAction} className="flex-1 py-2.5 px-4 text-sm font-bold rounded-xl bg-primary hover:bg-primary/90 text-white transition-all shadow-md">{t('security.confirm')}</button>
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
                          <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-bold shadow-sm ${
                            profilesStatus.type === 'success'
                              ? 'bg-green-500/15 text-green-500 border border-green-500/20'
                              : 'bg-red-500/15 text-red-500 border border-red-500/20'
                          }`}>
                            {profilesStatus.msg}
                          </div>
                        )}

                        {encryptionDisabled && (
                          <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-bold flex items-center gap-3 shadow-sm ${
                            isDark ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' : 'bg-yellow-50 text-yellow-600 border border-yellow-200'
                          }`}>
                            <Shield className="w-5 h-5 shrink-0" />
                            <span>{t('settings.exportNeedPwd')}</span>
                          </div>
                        )}

                        <div className="flex gap-4">
                          <button
                            onClick={async () => {
                              setProfilesStatus(null);
                              const res = await window.electronAPI.exportProfiles({
                                sessions,
                                masterPassword,
                              });
                              if (res.success) {
                                setProfilesStatus({ type: 'success', msg: t('settings.exportSuccess', { count: res.count }) as string });
                              } else if (res.reason !== 'canceled') {
                                setProfilesStatus({ type: 'error', msg: t('settings.exportFailed', { reason: res.reason }) as string });
                              }
                            }}
                            disabled={encryptionDisabled || sessions.length === 0}
                            title={encryptionDisabled ? (t('settings.exportTooltipDisabled') as string) : (t('settings.exportTooltipEnabled') as string)}
                            className={`flex items-center justify-center flex-1 gap-2 py-3 px-4 text-sm font-bold rounded-xl transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed ${
                              isDark ? 'bg-white/10 hover:bg-white/20' : 'bg-black/5 hover:bg-black/10'
                            }`}
                          >
                            <Download className="w-4 h-4" /> {t('settings.exportBtn')}
                          </button>

                          <button
                            onClick={() => {
                              setProfilesStatus(null);
                              setImportPwd('');
                              setImportPwdModal(true);
                            }}
                            className={`flex items-center justify-center flex-1 gap-2 py-3 px-4 text-sm font-bold rounded-xl transition-all shadow-sm ${
                              isDark ? 'bg-white/10 hover:bg-white/20' : 'bg-black/5 hover:bg-black/10'
                            }`}
                          >
                            <Upload className="w-4 h-4" /> {t('settings.importBtn')}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {securePage === 'known_hosts' && (
                    <div className="space-y-6">
                      <h4 className="text-xl font-black flex items-center gap-2"><Server className="w-6 h-6 text-purple-500"/> {t("security.knownHostsTitle")}</h4>
                      <div className={`rounded-xl border shadow-sm ${isDark ? 'border-white/10 bg-black/20' : 'border-black/10 bg-white'} overflow-hidden max-w-4xl`}>
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className={`text-xs uppercase tracking-wider font-bold opacity-60 ${isDark ? 'bg-black/40 border-white/5' : 'bg-slate-50 border-black/5'} border-b`}>
                              <th className="p-4">{t('security.host')}</th>
                              <th className="p-4">{t('security.fingerprint')}</th>
                              <th className="p-4">{t('security.trustedAt')}</th>
                              <th className="p-4 text-center">{t('security.revokeTrust')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {knownHosts.length === 0 ? (
                              <tr>
                                <td colSpan={4} className="p-10 text-center text-sm font-medium opacity-50">
                                  {t('security.knownHostsEmpty')}
                                </td>
                              </tr>
                            ) : (
                              knownHosts.map(h => {
                                const hostKey = `${h.host}:${h.port}`;
                                return (
                                <tr key={hostKey} className={`border-b last:border-b-0 ${isDark ? 'border-white/5 hover:bg-white/5' : 'border-black/5 hover:bg-black/5'} transition-colors`}>
                                  <td className="p-4 text-sm font-bold">
                                    <div>{h.host}</div>
                                    <div className="text-xs opacity-50 font-mono mt-1">Port: {h.port}</div>
                                  </td>
                                  <td className="p-4 max-w-[300px]">
                                    <div className="flex items-start gap-2">
                                      <code className={`flex-1 text-xs font-mono font-medium break-all ${isDark ? 'text-white/70' : 'text-black/70'}`}>
                                        {h.fingerprint}
                                      </code>
                                      <button 
                                        onClick={() => navigator.clipboard.writeText(h.fingerprint)} 
                                        className={`p-2 rounded-lg border transition-colors ${isDark ? 'border-white/20 hover:bg-white/10' : 'border-black/20 hover:bg-black/5'}`}
                                        title="Copy Fingerprint"
                                      >
                                        <Copy className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </td>
                                  <td className="p-4 text-xs font-medium opacity-70">
                                    {h.trustedAt ? new Date(h.trustedAt).toLocaleString() : 'N/A'}
                                  </td>
                                  <td className="p-4 text-center align-middle relative">
                                    {revokingHost === hostKey ? (
                                      <div className={`absolute top-1/2 right-full -translate-y-1/2 mr-3 w-72 p-4 rounded-xl border shadow-2xl z-10 ${isDark ? 'bg-black border-white/20 text-white' : 'bg-white border-black/20 text-black'}`}>
                                        <div className="text-sm mb-4 font-bold opacity-90 text-left">{t('security.revokeConfirm')}</div>
                                        <div className="flex gap-2 justify-end">
                                          <button onClick={() => setRevokingHost(null)} className="px-3 py-1.5 text-xs font-bold border border-transparent opacity-70 hover:opacity-100">{t('security.cancel')}</button>
                                          <button onClick={async () => {
                                            if (window.electronAPI.deleteKnownHost) {
                                              await window.electronAPI.deleteKnownHost(h.host, h.port);
                                              if (window.electronAPI.getKnownHosts) {
                                                const newHosts = await window.electronAPI.getKnownHosts();
                                                setKnownHosts(newHosts);
                                              }
                                            }
                                            setRevokingHost(null);
                                          }} className="px-4 py-1.5 text-xs font-black bg-red-500 hover:bg-red-600 text-white rounded-lg shadow-md">{t('security.confirm')}</button>
                                        </div>
                                      </div>
                                    ) : null}
                                    <button
                                      onClick={() => setRevokingHost(hostKey)}
                                      className={`px-4 py-2 rounded-lg text-xs font-bold border transition-colors ${isDark ? 'border-red-500/30 text-red-400 hover:bg-red-500 hover:text-white' : 'border-red-500/30 text-red-600 hover:bg-red-500 hover:text-white'}`}
                                    >
                                      {t('security.revokeTrust')}
                                    </button>
                                  </td>
                                </tr>
                              )})
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}


          {settingsActiveTab === 'Audit' && (
            <div className="space-y-6 w-full max-w-full">
              <div className="flex justify-between items-start mb-4 gap-4">
                <p className="text-sm opacity-70 max-w-lg leading-relaxed">{t('settings.auditDesc')}</p>
                <button 
                  onClick={async () => {
                    const ok = await window.electronAPI.exportConnectionLogs();
                    if (ok) alert(t('settings.auditExportSuccess'));
                  }}
                  className={`flex items-center shrink-0 whitespace-nowrap gap-2 px-4 py-2 font-mono text-sm font-bold uppercase tracking-wider rounded-none border transition-colors ${isDark ? 'bg-white text-black border-white hover:bg-slate-200' : 'bg-black text-white border-black hover:bg-slate-800'}`}
                >
                  <Download className="w-4 h-4" />
                  {t('settings.auditExport')}
                </button>
              </div>

              <div className={`border rounded-none overflow-x-auto w-full ${isDark ? 'border-white/20' : 'border-black/20'}`}>
                <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
                  <thead>
                    <tr className={`${isDark ? 'bg-white/10 text-white' : 'bg-black/10 text-black'} uppercase text-xs tracking-wider font-mono`}>
                      <th className={`p-3 font-semibold border-b ${isDark ? 'border-white/20' : 'border-black/20'}`}>{t('settings.auditSession')}</th>
                      <th className={`p-3 font-semibold border-b ${isDark ? 'border-white/20' : 'border-black/20'}`}>{t('settings.auditHost')}</th>
                      <th className={`p-3 font-semibold border-b ${isDark ? 'border-white/20' : 'border-black/20'}`}>{t('settings.auditConnectedAt')}</th>
                      <th className={`p-3 font-semibold border-b ${isDark ? 'border-white/20' : 'border-black/20'}`}>{t('settings.auditDisconnectedAt')}</th>
                      <th className={`p-3 font-semibold border-b text-right ${isDark ? 'border-white/20' : 'border-black/20'}`}>{t('settings.auditDuration')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedAuditLogs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-8 text-center opacity-50 italic">
                          No audit logs found.
                        </td>
                      </tr>
                    ) : (
                      paginatedAuditLogs.map((log, i) => (
                        <tr key={i} className={`border-b transition-colors ${isDark ? 'border-white/10 hover:bg-white/5' : 'border-black/10 hover:bg-black/5'} font-mono text-xs`}>
                          <td className="p-3 opacity-90 truncate max-w-[150px]" title={log.alias}>{log.alias}</td>
                          <td className="p-3 opacity-70 truncate max-w-[150px]" title={`${log.host}:${log.port}`}>{log.host}:{log.port}</td>
                          <td className="p-3 opacity-70">{log.connectedAt}</td>
                          <td className={`p-3 font-semibold ${log.disconnectedAt === 'Online' ? 'text-green-500' : 'opacity-70'}`}>
                            {log.disconnectedAt === 'Online' ? t('settings.auditOnline') : log.disconnectedAt}
                          </td>
                          <td className="p-3 opacity-90 text-right font-bold">{log.duration}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination Controls */}
              {auditLogs.length > ITEMS_PER_PAGE && (
                <div className={`flex items-center justify-between px-1 ${isDark ? 'text-white/60' : 'text-black/60'}`}>
                  <div className="text-xs font-mono opacity-60">
                    Total: {auditLogs.length} logs
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setAuditPage(p => Math.max(1, p - 1))}
                      disabled={auditPage === 1}
                      className={`px-3 py-1.5 rounded-none border text-xs font-bold uppercase transition-colors disabled:opacity-20 disabled:cursor-not-allowed ${isDark ? 'border-white/20 hover:bg-white/10 text-white' : 'border-black/20 hover:bg-black/10 text-black'}`}
                    >
                      Prev
                    </button>
                    <span className="text-xs font-mono mx-2">
                      {auditPage} / {totalAuditPages}
                    </span>
                    <button 
                      onClick={() => setAuditPage(p => Math.min(totalAuditPages, p + 1))}
                      disabled={auditPage === totalAuditPages}
                      className={`px-3 py-1.5 rounded-none border text-xs font-bold uppercase transition-colors disabled:opacity-20 disabled:cursor-not-allowed ${isDark ? 'border-white/20 hover:bg-white/10 text-white' : 'border-black/20 hover:bg-black/10 text-black'}`}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {settingsActiveTab === 'Plugins' && (
            <PluginSettings isDark={isDark} />
          )}

          {settingsActiveTab === 'About' && (
            <div className="flex flex-col items-center pt-8 max-w-2xl mx-auto space-y-10">
              {/* Header section */}
              <div className="flex flex-col items-center gap-3">
                <img src={logoSrc} alt="GETSSH Logo" className={`w-24 h-24 rounded-none shadow-xl border object-cover mb-2 ${isDark ? 'border-white/10' : 'border-black/10'}`} />
                <span className="text-4xl font-black tracking-tighter text-primary">GETSSH</span>
              </div>

              {/* Environment Information Grid */}
              <div className="w-full space-y-3">
                  <h3 className={`text-[10px] font-bold uppercase tracking-[0.3em] pl-1 mb-4 ${isDark ? 'text-primary/70' : 'text-primary/70'}`}>
                    {t('about.systemInfo')}
                  </h3>
                <div className={`grid grid-cols-2 gap-px border rounded-none overflow-hidden ${isDark ? 'bg-white/10 border-white/20 text-white/80' : 'bg-black/10 border-black/20 text-black/80'}`}>
                  {[
                    { label: t('about.envElectron'), value: window.electronAPI?.getEnvInfo?.()?.electron || 'N/A' },
                    { label: t('about.envChrome'), value: window.electronAPI?.getEnvInfo?.()?.chrome || 'N/A' },
                    { label: t('about.envNode'), value: window.electronAPI?.getEnvInfo?.()?.node || 'N/A' },
                    { label: t('about.versionCore'), value: 'V1.3.2 Preview (C9E2S)' },
                    { label: t('about.hostPlatform'), value: (() => {
                        const p = window.electronAPI?.getEnvInfo?.()?.platform;
                        const a = window.electronAPI?.getEnvInfo?.()?.arch;
                        if (!p) return 'N/A';
                        const osName = p === 'darwin' ? 'macOS' : p === 'win32' ? 'Windows' : p === 'linux' ? 'Linux' : p;
                        const archName = a === 'arm64' ? 'Apple Silicon / ARM64 (aarch64)' : a === 'x64' ? 'x86_64 (64-bit Intel/AMD)' : a === 'ia32' ? 'x86 (32-bit)' : a;
                        return `${osName} (${p}) — ${archName}`;
                      })() 
                    }
                  ].map((item, index) => (
                    <div key={item.label} className={`p-4 flex flex-col gap-1 ${isDark ? 'bg-[#1e1e1e]' : 'bg-white'} ${index === 4 ? 'col-span-2' : ''}`}>
                      <span className="text-[10px] uppercase tracking-widest opacity-50">{item.label}</span>
                      <span className="font-mono text-sm">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Compliance & Legal Module */}
              <div className="w-full space-y-3">
                <h3 className={`text-[10px] font-bold uppercase tracking-[0.3em] pl-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                  {t('about.compliance')}
                </h3>
                <div className="flex flex-col border border-black/10 dark:border-white/10 rounded-xl overflow-hidden">
                  {['Terms of Service', 'Privacy Policy', 'Third-Party Licenses'].map((doc) => {
                    const i18nMap = {
                        'Terms of Service': 'tos',
                        'Privacy Policy': 'privacy',
                        'Third-Party Licenses': 'licenses'
                    } as Record<string, string>;
                    return (
                      <button 
                        key={doc} 
                        onClick={() => window.electronAPI.openExternal(`https://github.com/JiangchenShen/GETSSH/blob/main/docs/legal/${doc.toUpperCase().replace(/ /g, '_').replace('-', '_')}.md`)}
                        className={`py-3 px-4 flex items-center justify-between border-t transition-all group ${isDark ? 'border-white/10 hover:bg-white/5' : 'border-black/5 hover:bg-black/5'}`}
                      >
                        <span className="text-sm font-medium opacity-80 group-hover:opacity-100 transition-opacity">
                          {t(`about.${i18nMap[doc] || doc.toLowerCase().replace(/ /g, '')}`)}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className={`text-[10px] leading-relaxed pt-2 px-1 ${isDark ? 'text-white/40' : 'text-black/40'}`} dangerouslySetInnerHTML={{ __html: t('about.openSourceDesc') as string }} />
              </div>

              {/* Update & Copyright */}
              <div className="w-full flex items-center justify-between pt-8 border-t border-black/10 dark:border-white/10">
                <div className={`text-[10px] tracking-wider uppercase font-medium ${isDark ? 'text-white/30' : 'text-black/30'}`}>
                  {t('about.copyright')}
                </div>
                <button 
                  onClick={async () => {
                    setCheckingUpdate(true);
                    try {
                      const res = await window.electronAPI.checkForUpdates();
                      if (res.hasUpdate) {
                         window.alert(t('update.found', { version: res.version }));
                         window.electronAPI.openExternal(res.url!);
                      } else if (res.error) {
                         window.alert(t('update.failed', { reason: res.error }));
                      } else {
                         window.alert(t('update.latest'));
                      }
                    } catch (e: any) {
                      window.alert(t('update.networkError', { message: e.message }));
                    } finally {
                      setCheckingUpdate(false);
                    }
                  }}
                  disabled={checkingUpdate}
                  className={`px-4 py-2 text-[10px] font-bold uppercase tracking-widest rounded-none border transition-all duration-200 ${
                    isDark ? 'border-white/20 hover:bg-white/10 text-white' : 'border-black/20 hover:bg-black/5 text-black'
                  }`}
                >
                  {checkingUpdate ? t('about.checkingUpdates') : t('about.checkUpdates')}
                </button>
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
            <h3 className="text-sm font-bold">{t('settings.importTitle')}</h3>
          </div>
          <p className="text-xs opacity-60">
            {t('settings.importHint')}
          </p>
          <input
            autoFocus
            type="password"
            placeholder={t('settings.importPwdPlaceholder') as string}
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
              {t('settings.importCancel')}
            </button>
            <button
              data-confirm
              onClick={async () => {
                setImportPwdModal(false);
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
                  const newOnes  = res.profiles.filter(p => !existing.has(`${p.host}::${p.username}`));
                  const merged   = [...sessions, ...newOnes];
                  setSessions(merged);
                  // Persist to disk
                  await window.electronAPI.saveProfiles({ masterPassword, payload: merged });
                  setProfilesStatus({
                    type: 'success',
                    msg: t('settings.importSuccessNew', { count: newOnes.length, skipped: res.profiles.length - newOnes.length }) as string,
                  });
                } else {
                  setProfilesStatus({ type: 'success', msg: t('settings.importSuccessEmpty') as string });
                }
                setImportPwd('');
              }}
              className="flex-1 py-2 text-sm rounded-xl bg-primary hover:bg-primary/80 text-white transition-all shadow-md"
            >
              {t('settings.importConfirm')}
            </button>
          </div>
        </div>
      </div>
    )}
    
          </div>
    </>
  );
};
