import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  Activity,
  ArrowRight,
  Command,
  Layers3,
  Plus,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
} from 'lucide-react';

import { useAppStore } from '../store/appStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useCryptoStore } from '../store/cryptoStore';
import { isSSHConfig, useSessionStore, type SessionProfile } from '../store/sessionStore';
import { useAiStore } from '../store/aiStore';
import { CryptoModal } from './CryptoModal';
import { promptWebAuthn } from '../utils/webauthn';

type CenterType = 'ai' | 'plugin' | 'secure' | 'workspace' | 'settings';
type Accent = 'cyan' | 'emerald' | 'amber' | 'purple' | 'blue';

const ACCENTS: Record<Accent, { icon: string; wash: string; dot: string }> = {
  cyan: {
    icon: 'bg-cyan-500/12 text-cyan-500 dark:text-cyan-300 ring-cyan-500/20',
    wash: 'from-cyan-500/10 via-cyan-500/[0.025] to-transparent',
    dot: 'bg-cyan-400',
  },
  emerald: {
    icon: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-300 ring-emerald-500/20',
    wash: 'from-emerald-500/10 via-emerald-500/[0.025] to-transparent',
    dot: 'bg-emerald-400',
  },
  amber: {
    icon: 'bg-amber-500/12 text-amber-600 dark:text-amber-300 ring-amber-500/20',
    wash: 'from-amber-500/10 via-amber-500/[0.025] to-transparent',
    dot: 'bg-amber-400',
  },
  purple: {
    icon: 'bg-purple-500/12 text-purple-600 dark:text-purple-300 ring-purple-500/20',
    wash: 'from-purple-500/10 via-purple-500/[0.025] to-transparent',
    dot: 'bg-purple-400',
  },
  blue: {
    icon: 'bg-blue-500/12 text-blue-600 dark:text-blue-300 ring-blue-500/20',
    wash: 'from-blue-500/10 via-blue-500/[0.025] to-transparent',
    dot: 'bg-blue-400',
  },
};

/**
 * GETSSH operations dashboard.
 *
 * The page deliberately uses only real application state: saved profiles, open SSH
 * tabs, the Watchdog result, the selected AI model and the active workspace. It does
 * not invent latency, CPU or availability numbers that the backend does not expose.
 */
