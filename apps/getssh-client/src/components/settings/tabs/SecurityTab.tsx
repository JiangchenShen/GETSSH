import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, X } from 'lucide-react';
import { useAppStore } from '../../../store/appStore';
import { useCryptoStore } from '../../../store/cryptoStore';
import { useWorkspaceStore } from '../../../store/workspaceStore';
import { SafeStorageTab } from '../../secure-center/tabs/SafeStorageTab';
import { KnownHostsTab } from '../../secure-center/tabs/KnownHostsTab';
import { SettingsRow, SettingsSection, SettingsToggle, settingButtonClass, settingFieldClass } from '../SettingsControls';

type Detail = 'app' | 'vault' | 'hosts' | 'privacy' | 'plugins' | 'watchdog' | null;
type KnownHost = { host: string; port: number; fingerprint: string; trustedAt: number };

export const SecurityTab: React.FC = () => {
  const { t, i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const appConfig = useAppStore(state => state.appConfig);
  const updateConfig = useAppStore(state => state.updateConfig);
  const addToast = useAppStore(state => state.addToast);
  const watchdogStatus = useAppStore(state => state.watchdogStatus);
  const pollWatchdogStatus = useAppStore(state => state.pollWatchdogStatus);
  const workspaceUnprotected = useCryptoStore(state => state.workspaceUnprotected);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const workspaces = useWorkspaceStore(state => state.workspaces);
  const workspace = workspaces.find(item => item.id === activeWorkspaceId);
  const [detail, setDetail] = useState<Detail>(null);
  const [knownHosts, setKnownHosts] = useState<KnownHost[]>([]);
  const [revokingHost, setRevokingHost] = useState<string | null>(null);
  const [pluginBusy, setPluginBusy] = useState(false);

  useEffect(() => {
    void pollWatchdogStatus();
    const timer = setInterval(pollWatchdogStatus, 3000);
    return () => clearInterval(timer);
  }, [pollWatchdogStatus]);
  useEffect(() => {
    if (detail === 'hosts' && window.electronAPI?.getKnownHosts) {
      void window.electronAPI.getKnownHosts().then(setKnownHosts).catch(() => addToast(zh ? '无法读取已知主机' : 'Could not load known hosts', 'error'));
    }
  }, [detail, activeWorkspaceId, addToast, zh]);

  const changePluginMode = async (mode: typeof appConfig.pluginSecurityMode) => {
    if (mode === appConfig.pluginSecurityMode || pluginBusy) return;
    if (mode === 'developer' && !window.confirm(zh
      ? '开发者模式会让插件直接在主进程运行并获得完整系统权限。仅用于完全信任的代码。确定继续？'
      : 'Developer mode runs plugins in the main process with full system access. Use it only for fully trusted code. Continue?')) return;
    if (mode !== 'safe' && workspaceUnprotected && !window.confirm(zh ? '启用后端插件执行？插件将在系统隔离进程中运行。' : 'Enable backend plugins in an OS-confined process?')) return;
    setPluginBusy(true);
    try {
      // The main process verifies the owner itself (Touch ID); it asks for the master password only
      // where no OS prompt exists.
      let result = await window.electronAPI.updateBackendConfig({ pluginSecurityMode: mode });
      if (!result.success && result.verification === 'password_required') {
        const token = window.prompt(zh ? '请输入主密码（或工作区密码）以验证身份' : 'Enter the master password (or a workspace password) to verify') || undefined;
        if (!token) return;
        result = await window.electronAPI.updateBackendConfig({ pluginSecurityMode: mode }, token);
      }
      if (!result.success) throw new Error(result.error || 'Plugin security mode could not be changed');
      updateConfig('pluginSecurityMode', mode);
      await window.electronAPI.reloadPlugins();
      addToast(zh ? '插件运行模式已更新' : 'Plugin execution mode updated', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : (zh ? '更新失败' : 'Update failed'), 'error');
    } finally { setPluginBusy(false); }
  };

  const openWorkspaceIsolation = () => window.dispatchEvent(new CustomEvent('app:open-center', {
    detail: { type: 'workspace', title: t('statusBar.workspace'), workspacePage: 'isolation' },
  }));
  const rowAction = (id: Detail, label: string, summary: string, action: string) => <SettingsRow label={label} description={summary}><button type="button" onClick={() => setDetail(id)} className={settingButtonClass}>{action}<ChevronRight className="h-3.5 w-3.5" /></button></SettingsRow>;
  const detailName = detail === 'app' ? (zh ? '主密码与恢复码' : 'Master password & recovery') : detail === 'vault' ? (zh ? '工作区密码' : 'Workspace password') : detail === 'hosts' ? t('security.knownHostsTitle') : detail === 'privacy' ? (zh ? '隐私与自动锁定' : 'Privacy & auto-lock') : detail === 'plugins' ? t('settings.pluginSecurityMode') : detail === 'watchdog' ? 'Watchdog' : '';

  return <div className="space-y-7">
    {workspaceUnprotected && <div role="status" className="border-l-2 border-warn bg-warn/10 px-4 py-3 text-sm text-warn"><strong className="block font-medium">{zh ? '这个工作区没有密码' : 'This workspace has no password'}</strong><span className="mt-1 block text-xs">{zh ? '数据在磁盘上是加密的，但任何使用这台电脑的人都能打开它。' : 'Its data is encrypted on disk, but anyone using this computer can open it.'}</span><button type="button" onClick={() => setDetail(workspace?.isMain ? 'app' : 'vault')} className="mt-2 text-xs font-medium underline">{workspace?.isMain ? (zh ? '设置主密码' : 'Set a master password') : (zh ? '设置密码' : 'Set a password')}</button></div>}
    <div className="grid gap-6 lg:grid-cols-2">
      <SettingsSection title={zh ? '应用保护' : 'App protection'}>
        {rowAction('app', zh ? '主密码与恢复码' : 'Master password & recovery', zh ? '启动和锁定后要求主密码或系统验证；管理恢复码。' : 'Require the master password or system verification at launch and after locking; manage the recovery code.', zh ? '管理' : 'Manage')}
        {rowAction('privacy', t('security.privacyTitle'), zh ? '遮蔽敏感内容并设置自动锁定时间。' : 'Hide sensitive content and set auto-lock timeout.', zh ? '配置' : 'Configure')}
        {rowAction('plugins', t('settings.pluginSecurityMode'), zh ? '控制后端插件的执行权限。' : 'Control backend plugin execution permissions.', zh ? '管理' : 'Manage')}
      </SettingsSection>
      <SettingsSection title={`${zh ? '当前工作区' : 'Current workspace'} · ${workspace?.name || activeWorkspaceId}`}>
        {rowAction('vault', zh ? '工作区密码' : 'Workspace password', workspaceUnprotected ? (zh ? '没有密码' : 'No password') : (zh ? '受保护' : 'Protected'), zh ? '设置' : 'Set up')}
        {rowAction('hosts', t('security.knownHostsTitle'), zh ? '检查与撤销已信任的主机密钥。' : 'Review and revoke trusted host keys.', zh ? '管理' : 'Manage')}
        <SettingsRow label={t('workspaceCenter.sidebar.isolation', '隔离规则')} description={zh ? '当前工作区的文件、传输和导出边界。' : 'File, transfer and export boundaries for this workspace.'}><button type="button" onClick={openWorkspaceIsolation} className={settingButtonClass}>{zh ? '前往工作区' : 'Open workspace'}<ChevronRight className="h-3.5 w-3.5" /></button></SettingsRow>
      </SettingsSection>
    </div>
    <SettingsSection title={zh ? '检查与记录' : 'Checks & records'}>
      {rowAction('watchdog', 'Watchdog', !watchdogStatus ? (zh ? '尚未获得状态' : 'Status unavailable') : watchdogStatus.watchdogDisabled ? (zh ? '已禁用' : 'Disabled') : watchdogStatus.status === 'secure' ? (zh ? '正常' : 'Healthy') : watchdogStatus.reason || (zh ? '需要检查' : 'Needs attention'), zh ? '查看' : 'View')}
      <SettingsRow label={zh ? '安全与会话日志' : 'Security & session logs'} description={zh ? '连接历史、审计记录与录屏。' : 'Connection history, audit records and recordings.'}><button type="button" onClick={() => window.dispatchEvent(new CustomEvent('app:settings-tab', { detail: 'Audit' }))} className={settingButtonClass}>{zh ? '查看记录' : 'View logs'}<ChevronRight className="h-3.5 w-3.5" /></button></SettingsRow>
    </SettingsSection>

    {detail && <section className="border-t border-line pt-5" aria-label={detailName}>
      <div className="mb-5 flex items-center justify-between gap-3"><h2 className="text-base font-semibold">{detailName}</h2><button type="button" onClick={() => setDetail(null)} aria-label={zh ? '关闭详情' : 'Close details'} className="rounded-md p-1.5 text-ink-3 hover:bg-surf-2 hover:text-ink"><X className="h-4 w-4" /></button></div>
      {(detail === 'app' || detail === 'vault') && <SafeStorageTab section={detail} />}
      {detail === 'hosts' && <KnownHostsTab knownHosts={knownHosts} revokingHost={revokingHost} setRevokingHost={setRevokingHost} handleRevokeHost={async (host, port) => { try { await window.electronAPI.deleteKnownHost(host, port); setKnownHosts(previous => previous.filter(item => !(item.host === host && item.port === port))); setRevokingHost(null); } catch (error) { addToast(error instanceof Error ? error.message : (zh ? '撤销失败' : 'Could not revoke host'), 'error'); } }} />}
      {detail === 'privacy' && <SettingsSection title={zh ? '隐私' : 'Privacy'}><SettingsRow label={t('security.privacyMode')} description={t('security.privacyModeDesc')}><SettingsToggle checked={appConfig.privacyMode} onChange={checked => updateConfig('privacyMode', checked)} label={t('security.privacyMode')} /></SettingsRow><SettingsRow label={t('security.autoLockTitle')}><select value={appConfig.autoLockTimeout} onChange={event => updateConfig('autoLockTimeout', Number(event.target.value))} className={`${settingFieldClass} sm:w-44`}><option value={0}>{t('security.autoLockOff')}</option>{[5, 15, 30, 60].map(minutes => <option key={minutes} value={minutes}>{minutes === 60 ? `1 ${t('security.hour')}` : `${minutes} ${t('security.minutes')}`}</option>)}</select></SettingsRow></SettingsSection>}
      {detail === 'plugins' && <SettingsSection title={t('settings.pluginSecurityMode')} description={t('settings.pluginSecurityDesc')}><SettingsRow label={t('settings.pluginSecurityStrategy')} description={zh ? '安全模式不执行后端插件；开发者模式仅用于完全信任的代码。' : 'Safe mode skips backend plugins; developer mode is for fully trusted code only.'}><select disabled={pluginBusy} value={appConfig.pluginSecurityMode} onChange={event => void changePluginMode(event.target.value as typeof appConfig.pluginSecurityMode)} className={`${settingFieldClass} sm:w-52`}><option value="safe">{t('settings.pluginSecuritySafe')}</option><option value="strict">{t('settings.pluginSecurityStrict')}</option><option value="normal">{t('settings.pluginSecurityNormal')}</option><option value="developer">{t('settings.pluginSecurityDeveloper')}</option></select></SettingsRow></SettingsSection>}
      {detail === 'watchdog' && <SettingsSection title="Watchdog"><SettingsRow label={watchdogStatus?.watchdogDisabled ? (zh ? '已禁用' : 'Disabled') : watchdogStatus?.status === 'secure' ? (zh ? '正常' : 'Healthy') : (zh ? '需要检查' : 'Needs attention')} description={watchdogStatus?.reason || (watchdogStatus ? (zh ? '来自本机守护进程的当前状态。' : 'Current status from the local watchdog.') : (zh ? '尚未获得状态。' : 'Status unavailable.'))}><button type="button" onClick={() => void pollWatchdogStatus()} className={settingButtonClass}>{zh ? '重新检查' : 'Check again'}</button></SettingsRow></SettingsSection>}
    </section>}
  </div>;
};
