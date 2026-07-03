import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, X, Monitor, Terminal as TerminalIcon, Network, Command, Info, Archive, Settings as SettingsIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/appStore';

import { AppearanceTab } from './settings/tabs/AppearanceTab';
import { TerminalTab } from './settings/tabs/TerminalTab';
import { SSHTab } from './settings/tabs/SSHTab';
import { SystemTab } from './settings/tabs/SystemTab';
import { AuditTab } from './settings/tabs/AuditTab';
import { AboutTab } from './settings/tabs/AboutTab';

interface SettingsViewProps {
  settingsActiveTab: 'Appearance'|'Terminal'|'SSH'|'System'|'About'|'Audit';
  setSettingsActiveTab: (tab: 'Appearance'|'Terminal'|'SSH'|'System'|'About'|'Audit') => void;
  encryptionDisabled: boolean;
  onClose?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settingsActiveTab,
  setSettingsActiveTab,
  encryptionDisabled,
  onClose
}) => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);

  // History Stack for Navigation
  const [history, setHistory] = useState<string[]>([settingsActiveTab]);
  const [historyIndex, setHistoryIndex] = useState(0);

  React.useEffect(() => {
    if (history[historyIndex] !== settingsActiveTab) {
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(settingsActiveTab);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    }
  }, [settingsActiveTab]);

  const goBack = () => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1];
      setHistoryIndex(historyIndex - 1);
      setSettingsActiveTab(prev as any);
    }
  };

  const goForward = () => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      setHistoryIndex(historyIndex + 1);
      setSettingsActiveTab(next as any);
    }
  };

  return (
    <div className={`flex-1 flex overflow-hidden bg-transparent ${isDark ? 'text-white' : 'text-slate-800'}`}>
      
      {/* Background Ambient Glow */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div className={`absolute -top-[20%] -left-[10%] w-[60%] h-[60%] rounded-full mix-blend-screen filter blur-[150px] opacity-20 bg-cyan-600 transition-colors duration-1000`} />
        <div className={`absolute -bottom-[20%] -right-[10%] w-[60%] h-[60%] rounded-full mix-blend-screen filter blur-[150px] opacity-20 bg-teal-500 transition-colors duration-1000`} />
      </div>

      {/* Left Sidebar */}
      <div className={`w-64 p-6 flex flex-col gap-6 shrink-0 border-r ${isDark ? 'border-white/5 bg-[#0a0a0a]/50' : 'border-black/5 bg-slate-50/50'} backdrop-blur-xl relative z-20 shadow-[10px_0_30px_rgba(0,0,0,0.2)] overflow-hidden`}>
        {/* Header Widget */}
        <div className={`w-full p-6 flex flex-col items-center justify-center gap-4 border rounded-[32px] relative overflow-hidden shadow-lg ${isDark ? 'bg-cyan-500/10 border-cyan-500/20' : 'bg-cyan-50 border-cyan-100'}`}>
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/20 to-transparent opacity-50 pointer-events-none" />
          <div className="relative z-10 w-16 h-16 flex items-center justify-center rounded-3xl bg-gradient-to-br from-cyan-400 to-teal-500 shadow-xl shadow-cyan-500/30">
            <SettingsIcon className="w-8 h-8 text-white" />
          </div>
          <div className="relative z-10 text-center">
            <h2 className="text-xl font-black tracking-tight">{t('settings.title', 'Settings')}</h2>
            <p className="text-[10px] font-bold uppercase tracking-widest mt-1 opacity-60">Global Config</p>
          </div>
        </div>

        {/* Navigation Menu */}
        <nav className="flex flex-col gap-1 overflow-y-auto pb-4">
          {(() => {
            const activeItemClass = isDark ? 'bg-cyan-500/10 text-cyan-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_0_10px_rgba(6,182,212,0.1)]' : 'bg-cyan-500/10 text-cyan-700 shadow-sm';
            const inactiveItemClass = isDark ? 'text-white/50 hover:text-white hover:bg-white/5' : 'text-slate-500 hover:text-slate-900 hover:bg-black/5';
            const baseItemClass = 'flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-all text-left font-bold border border-transparent';
            
            return (
              <>
                <div className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1 mt-4 px-4">{t('settings.category.personalization', 'Personalization')}</div>
                <button onClick={() => setSettingsActiveTab('Appearance')} className={`${baseItemClass} ${settingsActiveTab === 'Appearance' ? activeItemClass : inactiveItemClass}`}><Monitor className="w-4 h-4"/>{t('settings.appearance', 'Appearance')}</button>
                <button onClick={() => setSettingsActiveTab('Terminal')} className={`${baseItemClass} ${settingsActiveTab === 'Terminal' ? activeItemClass : inactiveItemClass}`}><TerminalIcon className="w-4 h-4"/>{t('settings.terminal', 'Terminal')}</button>
                
                <div className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1 mt-4 px-4">{t('settings.category.core', 'Core & Connections')}</div>
                <button onClick={() => setSettingsActiveTab('System')} className={`${baseItemClass} ${settingsActiveTab === 'System' ? activeItemClass : inactiveItemClass}`}><Command className="w-4 h-4"/>{t('settings.general', 'System')}</button>
                <button onClick={() => setSettingsActiveTab('SSH')} className={`${baseItemClass} ${settingsActiveTab === 'SSH' ? activeItemClass : inactiveItemClass}`}><Network className="w-4 h-4"/>{t('settings.ssh', 'SSH')}</button>
                
                <div className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1 mt-4 px-4">{t('settings.category.information', 'Information')}</div>
                <button onClick={() => setSettingsActiveTab('Audit')} className={`${baseItemClass} ${settingsActiveTab === 'Audit' ? activeItemClass : inactiveItemClass}`}><Archive className="w-4 h-4"/>{t('settings.auditLogs', 'Audit Logs')}</button>
                <button onClick={() => setSettingsActiveTab('About')} className={`${baseItemClass} ${settingsActiveTab === 'About' ? activeItemClass : inactiveItemClass}`}><Info className="w-4 h-4"/>{t('settings.about', 'About')}</button>
              </>
            );
          })()}
        </nav>
      </div>

      {/* Right Payload Area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden relative z-10">
        
        {/* Navigation & Close Buttons */}
        <div className="absolute right-8 top-8 z-30 flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={goBack}
            disabled={historyIndex === 0}
            className={`p-2.5 rounded-xl transition-all border backdrop-blur-md ${isDark ? 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] disabled:opacity-20 disabled:hover:bg-white/5' : 'border-black/5 bg-black/5 text-black/70 hover:bg-black/10 hover:text-black shadow-sm disabled:opacity-20 disabled:hover:bg-black/5'}`}
            title="Go Back"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={goForward}
            disabled={historyIndex === history.length - 1}
            className={`p-2.5 rounded-xl transition-all border backdrop-blur-md ${isDark ? 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] disabled:opacity-20 disabled:hover:bg-white/5' : 'border-black/5 bg-black/5 text-black/70 hover:bg-black/10 hover:text-black shadow-sm disabled:opacity-20 disabled:hover:bg-black/5'}`}
            title="Go Forward"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          {onClose && (
            <div className={`w-[1px] h-6 mx-2 ${isDark ? 'bg-white/10' : 'bg-black/10'}`} />
          )}
          {onClose && (
            <button
              onClick={onClose}
              className={`p-2.5 rounded-xl transition-all border backdrop-blur-md ${isDark ? 'border-white/10 bg-white/5 text-white/70 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]' : 'border-black/5 bg-black/5 text-black/70 hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/30 shadow-sm'}`}
              title="Close Settings"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Content Box */}
        <div className="w-full max-w-5xl mx-auto p-6 md:p-10 pb-24 animate-in fade-in slide-in-from-bottom-4 duration-500 min-h-full flex flex-col">
          {settingsActiveTab === 'Appearance' && <AppearanceTab />}
          {settingsActiveTab === 'Terminal' && <TerminalTab />}
          {settingsActiveTab === 'SSH' && <SSHTab />}
          {settingsActiveTab === 'System' && <SystemTab encryptionDisabled={encryptionDisabled} />}
          {settingsActiveTab === 'Audit' && <AuditTab />}
          {settingsActiveTab === 'About' && <AboutTab />}
        </div>
      </div>
    </div>
  );
};
