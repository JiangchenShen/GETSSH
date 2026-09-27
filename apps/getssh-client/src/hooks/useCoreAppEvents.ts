import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { callNexus, useSessionStore, PaneNode, type PaneLeaf, type SessionProfile } from '../store/sessionStore';
import { useAppStore } from '../store/appStore';
import { Runbook, useWorkspaceStore } from '../store/workspaceStore';
import { findLeaf, findWelcomePane, updateLeafInTree } from '../utils/paneHelpers';
import { stripConnectionSecrets } from '../utils/connectionProfile';
import { detectProtocol } from '../utils/protocolParser';

import { useAiChatStore } from '../store/aiChatStore';

const findCenterPane = (node: PaneNode, centerType: string): PaneLeaf | null => {
  if (node.type !== 'leaf') return findCenterPane(node.children[0], centerType) ?? findCenterPane(node.children[1], centerType);
  if (node.paneType !== 'center' || !node.config || !('centerType' in node.config)) return null;
  return node.config.centerType === centerType || (centerType === 'settings' && node.config.centerType === 'secure') ? node : null;
};

export const useCoreAppEvents = (
  setPendingHighRiskRunbook: (runbook: Runbook | null) => void,
  syncProfiles: (updatedSessions: any[]) => void,
  handleConnect: (session: any) => void
) => {
  const { t } = useTranslation();

  useEffect(() => {
    const handleCreateSession = (e: CustomEvent) => {
      const { sessions, setSessions, setSelectedSessionIndex, setActiveTabId } = useSessionStore.getState();
      const address = typeof e.detail === 'string' ? e.detail.trim() : '';
      const parsed = address ? detectProtocol(address) : null;
      const host = parsed?.protocol === 'local' ? '' : (parsed?.parsedHost ?? address);
      const makeDraft = (id: string = crypto.randomUUID()): SessionProfile => ({
        id,
        isDraft: true,
        isQuickConnect: Boolean(address),
        host,
        username: parsed?.parsedUser ?? '',
        port: parsed?.parsedPort,
        password: '',
        privateKeyPath: '',
        autoStart: false,
        protocol: parsed?.protocol ?? 'auto',
      });
      const existingDraftIndex = sessions.findIndex(session => session.isDraft);
      if (existingDraftIndex >= 0) {
        if (sessions[existingDraftIndex].isQuickConnect) {
          setSessions(sessions.map((session, index) => index === existingDraftIndex
            ? makeDraft(session.id)
            : session));
        }
        setSelectedSessionIndex(existingDraftIndex);
        setActiveTabId(null);
        return;
      }
      const updated = [...sessions, makeDraft()];
      setSessions(updated);
      setSelectedSessionIndex(updated.length - 1);
      setActiveTabId(null);
    };

    const getActiveSessionId = (): string | null => {
      const state = useSessionStore.getState();
      if (!state.activeTabId || !state.activePaneId) return null;
      const tab = state.tabs.find(t => t.id === state.activeTabId);
      if (!tab || !tab.paneTree) return null;
      let foundSessionId: string | null = null;
      const traverse = (node: PaneNode) => {
        if (node.type === 'leaf') {
          if (node.paneId === state.activePaneId && node.paneType === 'terminal') foundSessionId = node.sessionId;
        } else {
          traverse(node.children[0]);
          traverse(node.children[1]);
        }
      };
      traverse(tab.paneTree);
      return foundSessionId;
    };

    const executeRunbookCommand = (command: string) => {
      const sessionId = getActiveSessionId();
      if (!sessionId) {
        useAppStore.getState().addToast(t('commandCenter.noActiveTerminal', '未找到活动的终端面板以执行剧本'), 'warning');
        return;
      }
      const sanitized = command.replace(/[\r\n]+/g, ' ').trim();
      if (window.electronAPI?.sshWrite) {
        window.electronAPI.sshWrite(sessionId, sanitized);
        useAppStore.getState().addToast(t('commandCenter.runbookFilled', '剧本命令已安全填入终端缓冲'), 'success');
      }
    };

    const handleRunbookExecute = (e: CustomEvent<Runbook>) => {
      const runbook = e.detail;
      if (runbook.dangerLevel === 'high' && runbook.requireMfa) {
        setPendingHighRiskRunbook(runbook);
      } else {
        executeRunbookCommand(runbook.command);
      }
    };

    const handleOpenCenter = (e: CustomEvent<{ type: 'ai' | 'plugin' | 'secure' | 'workspace' | 'settings', title: string, settingsTab?: string, workspacePage?: string }>) => {
      // Security is now a Settings category. Keep old callers and restored tabs usable.
      const centerType = e.detail.type === 'secure' ? 'settings' : e.detail.type;
      const settingsTab = e.detail.type === 'secure' ? 'Security' : e.detail.settingsTab;
      const centerConfig = { centerType, ...(settingsTab ? { settingsTab } : {}), ...(e.detail.workspacePage ? { workspacePage: e.detail.workspacePage } : {}) };
      const tabTitle = centerType === 'settings' ? t('statusBar.settings') : e.detail.title;
      const { tabs, activeTabId, setTabs, setActiveTabId, setSelectedSessionIndex } = useSessionStore.getState();
      const activeWorkspaceId = useWorkspaceStore.getState().activeWorkspaceId;

      const existingTab = tabs.find(tab => (tab.workspaceId ?? activeWorkspaceId) === activeWorkspaceId
        && ((tab.config && 'centerType' in tab.config
          && (tab.config.centerType === centerType || (centerType === 'settings' && tab.config.centerType === 'secure')))
          || (tab.paneTree && findCenterPane(tab.paneTree, centerType))));
      if (existingTab) {
        const existingPane = existingTab.paneTree && findCenterPane(existingTab.paneTree, centerType);
        if (settingsTab || e.detail.workspacePage) {
          setTabs(tabs.map(tab => tab.id === existingTab.id ? {
            ...tab,
            title: centerType === 'settings' && tab.config && 'centerType' in tab.config ? tabTitle : tab.title,
            config: tab.config && 'centerType' in tab.config ? centerConfig : tab.config,
            paneTree: existingPane && tab.paneTree
              ? updateLeafInTree(tab.paneTree, existingPane.paneId, { config: centerConfig })
              : tab.paneTree,
          } : tab));
          if (existingPane) {
            void callNexus('update center destination', window.electronAPI.nexusReplacePane(existingPane.paneId, 'center', null, JSON.stringify(centerConfig)));
          }
        }
        setActiveTabId(existingTab.id);
        setSelectedSessionIndex(null);
        if (settingsTab) window.dispatchEvent(new CustomEvent('app:settings-tab', { detail: settingsTab }));
        if (e.detail.workspacePage) window.dispatchEvent(new CustomEvent('app:workspace-page', { detail: e.detail.workspacePage }));
        return;
      }

      const currentTab = tabs.find(t => t.id === activeTabId);
      let targetPaneId: string | null = null;
      
      if (currentTab && currentTab.paneTree) {
        if (useSessionStore.getState().activePaneId) {
            const activeLeaf = findLeaf(currentTab.paneTree, useSessionStore.getState().activePaneId!);
            if (activeLeaf && activeLeaf.paneType === 'welcome') targetPaneId = activeLeaf.paneId;
        }
        if (!targetPaneId) {
            const welcomeLeaf = findWelcomePane(currentTab.paneTree);
            if (welcomeLeaf) targetPaneId = welcomeLeaf.paneId;
        }
      }

      if (targetPaneId) {
        setTabs(tabs.map(t => {
          if (t.id !== activeTabId || !t.paneTree) return t;
          return {
            ...t,
            title: t.paneTree.type === 'leaf' ? tabTitle : t.title,
            config: t.paneTree.type === 'leaf' ? centerConfig : t.config,
            workspaceId: activeWorkspaceId,
            paneTree: updateLeafInTree(t.paneTree, targetPaneId!, { paneType: 'center', sessionId: null, config: centerConfig }),
          };
        }));
        setSelectedSessionIndex(null);
        void callNexus('replace pane with center', window.electronAPI.nexusReplacePane(targetPaneId, 'center', null, JSON.stringify(stripConnectionSecrets(centerConfig))));
      } else {
        const newTabId = `cmd-${Date.now()}`;
        const newPaneId = `pane-${Date.now()}`;
        setTabs([...tabs, {
          id: newTabId,
          title: tabTitle,
          config: centerConfig,
          workspaceId: activeWorkspaceId,
          paneTree: { type: 'leaf', paneId: newPaneId, paneType: 'center', sessionId: null, config: centerConfig }
        }]);
        setActiveTabId(newTabId);
        setSelectedSessionIndex(null);
        void callNexus('register center tab', window.electronAPI.nexusRegisterTab(newTabId, newPaneId, "", 'center', JSON.stringify(stripConnectionSecrets(centerConfig)), tabTitle, activeWorkspaceId));
      }
    };

    const handleOpenSettings = () => {
      window.dispatchEvent(new CustomEvent('app:open-center', { 
        detail: { type: 'settings', title: 'Settings' } 
      }));
    };

    let removeAiListener: (() => void) | undefined;
    if (window.electronAPI && window.electronAPI.ai && window.electronAPI.ai.onAgentGlobalAction) {
      removeAiListener = window.electronAPI.ai.onAgentGlobalAction((payload) => {
         const { sessions } = useSessionStore.getState();

         if (payload.type === 'open_session') {
            const target = (payload.target || '').trim().toLowerCase();
            const cleanTarget = target.replace(/[-_.\s]/g, '');

            const session = sessions.find((s: any) => {
              const alias = (s.alias || '').trim().toLowerCase();
              const host = (s.host || '').trim().toLowerCase();
              const name = (s.name || s.title || '').trim().toLowerCase();
              const id = (s.id || '').trim().toLowerCase();

              const cleanAlias = alias.replace(/[-_.\s]/g, '');
              const cleanHost = host.replace(/[-_.\s]/g, '');
              const cleanName = name.replace(/[-_.\s]/g, '');
              const cleanId = id.replace(/[-_.\s]/g, '');

              return alias === target || host === target || name === target || id === target
                || cleanAlias === cleanTarget || cleanHost === cleanTarget || cleanName === cleanTarget || cleanId === cleanTarget
                || (cleanAlias && cleanTarget.includes(cleanAlias)) || (cleanTarget && cleanAlias.includes(cleanTarget))
                || (cleanName && cleanTarget.includes(cleanName)) || (cleanTarget && cleanName.includes(cleanTarget))
                || (cleanHost && cleanTarget.includes(cleanHost)) || (cleanTarget && cleanHost.includes(cleanTarget));
            });

            if (session) {
               const sessionToOpen = { ...session };
               useAppStore.getState().setIsCommandCenterOpen(false); // Close Spotlight if open
               handleConnect(sessionToOpen);

               if (payload.execute) {
                  setTimeout(() => {
                     useAppStore.getState().setIsAiCenterOpen(true);
                     setTimeout(() => {
                        const prompt = t('commandCenter.aiFollowup', { command: payload.execute, defaultValue: `Execute the following command: {{command}}` }).replace('{{command}}', payload.execute!);
                        window.dispatchEvent(new CustomEvent('ai:submit-prompt', { detail: prompt }));
                     }, 300);
                  }, 1000);
               }
            } else {
               const errorMsg = `❌ 找不到主机: **${payload.target}**\n\n可用的主机列表:\n${sessions.map((s: any) => `- \`${s.alias || s.host}\``).join('\n')}`;
               let convId = useAiChatStore.getState().activeConversationId;
               if (!convId) {
                 convId = useAiChatStore.getState().newConversation();
               }
               useAiChatStore.getState().addMessage(convId, { id: Date.now().toString(), role: 'assistant', content: errorMsg, timestamp: Date.now() });
            }
         }
      });
    }

    window.addEventListener('app:create-session', handleCreateSession as EventListener);
    window.addEventListener('app:runbook-execute', handleRunbookExecute as EventListener);
    window.addEventListener('app:open-center', handleOpenCenter as EventListener);
    window.addEventListener('app:open-settings', handleOpenSettings as EventListener);
    
    return () => {
      window.removeEventListener('app:create-session', handleCreateSession as EventListener);
      window.removeEventListener('app:runbook-execute', handleRunbookExecute as EventListener);
      window.removeEventListener('app:open-center', handleOpenCenter as EventListener);
      window.removeEventListener('app:open-settings', handleOpenSettings as EventListener);
      if (removeAiListener) removeAiListener();
    };
  }, [syncProfiles, setPendingHighRiskRunbook, handleConnect, t]);
};
