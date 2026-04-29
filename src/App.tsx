import React, { useState, useEffect, useRef } from 'react';
import { Terminal as TerminalComponent } from './components/Terminal';
import { TerminalSquare, Server, Plus, X, Search, Settings, Monitor, Terminal as TerminalIcon, Network, Command, Zap, Cpu, Shield, Blocks, Info } from 'lucide-react';
import { PluginSettings } from './components/PluginSettings';
import { usePluginStore } from './store/pluginStore';
import { useTranslation } from 'react-i18next';
import { CryptoModal } from './components/CryptoModal';

interface Tab {
  id: string; // sessionId
  title: string;
  config: any;
}

export interface AppConfig {
  language: string;
  themeColor: string;
  theme: 'system' | 'light' | 'dark';
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  bgOpacity: number;
  copyOnSelect: boolean;
  cursorStyle: 'block' | 'underline' | 'bar';
  scrollback: number;
  keepalive: number;
  defaultPort: number;
  confirmQuit: boolean;
  globalHotkey: string;
  proxyType: 'none' | 'socks5' | 'http';
  proxyHost: string;
  proxyPort: number;
  privacyMode: boolean;
  initScript: string;
}

const DEFAULT_CONFIG: AppConfig = {
  language: 'en-US',
  themeColor: '168 85 247', // Default Purple
  theme: 'system',
  fontFamily: '"Fira Code", monospace, "Courier New", Courier',
  fontSize: 14,
  lineHeight: 1.2,
  bgOpacity: 0.8,
  copyOnSelect: false,
  cursorStyle: 'block',
  scrollback: 10000,
  keepalive: 15,
  defaultPort: 22,
  confirmQuit: false,
  globalHotkey: 'Option+Space',
  proxyType: 'none',
  proxyHost: '127.0.0.1',
  proxyPort: 1080,
  privacyMode: false,
  initScript: ''
};

