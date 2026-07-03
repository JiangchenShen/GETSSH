import React from 'react';
import { Search, Plus, Edit2, Zap, X, Server, Terminal, PanelLeftClose, PanelLeftOpen, Lock, KeyRound, Folder, ChevronRight, ChevronDown } from 'lucide-react';
import { SiUbuntu, SiDebian, SiCentos, SiRedhat, SiFedora, SiAlpinelinux, SiArchlinux, SiSuse, SiApple } from 'react-icons/si';
import { FaWindows } from 'react-icons/fa';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/appStore';
import { useSessionStore } from '../store/sessionStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { SessionProfile } from '../store/sessionStore';

interface OsBadgeProps {
  osType?: string;
  protocol?: string;
  isActive?: boolean;
}

const OsBadge: React.FC<OsBadgeProps> = ({ osType, protocol, isActive }) => {
  const renderIcon = () => {
    switch (osType) {
      case 'ubuntu': return <SiUbuntu className="w-3.5 h-3.5 text-orange-500" />;
      case 'debian': return <SiDebian className="w-3.5 h-3.5 text-red-500" />;
      case 'centos': return <SiCentos className="w-3.5 h-3.5 text-purple-500" />;
      case 'rhel': return <SiRedhat className="w-3.5 h-3.5 text-red-600" />;
      case 'fedora': return <SiFedora className="w-3.5 h-3.5 text-blue-500" />;
      case 'alpine': return <SiAlpinelinux className="w-3.5 h-3.5 text-blue-400" />;
      case 'arch': return <SiArchlinux className="w-3.5 h-3.5 text-cyan-500" />;
      case 'suse': return <SiSuse className="w-3.5 h-3.5 text-green-500" />;
      case 'windows': return <FaWindows className="w-3.5 h-3.5 text-blue-500" />;
      case 'macos': return <SiApple className="w-3.5 h-3.5 text-slate-300" />;
      default: return protocol === 'local' ? <Terminal className="w-3.5 h-3.5" /> : <Server className="w-3.5 h-3.5" />;
    }
  };

  return (
    <div className={`w-6 h-6 flex items-center justify-center rounded-xl shrink-0 border ${isActive ? 'border-primary/30 bg-primary/20 text-primary' : 'border-current opacity-60 text-current'}`}>
      {renderIcon()}
    </div>
  );
};

interface ContextSidebarProps {
  onAddSession: () => void;
  onToggleAutoStart: (e: React.MouseEvent, targetSession: SessionProfile) => void;
  onDeleteSession: (e: React.MouseEvent, targetSession: SessionProfile) => void;
}

