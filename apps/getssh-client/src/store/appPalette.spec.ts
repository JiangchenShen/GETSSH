// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, useAppStore } from './appStore';

const originalApi = window.electronAPI;
const legacyProperties = ['--primary-color', '--color-a', '--color-b', '--center-custom-accent', '--center-custom-accent-ink'];
const legacyConfig = {
  ...DEFAULT_CONFIG, theme: 'light' as const, themeColor: '255 0 128', duoTone: { colorA: '255 0 128', colorB: '0 0 0' },
  terminalTheme: 'custom_reading', customThemes: { custom_reading: { background: '#282a36', foreground: '#f8f8f2' } },
  enableGlassmorphism: true, bgOpacity: 0.4,
};

beforeEach(() => {
  window.electronAPI = {} as any;
  localStorage.clear();
  useAppStore.setState({ appConfig: { ...DEFAULT_CONFIG }, systemIsDark: true, isConfigLoaded: false });
  for (const name of legacyProperties) document.documentElement.style.setProperty(name, '255 0 128');
});
afterEach(() => {
  window.electronAPI = originalApi;
  localStorage.clear();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-glass');
  document.documentElement.classList.remove('dark');
});

describe('fixed application palette', () => {
  it.each(['main', 'torn', 'refresh'] as const)('ignores legacy custom accents during %s configuration loading', async entry => {
    localStorage.setItem('appConfig', JSON.stringify(legacyConfig));
    if (entry === 'main') await useAppStore.getState().loadStoredConfig();
    else if (entry === 'torn') useAppStore.getState().loadConfigReadOnly();
    else {
      useAppStore.setState({ appConfig: legacyConfig });
      useAppStore.getState().refreshConfigVisuals();
    }
    for (const name of legacyProperties) expect(document.documentElement.style.getPropertyValue(name)).toBe('');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.dataset.glass).toBe('true');
    expect(document.documentElement.style.getPropertyValue('--sidebar-opacity')).toBe('40%');
    expect(useAppStore.getState().appConfig.terminalTheme).toBe(legacyConfig.terminalTheme);
    expect(useAppStore.getState().appConfig.customThemes).toEqual(legacyConfig.customThemes);
    if (entry === 'torn') expect(JSON.parse(localStorage.getItem('appConfig')!)).toEqual(legacyConfig);
  });

  it.each([['light', true, false], ['dark', false, true], ['system', true, true], ['system', false, false]] as const)('keeps %s mode with system dark=%s', (theme, systemIsDark, expected) => {
    useAppStore.setState({ appConfig: { ...legacyConfig, theme, enableGlassmorphism: false }, systemIsDark });
    useAppStore.getState().refreshConfigVisuals();
    expect(useAppStore.getState().isDark).toBe(expected);
    expect(document.documentElement.classList.contains('dark')).toBe(expected);
    expect(document.documentElement.dataset.glass).toBe('false');
  });
});
