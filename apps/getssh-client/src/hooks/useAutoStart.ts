import { useEffect, useRef } from 'react';
import { useSessionStore } from '../store/sessionStore';
import { useAppStore } from '../store/appStore';
import { buildConnectionConfig, buildStartupCommand } from '../utils/connectionProfile';

export const useAutoStart = () => {
  const sessions = useSessionStore(state => state.sessions);
  const setActiveTabId = useSessionStore(state => state.setActiveTabId);
  const setTabs = useSessionStore(state => state.setTabs);
  const appConfig = useAppStore(state => state.appConfig);
  
  const hasAutoStarted = useRef(false);

  useEffect(() => {
    if (sessions.length > 0 && !hasAutoStarted.current) {
        hasAutoStarted.current = true;
        const autoSessions = sessions.filter(s => s.autoStart);
        autoSessions.forEach(autoSession => {
            const config = buildConnectionConfig(autoSession, appConfig);
            
            const payload = { ...config, enableAuditLogging: appConfig.enableAuditLogging };
            window.electronAPI.sshConnect(payload).then(res => {
               if (res.success && res.sessionId) {
                 const tabTitle = autoSession.alias || `${config.username}@${config.host}`;
                 setTabs([...useSessionStore.getState().tabs, { id: res.sessionId as string, title: tabTitle, config }]);
                 setActiveTabId(res.sessionId);
                 window.electronAPI.nexusRegisterTab(res.sessionId, res.sessionId, res.sessionId, 'terminal', JSON.stringify(config), tabTitle).catch(e => console.error('[Stateless UI] Failed to register auto-start tab:', e));
                 const startupCommand = [appConfig.initScript?.trim(), buildStartupCommand(autoSession)].filter(Boolean).join('\n');
                 if (startupCommand && res.sessionId) {
                     const sessionId = res.sessionId;
                     setTimeout(() => {
                        if (window.confirm(`[Security Check]\nAn initialization script is about to be executed on this server:\n\n${startupCommand}\n\nDo you want to allow this?`)) {
                          window.electronAPI.sshWrite(sessionId, `${startupCommand}\n`);
                        }
                     }, 1500);
                 }
               }
            });
        });
    }
  }, [sessions, appConfig, setActiveTabId, setTabs]);
};
