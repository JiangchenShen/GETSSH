import React, { useState, useEffect, useRef } from 'react';
import { Terminal as TerminalComponent } from './components/Terminal';
import { TerminalSquare, Server, Plus, X, Search, Settings, Monitor, Terminal as TerminalIcon, Network, Command, Zap, Cpu, Shield, Blocks, Info, HardDrive, Edit2 } from 'lucide-react';
import { PluginSettings } from './components/PluginSettings';
import { SFTPManager } from './components/SFTPManager';
import { usePluginStore } from './store/pluginStore';
import { AppConfig, DEFAULT_CONFIG } from './store/appStore';
import { Tab } from './store/sessionStore';
import { usePanelStore } from './store/panelStore';
import { SplitPane } from './components/SplitPane';
import { TabBar } from './components/TabBar';
import { EmptyState } from './components/EmptyState';
import { initPluginBridge, bootSandboxedPlugins } from './plugins/PluginBridge';
import { useTranslation } from 'react-i18next';
import { CryptoModal } from './components/CryptoModal';

// Types re-exported from stores for backward compatibility
export type { AppConfig } from './store/appStore';

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
  const [settingsActiveTab, setSettingsActiveTab] = useState<'Appearance'|'Terminal'|'SSH'|'System'|'Security'|'Plugins'|'About'>('Appearance');
  const openSettingsTab = (tab: 'Appearance'|'Terminal'|'SSH'|'System'|'Security'|'Plugins'|'About' = 'Appearance') => {
     setSettingsActiveTab(tab);
     setSelectedSessionIndex(null);
     if (!tabs.find(t => t.id === 'settings')) {
         setTabs(prev => [...prev, { id: 'settings', title: t('settings.title'), config: { isSettings: true } }]);
     }
     setActiveTabId('settings');
  };
  const hasAutoStarted = useRef(false);
  const [isAppBlurred, setIsAppBlurred] = useState(false);
  const activePanelId = usePanelStore(state => state.activePanelId);
  const sidebarActions = usePluginStore(state => state.sidebarActions);

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

    // Boot Plugins in Sandbox (secure)
    initPluginBridge();
    bootSandboxedPlugins();

    // Register core panels in the dynamic panel engine
    usePanelStore.getState().registerPanel({
      id: 'sftp',
      title: 'SFTP Manager',
      component: SFTPManager,
      position: 'right',
      defaultSize: 320,
      minSize: 200,
      maxSize: 600,
    });

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
  

  const handleReconnect = async (tab: Tab) => {
    const res = await window.electronAPI.sshConnect(tab.config);
    if (res.success && res.sessionId) {
      setTabs(prev => prev.map(t => t.id === tab.id ? { ...t, id: res.sessionId as string } : t));
      if (activeTabId === tab.id) {
        setActiveTabId(res.sessionId as string);
      }
    } else {
      window.alert(`Reconnect failed: ${res.error}`);
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
    <div 
      onContextMenu={(e) => {
        e.preventDefault();
        window.electronAPI.showContextMenu();
      }}
      className={`h-screen w-screen flex backdrop-blur-xl relative overflow-hidden transition-all ${isDark ? 'text-gray-100' : 'text-gray-900'} ${isAppBlurred && appConfig.privacyMode ? 'blur-2xl brightness-50 pointer-events-none' : ''}`} style={appBgStyle}>
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
      <div className="absolute top-0 left-0 right-0 h-8 z-[100] flex items-center justify-center text-xs opacity-50 font-medium pointer-events-none pr-[120px]" style={{ WebkitAppRegion: 'drag', pointerEvents: 'auto' } as any}>
         GETSSH
      </div>

      {/* Left Sidebar */}
      <div className={`w-64 border-r flex flex-col p-4 pt-8 shrink-0 transition-colors bg-transparent ${isDark ? 'border-white/10' : 'border-black/10'}`}>
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
             <div key={idx} className={`w-full flex items-center justify-between gap-1 px-[15px] py-[7.5px] rounded-lg border-[1.5px] transition-all text-sm group ${selectedSessionIndex === idx ? 'bg-primary/20 text-primary border-primary shadow-sm' : isDark ? 'bg-white/5 hover:bg-white/10 border-white/5 text-white/70 hover:text-white' : 'bg-white hover:bg-white/70 border-black/5 shadow-sm text-black/70 hover:text-black'}`}>
               <button type="button" onClick={() => { setSelectedSessionIndex(idx); setActiveTabId(null); }} className="flex-1 flex items-center justify-start gap-[6px] truncate text-left">
                  <Server className="w-4 h-4 shrink-0 opacity-50" />
                  <span className="truncate">{session.username}@{session.host}</span>
               </button>
                <div className="flex items-center gap-[5px] justify-end">
                  <button onClick={(e) => { e.stopPropagation(); setSelectedSessionIndex(idx); setActiveTabId(null); }} className="opacity-70 hover:opacity-100 p-1 hover:text-primary hover:bg-primary/20 rounded-md transition-all" title="Edit connection">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={(e) => toggleAutoStart(e, session.host, session.username)} className={`p-1 rounded-md transition-all ${session.autoStart ? 'text-yellow-400 opacity-100 hover:bg-yellow-400/20' : 'opacity-70 hover:opacity-100 hover:text-yellow-500 hover:bg-yellow-500/20'}`} title="Auto-start this session">
                    <Zap className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={(e) => deleteSession(e, session.host, session.username)} className="opacity-70 hover:opacity-100 p-1 hover:text-red-500 hover:bg-red-500/20 rounded-md transition-all">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
             </div>
          ))}
          
          <button type="button" onClick={() => {
              const newSession = { host: '', username: '', password: '', privateKeyPath: '', autoStart: false };
              const updated = [newSession, ...sessions];
              syncProfiles(updated);
              setSelectedSessionIndex(0);
              setActiveTabId(null);
          }} className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed transition-all text-sm text-left mt-4 ${isDark ? 'border-white/20 hover:border-white/50 text-white/50 hover:text-white' : 'border-black/20 hover:border-black/50 text-black/50 hover:text-black bg-white/50'}`}>
            <Plus className="w-4 h-4 shrink-0" />
            <span>{t('sidebar.newConnection')}</span>
          </button>
        </div>

        {/* Global Tools Slot */}
        <div className="pt-4 mt-4 border-t flex justify-start gap-2 items-center z-10 flex-wrap border-black/10 dark:border-white/10">
          {sidebarActions.map(action => (
             <button key={action.id} onClick={action.onClick} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-white/10 text-white/50 hover:text-white' : 'hover:bg-black/5 text-black/50 hover:text-black'}`} title={action.label}>
                <div dangerouslySetInnerHTML={{ __html: action.icon }} className="w-5 h-5 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full" />
             </button>
          ))}
          <button onClick={() => usePanelStore.getState().togglePanel('sftp')} className={`p-2 rounded-lg transition-colors ${activePanelId === 'sftp' ? 'text-primary' : isDark ? 'hover:bg-white/10 text-white/50 hover:text-white' : 'hover:bg-black/5 text-black/50 hover:text-black'}`} title="SFTP Manager">
             <HardDrive className="w-5 h-5" />
          </button>
          <button onClick={() => openSettingsTab('Appearance')} className={`p-2 rounded-lg transition-colors ${(activeTabId === 'settings' && settingsActiveTab !== 'About') ? 'text-primary' : isDark ? 'hover:bg-white/10 text-white/50 hover:text-white' : 'hover:bg-black/5 text-black/50 hover:text-black'}`} title="Settings">
             <Settings className="w-5 h-5" />
          </button>
          <button onClick={() => openSettingsTab('About')} className={`p-2 rounded-lg transition-colors ${(activeTabId === 'settings' && settingsActiveTab === 'About') ? 'text-primary' : isDark ? 'hover:bg-white/10 text-white/50 hover:text-white' : 'hover:bg-black/5 text-black/50 hover:text-black'}`} title={t('settings.about')}>
             <Info className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main Area - Switch Mode */}
      <div className="flex-1 flex flex-col overflow-hidden pt-8">

        {/* Tab Bar - Extracted Component */}
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          isDark={isDark}
          onSelectTab={(tabId) => { setActiveTabId(tabId); setSelectedSessionIndex(null); }}
          onCloseTab={(tabId) => {
            setTabs(prev => {
              const remaining = prev.filter(t => t.id !== tabId);
              if (activeTabId === tabId) {
                const sshTabs = remaining.filter(t => t.id !== 'settings');
                setActiveTabId(sshTabs.length > 0 ? sshTabs[sshTabs.length - 1].id : null);
              }
              return remaining;
            });
            window.electronAPI.sshDisconnect(tabId);
          }}
        />

        {/* Settings Panel - inline switch */}
        {activeTabId === 'settings' && selectedSessionIndex === null && (
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
                onClick={() => { setActiveTabId(null); setTabs(prev => prev.filter(t => t.id !== 'settings')); }}
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
                        <input type="number" value={appConfig.fontSize} onChange={(e) => updateConfig('fontSize', parseInt(e.target.value) || 14)} className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/10' : 'bg-white border-black/10'}`} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1 opacity-70">{t('terminal.lineHeight')}</label>
                        <input type="number" step="0.1" value={appConfig.lineHeight} onChange={(e) => updateConfig('lineHeight', parseFloat(e.target.value) || 1.2)} className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/10' : 'bg-white border-black/10'}`} />
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
                      <input type="number" min="1000" step="1000" value={appConfig.scrollback} onChange={(e) => updateConfig('scrollback', parseInt(e.target.value) || 10000)} className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/10' : 'bg-white border-black/10'}`} />
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
                                    <input type="text" value={appConfig.proxyHost} onChange={(e) => updateConfig('proxyHost', e.target.value)} className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/10' : 'bg-white border-black/10'}`} />
                                 </div>
                                 <div className="col-span-1">
                                    <label className="block text-xs font-medium mb-1 opacity-70">{t('ssh.proxyPort')}</label>
                                    <input type="number" min="1" max="65535" value={appConfig.proxyPort} onChange={(e) => updateConfig('proxyPort', parseInt(e.target.value) || 1080)} className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/10' : 'bg-white border-black/10'}`} />
                                 </div>
                              </div>
                          )}
                       </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1 opacity-70">{t('ssh.keepAlive')}</label>
                      <input type="number" min="0" value={appConfig.keepalive} onChange={(e) => updateConfig('keepalive', parseInt(e.target.value) || 0)} className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/10' : 'bg-white border-black/10'}`} />
                      <div className="text-xs opacity-50 mt-1">{t('ssh.keepAliveDesc')}</div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1 opacity-70">{t('ssh.port')}</label>
                      <input type="number" min="1" max="65535" value={appConfig.defaultPort} onChange={(e) => updateConfig('defaultPort', parseInt(e.target.value) || 22)} className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/10' : 'bg-white border-black/10'}`} />
                    </div>
                  </div>
                )}

                {settingsActiveTab === 'System' && (
                  <div className="space-y-8 max-w-xl">

                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={appConfig.confirmQuit} onChange={(e) => updateConfig('confirmQuit', e.target.checked)} className="w-4 h-4 accent-primary rounded" />
                      <div>
                        <div className="text-sm font-medium">{t('system.confirmQuit')}</div>
                        <div className="text-xs opacity-50">{t('system.confirmQuitDesc')}</div>
                      </div>
                    </label>

                    <div>
                      <label className="block text-sm font-medium mb-1 opacity-70">{t('system.globalHotkey')}</label>
                      <input type="text" value={appConfig.globalHotkey} onChange={(e) => updateConfig('globalHotkey', e.target.value)} placeholder="e.g. Option+Space" className={`w-full p-2 border rounded-md text-sm outline-none ${isDark ? 'bg-black/50 border-white/10' : 'bg-white border-black/10'}`} />
                      <div className="text-xs opacity-50 mt-1">{t('system.globalHotkeyDesc')}</div>
                    </div>
                  </div>
                )}

                {settingsActiveTab === 'Security' && (
                  <div className="space-y-8 max-w-xl">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={appConfig.privacyMode} onChange={(e) => updateConfig('privacyMode', e.target.checked)} className="w-4 h-4 accent-primary rounded" />
                      <div>
                        <div className="text-sm font-medium flex items-center gap-2">{t('security.privacyMode')} <Shield className="w-3 h-3 text-primary-400" /></div>
                        <div className="text-xs opacity-50">{t('security.privacyModeDesc')}</div>
                      </div>
                    </label>

                    <div>
                      <label className="block text-sm font-medium mb-1 opacity-70 flex items-center gap-2"><Cpu className="w-4 h-4" /> Global Init Script</label>
                      <textarea 
                        value={appConfig.initScript} 
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
                               {!encryptionDisabled ? (
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
                                  }} className="flex-1 py-1.5 px-3 text-sm rounded-[20px] bg-primary hover:bg-primary/80 text-white transition-all shadow-md">{t('security.confirm')}</button>
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
        )}

        {/* Connect Form - inline switch */}
        {selectedSessionIndex !== null && sessions[selectedSessionIndex] && activeTabId !== 'settings' && (
          <div className="flex-1 flex items-center justify-center p-8 overflow-y-auto">
            <form onSubmit={(e) => { e.preventDefault(); handleConnect(sessions[selectedSessionIndex]); }} className={`p-8 w-full max-w-md space-y-6 flex flex-col bg-transparent border-0`}>
              <div className="text-center">
                <h2 className="text-2xl font-bold mb-2">Connect to Server</h2>
                <p className="opacity-50 text-sm">Launch a new Tabbed SSH session</p>
              </div>
              {error && <div className="bg-red-500/20 border border-red-500/50 text-red-600 dark:text-red-200 p-3 rounded-lg text-sm">{error}</div>}
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="block text-xs font-medium opacity-70 mb-1">{t('connect.host')}</label>
                    <input required value={sessions[selectedSessionIndex].host} onChange={(e) => { const u = [...sessions]; u[selectedSessionIndex].host = e.target.value; syncProfiles(u); }} type="text" placeholder="IP / Hostname" className={`w-full border rounded-lg px-4 py-2 text-sm outline-none transition-colors focus:ring-1 focus:ring-primary ${isDark ? 'bg-black/30 border-white/10 placeholder:text-white/20' : 'bg-black/5 border-black/10 placeholder:text-black/30'}`} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium opacity-70 mb-1">{t('connect.port')}</label>
                    <input required value={sessions[selectedSessionIndex].port ?? appConfig.defaultPort ?? 22} onChange={(e) => { const u = [...sessions]; u[selectedSessionIndex].port = parseInt(e.target.value) || 22; syncProfiles(u); }} type="number" min="1" max="65535" className={`w-full border rounded-lg px-4 py-2 text-sm outline-none ${isDark ? 'bg-black/30 border-white/10' : 'bg-black/5 border-black/10'}`} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium opacity-70 mb-1">{t('connect.username')}</label>
                  <input required value={sessions[selectedSessionIndex].username} onChange={(e) => { const u = [...sessions]; u[selectedSessionIndex].username = e.target.value; syncProfiles(u); }} type="text" className={`w-full border rounded-lg px-4 py-2 text-sm outline-none ${isDark ? 'bg-black/30 border-white/10' : 'bg-black/5 border-black/10'}`} />
                </div>
                <div>
                  <label className="block text-xs font-medium opacity-70 mb-1">{t('connect.password')}</label>
                  <input value={sessions[selectedSessionIndex].password || ''} onChange={(e) => { const u = [...sessions]; u[selectedSessionIndex].password = e.target.value; syncProfiles(u); }} type="password" placeholder="Leave empty if using key" className={`w-full border rounded-lg px-4 py-2 text-sm outline-none ${isDark ? 'bg-black/30 border-white/10 placeholder:text-white/20' : 'bg-black/5 border-black/10 placeholder:text-black/30'}`} />
                </div>
                <div>
                  <label className="block text-xs font-medium opacity-70 mb-1">{t('connect.privateKey')}</label>
                  <div className="flex gap-2">
                    <input value={sessions[selectedSessionIndex].privateKeyPath || ''} onChange={(e) => { const u = [...sessions]; u[selectedSessionIndex].privateKeyPath = e.target.value; syncProfiles(u); }} type="text" placeholder="e.g. ~/.ssh/id_rsa" className={`flex-1 border rounded-lg px-4 py-2 text-sm outline-none ${isDark ? 'bg-black/30 border-white/10 placeholder:text-white/20' : 'bg-black/5 border-black/10 placeholder:text-black/30'}`} />
                    <button type="button" onClick={async () => { const path = await window.electronAPI.selectFile(); if (path) { const u = [...sessions]; u[selectedSessionIndex].privateKeyPath = path; syncProfiles(u); } }} className={`px-3 border rounded-lg text-sm shrink-0 ${isDark ? 'bg-white/10 hover:bg-white/20 border-white/10' : 'bg-white hover:bg-black/10 border-black/10'}`}>Browse</button>
                  </div>
                </div>
                <label className="flex items-center gap-3 cursor-pointer pt-2">
                  <input type="checkbox" checked={sessions[selectedSessionIndex].useKeepAlive !== false} onChange={(e) => { const u = [...sessions]; u[selectedSessionIndex].useKeepAlive = e.target.checked; syncProfiles(u); }} className="w-4 h-4 accent-primary rounded" />
                  <div><div className="text-sm font-medium">Enable Keep-Alive</div><div className="text-xs opacity-50">Prevents session timeout drop</div></div>
                </label>
              </div>
              <button disabled={connecting} type="submit" className="w-full bg-primary hover:bg-primary/80 disabled:opacity-50 text-white font-medium py-3 mt-4 rounded-lg transition-colors shadow-lg shadow-primary/20">
                {connecting ? t('connect.connecting') : t('connect.connectBtn')}
              </button>
            </form>
          </div>
        )}

        {/* Terminals + Dynamic Split Pane Engine - ALWAYS MOUNTED, never unmounted */}
        {tabs.filter(t => t.id !== 'settings').length > 0 && selectedSessionIndex === null && (
          <div
            className={`flex-1 flex overflow-hidden ${isDark ? 'bg-black/40' : 'bg-white/60'}`}
            style={{ display: (activeTabId && activeTabId !== 'settings') ? 'flex' : 'none' }}
          >
            <SplitPane isDark={isDark} activeTabId={activeTabId}>
              <div className="absolute inset-0">
                {tabs.filter(t => t.id !== 'settings').map(tab => (
                  <div key={tab.id} className={`absolute inset-0 flex ${activeTabId === tab.id ? 'z-10' : '-z-10 opacity-0 pointer-events-none'}`}>
                    <TerminalComponent
                      sessionId={tab.id}
                      onDisconnected={() => {}}
                      onReconnect={() => handleReconnect(tab)}
                      config={appConfig}
                      isDark={isDark}
                      isActive={activeTabId === tab.id}
                    />
                  </div>
                ))}
              </div>
            </SplitPane>
          </div>
        )}

        {/* Empty State - Extracted Component */}
        {selectedSessionIndex === null && !activeTabId && (
          <EmptyState />
        )}

      </div>
    </div>
  );
}

export default App;
