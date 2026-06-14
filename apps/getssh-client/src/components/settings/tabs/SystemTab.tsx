import React from 'react';
import { Command, Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../../store/appStore';

interface SystemTabProps {
  encryptionDisabled: boolean;
}

export const SystemTab: React.FC<SystemTabProps> = ({ encryptionDisabled }) => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const appConfig = useAppStore(state => state.appConfig);
  const updateConfig = useAppStore(state => state.updateConfig);

  return (
    <div className="max-w-4xl mx-auto w-full px-8 pt-8 pb-24 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Immersive Header */}
      <div className="flex flex-col gap-2 mb-10 relative group">
        <div className={`absolute -left-10 top-0 w-40 h-40 rounded-full blur-[60px] opacity-0 group-hover:opacity-100 transition-opacity duration-1000 pointer-events-none ${isDark ? 'bg-teal-500/20' : 'bg-teal-500/10'}`} />
        <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-4 relative z-10">
          <div className={`p-2.5 rounded-[1.25rem] ${isDark ? 'bg-teal-500/20 text-teal-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]' : 'bg-teal-500/10 text-teal-600'}`}>
            <Command className="w-7 h-7" />
          </div>
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-teal-400 to-emerald-600 pb-1">
            {t('settings.general')}
          </span>
        </h1>
        <p className={`text-sm ml-[4.5rem] ${isDark ? 'text-white/50' : 'text-black/50'}`}>
          {t('settings.systemHeaderDesc')}
        </p>
      </div>

      {/* Bento Grid */}
      <div className="grid grid-cols-1 gap-4">
        
        {/* Global App Behavior */}
        <div className={`rounded-3xl p-6 border flex flex-col md:flex-row gap-8 ${isDark ? 'bg-white/[0.02] border-white/10' : 'bg-white border-black/5'}`}>
          <div className="flex-1 flex flex-col justify-between">
            <div>
              <h3 className={`text-[11px] font-bold uppercase tracking-[0.2em] mb-4 ml-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{t('system.globalHotkey')}</h3>
              <input type="text" value={appConfig.globalHotkey || 'Control+`'} onChange={(e) => updateConfig('globalHotkey', e.target.value)} className={`w-full p-3 border rounded-xl text-sm font-medium outline-none shadow-sm focus:ring-2 focus:ring-teal-500/50 transition-colors ${isDark ? 'bg-black/40 border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] text-white' : 'bg-white border-black/10 text-slate-800 hover:border-black/20'}`} />
              <div className="text-[10px] opacity-40 mt-2 ml-1">{t('system.globalHotkeyDesc')}</div>
            </div>
          </div>

          <div className={`hidden md:block w-px ${isDark ? 'bg-white/5' : 'bg-black/5'}`} />

          <div className="flex-1 flex flex-col justify-center">
            <label className="flex items-center justify-between cursor-pointer group">
              <div className="flex flex-col ml-1">
                <span className={`text-[11px] font-bold uppercase tracking-[0.2em] ${!isDark ? 'opacity-40' : 'opacity-70 group-hover:opacity-100 transition-opacity'}`}>{t('system.confirmQuit')}</span>
                <span className="text-[10px] opacity-40 mt-1">{t('system.confirmQuitDesc')}</span>
              </div>
              <button 
                onClick={() => updateConfig('confirmQuit', !appConfig.confirmQuit)} 
                className={`relative w-12 h-6 rounded-xl border border-black/20 dark:border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-colors flex-shrink-0 ${appConfig.confirmQuit ? 'bg-teal-500' : 'bg-black/20 dark:bg-white/10'}`}
              >
                <div className={`absolute top-1 left-1 bg-white shadow-sm w-4 h-4 rounded-xl transition-transform ${appConfig.confirmQuit ? 'translate-x-6' : 'translate-x-0'}`} />
              </button>
            </label>
          </div>
        </div>

        {/* Plugin Security Strategy (Danger Zone) */}
        <div className={`rounded-3xl p-6 border flex flex-col gap-6 relative overflow-hidden ${isDark ? 'bg-red-500/[0.02] border-red-500/20' : 'bg-red-50 border-red-500/20'}`}>
          {/* Warning Background Blob */}
          <div className="absolute -right-20 -bottom-20 w-64 h-64 bg-red-500/10 rounded-full blur-[80px] pointer-events-none" />
          
          <div className="flex items-center gap-3 relative z-10">
            <div className="w-10 h-10 rounded-xl bg-red-500/10 text-red-500 flex items-center justify-center">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-red-500">{t('settings.pluginSecurityMode')}</h3>
              <p className={`text-[10px] uppercase tracking-wider mt-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{t('settings.pluginSecurityStrategy')}</p>
            </div>
          </div>

          <div className="flex flex-col md:flex-row gap-6 relative z-10">
            <div className="flex-[2]">
              <p className={`text-xs leading-relaxed ${isDark ? 'text-white/60' : 'text-black/60'}`}>
                {t('settings.pluginSecurityDesc')}
              </p>
            </div>
            <div className="flex-1">
              <select 
                value={appConfig.pluginSecurityMode || 'normal'}
                onChange={async (e) => {
                  const newMode = e.target.value as 'safe' | 'strict' | 'normal' | 'developer';
                  let finalToken = undefined;
                  if (newMode === 'developer') {
                    if (!window.confirm(
                      "🚨 警告: 开发者模式 (Developer Mode) 🚨\n\n" +
                      "启用此模式将完全关闭 Node.js VM 沙箱隔离！\n" +
                      "插件将获得原生 require() 能力，可直接访问文件系统与系统进程。\n" +
                      "仅在调试您自己编写的信任代码时开启此模式。\n\n" +
                      "您确定要继续吗？"
                    )) return;
                  }

                  if (newMode === 'safe' || newMode === 'developer') {
                    // Intercept with Biometric / Master Password ONLY if encryption is enabled
                    if (!encryptionDisabled) {
                      if (window.electronAPI?.promptBiometricUnlock) {
                        const res = await window.electronAPI.promptBiometricUnlock();
                        if (!res.success) {
                          if (res.reason === 'unsupported' || res.reason === 'no_key') {
                            // Fallback to Master Password prompt
                            const inputPwd = window.prompt("Biometric unlock unavailable. Please enter your Master Password to verify your identity:");
                            if (!inputPwd) return; // Cancelled
                            finalToken = inputPwd;
                          } else {
                            return; // Cancelled or failed, do not update state
                          }
                        }
                      } else {
                        if (!window.confirm(`WARNING: Are you sure you want to change to ${newMode} mode?`)) return;
                      }
                    } else {
                      if (newMode === 'safe' && !window.confirm(`WARNING: You are switching to safe mode without a Master Password set. Are you sure?`)) return;
                    }
                  }
                  
                  if (window.electronAPI?.updateBackendConfig) {
                    window.electronAPI.updateBackendConfig({ pluginSecurityMode: newMode }, finalToken);
                  }
                  updateConfig('pluginSecurityMode', newMode);
                  
                  if (newMode === 'safe') {
                    setTimeout(() => window.alert(t('settings.pluginSecurityRestartReq')), 100);
                  } else {
                    // Hot Swap
                    if (window.electronAPI?.reloadPlugins) {
                      await window.electronAPI.reloadPlugins();
                      window.alert("Plugins reloaded successfully under the new security mode.");
                    }
                  }
                }}
                className={`w-full p-3 border border-red-500/30 rounded-xl text-sm font-bold uppercase tracking-wider outline-none transition-colors cursor-pointer ${isDark ? 'bg-black/50 text-red-400 focus:ring-2 focus:ring-red-500/50' : 'bg-white text-red-600 focus:ring-2 focus:ring-red-500/50'}`}
              >
                <option value="safe">{t('settings.pluginSecuritySafe')}</option>
                <option value="strict">{t('settings.pluginSecurityStrict')}</option>
                <option value="normal">{t('settings.pluginSecurityNormal')}</option>
                <option value="developer">{t('settings.pluginSecurityDeveloper')}</option>
              </select>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
