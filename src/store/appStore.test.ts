import { test, describe, beforeEach, expect } from 'vitest';

// Mock localStorage
const localStorageStore: Record<string, string> = {};
global.localStorage = {
  getItem: (key: string) => localStorageStore[key] || null,
  setItem: (key: string, value: string) => { localStorageStore[key] = value; },
  removeItem: (key: string) => { delete localStorageStore[key]; },
  clear: () => {
    for (const key in localStorageStore) delete localStorageStore[key];
  }
} as any;

// @ts-ignore
global.window = {}; // Just in case
// @ts-ignore
global.document = { documentElement: { classList: { add: () => {}, remove: () => {} } } };

import { useAppStore, DEFAULT_CONFIG } from './appStore';

describe('useAppStore.loadStoredConfig', () => {
  beforeEach(() => {
    for (const key in localStorageStore) delete localStorageStore[key];
    useAppStore.setState({ appConfig: { ...DEFAULT_CONFIG } });
  });

  test('loads appConfig from localStorage and merges with DEFAULT_CONFIG', () => {
    localStorageStore['appConfig'] = JSON.stringify({ fontSize: 24, theme: 'dark' });

    useAppStore.getState().loadStoredConfig();

    const config = useAppStore.getState().appConfig;
    expect(config.fontSize).toBe(24);
    expect(config.theme).toBe('dark');
    expect(config.language).toBe('en-US'); // default value preserved
  });

  test('loads legacy themePref if appConfig is not present', () => {
    localStorageStore['themePref'] = 'light';

    useAppStore.getState().loadStoredConfig();

    const config = useAppStore.getState().appConfig;
    expect(config.theme).toBe('light');
    expect(config.fontSize).toBe(14); // default value preserved
  });

  test('does not throw when appConfig is invalid JSON', () => {
    localStorageStore['appConfig'] = '{ invalid json }';

    expect(() => {
      useAppStore.getState().loadStoredConfig();
    }).not.toThrow();

    const config = useAppStore.getState().appConfig;
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  test('does nothing if no config or legacy theme is present', () => {
    useAppStore.getState().loadStoredConfig();

    const config = useAppStore.getState().appConfig;
    expect(config).toEqual(DEFAULT_CONFIG);
  });
});
