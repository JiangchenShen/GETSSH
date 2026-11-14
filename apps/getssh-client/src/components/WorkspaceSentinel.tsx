import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, ShieldCheck, ShieldOff, ShieldQuestionMark } from 'lucide-react';
import { useAppLockStore } from '../store/appLockStore';
import { useAppStore } from '../store/appStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { getSentinelSupervisorState } from '../utils/sentinelSupervisorState';
import './GlobalWorkspaceBar.css';

export function WorkspaceSentinel({ poll = true }: { poll?: boolean }) {
  const { t } = useTranslation();
  const isVaultLocked = useWorkspaceStore(state => state.isVaultLocked);
  const phase = useAppLockStore(state => state.state?.phase);
  const status = useAppStore(state => state.sentinelStatus);
  const error = useAppStore(state => state.sentinelStatusError);
  const pollStatus = useAppStore(state => state.pollSentinelStatus);
  const ready = phase === 'ready' && !isVaultLocked;

  useEffect(() => {
    if (!ready || !poll) return;
    void pollStatus();
    const timer = window.setInterval(pollStatus, 3_000);
    return () => window.clearInterval(timer);
  }, [ready, poll, pollStatus]);

  const supervisor = ready ? getSentinelSupervisorState(status, error) : { label: 'unconfirmed', tone: 'neutral' };
  const label = `${t('statusBar.secure')} · ${t(`welcome.home.${supervisor.label}`)}`;
  const detail = ready && (error || status?.reason);
  const Icon = supervisor.tone === 'ok' ? ShieldCheck
    : supervisor.label === 'supervisorDisabled' ? ShieldOff
    : supervisor.tone === 'warn' ? ShieldAlert : ShieldQuestionMark;

  return (
    <>
      <button
        type="button"
        className="workspace-rail-sentinel no-drag-region focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        data-tone={supervisor.tone}
        aria-label={label}
        title={detail ? `${label} · ${detail}` : label}
        onClick={() => window.dispatchEvent(new CustomEvent('app:open-center', {
          detail: { type: 'settings', title: t('statusBar.settings'), settingsTab: 'Security' },
        }))}
      >
        <span className="workspace-rail-sentinel-shield" aria-hidden="true">
          <Icon size={17} />
        </span>
        <span className="workspace-rail-sentinel-name" aria-hidden="true">Ocean<br />Sentinel</span>
      </button>
      <span className="sr-only" role="status">{label}</span>
    </>
  );
}
