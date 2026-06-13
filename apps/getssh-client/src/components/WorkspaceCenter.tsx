import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/appStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useSessionStore } from '../store/sessionStore';
import { Globe, X, Plus, Layers, Loader2 } from 'lucide-react';
import { MoovierTile } from '@moovier/core';

const PRESET_COLORS = ['#0ea5e9', '#f43f5e', '#8b5cf6', '#10b981', '#f59e0b', '#64748b'];

export const WorkspaceCenter: React.FC = () => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const workspaces = useWorkspaceStore(state => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const setIsWorkspaceCenterOpen = useAppStore(state => state.setIsWorkspaceCenterOpen);
  const switchWorkspace = useWorkspaceStore(state => state.switchWorkspace);

  const [isCreating, setIsCreating] = useState(false);
  const [newWsId, setNewWsId] = useState('');
  const [newWsColor, setNewWsColor] = useState(PRESET_COLORS[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSwitch = async (id: string) => {
    if (id === activeWorkspaceId) {
      setIsWorkspaceCenterOpen(false);
      return;
    }
    setLoading(true);
    setError(null);
    const success = await switchWorkspace(id);
    if (success) {
      // Managed by switchWorkspace inside workspaceStore now
      setIsWorkspaceCenterOpen(false);
    } else {
      setError('Workspace switch failed. Check console for details.');
    }
    setLoading(false);
  };

  const handleCreate = async () => {
    if (!newWsId.trim()) return;
    
    // Validate ID: alphanumeric and dashes only
    if (!/^[a-zA-Z0-9-]+$/.test(newWsId)) {
       setError('Workspace ID can only contain letters, numbers, and dashes.');
       return;
    }

    setLoading(true);
    setError(null);
    try {
      if (window.electronAPI?.workspace?.createWorkspace) {
         const res = await window.electronAPI.workspace.createWorkspace(newWsId.trim(), { themeColor: newWsColor, hasPassword: false });
         if (res && res.success) {
            // refresh workspace list
            if (window.electronAPI?.workspace?.getWorkspaces) {
               const wsList = await window.electronAPI.workspace.getWorkspaces();
               useWorkspaceStore.getState().setWorkspaces(wsList.map((ws: any) => ({
                 id: typeof ws === 'string' ? ws : ws.id,
                 name: typeof ws === 'string' ? ws : (ws.name || ws.id),
                 themeColor: typeof ws === 'string' ? '#0ea5e9' : (ws.themeColor || '#0ea5e9'),
                 hasPassword: typeof ws === 'string' ? false : !!ws.hasPassword
               })));
            }
            setIsCreating(false);
            setNewWsId('');
         } else {
            setError(res?.error || 'Failed to create workspace.');
         }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center p-8 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
      <div className={`relative w-[90vw] h-[90vh] max-w-[1200px] flex flex-col overflow-hidden border shadow-2xl rounded-none ${isDark ? 'bg-[#0A0A0A]/95 border-white/10' : 'bg-white/95 border-black/10'} backdrop-blur-3xl`}>
        
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between p-8 border-b border-white/5 bg-white/5" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <h2 className="text-3xl font-black flex items-center gap-4 uppercase tracking-widest text-white">
            <Globe className="w-8 h-8 text-purple-500" /> 
            WORKSPACE CENTER
          </h2>
          <button 
            onClick={() => setIsWorkspaceCenterOpen(false)} 
            className="p-3 transition-colors rounded-none hover:bg-white/10 text-white" 
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            disabled={loading}
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8 flex flex-col gap-8">

          {error && (
             <div className="p-4 bg-red-500/10 border border-red-500/50 text-red-500 font-bold rounded-none shadow-sm">
                {error}
             </div>
          )}
          
          <div className="flex items-center justify-between mb-2">
             <h3 className="text-xl font-bold flex items-center gap-3 uppercase"><Layers className="w-6 h-6 text-primary" /> {t('workspaceCenter.activeWorkspaces')}</h3>
             {!isCreating && (
               <button 
                 onClick={() => setIsCreating(true)}
                 className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 font-bold tracking-widest text-sm uppercase transition-colors rounded-none"
               >
                 <Plus className="w-4 h-4" /> New Sandbox
               </button>
             )}
          </div>

          {/* Creation Form */}
          {isCreating && (
             <MoovierTile dragLevel="local" className="p-8 bg-white/5 border border-white/10 flex flex-col gap-6 rounded-none shadow-[0_4px_10px_rgba(0,0,0,0.5)]">
               <h4 className="text-lg font-bold">Initialize New Quantum Sandbox</h4>
               <div className="flex flex-col gap-4">
                 <div>
                   <label className="block text-sm font-bold opacity-60 mb-2 uppercase tracking-widest">Workspace ID</label>
                   <input 
                     type="text" 
                     value={newWsId}
                     onChange={(e) => setNewWsId(e.target.value)}
                     placeholder="e.g. prod-cluster" 
                     className="w-full max-w-md bg-black/20 border border-white/10 px-4 py-3 outline-none focus:border-primary font-mono rounded-none transition-colors"
                   />
                 </div>
                 <div>
                   <label className="block text-sm font-bold opacity-60 mb-2 uppercase tracking-widest">Visual Identity (Theme)</label>
                   <div className="flex gap-3">
                     {PRESET_COLORS.map(color => (
                       <div 
                         key={color}
                         onClick={() => setNewWsColor(color)}
                         className={`w-10 h-10 cursor-pointer rounded-none border-2 transition-transform ${newWsColor === color ? 'border-white scale-110 shadow-[0_0_15px_rgba(255,255,255,0.3)]' : 'border-transparent hover:scale-105'}`}
                         style={{ backgroundColor: color }}
                       />
                     ))}
                   </div>
                 </div>
               </div>
               <div className="flex gap-4 mt-2">
                 <button 
                   onClick={handleCreate}
                   disabled={loading || !newWsId.trim()}
                   className="px-6 py-3 bg-primary hover:bg-primary/80 text-white font-bold uppercase tracking-widest flex items-center gap-2 rounded-none transition-colors disabled:opacity-50"
                 >
                   {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Globe className="w-5 h-5" />}
                   Forge Workspace
                 </button>
                 <button 
                   onClick={() => { setIsCreating(false); setError(null); }}
                   disabled={loading}
                   className="px-6 py-3 bg-white/5 hover:bg-white/10 font-bold uppercase tracking-widest rounded-none transition-colors"
                 >
                   Cancel
                 </button>
               </div>
             </MoovierTile>
          )}

          {/* Workspaces Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {workspaces.map((wObj: any) => {
               const id = typeof wObj === 'string' ? wObj : wObj.id;
               const meta = typeof wObj === 'string' ? null : wObj.visualMeta;
               const isActive = id === activeWorkspaceId;
               
               return (
                 <MoovierTile 
                   key={id}
                   dragLevel="local" 
                   onClick={() => handleSwitch(id)}
                   className={`p-8 min-h-[200px] flex flex-col justify-between cursor-pointer group relative overflow-hidden transition-all duration-500 rounded-none shadow-[0_4px_10px_rgba(0,0,0,0.5),0_10px_20px_rgba(0,0,0,0.4)] ${isActive ? 'ring-2 ring-white/50 bg-white/5' : 'bg-white/5 hover:-translate-y-1'}`}
                   style={meta?.themeColor ? { borderTop: `4px solid ${meta.themeColor}` } : { borderTop: '4px solid #333' }}
                 >
                   <div className="absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity duration-500 pointer-events-none" style={{ backgroundColor: meta?.themeColor || '#fff' }} />
                   
                   <div className="flex items-center justify-between z-10 relative">
                     <div className="w-16 h-16 flex items-center justify-center font-black text-3xl text-white/80 shadow-inner rounded-none bg-black/20" style={{ color: meta?.themeColor }}>
                       {id.substring(0, 1).toUpperCase()}
                     </div>
                     {isActive && (
                       <span className="px-3 py-1 bg-white/10 font-bold tracking-widest text-xs uppercase rounded-none border border-white/20 shadow-sm">
                         Active
                       </span>
                     )}
                   </div>
                   
                   <div className="mt-auto pt-6 z-10 relative">
                     <h4 className="text-2xl font-black mb-1 truncate" title={id}>{id}</h4>
                     <div className="text-sm opacity-50 flex items-center gap-2">
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
           <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-sm flex flex-col items-center justify-center rounded-none">
              <Loader2 className="w-12 h-12 text-primary animate-spin mb-4" />
              <div className="text-xl font-black uppercase tracking-widest">Executing Quantum Leap...</div>
           </div>
        )}
      </div>
    </div>
  );
};
