import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAppStore } from '../store/appStore';

import { SettingsSidebar } from './settings/SettingsSidebar';
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
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settingsActiveTab,
  setSettingsActiveTab,
  encryptionDisabled,
}) => {
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
    <>
    <div className={`flex-1 flex overflow-hidden bg-transparent ${isDark ? 'text-white' : 'text-slate-800'}`}>
      <SettingsSidebar 
        settingsActiveTab={settingsActiveTab} 
        setSettingsActiveTab={setSettingsActiveTab} 
      />

      {/* Settings Payload */}
      <div className="flex-1 flex flex-col relative bg-transparent min-w-0">
        {/* Navigation Buttons */}
        <div className="absolute right-8 top-8 z-30 flex items-center gap-2">
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
        </div>

        {/* Content Scroll Area */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden relative">
          {settingsActiveTab === 'Appearance' && <AppearanceTab />}
          {settingsActiveTab === 'Terminal' && <TerminalTab />}
          {settingsActiveTab === 'SSH' && <SSHTab />}
          {settingsActiveTab === 'System' && <SystemTab encryptionDisabled={encryptionDisabled} />}
          {settingsActiveTab === 'Audit' && <AuditTab />}
          {settingsActiveTab === 'About' && <AboutTab />}
        </div>
      </div>
    </div>
    </>
  );
};
