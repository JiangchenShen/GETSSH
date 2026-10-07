import React, { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { useAppStore } from '../../../store/appStore';
import { build as buildConfig, getsshRelease, version as appVersion } from '../../../../package.json';
import logoSrc from '../../../assets/logo.png';
import { SettingsRow, SettingsSection, settingButtonClass } from '../SettingsControls';

export const AboutTab: React.FC = () => {
  const { t, i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const language = useAppStore(state => state.appConfig.language);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const env = window.electronAPI?.getEnvInfo?.();
  const platform = env?.platform === 'darwin' ? 'macOS' : env?.platform === 'win32' ? 'Windows' : env?.platform || '—';
  const architecture = env?.arch === 'arm64' ? 'ARM64' : env?.arch === 'x64' ? 'x86_64' : env?.arch || '—';
  const languagePath = language?.startsWith('zh') ? 'zh' : 'en';
  const releaseVersion = appVersion.split('.').slice(0, 2).join('.');
  const releaseProgram = getsshRelease.program === 'preview' ? t('about.previewProgram') : getsshRelease.program;

  const checkForUpdates = async () => {
    setCheckingUpdate(true);
    try {
      const result = await window.electronAPI.checkForUpdates();
      if (result.hasUpdate) {
        window.alert(t('update.found', { version: result.version }));
        if (result.url) window.electronAPI.openExternal(result.url);
      } else if (result.error) {
        window.alert(t('update.failed', { reason: result.error }));
      } else {
        window.alert(t('update.latest'));
      }
    } catch (error) {
      window.alert(t('update.networkError', { message: error instanceof Error ? error.message : String(error) }));
    } finally {
      setCheckingUpdate(false);
    }
  };

  return <div className="space-y-8">
    <div className="flex items-center gap-4">
      <img src={logoSrc} alt="" className="h-14 w-14 rounded-xl border border-line object-cover" />
      <div className="min-w-0">
        <h2 className="break-words text-lg font-semibold text-ink">{buildConfig.productName} {releaseVersion} {getsshRelease.stage}</h2>
        <p className="mt-1 text-xs text-ink-3">{getsshRelease.edition} · {releaseProgram}</p>
      </div>
    </div>

    <SettingsSection title={t('about.versionCore')}>
      <SettingsRow label={t('settings.version')}><span className="font-mono text-xs text-ink-2">{appVersion}</span></SettingsRow>
      <SettingsRow label={t('about.envElectron')}><span className="font-mono text-xs text-ink-2">{env?.electron || '—'}</span></SettingsRow>
      <SettingsRow label={t('about.envChrome')}><span className="font-mono text-xs text-ink-2">{env?.chrome || '—'}</span></SettingsRow>
      <SettingsRow label={t('about.envNode')}><span className="font-mono text-xs text-ink-2">{env?.node || '—'}</span></SettingsRow>
    </SettingsSection>

    <SettingsSection title={t('about.hostPlatform')}>
      <SettingsRow label={t('about.envPlatform')}><span className="text-sm text-ink-2">{platform}</span></SettingsRow>
      <SettingsRow label={zh ? '处理器架构' : 'Architecture'}><span className="font-mono text-xs text-ink-2">{architecture}</span></SettingsRow>
    </SettingsSection>

    <SettingsSection title={t('about.compliance')}>
      {([
        ['tos', 'terms'],
        ['privacy', 'privacy'],
        ['licenses', 'licenses'],
      ] as const).map(([key, slug]) => <SettingsRow key={key} label={t(`about.${key}`)}>
        <button type="button" onClick={() => window.electronAPI.openExternal(`https://getssh.realmcloud.net/${languagePath}/legal/${slug}`)} className={settingButtonClass}>
          {zh ? '查看' : 'Open'}<ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </SettingsRow>)}
    </SettingsSection>

    <SettingsSection title={zh ? '软件更新' : 'Software updates'}>
      <SettingsRow label={zh ? '检查新版本' : 'Check for a new version'} description={zh ? '获取稳定性修复与安全更新。' : 'Get stability fixes and security updates.'}>
        <button type="button" onClick={() => void checkForUpdates()} disabled={checkingUpdate} className={settingButtonClass}>
          {checkingUpdate ? t('about.checkingUpdates') : t('about.checkUpdates')}
        </button>
      </SettingsRow>
    </SettingsSection>

    <div className="space-y-3 text-xs leading-relaxed text-ink-3">
      <p><Trans i18nKey="about.openSourceDesc" components={{ strong: <strong className="font-medium text-ink-2" /> }} /></p>
      <p>{t('about.copyright')}</p>
    </div>
  </div>;
};
