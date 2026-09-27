import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CornerDownLeft, Layers3, Plus, Server, ShieldAlert, SquareTerminal } from 'lucide-react';

import { useAppStore } from '../store/appStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useCryptoStore } from '../store/cryptoStore';
import { isSSHConfig, savedProfiles, useSessionStore, type PaneNode, type SessionProfile, type Tab } from '../store/sessionStore';
import { CryptoModal } from './CryptoModal';

interface NexusDashboardProps {
  onConnect?: (session: SessionProfile) => void;
  resumeTabId?: string | null;
}

/** The home screen is a starting point, not a telemetry dashboard. */
export const NexusDashboard: React.FC<NexusDashboardProps> = ({ onConnect, resumeTabId }) => {
  const { t, i18n } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const setIsCommandCenterOpen = useAppStore(state => state.setIsCommandCenterOpen);
  const watchdogStatus = useAppStore(state => state.watchdogStatus);
  const pollWatchdogStatus = useAppStore(state => state.pollWatchdogStatus);

  const workspaces = useWorkspaceStore(state => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const isVaultLocked = useWorkspaceStore(state => state.isVaultLocked);

  const cryptoMode = useCryptoStore(state => state.cryptoMode);
  const setCryptoMode = useCryptoStore(state => state.setCryptoMode);
  const encryptionDisabled = useCryptoStore(state => state.encryptionDisabled);
  const setEncryptionDisabled = useCryptoStore(state => state.setEncryptionDisabled);
  const masterPassword = useCryptoStore(state => state.masterPassword);
  const setMasterPassword = useCryptoStore(state => state.setMasterPassword);

  const sessions = useSessionStore(state => state.sessions);
  const setSessions = useSessionStore(state => state.setSessions);
  const tabs = useSessionStore(state => state.tabs);
  const setActiveTabId = useSessionStore(state => state.setActiveTabId);

  const [time, setTime] = useState(new Date());
  const [quickAddress, setQuickAddress] = useState('');

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    pollWatchdogStatus();
  }, [pollWatchdogStatus]);

  const handleUnlock = async (password: string) => {
    const profiles = await window.electronAPI.unlockProfiles(password);
    if (!profiles) return false;
    setMasterPassword(password);
    setSessions(profiles);
    setCryptoMode('idle');
    useWorkspaceStore.setState({ isVaultLocked: false, isUnlockModalOpen: false });
    return true;
  };

  const handleSetup = async (password: string) => {
    setEncryptionDisabled(false);
    setMasterPassword(password);
    const updatedSessions = savedProfiles(sessions).map(session => ({ ...session, password: session.password || '' }));
    await window.electronAPI.saveProfiles({ masterPassword: password, payload: updatedSessions, workspaceId: useWorkspaceStore.getState().activeWorkspaceId });
    setCryptoMode('idle');
  };

  const activeWorkspace = workspaces.find(workspace => workspace.id === activeWorkspaceId);
  if (isVaultLocked) {
    return (
      <div className="absolute inset-0 z-[100] h-full w-full overflow-hidden rounded-[32px]">
        <CryptoModal
          mode="locked"
          isDark={isDark}
          encryptionDisabled={encryptionDisabled}
          onUnlock={handleUnlock}
          onSetup={handleSetup}
          onSkip={cryptoMode === 'setup' ? () => setCryptoMode('idle') : undefined}
          onCancel={cryptoMode === 'setup' && sessions.length === 0 && !masterPassword ? undefined : () => {
            if (cryptoMode === 'setup') {
              setEncryptionDisabled(true);
              window.electronAPI.saveProfiles({ masterPassword: '', payload: savedProfiles(sessions), workspaceId: useWorkspaceStore.getState().activeWorkspaceId })
                .catch((err) => console.error('[NexusDashboard] Failed to save profiles without encryption:', err));
            }
            setCryptoMode('idle');
          }}
          onRetryBiometric={activeWorkspace?.biometricEnabled ? async () => {
            // The main process shows the OS prompt (Touch ID) before it releases the password.
            const biometricResult = await window.electronAPI.promptBiometricUnlock();
            if (biometricResult.success && biometricResult.masterPassword) {
              try {
                const decrypted = await window.electronAPI.unlockProfiles(biometricResult.masterPassword);
                setMasterPassword(biometricResult.masterPassword);
                setSessions(decrypted);
                setCryptoMode('idle');
                useWorkspaceStore.setState({ isVaultLocked: false, isUnlockModalOpen: false });
              } catch (error) {
                console.warn('Biometric unlock failed:', error);
              }
            }
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
  const greeting = Array.isArray(greetingValue) ? greetingValue[0] : greetingValue;
  const dateString = new Intl.DateTimeFormat(i18n.language || undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  }).format(time);
  const timeString = new Intl.DateTimeFormat(i18n.language || undefined, {
    hour: '2-digit', minute: '2-digit',
  }).format(time);
  const workspaceName = activeWorkspace?.name || activeWorkspaceId;

  const savedSessions = sessions.filter(session => !session.isDraft && (session.protocol === 'local' || Boolean(session.host?.trim())));
  const visibleHosts = savedSessions.slice(0, 4);
  const resumeTab = tabs.find(tab => tab.id === resumeTabId && !tab.isTornOff && tab.paneTree);
  const watchdogNeedsAttention = !!watchdogStatus && (watchdogStatus.status !== 'secure' || watchdogStatus.watchdogDisabled);

  const createSession = (address = '') => {
    window.dispatchEvent(new CustomEvent('app:create-session', { detail: address.trim() }));
  };

  const openSecurity = () => {
    window.dispatchEvent(new CustomEvent('app:open-center', {
      detail: { type: 'settings', title: t('statusBar.settings'), settingsTab: 'Security' },
    }));
  };

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
              <span>{workspaceName}</span>
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

        {encryptionDisabled && (
          <button type="button" className="home-alert" onClick={openSecurity}>
            <ShieldAlert size={18} aria-hidden="true" />
            <span><strong>{t('welcome.home.vaultOff')}</strong><small>{t('welcome.dashboard.metrics.vaultOffDetail')}</small></span>
            <span className="home-alert-action">{t('welcome.home.reviewSecurity')} <ArrowRight size={14} /></span>
          </button>
        )}
        {watchdogNeedsAttention && (
          <button type="button" className="home-alert" onClick={openSecurity}>
            <ShieldAlert size={18} aria-hidden="true" />
            <span><strong>{t('welcome.home.watchdogIssue')}</strong><small>{watchdogStatus?.reason || t('statusBar.wdBad')}</small></span>
            <span className="home-alert-action">{t('welcome.home.reviewSecurity')} <ArrowRight size={14} /></span>
          </button>
        )}

        <section className="home-connect" aria-labelledby="home-connect-title">
          <div className="home-connect-head">
            <div>
              <p className="home-eyebrow">01 / {t('welcome.home.start')}</p>
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
              <div><p className="home-eyebrow">02 / {t('welcome.home.continue')}</p><h2 id="home-resume-title">{t('welcome.home.continueWork')}</h2></div>
            </div>
            <button type="button" className="home-resume" onClick={() => setActiveTabId(resumeTab.id)}>
              <span className="home-resume-icon">{isSSHConfig(resumeTab.config) ? <SquareTerminal size={19} /> : <Layers3 size={19} />}</span>
              <span className="home-host-main"><strong>{resumeTab.title}</strong><small>{isSSHConfig(resumeTab.config) ? `${resumeTab.config.username}@${resumeTab.config.host}` : t('welcome.home.openTab')}</small></span>
              <span className="home-host-action">{t('welcome.home.returnToTab')} <ArrowRight size={15} /></span>
            </button>
          </section>
        )}

        <section className="home-section" aria-labelledby="home-hosts-title">
          <div className="home-section-title">
            <div>
              <p className="home-eyebrow">{resumeTab ? '03' : '02'} / {t('welcome.home.saved')}</p>
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
    </main>
  );
};
