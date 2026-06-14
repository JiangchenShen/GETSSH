import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/appStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { Plus, Layers, Loader2 } from 'lucide-react';
import { MoovierTile } from '@moovier/core';

export const WorkspaceCenter: React.FC = () => {
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
    <div className={`w-full h-full flex flex-col overflow-hidden relative ${isDark ? 'bg-[#050510]/95 text-white' : 'bg-slate-50/95 text-slate-900'} backdrop-blur-3xl`}>

        {/* Ambient Lighting (The Void) */}
        {isDark && (
          <>
            <div className="absolute top-[-20%] left-[-10%] w-[70%] h-[70%] bg-purple-600/15 rounded-full blur-[150px] pointer-events-none mix-blend-screen" />
            <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-indigo-600/15 rounded-full blur-[150px] pointer-events-none mix-blend-screen" />
          </>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-10 flex flex-col gap-10 relative z-10 no-scrollbar">

          {error && (
             <div className="p-4 bg-red-500/10 border border-red-500/50 text-red-500 font-bold rounded-xl shadow-sm">
                {error}
             </div>
          )}
          
          <div className="flex items-center justify-between">
             <h3 className="text-3xl font-black tracking-tight flex items-center gap-4 uppercase">
               <Layers className="w-8 h-8 text-purple-500" /> {t('workspaceCenter.activeWorkspaces')}
             </h3>
             <button 
               onClick={() => setIsCreateModalOpen(true)}
               className="flex items-center gap-2 px-5 py-2.5 bg-purple-500/10 hover:bg-purple-500 text-purple-400 hover:text-white border border-purple-500/30 font-bold tracking-widest text-sm uppercase transition-all rounded-2xl hover:shadow-[0_0_20px_rgba(168,85,247,0.4)]"
             >
               <Plus className="w-5 h-5" /> New Sandbox
             </button>
          </div>



          {/* Workspaces Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
            {workspaces.map((wObj: any) => {
               const id = typeof wObj === 'string' ? wObj : wObj.id;
               const meta = typeof wObj === 'string' ? null : wObj.visualMeta;
               const isActive = id === activeWorkspaceId;
               const themeColor = meta?.themeColor || '#a855f7';
               
               return (
                 <MoovierTile 
                   key={id}
                   dragLevel="local" 
                   onClick={() => handleSwitch(id)}
                   className={`p-8 min-h-[220px] flex flex-col justify-between cursor-pointer group relative overflow-hidden transition-all duration-500 rounded-[32px] backdrop-blur-xl border shadow-lg ${isActive ? 'bg-purple-500/5 border-purple-500/30 ring-1 ring-purple-500/50' : 'bg-white/5 border-white/5 hover:-translate-y-2 hover:shadow-[0_20px_40px_rgba(0,0,0,0.3)] hover:border-white/20'}`}
                 >
                   {/* Dynamic Glowing Top Border */}
                   <div className="absolute top-0 left-0 right-0 h-1" style={{ backgroundColor: themeColor, boxShadow: `0 0 15px ${themeColor}` }} />
                   
                   {/* Ambient Background Fill */}
                   <div className={`absolute inset-0 transition-opacity duration-500 pointer-events-none ${isActive ? 'opacity-10' : 'opacity-0 group-hover:opacity-5'}`} style={{ backgroundColor: themeColor }} />
                   
                   <div className="flex items-start justify-between z-10 relative">
                     <div className="w-20 h-20 flex items-center justify-center font-black text-4xl text-white shadow-inner rounded-3xl bg-black/40 border border-white/5" style={{ textShadow: `0 0 20px ${themeColor}` }}>
                       {id.substring(0, 1).toUpperCase()}
                     </div>
                     {isActive && (
                       <span className="px-4 py-1.5 bg-purple-500/20 text-purple-400 font-bold tracking-widest text-[10px] uppercase rounded-full border border-purple-500/30 shadow-[0_0_15px_rgba(168,85,247,0.2)] flex items-center gap-2">
                         <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" /> CURRENT
                       </span>
                     )}
                   </div>
                   
                   <div className="mt-auto pt-8 z-10 relative">
                     <h4 className="text-2xl font-black mb-2 truncate text-white tracking-wide" title={id}>{id}</h4>
                     <div className="text-xs font-bold uppercase tracking-widest opacity-40 flex items-center gap-2">
                       {loading && isActive ? <><Loader2 className="w-3 h-3 animate-spin" /> Synchronizing...</> : 'Isolated Sandbox'}
                     </div>
                   </div>
                 </MoovierTile>
               )
            })}
          </div>

        </div>

        {/* Loading Overlay */}
        {loading && (
           <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-md flex flex-col items-center justify-center rounded-xl">
              <div className="relative">
                <Loader2 className="w-16 h-16 text-purple-500 animate-spin mb-6 relative z-10" />
                <div className="absolute inset-0 bg-purple-500 blur-2xl opacity-50 animate-pulse" />
              </div>
              <div className="text-2xl font-black uppercase tracking-[0.3em] text-white">Executing Quantum Leap</div>
              <div className="text-sm font-bold tracking-widest text-purple-400 mt-2 uppercase opacity-80 animate-pulse">Switching Dimensions...</div>
           </div>
        )}
      </div>
  );
};