export const NexusDashboard: React.FC<{ onConnect?: (session: SessionProfile) => void }> = ({ onConnect }) => {
  const { t, i18n } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const isMac = useAppStore(state => state.isMac);
  const setIsCommandCenterOpen = useAppStore(state => state.setIsCommandCenterOpen);
  const watchdogStatus = useAppStore(state => state.watchdogStatus);
  const pollWatchdogStatus = useAppStore(state => state.pollWatchdogStatus);

  const workspaces = useWorkspaceStore(state => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);

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

  const aiModel = useAiStore(state => state.aiConfig.aiModel);
  const isVaultLocked = useWorkspaceStore(state => state.isVaultLocked);

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
    const updatedSessions = sessions.map(session => ({ ...session, password: session.password || '' }));
    await window.electronAPI.saveProfiles({ masterPassword: password, payload: updatedSessions });
    setCryptoMode('idle');
  };

  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // The dashboard is the first place that promises a security overview, so it must
  // request a real Watchdog snapshot instead of waiting for Secure Center to mount.
  useEffect(() => {
    pollWatchdogStatus();
  }, [pollWatchdogStatus]);

  if (isVaultLocked) {
    const activeWorkspace = workspaces.find(workspace => workspace.id === activeWorkspaceId);
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
              window.electronAPI.saveProfiles({ masterPassword: '', payload: sessions });
            }
            setCryptoMode('idle');
          }}
          onRetryBiometric={activeWorkspace?.biometricEnabled ? async () => {
            const webAuthnSuccess = await promptWebAuthn();
            if (!webAuthnSuccess) return;
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

  const timeParts = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).formatToParts(time);
  const timeString = timeParts
    .filter(part => part.type === 'hour' || part.type === 'minute' || (part.type === 'literal' && part.value.includes(':')))
    .map(part => part.value)
    .join('');
  const dayPeriod = timeParts.find(part => part.type === 'dayPeriod')?.value ?? '';
  const locale = i18n.language || undefined;
  const dateString = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(time);

  const getGreetingKey = () => {
    const hour = time.getHours();
    if (hour < 5) return 'midnight';
    if (hour < 9) return 'morning';
    if (hour < 12) return 'forenoon';
    if (hour < 14) return 'noon';
    if (hour < 18) return 'afternoon';
    if (hour < 22) return 'evening';
    return 'lateNight';
  };
  const greetingValue = t(`welcome.greeting.${getGreetingKey()}`, { returnObjects: true });
  const greeting = Array.isArray(greetingValue) ? greetingValue[0] : greetingValue;

  // Center tabs (AI, Settings, Plugins...) are tools, not SSH sessions. Counting them
  // as active hosts made the old dashboard report false connection activity.
  const sshTabs = tabs.filter(tab => !tab.isTornOff && isSSHConfig(tab.config));
  const visibleSshTabs = sshTabs.slice(0, 3);
  const openHostKeys = new Set(
    sshTabs.flatMap(tab => isSSHConfig(tab.config)
      ? [`${tab.config.username}@${tab.config.host}:${tab.config.port ?? 22}`]
      : [])
  );
  const addressOf = (session: SessionProfile) => `${session.username}@${session.host}`;
  const identityOf = (session: SessionProfile) => `${addressOf(session)}:${session.port ?? 22}`;
  const activeWorkspace = workspaces.find(workspace => workspace.id === activeWorkspaceId);
  const workspaceName = activeWorkspace?.name || activeWorkspaceId;
  const savedSessions = sessions.filter(session => !session.isDraft && (session.protocol === 'local' || Boolean(session.host?.trim())));
  const groupCount = new Set(savedSessions.map(session => session.group?.trim()).filter(Boolean)).size;
  const autoStartCount = savedSessions.filter(session => Boolean(session.autoStart)).length;
  const visibleHosts = savedSessions.slice(0, 5);
  const hiddenHostCount = Math.max(0, savedSessions.length - visibleHosts.length);

  const watchdogOkay = !!watchdogStatus
    && watchdogStatus.status === 'secure'
    && !watchdogStatus.watchdogDisabled;
  const securityPending = !watchdogStatus;
  const securityNeedsAttention = encryptionDisabled
    || (!!watchdogStatus && !watchdogOkay);
  const securityValue = encryptionDisabled
    ? t('welcome.dashboard.metrics.vaultOff')
    : !watchdogStatus
      ? t('welcome.dashboard.metrics.checking')
      : watchdogOkay
        ? t('welcome.dashboard.metrics.protected')
        : t('welcome.dashboard.metrics.attention');
  const securityDetail = encryptionDisabled
    ? t('welcome.dashboard.metrics.vaultOffDetail')
    : watchdogStatus
      ? `Watchdog · ${watchdogOkay ? t('statusBar.wdOk') : (watchdogStatus.reason || t('statusBar.wdBad'))}`
      : t('welcome.dashboard.metrics.watchdogPending');

  const connect = (session: SessionProfile) => {
    if (onConnect) onConnect(session);
    else setIsCommandCenterOpen(true);
  };

  const createSession = () => {
    window.dispatchEvent(new CustomEvent('app:create-session', { detail: '' }));
  };

  const openCenter = (type: CenterType, title: string) => {
    window.dispatchEvent(new CustomEvent('app:open-center', { detail: { type, title } }));
  };

  return (
    <div className="dashboard-shell drag-region relative h-full w-full overflow-hidden text-ink">
      <div className="dashboard-grid pointer-events-none absolute inset-0" />
      <div className="dashboard-orb dashboard-orb-cyan pointer-events-none absolute" />
      <div className="dashboard-orb dashboard-orb-purple pointer-events-none absolute" />

      <div className="no-drag-region relative z-10 h-full overflow-y-auto overflow-x-hidden">
        <div className="mx-auto flex min-h-full w-full max-w-[1480px] flex-col gap-4 px-5 py-5 2xl:px-7 2xl:py-6">
          <motion.header
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.33, 1, 0.68, 1] }}
            className="flex flex-wrap items-center justify-between gap-4 px-1"
          >
            <div className="min-w-0">
              <div className="mb-2 flex min-w-0 items-center gap-2.5 text-[10px] font-bold uppercase tracking-[0.2em] text-ink-3">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
                  <span
                    className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400"
                    style={activeWorkspace?.themeColor ? { backgroundColor: activeWorkspace.themeColor } : undefined}
                  />
                </span>
                <span>{t('welcome.dashboard.eyebrow')}</span>
                <span className="h-3 w-px bg-line" />
                <span className="truncate normal-case tracking-normal text-ink-2">{workspaceName}</span>
              </div>
              <h1 className="max-w-[660px] truncate text-[26px] font-bold tracking-[-0.025em] text-ink">
                {greeting}
              </h1>
              <p className="mt-1 text-[12.5px] text-ink-3">
                {t('welcome.dashboard.subtitle')}
              </p>
            </div>

            <div className="flex items-center gap-2.5">
              <div className="mr-1 hidden min-w-[92px] text-right sm:block">
                <div className="font-mono text-[22px] font-semibold leading-none tracking-[-0.04em] tabular-nums text-ink">
                  {timeString}
                  {dayPeriod && <span className="ml-1 text-[10px] font-medium tracking-normal text-ink-3">{dayPeriod}</span>}
                </div>
                <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">{dateString}</div>
              </div>
              <button
                type="button"
                onClick={() => setIsCommandCenterOpen(true)}
                className="dashboard-secondary-button group hidden h-10 items-center gap-2 px-3.5 lg:flex"
              >
                <Command className="h-4 w-4 text-blue-500 dark:text-blue-300" />
                <span>{t('welcome.dashboard.commandCenter')}</span>
                <kbd className="rounded-md border border-line bg-surf/70 px-1.5 py-0.5 font-mono text-[9px] text-ink-3">
                  {isMac ? '⌘K' : 'Ctrl K'}
                </kbd>
              </button>
              <button
                type="button"
                onClick={createSession}
                className="dashboard-primary-button h-10"
              >
                <Plus className="h-4 w-4" />
                <span>{t('welcome.dashboard.newConnection')}</span>
              </button>
            </div>
          </motion.header>

          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.06, ease: [0.33, 1, 0.68, 1] }}
            aria-label={t('welcome.dashboard.overview')}
            className="grid grid-cols-2 gap-3 lg:grid-cols-4"
          >
            <MetricCard
              accent="cyan"
              icon={<Server className="h-[18px] w-[18px]" />}
              label={t('welcome.dashboard.metrics.hosts')}
              value={String(savedSessions.length).padStart(2, '0')}
              detail={t('welcome.dashboard.metrics.hostsDetail', { groups: groupCount, autostart: autoStartCount })}
            />
            <MetricCard
              accent="blue"
              icon={<Activity className="h-[18px] w-[18px]" />}
              label={t('welcome.dashboard.metrics.sessions')}
              value={String(sshTabs.length).padStart(2, '0')}
              detail={t('welcome.dashboard.metrics.sessionsDetail')}
            />
            <MetricCard
              accent={securityPending ? 'cyan' : securityNeedsAttention ? 'amber' : 'emerald'}
              icon={securityPending
                ? <Activity className="h-[18px] w-[18px]" />
                : securityNeedsAttention
                  ? <ShieldAlert className="h-[18px] w-[18px]" />
                  : <ShieldCheck className="h-[18px] w-[18px]" />}
              label={t('welcome.dashboard.metrics.security')}
              value={securityValue}
              detail={securityDetail}
              compact
              pulse={securityPending}
            />
            <MetricCard
              accent="amber"
              icon={<Sparkles className="h-[18px] w-[18px]" />}
              label={t('welcome.dashboard.metrics.model')}
              value={aiModel || t('welcome.dashboard.metrics.notConfigured')}
              detail={aiModel
                ? t('welcome.dashboard.metrics.modelReady')
                : t('welcome.dashboard.metrics.modelMissing')}
              compact
            />
          </motion.section>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.12, ease: [0.33, 1, 0.68, 1] }}
            className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.8fr)]"
          >
            <DashboardPanel
              title={t('welcome.dashboard.quickConnect')}
              description={t('welcome.dashboard.quickConnectDesc')}
              icon={<Server className="h-4 w-4" />}
              badge={String(savedSessions.length).padStart(2, '0')}
              className="min-h-[174px]"
            >
              {visibleHosts.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center px-5 py-8 text-center">
                  <div className="relative mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-cyan-500/10 text-cyan-500 ring-1 ring-inset ring-cyan-500/20 dark:text-cyan-300">
                    <SquareTerminal className="h-6 w-6" />
                    <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-primary text-[13px] font-bold text-white shadow-lg shadow-primary/25">+</span>
                  </div>
                  <h3 className="text-[15px] font-semibold text-ink">{t('welcome.dashboard.emptyHostsTitle')}</h3>
                  <p className="mt-1.5 max-w-[390px] text-[12px] leading-relaxed text-ink-3">
                    {t('welcome.dashboard.emptyHostsDesc')}
                  </p>
                  <button type="button" onClick={createSession} className="dashboard-primary-button mt-5 h-9">
                    <Plus className="h-4 w-4" />
                    {t('welcome.dashboard.newConnection')}
                  </button>
                </div>
              ) : (
                <div className="flex flex-1 flex-col">
                  <div className="flex flex-col gap-1.5">
                    {visibleHosts.map((session, index) => {
                      const hostId = identityOf(session);
                      const address = addressOf(session);
                      const isOpen = openHostKeys.has(hostId);
                      const protocol = (session.protocol || 'ssh').toUpperCase();
                      const label = session.alias || session.host;
                      return (
                        <button
                          type="button"
                          key={`${hostId}-${index}`}
                          onClick={() => connect(session)}
                          aria-label={`${t('common.connect')} ${label}`}
                          className="dashboard-host-row group"
                        >
                          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1 ring-inset ${isOpen
                            ? 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20 dark:text-emerald-300'
                            : 'bg-surf text-ink-3 ring-line-soft'}`}
                          >
                            <Server className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1 text-left">
                            <span className="block truncate text-[12.5px] font-semibold text-ink">{label}</span>
                            <span className="mt-0.5 block truncate font-mono text-[10.5px] text-ink-3">{address}</span>
                          </span>
                          <span className="hidden items-center gap-2.5 sm:flex">
                            {session.group && (
                              <span className="max-w-[110px] truncate text-[10.5px] text-ink-3">{session.group}</span>
                            )}
                            <span className="rounded-md border border-line-soft bg-surf/70 px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-[0.08em] text-ink-3">
                              {protocol}
                            </span>
                          </span>
                          <span className={`hidden min-w-[64px] items-center gap-1.5 text-[10.5px] font-medium md:flex ${isOpen ? 'text-emerald-500 dark:text-emerald-300' : 'text-ink-3'}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${isOpen ? 'bg-emerald-400' : 'bg-ink-3/50'}`} />
                            {isOpen ? t('welcome.dashboard.open') : t('welcome.dashboard.ready')}
                          </span>
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ink-3 transition-all duration-200 group-hover:translate-x-0.5 group-hover:bg-primary/10 group-hover:text-primary">
                            <ArrowRight className="h-3.5 w-3.5" />
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-3 text-[10.5px] text-ink-3">
                    <span className="flex items-center gap-1.5 font-mono">
                      <span className="text-cyan-500 dark:text-cyan-300">$</span>
                      {t('welcome.dashboard.hostHint')}
                    </span>
                    {hiddenHostCount > 0 && (
                      <span>{t('welcome.dashboard.moreHosts', { count: hiddenHostCount })}</span>
                    )}
                  </div>
                </div>
              )}
            </DashboardPanel>

            <DashboardPanel
              title={t('welcome.dashboard.openTerminals')}
              description={t('welcome.dashboard.openTerminalsDesc')}
              icon={<SquareTerminal className="h-4 w-4" />}
              badge={String(sshTabs.length).padStart(2, '0')}
              className="min-h-[174px]"
              compact
            >
              {visibleSshTabs.length === 0 ? (
                <div className="flex flex-1 items-center gap-3 rounded-2xl border border-dashed border-line bg-surf/35 px-3.5 py-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surf text-ink-3 ring-1 ring-inset ring-line-soft">
                    <SquareTerminal className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12px] font-semibold text-ink-2">{t('welcome.dashboard.noOpenTerminals')}</span>
                    <span className="mt-0.5 block text-[10.5px] text-ink-3">{t('welcome.dashboard.noOpenTerminalsDesc')}</span>
                  </span>
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {visibleSshTabs.map(tab => {
                    if (!isSSHConfig(tab.config)) return null;
                    return (
                      <button
                        type="button"
                        key={tab.id}
                        onClick={() => setActiveTabId(tab.id)}
                        className="group flex min-w-0 items-center gap-2.5 rounded-xl border border-line-soft bg-surf/45 px-3 py-2.5 text-left transition-all duration-200 hover:border-emerald-500/25 hover:bg-emerald-500/[0.045]"
                      >
                        <span className="relative flex h-2 w-2 shrink-0">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-35" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11.5px] font-semibold text-ink-2 group-hover:text-ink">{tab.title}</span>
                          <span className="mt-0.5 block truncate font-mono text-[9.5px] text-ink-3">
                            {tab.config.username}@{tab.config.host}
                          </span>
                        </span>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-3 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-emerald-400" />
                      </button>
                    );
                  })}
                </div>
              )}
            </DashboardPanel>

            <DashboardPanel
              title={t('welcome.dashboard.launchpad')}
              description={t('welcome.dashboard.launchpadDesc')}
              icon={<Layers3 className="h-4 w-4" />}
              className="xl:col-span-2"
              compact
            >
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                <ActionTile
                  accent="blue"
                  icon={<Command className="h-[17px] w-[17px]" />}
                  label={t('welcome.dashboard.commandCenter')}
                  detail={isMac ? '⌘ K' : 'Ctrl K'}
                  onClick={() => setIsCommandCenterOpen(true)}
                />
                <ActionTile
                  accent="emerald"
                  icon={<ShieldCheck className="h-[17px] w-[17px]" />}
                  label={t('welcome.dashboard.securityCenter')}
                  detail={t('welcome.dashboard.securityCenterDesc')}
                  onClick={() => openCenter('secure', t('statusBar.secure'))}
                />
                <ActionTile
                  accent="purple"
                  icon={<Layers3 className="h-[17px] w-[17px]" />}
                  label={t('welcome.dashboard.workspaceCenter')}
                  detail={t('welcome.dashboard.workspaceCenterDesc')}
                  onClick={() => openCenter('workspace', t('statusBar.workspace'))}
                />
                <ActionTile
                  accent="amber"
                  icon={<Sparkles className="h-[17px] w-[17px]" />}
                  label={t('welcome.dashboard.aiCenter')}
                  detail={t('welcome.dashboard.aiCenterDesc')}
                  onClick={() => openCenter('ai', 'AI CENTER')}
                />
              </div>
            </DashboardPanel>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

const MetricCard: React.FC<{
  accent: Accent;
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  compact?: boolean;
  pulse?: boolean;
}> = ({ accent, icon, label, value, detail, compact = false, pulse = false }) => {
  const accentStyle = ACCENTS[accent];
  return (
    <div className="dashboard-card group relative min-w-0 overflow-hidden px-4 py-3.5">
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br opacity-70 transition-opacity duration-300 group-hover:opacity-100 ${accentStyle.wash}`} />
      <div className="relative flex items-start gap-3">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ring-1 ring-inset ${accentStyle.icon}`}>
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-[9.5px] font-bold uppercase tracking-[0.16em] text-ink-3">
            {pulse && <span className={`h-1.5 w-1.5 animate-pulse rounded-full ${accentStyle.dot}`} />}
            {label}
          </span>
          <span
            title={value}
            className={`mt-1 block truncate font-semibold tracking-[-0.025em] text-ink ${compact ? 'text-[16px]' : 'font-mono text-[24px] tabular-nums'}`}
          >
            {value}
          </span>
          <span title={detail} className="mt-0.5 block truncate text-[10px] text-ink-3">{detail}</span>
        </span>
      </div>
    </div>
  );
};

const DashboardPanel: React.FC<{
  title: string;
  description: string;
  icon: React.ReactNode;
  badge?: string;
  className?: string;
  compact?: boolean;
  children: React.ReactNode;
}> = ({ title, description, icon, badge, className = '', compact = false, children }) => (
  <section className={`dashboard-card flex min-w-0 flex-col ${compact ? 'p-3.5' : 'p-4'} ${className}`}>
    <div className={`flex items-start justify-between gap-3 ${compact ? 'mb-3' : 'mb-3.5'}`}>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
          {icon}
        </span>
        <span className="min-w-0">
          <h2 className="truncate text-[12.5px] font-semibold text-ink">{title}</h2>
          <p className="mt-0.5 truncate text-[10px] text-ink-3">{description}</p>
        </span>
      </div>
      {badge && (
        <span className="shrink-0 rounded-full border border-line-soft bg-surf/70 px-2 py-1 font-mono text-[9px] font-semibold tracking-[0.08em] text-ink-3">
          {badge}
        </span>
      )}
    </div>
    {children}
  </section>
);

const ActionTile: React.FC<{
  accent: Accent;
  icon: React.ReactNode;
  label: string;
  detail: string;
  onClick: () => void;
}> = ({ accent, icon, label, detail, onClick }) => {
  const accentStyle = ACCENTS[accent];
  return (
    <button type="button" onClick={onClick} className="dashboard-action-tile group relative min-w-0 overflow-hidden">
      <span className={`pointer-events-none absolute inset-0 bg-gradient-to-br opacity-45 transition-opacity duration-300 group-hover:opacity-100 ${accentStyle.wash}`} />
      <span className="relative flex h-full min-w-0 flex-col items-start justify-between gap-2">
        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ring-1 ring-inset ${accentStyle.icon}`}>
          {icon}
        </span>
        <span className="min-w-0 w-full text-left">
          <span className="block truncate text-[10.5px] font-semibold text-ink-2 transition-colors group-hover:text-ink">{label}</span>
          <span className="mt-0.5 block truncate font-mono text-[9px] text-ink-3">{detail}</span>
        </span>
      </span>
    </button>
  );
};
