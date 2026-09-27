import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../../store/appStore';
import { SettingsRow, SettingsSection, SettingsToggle, settingFieldClass } from '../SettingsControls';

export const SystemTab: React.FC = () => {
  const { t, i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const appConfig = useAppStore(state => state.appConfig);
  const updateConfig = useAppStore(state => state.updateConfig);

  return (
    <SettingsSection title={zh ? '日常使用' : 'Daily use'}>
      <SettingsRow label={t('settings.language')} description={zh ? '选择界面语言。' : 'Choose the interface language.'}>
        <select value={appConfig.language} onChange={event => updateConfig('language', event.target.value)} className={`${settingFieldClass} sm:w-48`}>
          <option value="en-US">English (US)</option>
          <option value="zh-CN">简体中文</option>
        </select>
      </SettingsRow>
      <SettingsRow label={t('system.globalHotkey')} description={t('system.globalHotkeyDesc')}>
        <input type="text" value={appConfig.globalHotkey || 'Control+`'} onChange={event => updateConfig('globalHotkey', event.target.value)} className={`${settingFieldClass} font-mono sm:w-48`} />
      </SettingsRow>
      <SettingsRow label={t('system.confirmQuit')} description={t('system.confirmQuitDesc')}>
        <SettingsToggle checked={appConfig.confirmQuit} onChange={checked => updateConfig('confirmQuit', checked)} label={t('system.confirmQuit')} />
      </SettingsRow>
    </SettingsSection>
  );
};
