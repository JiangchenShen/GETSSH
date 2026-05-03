import React from 'react';
import { X } from 'lucide-react';
import { useSessionStore } from '../store/sessionStore';
import { useAppStore } from '../store/appStore';

export const TabBar: React.FC = () => {
  const tabs = useSessionStore(s => s.tabs);
  const activeTabId = useSessionStore(s => s.activeTabId);
  const setActiveTabId = useSessionStore(s => s.setActiveTabId);
  const setSelectedSessionIndex = useSessionStore(s => s.setSelectedSessionIndex);
  const closeTab = useSessionStore(s => s.closeTab);
  const isDark = useAppStore(s => s.isDark);

  const sshTabs = tabs.filter(t => t.id !== 'settings');

  if (sshTabs.length === 0) return null;

  return (
    <div
      className={`flex items-end px-2 gap-1 border-b shrink-0 ${isDark ? 'border-white/10 bg-black/20' : 'border-black/5 bg-white/30'}`}
      style={{ WebkitAppRegion: 'no-drag' } as any}
    >
      {sshTabs.map((tab) => {
        const isActive = activeTabId === tab.id;
        return (
          <div
            key={tab.id}
            onClick={() => { setActiveTabId(tab.id); setSelectedSessionIndex(null); }}
            className={`group flex items-center justify-between gap-3 px-4 py-2 rounded-t-lg border-t border-x cursor-pointer text-sm transition-all min-w-[150px] max-w-[200px] ${isActive
              ? (isDark ? 'bg-black/60 border-white/10 text-white shadow-md' : 'bg-white border-black/10 text-black shadow-md relative z-10')
              : (isDark ? 'bg-transparent border-transparent text-white/50 hover:bg-white/5' : 'bg-transparent border-transparent text-black/50 hover:bg-black/5')
            }`}
          >
            <span className="truncate">{tab.title}</span>
            <button
              onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              className={`p-0.5 rounded-md opacity-0 group-hover:opacity-100 transition-colors ${isDark ? 'hover:bg-white/20 text-white/70' : 'hover:bg-black/10 text-black/70'}`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
