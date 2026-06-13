import React, { createContext, useContext, useState, ReactNode } from 'react';

interface MoovierFocusContextType {
  activeTileId: string | null;
  setActiveTileId: (id: string | null) => void;
}

// 提供默认空值，允许组件在没有 Provider 的环境下优雅降级运行
const MoovierFocusContext = createContext<MoovierFocusContextType>({
  activeTileId: null,
  setActiveTileId: () => {},
});

export const MoovierFocusProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [activeTileId, setActiveTileId] = useState<string | null>(null);

  // Global Click-away detector
  React.useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      // Traverse DOM to see if click originated inside a MoovierTile
      let target = e.target as HTMLElement | null;
      let clickedTileId = null;
      while (target && target !== document.body) {
        if (target.dataset && target.dataset.moovierTileId) {
          clickedTileId = target.dataset.moovierTileId;
          break;
        }
        target = target.parentElement;
      }
      
      // If we clicked something that is not a tile, reset focus
      if (!clickedTileId) {
        setActiveTileId(null);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, { capture: true });
    };
  }, []);

  return (
    <MoovierFocusContext.Provider value={{ activeTileId, setActiveTileId }}>
      {children}
    </MoovierFocusContext.Provider>
  );
};

export const useMoovierFocus = () => {
  const context = useContext(MoovierFocusContext);
  if (!context) {
    throw new Error('useMoovierFocus must be used within a MoovierFocusProvider');
  }
  return context;
};
