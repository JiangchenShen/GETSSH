import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, Server, Terminal as TerminalIcon, Activity, Cpu, Command, ArrowRight, Settings, Plus, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSessionStore } from '../store/sessionStore';
import { useAppStore } from '../store/appStore';
import { usePluginStore } from '../store/pluginStore';
import { useCryptoStore } from '../store/cryptoStore';

interface CommandCenterProps {
  onConnect: (session: any) => void;
  onOpenPlugin?: (plugin: any) => void;
}

export const CommandCenter: React.FC<CommandCenterProps> = ({ onConnect, onOpenPlugin }) => {
  const { t, i18n } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const sessions = useSessionStore(state => state.sessions);
  const installedPlugins = usePluginStore(state => state.installedPlugins);
  const setCryptoMode = useCryptoStore(state => state.setCryptoMode);
  const masterPassword = useCryptoStore(state => state.masterPassword);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [time, setTime] = useState(new Date());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const sessionListRef = useRef<HTMLDivElement>(null);
  const isPolluted = useAppStore(state => state.isPolluted);
  const [watchdogInfo, setWatchdogInfo] = useState<{ level?: 'red' | 'yellow', reason?: string } | null>(null);

  useEffect(() => {
    if (isPolluted && window.electronAPI?.invoke) {
      window.electronAPI.invoke('get-watchdog-status').then(res => setWatchdogInfo(res));
    }
  }, [isPolluted]);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const filteredSessions = useMemo(() => {
    if (!searchQuery) return sessions;
    const q = searchQuery.toLowerCase();
    return sessions.filter(s => 
      (s.alias?.toLowerCase().includes(q)) ||
      (s.host?.toLowerCase().includes(q)) ||
      (s.username?.toLowerCase().includes(q))
    );
  }, [sessions, searchQuery]);

  const totalItems = filteredSessions.length + installedPlugins.length;

  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery, totalItems]);

  const openPlugin = (plugin: any) => {
    if (onOpenPlugin) {
       onOpenPlugin(plugin);
    } else {
       // Fallback for EmptyState
       useSessionStore.setState(state => {
         const newTabId = `cmd-${Date.now()}`;
         const pluginUrl = `getssh-plugin://${plugin.name}/${plugin.main}`;
         return {
           tabs: [...state.tabs, {
             id: newTabId,
             title: (plugin as any).getssh?.name || plugin.displayName || plugin.name,
             config: { pluginUrl },
             paneTree: { type: 'leaf', paneId: `pane-${Date.now()}`, paneType: 'plugin', sessionId: null, config: { pluginUrl } }
           }],
           activeTabId: newTabId
         };
       });
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, totalItems - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      if (selectedIndex < filteredSessions.length && filteredSessions.length > 0) {
        onConnect(filteredSessions[selectedIndex]);
      } else if (selectedIndex >= filteredSessions.length && selectedIndex < totalItems) {
        openPlugin(installedPlugins[selectedIndex - filteredSessions.length]);
      } else if (searchQuery) {
        let username = '';
        let host = searchQuery;
        if (searchQuery.includes('@')) {
          [username, host] = searchQuery.split('@');
        }
        onConnect({ host, username, protocol: 'ssh' });
      }
    }
  };

  return (
    <div className={`relative flex-1 flex flex-col h-full items-center justify-center p-8 gap-8 cursor-default overflow-y-auto overflow-x-hidden animate-in fade-in duration-300 ${isDark ? 'bg-transparent text-white' : 'bg-transparent text-slate-900'}`}>
      
      {/* Background Tech Elements */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
         <div className={`absolute inset-0 opacity-[0.03] ${isDark ? 'bg-[radial-gradient(#fff_1px,transparent_1px)]' : 'bg-[radial-gradient(#000_1px,transparent_1px)]'}`} style={{ backgroundSize: '24px 24px' }}></div>
         <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary/10 blur-[100px]"></div>
         <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-blue-500/10 blur-[100px]"></div>
      </div>

      <div className="z-10 w-full max-w-3xl">
        {isPolluted && watchdogInfo && (
          <div className={`w-full p-4 mb-6 rounded-xl flex items-center justify-between border ${
            watchdogInfo.level === 'red' 
              ? 'bg-red-500/10 border-red-500/30 text-red-500' 
              : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-500'
          }`}>
            <div className="flex items-center gap-3">
              <Activity className="w-5 h-5 animate-pulse" />
              <div>
                <p className="font-bold text-sm">
                  {watchdogInfo.level === 'red' ? '⚠️ 当前系统已被污染 (高危)' : '⚠️ 插件高危操作已阻断 (警告)'}
                </p>
                <p className="text-xs opacity-80">{watchdogInfo.reason}</p>
              </div>
            </div>
          </div>
        )}
        <div className="flex justify-between items-end mb-8">
          <div>
            <p className={`flex items-center gap-2 text-xs font-semibold tracking-[0.2em] uppercase mb-2 ${
              isDark ? 'text-primary/80' : 'text-primary/80'
            }`}>
              <Command className="w-3.5 h-3.5" />
              GETSSH {t('welcome.commandCenter', 'Command Center')}
            </p>
            <h1 className={`text-3xl font-black tracking-tight ${
              isDark ? 'text-white/95' : 'text-black/95'
            }`}>{t('welcome.whereTo', 'Where do you want to go?')}</h1>
          </div>
          <div className={`hidden sm:block text-right ${isDark ? 'text-white/30' : 'text-black/30'}`}>
             <div className="text-sm font-medium">{time.toLocaleDateString(i18n.language, { weekday: 'long', month: 'short', day: 'numeric' })}</div>
             <div className="text-xs">{time.toLocaleTimeString(i18n.language, {hour: '2-digit', minute:'2-digit'})}</div>
          </div>
        </div>

        <div className="relative w-full group mb-10">
          <div className="absolute -inset-1 bg-gradient-to-r from-primary/30 to-blue-500/30 rounded-[20px] blur opacity-0 group-focus-within:opacity-100 transition duration-500"></div>
          <Search className={`absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 transition-colors z-10 ${isDark ? 'text-white/40 group-focus-within:text-primary' : 'text-black/40 group-focus-within:text-primary'}`} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder={t('welcome.searchPlaceholder', 'Filter sessions or type user@host to quick connect...')}
            className={`relative w-full pl-14 pr-16 py-4 rounded-2xl border text-sm font-medium outline-none transition-all shadow-sm ${
              isDark
                ? 'bg-[#1a1a1a]/80 border-white/10 text-white placeholder-white/30 focus:border-primary/50 focus:bg-[#1a1a1a]'
                : 'bg-white/80 border-black/10 text-black placeholder-black/40 focus:border-primary/50 focus:bg-white'
            } backdrop-blur-md`}
            autoFocus
          />
          <div className={`absolute right-4 top-1/2 -translate-y-1/2 px-2 py-1 rounded text-[10px] font-bold border transition-opacity ${
              searchQuery ? 'opacity-100' : 'opacity-0'
            } ${isDark ? 'bg-primary/20 text-primary border-primary/30' : 'bg-primary/10 text-primary border-primary/20'}`}>
            ENTER ↵
          </div>
        </div>
      </div>

      {/* ─── Quick Actions ─────────── */}
      {!searchQuery && (
        <div className="z-10 w-full max-w-3xl flex gap-3 mt-[-10px] mb-2">
          <button 
            onClick={() => {
              const btn = document.querySelector('button[title="New Connection"], button[title="New Connection"]') as HTMLButtonElement | null;
              if (btn) btn.click();
              else {
                // Trigger sidebar new connection if possible
                const sidebarAdd = document.querySelector('.sidebar-add-btn') as HTMLButtonElement | null;
                if (sidebarAdd) sidebarAdd.click();
              }
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold transition-all ${
              isDark ? 'bg-white/5 hover:bg-white/10 text-white/70' : 'bg-black/5 hover:bg-black/10 text-black/70'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            {t('sidebar.newConnection', 'New Session')}
          </button>
          
          <button 
            onClick={() => {
              const settingsBtn = document.querySelector('button[title="Settings"], button[title="设置"]') as HTMLButtonElement | null;
              if (settingsBtn) settingsBtn.click();
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold transition-all ${
              isDark ? 'bg-white/5 hover:bg-white/10 text-white/70' : 'bg-black/5 hover:bg-black/10 text-black/70'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            {t('settings.title', 'Settings')}
          </button>
          
          <button 
            onClick={() => {
              if (masterPassword) {
                setCryptoMode('locked');
              }
            }}
            disabled={!masterPassword}
            title={!masterPassword ? t('welcome.lockProfileDisabledTip', '请先在设置中配置主密码才能使用档案锁定功能') : undefined}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold transition-all ${
              !masterPassword
                ? (isDark ? 'bg-white/5 text-white/30 cursor-not-allowed' : 'bg-black/5 text-black/30 cursor-not-allowed')
                : (isDark ? 'bg-red-500/10 hover:bg-red-500/20 text-red-400' : 'bg-red-500/10 hover:bg-red-500/20 text-red-600')
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            {t('welcome.lockProfile', '锁定档案')}
          </button>
        </div>
      )}

      {/* ─── Section A: Remote Infrastructure ────── */}
      <div className="z-10 w-full max-w-3xl flex flex-col gap-4">
        <div className={`flex items-center gap-2.5 pb-2 border-b ${
          isDark ? 'border-white/10' : 'border-black/10'
        }`}>
          <div className={`p-1.5 rounded-lg ${
            isDark ? 'bg-emerald-500/15 text-emerald-400' : 'bg-emerald-500/10 text-emerald-600'
          }`}>
            <Server className="w-4 h-4" />
          </div>
          <span className={`text-sm font-bold tracking-wide uppercase ${
            isDark ? 'text-white/80' : 'text-black/80'
          }`}>{t('welcome.remoteInfrastructure', '远程服务器')}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ml-auto font-medium ${
            isDark ? 'bg-white/5 text-white/40' : 'bg-black/5 text-black/40'
          }`}>{t('welcome.hostsCount', `${sessions.length} 个主机`, { count: sessions.length })}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" ref={sessionListRef}>
          {filteredSessions.map((s, i) => (
            <button
              key={i}
              onClick={() => onConnect(s)}
              onMouseEnter={() => setSelectedIndex(i)}
              className={`group relative p-4 rounded-2xl border text-left transition-all duration-300 flex flex-col gap-3 outline-none ${
                selectedIndex === i 
                  ? (isDark ? 'bg-primary/20 border-primary/50 shadow-[0_4px_20px_rgba(0,0,0,0.4)]' : 'bg-primary/10 border-primary/40 shadow-lg')
                  : (isDark
                    ? 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                    : 'bg-white border-black/5 hover:bg-slate-50 hover:border-black/10')
              }`}
            >
              <div className="flex items-start justify-between w-full">
                 <div className={`shrink-0 p-2.5 rounded-xl transition-colors ${
                   selectedIndex === i 
                     ? (isDark ? 'bg-primary/30' : 'bg-primary/20')
                     : (isDark ? 'bg-white/5 group-hover:bg-primary/20' : 'bg-black/5 group-hover:bg-primary/10')
                 }`}>
                   <TerminalIcon className={`w-5 h-5 transition-colors ${
                     selectedIndex === i
                       ? 'text-primary'
                       : (isDark ? 'text-white/60 group-hover:text-primary' : 'text-black/60 group-hover:text-primary')
                   }`} />
                 </div>
                 <ArrowRight className={`w-4 h-4 transition-all ${
                   selectedIndex === i 
                     ? `opacity-100 translate-x-0 ${isDark ? 'text-primary' : 'text-primary'}` 
                     : `opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 ${isDark ? 'text-white/40' : 'text-black/40'}`
                 }`} />
              </div>
              <div className="flex flex-col min-w-0 w-full mt-1">
                <div className={`font-bold text-sm truncate transition-colors ${
                  selectedIndex === i
                    ? (isDark ? 'text-white' : 'text-black')
                    : (isDark ? 'text-white/90 group-hover:text-white' : 'text-black/90 group-hover:text-black')
                }`}>{s.alias || s.host || t('sidebar.newConnection', 'New Session')}</div>
                <div className={`text-xs truncate mt-0.5 font-mono ${
                  selectedIndex === i
                    ? (isDark ? 'text-white/70' : 'text-black/70')
                    : (isDark ? 'text-white/40' : 'text-black/40')
                }`}>{s.username}@{s.host}</div>
              </div>
            </button>
          ))}
          {filteredSessions.length === 0 && (
            <div className={`col-span-full text-center py-10 text-sm rounded-2xl border border-dashed flex items-center justify-center ${
              isDark ? 'text-white/30 border-white/10 bg-white/5' : 'text-black/30 border-black/10 bg-white'
            }`}>
              {searchQuery ? t('welcome.quickConnectHint', 'Press Enter to quick connect to this host...') : t('welcome.noSavedSessions', 'No saved sessions. Add one in the sidebar.')}
            </div>
          )}
        </div>
      </div>

      {/* ─── Section B: Local Extensions ─────────── */}
      <div className="z-10 w-full max-w-3xl flex flex-col gap-4 mt-4">
        <div className={`flex items-center gap-2.5 pb-2 border-b ${
          isDark ? 'border-white/10' : 'border-black/10'
        }`}>
          <div className={`p-1.5 rounded-lg ${
            isDark ? 'bg-blue-500/15 text-blue-400' : 'bg-blue-500/10 text-blue-600'
          }`}>
            <Cpu className="w-4 h-4" />
          </div>
          <span className={`text-sm font-bold tracking-wide uppercase ${
            isDark ? 'text-white/80' : 'text-black/80'
          }`}>{t('welcome.localExtensions', '本地工具 & 插件')}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {installedPlugins.map((plugin, i) => {
            const index = filteredSessions.length + i;
            return (
              <button
                key={plugin.name}
                onClick={() => openPlugin(plugin)}
                onMouseEnter={() => setSelectedIndex(index)}
                className={`group relative p-4 rounded-2xl border text-left transition-all duration-300 flex items-center gap-4 outline-none ${
                  selectedIndex === index
                    ? (isDark ? 'bg-blue-500/20 border-blue-500/50 shadow-[0_4px_20px_rgba(0,0,0,0.4)]' : 'bg-blue-500/10 border-blue-500/40 shadow-lg')
                    : (isDark
                      ? 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                      : 'bg-white border-black/5 hover:bg-slate-50 hover:border-black/10')
                }`}
              >
                <div className={`shrink-0 p-3 rounded-xl transition-colors ${
                  selectedIndex === index
                    ? (isDark ? 'bg-blue-500/30' : 'bg-blue-500/20')
                    : (isDark ? 'bg-white/5 group-hover:bg-blue-500/20' : 'bg-black/5 group-hover:bg-blue-500/10')
                }`}>
                  <Activity className={`w-5 h-5 transition-colors ${
                    selectedIndex === index
                      ? 'text-blue-500'
                      : (isDark ? 'text-white/60 group-hover:text-blue-400' : 'text-black/60 group-hover:text-blue-600')
                  }`} />
                </div>
                <div className="flex flex-col min-w-0 w-full">
                  <div className={`font-bold text-sm truncate transition-colors ${
                    selectedIndex === index
                      ? (isDark ? 'text-white' : 'text-black')
                      : (isDark ? 'text-white/90 group-hover:text-white' : 'text-black/90 group-hover:text-black')
                  }`}>{(plugin as any).getssh?.name || plugin.displayName || plugin.name}</div>
                  <div className={`text-xs truncate mt-0.5 ${
                    selectedIndex === index
                      ? (isDark ? 'text-white/70' : 'text-black/70')
                      : (isDark ? 'text-white/40' : 'text-black/40')
                  }`}>{plugin.description}</div>
                </div>
                <ArrowRight className={`w-4 h-4 transition-all ${
                  selectedIndex === index
                    ? `opacity-100 translate-x-0 ${isDark ? 'text-blue-500' : 'text-blue-500'}` 
                    : `opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 ${isDark ? 'text-white/40' : 'text-black/40'}`
                }`} />
              </button>
            );
          })}

          {/* Future plugins placeholder */}
          <div className={`p-4 rounded-2xl border border-dashed flex items-center justify-center gap-2 ${
            isDark ? 'border-white/10 text-white/30 bg-white/5' : 'border-black/10 text-black/30 bg-white'
          }`}>
            <span className="text-xs font-medium">{t('welcome.morePlugins', '更多插件敬请期待...')}</span>
          </div>
        </div>
      </div>

    </div>
  );
};
