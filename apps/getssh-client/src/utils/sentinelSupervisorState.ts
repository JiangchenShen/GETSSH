import type { OceanSentinelStatus } from '../types/ipc';

export function getSentinelSupervisorState(status: OceanSentinelStatus | null, error: string | null) {
  if (error || status?.daemonState === 'unavailable') return { label: 'supervisorUnavailable', tone: 'warn' } as const;
  if (!status) return { label: 'checking', tone: 'neutral' } as const;
  if (status.sentinelDisabled || status.daemonState === 'disabled') return { label: 'supervisorDisabled', tone: 'warn' } as const;
  if (status.daemonState === 'starting') return { label: 'supervisorStarting', tone: 'neutral' } as const;
  if (status.status === 'warning') return { label: 'needsAttention', tone: 'warn' } as const;
  if (status.daemonState === 'running') return { label: 'supervisorRunning', tone: 'ok' } as const;
  return { label: 'unconfirmed', tone: 'neutral' } as const;
}
