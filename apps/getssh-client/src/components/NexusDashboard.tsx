import React, { useState, useEffect, useMemo } from 'react';

import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/appStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useCryptoStore } from '../store/cryptoStore';
import { useSessionStore } from '../store/sessionStore';
import { motion } from 'framer-motion';
import { MoovierTile } from '@moovier/core';
import { Rocket, ShieldCheck, Globe, Sparkles, Blocks, Settings } from 'lucide-react';
import { CryptoModal } from './CryptoModal';
import { promptWebAuthn } from '../utils/webauthn';

export const NexusDashboard: React.FC = () => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const appConfig = useAppStore(state => state.appConfig);
  const setIsCommandCenterOpen = useAppStore(state => state.setIsCommandCenterOpen);
  
  // Crypto logic for Zero-Trust Local Unlock
  const workspaces = useWorkspaceStore(state => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const switchWorkspace = useWorkspaceStore(state => state.switchWorkspace);
  
  const cryptoMode = useCryptoStore(state => state.cryptoMode);
  const setCryptoMode = useCryptoStore(state => state.setCryptoMode);
  const encryptionDisabled = useCryptoStore(state => state.encryptionDisabled);
  const setEncryptionDisabled = useCryptoStore(state => state.setEncryptionDisabled);
  const masterPassword = useCryptoStore(state => state.masterPassword);
  const setMasterPassword = useCryptoStore(state => state.setMasterPassword);
  
  const sessions = useSessionStore(state => state.sessions);
  const setSessions = useSessionStore(state => state.setSessions);

  const handleUnlock = async (pwd: string) => {
    const profiles = await window.electronAPI.unlockProfiles(pwd);
    if (!profiles) return false;
    setMasterPassword(pwd);
    setSessions(profiles);
    setCryptoMode('idle');
    useWorkspaceStore.setState({ isVaultLocked: false, isUnlockModalOpen: false });
    return true;
  };

  const handleSetup = async (pwd: string) => {
    setEncryptionDisabled(false);
    setMasterPassword(pwd);
    const updatedSessions = sessions.map(s => ({ ...s, password: s.password || '' }));
    await window.electronAPI.saveProfiles({ masterPassword: pwd, payload: updatedSessions });
    setCryptoMode('idle');
  };

  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timeString = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateString = time.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  const getGreetingKey = () => {
    const hour = time.getHours();
    if (hour < 5) return 'midnight';
    if (hour < 9) return 'morning';
    if (hour < 12) return 'forenoon';
    if (hour < 14) return 'noon';
    if (hour < 18) return 'afternoon';
    if (hour < 22) return 'evening';
    return 'lateNight';
  };

  const greetingIndex = useMemo(() => Math.floor(Math.random() * 10), []);

  // CSS variables for SPRING_FLUID hover effect
  const tileHoverClass = "group relative overflow-hidden cursor-pointer rounded-xl shadow-[0_4px_10px_rgba(0,0,0,0.5),0_10px_20px_rgba(0,0,0,0.4),0_20px_40px_rgba(0,0,0,0.3)]";
  const glowOverlayClass = "absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br pointer-events-none";

  const isVaultLocked = useWorkspaceStore(state => state.isVaultLocked);

  if (isVaultLocked) {
    const _activeWs = workspaces.find(w => w.id === activeWorkspaceId);
    const _wsName = _activeWs?.name || activeWorkspaceId;
    const _wsColor = _activeWs?.themeColor;
    return (
      <div className="absolute inset-0 w-full h-full z-[100] rounded-[32px] overflow-hidden">
        <CryptoModal 
          mode="locked" 
          isDark={isDark} 
          encryptionDisabled={encryptionDisabled}
          onUnlock={handleUnlock} 
          onSetup={async (pwd) => { await handleSetup(pwd); }}
          onSkip={cryptoMode === 'setup' ? () => setCryptoMode('idle') : undefined}
          onCancel={cryptoMode === 'setup' && sessions.length === 0 && !masterPassword ? undefined : () => {
              if (cryptoMode === 'setup') {
                 setEncryptionDisabled(true);
                 window.electronAPI.saveProfiles({ masterPassword: '', payload: sessions });
              }
              setCryptoMode('idle');
          }}
          onRetryBiometric={workspaces.find(w => w.id === activeWorkspaceId)?.biometricEnabled ? async () => {
             const webAuthnSuccess = await promptWebAuthn();
             if (!webAuthnSuccess) return;

             const bioRes = await window.electronAPI.promptBiometricUnlock();
             if (bioRes.success && bioRes.masterPassword) {
               try {
                  const decrypted = await window.electronAPI.unlockProfiles(bioRes.masterPassword);
                  setMasterPassword(bioRes.masterPassword);
                  setSessions(decrypted);
                  setCryptoMode('idle');
                  useWorkspaceStore.setState({ isVaultLocked: false, isUnlockModalOpen: false });
               } catch (e) {
                  console.warn('Biometric unlock failed:', e);
               }
             }
          } : undefined}
          workspaceName={isVaultLocked ? _wsName : undefined}
          themeColor={isVaultLocked ? _wsColor : undefined}
          onSwitchWorkspace={isVaultLocked && activeWorkspaceId !== 'default' ? async () => {
            await switchWorkspace('default');
          } : undefined}
        />
      </div>
    );
  }

  return (
    <div className="drag-region w-full h-full max-w-6xl mx-auto flex flex-col justify-center gap-8 p-8 animate-in fade-in zoom-in-95 duration-700">
      
      {/* Top Greeting */}
      <div className="no-drag-region flex flex-col items-center text-center mb-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className={`text-6xl md:text-7xl font-black tracking-tighter mb-4 ${isDark ? 'text-transparent bg-clip-text bg-gradient-to-b from-white to-white/40' : 'text-transparent bg-clip-text bg-gradient-to-b from-slate-800 to-slate-400'}`}
        >
          {timeString}
        </motion.div>
        
        <div className="flex flex-col md:flex-row items-center gap-2 md:gap-4">
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`text-xl font-bold flex items-center gap-2 ${isDark ? 'text-white' : 'text-slate-900'}`}
          >
            <Sparkles className="w-5 h-5 text-primary" />
            {(() => {
              const greetingObj = t(`welcome.greeting.${getGreetingKey()}`, { returnObjects: true });
              return Array.isArray(greetingObj) ? greetingObj[greetingIndex % greetingObj.length] : greetingObj;
            })()}
          </motion.div>
          
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className={`text-sm md:text-base font-medium tracking-widest uppercase ${isDark ? 'text-white/40' : 'text-slate-500'}`}
          >
            <span className="hidden md:inline mr-4 opacity-50">|</span>
            {dateString}
          </motion.div>
        </div>
      </div>

      {/* The Grid */}
      <div className="no-drag-region grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 w-full max-w-4xl mx-auto">
        
        {/* COMMAND CENTER */}
        <MoovierTile 
          tileId="dashboard-command"
          dragLevel="fixed" 
          whileHover={{ y: -4 }}
          onClick={() => setIsCommandCenterOpen(true)}
          className={`${tileHoverClass} p-5 min-h-[140px] flex flex-col justify-between ${!isDark && '!bg-white shadow-[0_2px_10px_rgba(0,0,0,0.02)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.04)]'}`}
          style={{ '--moovier-bg': isDark ? 'rgba(255, 255, 255, 0.03)' : undefined } as React.CSSProperties}
        >
          <div className={`${glowOverlayClass} from-blue-500/10 to-transparent`} />
          <div className="relative z-10 flex items-center justify-between">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-600'}`}>
              <Rocket className="w-5 h-5" />
            </div>
            <div className="text-right">
              <kbd className={`px-1.5 py-0.5 rounded-lg font-mono text-[10px] opacity-50 ${isDark ? 'bg-white/10' : 'bg-black/5'}`}>⌘K</kbd>
            </div>
          </div>
          <div className="relative z-10 mt-auto pt-3">
            <h3 className={`text-lg font-black tracking-tight mb-0.5 ${isDark ? 'text-white' : 'text-slate-900'}`}>COMMAND CENTER</h3>
            <p className={`text-[11px] font-medium ${isDark ? 'text-blue-200/50' : 'text-blue-800/60'}`}>{t('welcome.dashboard.commandCenterDesc')}</p>
          </div>
        </MoovierTile>

        {/* Pillar 2: SECURE CENTER */}
        <MoovierTile 
          tileId="dashboard-secure"
          dragLevel="fixed" 
          whileHover={{ y: -4 }}
          onClick={() => window.dispatchEvent(new CustomEvent('app:open-center', { detail: { type: 'secure', title: 'SECURE CENTER' } }))}
          className={`${tileHoverClass} p-5 min-h-[140px] flex flex-col justify-between ${!isDark && '!bg-white shadow-[0_2px_10px_rgba(0,0,0,0.02)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.04)]'}`}
          style={{ '--moovier-bg': isDark ? 'rgba(255, 255, 255, 0.03)' : undefined } as React.CSSProperties}
        >
          <div className={`${glowOverlayClass} from-emerald-500/10 to-transparent`} />
          <div className="relative z-10 flex items-center justify-between">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isDark ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-600'}`}>
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="flex gap-1.5">
              <div className="w-1.5 h-1.5 rounded-xl bg-emerald-500 animate-pulse" />
              <div className="w-1.5 h-1.5 rounded-xl bg-emerald-500/30" />
            </div>
          </div>
          <div className="relative z-10 mt-auto pt-3">
            <h3 className={`text-lg font-black tracking-tight mb-0.5 ${isDark ? 'text-white' : 'text-slate-900'}`}>SECURE CENTER</h3>
            <p className={`text-[11px] font-medium ${isDark ? 'text-emerald-200/50' : 'text-emerald-800/60'}`}>{t('welcome.dashboard.secureCenterDesc')}</p>
          </div>
        </MoovierTile>

        {/* Pillar 3: WORKSPACE CENTER */}
        <MoovierTile 
          tileId="dashboard-workspace"
          dragLevel="fixed" 
          whileHover={{ y: -4 }}
          onClick={() => window.dispatchEvent(new CustomEvent('app:open-center', { detail: { type: 'workspace', title: 'WORKSPACE CENTER' } }))}
          className={`${tileHoverClass} p-5 min-h-[140px] flex flex-col justify-between ${!isDark && '!bg-white shadow-[0_2px_10px_rgba(0,0,0,0.02)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.04)]'}`}
          style={{ '--moovier-bg': isDark ? 'rgba(255, 255, 255, 0.03)' : undefined } as React.CSSProperties}
        >
          <div className={`${glowOverlayClass} from-purple-500/10 to-transparent`} />
          <div className="relative z-10">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isDark ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-600'}`}>
              <Globe className="w-5 h-5" />
            </div>
          </div>
          <div className="relative z-10 mt-auto pt-3">
            <h3 className={`text-lg font-black tracking-tight mb-0.5 ${isDark ? 'text-white' : 'text-slate-900'}`}>WORKSPACE CENTER</h3>
            <p className={`text-[11px] font-medium ${isDark ? 'text-purple-200/50' : 'text-purple-800/60'}`}>{t('welcome.dashboard.workspaceCenterDesc')}</p>
          </div>
        </MoovierTile>

        {/* Pillar 4: AI CENTER */}
        <MoovierTile 
          tileId="dashboard-ai"
          dragLevel="fixed" 
          whileHover={{ y: -4 }}
          onClick={() => window.dispatchEvent(new CustomEvent('app:open-center', { detail: { type: 'ai', title: 'AI CENTER' } }))}
          className={`${tileHoverClass} p-5 min-h-[140px] flex flex-col justify-between ${!isDark && '!bg-white shadow-[0_2px_10px_rgba(0,0,0,0.02)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.04)]'} ${appConfig.aiEnabled === false ? 'grayscale opacity-50 cursor-not-allowed hover:-translate-y-0' : ''}`}
          style={{ '--moovier-bg': isDark ? 'rgba(255, 255, 255, 0.03)' : undefined } as React.CSSProperties}
        >
          <div className={`${glowOverlayClass} from-amber-500/10 to-transparent`} />
          <div className="relative z-10">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isDark ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-100 text-amber-600'}`}>
              <Sparkles className="w-5 h-5" />
            </div>
          </div>
          <div className="relative z-10 mt-auto pt-3">
            <h3 className={`text-lg font-black tracking-tight mb-0.5 ${isDark ? 'text-white' : 'text-slate-900'}`}>AI CENTER</h3>
            <p className={`text-[11px] font-medium ${isDark ? 'text-amber-200/50' : 'text-amber-800/60'}`}>{t('welcome.dashboard.aiCenterDesc')}</p>
          </div>
        </MoovierTile>


        {/* Pillar 5: PLUGIN CENTER */}
        <MoovierTile 
          tileId="dashboard-plugin"
          dragLevel="fixed" 
          whileHover={{ y: -4 }}
          onClick={() => window.dispatchEvent(new CustomEvent('app:open-center', { detail: { type: 'plugin', title: 'PLUGIN CENTER' } }))}
          className={`${tileHoverClass} p-5 min-h-[140px] flex flex-col justify-between ${!isDark && '!bg-white shadow-[0_2px_10px_rgba(0,0,0,0.02)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.04)]'}`}
          style={{ '--moovier-bg': isDark ? 'rgba(255, 255, 255, 0.03)' : undefined } as React.CSSProperties}
        >
          <div className={`${glowOverlayClass} from-rose-500/10 to-transparent`} />
          <div className="relative z-10">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isDark ? 'bg-rose-500/20 text-rose-400' : 'bg-rose-100 text-rose-600'}`}>
              <Blocks className="w-5 h-5" />
            </div>
          </div>
          <div className="relative z-10 mt-auto pt-3">
            <h3 className={`text-lg font-black tracking-tight mb-0.5 ${isDark ? 'text-white' : 'text-slate-900'}`}>PLUGIN CENTER</h3>
            <p className={`text-[11px] font-medium ${isDark ? 'text-rose-200/50' : 'text-rose-800/60'}`}>{t('welcome.dashboard.pluginCenterDesc')}</p>
          </div>
        </MoovierTile>

        {/* Pillar 6: SETTINGS */}
        <MoovierTile 
          tileId="dashboard-settings"
          dragLevel="fixed" 
          whileHover={{ y: -4 }}
          onClick={() => window.dispatchEvent(new CustomEvent('app:open-center', { detail: { type: 'settings', title: 'Settings' } }))}
          className={`${tileHoverClass} p-5 min-h-[140px] flex flex-col justify-between ${!isDark && '!bg-white shadow-[0_2px_10px_rgba(0,0,0,0.02)] hover:shadow-[0_8px_30px_rgba(0,0,0,0.04)]'}`}
          style={{ '--moovier-bg': isDark ? 'rgba(255, 255, 255, 0.03)' : undefined } as React.CSSProperties}
        >
          <div className={`${glowOverlayClass} from-slate-500/10 to-transparent`} />
          <div className="relative z-10">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isDark ? 'bg-slate-500/20 text-slate-400' : 'bg-slate-100 text-slate-600'}`}>
              <Settings className="w-5 h-5" />
            </div>
          </div>
          <div className="relative z-10 mt-auto pt-3">
            <h3 className={`text-lg font-black tracking-tight mb-0.5 ${isDark ? 'text-white' : 'text-slate-900'}`}>SETTINGS</h3>
            <p className={`text-[11px] font-medium ${isDark ? 'text-slate-300/50' : 'text-slate-600/60'}`}>{t('welcome.dashboard.settingsDesc')}</p>
          </div>
        </MoovierTile>
      </div>
    </div>
  );
};
