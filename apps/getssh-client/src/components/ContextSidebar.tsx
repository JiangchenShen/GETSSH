import React from 'react';
import { Search, Plus, Edit2, Zap, X, Server, Terminal, PanelLeftClose, PanelLeftOpen, Lock, KeyRound } from 'lucide-react';
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

const OsBadge: React.FC<OsBadgeProps> = ({ protocol, isActive }) => {
  return (
    <div className={`w-6 h-6 flex items-center justify-center rounded-none shrink-0 border ${isActive ? 'border-primary/30 bg-primary/20 text-primary' : 'border-current opacity-60 text-current'}`}>
      {protocol === 'local' ? <Terminal className="w-3.5 h-3.5" /> : <Server className="w-3.5 h-3.5" />}
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
  const activeWorkspaceId = useAppStore(state => state.activeWorkspaceId);
  
  const isVaultLocked = useWorkspaceStore(state => state.isVaultLocked);
  const setIsUnlockModalOpen = useWorkspaceStore(state => state.setIsUnlockModalOpen);
  
  const sessions = useSessionStore(state => state.sessions);
  const searchQuery = useSessionStore(state => state.searchQuery);
  const setSearchQuery = useSessionStore(state => state.setSearchQuery);
  const selectedSessionIndex = useSessionStore(state => state.selectedSessionIndex);
  const setSelectedSessionIndex = useSessionStore(state => state.setSelectedSessionIndex);
  const setActiveTabId = useSessionStore(state => state.setActiveTabId);

  const filteredSessions = sessions.filter(s => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (s.alias && s.alias.toLowerCase().includes(query)) ||
           (s.host && s.host.toLowerCase().includes(query)) ||
           (s.username && s.username.toLowerCase().includes(query));
  });

  if (isSidebarCollapsed) {
    return (
      <div className={`h-full flex flex-col items-center py-4 ${isFullScreen ? 'pt-4' : (isMac ? 'pt-10' : 'pt-8')} border-r ${isDark ? 'border-white/5 bg-transparent' : 'border-black/5 bg-transparent'} transition-all duration-300 w-full`}>
        <button onClick={() => setIsSidebarCollapsed(false)} className={`p-2 mt-2 rounded-none transition-colors ${isDark ? 'hover:bg-white/10 text-white/50' : 'hover:bg-black/10 text-black/50'}`} title="Expand Sidebar">
          <PanelLeftOpen className="w-5 h-5" />
        </button>
      </div>
    );
  }

  return (
    <div className={`h-full w-full flex flex-col p-4 ${isFullScreen ? 'pt-4' : (isMac ? 'pt-10' : 'pt-8')} shrink-0 transition-all duration-300 bg-transparent border-r ${isDark ? 'border-white/5' : 'border-black/5'}`}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <h1 className="font-bold text-sm tracking-widest uppercase text-slate-800 dark:text-slate-100">
            {activeWorkspaceId} / {activeWorkspaceId === 'default' ? '工作区' : 'Workspace'}
          </h1>
        </div>
        <button onClick={() => setIsSidebarCollapsed(true)} className={`p-1.5 rounded-none transition-colors ${isDark ? 'hover:bg-white/10 text-white/50' : 'hover:bg-black/10 text-black/50'}`} title="Collapse Sidebar">
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </div>

      <div className="relative mb-4">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
        <input 
          value={searchQuery} 
          onChange={e => setSearchQuery(e.target.value)} 
          type="text" 
          placeholder={t('sidebar.search')} 
          className={`w-full pl-9 pr-3 py-2 rounded-none text-sm outline-none transition-all border border-transparent ${
            isDark 
              ? 'bg-black/20 text-white focus:bg-black/40 focus:border-primary placeholder:text-white/30' 
              : 'bg-slate-200/50 text-slate-900 focus:bg-white focus:border-primary placeholder:text-slate-400 shadow-sm'
          }`} 
        />
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto overflow-x-hidden">
        <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 px-2">{t('sidebar.savedSessions')}</div>
        
        {/* Zero-Trust Vault Lock Interceptor */}
        {isVaultLocked ? (
          <div className={`mx-1 flex flex-col items-center gap-4 p-5 border rounded-none ${
            isDark 
              ? 'border-red-500/20 bg-red-950/20' 
              : 'border-red-500/20 bg-red-50/50'
          }`}>
            {/* Alert stripe top */}
            <div className="w-full h-px bg-gradient-to-r from-transparent via-red-500/50 to-transparent" />
            <div className={`w-12 h-12 rounded-none flex items-center justify-center border ${
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
              className="w-full flex items-center justify-center gap-2 py-2.5 px-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 hover:border-red-500/50 text-red-400 text-[10px] font-black uppercase tracking-widest transition-all rounded-none"
            >
              <KeyRound className="w-3.5 h-3.5" />
              解锁物理金库
            </button>
            <div className="w-full h-px bg-gradient-to-r from-transparent via-red-500/20 to-transparent" />
          </div>
        ) : (
          <>
            {filteredSessions.map((session, idx) => (
               <div key={idx} className={`w-full flex items-center justify-between gap-1 px-3 py-2 rounded-none border-l-2 transition-all duration-200 ease-out text-sm group ${
                 selectedSessionIndex === idx 
                   ? 'text-neutral-100 border-primary bg-black/40' 
                   : isDark 
                     ? 'text-neutral-500 hover:text-neutral-100 hover:bg-black/20 border-transparent' 
                     : 'bg-white/40 hover:bg-white/80 border-transparent text-slate-700 shadow-sm'
               }`}>
                 <button type="button" onClick={() => { setSelectedSessionIndex(idx); setActiveTabId(null); }} className="flex-1 flex items-center justify-start gap-2.5 truncate text-left">
                    <OsBadge osType={session.osType} protocol={session.protocol} isActive={selectedSessionIndex === idx} />
                    <span className="truncate">{session.alias || `${session.username}@${session.host}`}</span>
                 </button>
                  <div className="flex items-center gap-[5px] justify-end">
                    <button onClick={(e) => { e.stopPropagation(); setSelectedSessionIndex(idx); setActiveTabId(null); }} className="opacity-70 hover:opacity-100 p-1 hover:text-primary hover:bg-primary/20 rounded-none transition-all" title={t('sidebar.editSession') as string}>
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={(e) => onToggleAutoStart(e, session)} className={`p-1 rounded-none transition-all ${session.autoStart ? 'text-yellow-400 opacity-100 hover:bg-yellow-400/20' : 'opacity-70 hover:opacity-100 hover:text-yellow-500 hover:bg-yellow-500/20'}`} title={t('sidebar.autoStartSession') as string}>
                      <Zap className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={(e) => onDeleteSession(e, session)} className="opacity-70 hover:opacity-100 p-1 hover:text-red-500 hover:bg-red-500/20 rounded-none transition-all" title={t('sidebar.deleteSession') as string}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
               </div>
            ))}
            
            <button type="button" onClick={onAddSession} className={`flex items-center justify-center gap-2 w-full py-3 mt-4 rounded-none border border-transparent transition-all font-medium text-sm ${isDark ? 'text-neutral-500 hover:text-neutral-100 hover:bg-white/5 border-dashed border-white/20' : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-dashed border-black/20'}`}>
              <Plus className="w-4 h-4 shrink-0" />
              <span>{t('sidebar.newConnection')}</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
};
