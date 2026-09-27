import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../../store/appStore';
import { SettingsRow, SettingsSection, SettingsToggle, settingFieldClass } from '../SettingsControls';

const toHex = (rgb: string) => `#${rgb.split(' ').map(value => Number(value).toString(16).padStart(2, '0')).join('')}`;
const toRgb = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16)).join(' ');

const monoColors = [
  ['#176f60', '23 111 96'], ['#a855f7', '168 85 247'],
  ['#22c55e', '34 197 94'], ['#3b82f6', '59 130 246'], ['#ef4444', '239 68 68'],
] as const;
const duoColors = [
  ['#ffd700', '255 215 0', '#000000', '0 0 0'],
  ['#00d4ff', '0 212 255', '#2c2c34', '44 44 52'],
  ['#e61a23', '230 26 35', '#0a090c', '10 9 12'],
  ['#bfff00', '191 255 0', '#222222', '34 34 34'],
  ['#ff0080', '255 0 128', '#6a0dad', '106 13 173'],
] as const;

export const AppearanceTab: React.FC = () => {
  const { t, i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const appConfig = useAppStore(state => state.appConfig);
  const updateConfig = useAppStore(state => state.updateConfig);
  const colors = appConfig.duoTone;

  return <div className="space-y-7">
    <SettingsSection title={zh ? '界面外观' : 'Interface appearance'}>
      <SettingsRow label={t('settings.appTheme')} description={zh ? '跟随系统，或固定使用浅色／深色。' : 'Follow the system or choose a fixed appearance.'}>
        <div className="flex gap-1 rounded-md border border-line bg-panel p-1">
          {(['system', 'light', 'dark'] as const).map(theme => <button key={theme} type="button" onClick={() => updateConfig('theme', theme)} aria-pressed={appConfig.theme === theme} className={`min-h-8 rounded px-3 text-xs transition-colors ${appConfig.theme === theme ? 'bg-surf-2 font-medium text-ink' : 'text-ink-3 hover:text-ink'}`}>{t(`settings.${theme === 'system' ? 'systemTheme' : theme}`)}</button>)}
        </div>
      </SettingsRow>
      <SettingsRow label={t('appearance.enableGlassmorphism')} description={zh ? '侧栏使用轻毛玻璃；系统要求减少透明度时自动关闭。' : 'A subtle frosted sidebar, disabled when the system reduces transparency.'}>
        <SettingsToggle checked={appConfig.enableGlassmorphism} onChange={checked => updateConfig('enableGlassmorphism', checked)} label={t('appearance.enableGlassmorphism')} />
      </SettingsRow>
      {appConfig.enableGlassmorphism && <SettingsRow label={zh ? '背景不透明度' : 'Background opacity'} description={`${Math.round((appConfig.bgOpacity ?? 1) * 100)}%`}>
        <input type="range" min={0.25} max={1} step={0.05} value={appConfig.bgOpacity ?? 1} onChange={event => updateConfig('bgOpacity', Number(event.target.value))} className="w-44 accent-primary" aria-label={zh ? '背景不透明度' : 'Background opacity'} />
      </SettingsRow>}
    </SettingsSection>

    <SettingsSection title={t('appearance.themeColorsTitle')} description={zh ? '选择单色，或保留双轨配色。' : 'Choose a single accent or keep a two-color theme.'}>
      <SettingsRow label={t('appearance.monoColor')} stacked>
        <div className="flex flex-wrap gap-2">
          {monoColors.map(([hex, value]) => <button key={value} type="button" onClick={() => { updateConfig('themeColor', value); updateConfig('duoTone', null); }} aria-label={`${t('appearance.monoColor')} ${hex}`} aria-pressed={!colors && appConfig.themeColor === value} className={`h-8 w-8 rounded-md border border-line focus-visible:outline-2 focus-visible:outline-primary ${!colors && appConfig.themeColor === value ? 'ring-2 ring-primary ring-offset-2 ring-offset-bg' : ''}`} style={{ backgroundColor: hex }} />)}
          <label className="flex items-center gap-2 text-xs text-ink-2">{t('appearance.custom')} <input type="color" value={toHex(appConfig.themeColor || '23 111 96')} onChange={event => { updateConfig('themeColor', toRgb(event.target.value)); updateConfig('duoTone', null); }} className="h-8 w-9 cursor-pointer rounded border border-line bg-panel p-0.5" aria-label={t('appearance.custom')} /></label>
        </div>
      </SettingsRow>
      <SettingsRow label={t('appearance.duoTone')} stacked>
        <div className="flex flex-wrap gap-2">
          {duoColors.map(([aHex, a, bHex, b]) => <button key={`${a}-${b}`} type="button" onClick={() => updateConfig('duoTone', { colorA: a, colorB: b })} aria-label={`${t('appearance.duoTone')} ${aHex} ${bHex}`} aria-pressed={colors?.colorA === a && colors?.colorB === b} className={`flex h-8 w-8 overflow-hidden rounded-md border border-line focus-visible:outline-2 focus-visible:outline-primary ${colors?.colorA === a && colors?.colorB === b ? 'ring-2 ring-primary ring-offset-2 ring-offset-bg' : ''}`}><span className="h-full w-1/2" style={{ backgroundColor: aHex }} /><span className="h-full w-1/2" style={{ backgroundColor: bHex }} /></button>)}
        </div>
      </SettingsRow>
      {colors && <SettingsRow label={zh ? '自定义双轨色' : 'Custom two-color theme'}>
        <div className="flex items-center gap-2">
          <input type="color" value={toHex(colors.colorA)} onChange={event => updateConfig('duoTone', { ...colors, colorA: toRgb(event.target.value) })} aria-label={zh ? '轨道 A' : 'Track A'} className={`${settingFieldClass} h-9 w-12 cursor-pointer p-1`} />
          <input type="color" value={toHex(colors.colorB)} onChange={event => updateConfig('duoTone', { ...colors, colorB: toRgb(event.target.value) })} aria-label={zh ? '轨道 B' : 'Track B'} className={`${settingFieldClass} h-9 w-12 cursor-pointer p-1`} />
          <span className="font-mono text-xs text-ink-3">{toHex(colors.colorA)} / {toHex(colors.colorB)}</span>
        </div>
      </SettingsRow>}
    </SettingsSection>
  </div>;
};
