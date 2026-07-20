import React, { useState, useEffect } from 'react';
import { TerminalSquare, Play, FastForward, CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../../store/appStore';
import { useWorkspaceStore } from '../../../store/workspaceStore';

export const EnvironmentHooksTab: React.FC = () => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const workspaces = useWorkspaceStore(state => state.workspaces);
  const activeWs = workspaces.find(w => w.id === activeWorkspaceId);
  
  const [hooks, setHooks] = useState({
    onConnect: '',
    onDisconnect: '',
    defaultPath: '~'
  });

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (activeWs?.preferences?.envHooks) {
      setHooks(prev => ({ ...prev, ...activeWs.preferences.envHooks }));
    }
  }, [activeWs?.preferences]);

  const handleSave = async () => {
    setSaving(true);
    if (activeWorkspaceId && window.electronAPI?.updateWorkspacePreferences) {
      const prefs = {
        ...(activeWs?.preferences || {}),
        envHooks: hooks
      };
      await window.electronAPI.updateWorkspacePreferences(activeWorkspaceId, JSON.stringify(prefs));
      await useWorkspaceStore.getState().initWorkspaces();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
    setSaving(false);
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <h4 className="text-4xl font-black tracking-tight flex items-center gap-4 text-white">
          <TerminalSquare className="w-10 h-10 text-orange-500"/> 
          {t("workspaceCenter.envHooksTitle", "Environment Hooks")}
        </h4>
      </div>
      
      <div className="relative overflow-hidden p-8 bg-black/40 border border-orange-500/20 flex flex-col gap-6 rounded-[32px] shadow-2xl backdrop-blur-xl">
        <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 to-transparent opacity-50 pointer-events-none" />
        
        <p className={`text-sm mb-2 relative z-10 ${isDark ? 'text-white/60' : 'text-black/60'}`}>
          {t("workspaceCenter.envHooksDesc", "Configure automatic actions and environment variables applied to all terminal sessions within this workspace.")}
        </p>

        <div className="space-y-6 relative z-10">
          
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest opacity-70">
              <FastForward className="w-4 h-4"/> {t("workspaceCenter.defaultInitialPath", "Default Initial Path")}
            </label>
            <input 
              type="text"
              value={hooks.defaultPath}
              onChange={e => setHooks(prev => ({...prev, defaultPath: e.target.value}))}
              placeholder="~"
              className={`w-full p-4 border text-sm font-mono tracking-wide outline-none transition-all rounded-xl focus:border-orange-500/50 shadow-inner ${isDark ? 'bg-black/50 border-white/10 text-white focus:bg-black/80' : 'bg-white border-black/10 text-black'}`}
            />
          </div>

          <div className="space-y-3">
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest opacity-70">
              <Play className="w-4 h-4"/> {t("workspaceCenter.postConnectScript", "Post-Connect Execution Script")}
            </label>
            <textarea 
              value={hooks.onConnect}
              onChange={e => setHooks(prev => ({...prev, onConnect: e.target.value}))}
              placeholder="e.g., source ~/.nvm/nvm.sh || export PATH=$PATH:/usr/local/bin"
              rows={4}
              className={`w-full p-4 border text-sm font-mono tracking-wide outline-none transition-all rounded-xl focus:border-orange-500/50 shadow-inner resize-none ${isDark ? 'bg-black/50 border-white/10 text-white focus:bg-black/80' : 'bg-white border-black/10 text-black'}`}
            />
            <p className="text-[10px] opacity-40 italic">{t("workspaceCenter.postConnectScriptDesc", "This bash script will run silently immediately after SSH authentication.")}</p>
          </div>

          <div className="flex justify-end pt-4 border-t border-white/5">
            <button 
              onClick={handleSave}
              disabled={saving}
              className="py-3 px-8 text-sm font-black tracking-widest uppercase bg-orange-600 hover:bg-orange-500 text-white transition-all shadow-[0_0_20px_rgba(249,115,22,0.4)] rounded-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saved ? <><CheckCircle2 className="w-4 h-4" /> {t("workspaceCenter.saved", "Saved")}</> : t("workspaceCenter.saveHooks", "Save Hooks")}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};
