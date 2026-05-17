import React, { useCallback } from 'react';
import { usePanelStore } from '../store/panelStore';

/**
 * SplitPane - A dynamic, resizable split panel engine.
 * Renders the active panel (registered via panelStore) alongside the main content.
 * Supports both right-side (horizontal drag) and bottom (vertical drag) panels.
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

    if (activePanel.position === 'right') {
      const startX = e.clientX;
      const startWidth = currentSize;

      const onMouseMove = (mv: MouseEvent) => {
        setPanelSize(activePanelId, startWidth - (mv.clientX - startX));
      };
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);

    } else if (activePanel.position === 'bottom') {
      const startY = e.clientY;
      const startHeight = currentSize;

      const onMouseMove = (mv: MouseEvent) => {
        setPanelSize(activePanelId, startHeight - (mv.clientY - startY));
      };
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    }
  }, [activePanelId, activePanel, currentSize, setPanelSize]);

  const PanelComponent = activePanel?.component;
  const showPanel = activePanelId && PanelComponent && activeTabId && activeTabId !== 'settings';
  const isBottom = activePanel?.position === 'bottom';

  if (isBottom && showPanel) {
    // Vertical layout: terminal on top, panel on bottom
    return (
      <div className="flex flex-col w-full h-full min-h-0">
        {/* Main content */}
        <div className="flex-1 relative min-w-0 min-h-0 overflow-hidden">
          {children}
        </div>

        {/* Bottom panel */}
        <div
          className={`shrink-0 border-t relative flex flex-col ${isDark ? 'border-white/10' : 'border-black/10'}`}
          style={{ height: currentSize }}
        >
          {/* Resizer handle — top edge */}
          <div
            className="absolute top-0 left-0 right-0 h-1.5 -translate-y-1/2 cursor-row-resize z-50 hover:bg-primary/50 transition-colors"
            onMouseDown={handleMouseDown}
          />
          <PanelComponent sessionId={activeTabId} isDark={isDark} />
        </div>
      </div>
    );
  }

  // Default: horizontal layout (right-side panel)
  return (
    <>
      {/* Main Content - takes remaining space */}
      <div className="flex-1 relative min-w-0">
        {children}
      </div>

      {/* Right Dynamic Panel */}
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
