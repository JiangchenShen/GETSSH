import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/appStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { Plus, Layers, Loader2, Trash2, Shield, LayoutGrid, Star, Link, TerminalSquare, Database, FileJson } from 'lucide-react';
import { MoovierTile } from '@moovier/core';
import { ExportTab } from './secure-center/tabs/ExportTab';
import { AssetBridgeTab } from './workspace-center/AssetBridgeTab';
import { EnvironmentHooksTab } from './workspace-center/tabs/EnvironmentHooksTab';
import { StorageAuditTab } from './workspace-center/tabs/StorageAuditTab';

export const WorkspaceCenter: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'all' | 'export' | 'assetBridge' | 'envHooks' | 'storageAudit'>('all');
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const workspaces = useWorkspaceStore(state => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);

  const switchWorkspace = useWorkspaceStore(state => state.switchWorkspace);

  const setIsCreateModalOpen = useWorkspaceStore(state => state.setIsCreateModalOpen);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSwitch = async (id: string) => {
    if (id === activeWorkspaceId) {
      return;
    }
    setLoading(true);
    setError(null);
    const success = await switchWorkspace(id);
    if (success) {
      // Managed by switchWorkspace inside workspaceStore now
    } else {
      setError('Workspace switch failed. Check console for details.');
    }
    setLoading(false);
  };



  return (
    <div className={`w-full h-full flex flex-col overflow-hidden relative border shadow-2xl rounded-xl ${isDark ? 'bg-transparent text-white border-white/5' : 'bg-transparent text-slate-900 border-black/5'} transition-colors duration-1000`}>

        {/* Ambient Lighting (The Void) */}
        {isDark && (
          <>
            <div className="absolute top-[-20%] left-[-10%] w-[70%] h-[70%] bg-purple-600/15 rounded-full blur-[150px] pointer-events-none mix-blend-screen transition-colors duration-1000" />
            <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-indigo-600/15 rounded-full blur-[150px] pointer-events-none mix-blend-screen transition-colors duration-1000" />
          </>
        )}

        {/* Content Area - Split Pane */}
        <div className={`flex-1 flex overflow-hidden bg-transparent z-10 relative`}>
          
          {/* Left Sidebar */}
          <div className={`w-80 p-8 flex flex-col gap-6 border-r ${isDark ? 'border-white/5 bg-black/20' : 'border-black/5 bg-white/30'} backdrop-blur-md`}>
            {/* Header Widget */}
            <div className={`w-full p-8 flex flex-col items-center justify-center gap-5 border rounded-[32px] relative overflow-hidden shadow-lg ${isDark ? 'bg-purple-500/10 border-purple-500/30' : 'bg-purple-500/5 border-purple-500/20'}`}>
              <div className="absolute inset-0 bg-gradient-to-b from-purple-500/10 to-transparent opacity-50 pointer-events-none" />
              <Layers className="w-20 h-20 text-purple-500 drop-shadow-[0_0_30px_rgba(168,85,247,0.6)] animate-pulse relative z-10" />
              <div className="text-center relative z-10">
                <h3 className={`text-[17px] font-black tracking-tight mb-1 ${isDark ? 'text-white' : 'text-slate-800'}`}>{t('workspaceCenter.title', 'Workspace Center')}</h3>
                <p className={`text-[10px] font-bold uppercase tracking-widest ${isDark ? 'text-white/50' : 'text-slate-500'}`}>{t('workspaceCenter.subtitle', 'Manage isolated sandboxes')}</p>
              </div>
            </div>

            {/* Navigation Menu */}
            <nav className="flex flex-col gap-1 overflow-y-auto pb-4">
              {(() => {
                const activeItemClass = isDark ? 'bg-purple-500/10 text-purple-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_0_10px_rgba(168,85,247,0.1)]' : 'bg-purple-500/10 text-purple-700 shadow-sm';
                const inactiveItemClass = isDark ? 'text-white/50 hover:text-white hover:bg-white/5' : 'text-slate-500 hover:text-slate-900 hover:bg-black/5';
                const baseItemClass = 'flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-all text-left font-bold border border-transparent';
                
                return (
                  <>
                    <div className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1 mt-4 px-4">{t('workspaceCenter.sidebar.overview', 'Overview')}</div>
                    <button onClick={() => setActiveTab('all')} className={`${baseItemClass} ${activeTab === 'all' ? activeItemClass : inactiveItemClass}`}><LayoutGrid className="w-4 h-4"/>{t('workspaceCenter.sidebar.allWorkspaces', 'All Workspaces')}</button>
                    
                    <div className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1 mt-4 px-4">{t('workspaceCenter.sidebar.dataEnv', 'Data & Environment')}</div>
                    <button onClick={() => setActiveTab('export')} className={`${baseItemClass} ${activeTab === 'export' ? activeItemClass : inactiveItemClass}`}><FileJson className="w-4 h-4"/>{t('security.exportTitle', 'Data Import/Export')}</button>
                    <button onClick={() => setActiveTab('assetBridge')} className={`${baseItemClass} ${activeTab === 'assetBridge' ? activeItemClass : inactiveItemClass}`}><Link className="w-4 h-4"/>{t('workspaceCenter.sidebar.assetBridge', 'Asset Bridge')}</button>
                    <button onClick={() => setActiveTab('envHooks')} className={`${baseItemClass} ${activeTab === 'envHooks' ? activeItemClass : inactiveItemClass}`}><TerminalSquare className="w-4 h-4"/>{t('workspaceCenter.sidebar.envHooks', 'Environment Hooks')}</button>
                    <button onClick={() => setActiveTab('storageAudit')} className={`${baseItemClass} ${activeTab === 'storageAudit' ? activeItemClass : inactiveItemClass}`}><Database className="w-4 h-4"/>{t('workspaceCenter.sidebar.storageAudit', 'Storage & Audit')}</button>
                  </>
                );
              })()}
            </nav>
          </div>

          {/* Right Payload Area */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden relative">
            <div className="max-w-4xl mx-auto p-12 pb-24 animate-in fade-in slide-in-from-bottom-4 duration-500">
              {error && (
                <div className="p-4 bg-red-500/10 border border-red-500/50 text-red-500 font-bold rounded-xl shadow-sm mb-10">
                  {error}
                </div>
              )}
              
              {activeTab === 'all' && (
                <>
                  <div className="flex items-center justify-between mb-10">
                    <h3 className="text-3xl font-black tracking-tight flex items-center gap-4 uppercase">
                      <Layers className="w-8 h-8 text-purple-500" /> {t('workspaceCenter.activeWorkspaces')}
                    </h3>
                    <button 
                      onClick={() => setIsCreateModalOpen(true)}
                      className="px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white text-xs font-black uppercase tracking-widest transition-all rounded-xl shadow-[0_0_20px_rgba(147,51,234,0.4)] flex items-center gap-2 hover:scale-105"
                    >
                      <Plus className="w-4 h-4" /> {t('workspaceCenter.create')}
                    </button>
                  </div>

                  <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-8">
            {workspaces.map((wObj: any) => {
               const id = typeof wObj === 'string' ? wObj : wObj.id;
               const meta = typeof wObj === 'string' ? null : wObj.visualMeta;
               const isActive = id === useWorkspaceStore.getState().activeWorkspaceId;
               const isMain = typeof wObj === 'string' ? id === 'default' : !!wObj.isMain;
               const themeColor = meta?.themeColor || '#a855f7';
               const displayName = id === 'default' ? t('sidebar.defaultWorkspace') : (wObj.name || id);
               
               return (
                 <MoovierTile 
                   key={id}
                   dragLevel="fixed"
                   onClick={() => handleSwitch(id)}
                   className={`p-8 min-h-[220px] flex flex-col justify-between cursor-pointer group relative overflow-hidden transition-all duration-500 rounded-[32px] backdrop-blur-xl border shadow-lg ${isActive ? 'bg-purple-500/5 border-purple-500/30 ring-1 ring-purple-500/50' : (isDark ? 'bg-white/5 border-white/5 hover:-translate-y-2 hover:shadow-[0_20px_40px_rgba(0,0,0,0.3)] hover:border-white/20' : '!bg-white !border-black/5 hover:-translate-y-2 hover:shadow-[0_20px_40px_rgba(0,0,0,0.1)] hover:border-black/20')}`}
                 >
                   {/* Dynamic Glowing Top Border */}
                   <div className="absolute top-0 left-0 right-0 h-1" style={{ backgroundColor: themeColor, boxShadow: `0 0 15px ${themeColor}` }} />
                   
                   {/* Ambient Background Fill */}
                   <div className={`absolute inset-0 transition-opacity duration-500 pointer-events-none ${isActive ? 'opacity-10' : 'opacity-0 group-hover:opacity-5'}`} style={{ backgroundColor: themeColor }} />
                   
                   <div className="flex items-start justify-between z-10 relative">
                     <div className="w-20 h-20 flex items-center justify-center font-black text-4xl text-white shadow-inner rounded-3xl bg-black/40 border border-white/5" style={{ textShadow: `0 0 20px ${themeColor}` }}>
                       {displayName.substring(0, 1).toUpperCase()}
                     </div>
                      <div className="flex flex-col items-end gap-2">
                        {isActive && (
                          <span className="px-4 py-1.5 bg-purple-500/20 text-purple-400 font-bold tracking-widest text-[10px] uppercase rounded-full border border-purple-500/30 shadow-[0_0_15px_rgba(168,85,247,0.2)] flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" /> {t('workspaceCenter.current')}
                          </span>
                        )}
                        {isMain && (
                          <span className="px-4 py-1.5 bg-yellow-500/20 text-yellow-400 font-bold tracking-widest text-[10px] uppercase rounded-full border border-yellow-500/30 shadow-[0_0_15px_rgba(234,179,8,0.2)] flex items-center gap-2">
                            <Star className="w-3 h-3 fill-yellow-400" /> {t('workspaceCenter.main')}
                          </span>
                        )}
                       <div className="flex items-center gap-2 mt-2">
                         {!isMain && (
                           <button
                             onClick={(e) => {
                               e.stopPropagation();
                               if (window.confirm(t('workspaceCenter.setMainConfirm', { name: displayName }))) {
                                 useWorkspaceStore.getState().setMainWorkspace(id);
                               }
                              }}
                              className="p-2 bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500 hover:text-white rounded-full transition-all border border-yellow-500/20 opacity-0 group-hover:opacity-100"
                              title={t('workspaceCenter.setMainTooltip')}
                            >
                             <Star className="w-4 h-4" />
                           </button>
                         )}
                         {!isMain && id !== 'default' && (
                           <button
                             onClick={(e) => {
                               e.stopPropagation();
                               if (window.confirm(t('workspaceCenter.deleteConfirm', { name: displayName }))) {
                                 useWorkspaceStore.getState().deleteWorkspace(id);
                               }
                              }}
                              className="p-2 bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white rounded-full transition-all border border-red-500/20 opacity-0 group-hover:opacity-100"
                              title={t('workspaceCenter.deleteTooltip')}
                            >
                             <Trash2 className="w-4 h-4" />
                           </button>
                         )}
                       </div>
                     </div>
                   </div>
                      <div className="mt-auto pt-8 z-10 relative">
                      <h4 className="text-2xl font-black mb-2 truncate text-white tracking-wide" title={displayName}>{displayName}</h4>
                      <div className="text-xs font-bold uppercase tracking-widest opacity-40 flex items-center gap-2">
                        {loading && isActive ? <><Loader2 className="w-3 h-3 animate-spin" /> {t('workspaceCenter.synchronizing')}</> : t('workspaceCenter.isolatedSandbox')}
                      </div>
                    </div>
                 </MoovierTile>
               )
            })}
                  </div>
                </>
              )}
              {activeTab === 'export' && (
                <div className="max-w-3xl mx-auto mt-4">
                  <ExportTab />
                </div>
              )}
              {activeTab === 'assetBridge' && (
                <AssetBridgeTab />
              )}
              {activeTab === 'envHooks' && (
                <div className="max-w-3xl mx-auto mt-4">
                  <EnvironmentHooksTab />
                </div>
              )}
              {activeTab === 'storageAudit' && (
                <div className="max-w-3xl mx-auto mt-4">
                  <StorageAuditTab />
                </div>
              )}
              {activeTab !== 'all' && activeTab !== 'export' && activeTab !== 'assetBridge' && activeTab !== 'envHooks' && activeTab !== 'storageAudit' && (
                <div className="flex flex-col items-center justify-center pt-24 text-center opacity-50">
                  <Shield className="w-16 h-16 mb-6 text-purple-500" />
                  <h4 className="text-xl font-black uppercase tracking-widest mb-2">{t('workspaceCenter.comingSoon', 'Coming Soon')}</h4>
                  <p className="text-sm font-medium">{t('workspaceCenter.underDevelopment', 'This module is under development.')}</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Loading Overlay */}
        {loading && (
           <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-md flex flex-col items-center justify-center rounded-xl">
              <div className="relative">
                <Loader2 className="w-16 h-16 text-purple-500 animate-spin mb-6 relative z-10" />
                <div className="absolute inset-0 bg-purple-500 blur-2xl opacity-50 animate-pulse" />
              </div>
              <div className="text-2xl font-black uppercase tracking-[0.3em] text-white">{t('workspaceCenter.switchingWorkspace')}</div>
              <div className="text-sm font-bold tracking-widest text-purple-400 mt-2 uppercase opacity-80 animate-pulse">{t('workspaceCenter.pleaseWait')}</div>
           </div>
        )}
      </div>
  );
};
