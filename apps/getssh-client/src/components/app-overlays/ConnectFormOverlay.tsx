import React from 'react';
import { MoovierTile } from '@moovier/core';
import { ConnectForm } from '../ConnectForm';

interface ConnectFormOverlayProps {
  tabsLength: number;
  isDark: boolean;
  selectedSessionIndex: number | null;
  sessions: any[];
  activeTabId: string | null;
  appConfig: any;
  connecting: boolean;
  error: string | null;
  handleConnect: (session: any) => Promise<void>;
  syncProfiles: (updatedSessions: any[]) => void;
}

export const ConnectFormOverlay: React.FC<ConnectFormOverlayProps> = ({
  tabsLength,
  isDark,
  selectedSessionIndex,
  sessions,
  activeTabId,
  appConfig,
  connecting,
  error,
  handleConnect,
  syncProfiles
}) => {
  if (selectedSessionIndex === null || !sessions[selectedSessionIndex] || activeTabId === 'settings') {
    return null;
  }

  return (
    <div className={`absolute inset-0 flex items-center justify-center overflow-y-auto z-30 ${tabsLength > 0 ? (isDark ? 'bg-black/60 backdrop-blur-md' : 'bg-white/60 backdrop-blur-md') : 'bg-transparent'}`}>
      <div className={`p-8 w-full max-w-5xl rounded-[32px] ${isDark ? 'bg-[#121212] shadow-[0_10px_40px_rgba(0,0,0,0.8)] border border-white/5' : ''}`}>
        <ConnectForm
          session={sessions[selectedSessionIndex]}
          index={selectedSessionIndex}
          appConfig={appConfig}
          isDark={isDark}
          connecting={connecting}
          error={error}
          onConnect={handleConnect}
          onUpdateSession={(index, updatedSession) => {
            const u = [...sessions];
            u[index] = updatedSession;
            syncProfiles(u);
          }}
        />
      </div>
    </div>
  );
};
