import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSessionStore, PaneNode } from '../store/sessionStore';
import { useAppStore } from '../store/appStore';
import { Runbook } from '../store/workspaceStore';
import { findLeaf, findWelcomePane, updateLeafInTree } from '../utils/paneHelpers';

export const useCoreAppEvents = (
  setPendingHighRiskRunbook: (runbook: Runbook | null) => void,
  setIsSettingsOpen: (open: boolean) => void,
  syncProfiles: (updatedSessions: any[]) => void
) => {
  const { t } = useTranslation();

  useEffect(() => {
    const handleCreateSession = (e: CustomEvent) => {
      const { sessions, setSelectedSessionIndex, setActiveTabId } = useSessionStore.getState();
      const newSession = { host: e.detail, username: '', password: '', privateKeyPath: '', autoStart: false, protocol: 'auto' };
      const updated = [...sessions, newSession as any];
      syncProfiles(updated);
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

    const handleOpenCenter = (e: CustomEvent<{ type: 'ai' | 'plugin' | 'secure' | 'workspace', title: string }>) => {
      const centerType = e.detail.type;
      const tabTitle = e.detail.title;
      const { tabs, activeTabId, setTabs, setActiveTabId, setSelectedSessionIndex } = useSessionStore.getState();

      const existingTab = tabs.find(t => t.config && (t.config as any).centerType === centerType);
      if (existingTab) {
        setActiveTabId(existingTab.id);
        setSelectedSessionIndex(null);
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
          return { ...t, paneTree: updateLeafInTree(t.paneTree, targetPaneId!, { paneType: 'center', sessionId: null, config: { centerType } }) };
        }));
        setSelectedSessionIndex(null);
        window.electronAPI.nexusReplacePane(targetPaneId, 'center', null, JSON.stringify({ centerType })).catch(e => {
          console.error('[Stateless UI] Failed to replace pane to center in Rust:', e);
        });
      } else {
        const newTabId = `cmd-${Date.now()}`;
        const newPaneId = `pane-${Date.now()}`;
        setTabs([...tabs, {
          id: newTabId,
          title: tabTitle,
          config: { centerType },
          paneTree: { type: 'leaf', paneId: newPaneId, paneType: 'center', sessionId: null, config: { centerType } }
        }]);
        setActiveTabId(newTabId);
        setSelectedSessionIndex(null);
        window.electronAPI.nexusRegisterTab(newTabId, newPaneId, "", 'center', JSON.stringify({ centerType }), tabTitle).catch(e => {
          console.error('[Stateless UI] Failed to register center tab in Rust:', e);
        });
      }
    };

    const handleOpenSettings = () => setIsSettingsOpen(true);

    window.addEventListener('app:create-session', handleCreateSession as EventListener);
    window.addEventListener('app:runbook-execute', handleRunbookExecute as EventListener);
    window.addEventListener('app:open-center', handleOpenCenter as EventListener);
    window.addEventListener('app:open-settings', handleOpenSettings as EventListener);
    
    return () => {
      window.removeEventListener('app:create-session', handleCreateSession as EventListener);
      window.removeEventListener('app:runbook-execute', handleRunbookExecute as EventListener);
      window.removeEventListener('app:open-center', handleOpenCenter as EventListener);
      window.removeEventListener('app:open-settings', handleOpenSettings as EventListener);
    };
  }, [syncProfiles, setPendingHighRiskRunbook, setIsSettingsOpen, t]);
};
