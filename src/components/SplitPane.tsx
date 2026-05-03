import React, { useCallback } from 'react';
import { usePanelStore } from '../store/panelStore';
import { useAppStore } from '../store/appStore';
import { useSessionStore } from '../store/sessionStore';

/**
 * SplitPane - A dynamic, resizable split panel engine.
 * Renders the active panel (registered via panelStore) alongside the main content.
 * Supports drag-to-resize with min/max constraints.
 */
export const SplitPane: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const activePanel = usePanelStore(s => s.getActivePanel());
  const activePanelId = usePanelStore(s => s.activePanelId);
  const panelSizes = usePanelStore(s => s.panelSizes);
  const setPanelSize = usePanelStore(s => s.setPanelSize);
  const isDark = useAppStore(s => s.isDark);
  const activeTabId = useSessionStore(s => s.activeTabId);

  const currentSize = activePanelId ? (panelSizes[activePanelId] ?? 320) : 0;

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!activePanelId || !activePanel) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = currentSize;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (activePanel.position === 'right') {
        const newWidth = startWidth - (moveEvent.clientX - startX);
        setPanelSize(activePanelId, newWidth);
      }
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [activePanelId, activePanel, currentSize, setPanelSize]);

  const PanelComponent = activePanel?.component;

  return (
    <div className="flex-1 flex overflow-hidden relative">
      {/* Main Content */}
      <div className="flex-1 relative min-w-0">
        {children}
      </div>

      {/* Dynamic Panel */}
      {activePanelId && PanelComponent && activeTabId && activeTabId !== 'settings' && (
        <div
          className={`shrink-0 border-l relative flex flex-col ${isDark ? 'border-white/10' : 'border-black/10'}`}
          style={{ width: currentSize }}
        >
          {/* Resizer Handle */}
          <div
            className="absolute left-0 top-0 bottom-0 w-1.5 -translate-x-1/2 cursor-col-resize z-50 hover:bg-primary/50 transition-colors"
            onMouseDown={handleMouseDown}
          />
          <PanelComponent sessionId={activeTabId} isDark={isDark} />
        </div>
      )}
    </div>
  );
};
