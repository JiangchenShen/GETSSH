import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Blocks, ChevronRight, Eye, Fingerprint, KeyRound, Layers, RefreshCw, ShieldCheck, ShieldAlert, X } from 'lucide-react';
import { useAppStore } from '../../../store/appStore';
import { useCryptoStore } from '../../../store/cryptoStore';
import { useWorkspaceStore } from '../../../store/workspaceStore';
import { SafeStorageTab } from '../../secure-center/tabs/SafeStorageTab';
import { KnownHostsTab } from '../../secure-center/tabs/KnownHostsTab';
import { OceanSentinelRuntime } from './OceanSentinelRuntime';
import { SettingsRow, SettingsSection, SettingsToggle, settingButtonClass, settingFieldClass } from '../SettingsControls';
import type { SecurityStatus } from '../../../types/ipc';

type Detail = 'app' | 'vault' | 'hosts' | 'privacy' | 'plugins' | 'ocean-sentinel' | null;
type KnownHost = { host: string; port: number; fingerprint: string; trustedAt: number };

export const SecurityTab: React.FC = () => {
  const { t, i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const appConfig = useAppStore(state => state.appConfig);
  const isConfigLoaded = useAppStore(state => state.isConfigLoaded);
  const updateConfig = useAppStore(state => state.updateConfig);
  const addToast = useAppStore(state => state.addToast);
  const sentinelStatus = useAppStore(state => state.sentinelStatus);
  const sentinelStatusError = useAppStore(state => state.sentinelStatusError);
  const pollSentinelStatus = useAppStore(state => state.pollSentinelStatus);
  const workspaceUnprotected = useCryptoStore(state => state.workspaceUnprotected);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const workspaces = useWorkspaceStore(state => state.workspaces);
  const workspace = workspaces.find(item => item.id === activeWorkspaceId);
  const [detail, setDetail] = useState<Detail>(null);
  const [knownHosts, setKnownHosts] = useState<KnownHost[]>([]);
  const [hostsLoaded, setHostsLoaded] = useState(false);
  const [protectionStatus, setProtectionStatus] = useState<SecurityStatus | null>(null);
  const [revokingHost, setRevokingHost] = useState<string | null>(null);
  const [pluginBusy, setPluginBusy] = useState(false);
  const [checkingSentinel, setCheckingSentinel] = useState(false);
  const [sentinelCheckFinishedAt, setSentinelCheckFinishedAt] = useState<number | null>(null);
  const [pluginVerification, setPluginVerification] = useState<{ mode: typeof appConfig.pluginSecurityMode; password: string; error: string } | null>(null);
  const detailSection = useRef<HTMLElement>(null);
  const detailTrigger = useRef<HTMLButtonElement>(null);
  const runtimeTrigger = useRef<HTMLButtonElement>(null);
  const restoreRuntimeFocus = useRef(false);
  const runtimeVisible = detail === 'ocean-sentinel';

  const revealDetail = () => {
    detailSection.current?.scrollIntoView({ block: 'start' });
    detailSection.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (detail && detail !== 'ocean-sentinel') revealDetail();
    if (!detail && restoreRuntimeFocus.current) {
      restoreRuntimeFocus.current = false;
      runtimeTrigger.current?.focus();
    }
  }, [detail]);
  const openDetail = (next: Exclude<Detail, null>, trigger: HTMLButtonElement) => {
    detailTrigger.current = trigger;
    if (next !== 'plugins') setPluginVerification(null);
    setDetail(next);
    if (next === detail) revealDetail();
  };
  const closeDetail = () => {
    setPluginVerification(null);
    if (runtimeVisible) restoreRuntimeFocus.current = true;
    setDetail(null);
    if (!runtimeVisible) detailTrigger.current?.focus();
  };
  useEffect(() => setPluginVerification(null), [activeWorkspaceId]);

  useEffect(() => {
    if (runtimeVisible) return;
    void pollSentinelStatus();
    const timer = setInterval(pollSentinelStatus, 3000);
    return () => clearInterval(timer);
  }, [pollSentinelStatus, runtimeVisible]);
  useEffect(() => {
    if (runtimeVisible) return;
    let active = true;
    setProtectionStatus(null);
    setHostsLoaded(false);
    void window.electronAPI?.security?.status?.().then(status => {
      if (active) setProtectionStatus(status);
    }).catch(() => { if (active) setProtectionStatus(null); });
    void window.electronAPI?.getKnownHosts?.().then(hosts => {
      if (active) { setKnownHosts(hosts); setHostsLoaded(true); }
    }).catch(() => {
      if (active && detail === 'hosts') addToast(zh ? '无法读取已知主机' : 'Could not load known hosts', 'error');
    });
    return () => { active = false; };
  }, [detail, runtimeVisible, activeWorkspaceId, addToast, zh]);

  const refreshSentinel = async () => {
    if (checkingSentinel) return;
    setCheckingSentinel(true);
    setSentinelCheckFinishedAt(null);
    try {
      const status = await pollSentinelStatus();
      if (status) setSentinelCheckFinishedAt(Date.now());
    } finally { setCheckingSentinel(false); }
  };
  const sentinelLabel = sentinelStatusError || sentinelStatus?.daemonState === 'unavailable'
    ? (zh ? '不可用' : 'Unavailable')
    : !sentinelStatus ? (zh ? '尚未获得状态' : 'Status unavailable')
    : sentinelStatus.sentinelDisabled || sentinelStatus.daemonState === 'disabled' ? (zh ? '已停用' : 'Disabled')
    : sentinelStatus.daemonState === 'starting' ? (zh ? '正在连接守护进程' : 'Connecting to supervisor')
    : sentinelStatus.status === 'warning' ? (zh ? '需要检查' : 'Needs attention')
    : sentinelStatus.daemonState === 'running' ? (zh ? '运行正常' : 'Healthy')
    : (zh ? '守护进程状态未知' : 'Supervisor status unknown');
  const sentinelDescription = (sentinelStatus?.status === 'warning' ? sentinelStatus.reason : undefined)
    || (sentinelStatus?.daemonState === 'unavailable' ? (zh ? '守护进程未连接或已退出，请重启 GETSSH。' : 'The supervisor is disconnected or has exited. Restart GETSSH.')
    : sentinelStatus?.daemonState === 'disabled' ? (zh ? '进程监护已停用。' : 'Process supervision is disabled.')
    : sentinelStatus?.daemonState === 'starting' ? (zh ? '正在建立本机守护进程连接。' : 'Connecting to the local supervisor.')
    : sentinelStatus?.daemonState === 'running' ? (zh ? '本机守护进程已连接。' : 'The local supervisor is connected.')
    : (zh ? '尚未确认守护进程连接状态。' : 'The supervisor connection status is not yet known.'));
  const workspaceScope = protectionStatus?.scopes.find(scope => scope.workspaceId === activeWorkspaceId);
  const workspaceNeedsPassword = workspaceScope?.protected === false;
  const supervisorHealthy = sentinelStatus?.daemonState === 'running' && sentinelStatus.status === 'secure' && !sentinelStatus.sentinelDisabled && !sentinelStatusError;
  const supervisorWarning = !!sentinelStatusError || (!!sentinelStatus && sentinelStatus.daemonState !== 'starting' && !supervisorHealthy);
  const unconfirmed = zh ? '尚未确认' : 'Not confirmed';
  const pluginModes = {
    safe: zh ? '安全模式' : 'Safe mode', strict: zh ? '严格模式' : 'Strict mode',
    normal: zh ? '常规模式' : 'Normal mode', developer: zh ? '开发者模式' : 'Developer mode',
  };
  const appProtection = !protectionStatus ? unconfirmed : protectionStatus.appProtected ? (zh ? '已设置' : 'Enabled') : (zh ? '未设置' : 'Not set');
  const workspaceProtection = !workspaceScope ? unconfirmed : workspaceScope.ownPassword ? (zh ? '独立密码' : 'Own password') : workspaceScope.protected ? (zh ? '主密码保护' : 'Master password') : (zh ? '未设置' : 'Not set');
  const refreshButton = <button type="button" onClick={() => void refreshSentinel()} disabled={checkingSentinel} aria-busy={checkingSentinel} className={settingButtonClass}><RefreshCw className={'h-3.5 w-3.5 ' + (checkingSentinel ? 'motion-safe:animate-spin' : '')} aria-hidden="true" />{checkingSentinel ? (zh ? '正在刷新…' : 'Refreshing…') : (zh ? '刷新状态' : 'Refresh status')}</button>;
  const refreshFeedback = <>
    {sentinelStatusError && <p role="alert" className="mt-3 break-words text-xs text-down">{zh ? '无法获取状态，请重试' : 'Could not fetch status. Try again'}: {sentinelStatusError}</p>}
    {sentinelCheckFinishedAt && !sentinelStatusError && <p role="status" className="mt-3 text-xs text-ink-2">{zh ? '状态已更新' : 'Status updated'} · {new Date(sentinelCheckFinishedAt).toLocaleTimeString(i18n.language)}</p>}
  </>;

  const changePluginMode = async (mode: typeof appConfig.pluginSecurityMode, password?: string) => {
    if (mode === appConfig.pluginSecurityMode || pluginBusy) return;
    if (password === undefined && mode === 'developer' && !window.confirm(zh
      ? '开发者模式会让插件直接在主进程运行并获得完整系统权限。仅用于完全信任的代码。确定继续？'
      : 'Developer mode runs plugins in the main process with full system access. Use it only for fully trusted code. Continue?')) return;
    if (password === undefined && mode !== 'safe' && workspaceUnprotected && !window.confirm(zh ? '启用后端插件执行？插件将在系统隔离进程中运行。' : 'Enable backend plugins in an OS-confined process?')) return;
    setPluginBusy(true);
    let modeChanged = false;
    try {
      // The main process verifies the owner itself (Touch ID); it asks for the master password only
      // where no OS prompt exists.
      const result = await window.electronAPI.updateBackendConfig({ pluginSecurityMode: mode }, password);
      if (!result.success && result.verification === 'password_required') {
        setPluginVerification({ mode, password: '', error: password === undefined ? '' : result.error || (zh ? '请输入密码以验证身份' : 'Enter your password to verify') });
        return;
      }
      if (!result.success) throw new Error(result.error || 'Plugin security mode could not be changed');
      modeChanged = true;
      setPluginVerification(null);
      updateConfig('pluginSecurityMode', mode);
      await window.electronAPI.reloadPlugins();
      addToast(zh ? '插件运行模式已更新' : 'Plugin execution mode updated', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : (zh ? '更新失败' : 'Update failed');
      if (password !== undefined && !modeChanged) setPluginVerification({ mode, password: '', error: message });
      else addToast(message, 'error');
    } finally { setPluginBusy(false); }
  };

  const openWorkspaceIsolation = () => window.dispatchEvent(new CustomEvent('app:open-center', {
    detail: { type: 'workspace', title: t('statusBar.workspace'), workspacePage: 'isolation' },
  }));
  const rowAction = (id: Exclude<Detail, null>, label: string, summary: string, action: string, state: string, icon: React.ReactNode, warning = false) => <div className="settings-row security-protection-row grid items-center gap-3 border-b border-line-soft py-4 last:border-b-0">
    <span className="text-ink-3" aria-hidden="true">{icon}</span>
    <div className="min-w-0"><h3 className="text-sm font-medium text-ink">{label}</h3><p className="mt-1 text-xs leading-relaxed text-ink-3">{summary}</p></div>
    <span className={'security-protection-state inline-flex items-center gap-1.5 text-xs ' + (warning ? 'text-warn' : 'text-ink-2')}><span className={'h-1.5 w-1.5 shrink-0 rounded-full ' + (warning ? 'bg-warn' : 'bg-ink-3/50')} aria-hidden="true" />{state}</span>
    <button type="button" aria-label={`${label} · ${action}`} onClick={event => openDetail(id, event.currentTarget)} className="security-protection-action inline-flex min-h-8 items-center justify-end gap-1 text-xs text-ink-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">{action}<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></button>
  </div>;
  const detailName = detail === 'app' ? (zh ? '主密码与恢复码' : 'Master password & recovery') : detail === 'vault' ? (zh ? '工作区密码' : 'Workspace password') : detail === 'hosts' ? t('security.knownHostsTitle') : detail === 'privacy' ? (zh ? '隐私与自动锁定' : 'Privacy & auto-lock') : detail === 'plugins' ? t('settings.pluginSecurityMode') : '';

  if (runtimeVisible) return <OceanSentinelRuntime onBack={closeDetail} />;

  return <div role="region" aria-label={zh ? '安全总览' : 'Security overview'} className="security-dashboard space-y-6">
    <section aria-label={zh ? '进程监护' : 'Process supervision'} className="rounded-lg border border-line bg-panel/40 px-5 py-5">
      <div className="security-supervisor-header flex items-start justify-between gap-5">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className={'mt-1 shrink-0 rounded-md border p-2.5 ' + (supervisorHealthy ? 'border-primary/20 bg-primary/5 text-primary' : supervisorWarning ? 'border-warn/25 bg-warn/5 text-warn' : 'border-line text-ink-3')} aria-hidden="true">{supervisorWarning ? <ShieldAlert className="h-6 w-6" /> : <ShieldCheck className="h-6 w-6" />}</span>
          <div className="min-w-0">
            <p className="text-xs text-ink-3">{zh ? '本机进程监护' : 'Local process supervision'}</p>
            <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-ink">{sentinelLabel}</h2>
            <p className="mt-2 max-w-xl break-words text-xs leading-relaxed text-ink-2">{sentinelDescription}</p>
          </div>
        </div>
        <div className="security-supervisor-actions flex shrink-0 flex-wrap items-center justify-end gap-2">
          {refreshButton}
          <button ref={runtimeTrigger} type="button" aria-label={zh ? '查看进程监护详情' : 'View supervisor details'} onClick={event => openDetail('ocean-sentinel', event.currentTarget)} className="inline-flex min-h-8 items-center gap-1 px-1 text-xs text-ink-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">{zh ? '运行详情' : 'Runtime details'}<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></button>
        </div>
      </div>
      {refreshFeedback}
    </section>

    {(workspaceNeedsPassword || (isConfigLoaded && appConfig.pluginSecurityMode === 'developer')) && <section aria-label={zh ? '待处理事项' : 'Needs attention'} className="border-l-2 border-warn bg-warn/5 px-4 py-3">
      <h2 className="text-xs font-semibold text-warn">{zh ? '待处理事项' : 'Needs attention'}</h2>
      {workspaceNeedsPassword && <div role="status" className="security-attention-row flex items-center justify-between gap-4 py-2">
        <div className="min-w-0"><strong className="block text-sm font-medium text-ink">{zh ? '这个工作区没有密码' : 'This workspace has no password'}</strong><p className="mt-1 text-xs leading-relaxed text-ink-2">{zh ? '数据在磁盘上是加密的，但任何使用这台电脑的人都能打开它。' : 'Its data is encrypted on disk, but anyone using this computer can open it.'}</p></div>
        <button type="button" onClick={event => openDetail(workspace?.isMain ? 'app' : 'vault', event.currentTarget)} className="shrink-0 text-xs font-medium text-warn underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warn/40">{workspace?.isMain ? (zh ? '设置主密码' : 'Set a master password') : (zh ? '设置密码' : 'Set a password')}</button>
      </div>}
      {isConfigLoaded && appConfig.pluginSecurityMode === 'developer' && <div className="security-attention-row flex items-center justify-between gap-4 py-2">
        <div className="min-w-0"><strong className="block text-sm font-medium text-ink">{zh ? '后端插件拥有完整系统权限' : 'Backend plugins have full system access'}</strong><p className="mt-1 text-xs leading-relaxed text-ink-2">{zh ? '当前使用开发者模式，请确认只运行完全信任的代码。' : 'Developer mode is selected. Run only fully trusted code.'}</p></div>
        <button type="button" onClick={event => openDetail('plugins', event.currentTarget)} className="shrink-0 text-xs font-medium text-warn underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warn/40">{zh ? '检查权限' : 'Review permissions'}</button>
      </div>}
    </section>}

    <div className="security-dashboard-columns grid gap-7">
      <SettingsSection title={zh ? '保护配置' : 'Protection overview'} description={zh ? '应用与当前工作区的保护项目。' : 'Protection settings for the app and current workspace.'}>
        {rowAction('app', zh ? '主密码与恢复码' : 'Master password & recovery', protectionStatus ? (protectionStatus.recoveryConfigured ? (zh ? '恢复码已创建。' : 'Recovery code created.') : (zh ? '恢复码尚未创建。' : 'Recovery code not created.')) : (zh ? '用于启动验证、锁定与账户恢复。' : 'Launch verification, locking and recovery.'), zh ? '管理' : 'Manage', appProtection, <KeyRound className="h-4 w-4" />, protectionStatus?.appProtected === false)}
        {rowAction('vault', zh ? '工作区密码' : 'Workspace password', workspaceScope ? (workspaceScope.ownPassword ? (zh ? '当前工作区使用独立密码。' : 'This workspace uses its own password.') : workspaceScope.protected ? (zh ? '当前工作区继承应用主密码保护。' : 'This workspace inherits the app master password.') : (zh ? '可设置密码以限制本机访问。' : 'Set a password to restrict local access.')) : (zh ? '读取当前工作区的密码保护状态。' : 'Password protection for the current workspace.'), zh ? '设置' : 'Set up', workspaceProtection, <Layers className="h-4 w-4" />, workspaceNeedsPassword)}
        {rowAction('plugins', t('settings.pluginSecurityMode'), !isConfigLoaded ? (zh ? '读取后端插件的执行配置。' : 'Backend plugin execution configuration.') : appConfig.pluginSecurityMode === 'safe' ? (zh ? '不执行后端插件。' : 'Backend plugins are not executed.') : appConfig.pluginSecurityMode === 'developer' ? (zh ? '插件在主进程运行，拥有完整系统权限。' : 'Plugins run in the main process with full system access.') : (zh ? '已配置为在系统隔离进程中运行。' : 'Configured to run in an OS-confined process.'), zh ? '管理' : 'Manage', isConfigLoaded ? pluginModes[appConfig.pluginSecurityMode] : unconfirmed, <Blocks className="h-4 w-4" />, isConfigLoaded && appConfig.pluginSecurityMode === 'developer')}
        {rowAction('privacy', t('security.privacyTitle'), zh ? '管理敏感内容遮蔽与界面闲置锁定设置。' : 'Manage sensitive content masking and UI auto-lock settings.', zh ? '配置' : 'Configure', isConfigLoaded ? (appConfig.privacyMode ? (zh ? '隐私模式开启' : 'Privacy on') : (zh ? '隐私模式关闭' : 'Privacy off')) : unconfirmed, <Eye className="h-4 w-4" />)}
        {rowAction('hosts', t('security.knownHostsTitle'), zh ? '本机保存的主机密钥；连接时核对指纹。' : 'Host keys saved on this computer for fingerprint verification.', zh ? '管理' : 'Manage', hostsLoaded ? (zh ? `${knownHosts.length} 条记录` : `${knownHosts.length} records`) : unconfirmed, <Fingerprint className="h-4 w-4" />)}
      </SettingsSection>

      <aside className="security-dashboard-context space-y-6" aria-label={zh ? '工作区与记录' : 'Workspace & records'}>
        <section>
          <h2 className="text-xs font-semibold text-ink-2">{zh ? '当前工作区' : 'Current workspace'}</h2>
          <p className="mt-3 break-words text-base font-medium text-ink">{workspace?.name || activeWorkspaceId}</p>
          <p className="mt-1 text-xs text-ink-3">{workspace?.isMain ? (zh ? '主工作区' : 'Main workspace') : (zh ? '独立工作区' : 'Workspace')}</p>
          <div className="mt-4 border-t border-line-soft pt-4">
            <h3 className="text-sm font-medium text-ink">{t('workspaceCenter.sidebar.isolation', '隔离规则')}</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-3">{zh ? '查看文件传输、主机密钥与导出规则的配置。' : 'Review configuration for file transfer, host keys and export rules.'}</p>
            <button type="button" onClick={openWorkspaceIsolation} className="mt-3 inline-flex min-h-8 items-center gap-1 text-xs text-ink-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">{zh ? '前往工作区' : 'Open workspace'}<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></button>
          </div>
        </section>
        <section className="border-t border-line-soft pt-5">
          <h2 className="flex items-center gap-2 text-xs font-semibold text-ink-2"><Activity className="h-3.5 w-3.5" aria-hidden="true" />{zh ? '安全与会话日志' : 'Security & session logs'}</h2>
          <p className="mt-3 text-xs leading-relaxed text-ink-3">{zh ? '查看连接历史、审计记录与终端录屏。' : 'Review connection history, audit records and terminal recordings.'}</p>
          <p className="mt-2 text-xs text-ink-2">{zh ? '新建 SSH 会话录屏' : 'New SSH session recording'} · {isConfigLoaded ? (appConfig.enableAuditLogging ? (zh ? '开启' : 'On') : (zh ? '关闭' : 'Off')) : unconfirmed}</p>
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('app:settings-tab', { detail: 'Audit' }))} className="mt-3 inline-flex min-h-8 items-center gap-1 text-xs text-ink-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">{zh ? '查看记录' : 'View logs'}<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></button>
        </section>
      </aside>
    </div>

    {detail && <section ref={detailSection} tabIndex={-1} className="border-t border-line pt-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label={detailName}>
      <div className="mb-5 flex items-center justify-between gap-3"><h2 className="text-base font-semibold">{detailName}</h2><button type="button" onClick={closeDetail} aria-label={zh ? '关闭详情' : 'Close details'} className="rounded-md p-1.5 text-ink-3 hover:bg-surf-2 hover:text-ink"><X className="h-4 w-4" /></button></div>
      {(detail === 'app' || detail === 'vault') && <SafeStorageTab section={detail} />}
      {detail === 'hosts' && <KnownHostsTab knownHosts={knownHosts} revokingHost={revokingHost} setRevokingHost={setRevokingHost} handleRevokeHost={async (host, port) => { try { await window.electronAPI.deleteKnownHost(host, port); setKnownHosts(previous => previous.filter(item => !(item.host === host && item.port === port))); setRevokingHost(null); } catch (error) { addToast(error instanceof Error ? error.message : (zh ? '撤销失败' : 'Could not revoke host'), 'error'); } }} />}
      {detail === 'privacy' && <SettingsSection title={zh ? '隐私' : 'Privacy'}><SettingsRow label={t('security.privacyMode')} description={t('security.privacyModeDesc')}><SettingsToggle checked={appConfig.privacyMode} onChange={checked => updateConfig('privacyMode', checked)} label={t('security.privacyMode')} /></SettingsRow><SettingsRow label={t('security.autoLockTitle')}><select value={appConfig.autoLockTimeout} onChange={event => updateConfig('autoLockTimeout', Number(event.target.value))} className={`${settingFieldClass} sm:w-44`}><option value={0}>{t('security.autoLockOff')}</option>{[5, 15, 30, 60].map(minutes => <option key={minutes} value={minutes}>{minutes === 60 ? `1 ${t('security.hour')}` : `${minutes} ${t('security.minutes')}`}</option>)}</select></SettingsRow></SettingsSection>}
      {detail === 'plugins' && <SettingsSection title={t('settings.pluginSecurityMode')} description={t('settings.pluginSecurityDesc')}>
        <SettingsRow label={t('settings.pluginSecurityStrategy')} description={zh ? '安全模式不执行后端插件；开发者模式仅用于完全信任的代码。' : 'Safe mode skips backend plugins; developer mode is for fully trusted code only.'}>
          <select disabled={pluginBusy || !!pluginVerification} value={appConfig.pluginSecurityMode} onChange={event => void changePluginMode(event.target.value as typeof appConfig.pluginSecurityMode)} className={`${settingFieldClass} sm:w-52`}><option value="safe">{t('settings.pluginSecuritySafe')}</option><option value="strict">{t('settings.pluginSecurityStrict')}</option><option value="normal">{t('settings.pluginSecurityNormal')}</option><option value="developer">{t('settings.pluginSecurityDeveloper')}</option></select>
        </SettingsRow>
        {pluginVerification && <SettingsRow label={zh ? '验证身份' : 'Verify your identity'} description={zh ? '验证通过后才会更改插件权限。' : 'Plugin permissions change only after verification.'} stacked>
          <form className="max-w-md space-y-3" onSubmit={event => { event.preventDefault(); void changePluginMode(pluginVerification.mode, pluginVerification.password); }}>
            <label className="block text-xs text-ink-2">{zh ? '主密码或工作区密码' : 'Master or workspace password'}<input type="password" autoFocus autoComplete="current-password" value={pluginVerification.password} onChange={event => setPluginVerification({ ...pluginVerification, password: event.target.value })} className={`mt-1 ${settingFieldClass}`} /></label>
            {pluginVerification.error && <p role="alert" className="text-xs text-down">{pluginVerification.error}</p>}
            <div className="flex gap-2"><button type="button" disabled={pluginBusy} onClick={() => { setPluginVerification(null); revealDetail(); }} className={settingButtonClass}>{zh ? '取消' : 'Cancel'}</button><button type="submit" disabled={pluginBusy || !pluginVerification.password} className={settingButtonClass}>{pluginBusy ? (zh ? '验证中…' : 'Verifying…') : (zh ? '验证' : 'Verify')}</button></div>
          </form>
        </SettingsRow>}
      </SettingsSection>}
    </section>}
  </div>;
};
