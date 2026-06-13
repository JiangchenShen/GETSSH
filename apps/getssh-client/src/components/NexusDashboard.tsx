import React, { useState, useEffect } from 'react';

import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/appStore';
import { motion } from 'framer-motion';
import { MoovierTile } from '@moovier/core';
import { Rocket, ShieldCheck, Globe, Sparkles, Blocks, Settings } from 'lucide-react';

export const NexusDashboard: React.FC<{ openSettingsTab?: (tab?: string) => void }> = ({ openSettingsTab }) => {
  
  const isDark = useAppStore(state => state.isDark);
  const appConfig = useAppStore(state => state.appConfig);
  
  const setIsCommandCenterOpen = useAppStore(state => state.setIsCommandCenterOpen);
  const setIsSecureCenterOpen = useAppStore(state => state.setIsSecureCenterOpen);
  const setIsWorkspaceCenterOpen = useAppStore(state => state.setIsWorkspaceCenterOpen);
  const setIsAiCenterOpen = useAppStore(state => state.setIsAiCenterOpen);
  const setIsAiSettingsOpen = useAppStore(state => state.setIsAiSettingsOpen);
  const setIsPluginCenterOpen = useAppStore(state => state.setIsPluginCenterOpen as any) || (() => {});

  const { t } = useTranslation();
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

  // CSS variables for SPRING_FLUID hover effect
  const tileHoverClass = "group relative overflow-hidden transition-all duration-500 hover:-translate-y-2 cursor-pointer rounded-none shadow-[0_4px_10px_rgba(0,0,0,0.5),0_10px_20px_rgba(0,0,0,0.4),0_20px_40px_rgba(0,0,0,0.3)]";
  const glowOverlayClass = "absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-gradient-to-br pointer-events-none";

  return (
    <div className="w-full h-full max-w-6xl mx-auto flex flex-col justify-center gap-8 p-8 animate-in fade-in zoom-in-95 duration-700">
      
      {/* Top Greeting */}
      <div className="flex flex-col items-center text-center mb-4">
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`text-2xl font-bold flex items-center gap-3 mb-2 ${isDark ? 'text-white' : 'text-slate-900'}`}
        >
          <Sparkles className="w-6 h-6 text-primary" />
          {t(`welcome.greeting.${getGreetingKey()}`)}
        </motion.div>
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className={`text-6xl md:text-8xl font-black tracking-tighter ${isDark ? 'text-transparent bg-clip-text bg-gradient-to-b from-white to-white/40' : 'text-transparent bg-clip-text bg-gradient-to-b from-slate-900 to-slate-400'}`}
        >
          {timeString}
        </motion.div>
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className={`mt-4 text-xl font-medium tracking-widest uppercase ${isDark ? 'text-white/40' : 'text-slate-500'}`}
        >
          {dateString}
        </motion.div>
      </div>

      {/* The Four Pillars Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
        
        {/* Pillar 1: COMMAND CENTER */}
        <MoovierTile 
          exemptFromFocus 
          dragLevel="fixed" 
          onClick={() => setIsCommandCenterOpen(true)}
          className={`${tileHoverClass} p-8 min-h-[220px] flex flex-col justify-between border ${isDark ? 'border-black shadow-[inset_1px_1px_0px_rgba(255,255,255,0.1)]' : 'border-black/5'}`}
        >
          <div className={`${glowOverlayClass} from-blue-500/10 to-transparent`} />
          <div className="relative z-10 flex items-center justify-between">
            <div className={`w-14 h-14 rounded-none flex items-center justify-center ${isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-600'}`}>
              <Rocket className="w-7 h-7" />
            </div>
            <div className="text-right">
              <kbd className={`px-2 py-1 rounded-none font-mono text-xs opacity-50 ${isDark ? 'bg-white/10' : 'bg-black/5'}`}>⌘K</kbd>
            </div>
          </div>
          <div className="relative z-10 mt-auto pt-6">
            <h3 className={`text-2xl font-black tracking-tight mb-1 ${isDark ? 'text-white' : 'text-slate-900'}`}>COMMAND CENTER</h3>
            <p className={`text-sm font-medium ${isDark ? 'text-blue-200/50' : 'text-blue-800/60'}`}>Runbooks & 全局终端接入</p>
          </div>
        </MoovierTile>

        {/* Pillar 2: SECURE CENTER */}
        <MoovierTile 
          exemptFromFocus 
          dragLevel="fixed" 
          onClick={() => setIsSecureCenterOpen(true)}
          className={`${tileHoverClass} p-8 min-h-[220px] flex flex-col justify-between border ${isDark ? 'border-black shadow-[inset_1px_1px_0px_rgba(255,255,255,0.1)]' : 'border-black/5'}`}
        >
          <div className={`${glowOverlayClass} from-emerald-500/10 to-transparent`} />
          <div className="relative z-10 flex items-center justify-between">
            <div className={`w-14 h-14 rounded-none flex items-center justify-center ${isDark ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-600'}`}>
              <ShieldCheck className="w-7 h-7" />
            </div>
            <div className="flex gap-1.5">
              <div className="w-2 h-2 rounded-none bg-emerald-500 animate-pulse" />
              <div className="w-2 h-2 rounded-none bg-emerald-500/30" />
            </div>
          </div>
          <div className="relative z-10 mt-auto pt-6">
            <h3 className={`text-2xl font-black tracking-tight mb-1 ${isDark ? 'text-white' : 'text-slate-900'}`}>SECURE CENTER</h3>
            <p className={`text-sm font-medium ${isDark ? 'text-emerald-200/50' : 'text-emerald-800/60'}`}>Watchdog & RASP 安全态势</p>
          </div>
        </MoovierTile>

        {/* Pillar 3: WORKSPACE CENTER */}
        <MoovierTile 
          exemptFromFocus 
          dragLevel="fixed" 
          onClick={() => setIsWorkspaceCenterOpen(true)}
          className={`${tileHoverClass} p-8 min-h-[220px] flex flex-col justify-between border ${isDark ? 'border-black shadow-[inset_1px_1px_0px_rgba(255,255,255,0.1)]' : 'border-black/5'}`}
        >
          <div className={`${glowOverlayClass} from-purple-500/10 to-transparent`} />
          <div className="relative z-10">
            <div className={`w-14 h-14 rounded-none flex items-center justify-center ${isDark ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-600'}`}>
              <Globe className="w-7 h-7" />
            </div>
          </div>
          <div className="relative z-10 mt-auto pt-6">
            <h3 className={`text-2xl font-black tracking-tight mb-1 ${isDark ? 'text-white' : 'text-slate-900'}`}>WORKSPACE CENTER</h3>
            <p className={`text-sm font-medium ${isDark ? 'text-purple-200/50' : 'text-purple-800/60'}`}>工作区与资产隔离</p>
          </div>
        </MoovierTile>

        {/* Pillar 4: AI CENTER */}
        <MoovierTile 
          exemptFromFocus 
          dragLevel="fixed" 
          onClick={() => setIsAiSettingsOpen(true)}
          className={`${tileHoverClass} p-8 min-h-[220px] flex flex-col justify-between border ${isDark ? 'border-black shadow-[inset_1px_1px_0px_rgba(255,255,255,0.1)]' : 'border-black/5'} ${appConfig.aiEnabled === false ? 'grayscale opacity-50 cursor-not-allowed hover:-translate-y-0' : ''}`}
        >
          <div className={`${glowOverlayClass} from-amber-500/10 to-transparent`} />
          <div className="relative z-10">
            <div className={`w-14 h-14 rounded-none flex items-center justify-center ${isDark ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-100 text-amber-600'}`}>
              <Sparkles className="w-7 h-7" />
            </div>
          </div>
          <div className="relative z-10 mt-auto pt-6">
            <h3 className={`text-2xl font-black tracking-tight mb-1 ${isDark ? 'text-white' : 'text-slate-900'}`}>AI CENTER</h3>
            <p className={`text-sm font-medium ${isDark ? 'text-amber-200/50' : 'text-amber-800/60'}`}>全域智能副官与模型连通</p>
          </div>
        </MoovierTile>


        {/* Pillar 5: PLUGIN CENTER */}
        <MoovierTile 
          exemptFromFocus 
          dragLevel="fixed" 
          onClick={() => setIsPluginCenterOpen(true)}
          className={`${tileHoverClass} p-8 min-h-[220px] flex flex-col justify-between border ${isDark ? 'border-black shadow-[inset_1px_1px_0px_rgba(255,255,255,0.1)]' : 'border-black/5'}`}
        >
          <div className={`${glowOverlayClass} from-rose-500/10 to-transparent`} />
          <div className="relative z-10">
            <div className={`w-14 h-14 rounded-none flex items-center justify-center ${isDark ? 'bg-rose-500/20 text-rose-400' : 'bg-rose-100 text-rose-600'}`}>
              <Blocks className="w-7 h-7" />
            </div>
          </div>
          <div className="relative z-10 mt-auto pt-6">
            <h3 className={`text-2xl font-black tracking-tight mb-1 ${isDark ? 'text-white' : 'text-slate-900'}`}>PLUGIN CENTER</h3>
            <p className={`text-sm font-medium ${isDark ? 'text-rose-200/50' : 'text-rose-800/60'}`}>第三方插件与沙箱管控</p>
          </div>
        </MoovierTile>

        {/* Pillar 6: SETTINGS */}
        <MoovierTile 
          exemptFromFocus 
          dragLevel="fixed" 
          onClick={() => openSettingsTab && openSettingsTab('Appearance')}
          className={`${tileHoverClass} p-8 min-h-[220px] flex flex-col justify-between border ${isDark ? 'border-black shadow-[inset_1px_1px_0px_rgba(255,255,255,0.1)]' : 'border-black/5'}`}
        >
          <div className={`${glowOverlayClass} from-slate-500/10 to-transparent`} />
          <div className="relative z-10">
            <div className={`w-14 h-14 rounded-none flex items-center justify-center ${isDark ? 'bg-slate-500/20 text-slate-400' : 'bg-slate-100 text-slate-600'}`}>
              <Settings className="w-7 h-7" />
            </div>
          </div>
          <div className="relative z-10 mt-auto pt-6">
            <h3 className={`text-2xl font-black tracking-tight mb-1 ${isDark ? 'text-white' : 'text-slate-900'}`}>SETTINGS</h3>
            <p className={`text-sm font-medium ${isDark ? 'text-slate-300/50' : 'text-slate-600/60'}`}>外观、终端与偏好配置</p>
          </div>
        </MoovierTile>
      </div>
    </div>
  );
};
