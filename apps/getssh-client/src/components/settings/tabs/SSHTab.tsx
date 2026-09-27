import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../../store/appStore';
import { SettingsRow, SettingsSection, settingButtonClass, settingDangerButtonClass, settingFieldClass } from '../SettingsControls';

export const SSHTab: React.FC = () => {
  const { t, i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const appConfig = useAppStore(state => state.appConfig);
  const updateConfig = useAppStore(state => state.updateConfig);

  return (
    <div className="space-y-7">
      <SettingsSection title={zh ? 'SSH 默认值' : 'SSH defaults'}>
        <SettingsRow label={t('ssh.port')} description={zh ? '新连接默认使用的端口。' : 'Default port for new connections.'}>
          <input type="number" min={1} max={65535} value={appConfig.defaultPort || 22} onChange={event => updateConfig('defaultPort', parseInt(event.target.value, 10) || 22)} className={`${settingFieldClass} font-mono sm:w-28`} />
        </SettingsRow>
        <SettingsRow label={t('ssh.keepAlive')} description={t('ssh.keepAliveDesc')}>
          <div className="flex items-center gap-2"><input type="number" min={0} value={appConfig.keepalive || 0} onChange={event => updateConfig('keepalive', parseInt(event.target.value, 10) || 0)} className={`${settingFieldClass} font-mono sm:w-28`} /><span className="text-xs text-ink-3">{t('settings.seconds')}</span></div>
        </SettingsRow>
        <SettingsRow label={t('ssh.proxyType')} description={zh ? '供默认 SSH 连接使用。' : 'Used by default SSH connections.'}>
          <select value={appConfig.proxyType} onChange={event => updateConfig('proxyType', event.target.value as 'none' | 'http' | 'socks5')} className={`${settingFieldClass} sm:w-48`}>
            <option value="none">{t('ssh.proxyNone')}</option><option value="http">{t('ssh.proxyHttp')}</option><option value="socks5">{t('ssh.proxySocks5')}</option>
          </select>
        </SettingsRow>
        {appConfig.proxyType !== 'none' && <SettingsRow label={t('ssh.proxyHost')} description={t('ssh.proxyPort')}>
          <div className="flex gap-2"><input type="text" value={appConfig.proxyHost || ''} onChange={event => updateConfig('proxyHost', event.target.value)} className={`${settingFieldClass} min-w-0 flex-1 font-mono`} aria-label={t('ssh.proxyHost')} /><input type="number" min={1} max={65535} value={appConfig.proxyPort || 1080} onChange={event => updateConfig('proxyPort', parseInt(event.target.value, 10) || 1080)} className={`${settingFieldClass} w-20 font-mono`} aria-label={t('ssh.proxyPort')} /></div>
        </SettingsRow>}
      </SettingsSection>

      <SettingsSection title={zh ? '文件传输' : 'File transfer'}>
        <SettingsRow label={t('settings.sftpDownloadPath')} description={zh ? 'SFTP 下载的默认本地目录。' : 'Default local folder for SFTP downloads.'} stacked>
          <div className="flex flex-wrap items-center gap-2">
            <input type="text" readOnly value={appConfig.sftpDownloadPath || ''} placeholder={zh ? '系统下载目录' : 'System Downloads folder'} className={`${settingFieldClass} min-w-[180px] flex-1 font-mono`} />
            <button type="button" onClick={async () => { const path = await window.electronAPI.selectFolder(); if (path) updateConfig('sftpDownloadPath', path); }} className={settingButtonClass}>{t('settings.browse')}</button>
            {appConfig.sftpDownloadPath && <button type="button" onClick={() => updateConfig('sftpDownloadPath', '')} className={settingDangerButtonClass}>{t('settings.clearCustomPath')}</button>}
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={zh ? '连接自动化' : 'Connection automation'}>
        <SettingsRow label={t('security.globalInitScript')} description={t('security.globalInitScriptDesc')} stacked>
          <textarea value={appConfig.initScript || ''} onChange={event => updateConfig('initScript', event.target.value)} rows={5} placeholder={t('security.globalInitScriptPlaceholder') as string} className={`${settingFieldClass} resize-y font-mono`} />
        </SettingsRow>
      </SettingsSection>
    </div>
  );
};