export const ContextSidebar: React.FC<ContextSidebarProps> = ({
  onAddSession,
  onToggleAutoStart,
  onDeleteSession,
}) => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const isMac = useAppStore(state => state.isMac);
  const isFullScreen = useAppStore(state => state.isFullScreen);
  const isSidebarCollapsed = useAppStore(state => state.isSidebarCollapsed);
  const setIsSidebarCollapsed = useAppStore(state => state.setIsSidebarCollapsed);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const workspaces = useWorkspaceStore(state => state.workspaces);
  
  const isVaultLocked = useWorkspaceStore(state => state.isVaultLocked);
  const setIsUnlockModalOpen = useWorkspaceStore(state => state.setIsUnlockModalOpen);
  
  const sessions = useSessionStore(state => state.sessions);
  const searchQuery = useSessionStore(state => state.searchQuery);
  const setSearchQuery = useSessionStore(state => state.setSearchQuery);
  const selectedSessionIndex = useSessionStore(state => state.selectedSessionIndex);
  const setSelectedSessionIndex = useSessionStore(state => state.setSelectedSessionIndex);
  const setActiveTabId = useSessionStore(state => state.setActiveTabId);

  const expandedGroups = useSessionStore(state => state.expandedGroups);
  const setExpandedGroups = useSessionStore(state => state.setExpandedGroups);

  const sessionsWithIndex = sessions.map((s, idx) => ({ ...s, originalIndex: idx }));

  const filteredSessions = sessionsWithIndex.filter(s => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (s.alias && s.alias.toLowerCase().includes(query)) ||
           (s.host && s.host.toLowerCase().includes(query)) ||
           (s.username && s.username.toLowerCase().includes(query)) ||
           (s.group && s.group.toLowerCase().includes(query));
  });

  const toggleGroup = (group: string) => {
    if (expandedGroups.includes(group)) {
      setExpandedGroups(expandedGroups.filter(g => g !== group));
    } else {
      setExpandedGroups([...expandedGroups, group]);
    }
  };

  // Grouping logic (only applied when not searching)
  const groupedSessions: Record<string, typeof sessionsWithIndex> = {};
  const rootSessions: typeof sessionsWithIndex = [];

  if (!searchQuery) {
    filteredSessions.forEach(s => {
      if (s.group && s.group.trim() !== '') {
        const g = s.group.trim();
        if (!groupedSessions[g]) groupedSessions[g] = [];
        groupedSessions[g].push(s);
      } else {
        rootSessions.push(s);
      }
    });
  }

  const renderSessionItem = (session: typeof sessionsWithIndex[0], isNested: boolean = false) => {
    const idx = session.originalIndex;
    return (
      <div key={idx} className={`relative w-full flex items-center gap-1 px-3 py-2 rounded-xl border-l-2 transition-all duration-200 ease-out text-sm group ${
        selectedSessionIndex === idx 
          ? isDark ? 'text-neutral-100 border-primary bg-black/40' : 'text-slate-900 border-primary bg-primary/10 shadow-sm font-bold'
          : isDark 
            ? 'text-neutral-500 hover:text-neutral-100 hover:font-bold hover:bg-black/20 border-transparent' 
            : 'bg-white/40 hover:bg-white/80 hover:font-bold border-transparent text-slate-700 shadow-sm'
      } ${isNested ? 'ml-2 w-[calc(100%-0.5rem)]' : ''}`}>
        <button type="button" onClick={() => { setSelectedSessionIndex(idx); setActiveTabId(null); }} className="w-full flex items-center justify-start gap-2.5 truncate text-left pr-2 group-hover:pr-24 transition-all duration-200">
           <OsBadge osType={session.osType} protocol={session.protocol} isActive={selectedSessionIndex === idx} />
           <span className="truncate">{session.alias || `${session.username}@${session.host}`}</span>
        </button>
         <div className="absolute right-2 flex items-center gap-[5px] justify-end opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none group-hover:pointer-events-auto">
           <button onClick={(e) => { e.stopPropagation(); setSelectedSessionIndex(idx); setActiveTabId(null); }} className="p-1 hover:text-primary hover:bg-primary/20 rounded-xl transition-all pointer-events-auto" title={t('sidebar.editSession') as string}>
             <Edit2 className="w-3.5 h-3.5" />
           </button>
           <button onClick={(e) => onToggleAutoStart(e, sessions[idx])} className={`p-1 rounded-xl transition-all pointer-events-auto ${session.autoStart ? 'text-yellow-400 hover:bg-yellow-400/20' : 'hover:text-yellow-500 hover:bg-yellow-500/20'}`} title={t('sidebar.autoStartSession') as string}>
             <Zap className="w-3.5 h-3.5" />
           </button>
           <button onClick={(e) => onDeleteSession(e, sessions[idx])} className="p-1 hover:text-red-500 hover:bg-red-500/20 rounded-xl transition-all pointer-events-auto" title={t('sidebar.deleteSession') as string}>
             <X className="w-3.5 h-3.5" />
           </button>
         </div>
      </div>
    );
  };

  if (isSidebarCollapsed) {
    return (
      <div className={`drag-region h-full flex flex-col items-center py-4 ${isFullScreen ? 'pt-4' : (isMac ? 'pt-10' : 'pt-8')} bg-transparent transition-all duration-300 w-full`}>
        <button onClick={() => setIsSidebarCollapsed(false)} className={`no-drag-region p-2 mt-2 rounded-xl transition-colors ${isDark ? 'hover:bg-white/10 text-white/50' : 'hover:bg-black/10 text-black/50'}`} title="Expand Sidebar">
          <PanelLeftOpen className="w-5 h-5" />
        </button>
      </div>
    );
  }

  const activeWs = workspaces.find((w: any) => typeof w === 'object' ? w.id === activeWorkspaceId : w === activeWorkspaceId);
  const displayName = activeWs && typeof activeWs === 'object' ? activeWs.name || activeWorkspaceId : activeWorkspaceId;

  return (
    <div className={`drag-region h-full w-full flex flex-col p-4 ${isFullScreen ? 'pt-4' : (isMac ? 'pt-10' : 'pt-8')} shrink-0 transition-all duration-300 bg-transparent`}>
      <div className="no-drag-region flex items-center justify-between mb-6">
        <div className="flex items-center gap-2 flex-1 min-w-0 mr-2">
          <h1 className="font-bold text-sm tracking-widest uppercase text-slate-800 dark:text-slate-100 truncate" title={displayName}>
            {displayName} / {activeWorkspaceId === 'default' ? t('sidebar.defaultWorkspace') : t('sidebar.workspace')}
          </h1>
        </div>
        <button onClick={() => setIsSidebarCollapsed(true)} className={`p-1.5 rounded-xl transition-colors ${isDark ? 'hover:bg-white/10 text-white/50' : 'hover:bg-black/10 text-black/50'}`} title="Collapse Sidebar">
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </div>

      <div className="no-drag-region relative mb-4">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
        <input 
          value={searchQuery} 
          onChange={e => setSearchQuery(e.target.value)} 
          type="text" 
          placeholder={t('sidebar.search')} 
          className={`w-full pl-9 pr-3 py-2 rounded-xl text-sm outline-none transition-all border border-transparent ${
            isDark 
              ? 'bg-black/20 text-white focus:bg-black/40 focus:border-primary placeholder:text-white/30' 
              : 'bg-slate-200/50 text-slate-900 focus:bg-white focus:border-primary placeholder:text-slate-400 shadow-sm'
          }`} 
        />
      </div>

      <div className="no-drag-region flex-1 space-y-2 overflow-y-auto overflow-x-hidden">
        <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 px-2">{t('sidebar.savedSessions')}</div>
        
        {/* Zero-Trust Vault Lock Interceptor */}
        {isVaultLocked ? (
          <div className={`mx-1 flex flex-col items-center gap-4 p-5 border rounded-xl ${
            isDark 
              ? 'border-red-500/20 bg-red-950/20' 
              : 'border-red-500/20 bg-red-50/50'
          }`}>
            {/* Alert stripe top */}
            <div className="w-full h-px bg-gradient-to-r from-transparent via-red-500/50 to-transparent" />
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${
              isDark ? 'bg-red-500/10 border-red-500/20' : 'bg-red-100 border-red-200'
            }`}>
              <Lock className="w-6 h-6 text-red-400" />
            </div>
            <div className="flex flex-col items-center gap-1 text-center">
              <div className="text-xs font-black tracking-[0.2em] text-red-400 uppercase">VAULT LOCKED</div>
              <div className={`text-[10px] font-mono leading-relaxed ${
                isDark ? 'text-white/30' : 'text-black/30'
              }`}>
                资产数据已由
                <br/>
                <span className="text-red-400/70">AES-256-GCM</span> 加密封存
              </div>
            </div>
            <button
              onClick={() => setIsUnlockModalOpen(true)}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 hover:border-red-500/50 text-red-400 text-[10px] font-black uppercase tracking-widest transition-all rounded-xl"
            >
              <KeyRound className="w-3.5 h-3.5" />
              解锁物理金库
            </button>
            <div className="w-full h-px bg-gradient-to-r from-transparent via-red-500/20 to-transparent" />
          </div>
        ) : (
          <>
            <div className="space-y-1">
            {searchQuery ? (
              // Flat list during search
              filteredSessions.map(s => renderSessionItem(s))
            ) : (
              // Tree structure when not searching
              <>
                {/* Render Folders */}
                {Object.entries(groupedSessions).sort(([a], [b]) => a.localeCompare(b)).map(([groupName, groupSessions]) => {
                  const isExpanded = expandedGroups.includes(groupName);
                  return (
                    <div key={`group-${groupName}`} className="flex flex-col gap-1">
                      <button 
                        onClick={() => toggleGroup(groupName)}
                        className={`w-full flex items-center gap-2 px-2 py-2 rounded-xl transition-all text-sm font-medium ${
                          isDark ? 'text-white/70 hover:bg-white/10' : 'text-black/70 hover:bg-black/5'
                        }`}
                      >
                        {isExpanded ? <ChevronDown className="w-4 h-4 opacity-50" /> : <ChevronRight className="w-4 h-4 opacity-50" />}
                        <Folder className="w-4 h-4 text-primary opacity-80" />
                        <span className="truncate">{groupName}</span>
                        <span className="ml-auto text-[10px] opacity-40 font-mono bg-black/10 dark:bg-white/10 px-1.5 py-0.5 rounded-md">{groupSessions.length}</span>
                      </button>
                      
                      {isExpanded && (
                        <div className="flex flex-col gap-1 pl-2 relative before:content-[''] before:absolute before:left-[17px] before:top-0 before:bottom-2 before:w-px before:bg-gradient-to-b before:from-primary/30 before:to-transparent">
                          {groupSessions.map(s => renderSessionItem(s, true))}
                        </div>
                      )}
                    </div>
                  );
                })}
                
                {/* Render Root Sessions */}
                {rootSessions.length > 0 && Object.keys(groupedSessions).length > 0 && (
                  <div className="my-2 border-t border-black/5 dark:border-white/5" />
                )}
                {rootSessions.map(s => renderSessionItem(s))}
              </>
            )}
          </div>
            
          <button type="button" onClick={onAddSession} className={`flex items-center justify-center gap-2 w-full py-3 mt-4 rounded-xl border border-transparent transition-all font-medium text-sm ${isDark ? 'text-neutral-500 hover:text-neutral-100 hover:bg-white/5 border-dashed border-white/20' : 'bg-white hover:bg-slate-50 text-slate-700 border-dashed border-black/10 shadow-sm'}`}>
            <Plus className={`w-4 h-4 shrink-0 ${!isDark ? 'text-primary' : ''}`} />
            <span>{t('sidebar.newConnection')}</span>
          </button>

        </>
      )}
      </div>
    </div>
  );
};
