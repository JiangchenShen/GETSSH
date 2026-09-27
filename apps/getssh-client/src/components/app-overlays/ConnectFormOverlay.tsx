import React from 'react';
import { ConnectForm } from '../ConnectForm';
import { useSessionStore } from '../../store/sessionStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

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
  const workspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  if (selectedSessionIndex === null || !sessions[selectedSessionIndex] || activeTabId === 'settings') {
    return null;
  }

  const editingSession = sessions[selectedSessionIndex];
  const editingSessionId = editingSession.id;

  return (
    <div className={`absolute inset-0 z-30 overflow-hidden dashboard-shell ${activeTabId ? 'backdrop-blur-xl' : ''}`}>
      <div className="relative h-full w-full overflow-hidden">
        <ConnectForm
          key={`${sessions[selectedSessionIndex].id}:${Boolean(sessions[selectedSessionIndex].isQuickConnect)}`}
          session={sessions[selectedSessionIndex]}
          index={selectedSessionIndex}
          appConfig={appConfig}
          isDark={isDark}
          connecting={connecting}
          error={error}
          onCancel={onCancel}
          onConnect={handleConnect}
          onUpdateSession={(index, updatedSession) => {
            const workspace = useWorkspaceStore.getState();
            if (workspace.activeWorkspaceId !== workspaceId || workspace.isSwitching || workspace.isVaultLocked) return;
            const current = useSessionStore.getState().sessions;
            const currentIndex = editingSessionId
              ? current.findIndex(profile => profile.id === editingSessionId)
              : index;
            if (currentIndex < 0 || !current[currentIndex]) return;
            const u = [...current];
            const changed = Object.fromEntries(Object.entries(updatedSession).filter(([key, value]) =>
              !Object.is(value, editingSession[key])));
            u[currentIndex] = { ...current[currentIndex], ...changed };
            if (updatedSession.isQuickConnect) useSessionStore.getState().setSessions(u);
            else syncProfiles(u);
          }}
        />
      </div>
    </div>
  );
};
