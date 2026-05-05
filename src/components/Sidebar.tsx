import React from 'react';
import { TerminalSquare, Search, Server, Plus, Edit2, Zap, X, HardDrive, Settings, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import DOMPurify from 'dompurify';
import { useAppStore } from '../store/appStore';
import { useSessionStore } from '../store/sessionStore';
import { usePanelStore } from '../store/panelStore';
import { usePluginStore } from '../store/pluginStore';

interface SidebarProps {
  onAddSession: () => void;
  onToggleAutoStart: (e: React.MouseEvent, host: string, username: string) => void;
  onDeleteSession: (e: React.MouseEvent, host: string, username: string) => void;
  openSettingsTab: (tab: 'Appearance'|'Terminal'|'SSH'|'System'|'Security'|'Plugins'|'About') => void;
  settingsActiveTab: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  onAddSession,
  onToggleAutoStart,
  onDeleteSession,
  openSettingsTab,
  settingsActiveTab
}) => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const updateAvailable = useAppStore(state => state.updateAvailable);
  
  const sessions = useSessionStore(state => state.sessions);
  const searchQuery = useSessionStore(state => state.searchQuery);
  const setSearchQuery = useSessionStore(state => state.setSearchQuery);
  const selectedSessionIndex = useSessionStore(state => state.selectedSessionIndex);
  const setSelectedSessionIndex = useSessionStore(state => state.setSelectedSessionIndex);
  const setActiveTabId = useSessionStore(state => state.setActiveTabId);
  const activeTabId = useSessionStore(state => state.activeTabId);
  
  const activePanelId = usePanelStore(state => state.activePanelId);
  const togglePanel = usePanelStore(state => state.togglePanel);
  const sidebarActions = usePluginStore(state => state.sidebarActions);

  const filteredSessions = sessions.filter(s => `${s.username}@${s.host}`.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className={`w-64 border-r flex flex-col p-4 pt-8 shrink-0 transition-colors bg-transparent ${isDark ? 'border-white/10' : 'border-black/10'}`}>
      <div className="flex items-center gap-2 mb-6">
        <TerminalSquare className="w-5 h-5 text-primary" />
        <h1 className="font-bold text-lg tracking-wider">GETSSH</h1>
      </div>

      <div className="relative mb-4">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
        <input 
          value={searchQuery} 
          onChange={e => setSearchQuery(e.target.value)} 
          type="text" 
          placeholder={t('sidebar.search')} 
          className={`w-full pl-9 pr-3 py-1.5 rounded-md text-sm outline-none transition-colors ${isDark ? 'bg-white/5 border border-white/10 focus:border-primary placeholder:text-white/30' : 'bg-black/5 border border-black/10 focus:border-primary placeholder:text-black/30'}`} 
        />
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
                <button onClick={(e) => onToggleAutoStart(e, session.host, session.username)} className={`p-1 rounded-md transition-all ${session.autoStart ? 'text-yellow-400 opacity-100 hover:bg-yellow-400/20' : 'opacity-70 hover:opacity-100 hover:text-yellow-500 hover:bg-yellow-500/20'}`} title="Auto-start this session">
                  <Zap className="w-3.5 h-3.5" />
                </button>
                <button onClick={(e) => onDeleteSession(e, session.host, session.username)} className="opacity-70 hover:opacity-100 p-1 hover:text-red-500 hover:bg-red-500/20 rounded-md transition-all">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
           </div>
        ))}
        
        <button type="button" onClick={onAddSession} className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed transition-all text-sm text-left mt-4 ${isDark ? 'border-white/20 hover:border-white/50 text-white/50 hover:text-white' : 'border-black/20 hover:border-black/50 text-black/50 hover:text-black bg-white/50'}`}>
          <Plus className="w-4 h-4 shrink-0" />
          <span>{t('sidebar.newConnection')}</span>
        </button>
      </div>

      {/* Global Tools Slot */}
      <div className="pt-4 mt-4 border-t flex justify-start gap-2 items-center z-10 flex-wrap border-black/10 dark:border-white/10">
        {sidebarActions.map(action => (
           <button key={action.id} onClick={action.onClick} className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-white/10 text-white/50 hover:text-white' : 'hover:bg-black/5 text-black/50 hover:text-black'}`} title={action.label}>
              <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(action.icon) }} className="w-5 h-5 flex items-center justify-center [&>svg]:w-full [&>svg]:h-full" />
           </button>
        ))}
        <button onClick={() => togglePanel('sftp')} className={`p-2 rounded-lg transition-colors ${activePanelId === 'sftp' ? 'text-primary' : isDark ? 'hover:bg-white/10 text-white/50 hover:text-white' : 'hover:bg-black/5 text-black/50 hover:text-black'}`} title="SFTP Manager">
           <HardDrive className="w-5 h-5" />
        </button>
        <button onClick={() => openSettingsTab('Appearance')} className={`relative p-2 rounded-lg transition-colors ${(activeTabId === 'settings' && settingsActiveTab !== 'About') ? 'text-primary' : isDark ? 'hover:bg-white/10 text-white/50 hover:text-white' : 'hover:bg-black/5 text-black/50 hover:text-black'}`} title="Settings">
           <Settings className="w-5 h-5" />
           {updateAvailable && <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border border-white dark:border-[#1e1e1e]" />}
        </button>
        <button onClick={() => openSettingsTab('About')} className={`p-2 rounded-lg transition-colors ${(activeTabId === 'settings' && settingsActiveTab === 'About') ? 'text-primary' : isDark ? 'hover:bg-white/10 text-white/50 hover:text-white' : 'hover:bg-black/5 text-black/50 hover:text-black'}`} title={t('settings.about')}>
           <Info className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
