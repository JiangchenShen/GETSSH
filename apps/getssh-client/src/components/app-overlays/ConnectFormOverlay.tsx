import React from 'react';
import { ConnectForm } from '../ConnectForm';

interface ConnectFormOverlayProps {
  isDark: boolean;
  selectedSessionIndex: number | null;
  sessions: any[];
  activeTabId: string | null;
  appConfig: any;
  connecting: boolean;
  error: string | null;
  handleConnect: (session: any) => Promise<void>;
  syncProfiles: (updatedSessions: any[]) => void;
  onCancel: () => void;
}

export const ConnectFormOverlay: React.FC<ConnectFormOverlayProps> = ({
  isDark,
  selectedSessionIndex,
  sessions,
  activeTabId,
  appConfig,
  connecting,
  error,
  handleConnect,
  syncProfiles,
  onCancel
}) => {
  if (selectedSessionIndex === null || !sessions[selectedSessionIndex] || activeTabId === 'settings') {
    return null;
  }

  return (
    <div className={`absolute inset-0 z-30 overflow-hidden dashboard-shell ${activeTabId ? 'backdrop-blur-xl' : ''}`}>
      <div className="relative h-full w-full overflow-hidden">
        <ConnectForm
          session={sessions[selectedSessionIndex]}
          index={selectedSessionIndex}
          appConfig={appConfig}
          isDark={isDark}
          connecting={connecting}
          error={error}
          onCancel={onCancel}
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
