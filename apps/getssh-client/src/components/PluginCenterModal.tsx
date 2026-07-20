import React, { useState } from 'react';
import { useAppStore } from '../store/appStore';
import { Blocks, ShoppingBag, TerminalSquare, Code, LayoutTemplate } from 'lucide-react';
import { PluginSettings } from './PluginSettings';
import { useTranslation } from 'react-i18next';

export const PluginCenterModal: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'installed' | 'marketplace' | 'logs' | 'local'>('installed');
  const isDark = useAppStore(state => state.isDark);
  return (
    <div className={`relative w-full h-full flex flex-col overflow-hidden border shadow-2xl rounded-xl ${
      isDark 
        ? 'border-white/10 bg-transparent text-white' 
        : 'border-black/10 bg-transparent text-slate-900'
    }`}>
        {/* Ambient Gradient Background */}
        <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
          <div className={`absolute -top-[20%] -right-[10%] w-[60%] h-[60%] rounded-full mix-blend-screen filter blur-[120px] opacity-30 ${isDark ? 'bg-rose-500' : 'bg-rose-300'}`} />
          <div className={`absolute -bottom-[20%] -left-[10%] w-[60%] h-[60%] rounded-full mix-blend-screen filter blur-[120px] opacity-30 ${isDark ? 'bg-purple-600' : 'bg-purple-400'}`} />
        </div>

        {/* Content Area - Split Pane */}
        <div className={`relative z-10 flex-1 flex overflow-hidden bg-transparent`}>
          
          {/* Left Sidebar */}
          <div className={`w-80 p-8 flex flex-col gap-6 border-r ${isDark ? 'border-white/5 bg-black/20' : 'border-black/5 bg-white/30'} backdrop-blur-md`}>
            {/* Header Widget */}
            <div className={`w-full p-8 flex flex-col items-center justify-center gap-5 border rounded-[32px] relative overflow-hidden shadow-lg ${isDark ? 'bg-rose-500/10 border-rose-500/30' : 'bg-rose-500/5 border-rose-500/20'}`}>
              <div className="absolute inset-0 bg-gradient-to-b from-rose-500/10 to-transparent opacity-50 pointer-events-none" />
              <Blocks className="w-20 h-20 text-rose-500 drop-shadow-[0_0_30px_rgba(244,63,94,0.6)] animate-pulse relative z-10" />
              <div className="text-center relative z-10">
                <h3 className={`text-[17px] font-black tracking-tight mb-1 ${isDark ? 'text-white' : 'text-slate-800'}`}>{t('pluginCenter.title', 'Plugin Center')}</h3>
                <p className={`text-[10px] font-bold uppercase tracking-widest ${isDark ? 'text-white/50' : 'text-slate-500'}`}>{t('pluginCenter.subtitle', 'Extend capabilities')}</p>
              </div>
            </div>

            {/* Navigation Menu */}
            <nav className="flex flex-col gap-1 overflow-y-auto pb-4">
              {(() => {
                const activeItemClass = isDark ? 'bg-rose-500/10 text-rose-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_0_10px_rgba(244,63,94,0.1)]' : 'bg-rose-500/10 text-rose-700 shadow-sm';
                const inactiveItemClass = isDark ? 'text-white/50 hover:text-white hover:bg-white/5' : 'text-slate-500 hover:text-slate-900 hover:bg-black/5';
                const baseItemClass = 'flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-all text-left font-bold border border-transparent';
                
                return (
                  <>
                    <div className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1 mt-4 px-4">{t('pluginCenter.sidebar.dashboard', 'Dashboard')}</div>
                    <button onClick={() => setActiveTab('installed')} className={`${baseItemClass} ${activeTab === 'installed' ? activeItemClass : inactiveItemClass}`}><Blocks className="w-4 h-4"/>{t('pluginCenter.sidebar.installed', 'Installed Plugins')}</button>
                    <button onClick={() => setActiveTab('marketplace')} className={`${baseItemClass} ${activeTab === 'marketplace' ? activeItemClass : inactiveItemClass}`}><ShoppingBag className="w-4 h-4"/>{t('pluginCenter.sidebar.marketplace', 'Marketplace')}</button>
                    
                    <div className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1 mt-4 px-4">{t('pluginCenter.sidebar.developer', 'Developer')}</div>
                    <button onClick={() => setActiveTab('logs')} className={`${baseItemClass} ${activeTab === 'logs' ? activeItemClass : inactiveItemClass}`}><TerminalSquare className="w-4 h-4"/>{t('pluginCenter.sidebar.debugLogs', 'Debug Logs')}</button>
                    <button onClick={() => setActiveTab('local')} className={`${baseItemClass} ${activeTab === 'local' ? activeItemClass : inactiveItemClass}`}><Code className="w-4 h-4"/>{t('pluginCenter.sidebar.localPlugins', 'Local Plugins')}</button>
                  </>
                );
              })()}
            </nav>
          </div>

          {/* Right Payload Area */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden relative">
            <div className="max-w-4xl mx-auto p-12 pb-24 animate-in fade-in slide-in-from-bottom-4 duration-500 h-full">
              {activeTab === 'installed' ? (
                <PluginSettings isDark={isDark} />
              ) : (
                <div className="flex flex-col items-center justify-center pt-24 text-center opacity-50 h-full">
                  <LayoutTemplate className="w-16 h-16 mb-6 text-rose-500" />
                  <h4 className="text-xl font-black uppercase tracking-widest mb-2">{t('pluginCenter.comingSoon', 'Coming Soon')}</h4>
                  <p className="text-sm font-medium">{t('pluginCenter.underDevelopment', 'This module is under development.')}</p>
                </div>
              )}
            </div>
          </div>
        </div>
    </div>
  );
};