function App() {
  const { t, i18n } = useTranslation();
  const [sessions, setSessions] = useState<{host: string, username: string, password?: string, privateKeyPath?: string, autoStart?: boolean, port?: number, useKeepAlive?: boolean}[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  
  // Theme state
  const [isDark, setIsDark] = useState(true);
  const [systemIsDark, setSystemIsDark] = useState(true);
  
  const [appConfig, setAppConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  
  // Settings modal
  const [showSettings, setShowSettings] = useState(false);
  const [settingsActiveTab, setSettingsActiveTab] = useState<'Appearance'|'Terminal'|'SSH'|'System'|'Security'|'Plugins'|'About'>('Appearance');
  const hasAutoStarted = useRef(false);
  const [isAppBlurred, setIsAppBlurred] = useState(false);

  const [selectedSessionIndex, setSelectedSessionIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Crypto State
  const [cryptoMode, setCryptoMode] = useState<'idle' | 'locked' | 'setup'>('idle');
  const [masterPassword, setMasterPassword] = useState('');
  const [encryptionDisabled, setEncryptionDisabled] = useState(false);
  
  const [safeAction, setSafeAction] = useState<'none'|'change'|'disable'|'enable'>('none');
  const [safeOldPwd, setSafeOldPwd] = useState('');
  const [safeNewPwd, setSafeNewPwd] = useState('');
  const [safeError, setSafeError] = useState('');

  useEffect(() => {
    const bootCrypto = async () => {
       const status = await window.electronAPI.checkProfiles();
       if (status === 'encrypted') {
          setCryptoMode('locked');
          setEncryptionDisabled(false);
       } else if (status === 'plain') {
          const plainSessions = await window.electronAPI.unlockProfiles('');
          setSessions(plainSessions);
          setEncryptionDisabled(true);
          setCryptoMode('idle');
       } else {
          setCryptoMode('idle');
       }
    };
    bootCrypto();

    try {
      const storedConf = localStorage.getItem('appConfig');
      if (storedConf) {
        setAppConfig({ ...DEFAULT_CONFIG, ...JSON.parse(storedConf) });
      } else {
        const legacyTheme = localStorage.getItem('themePref');
        if (legacyTheme) setAppConfig(prev => ({ ...prev, theme: legacyTheme as any }));
      }
    } catch {}

    // Boot Render Plugins
    const bootPlugins = async () => {
       const scripts = await window.electronAPI.getPluginRenderers();
       scripts.forEach(script => {
           if (script) {
               try { new Function(script)(); } catch(e) { console.error('Plugin Boot Error:', e); }
           }
       });
       const pluginAPI = (window as any).GETSSH_PLUGIN_API || [];
       pluginAPI.forEach((plugin: any) => {
           if (typeof plugin.init === 'function') {
               plugin.init({
                   registerSidebarAction: (id: string, icon: string, label: string, onClick: () => void) => {
                       usePluginStore.getState().registerSidebarAction({ id, icon, label, onClick });
                   }
               });
           }
       });
    };
    bootPlugins();

    // Init Theme Sync
    let unsubTheme: (() => void) | undefined;
    let unsubBlur: (() => void) | undefined;
    let unsubFocus: (() => void) | undefined;
    // @ts-ignore
    if (window.electronAPI && window.electronAPI.getTheme) {
      // @ts-ignore
      window.electronAPI.getTheme().then(setSystemIsDark);
      // @ts-ignore
      unsubTheme = window.electronAPI.onThemeChanged(setSystemIsDark);
      
      // @ts-ignore
      if (window.electronAPI.onAppBlur) {
        // @ts-ignore
        unsubBlur = window.electronAPI.onAppBlur(() => setIsAppBlurred(true));
        // @ts-ignore
        unsubFocus = window.electronAPI.onAppFocus(() => setIsAppBlurred(false));
      }
    }
    
    return () => {
      if (unsubTheme) unsubTheme();
      if (unsubBlur) unsubBlur();
      if (unsubFocus) unsubFocus();
    };
  }, []); // Run ONCE on mount

  // Watch i18n & Theme Color
  useEffect(() => {
    i18n.changeLanguage(appConfig.language);
    document.documentElement.style.setProperty('--primary-color', appConfig.themeColor);
  }, [appConfig.language, appConfig.themeColor]);

  // Auto-Start trigger
  useEffect(() => {
    if (sessions.length > 0 && !hasAutoStarted.current) {
        hasAutoStarted.current = true;
        const autoSessions = sessions.filter(s => s.autoStart);
        autoSessions.forEach(autoSession => {
            // Re-use connection layer logic directly without event dependency
            const config = { 
                host: autoSession.host, 
                username: autoSession.username, 
                password: autoSession.password, 
                privateKeyPath: autoSession.privateKeyPath,
                port: appConfig.defaultPort,
                keepaliveInterval: appConfig.keepalive * 1000,
                // Append Proxy
                proxyType: appConfig.proxyType,
                proxyHost: appConfig.proxyHost,
                autoStart: autoSession.autoStart,
                initScript: appConfig.initScript
            };
            
            // @ts-ignore
            window.electronAPI.sshConnect(config).then(res => {
               if (res.success && res.sessionId) {
                 const tabTitle = `${config.username}@${config.host}`;
                 setTabs(prev => {
                     // Check if not already existing
                     if(prev.find(t => t.id === res.sessionId)) return prev;
                     return [...prev, { id: res.sessionId as string, title: tabTitle, config }];
                 });
                 setActiveTabId(res.sessionId);
                 if (config.initScript) {
                     setTimeout(() => {
                        // @ts-ignore
                        window.electronAPI.sshWrite(res.sessionId, config.initScript + '\n');
                     }, 1500); // Allow shell load buffer
                 }
               }
            });
        });
    }
  }, [sessions, appConfig]);

  // Sync config effect
  useEffect(() => {
    localStorage.setItem('appConfig', JSON.stringify(appConfig));

    // Force CSS Theme
    const dark = appConfig.theme === 'system' ? systemIsDark : appConfig.theme === 'dark';
    setIsDark(dark);
    if (dark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    
    // Notify Main Process for Backend intercepts 
    // @ts-ignore
    if(window.electronAPI && window.electronAPI.updateBackendConfig) {
      // @ts-ignore
      window.electronAPI.updateBackendConfig({ confirmQuit: appConfig.confirmQuit, globalHotkey: appConfig.globalHotkey });
    }
  }, [appConfig, systemIsDark]);

  const updateConfig = <K extends keyof AppConfig>(key: K, val: AppConfig[K]) => {
    setAppConfig(prev => ({ ...prev, [key]: val }));
  };

  const syncProfiles = async (updatedSessions: any[]) => {
    setSessions(updatedSessions);
    if (masterPassword || encryptionDisabled) {
      await window.electronAPI.saveProfiles({ masterPassword: encryptionDisabled ? '' : masterPassword, payload: updatedSessions });
    } else {
      setCryptoMode('setup');
    }
  };

  const handleSetup = async (pwd: string) => {
     setMasterPassword(pwd);
     await window.electronAPI.saveProfiles({ masterPassword: pwd, payload: sessions });
     setCryptoMode('idle');
  };

  const handleUnlock = async (pwd: string) => {
     try {
       const decrypted = await window.electronAPI.unlockProfiles(pwd);
       setMasterPassword(pwd);
       setSessions(decrypted);
       setCryptoMode('idle');
       return true;
     } catch (e) {
       return false;
     }
  };

  const handleConnect = async (targetSession: any) => {
    setError(null);
    setConnecting(true);

    const config = { 
        host: targetSession.host, 
        username: targetSession.username, 
        password: targetSession.password, 
        privateKeyPath: targetSession.privateKeyPath,
        port: targetSession.port || appConfig.defaultPort || 22,
        keepaliveInterval: targetSession.useKeepAlive !== false ? (appConfig.keepalive * 1000) : 0,
        proxyType: appConfig.proxyType,
        proxyHost: appConfig.proxyHost,
        proxyPort: appConfig.proxyPort,
        initScript: appConfig.initScript
    };
    
    // @ts-ignore
    const res = await window.electronAPI.sshConnect(config);
    setConnecting(false);

    if (res.success && res.sessionId) {
      const tabTitle = `${config.username}@${config.host}`;
      setTabs(prev => [...prev, { id: res.sessionId as string, title: tabTitle, config }]);
      setActiveTabId(res.sessionId);
      setSelectedSessionIndex(null);
    } else {
      setError(res.error || 'Connection failed');
    }
  };

  const deleteSession = (e: React.MouseEvent, targetHost: string, targetUser: string) => {
    e.stopPropagation();
    const targetIdx = sessions.findIndex(s => s.host === targetHost && s.username === targetUser);
    if (selectedSessionIndex === targetIdx) setSelectedSessionIndex(null);
    else if (selectedSessionIndex !== null && selectedSessionIndex > targetIdx) setSelectedSessionIndex(selectedSessionIndex - 1);

    const updated = sessions.filter(s => s.host !== targetHost || s.username !== targetUser);
    syncProfiles(updated);
  };
  
  const toggleAutoStart = (e: React.MouseEvent, targetHost: string, targetUser: string) => {
    e.stopPropagation();
    const updated = sessions.map(s => {
       if(s.host === targetHost && s.username === targetUser) return { ...s, autoStart: !s.autoStart };
       return s;
    });
    syncProfiles(updated);
  };
  
  const closeTab = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    // @ts-ignore
    window.electronAPI.sshDisconnect(tabId);
    setTabs(prev => prev.filter(t => t.id !== tabId));
    if (activeTabId === tabId) {
      setActiveTabId(null);
    }
  };

  const filteredSessions = sessions.filter(s => `${s.username}@${s.host}`.toLowerCase().includes(searchQuery.toLowerCase()));

  // Dynamic Backdrop Opacity Color
  const appBgStyle = {
      backgroundColor: isDark 
        ? `rgba(0, 0, 0, ${appConfig.bgOpacity})` 
        : `rgba(255, 255, 255, ${appConfig.bgOpacity})`
  };

  return (
    <div className={`h-screen w-screen flex text-gray-900 dark:text-gray-100 backdrop-blur-xl relative overflow-hidden transition-all ${isAppBlurred && appConfig.privacyMode ? 'blur-2xl brightness-50 pointer-events-none' : ''}`} style={appBgStyle}>
      {(cryptoMode === 'locked' || cryptoMode === 'setup') && (
        <CryptoModal 
          mode={cryptoMode} 
          isDark={isDark} 
          onUnlock={handleUnlock} 
          onSetup={handleSetup} 
          onCancel={cryptoMode === 'setup' && sessions.length === 0 && !masterPassword ? undefined : () => {
              if (cryptoMode === 'setup') {
                 setEncryptionDisabled(true);
                 window.electronAPI.saveProfiles({ masterPassword: '', payload: sessions });
              }
              setCryptoMode('idle');
          }}
        />
      )}
      <div className="absolute top-0 left-0 right-0 h-8 z-40 flex items-center justify-center text-xs opacity-50 font-medium" style={{ WebkitAppRegion: 'drag' } as any}>
         GETSSH
      </div>

      {/* Left Sidebar */}
      <div className={`w-64 border-r flex flex-col p-4 pt-8 shrink-0 transition-colors ${isDark ? 'border-white/10 bg-black/40' : 'border-black/5 bg-white/40'}`}>
        <div className="flex items-center gap-2 mb-6">
          <TerminalSquare className="w-5 h-5 text-primary" />
          <h1 className="font-bold text-lg tracking-wider">GETSSH</h1>
        </div>

        <div className="relative mb-4">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} type="text" placeholder={t('sidebar.search')} className={`w-full pl-9 pr-3 py-1.5 rounded-md text-sm outline-none transition-colors ${isDark ? 'bg-white/5 border border-white/10 focus:border-primary placeholder:text-white/30' : 'bg-black/5 border border-black/10 focus:border-primary placeholder:text-black/30'}`} />
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto overflow-x-hidden">
          <div className="text-xs font-semibold uppercase tracking-wider mb-2 opacity-50 sticky top-0 backdrop-blur-md pt-1 pb-1 z-10">{t('sidebar.savedSessions')}</div>
          {filteredSessions.map((session, idx) => (
             <div key={idx} className={`w-full flex items-center justify-between gap-1 px-3 py-2 rounded-lg transition-all text-sm group ${selectedSessionIndex === idx ? 'bg-primary/20 text-primary border-l-4 border-primary shadow-sm' : isDark ? 'bg-white/5 hover:bg-white/10 border border-white/5 text-white/70 hover:text-white' : 'bg-white hover:bg-white/70 border border-black/5 shadow-sm text-black/70 hover:text-black'}`}>
               <button type="button" onClick={() => setSelectedSessionIndex(idx)} className="flex-1 flex items-center gap-2 truncate text-left">
                  <Server className="w-4 h-4 shrink-0" />
                  <span className="truncate flex-1">{session.username}@{session.host}</span>
               </button>
               <button onClick={(e) => toggleAutoStart(e, session.host, session.username)} className={`p-1 rounded-md transition-all ${session.autoStart ? 'text-yellow-400 opacity-100 hover:bg-yellow-400/20' : 'opacity-0 group-hover:opacity-100 hover:text-yellow-500 hover:bg-yellow-500/20'}`} title="Auto-start this session">
                 <Zap className="w-3.5 h-3.5" />
               </button>
               <button onClick={(e) => deleteSession(e, session.host, session.username)} className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 hover:bg-red-500/20 rounded-md transition-all">
                 <X className="w-3.5 h-3.5" />
               </button>
             </div>
          ))}
          
          <button type="button" onClick={() => {
              const newSession = { host: 'New Host', username: 'root', password: '', privateKeyPath: '', autoStart: false };
              const updated = [newSession, ...sessions];
              syncProfiles(updated);
              setSelectedSessionIndex(0);
          }} className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed transition-all text-sm text-left mt-4 ${isDark ? 'border-white/20 hover:border-white/50 text-white/50 hover:text-white' : 'border-black/20 hover:border-black/50 text-black/50 hover:text-black bg-white/50'}`}>
            <Plus className="w-4 h-4 shrink-0" />
            <span>{t('sidebar.newConnection')}</span>
          </button>
        </div>

        {/* Global Tools Slot */}
        <div className="pt-4 mt-4 border-t border-white/10 dark:border-white/10 border-black/5 flex justify-start gap-2 items-center z-10">
          <button onClick={() => setShowSettings(true)} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-white/10 text-white/50 hover:text-white' : 'hover:bg-black/5 text-black/50 hover:text-black'}`} title="Settings">
             <Settings className="w-5 h-5" />
          </button>
          <button onClick={() => { setShowSettings(true); setSettingsActiveTab('About'); }} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-white/10 text-white/50 hover:text-white' : 'hover:bg-black/5 text-black/50 hover:text-black'}`} title={t('settings.about')}>
             <Info className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Area */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {showSettings ? (
          <div className={`absolute inset-0 z-50 flex shadow-2xl overflow-hidden ${isDark ? 'bg-[#1e1e1e] text-white' : 'bg-gray-50 text-black'}`}>
            
            {/* Settings Sidebar */}
            <div className={`w-56 p-6 border-r ${isDark ? 'border-white/10 bg-black/20' : 'border-black/10 bg-gray-100'}`}>
              <h2 className="text-xl font-bold flex items-center gap-2 mb-8">
                <Settings className="w-5 h-5 text-primary" />
                {t('settings.title')}
              </h2>
              <nav className="flex flex-col gap-1">
                 <button onClick={() => setSettingsActiveTab('Appearance')} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all text-left ${settingsActiveTab === 'Appearance' ? 'bg-primary/20 text-primary font-medium' : 'hover:bg-black/10 dark:hover:bg-white/10 opacity-70 hover:opacity-100'}`}><Monitor className="w-4 h-4"/>{t('settings.appearance')}</button>
                 <button onClick={() => setSettingsActiveTab('Terminal')} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all text-left ${settingsActiveTab === 'Terminal' ? 'bg-primary/20 text-primary font-medium' : 'hover:bg-black/10 dark:hover:bg-white/10 opacity-70 hover:opacity-100'}`}><TerminalIcon className="w-4 h-4"/>{t('settings.terminal')}</button>
                 <button onClick={() => setSettingsActiveTab('SSH')} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all text-left ${settingsActiveTab === 'SSH' ? 'bg-primary/20 text-primary font-medium' : 'hover:bg-black/10 dark:hover:bg-white/10 opacity-70 hover:opacity-100'}`}><Network className="w-4 h-4"/>{t('settings.ssh')}</button>
                 <button onClick={() => setSettingsActiveTab('System')} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all text-left ${settingsActiveTab === 'System' ? 'bg-primary/20 text-primary font-medium' : 'hover:bg-black/10 dark:hover:bg-white/10 opacity-70 hover:opacity-100'}`}><Command className="w-4 h-4"/>{t('settings.system')}</button>
                 <button onClick={() => setSettingsActiveTab('Security')} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all text-left mt-2 border-t ${isDark ? 'border-white/10' : 'border-black/5'} pt-3 ${settingsActiveTab === 'Security' ? 'bg-primary/20 text-primary font-medium' : 'hover:bg-black/10 dark:hover:bg-white/10 opacity-70 hover:opacity-100'}`}><Cpu className="w-4 h-4"/>{t('settings.security')}</button>
                 <button onClick={() => setSettingsActiveTab('Plugins')} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all text-left ${settingsActiveTab === 'Plugins' ? 'bg-primary/20 text-primary font-medium' : 'hover:bg-black/10 dark:hover:bg-white/10 opacity-70 hover:opacity-100'}`}><Blocks className="w-4 h-4"/>{t('settings.plugins')}</button>
                 <button onClick={() => setSettingsActiveTab('About')} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all text-left ${settingsActiveTab === 'About' ? 'bg-primary/20 text-primary font-medium' : 'hover:bg-black/10 dark:hover:bg-white/10 opacity-70 hover:opacity-100'}`}><Info className="w-4 h-4"/>{t('settings.about')}</button>
              </nav>
            </div>

            {/* Settings Payload */}
            <div className="flex-1 flex flex-col relative bg-transparent">
              <button 
                  onClick={() => setShowSettings(false)} 
                  title="Close Settings"
                  className={`absolute right-6 top-6 z-50 p-2 rounded-md opacity-50 hover:opacity-100 ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/10'} transition-all`}
                  style={{ WebkitAppRegion: 'no-drag' } as any}
               >
                  <X className="w-6 h-6" />
              </button>
              
              <div className="p-10 overflow-y-auto w-full h-full pb-32">
                <h3 className="text-2xl font-bold mb-8 border-b pb-4 opacity-90 border-current">{t('settings.' + settingsActiveTab.toLowerCase() as any)} {t('settings.configuration')}</h3>
                
                {settingsActiveTab === 'Appearance' && (
                  <div className="space-y-8 max-w-xl">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium mb-1 opacity-70">{t('appearance.language')}</label>
                        <select 
                          value={appConfig.language}
                          onChange={(e) => updateConfig('language', e.target.value)}
                          className={`w-full p-2 border rounded-md text-sm outline-none transition-colors ${isDark ? 'bg-black/50 border-white/20 text-white' : 'bg-white border-black/20 text-black'}`}
                        >
                          <option value="en-US">English</option>
                          <option value="zh-CN">简体中文</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1 opacity-70">{t('appearance.systemColor')}</label>
                        <div className="flex items-center gap-2 mt-1">
                          {[
                            { name: 'Cyber Purple', color: '168 85 247', bg: 'bg-[#a855f7]' },
                            { name: 'Geek Green', color: '34 197 94', bg: 'bg-[#22c55e]' },
                            { name: 'Deep Blue', color: '59 130 246', bg: 'bg-[#3b82f6]' }
                          ].map(swatch => (
                            <button 
                              key={swatch.color}
                              onClick={() => updateConfig('themeColor', swatch.color)}
                              className={`w-8 h-8 rounded-full border-2 transition-all ${swatch.bg} ${appConfig.themeColor === swatch.color ? 'border-white scale-110 shadow-lg' : 'border-transparent hover:scale-105'}`}
                              title={swatch.name}
                            />
                          ))}
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
                         value={appConfig.bgOpacity}
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
                      <input type="checkbox" checked={appConfig.copyOnSelect} onChange={(e) => updateConfig('copyOnSelect', e.target.checked)} className="w-4 h-4 accent-primary rounded" />
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
                        className={`w-full p-2 border rounded-md text-sm outline-none transition-colors ${isDark ? 'bg-black/50 border-white/20 text-white' : 'bg-white border-black/20 text-black'}`}
                      >
                         <option value='"Fira Code", monospace, "Courier New", Courier'>Fira Code (Default)</option>
                         <option value='"Consolas", "Courier New", monospace'>Consolas / Courier</option>
                         <option value='"Menlo", "Monaco", "Courier New", monospace'>Menlo / Monaco</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium mb-1 opacity-70">{t('terminal.fontSize')}</label>
                        <input type="number" value={appConfig.fontSize} onChange={(e) => updateConfig('fontSize', parseInt(e.target.value) || 14)} className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/20' : 'bg-white border-black/20'}`} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1 opacity-70">{t('terminal.lineHeight')}</label>
                        <input type="number" step="0.1" value={appConfig.lineHeight} onChange={(e) => updateConfig('lineHeight', parseFloat(e.target.value) || 1.2)} className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/20' : 'bg-white border-black/20'}`} />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1 opacity-70">{t('terminal.cursorStyle')}</label>
                      <select 
                        value={appConfig.cursorStyle}
                        onChange={(e) => updateConfig('cursorStyle', e.target.value as any)}
                        className={`w-full p-2 border rounded-md text-sm outline-none transition-colors ${isDark ? 'bg-black/50 border-white/20 text-white' : 'bg-white border-black/20 text-black'}`}
                      >
                         <option value="block">{t('terminal.block')}</option>
                         <option value="underline">Underline</option>
                         <option value="bar">Bar (I-Beam)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1 opacity-70">Scrollback Lines</label>
                      <input type="number" min="1000" step="1000" value={appConfig.scrollback} onChange={(e) => updateConfig('scrollback', parseInt(e.target.value) || 10000)} className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/20' : 'bg-white border-black/20'}`} />
                      <div className="text-xs opacity-50 mt-1 text-yellow-500 dark:text-yellow-400">Note: Modifying scrollback typically only applies to new tabs.</div>
                    </div>
                  </div>
                )}

                {settingsActiveTab === 'SSH' && (
                  <div className="space-y-8 max-w-xl">
                    <div>
                      <h4 className="text-sm font-bold mb-3 flex items-center gap-2"><Network className="w-4 h-4"/> SSH Proxy</h4>
                      <div className="space-y-4 bg-black/5 dark:bg-white/5 p-4 rounded-lg border border-black/5 dark:border-white/10">
                         <div>
                           <label className="block text-xs font-medium mb-1 opacity-70">Proxy Protocol</label>
                           <select value={appConfig.proxyType} onChange={(e) => updateConfig('proxyType', e.target.value as any)} className={`w-full p-2 border rounded-md text-sm outline-none transition-colors ${isDark ? 'bg-black/50 border-white/20 text-white' : 'bg-white border-black/20 text-black'}`}>
                             <option value="none">Direct Connect (None)</option>
                             <option value="socks5">SOCKS5</option>
                             <option value="http">HTTP/HTTPS</option>
                           </select>
                         </div>
                         {appConfig.proxyType !== 'none' && (
                             <div className="grid grid-cols-4 gap-2">
                                <div className="col-span-3">
                                   <label className="block text-xs font-medium mb-1 opacity-70">Proxy Host</label>
                                   <input type="text" value={appConfig.proxyHost} onChange={(e) => updateConfig('proxyHost', e.target.value)} className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/20' : 'bg-white border-black/20'}`} />
                                </div>
                                <div className="col-span-1">
                                   <label className="block text-xs font-medium mb-1 opacity-70">Port</label>
                                   <input type="number" min="1" max="65535" value={appConfig.proxyPort} onChange={(e) => updateConfig('proxyPort', parseInt(e.target.value) || 1080)} className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/20' : 'bg-white border-black/20'}`} />
                                </div>
                             </div>
                         )}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1 opacity-70">Keep-alive Interval (Seconds)</label>
                      <input type="number" min="0" value={appConfig.keepalive} onChange={(e) => updateConfig('keepalive', parseInt(e.target.value) || 0)} className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/20' : 'bg-white border-black/20'}`} />
                      <div className="text-xs opacity-50 mt-1">Sends heartbeat packets to prevent server timeouts (0 to disable).</div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1 opacity-70">Default SSH Port</label>
                      <input type="number" min="1" max="65535" value={appConfig.defaultPort} onChange={(e) => updateConfig('defaultPort', parseInt(e.target.value) || 22)} className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/20' : 'bg-white border-black/20'}`} />
                    </div>
                  </div>
                )}

                {settingsActiveTab === 'System' && (
                  <div className="space-y-8 max-w-xl">
                    <div>
                      <label className="block text-sm font-medium mb-1 opacity-70">UI Theme</label>
                      <select 
                        value={appConfig.theme}
                        onChange={(e) => updateConfig('theme', e.target.value as any)}
                        className={`w-full p-2 border rounded-md text-sm outline-none transition-colors ${isDark ? 'bg-black/50 border-white/20 text-white' : 'bg-white border-black/20 text-black'}`}
                      >
                         <option value="system">Auto (Follow OS)</option>
                         <option value="light">Light</option>
                         <option value="dark">Dark</option>
                      </select>
                    </div>

                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={appConfig.confirmQuit} onChange={(e) => updateConfig('confirmQuit', e.target.checked)} className="w-4 h-4 accent-primary rounded" />
                      <div>
                        <div className="text-sm font-medium">Prompt on Exit</div>
                        <div className="text-xs opacity-50">Show confirmation dialog before fully closing the application.</div>
                      </div>
                    </label>

                    <div>
                      <label className="block text-sm font-medium mb-1 opacity-70">Global Summon Hotkey</label>
                      <input type="text" value={appConfig.globalHotkey} onChange={(e) => updateConfig('globalHotkey', e.target.value)} placeholder="e.g. Option+Space" className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/20' : 'bg-white border-black/20'}`} />
                      <div className="text-xs opacity-50 mt-1">Press this anywhere to show or hide the terminal window. (Supports: Command, Control, Option, Shift)</div>
                    </div>
                  </div>
                )}

                {settingsActiveTab === 'Security' && (
                  <div className="space-y-8 max-w-xl">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={appConfig.privacyMode} onChange={(e) => updateConfig('privacyMode', e.target.checked)} className="w-4 h-4 accent-primary rounded" />
                      <div>
                        <div className="text-sm font-medium flex items-center gap-2">Privacy Mode <Shield className="w-3 h-3 text-primary-400" /></div>
                        <div className="text-xs opacity-50">Enable glass blur over the entire application when it loses focus.</div>
                      </div>
                    </label>

                    <div>
                      <label className="block text-sm font-medium mb-1 opacity-70 flex items-center gap-2"><Cpu className="w-4 h-4" /> Global Init Script</label>
                      <textarea 
                        value={appConfig.initScript} 
                        onChange={(e) => updateConfig('initScript', e.target.value)} 
                        rows={4}
                        placeholder="e.g. neofetch && tmux attach" 
                        className={`w-full p-2 border rounded-md text-sm outline-none resize-none font-mono ${isDark ? 'bg-black/50 border-white/20' : 'bg-white border-black/20'}`} 
                      />
                      <div className="text-xs opacity-50 mt-1">Commands to automatically execute sequentially when connecting to any session.</div>
                    </div>

                    <div className="pt-6 border-t border-black/10 dark:border-white/10">
                       <h4 className="text-sm font-bold mb-3 flex items-center gap-2"><Shield className="w-4 h-4 text-primary"/> {t('security.safeStorageConfig')}</h4>
                       <div className="space-y-3">
                          {safeAction === 'none' ? (
                             <>
                               {!encryptionDisabled ? (
                                  <>
                                    <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSafeAction('change'); setSafeError(''); setSafeOldPwd(''); setSafeNewPwd(''); }} className={`w-full py-2 px-3 text-sm font-medium rounded-lg border transition-all ${isDark ? 'border-white/20 hover:bg-white/10' : 'border-black/20 hover:bg-black/5'}`}>
                                       {t('security.changeMasterPwd')}
                                    </button>
                                    <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSafeAction('disable'); setSafeError(''); setSafeOldPwd(''); }} className="w-full py-2 px-3 text-sm font-medium rounded-lg border border-red-500/50 text-red-500 hover:bg-red-500/10 transition-all">
                                       {t('security.disableEncryption')}
                                    </button>
                                  </>
                               ) : (
                                  <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSafeAction('enable'); setSafeError(''); setSafeNewPwd(''); }} className={`w-full py-2 px-3 text-sm font-medium rounded-lg bg-primary hover:bg-primary/80 text-white transition-all shadow-lg shadow-primary/20`}>
                                     {t('security.enableEncryption')}
                                  </button>
                               )}
                             </>
                          ) : (
                             <div className="p-4 rounded-lg bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 space-y-3">
                               {safeError && <div className="text-red-500 text-xs font-medium">{safeError}</div>}
                               
                               {(safeAction === 'change' || safeAction === 'disable') && (
                                  <div>
                                    <label className="block text-xs font-medium mb-1 opacity-70">{t('security.currentPwd')}</label>
                                    <input autoFocus type="password" value={safeOldPwd} onChange={e => setSafeOldPwd(e.target.value)} className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/20' : 'bg-white border-black/20'}`} />
                                  </div>
                               )}
                               
                               {(safeAction === 'change' || safeAction === 'enable') && (
                                  <div>
                                    <label className="block text-xs font-medium mb-1 opacity-70">{t('security.newPwd')}</label>
                                    <input autoFocus={safeAction === 'enable'} type="password" value={safeNewPwd} onChange={e => setSafeNewPwd(e.target.value)} className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/20' : 'bg-white border-black/20'}`} />
                                  </div>
                               )}

                               {safeAction === 'disable' && (
                                  <div className="text-xs text-red-500 font-medium">{t('security.warningPlaintext')}</div>
                               )}

                               <div className="flex gap-2 pt-2">
                                  <button onClick={() => setSafeAction('none')} className={`flex-1 py-1.5 px-3 text-sm rounded-md border transition-all ${isDark ? 'border-white/20 hover:bg-white/10' : 'border-black/20 hover:bg-black/5'}`}>{t('security.cancel')}</button>
                                  <button onClick={() => {
                                     if ((safeAction === 'change' || safeAction === 'disable') && safeOldPwd !== masterPassword) {
                                        return setSafeError(t('security.errIncorrectPwd'));
                                     }
                                     if ((safeAction === 'change' || safeAction === 'enable') && !safeNewPwd) {
                                        return setSafeError(t('security.errEmptyPwd'));
                                     }
                                     
                                     if (safeAction === 'change') {
                                        setMasterPassword(safeNewPwd);
                                        window.electronAPI.saveProfiles({ masterPassword: safeNewPwd, payload: sessions });
                                        setTimeout(() => window.alert('✅ 主密码已安全更新并重加密完成！'), 100);
                                     } else if (safeAction === 'disable') {
                                        setEncryptionDisabled(true);
                                        setMasterPassword('');
                                        window.electronAPI.saveProfiles({ masterPassword: '', payload: sessions });
                                        setTimeout(() => window.alert('⚠️ 加密已解除，配置已转为明文存储。'), 100);
                                     } else if (safeAction === 'enable') {
                                        setEncryptionDisabled(false);
                                        setMasterPassword(safeNewPwd);
                                        window.electronAPI.saveProfiles({ masterPassword: safeNewPwd, payload: sessions });
                                        setTimeout(() => window.alert('🔒 SafeStorage 零知识加密已启动！'), 100);
                                     }
                                     
                                     setSafeAction('none');
                                  }} className="flex-1 py-1.5 px-3 text-sm rounded-md bg-primary hover:bg-primary/80 text-white transition-all shadow-md">{t('security.confirm')}</button>
                               </div>
                             </div>
                          )}
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
                      <div className="absolute inset-0 bg-primary blur-2xl opacity-20 rounded-full animate-pulse" />
                      <h1 className="text-6xl font-black tracking-widest bg-gradient-to-br from-primary-400 to-primary bg-clip-text text-transparent relative z-10">GETSSH</h1>
                    </div>
                    <div className="text-xl font-medium tracking-widest opacity-80">{t('about.version')}</div>
                    
                    <div className="w-16 h-1 bg-gradient-to-r from-transparent via-primary to-transparent my-4 opacity-50" />
                    
                    <div className="space-y-2 opacity-70">
                      <p>{t('about.author')}</p>
                      <p>{t('about.license')}</p>
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
        ) : tabs.length > 0 ? (
          <div className="flex flex-col h-full flex-1">
            {/* Tabs Header */}
            <div className={`flex items-end px-2 pt-8 gap-1 border-b ${isDark ? 'border-white/10 bg-black/20' : 'border-black/5 bg-white/30'}`} style={{ WebkitAppRegion: 'drag' } as any}>
              {tabs.map((tab) => {
                const isActive = activeTabId === tab.id;
                return (
                  <div key={tab.id} onClick={() => setActiveTabId(tab.id)} style={{ WebkitAppRegion: 'no-drag' } as any} className={`group flex items-center justify-between gap-3 px-4 py-2 rounded-t-lg border-t border-x cursor-pointer text-sm transition-all min-w-[150px] max-w-[200px] ${isActive ? (isDark ? 'bg-black/60 border-white/10 text-white shadow-md' : 'bg-white border-black/10 text-black shadow-md relative z-10') : (isDark ? 'bg-transparent border-transparent text-white/50 hover:bg-white/5' : 'bg-transparent border-transparent text-black/50 hover:bg-black/5')}`}>
                    <span className="truncate">{tab.title}</span>
                    <button onClick={(e) => closeTab(e, tab.id)} className={`p-0.5 rounded-md opacity-0 group-hover:opacity-100 transition-colors ${isDark ? 'hover:bg-white/20 text-white/70' : 'hover:bg-black/10 text-black/70'}`}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
            
            {/* Terminals Container */}
            <div className={`flex-1 relative ${isDark ? 'bg-black/40' : 'bg-white/60'}`}>
               {tabs.map(tab => (
                 <div key={tab.id} className="absolute inset-0" style={{ display: activeTabId === tab.id ? 'block' : 'none' }}>
                   <TerminalComponent sessionId={tab.id} onDisconnected={() => {}} config={appConfig} />
                 </div>
               ))}
            </div>
          </div>
        ) : selectedSessionIndex !== null && sessions[selectedSessionIndex] ? (
          <div className="flex-1 flex flex-col pt-10">
            <div className="flex-1 flex items-center justify-center p-8 overflow-y-auto">
              <form onSubmit={(e) => { e.preventDefault(); handleConnect(sessions[selectedSessionIndex]); }} className={`p-8 w-full max-w-md space-y-6 flex flex-col rounded-xl shadow-2xl border ${isDark ? 'bg-black/40 border-white/10' : 'bg-white border-black/5'}`}>
                <div className="text-center">
                  <h2 className="text-2xl font-bold mb-2">Connect to Server</h2>
                  <p className="opacity-50 text-sm">Launch a new Tabbed SSH session</p>
                </div>

                {error && (
                  <div className="bg-red-500/20 border border-red-500/50 text-red-600 dark:text-red-200 p-3 rounded-lg text-sm">
                    {error}
                  </div>
                )}

                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                      <label className="block text-xs font-medium opacity-70 mb-1">{t('connect.host')}</label>
                      <input required value={sessions[selectedSessionIndex].host} onChange={(e) => { const updated = [...sessions]; updated[selectedSessionIndex].host = e.target.value; syncProfiles(updated); }} type="text" placeholder="192.168.1.1 or example.com" className={`w-full border rounded-lg px-4 py-2 text-sm outline-none transition-colors focus:ring-1 focus:ring-primary focus:border-primary ${isDark ? 'bg-black/30 border-white/10 placeholder:text-white/20' : 'bg-black/5 border-black/10 placeholder:text-black/30'}`} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium opacity-70 mb-1">{t('connect.port')}</label>
                      <input required value={sessions[selectedSessionIndex].port ?? appConfig.defaultPort ?? 22} onChange={(e) => { const updated = [...sessions]; updated[selectedSessionIndex].port = parseInt(e.target.value) || 22; syncProfiles(updated); }} type="number" min="1" max="65535" className={`w-full border rounded-lg px-4 py-2 text-sm outline-none transition-colors focus:ring-1 focus:ring-primary focus:border-primary ${isDark ? 'bg-black/30 border-white/10' : 'bg-black/5 border-black/10'}`} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium opacity-70 mb-1">{t('connect.username')}</label>
                    <input required value={sessions[selectedSessionIndex].username} onChange={(e) => { const updated = [...sessions]; updated[selectedSessionIndex].username = e.target.value; syncProfiles(updated); }} type="text" className={`w-full border rounded-lg px-4 py-2 text-sm outline-none transition-colors focus:ring-1 focus:ring-primary focus:border-primary ${isDark ? 'bg-black/30 border-white/10' : 'bg-black/5 border-black/10'}`} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium opacity-70 mb-1">{t('connect.password')}</label>
                    <input value={sessions[selectedSessionIndex].password || ''} onChange={(e) => { const updated = [...sessions]; updated[selectedSessionIndex].password = e.target.value; syncProfiles(updated); }} type="password" placeholder="Leave empty if using key" className={`w-full border rounded-lg px-4 py-2 text-sm outline-none transition-colors focus:ring-1 focus:ring-primary focus:border-primary ${isDark ? 'bg-black/30 border-white/10 placeholder:text-white/20' : 'bg-black/5 border-black/10 placeholder:text-black/30'}`} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium opacity-70 mb-1">{t('connect.privateKey')}</label>
                    <div className="flex gap-2">
                      <input value={sessions[selectedSessionIndex].privateKeyPath || ''} onChange={(e) => { const updated = [...sessions]; updated[selectedSessionIndex].privateKeyPath = e.target.value; syncProfiles(updated); }} type="text" placeholder="e.g. ~/.ssh/id_rsa" className={`flex-1 border rounded-lg px-4 py-2 text-sm outline-none transition-colors focus:ring-1 focus:ring-primary focus:border-primary ${isDark ? 'bg-black/30 border-white/10 placeholder:text-white/20' : 'bg-black/5 border-black/10 placeholder:text-black/30'}`} />
                      <button type="button" onClick={async () => {
                        // @ts-ignore
                        const path = await window.electronAPI.selectFile();
                        if (path) { const updated = [...sessions]; updated[selectedSessionIndex].privateKeyPath = path; syncProfiles(updated); }
                      }} className={`px-3 border rounded-lg text-sm transition-colors shrink-0 ${isDark ? 'bg-white/10 hover:bg-white/20 border-white/10' : 'bg-black/5 hover:bg-black/10 border-black/10 bg-white'}`}>
                        Browse
                      </button>
                    </div>
                  </div>
                  <label className="flex items-center gap-3 cursor-pointer pt-2">
                    <input type="checkbox" checked={sessions[selectedSessionIndex].useKeepAlive !== false} onChange={(e) => { const updated = [...sessions]; updated[selectedSessionIndex].useKeepAlive = e.target.checked; syncProfiles(updated); }} className="w-4 h-4 accent-primary rounded" />
                    <div>
                      <div className="text-sm font-medium">Enable Keep-Alive</div>
                      <div className="text-xs opacity-50">Prevents session timeout drop</div>
                    </div>
                  </label>
                </div>

                <button disabled={connecting} type="submit" className="w-full bg-primary hover:bg-primary disabled:opacity-50 text-white font-medium py-3 mt-4 rounded-lg transition-colors shadow-lg shadow-primary/20">
                  {connecting ? t('connect.connecting') : t('connect.connectBtn')}
                </button>
              </form>
            </div>
          </div>
        ) : tabs.length > 0 ? (
          <div className="flex flex-col h-full flex-1">
            <div className={`flex items-end px-2 pt-8 gap-1 border-b ${isDark ? 'border-white/10 bg-black/20' : 'border-black/5 bg-white/30'}`} style={{ WebkitAppRegion: 'drag' } as any}>
              {tabs.map((tab) => {
                const isActive = activeTabId === tab.id;
                return (
                  <div key={tab.id} onClick={() => setActiveTabId(tab.id)} style={{ WebkitAppRegion: 'no-drag' } as any} className={`group flex items-center justify-between gap-3 px-4 py-2 rounded-t-lg border-t border-x cursor-pointer text-sm transition-all min-w-[150px] max-w-[200px] ${isActive ? (isDark ? 'bg-black/60 border-white/10 text-white shadow-md' : 'bg-white border-black/10 text-black shadow-md relative z-10') : (isDark ? 'bg-transparent border-transparent text-white/50 hover:bg-white/5' : 'bg-transparent border-transparent text-black/50 hover:bg-black/5')}`}>
                    <span className="truncate">{tab.title}</span>
                    <button onClick={(e) => closeTab(e, tab.id)} className={`p-0.5 rounded-md opacity-0 group-hover:opacity-100 transition-colors ${isDark ? 'hover:bg-white/20 text-white/70' : 'hover:bg-black/10 text-black/70'}`}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className={`flex-1 relative ${isDark ? 'bg-black/40' : 'bg-white/60'}`}>
               {tabs.map(tab => (
                 <div key={tab.id} className="absolute inset-0" style={{ display: activeTabId === tab.id ? 'block' : 'none' }}>
                   <TerminalComponent sessionId={tab.id} onDisconnected={() => {}} config={appConfig} />
                 </div>
               ))}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
              <div className="opacity-30 flex flex-col items-center gap-4">
                 <TerminalIcon className="w-16 h-16" />
                 <p className="text-sm font-medium tracking-widest uppercase">Select or create a session to connect</p>
              </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
