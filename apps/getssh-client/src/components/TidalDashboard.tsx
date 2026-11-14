import React, { useEffect, useMemo, useState } from 'react';
import { unlockActiveWorkspaceWithPassword, unlockActiveWorkspaceWithPresence } from '../lib/workspaceUnlock';
import { useTranslation } from 'react-i18next';
import { ArrowRight, CornerDownLeft, Layers3, Plus, Search, Server, ShieldAlert, SquareTerminal } from 'lucide-react';

import { useAppStore } from '../store/appStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useCryptoStore } from '../store/cryptoStore';
import { isSSHConfig, savedProfiles, useSessionStore, type PaneLeaf, type PaneNode, type SessionProfile, type Tab } from '../store/sessionStore';
import type { SecurityStatus } from '../types/ipc';
import { CryptoModal } from './CryptoModal';
import { HomeHostMap } from './HomeHostMap';
import { HostOsIcon } from './HostOsIcon';
import { lookupIpCountry } from '../utils/ipCountry';
import { getSentinelSupervisorState } from '../utils/sentinelSupervisorState';
import logo from '../assets/logo.png';
import './TidalDashboard.css';

interface TidalDashboardProps {
  onConnect?: (session: SessionProfile) => void;
  resumeTabId?: string | null;
  navigation?: React.ReactNode;
  assets?: React.ReactNode;
  sessionTabs?: React.ReactNode;
  notice?: React.ReactNode;
}

const terminalPanes = (node: PaneNode): PaneLeaf[] => node.type === 'leaf'
  ? node.paneType === 'terminal' ? [node] : []
  : node.children.flatMap(terminalPanes);

const formatAddress = (profile: SessionProfile, defaultPort: number) => {
  const host = profile.host.trim();
  const hostname = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const user = profile.username ? `${profile.username}@` : '';
  return `${user}${hostname}:${profile.port || (profile.protocol === 'telnet' ? 23 : defaultPort)}`;
};

