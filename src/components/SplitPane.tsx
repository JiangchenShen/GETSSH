import React, { useCallback } from 'react';
import { usePanelStore } from '../store/panelStore';

/**
 * SplitPane - A dynamic, resizable split panel engine.
 * Renders the active panel (registered via panelStore) alongside the main content.
 * Supports drag-to-resize with min/max constraints.
 * 
 * Props:
 *  - isDark: current theme
 *  - activeTabId: current active tab (passed from parent to avoid store dependency)
 */
interface SplitPaneProps {
  children: React.ReactNode;
  isDark: boolean;
  activeTabId: string | null;
}

export const SplitPane: React.FC<SplitPaneProps> = ({ children, isDark, activeTabId }) => {
  const activePanelId = usePanelStore(s => s.activePanelId);
  const panels = usePanelStore(s => s.panels);
  const panelSizes = usePanelStore(s => s.panelSizes);
  const setPanelSize = usePanelStore(s => s.setPanelSize);

  const activePanel = panels.find(p => p.id === activePanelId) ?? null;
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
  const showPanel = activePanelId && PanelComponent && activeTabId && activeTabId !== 'settings';

  return (
    <>
      {/* Main Content - takes remaining space */}
      <div className="flex-1 relative min-w-0">
        {children}
      </div>

      {/* Dynamic Panel */}
      {showPanel && (
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
    </>
  );
};
