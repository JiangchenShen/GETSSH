import React, { useEffect, useRef } from 'react';
import { ConnectForm, type ConnectFormSession } from '../ConnectForm';
import { savedProfiles, useSessionStore } from '../../store/sessionStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useAppLockStore } from '../../store/appLockStore';

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
  const alive = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    alive.current = true;
    const stopWorkspace = useWorkspaceStore.subscribe((next, previous) => {
      if (next.activeWorkspaceId !== previous.activeWorkspaceId || next.isSwitching !== previous.isSwitching || next.isVaultLocked !== previous.isVaultLocked) generation.current += 1;
    });
    const stopApp = useAppLockStore.subscribe((next, previous) => {
      if (next.state?.phase !== previous.state?.phase) generation.current += 1;
    });
    return () => { alive.current = false; generation.current += 1; stopWorkspace(); stopApp(); };
  }, []);
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
          onSaveSession={async (index, updatedSession) => {
            const requestGeneration = generation.current;
            const state = useSessionStore.getState();
            const revision = state.sessionsRevision;
            const current = () => {
              const workspace = useWorkspaceStore.getState();
              const sessions = useSessionStore.getState();
              return alive.current && generation.current === requestGeneration && workspace.activeWorkspaceId === workspaceId
                && !workspace.isSwitching && !workspace.isVaultLocked && useAppLockStore.getState().state?.phase === 'ready'
                && sessions.profilesWorkspaceId === workspaceId && sessions.sessionsRevision === revision;
            };
            if (!current() || updatedSession.isQuickConnect) return false;
            const profileIndex = editingSessionId ? state.sessions.findIndex(profile => profile.id === editingSessionId) : index;
            if (profileIndex < 0 || !state.sessions[profileIndex]) return false;
            const changed = Object.fromEntries(Object.entries(updatedSession).filter(([key, value]) => !Object.is(value, editingSession[key])));
            const next = [...state.sessions];
            next[profileIndex] = { ...next[profileIndex], ...changed };
            const acknowledged = await window.electronAPI.saveProfiles({ workspaceId, payload: savedProfiles(next) });
            if (acknowledged !== true || !current()) return false;
            const latest = useSessionStore.getState().sessions;
            const latestIndex = editingSessionId ? latest.findIndex(profile => profile.id === editingSessionId) : index;
            if (latestIndex < 0 || !latest[latestIndex]) return false;
            const cleanChanges: ConnectFormSession = { ...changed };
            for (const field of ['password', 'passphrase'] as const) if (Object.hasOwn(cleanChanges, field)) cleanChanges[field] = undefined;
            useSessionStore.getState().setSessions(latest.map((profile, itemIndex) => itemIndex === latestIndex ? { ...profile, ...cleanChanges } : profile));
            return true;
          }}
        />
      </div>
    </div>
  );
};
