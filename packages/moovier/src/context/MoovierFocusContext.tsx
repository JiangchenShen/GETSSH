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
