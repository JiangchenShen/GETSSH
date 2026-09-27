import { useEffect, useRef } from 'react';
import { callNexus, useSessionStore, type PaneLeaf } from '../store/sessionStore';
import { useAppStore } from '../store/appStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { buildConnectionConfig, buildStartupCommand, stripConnectionSecrets } from '../utils/connectionProfile';

export const useAutoStart = () => {
  const sessions = useSessionStore(state => state.sessions);
  const setActiveTabId = useSessionStore(state => state.setActiveTabId);
  const setTabs = useSessionStore(state => state.setTabs);
  const appConfig = useAppStore(state => state.appConfig);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  
  const hasAutoStarted = useRef(false);

  useEffect(() => {
    if (sessions.length > 0 && !hasAutoStarted.current) {
        hasAutoStarted.current = true;
        const autoSessions = sessions.filter(s => s.autoStart);
        autoSessions.forEach(autoSession => {
            const connectionWorkspaceId = activeWorkspaceId;
            const config = {
              ...buildConnectionConfig(autoSession, appConfig),
              profileId: autoSession.id,
              workspaceId: connectionWorkspaceId,
            };
            
            const payload = { ...config, enableAuditLogging: appConfig.enableAuditLogging };
            window.electronAPI.sshConnect(payload).then(res => {
               if (res.success && res.sessionId) {
                 const tabTitle = autoSession.alias || `${config.username}@${config.host}`;
                 // Same shape as handleConnect: the local tree renders the terminal even before (or without) nexus-core.
                 // Leaf configs reach nexus-core and every window, so they never carry credentials.
                 const paneConfig = stripConnectionSecrets(config);
                 const paneTree: PaneLeaf = { type: 'leaf', paneId: res.sessionId, paneType: 'terminal', sessionId: res.sessionId, config: paneConfig };
                 setTabs([...useSessionStore.getState().tabs, {
                   id: res.sessionId as string,
                   title: tabTitle,
                   config,
                   workspaceId: connectionWorkspaceId,
                   paneTree,
                 }]);
                 if (useWorkspaceStore.getState().activeWorkspaceId === connectionWorkspaceId) {
                   setActiveTabId(res.sessionId);
                 }
                 void callNexus('register auto-start tab', window.electronAPI.nexusRegisterTab(res.sessionId, res.sessionId, res.sessionId, 'terminal', JSON.stringify(paneConfig), tabTitle, connectionWorkspaceId));
                 const startupCommand = [appConfig.initScript?.trim(), buildStartupCommand(autoSession)].filter(Boolean).join('\n');
                 if (startupCommand && res.sessionId) {
                     const sessionId = res.sessionId;
                     setTimeout(() => {
                        if (useWorkspaceStore.getState().activeWorkspaceId !== connectionWorkspaceId) return;
                        if (window.confirm(`[Security Check]\nAn initialization script is about to be executed on this server:\n\n${startupCommand}\n\nDo you want to allow this?`)) {
                          window.electronAPI.sshWrite(sessionId, `${startupCommand}\n`);
                        }
                     }, 1500);
                 }
               }
            });
        });
    }
  }, [sessions, appConfig, activeWorkspaceId, setActiveTabId, setTabs]);
};
