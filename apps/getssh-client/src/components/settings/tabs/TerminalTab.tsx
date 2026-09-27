import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../../store/appStore';
import { parseCustomTheme } from '../../../utils/themes';
import { SettingsRow, SettingsSection, SettingsToggle, settingButtonClass, settingDangerButtonClass, settingFieldClass } from '../SettingsControls';

export const TerminalTab: React.FC = () => {
  const { t, i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const isDark = useAppStore(state => state.isDark);
  const appConfig = useAppStore(state => state.appConfig);
  const updateConfig = useAppStore(state => state.updateConfig);

  const handleImportTheme = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = result => {
      const theme = parseCustomTheme(result.target?.result as string);
      if (theme) {
        const key = `custom_${file.name.replace(/\.json$/i, '')}`;
        updateConfig('customThemes', { ...(appConfig.customThemes || {}), [key]: theme });
        updateConfig('terminalTheme', key);
        window.alert(t('appearance.importSuccess'));
      } else {
        window.alert(t('appearance.importFail'));
      }
      event.target.value = '';
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-7">
      <SettingsSection title={zh ? '字体与布局' : 'Typography & layout'}>
        <SettingsRow label={t('terminal.fontFamily')}>
          <select value={appConfig.fontFamily} onChange={event => updateConfig('fontFamily', event.target.value)} className={`${settingFieldClass} sm:w-60`}>
            <option value='"Fira Code", monospace, "Courier New", Courier'>Fira Code</option>
            <option value='"Consolas", "Courier New", monospace'>Consolas / Courier</option>
            <option value='"Menlo", "Monaco", "Courier New", monospace'>Menlo / Monaco</option>
          </select>
        </SettingsRow>
        <SettingsRow label={t('terminal.fontSize')}>
          <input type="number" min={8} max={48} value={appConfig.fontSize || 14} onChange={event => updateConfig('fontSize', parseInt(event.target.value, 10) || 14)} className={`${settingFieldClass} font-mono sm:w-28`} />
        </SettingsRow>
        <SettingsRow label={t('terminal.lineHeight')}>
          <input type="number" min={0.8} max={3} step={0.1} value={appConfig.lineHeight || 1.2} onChange={event => updateConfig('lineHeight', parseFloat(event.target.value) || 1.2)} className={`${settingFieldClass} font-mono sm:w-28`} />
        </SettingsRow>
        <SettingsRow label={t('terminal.terminalPadding')} description={`${appConfig.terminalPadding ?? 8}px · ${t('terminal.terminalPaddingDesc')}`}>
          <input type="range" min={0} max={32} step={2} value={appConfig.terminalPadding ?? 8} onChange={event => updateConfig('terminalPadding', parseInt(event.target.value, 10))} className="w-44 accent-primary" aria-label={t('terminal.terminalPadding')} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={zh ? '显示' : 'Display'}>
        <SettingsRow label={t('appearance.terminalTheme')} description={zh ? '只改变终端内容的颜色。' : 'Colors of the terminal content.'} stacked>
          <div className="flex flex-wrap items-center gap-2">
            <select value={appConfig.terminalTheme || 'default'} onChange={event => updateConfig('terminalTheme', event.target.value)} className={`${settingFieldClass} min-w-[180px] flex-1`}>
              <option value="default">{t('appearance.themeDefault')}</option>
              <option value="dracula">Dracula</option><option value="nord">Nord</option><option value="gruvbox">Gruvbox</option>
              <option value="tokyo-night">Tokyo Night</option><option value="catppuccin">Catppuccin</option>
              <option value="monokai">Monokai</option><option value="solarized">Solarized</option>
              {Object.keys(appConfig.customThemes || {}).map(key => <option key={key} value={key}>{key.replace('custom_', '')}</option>)}
            </select>
            <label className={`${settingButtonClass} cursor-pointer`}>
              {t('appearance.importTheme')}
              <input type="file" accept=".json" onChange={handleImportTheme} className="sr-only" />
            </label>
            {appConfig.terminalTheme?.startsWith('custom_') && <button type="button" className={settingDangerButtonClass} onClick={() => {
              const customThemes = { ...(appConfig.customThemes || {}) };
              delete customThemes[appConfig.terminalTheme];
              updateConfig('customThemes', customThemes);
              updateConfig('terminalTheme', 'default');
            }}>{t('appearance.deleteTheme')}</button>}
          </div>
        </SettingsRow>
        <SettingsRow label={t('settings.antiGlare')} description={t('settings.antiGlareDesc')}>
          <SettingsToggle checked={!!appConfig.antiGlare} onChange={checked => updateConfig('antiGlare', checked)} label={t('settings.antiGlare')} disabled={!isDark} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={zh ? '交互' : 'Interaction'}>
        <SettingsRow label={zh ? '光标形状' : 'Cursor style'}>
          <select value={appConfig.cursorStyle} onChange={event => updateConfig('cursorStyle', event.target.value as 'block' | 'underline' | 'bar')} className={`${settingFieldClass} sm:w-40`}>
            <option value="block">{t('terminal.block')}</option><option value="underline">{t('terminal.underline')}</option><option value="bar">{t('terminal.bar')}</option>
          </select>
        </SettingsRow>
        <SettingsRow label={t('terminal.cursorBlink')} description={t('terminal.cursorBlinkDesc')}>
          <SettingsToggle checked={appConfig.cursorBlink ?? true} onChange={checked => updateConfig('cursorBlink', checked)} label={t('terminal.cursorBlink')} />
        </SettingsRow>
        <SettingsRow label={zh ? '右键行为' : 'Right-click behavior'}>
          <select value={appConfig.rightClickBehavior || 'menu'} onChange={event => updateConfig('rightClickBehavior', event.target.value as 'menu' | 'paste')} className={`${settingFieldClass} sm:w-40`}>
            <option value="menu">{t('terminal.rightClickMenu')}</option><option value="paste">{t('terminal.rightClickPaste')}</option>
          </select>
        </SettingsRow>
        <SettingsRow label={t('terminal.copyOnSelect')} description={t('terminal.copyOnSelectDesc')}>
          <SettingsToggle checked={appConfig.copyOnSelect} onChange={checked => updateConfig('copyOnSelect', checked)} label={t('terminal.copyOnSelect')} />
        </SettingsRow>
        <SettingsRow label={t('terminal.scrollback')} description={t('terminal.scrollbackNote')}>
          <input type="number" min={1000} step={1000} value={appConfig.scrollback || 10000} onChange={event => updateConfig('scrollback', parseInt(event.target.value, 10) || 10000)} className={`${settingFieldClass} font-mono sm:w-28`} />
        </SettingsRow>
        <SettingsRow label={t('terminal.bellStyle')}>
          <select value={appConfig.bellStyle || 'visual'} onChange={event => updateConfig('bellStyle', event.target.value as 'none' | 'audible' | 'visual')} className={`${settingFieldClass} sm:w-40`}>
            <option value="none">{t('terminal.bellNone')}</option><option value="audible">{t('terminal.bellAudible')}</option><option value="visual">{t('terminal.bellVisual')}</option>
          </select>
        </SettingsRow>
      </SettingsSection>
    </div>
  );
};
