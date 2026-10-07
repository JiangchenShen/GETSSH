import React, { useEffect, useState } from 'react';
import { unlockActiveWorkspaceWithPassword, unlockActiveWorkspaceWithPresence } from '../lib/workspaceUnlock';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CornerDownLeft, Layers3, LockKeyhole, Plus, Server, ShieldAlert, ShieldCheck, SquareTerminal } from 'lucide-react';

import { useAppStore } from '../store/appStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useCryptoStore } from '../store/cryptoStore';
import { isSSHConfig, savedProfiles, useSessionStore, type PaneLeaf, type PaneNode, type SessionProfile, type Tab } from '../store/sessionStore';
import type { SecurityStatus } from '../types/ipc';
import { CryptoModal } from './CryptoModal';

interface TidalDashboardProps {
  onConnect?: (session: SessionProfile) => void;
  resumeTabId?: string | null;
}

const terminalPanes = (node: PaneNode): PaneLeaf[] => node.type === 'leaf'
  ? node.paneType === 'terminal' ? [node] : []
  : node.children.flatMap(terminalPanes);

/** Workspace overview and work entry points, using current layout and protection metadata. */
export const TidalDashboard: React.FC<TidalDashboardProps> = ({ onConnect, resumeTabId }) => {
  const { t, i18n } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const setIsCommandCenterOpen = useAppStore(state => state.setIsCommandCenterOpen);
  const sentinelStatus = useAppStore(state => state.sentinelStatus);
  const sentinelStatusError = useAppStore(state => state.sentinelStatusError);
  const pollSentinelStatus = useAppStore(state => state.pollSentinelStatus);

  const workspaces = useWorkspaceStore(state => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const isVaultLocked = useWorkspaceStore(state => state.isVaultLocked);
  const isSwitching = useWorkspaceStore(state => state.isSwitching);

  const cryptoMode = useCryptoStore(state => state.cryptoMode);
  const setCryptoMode = useCryptoStore(state => state.setCryptoMode);
  const workspaceUnprotected = useCryptoStore(state => state.workspaceUnprotected);

  const sessions = useSessionStore(state => state.sessions);
  const tabs = useSessionStore(state => state.tabs);
  const setActiveTabId = useSessionStore(state => state.setActiveTabId);

  const [time, setTime] = useState(new Date());
  const [greetingChoice] = useState(() => Math.random());
  const [quickAddress, setQuickAddress] = useState('');
  const [protectionMetadata, setProtectionMetadata] = useState<{ workspaceId: string; status: SecurityStatus | null } | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (isVaultLocked) return;
    pollSentinelStatus();
    const timer = setInterval(pollSentinelStatus, 3_000);
    return () => clearInterval(timer);
  }, [pollSentinelStatus, isVaultLocked]);

  useEffect(() => {
    if (isVaultLocked) return;
    let disposed = false;
    const readProtection = async () => {
      let status: SecurityStatus | null = null;
      try { status = await window.electronAPI.security.status(); } catch { /* Unavailable metadata stays unconfirmed. */ }
      if (!disposed) setProtectionMetadata({ workspaceId: activeWorkspaceId, status });
    };
    void readProtection();
    return () => { disposed = true; };
  }, [activeWorkspaceId, isVaultLocked]);

  const handleUnlock = (password: string) => unlockActiveWorkspaceWithPassword(password);

  const handleSetup = async (password: string) => {
    const result = await window.electronAPI.workspace.setPassword({ workspaceId: useWorkspaceStore.getState().activeWorkspaceId, password });
    if (!result.ok) return;
    useCryptoStore.getState().setWorkspaceUnprotected(false);
    setCryptoMode('idle');
  };

  const activeWorkspace = workspaces.find(workspace => workspace.id === activeWorkspaceId);
  if (isVaultLocked) {
    return (
      <div className="absolute inset-0 z-[100] h-full w-full overflow-hidden rounded-[32px]">
        <CryptoModal
          mode="locked"
          isDark={isDark}
          encryptionDisabled={workspaceUnprotected}
          onUnlock={handleUnlock}
          onSetup={handleSetup}
          onSkip={cryptoMode === 'setup' ? () => setCryptoMode('idle') : undefined}
          onCancel={cryptoMode === 'setup' ? () => setCryptoMode('idle') : undefined}
          onRetryBiometric={activeWorkspace?.biometricEnabled ? async () => {
            // Touch ID / Windows Hello unlocks the workspace in the main process.
            await unlockActiveWorkspaceWithPresence();
          } : undefined}
          workspaceName={activeWorkspace?.name || activeWorkspaceId}
          themeColor={activeWorkspace?.themeColor}
        />
      </div>
    );
  }

  const hour = time.getHours();
  const greetingKey = hour < 5 ? 'midnight' : hour < 9 ? 'morning' : hour < 12 ? 'forenoon'
    : hour < 14 ? 'noon' : hour < 18 ? 'afternoon' : hour < 22 ? 'evening' : 'lateNight';
  const greetingValue = t(`welcome.greeting.${greetingKey}`, { returnObjects: true });
  const greeting = Array.isArray(greetingValue) ? greetingValue[Math.floor(greetingChoice * greetingValue.length)] : greetingValue;
  const dateString = new Intl.DateTimeFormat(i18n.language || undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  }).format(time);
  const timeString = new Intl.DateTimeFormat(i18n.language || undefined, {
    hour: '2-digit', minute: '2-digit',
  }).format(time);
  const workspaceName = activeWorkspace?.name || activeWorkspaceId;

  const savedSessions = savedProfiles(sessions).filter(session => session.protocol === 'local' || Boolean(session.host?.trim()));
  const visibleHosts = savedSessions.slice(0, 4);
  const workspaceTabs = tabs.filter(tab => !tab.isTornOff && (tab.workspaceId ?? activeWorkspaceId) === activeWorkspaceId);
  const resumeTab = workspaceTabs.find(tab => tab.id === resumeTabId && tab.paneTree);
  const panes = workspaceTabs.flatMap(tab => tab.paneTree ? terminalPanes(tab.paneTree) : []);
  const disconnectedCount = panes.filter(pane => pane.isDisconnected === true).length;
  const localCount = panes.filter(pane => isSSHConfig(pane.config) && pane.config.protocol === 'local').length;
  const remoteCount = panes.length - localCount;
  const scope = protectionMetadata?.workspaceId === activeWorkspaceId
    ? protectionMetadata.status?.scopes.find(item => item.workspaceId === activeWorkspaceId)
    : undefined;
  const protectionLabel = !scope ? 'unconfirmed' : !scope.protected ? 'passwordNotSet'
    : scope.ownPassword ? 'workspacePassword' : 'masterPassword';
  const supervisorHealthy = sentinelStatus?.daemonState === 'running' && sentinelStatus.status === 'secure'
    && !sentinelStatus.sentinelDisabled && !sentinelStatusError;
  const supervisorLabel = sentinelStatusError || sentinelStatus?.daemonState === 'unavailable' ? 'supervisorUnavailable'
    : !sentinelStatus ? 'checking'
    : sentinelStatus.sentinelDisabled || sentinelStatus.daemonState === 'disabled' ? 'supervisorDisabled'
    : sentinelStatus.daemonState === 'starting' ? 'supervisorStarting'
    : sentinelStatus.status !== 'secure' ? 'needsAttention'
    : supervisorHealthy ? 'supervisorRunning' : 'unconfirmed';
  const supervisorWarning = !!sentinelStatusError || (!!sentinelStatus && sentinelStatus.daemonState !== 'starting'
    && (sentinelStatus.sentinelDisabled || sentinelStatus.daemonState === 'disabled'
      || sentinelStatus.daemonState === 'unavailable' || sentinelStatus.status !== 'secure'));

  const createSession = (address = '') => {
    window.dispatchEvent(new CustomEvent('app:create-session', { detail: address.trim() }));
  };

  const openSecurity = () => {
    window.dispatchEvent(new CustomEvent('app:open-center', {
      detail: { type: 'settings', title: t('statusBar.settings'), settingsTab: 'Security' },
    }));
  };

  const openWorkspace = () => window.dispatchEvent(new CustomEvent('app:open-center', {
    detail: { type: 'workspace', title: t('welcome.dashboard.workspaceCenter') },
  }));

  const paneContainsProfile = (node: PaneNode, profileId: string): boolean => node.type === 'leaf'
    ? isSSHConfig(node.config)
      && node.config.profileId === profileId
      && node.config.workspaceId === activeWorkspaceId
    : paneContainsProfile(node.children[0], profileId) || paneContainsProfile(node.children[1], profileId);
  const matchingTab = (session: SessionProfile): Tab | undefined => tabs.find(tab => !tab.isTornOff
    && !!session.id
    && tab.workspaceId === activeWorkspaceId
    && !!tab.paneTree
    && paneContainsProfile(tab.paneTree, session.id));

  const openHost = (session: SessionProfile) => {
    const existing = matchingTab(session);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    if (onConnect) onConnect(session);
    else setIsCommandCenterOpen(true);
  };

  return (
    <main className="home-shell no-drag-region h-full w-full overflow-y-auto overflow-x-hidden text-ink">
      <div className="home-inner">
        <header className="home-header">
          <div className="min-w-0">
            <p className="home-eyebrow">
              <span className="home-eyebrow-mark" aria-hidden="true" />
              <span className="home-header-workspace" title={workspaceName}>{workspaceName}</span>
              <span aria-hidden="true">/</span>
              <span>{t('welcome.home.overview')}</span>
            </p>
            <h1 className="home-greeting">{greeting}</h1>
            <p className="home-meta">{t('welcome.home.subtitle')}</p>
          </div>
          <div className="home-header-side">
            <div className="home-date"><span>{dateString}</span><strong>{timeString}</strong></div>
            <button type="button" className="home-new" onClick={() => createSession()}>
              <Plus size={16} /> {t('welcome.home.newConnection')}
            </button>
          </div>
        </header>

        <dl className="home-summary" aria-label={t('welcome.home.workspaceOverview')}>
          <div><dt><Server size={15} aria-hidden="true" />{t('welcome.home.savedConnections')}</dt><dd data-testid="home-saved-count">{isSwitching ? '—' : savedSessions.length}</dd><dd className="home-summary-note">{t('welcome.home.currentWorkspace')}</dd></div>
          <div><dt><SquareTerminal size={15} aria-hidden="true" />{t('welcome.home.terminalPanels')}</dt><dd data-testid="home-terminal-count">{panes.length}</dd><dd className="home-summary-note">{t('welcome.home.thisWindow')}</dd></div>
          <div><dt><Layers3 size={15} aria-hidden="true" />{t('welcome.home.workspaces')}</dt><dd data-testid="home-workspace-count">{workspaces.length}</dd><dd className="home-summary-note">{t('welcome.home.workspaceSeparation')}</dd></div>
        </dl>

        {(supervisorWarning || scope?.protected === false) && (
          <button type="button" className="home-attention" onClick={openSecurity}>
            <ShieldAlert size={17} aria-hidden="true" />
            <span><strong>{t(supervisorWarning ? 'welcome.home.sentinelIssue' : 'welcome.home.vaultOff')}</strong><small>{supervisorWarning
              ? sentinelStatusError || sentinelStatus?.reason || t('welcome.home.supervisorReviewDetail')
              : t('welcome.home.noPasswordDetail')}</small></span>
            <span className="home-host-action">{t('welcome.home.reviewSecurity')}<ArrowRight size={14} /></span>
          </button>
        )}

        <div className="home-dashboard-grid">
        <div className="home-primary">
        <section className="home-connect" aria-labelledby="home-connect-title">
          <div className="home-connect-head">
            <div>
              <h2 id="home-connect-title">{t('welcome.home.quickConnect')}</h2>
              <p>{t('welcome.home.quickConnectDetail')}</p>
            </div>
            <SquareTerminal size={23} aria-hidden="true" />
          </div>
          <form className="home-connect-input-row" onSubmit={event => {
            event.preventDefault();
            if (quickAddress.trim()) createSession(quickAddress);
          }}>
            <span className="home-input-prefix" aria-hidden="true">›</span>
            <input
              className="home-connect-input"
              aria-label={t('welcome.home.addressLabel')}
              value={quickAddress}
              onChange={event => setQuickAddress(event.target.value)}
              placeholder="ssh://user@host:22"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
            <button type="submit" className="home-connect-submit" disabled={!quickAddress.trim()}>
              {t('welcome.home.configureConnect')} <CornerDownLeft size={15} />
            </button>
          </form>
          <p className="home-connect-foot">{t('welcome.home.connectHint')}</p>
        </section>

        {resumeTab && (
          <section className="home-section" aria-labelledby="home-resume-title">
            <div className="home-section-title">
              <h2 id="home-resume-title">{t('welcome.home.continueWork')}</h2>
            </div>
            <button type="button" className="home-resume" onClick={() => setActiveTabId(resumeTab.id)}>
              <span className="home-resume-icon">{isSSHConfig(resumeTab.config) ? <SquareTerminal size={19} /> : <Layers3 size={19} />}</span>
              <span className="home-host-main"><strong>{resumeTab.title}</strong><small>{t('welcome.home.openTab')}</small></span>
              <span className="home-host-action">{t('welcome.home.returnToTab')} <ArrowRight size={15} /></span>
            </button>
          </section>
        )}

        <section className="home-section" aria-labelledby="home-hosts-title">
          <div className="home-section-title">
            <div>
              <h2 id="home-hosts-title">{t('welcome.home.savedHosts')}</h2>
            </div>
            <span className="home-host-count">{savedSessions.length}</span>
          </div>
          {visibleHosts.length ? (
            <div className="home-host-list">
              {visibleHosts.map(session => {
                const existing = matchingTab(session);
                const protocol = (session.protocol || 'ssh').toUpperCase();
                return (
                  <button type="button" className="home-host-row" key={session.id || `${session.username}@${session.host}`} onClick={() => openHost(session)}>
                    <span className="home-host-icon"><Server size={18} /></span>
                    <span className="home-host-main"><strong>{session.alias || session.host || t('connection.protocol.local')}</strong><small>{session.protocol === 'local' ? t('connection.systemShell') : `${session.username ? `${session.username}@` : ''}${session.host}:${session.port || (session.protocol === 'telnet' ? 23 : 22)}`}</small></span>
                    {session.group && <span className="home-host-group">{session.group}</span>}
                    <span className="home-host-protocol">{protocol}</span>
                    <span className="home-host-action">{existing ? t('welcome.home.switchTab') : t('welcome.home.connect')} <ArrowRight size={15} /></span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="home-empty">
              <Server size={20} aria-hidden="true" />
              <span><strong>{t('welcome.home.noHosts')}</strong><small>{t('welcome.home.noHostsDetail')}</small></span>
              <button type="button" className="home-new" onClick={() => createSession()}>{t('welcome.home.addHost')} <ArrowRight size={14} /></button>
            </div>
          )}
          {savedSessions.length > visibleHosts.length && <p className="home-host-more">{t('welcome.home.moreInSidebar', { count: savedSessions.length - visibleHosts.length })}</p>}
        </section>
        </div>

        <aside className="home-context" aria-label={t('welcome.home.workspaceOverview')}>
          <section className="home-context-section" aria-labelledby="home-workspace-title">
            <h2 id="home-workspace-title"><Layers3 size={16} aria-hidden="true" />{t('welcome.home.currentWorkspace')}</h2>
            <strong className="home-workspace-name">{workspaceName}</strong>
            <p>{t(activeWorkspace?.isMain ? 'welcome.home.mainWorkspace' : 'welcome.home.separateWorkspace')}</p>
            <button type="button" className="home-context-link" onClick={openWorkspace}>{t('welcome.home.manageWorkspace')}<ArrowRight size={14} /></button>
          </section>

          <section className="home-context-section" aria-labelledby="home-security-title">
            <h2 id="home-security-title"><ShieldCheck size={16} aria-hidden="true" />{t('settings.secureCenter')}</h2>
            <div className="home-status-row"><span>{t('welcome.home.processSupervision')}</span><strong className="home-status-pill" data-testid="home-supervisor-state" data-tone={supervisorHealthy ? 'ok' : supervisorWarning ? 'warn' : 'neutral'}>{t(`welcome.home.${supervisorLabel}`)}</strong></div>
            <div className="home-status-row"><span><LockKeyhole size={13} aria-hidden="true" />{t('welcome.home.passwordProtection')}</span><strong className="home-status-pill" data-testid="home-protection-state" data-tone={scope?.protected ? 'ok' : scope?.protected === false ? 'warn' : 'neutral'}>{t(`welcome.home.${protectionLabel}`)}</strong></div>
            <p>{t('welcome.home.securityScope')}</p>
            <button type="button" className="home-context-link" onClick={openSecurity}>{t('welcome.home.reviewSecurity')}<ArrowRight size={14} /></button>
          </section>

          <section className="home-context-section" aria-labelledby="home-terminals-title">
            <h2 id="home-terminals-title"><SquareTerminal size={16} aria-hidden="true" />{t('welcome.home.terminalOverview')}</h2>
            <p>{t(panes.length ? 'welcome.home.terminalScope' : 'welcome.home.noTerminals')}</p>
            <dl className="home-terminal-breakdown">
              <div><dt>{t('welcome.home.remotePanels')}</dt><dd>{remoteCount}</dd></div>
              <div><dt>{t('welcome.home.localPanels')}</dt><dd>{localCount}</dd></div>
              <div data-attention={disconnectedCount > 0}><dt>{t('welcome.home.disconnectedPanels')}</dt><dd data-testid="home-disconnected-count">{disconnectedCount}</dd></div>
            </dl>
          </section>
        </aside>
        </div>
      </div>
    </main>
  );
};
