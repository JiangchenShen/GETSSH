import React from 'react';
import { useAppStore } from '../store/appStore';

import { PluginSettings } from './PluginSettings';

export const PluginCenterModal: React.FC = () => {
  const isDark = useAppStore(state => state.isDark);
  return (
    <div className={`relative w-full h-full flex flex-col overflow-hidden border shadow-2xl rounded-xl backdrop-blur-3xl ${
      isDark 
        ? 'border-white/10 bg-[#0A0A0A]/95 text-white' 
        : 'border-black/10 bg-[#F5F5F5]/95 text-slate-900'
    }`}>
        {/* Ambient Gradient Background */}
        <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
          <div className={`absolute -top-[20%] -right-[10%] w-[60%] h-[60%] rounded-full mix-blend-screen filter blur-[120px] opacity-30 ${isDark ? 'bg-rose-500' : 'bg-rose-300'}`} />
          <div className={`absolute -bottom-[20%] -left-[10%] w-[60%] h-[60%] rounded-full mix-blend-screen filter blur-[120px] opacity-30 ${isDark ? 'bg-purple-600' : 'bg-purple-400'}`} />
        </div>

        {/* Content Area */}
        <div className={`relative z-10 flex-1 flex overflow-hidden ${isDark ? 'bg-black/20' : 'bg-slate-100/20'}`}>
          <div className="flex-1 p-8 md:p-12 overflow-y-auto no-scrollbar">
            <div className="w-full h-full">
               <PluginSettings isDark={isDark} />
            </div>
        </div>
      </div>
    </div>
  );
};
