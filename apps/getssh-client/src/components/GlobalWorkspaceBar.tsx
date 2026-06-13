import React, { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { Settings, Plus, Sparkles } from 'lucide-react';

interface GlobalWorkspaceBarProps {
  openSettingsTab: (tab: string, toggle?: boolean) => void;
}

export const GlobalWorkspaceBar: React.FC<GlobalWorkspaceBarProps> = ({ openSettingsTab }) => {
  const isDark = useAppStore(state => state.isDark);
  const workspaces = useWorkspaceStore(state => state.workspaces);
  const setWorkspaces = useAppStore(state => state.setWorkspaces);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const switchWorkspace = useWorkspaceStore(state => state.switchWorkspace);
  const setIsCreateModalOpen = useWorkspaceStore(state => state.setIsCreateModalOpen);
  
  const setIsWorkspaceCenterOpen = useAppStore(state => state.setIsWorkspaceCenterOpen);
  const setIsAiCenterOpen = useAppStore(state => state.setIsAiCenterOpen);

  useEffect(() => {
    const fetchWorkspaces = async () => {
      if (window.electronAPI?.workspace?.getWorkspaces) {
        try {
          const wsList = await window.electronAPI.workspace.getWorkspaces();
          setWorkspaces(wsList);
        } catch (e) {
          console.error('Failed to fetch workspaces:', e);
        }
      }
    };
    fetchWorkspaces();
  }, [setWorkspaces]);

  const handleWorkspaceSwitch = async (id: string) => {
    if (id === activeWorkspaceId) {
      setIsWorkspaceCenterOpen(true);
      return;
    }
    await switchWorkspace(id);
  };

  return (
    <div className={`w-[64px] h-full flex flex-col items-center py-4 border-r ${isDark ? 'bg-black/40 border-white/5' : 'bg-white/40 border-black/5'} backdrop-blur-xl z-[999] pt-12 rounded-none [-webkit-app-region:drag]`}>
      {/* Top: Workspaces List */}
      <div className="flex flex-col items-center gap-3 flex-1 overflow-y-auto no-scrollbar w-full [-webkit-app-region:no-drag]">
        {workspaces.map((wObj: any) => {
          const wsId = typeof wObj === 'string' ? wObj : wObj.id;
          const meta = typeof wObj === 'string' ? null : wObj.visualMeta;
          const isActive = wsId === activeWorkspaceId;
          const customStyle = meta?.themeColor ? { backgroundColor: meta.themeColor } : {};
          const bgClass = wsId === 'default' && !meta?.themeColor ? 'bg-slate-800' : (!meta?.themeColor ? 'bg-red-900' : '');
          
          return (
            <div
              key={wsId}
              onClick={() => handleWorkspaceSwitch(wsId)}
              className="relative group cursor-pointer w-full flex items-center justify-center py-1"
            >
              {/* Dynamic Pill Indicator */}
              <div
                className={`absolute left-0 top-1/2 -translate-y-1/2 w-[4px] bg-white rounded-r-md transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                  isActive ? 'h-[40px]' : 'h-[0px] group-hover:h-[20px]'
                }`}
              />
              
              {/* Avatar with Fluid Morphing */}
              <div 
                style={customStyle}
                className={`w-12 h-12 flex items-center justify-center text-lg font-black transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${bgClass} text-white ${
                  isActive 
                    ? 'rounded-[16px] shadow-[0_4px_10px_rgba(0,0,0,0.5),inset_1px_1px_0px_rgba(255,255,255,0.2)] brightness-110' 
                    : 'rounded-[50%] group-hover:rounded-[16px] brightness-75 group-hover:brightness-100'
                }`}
              >
                {wsId.charAt(0).toUpperCase()}
              </div>
            </div>
          );
        })}
        
        {/* Add Workspace Button (Discord Style) */}
        <div 
          onClick={() => setIsCreateModalOpen(true)}
          className={`w-12 h-12 flex items-center justify-center mt-2 mb-2 transition-all duration-300 cursor-pointer text-[#10b981] bg-[rgba(255,255,255,0.05)] hover:bg-[#10b981] hover:text-white rounded-[50%] hover:rounded-[16px]`}
        >
          <Plus className="w-6 h-6" />
        </div>
      </div>

      {/* Bottom: Settings & AI */}
      <div className="flex flex-col items-center gap-2 mt-auto mb-2 w-full px-2 [-webkit-app-region:no-drag]">
        <div 
          onClick={() => setIsAiCenterOpen(true)}
          className={`w-full h-12 flex items-center justify-center transition-colors cursor-pointer rounded-none ${
            isDark ? 'text-amber-500/50 hover:text-amber-400 hover:bg-amber-500/10' : 'text-amber-600/50 hover:text-amber-600 hover:bg-amber-600/10'
          }`}
        >
          <Sparkles className="w-6 h-6" />
        </div>
        <div 
          onClick={() => openSettingsTab('Appearance', true)}
          className={`w-full h-12 flex items-center justify-center transition-colors cursor-pointer rounded-none ${
            isDark ? 'text-white/40 hover:text-white hover:bg-white/10' : 'text-black/40 hover:text-black hover:bg-black/10'
          }`}
        >
          <Settings className="w-6 h-6" />
        </div>
      </div>
    </div>
  );
};
