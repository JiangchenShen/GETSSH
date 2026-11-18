import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { unlockActiveWorkspaceWithPassword, unlockActiveWorkspaceWithPresence } from '../lib/workspaceUnlock';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Layers3, Plus, Search, Server, Shield } from 'lucide-react';

import { useAppStore } from '../store/appStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useCryptoStore } from '../store/cryptoStore';
import { callTidal, isSSHConfig, savedProfiles, useSessionStore, type PaneLeaf, type PaneNode, type SessionProfile } from '../store/sessionStore';
import type { SecurityStatus } from '../types/ipc';
import { CryptoModal } from './CryptoModal';
import { HomeHostMap } from './HomeHostMap';
import { HostOsIcon } from './HostOsIcon';
import { lookupIpCountry } from '../utils/ipCountry';
import { findZoomedPane, updateLeafInTree } from '../utils/paneHelpers';
import logo from '../assets/logo.png';
import './TidalDashboard.css';

interface TidalDashboardProps {
  onConnect?: (session: SessionProfile) => void;
  onEdit?: (session: SessionProfile) => void;
  navigation?: React.ReactNode;
  assets?: React.ReactNode;
  notice?: React.ReactNode;
}

const formatAddress = (profile: SessionProfile, defaultPort: number) => {
  const host = profile.host.trim();
  const hostname = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const user = profile.username ? `${profile.username}@` : '';
  return `${user}${hostname}:${profile.port || (profile.protocol === 'telnet' ? 23 : defaultPort)}`;
};

function findProfilePane(node: PaneNode, profileId: string, workspaceId: string): PaneLeaf | null {
  if (node.type !== 'leaf') {
    return findProfilePane(node.children[0], profileId, workspaceId) ?? findProfilePane(node.children[1], profileId, workspaceId);
  }
  return node.paneType === 'terminal' && isSSHConfig(node.config) && node.config.profileId === profileId
    && node.config.workspaceId === workspaceId ? node : null;
}

