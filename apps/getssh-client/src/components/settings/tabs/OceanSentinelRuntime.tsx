import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../../store/appStore';
import { SettingsRow, SettingsSection, settingButtonClass } from '../SettingsControls';

export function OceanSentinelRuntime({ onBack }: { onBack: () => void }) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const copy = (cn: string, en: string) => zh ? cn : en;
  const sentinelStatus = useAppStore(state => state.sentinelStatus);
  const sentinelStatusError = useAppStore(state => state.sentinelStatusError);
  const pollSentinelStatus = useAppStore(state => state.pollSentinelStatus);
  const heading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    const main = heading.current?.closest('main');
    if (main) main.scrollTop = 0;
    heading.current?.focus({ preventScroll: true });
    void pollSentinelStatus();
    const timer = setInterval(pollSentinelStatus, 3_000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, [pollSentinelStatus]);

  useEffect(() => {
    if (sentinelStatus && !sentinelStatusError) setRefreshError(null);
  }, [sentinelStatus, sentinelStatusError]);

  const formatTime = (value: number | null | undefined, dateOnly = false): string => {
    if (value === null || value === 0) return copy('尚无记录', 'No record yet');
    if (value === undefined || !Number.isFinite(value) || value < 0) return '—';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '—';
    return dateOnly ? date.toLocaleDateString(i18n.language) : date.toLocaleString(i18n.language);
  };
  const count = (value: number | null | undefined) => Number.isSafeInteger(value) && value !== null && value !== undefined && value >= 0 ? value.toLocaleString(i18n.language) : '—';
  const pid = (value: number | null | undefined) => Number.isSafeInteger(value) && value !== null && value !== undefined && value > 0 ? String(value) : '—';
  const error = sentinelStatusError || refreshError;
  const status = sentinelStatusError ? null : sentinelStatus;
  const gateway = status?.gateway;
  const stats = status?.stats;
  const daemonLabel = !status ? (error ? copy('不可用', 'Unavailable') : copy('尚未确认', 'Not confirmed'))
    : status.sentinelDisabled || status.daemonState === 'disabled' ? copy('已停用', 'Disabled')
    : status.daemonState === 'unavailable' ? copy('不可用', 'Unavailable')
    : status.daemonState === 'starting' ? copy('正在连接守护进程', 'Connecting to supervisor')
    : status.status === 'warning' ? copy('需要检查', 'Needs attention')
    : status.daemonState === 'running' ? copy('运行正常', 'Healthy') : copy('尚未确认', 'Not confirmed');
  const daemonDescription = status?.reason || (!status ? copy('尚未确认本机守护进程状态。', 'Local supervisor status is not yet confirmed.')
    : status.sentinelDisabled || status.daemonState === 'disabled' ? copy('本机进程监护已停用。', 'Local process supervision is disabled.')
    : status.daemonState === 'unavailable' ? copy('守护进程未连接或已退出。', 'The supervisor is disconnected or has exited.')
    : status.daemonState === 'starting' ? copy('正在建立本机守护进程连接。', 'Connecting to the local supervisor.')
    : status.daemonState === 'running' ? copy('独立守护进程监护 GETSSH 主进程。', 'A separate supervisor monitors the GETSSH main process.')
    : copy('尚未确认守护进程连接状态。', 'The supervisor connection is not yet confirmed.'));
  const gatewayLabel = !gateway ? copy('尚未确认', 'Not confirmed')
    : gateway.state === 'faulted' ? copy('脱敏失败', 'Sanitization failed')
    : gateway.mode === 'fallback' ? copy('JS 脱敏兜底', 'JS redaction fallback') : copy('原生脱敏', 'Native redaction');
  const gatewayDescription = !gateway ? copy('尚未获得网关状态。', 'Gateway status is not yet available.')
    : gateway.state === 'faulted' ? copy('脱敏处理失败，已拒绝发送未经脱敏的原文。', 'Sanitization failed; sending unsanitized text was refused.')
    : gateway.mode === 'fallback' ? copy('原生模块不可用，使用不可逆 JS 脱敏；脱敏处理仍可用。', 'The native module is unavailable. Irreversible JS redaction remains available.')
    : copy('Rust 模块使用可逆占位符替换匹配片段。', 'The Rust module replaces matches with reversible placeholders.');
  const persistenceUnavailable = stats?.persistence === 'unavailable';

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshedAt(null);
    setRefreshError(null);
    try {
      const result = await pollSentinelStatus();
      if (!mounted.current) return;
      if (result) setRefreshedAt(Date.now());
      else setRefreshError(copy('无法获取状态，请重试。', 'Could not fetch status. Try again.'));
    } catch (failure) {
      if (mounted.current) setRefreshError(failure instanceof Error ? failure.message : copy('无法获取状态，请重试。', 'Could not fetch status. Try again.'));
    } finally { if (mounted.current) setRefreshing(false); }
  };

  return <section aria-label={copy('海洋守护中心', 'Ocean Sentinel')} className="security-dashboard space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <button type="button" onClick={onBack} className={`${settingButtonClass} mb-4`}><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />{copy('返回安全总览', 'Back to security overview')}</button>
        <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{copy('运行详情', 'Runtime details')}</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-3">{copy('本机守护进程、模型出口脱敏与命中统计。', 'Local supervision, model egress text sanitization and hit counts.')}</p>
      </div>
      <button type="button" onClick={() => void refresh()} disabled={refreshing} aria-busy={refreshing} className={settingButtonClass}><RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />{refreshing ? copy('正在刷新…', 'Refreshing…') : copy('刷新状态', 'Refresh status')}</button>
    </header>

    {error && <p role="alert" className="break-words text-xs text-down">{copy('无法获取状态，请重试', 'Could not fetch status. Try again')}: {error}</p>}
    {!error && gateway?.state === 'faulted' && <p role="alert" className="text-xs text-down">{copy('脱敏处理失败，已拒绝发送未经脱敏的原文。', 'Sanitization failed; sending unsanitized text was refused.')}</p>}
    {refreshedAt && !error && <p role="status" className="text-xs text-ink-2">{copy('状态已更新', 'Status updated')} · {formatTime(refreshedAt)}</p>}

    <SettingsSection title={copy('脱敏命中次数', 'Sanitization hits')} description={copy('本机应用 · 所有工作区。按模型出口文本的替换次数计数，重复处理会再次累计。', 'This app · All workspaces. Counts text replacements at model egress; repeated processing counts again.')}>
      <dl className="security-runtime-metrics grid">
        <div className="min-w-0 px-3 py-4">
          <dt className="text-xs text-ink-2">{copy('今天', 'Today')}</dt>
          <dd className="mt-2 font-mono text-2xl text-ink" data-testid="sentinel-today-hits">{count(stats?.todayHits)}</dd>
          {persistenceUnavailable && <dd className="mt-1 text-xs text-warn">{copy('暂未保存', 'Not saved yet')}</dd>}
          <dd className="mt-2 break-words text-xs leading-relaxed text-ink-3">{stats ? copy(`本机日期：${stats.day}`, `Local date: ${stats.day}`) : copy('统计日期尚未确认。', 'The statistics date is not confirmed.')}</dd>
        </div>
        <div className="min-w-0 px-3 py-4">
          <dt className="text-xs text-ink-2">{copy('累计', 'Total')}</dt>
          <dd className="mt-2 font-mono text-2xl text-ink" data-testid="sentinel-total-hits">{count(stats?.totalHits)}</dd>
          {persistenceUnavailable && <dd className="mt-1 text-xs text-warn">{copy('暂未保存', 'Not saved yet')}</dd>}
          <dd className="mt-2 break-words text-xs leading-relaxed text-ink-3">{stats?.recordedSince ? copy(`自 ${formatTime(stats.recordedSince, true)} 起记录。`, `Recorded since ${formatTime(stats.recordedSince, true)}.`) : stats?.totalHits === 0 ? copy('尚无累计命中记录。', 'No cumulative hits recorded yet.') : copy('记录起始日期尚未确认。', 'The recording start date is not confirmed.')}</dd>
        </div>
        <div className="min-w-0 px-3 py-4">
          <dt className="text-xs text-ink-2">{copy('本次运行', 'This run')}</dt>
          <dd className="mt-2 font-mono text-2xl text-ink" data-testid="sentinel-runtime-hits">{count(stats?.runtimeHits)}</dd>
          <dd className="mt-2 break-words text-xs leading-relaxed text-ink-3">{stats ? copy(`启动于 ${formatTime(stats.startedAt)}。`, `Started at ${formatTime(stats.startedAt)}.`) : copy('尚未获得本次运行统计。', 'Run statistics are not yet available.')}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-baseline gap-2 border-t border-line-soft px-3 py-3 text-xs text-ink-3"><span>{copy('本次运行最近命中', 'Last hit this run')}</span><span>{formatTime(stats?.lastFilteredAt)}</span></div>
    </SettingsSection>

    <div className="security-runtime-columns grid gap-7">
    <SettingsSection title={copy('Watchdog 守护进程', 'Watchdog supervisor')}>
      <SettingsRow label={copy('进程状态', 'Process status')} description={daemonDescription}><span data-testid="runtime-daemon-state" className="text-sm text-ink-2">{daemonLabel}</span></SettingsRow>
      <SettingsRow label={copy('守护进程 PID', 'Supervisor PID')}><span data-testid="runtime-supervisor-pid" className="font-mono text-sm text-ink-2">{pid(status?.supervisorPid)}</span></SettingsRow>
      <SettingsRow label={copy('GETSSH 主进程 PID', 'GETSSH main process PID')}><span data-testid="runtime-supervised-pid" className="font-mono text-sm text-ink-2">{pid(status?.supervisedPid)}</span></SettingsRow>
      <SettingsRow label={copy('最近监护信号发送', 'Last supervision signal sent')} description={copy('记录最近成功写入 PING 的时间，不代表守护进程已确认收到。', 'Time of the last completed PING write; receipt by the supervisor is not confirmed.')}><span data-testid="runtime-last-ping" className="text-xs text-ink-2">{formatTime(status?.lastPing)}</span></SettingsRow>
    </SettingsSection>

    <SettingsSection title={copy('Sentinel 脱敏网关', 'Sentinel sanitization gateway')} className="security-dashboard-context">
      <SettingsRow label={copy('处理模式', 'Processing mode')} description={gatewayDescription}><span data-testid="sentinel-gateway-state" className={`text-sm ${gateway?.state === 'faulted' ? 'text-down' : gateway?.mode === 'fallback' ? 'text-warn' : 'text-ink-2'}`}>{gatewayLabel}</span></SettingsRow>
      <SettingsRow label={copy('本次运行最近处理', 'Last sanitization this run')}><span className="text-xs text-ink-2">{formatTime(gateway?.lastSanitizedAt)}</span></SettingsRow>
      <SettingsRow label={copy('本次运行最近失败', 'Last failure this run')}><span className="text-xs text-ink-2">{formatTime(gateway?.lastFailureAt)}</span></SettingsRow>
    </SettingsSection>

    </div>
  </section>;
}
