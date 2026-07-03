import React from 'react';
import { X } from 'lucide-react';
import { Tab, collectSessionIds } from '../store/sessionStore';
import { getTerminalBuffer } from './Terminal';

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  isDark: boolean;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
}

export const TabBar: React.FC<TabBarProps> = ({ tabs, activeTabId, isDark, onSelectTab, onCloseTab }) => {
  const sshTabs = tabs.filter(t => t.id !== 'settings' && !t.isTornOff);

  if (sshTabs.length === 0) return null;

  return (
    <div
      className={`drag-region flex items-center pt-2 px-0 gap-0 border-b shrink-0 ${isDark ? 'border-white/5 bg-transparent' : 'border-black/5 bg-slate-100/50'}`}
    >
      {sshTabs.map((tab) => {
        const isActive = activeTabId === tab.id;
        return (
          <div
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            draggable
            onDragStart={(e) => {
              window.electronAPI.windowTearArm();
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', tab.id);
            }}
            onDragEnd={(e) => {
              if (e.clientY > 60 || e.clientY < 0 || e.clientX < 0 || e.clientX > window.innerWidth) {
                const rootPaneId = tab.paneTree?.paneId;
                if (rootPaneId) {
                  const sessionIds = collectSessionIds(tab.paneTree!);
                  const terminalBuffers: Record<string, string> = {};
                  sessionIds.forEach(sid => {
                    const buf = getTerminalBuffer(sid);
                    if (buf) terminalBuffers[sid] = buf;
                  });

                  window.electronAPI.windowTearExecute({
                    screenX: e.screenX,
                    screenY: e.screenY,
                    width: Math.max(800, window.outerWidth * 0.8),
                    height: Math.max(600, window.outerHeight * 0.8),
                    paneId: rootPaneId,
                    terminalBuffers,
                    tornTitle: tab.title
                  });
                }
              }
            }}
            className={`no-drag-region group flex items-center justify-between gap-3 px-4 py-1.5 border-r cursor-pointer text-sm transition-all min-w-[120px] max-w-[200px] ${isActive
              ? (isDark ? 'bg-black/20 border-white/5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] relative z-10' : 'bg-white border-black/10 text-black relative z-10')
              : (isDark ? 'bg-transparent border-white/5 text-white/50 hover:text-white hover:bg-white/5' : 'bg-transparent border-transparent text-black/50 hover:bg-black/5')
            }`}
          >
            <div className="flex flex-col h-full max-w-full relative">
              <span className="truncate font-semibold tracking-wide w-full" title={tab.title}>
                {tab.title}
              </span>
              <div className={`absolute bottom-0 left-0 w-full h-[2px] bg-gradient-duo transition-all duration-300 ${isActive ? 'opacity-100 scale-100' : 'opacity-0 scale-x-0'}`} />
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
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