/** Workspace overview and work entry points, using current layout and protection metadata. */
export const TidalDashboard: React.FC<TidalDashboardProps> = ({ onConnect, onEdit, navigation, assets, notice }) => {
  const { t, i18n } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const isMac = useAppStore(state => state.isMac);
  const isFullScreen = useAppStore(state => state.isFullScreen);
  const setIsCommandCenterOpen = useAppStore(state => state.setIsCommandCenterOpen);
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
  const setActivePaneId = useSessionStore(state => state.setActivePaneId);
  const setTabs = useSessionStore(state => state.setTabs);
  const connecting = useSessionStore(state => state.connecting);
  const error = useSessionStore(state => state.error);

  const [search, setSearch] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [attempted, setAttempted] = useState<{ id: string; workspaceId: string } | null>(null);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const workspaceButton = useRef<HTMLButtonElement>(null);
  const workspaceMenuId = useId();
  const rows = useRef(new Map<string, HTMLLIElement>());
  const [protectionMetadata, setProtectionMetadata] = useState<{ workspaceId: string; status: SecurityStatus | null } | null>(null);
  const profilesReady = !isVaultLocked && !isSwitching && profilesWorkspaceId === activeWorkspaceId;
  const savedSessions = useMemo(() => profilesReady
    ? savedProfiles(sessions).filter(profile => profile.protocol === 'local' || Boolean(profile.host?.trim()))
    : [], [profilesReady, sessions]);
  const [countries, setCountries] = useState<{ profiles: SessionProfile[]; codes: Map<string, string | null> } | null>(null);

  useEffect(() => {
    setSearch('');
    setGroup(null);
    setSelectedId(null);
    setAttempted(null);
    setWorkspaceMenuOpen(false);
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

  const workspaceName = activeWorkspace?.name || activeWorkspaceId;

  const scope = protectionMetadata?.workspaceId === activeWorkspaceId
    ? protectionMetadata.status?.scopes.find(item => item.workspaceId === activeWorkspaceId)
    : undefined;
  const protectionLabel = !scope ? 'unconfirmed' : !scope.protected ? 'passwordNotSet'
    : scope.ownPassword ? 'workspacePassword' : 'masterPassword';

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
  const groups = new Map<string, number>();
  for (const host of hosts) groups.set(host.group, (groups.get(host.group) ?? 0) + 1);
  const activeGroup = group !== null && groups.has(group) ? group : null;
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

  const openTabs = tabs.filter(tab => !tab.isTornOff && tab.workspaceId === activeWorkspaceId && tab.paneTree);
  const matchingPane = (session: SessionProfile) => {
    if (!session.id) return;
    for (const tab of openTabs) {
      const pane = findProfilePane(tab.paneTree!, session.id, activeWorkspaceId);
      if (pane) return { tab, pane };
    }
  };

  const openHost = (host: typeof hosts[number], existing: ReturnType<typeof matchingPane>) => {
    if (existing) {
      const { tab, pane } = existing;
      const zoomed = findZoomedPane(tab.paneTree!);
      if (zoomed && zoomed.paneId !== pane.paneId) {
        setTabs(tabs.map(item => item.id === tab.id
          ? { ...item, paneTree: updateLeafInTree(tab.paneTree!, zoomed.paneId, { isZoomed: false }) }
          : item));
        void callTidal('reveal host pane', window.electronAPI.tidalToggleZoom(zoomed.paneId));
      }
      setActiveTabId(tab.id);
      setActivePaneId(pane.paneId);
      return;
    }
    if (onConnect) {
      setAttempted({ id: host.id, workspaceId: activeWorkspaceId });
      onConnect(host.profile);
    } else setIsCommandCenterOpen(true);
  };

  const selectOnMap = (id: string) => {
    setSelectedId(id);
    rows.current.get(id)?.scrollIntoView({ block: 'nearest' });
  };

  const groupedHosts = new Map<string, typeof visibleHosts>();
  for (const host of visibleHosts) {
    const items = groupedHosts.get(host.group);
    if (items) items.push(host);
    else groupedHosts.set(host.group, [host]);
  }
  const groupName = (value: string) => value || t('welcome.home.ungrouped');
  const locating = hosts.some(host => !host.local) && !countryCodes;
  const attemptedHost = attempted?.workspaceId === activeWorkspaceId ? hosts.find(host => host.id === attempted.id) : undefined;

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
        <div className="home-workspace-control no-drag-region"
          onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setWorkspaceMenuOpen(false); }}
          onKeyDown={event => {
            if (event.key !== 'Escape' || !workspaceMenuOpen) return;
            event.stopPropagation();
            setWorkspaceMenuOpen(false);
            workspaceButton.current?.focus();
          }}>
          <button type="button" ref={workspaceButton} className="home-workspace" title={workspaceName}
            aria-label={`${t('welcome.home.currentWorkspace')} · ${workspaceName}`}
            aria-expanded={openTabs.length ? workspaceMenuOpen : undefined}
            aria-controls={workspaceMenuOpen && openTabs.length ? workspaceMenuId : undefined}
            disabled={isSwitching} onClick={() => openTabs.length ? setWorkspaceMenuOpen(!workspaceMenuOpen) : openWorkspace()}>
            <Layers3 size={16} aria-hidden="true" /><strong className="ui-section-enter" key={activeWorkspaceId}>{workspaceName}</strong>
            {openTabs.length > 0 && <ChevronDown size={12} aria-hidden="true" />}
          </button>
          {workspaceMenuOpen && openTabs.length > 0 && (
            <div id={workspaceMenuId} className="home-workspace-menu">
              <button type="button" onClick={openWorkspace}>{t('welcome.home.manageWorkspace')}</button>
              <div className="home-open-tabs" role="group" aria-label={t('welcome.home.openTabs')}>
                <span>{t('welcome.home.openTabs')}</span>
                {openTabs.map(tab => <button type="button" key={tab.id} title={tab.title} onClick={() => setActiveTabId(tab.id)}>{tab.title}</button>)}
              </div>
            </div>
          )}
        </div>
      </header>
      {notice}
      <div className="home-frame" data-with-navigation={!!navigation}>
        {navigation}
        <div className="home-content no-drag-region">
          <div className="home-scroll">
            <div className="home-inner">
              <div className="home-dashboard-grid">
                <section className="home-hosts" aria-labelledby="home-hosts-title">
                  <div className="home-intro">
                    <p className="home-eyebrow">{t('welcome.home.hostEyebrow')}</p>
                    <h1 id="home-hosts-title">{t('welcome.home.myHosts')}</h1>
                    <p className="home-description">{t('welcome.home.hostDescription')}</p>
                  </div>

                  <div className="home-filters" role="group" aria-label={t('welcome.home.hostGroups')}>
                    <button type="button" aria-pressed={activeGroup === null} onClick={() => setGroup(null)}>
                      {t('welcome.home.allHosts')} <span>{hosts.length}</span>
                    </button>
                    {Array.from(groups, ([value, count]) => (
                      <button type="button" key={value} aria-pressed={activeGroup === value} onClick={() => setGroup(value)}>
                        {groupName(value)} <span>{count}</span>
                      </button>
                    ))}
                  </div>
                  {attemptedHost && !connecting && error && (
                    <p className="home-connect-error" role="alert"><strong>{attemptedHost.name}</strong> · {error}</p>
                  )}

                  {!profilesReady ? <p className="home-empty" role="status">{t('welcome.home.loadingHosts')}</p> : (
                    <div className="ui-section-enter" key={JSON.stringify([activeWorkspaceId, activeGroup])}>
                    {visibleHosts.length > 0 ? Array.from(groupedHosts, ([name, items]) => (
                      <section key={name} className="home-host-group" aria-label={groupName(name)}>
                        <h2>{groupName(name)} · {items.length}</h2>
                        <ul className="home-host-list">
                          {items.map(host => {
                            const existing = matchingPane(host.profile);
                            const pending = connecting && attemptedHost?.id === host.id;
                            return (
                              <li key={host.id} className="home-host-row" data-selected={selection?.id === host.id}
                                ref={element => {
                                  if (element) rows.current.set(host.id, element);
                                  else rows.current.delete(host.id);
                                }}>
                                <button type="button" className="home-host-select" aria-pressed={selection?.id === host.id}
                                  onClick={() => setSelectedId(host.id)}>
                                  <HostOsIcon osType={host.profile.osType} />
                                  <span className="home-host-main"><strong title={host.name}>{host.name}</strong><small title={host.address}>{host.address}</small></span>
                                  {!host.local && <small className="home-host-country" title={host.country || undefined}>
                                    {host.countryCode && <span className="home-country-flag" aria-hidden="true">{Array.from(host.countryCode, character => String.fromCodePoint(127397 + character.charCodeAt(0))).join('')}</span>}
                                    {host.country || t(locating ? 'welcome.home.checking' : 'welcome.home.map.unknown')}
                                  </small>}
                                </button>
                                <button type="button" className="home-host-open" disabled={connecting || isSwitching}
                                  onClick={() => openHost(host, existing)}>
                                  {t(pending ? 'connection.connecting' : existing ? 'welcome.home.switchTab' : 'welcome.home.connect')}
                                  <span className="sr-only"> {host.name}</span>
                                </button>
                                {onEdit && <button type="button" className="home-host-edit" disabled={connecting || isSwitching}
                                  onClick={() => onEdit(host.profile)}>
                                  {t('welcome.home.editHost')}<span className="sr-only"> {host.name}</span>
                                </button>}
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    )) : (
                      <div className="home-empty" role="status">
                        <Server size={19} aria-hidden="true" />
                        <span>{t(hosts.length ? 'welcome.home.noMatchingHosts' : 'welcome.home.noHosts')}</span>
                      </div>
                    )}
                    </div>
                  )}

                  <p className="home-host-total">{t('welcome.home.savedConnections')} <span data-testid="home-saved-count">{profilesReady ? hosts.length : '—'}</span></p>
                </section>

                <HomeHostMap hosts={visibleHosts.filter(host => !host.local)} selectedId={selection?.id ?? null}
                  onSelect={selectOnMap} loading={!profilesReady || locating} />
              </div>

              <footer className="home-footer">
                <span>GETSSH / {workspaceName}</span>
                <button type="button" className="home-protection" onClick={openSecurity}>
                  <Shield size={14} aria-hidden="true" />
                  {t('welcome.home.passwordProtection')} · <span data-testid="home-protection-state" data-tone={scope?.protected ? 'ok' : scope?.protected === false ? 'warn' : 'neutral'}>{t(`welcome.home.${protectionLabel}`)}</span>
                </button>
              </footer>
            </div>
          </div>
          {assets && <aside className="home-asset-drawer" aria-label={t('assetFolders.assets')}>{assets}</aside>}
        </div>
      </div>
    </main>
  );
};
