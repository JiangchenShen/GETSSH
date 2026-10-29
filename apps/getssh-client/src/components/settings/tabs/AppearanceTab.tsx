import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../../store/appStore';
import { SettingsRow, SettingsSection, SettingsToggle } from '../SettingsControls';

export const AppearanceTab: React.FC = () => {
  const { t, i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const appConfig = useAppStore(state => state.appConfig);
  const updateConfig = useAppStore(state => state.updateConfig);

  return <div className="space-y-7">
    <SettingsSection title={zh ? '界面外观' : 'Interface appearance'}>
      <SettingsRow label={t('settings.appTheme')} description={zh ? '跟随系统，或固定使用浅色／深色。' : 'Follow the system or choose a fixed appearance.'}>
        <div className="flex gap-1 rounded-md border border-line bg-panel p-1">
          {(['system', 'light', 'dark'] as const).map(theme => <button key={theme} type="button" onClick={() => updateConfig('theme', theme)} aria-pressed={appConfig.theme === theme} className={`min-h-8 rounded px-3 text-xs transition-colors ${appConfig.theme === theme ? 'bg-surf-2 font-medium text-ink' : 'text-ink-3 hover:text-ink'}`}>{t(`settings.${theme === 'system' ? 'systemTheme' : theme}`)}</button>)}
        </div>
      </SettingsRow>
      <SettingsRow label={t('appearance.enableGlassmorphism')} description={zh ? '导航区域使用毛玻璃；系统要求减少透明度时自动关闭。' : 'Frosted navigation, disabled when the system reduces transparency.'}>
        <SettingsToggle checked={appConfig.enableGlassmorphism} onChange={checked => updateConfig('enableGlassmorphism', checked)} label={t('appearance.enableGlassmorphism')} />
      </SettingsRow>
      {appConfig.enableGlassmorphism && <SettingsRow label={zh ? '导航背景不透明度' : 'Navigation background opacity'} description={`${Math.round((appConfig.bgOpacity ?? 1) * 100)}%`}>
        <input type="range" min={0.25} max={1} step={0.05} value={appConfig.bgOpacity ?? 1} onChange={event => updateConfig('bgOpacity', Number(event.target.value))} className="w-44 accent-primary" aria-label={zh ? '导航背景不透明度' : 'Navigation background opacity'} />
      </SettingsRow>}
    </SettingsSection>
  </div>;
};
