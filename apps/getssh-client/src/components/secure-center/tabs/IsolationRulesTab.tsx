import React, { useState, useEffect } from 'react';
import { ShieldAlert, Check, X, ShieldOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../../store/appStore';
import { useWorkspaceStore } from '../../../store/workspaceStore';

export const IsolationRulesTab: React.FC = () => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const workspaces = useWorkspaceStore(state => state.workspaces);
  const activeWs = workspaces.find(w => w.id === activeWorkspaceId);
  
  const [rules, setRules] = useState({
    disableSftp: false,
    disableTelnet: true,
    strictHostKeyChecking: false,
    preventDataExport: false
  });

  useEffect(() => {
    if (activeWs?.preferences?.isolationRules) {
      setRules(prev => ({ ...prev, ...activeWs.preferences.isolationRules }));
    }
  }, [activeWs?.preferences]);

  const toggleRule = async (key: keyof typeof rules) => {
    const newRules = { ...rules, [key]: !rules[key] };
    setRules(newRules);

    if (activeWorkspaceId && window.electronAPI?.updateWorkspacePreferences) {
      const prefs = {
        ...(activeWs?.preferences || {}),
        isolationRules: newRules
      };
      await window.electronAPI.updateWorkspacePreferences(activeWorkspaceId, JSON.stringify(prefs));
      await useWorkspaceStore.getState().initWorkspaces();
    }
  };

  const RuleItem = ({ id, icon: Icon, title, desc, danger = false }: any) => {
    const isActive = rules[id as keyof typeof rules];
    return (
      <div className={`p-5 rounded-2xl border transition-all ${isDark ? 'bg-black/40 border-white/5 hover:border-white/10' : 'bg-white/40 border-black/5 hover:border-black/10'} flex items-center justify-between`}>
        <div className="flex items-center gap-4">
          <div className={`p-3 rounded-xl ${danger && isActive ? 'bg-red-500/10 text-red-500' : 'bg-indigo-500/10 text-indigo-500'}`}>
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <h5 className="text-sm font-bold tracking-tight">{title}</h5>
            <p className={`text-xs mt-0.5 ${isDark ? 'text-white/50' : 'text-black/50'}`}>{desc}</p>
          </div>
        </div>
        <button 
          onClick={() => toggleRule(id as any)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isActive ? (danger ? 'bg-red-500' : 'bg-indigo-500') : isDark ? 'bg-white/20' : 'bg-black/20'}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isActive ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <h4 className="text-4xl font-black tracking-tight flex items-center gap-4 text-white"><ShieldAlert className="w-10 h-10 text-indigo-500"/> {t("workspaceCenter.isolationRulesTitle", "Isolation Rules")}</h4>
      </div>
      
      <div className="relative overflow-hidden p-8 bg-black/40 border border-indigo-500/20 flex flex-col gap-4 rounded-[32px] shadow-2xl backdrop-blur-xl">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-transparent opacity-50 pointer-events-none" />
        
        <p className={`text-sm mb-4 relative z-10 ${isDark ? 'text-white/60' : 'text-black/60'}`}>
          {t("workspaceCenter.isolationRulesDesc", "Configure strict security boundaries for this workspace. These rules apply to all connections within this database.")}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 relative z-10">
          <RuleItem 
            id="disableSftp" 
            icon={ShieldOff} 
            title={t("workspaceCenter.disableSftp", "Disable SFTP File Transfers")} 
            desc={t("workspaceCenter.disableSftpDesc", "Block all file uploads and downloads for this workspace.")} 
            danger 
          />
          <RuleItem 
            id="disableTelnet" 
            icon={ShieldAlert} 
            title={t("workspaceCenter.disableTelnet", "Block Plaintext Protocols")} 
            desc={t("workspaceCenter.disableTelnetDesc", "Prevent usage of unencrypted protocols like Telnet.")} 
          />
          <RuleItem 
            id="strictHostKeyChecking" 
            icon={Check} 
            title={t("workspaceCenter.strictHostKeyChecking", "Strict Host Key Checking")} 
            desc={t("workspaceCenter.strictHostKeyCheckingDesc", "Automatically reject connections if host key changes.")} 
          />
          <RuleItem 
            id="preventDataExport" 
            icon={X} 
            title={t("workspaceCenter.preventDataExport", "Prevent Data Export")} 
            desc={t("workspaceCenter.preventDataExportDesc", "Disable the ability to export profiles from this workspace.")} 
          />
        </div>
      </div>
    </div>
  );
};