/** Workspace overview and work entry points, using current layout and protection metadata. */
export const TidalDashboard: React.FC<TidalDashboardProps> = ({ onConnect, resumeTabId, navigation, assets, sessionTabs, notice }) => {
  const { t, i18n } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const isMac = useAppStore(state => state.isMac);
  const isFullScreen = useAppStore(state => state.isFullScreen);
  const setIsCommandCenterOpen = useAppStore(state => state.setIsCommandCenterOpen);
  const sentinelStatus = useAppStore(state => state.sentinelStatus);
  const sentinelStatusError = useAppStore(state => state.sentinelStatusError);
  const defaultPort = useAppStore(state => state.appConfig.defaultPort) || 22;

  const workspaces = useWorkspaceStore(state => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const isVaultLocked = useWorkspaceStore(state => state.isVaultLocked);
  const isSwitching = useWorkspaceStore(state => state.isSwitching);

  const cryptoMode = useCryptoStore(state => state.cryptoMode);
  const setCryptoMode = useCryptoStore(state => state.setCryptoMode);
  const workspaceUnprotected = useCryptoStore(state => state.workspaceUnprotected);

  const sessions = useSessionStore(state => state.sessions);
  const profilesWorkspaceId = useSessionStore(state => state.profilesWorkspaceId);
  const tabs = useSessionStore(state => state.tabs);
  const setActiveTabId = useSessionStore(state => state.setActiveTabId);

  const [time, setTime] = useState(new Date());
  const [greetingChoice] = useState(() => Math.random());
  const [quickAddress, setQuickAddress] = useState('');
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [protectionMetadata, setProtectionMetadata] = useState<{ workspaceId: string; status: SecurityStatus | null } | null>(null);
  const profilesReady = !isVaultLocked && !isSwitching && profilesWorkspaceId === activeWorkspaceId;
  const savedSessions = useMemo(() => profilesReady
    ? savedProfiles(sessions).filter(profile => profile.protocol === 'local' || Boolean(profile.host?.trim()))
    : [], [profilesReady, sessions]);
  const [countries, setCountries] = useState<{ profiles: SessionProfile[]; codes: Map<string, string | null> } | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setSearch('');
    setGroup(null);
    setSelectedId(null);
    setQuickAddress('');
  }, [activeWorkspaceId, isVaultLocked]);

  useEffect(() => {
    let active = true;
    const hosts = new Set(savedSessions.filter(profile => profile.protocol !== 'local').map(profile => profile.host.trim()));
    if (hosts.size === 0) {
      setCountries(null);
      return;
    }
    void Promise.all(Array.from(hosts, async host => [host, await lookupIpCountry(host).catch(() => null)] as const))
      .then(entries => {
        if (active) setCountries({ profiles: savedSessions, codes: new Map(entries) });
      });
    return () => { active = false; };
  }, [savedSessions]);

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

  const workspaceTabs = tabs.filter(tab => !tab.isTornOff && (tab.workspaceId ?? activeWorkspaceId) === activeWorkspaceId);
  const resumeTab = workspaceTabs.find(tab => tab.id === resumeTabId && tab.paneTree);
  const panes = workspaceTabs.flatMap(tab => tab.paneTree ? terminalPanes(tab.paneTree) : []);
  const disconnectedCount = panes.filter(pane => pane.isDisconnected === true).length;
  const scope = protectionMetadata?.workspaceId === activeWorkspaceId
    ? protectionMetadata.status?.scopes.find(item => item.workspaceId === activeWorkspaceId)
    : undefined;
  const protectionLabel = !scope ? 'unconfirmed' : !scope.protected ? 'passwordNotSet'
    : scope.ownPassword ? 'workspacePassword' : 'masterPassword';
  const supervisor = getSentinelSupervisorState(sentinelStatus, sentinelStatusError);
  const supervisorWarning = supervisor.tone === 'warn';

  const regionNames = new Intl.DisplayNames(i18n.language || 'en', { type: 'region' });
  const countryCodes = countries?.profiles === savedSessions ? countries.codes : undefined;
  const hosts = savedSessions.map((profile, index) => {
    const local = profile.protocol === 'local';
    const countryCode = local ? null : countryCodes?.get(profile.host.trim()) ?? null;
    return {
      id: profile.id || `profile-${index}`,
      profile,
      local,
      countryCode,
      country: countryCode ? regionNames.of(countryCode) || countryCode : '',
      name: profile.alias || profile.host || t('connection.protocol.local'),
      address: local ? t('connection.systemShell') : formatAddress(profile, defaultPort),
      group: profile.group?.trim() || '',
    };
  });
  const groups = Array.from(new Set(hosts.map(host => host.group)));
  const activeGroup = group !== null && groups.includes(group) ? group : null;
  const query = search.trim().toLocaleLowerCase();
  const visibleHosts = hosts.filter(host => (activeGroup === null || host.group === activeGroup)
    && [host.name, host.address, host.group, host.country, host.countryCode].some(value => value?.toLocaleLowerCase().includes(query)));
  const selection = visibleHosts.find(host => host.id === selectedId) ?? visibleHosts[0];

  const createSession = (address = '') => {
    window.dispatchEvent(new CustomEvent('app:create-session', { detail: address.trim() }));
  };

  const openSecurity = () => {
    window.dispatchEvent(new CustomEvent('app:open-center', {
      detail: { type: 'settings', title: t('statusBar.settings'), settingsTab: 'Security' },
    }));
  };

  const openWorkspace = () => window.dispatchEvent(new CustomEvent('app:open-center', {
    detail: { type: 'workspace', title: t('welcome.dashboard.workspaceCenter'), workspacePage: 'all' },
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

  const groupedHosts = new Map<string, typeof visibleHosts>();
  for (const host of visibleHosts) {
    const items = groupedHosts.get(host.group);
    if (items) items.push(host);
    else groupedHosts.set(host.group, [host]);
  }
  const groupName = (value: string) => value || t('welcome.home.ungrouped');
  const locating = hosts.some(host => !host.local) && !countryCodes;

  return (
    <main className="home-shell" data-window-controls={isFullScreen ? undefined : isMac ? 'mac' : 'windows'}>
      <header className="home-header drag-region">
        <div className="home-brand"><img src={logo} width="27" height="27" alt="" /><strong>GETSSH</strong></div>
        <label className="home-search no-drag-region">
          <Search size={15} aria-hidden="true" />
          <input type="search" value={search} onChange={event => setSearch(event.target.value)}
            aria-label={t('welcome.home.hostSearch')} placeholder={t('welcome.home.hostSearch')} />
        </label>
        <button type="button" className="home-new" disabled={isSwitching} onClick={() => createSession()}>
          <Plus size={16} aria-hidden="true" />{t('welcome.home.addHost')}
        </button>
        <button type="button" className="home-workspace" onClick={openWorkspace} title={workspaceName}
          aria-label={`${t('welcome.home.currentWorkspace')} · ${workspaceName}`}>
          <Layers3 size={16} aria-hidden="true" /><strong>{workspaceName}</strong>
        </button>
      </header>
      {notice}
      <div className="home-frame" data-with-navigation={!!navigation}>
        {navigation}
        <div className="home-content no-drag-region">
          {sessionTabs && <div className="home-session-tabs">{sessionTabs}</div>}
          <div className="home-scroll">
            <div className="home-inner">
              <div className="home-dashboard-grid">
                <section className="home-hosts" aria-labelledby="home-hosts-title">
                  <div className="home-intro">
                    <h1 id="home-hosts-title">{t('welcome.home.myHosts')}</h1>
                    <p className="home-greeting">{greeting}</p>
                    <p className="home-date">{dateString} · {timeString}</p>
                  </div>

                  <div className="home-filters" role="group" aria-label={t('welcome.home.hostGroups')}>
                    <button type="button" aria-pressed={activeGroup === null} onClick={() => setGroup(null)}>
                      {t('welcome.home.allHosts')} <span>{hosts.length}</span>
                    </button>
                    {groups.map(value => (
                      <button type="button" key={value} aria-pressed={activeGroup === value} onClick={() => setGroup(value)}>{groupName(value)}</button>
                    ))}
                  </div>

                  {!profilesReady ? <p className="home-empty" role="status">{t('welcome.home.loadingHosts')}</p> : (
                    visibleHosts.length > 0 ? Array.from(groupedHosts, ([name, items]) => (
                      <section key={name} className="home-host-group" aria-label={groupName(name)}>
                        <h2>{groupName(name)}</h2>
                        <ul className="home-host-list">
                          {items.map(host => (
                            <li key={host.id} className="home-host-row" data-selected={selection?.id === host.id}>
                              <button type="button" className="home-host-select" aria-pressed={selection?.id === host.id}
                                onClick={() => setSelectedId(host.id)}>
                                <HostOsIcon osType={host.profile.osType} />
                                <span className="home-host-main"><strong title={host.name}>{host.name}</strong><small title={host.address}>{host.address}</small></span>
                                {!host.local && <small className="home-host-country" title={host.country || undefined}>
                                  {host.country || t(locating ? 'welcome.home.checking' : 'welcome.home.map.unknown')}
                                </small>}
                              </button>
                              <button type="button" className="home-host-open" onClick={() => openHost(host.profile)}>
                                {t(matchingTab(host.profile) ? 'welcome.home.switchTab' : 'welcome.home.connect')}
                                <span className="sr-only"> {host.name}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </section>
                    )) : (
                      <div className="home-empty" role="status">
                        <Server size={19} aria-hidden="true" />
                        <span>{t(hosts.length ? 'welcome.home.noMatchingHosts' : 'welcome.home.noHosts')}</span>
                      </div>
                    )
                  )}

                  {resumeTab && (
                    <button type="button" className="home-resume" onClick={() => setActiveTabId(resumeTab.id)}>
                      <SquareTerminal size={17} aria-hidden="true" />
                      <span>{t('welcome.home.continueWork')} <strong>{resumeTab.title}</strong></span>
                      <ArrowRight size={15} aria-hidden="true" />
                    </button>
                  )}

                  <form className="home-connect" onSubmit={event => {
                    event.preventDefault();
                    if (!isSwitching && quickAddress.trim()) createSession(quickAddress);
                  }}>
                    <label htmlFor="home-quick-address">{t('welcome.home.quickConnect')}</label>
                    <div className="home-connect-input-row">
                      <input id="home-quick-address" className="home-connect-input" value={quickAddress}
                        onChange={event => setQuickAddress(event.target.value)} placeholder="ssh://user@host:22"
                        aria-label={t('welcome.home.addressLabel')} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
                      <button type="submit" className="home-connect-submit" disabled={isSwitching || !quickAddress.trim()}>
                        {t('welcome.home.configureConnect')}<CornerDownLeft size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </form>
                </section>

                <HomeHostMap hosts={visibleHosts.filter(host => !host.local)} selectedId={selection?.id ?? null}
                  onSelect={setSelectedId} loading={!profilesReady || locating} />
              </div>

              {(supervisorWarning || scope?.protected === false) && (
                <button type="button" className="home-attention" onClick={openSecurity}
                  title={supervisorWarning ? sentinelStatusError || sentinelStatus?.reason || undefined : t('welcome.home.noPasswordDetail')}>
                  <ShieldAlert size={15} aria-hidden="true" />
                  <span>{t(supervisorWarning ? 'welcome.home.sentinelIssue' : 'welcome.home.vaultOff')}</span>
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
              )}

              <dl className="home-summary" aria-label={t('welcome.home.workspaceOverview')}>
                <div><dt>{t('welcome.home.savedConnections')}</dt><dd data-testid="home-saved-count">{profilesReady ? hosts.length : '—'}</dd></div>
                <div><dt>{t('welcome.home.terminalPanels')}</dt><dd data-testid="home-terminal-count">{panes.length}</dd></div>
                <div><dt>{t('welcome.home.disconnectedPanels')}</dt><dd data-testid="home-disconnected-count">{disconnectedCount}</dd></div>
                <div><dt>{t('welcome.home.workspaces')}</dt><dd data-testid="home-workspace-count">{workspaces.length}</dd></div>
                <div><dt>{t('welcome.home.processSupervision')}</dt><dd data-testid="home-supervisor-state" data-tone={supervisor.tone}>{t(`welcome.home.${supervisor.label}`)}</dd></div>
                <div><dt>{t('welcome.home.passwordProtection')}</dt><dd data-testid="home-protection-state" data-tone={scope?.protected ? 'ok' : scope?.protected === false ? 'warn' : 'neutral'}>{t(`welcome.home.${protectionLabel}`)}</dd></div>
              </dl>
            </div>
          </div>
          {assets && <aside className="home-asset-drawer" aria-label={t('assetFolders.assets')}>{assets}</aside>}
        </div>
      </div>
    </main>
  );
};
