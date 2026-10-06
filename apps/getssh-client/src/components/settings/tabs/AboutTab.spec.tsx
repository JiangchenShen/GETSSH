// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createInstance, type i18n } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import enUS from '../../../locales/en-US.json';
import zhCN from '../../../locales/zh-CN.json';

const mocks = vi.hoisted(() => ({ language: 'en-US' }));
vi.mock('../../../../package.json', () => ({
  version: '9.7.3-rc.4',
  build: { productName: 'GETSSH' },
  getsshRelease: { stage: 'RC', edition: 'FUSION', program: 'preview' },
}));
vi.mock('../../../store/appStore', () => ({
  useAppStore: (select: (state: any) => any) => select({ appConfig: { language: mocks.language } }),
}));

import { AboutTab } from './AboutTab';

let root: Root;
let container: HTMLDivElement;
let translation: i18n;
const openExternal = vi.fn();
const checkForUpdates = vi.fn();

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.language = 'en-US';
  translation = createInstance();
  await translation.use(initReactI18next).init({
    resources: { 'en-US': enUS, 'zh-CN': zhCN },
    lng: mocks.language,
    fallbackLng: 'en-US',
    interpolation: { escapeValue: false },
  });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.electronAPI = {
    getEnvInfo: () => ({ electron: '44.5.1', chrome: '152.0', node: '24.21.0', platform: 'darwin', arch: 'arm64' }),
    openExternal, checkForUpdates,
  } as unknown as Window['electronAPI'];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const render = () => act(async () => root.render(<I18nextProvider i18n={translation}><AboutTab /></I18nextProvider>));

describe('About release metadata', () => {
  it.each([
    ['en-US', 'Preview Program'],
    ['zh-CN', '预览版计划'],
  ])('derives %s release identity from the package and keeps platform and legal information', async (language, program) => {
    mocks.language = language;
    await translation.changeLanguage(language);
    await render();
    expect(container.querySelector('h2')?.textContent).toBe('GETSSH 9.7 RC');
    expect(container.textContent).toContain(`FUSION · ${program}`);
    expect(container.textContent).toContain('9.7.3-rc.4');
    expect(container.textContent).toContain('44.5.1');
    expect(container.textContent).toContain('macOS');
    expect(container.textContent).toContain('ARM64');
    expect(container.textContent).not.toContain('R7K4S');
    expect(container.textContent).not.toContain('F0A0G');
    expect(container.textContent).toContain('xterm.js');
    expect(container.textContent).toContain(language.startsWith('zh') ? '版权所有 © 2026' : 'Copyright © 2026');
    const links = [...container.querySelectorAll<HTMLButtonElement>('button')].slice(0, 3);
    for (const link of links) await act(async () => link.click());
    expect(openExternal.mock.calls.map(call => call[0])).toEqual(['terms', 'privacy', 'licenses'].map(slug => `https://getssh.realmcloud.net/${language.startsWith('zh') ? 'zh' : 'en'}/legal/${slug}`));
  });

  it('preserves update checking and its busy state alongside the release identity', async () => {
    let finish!: (result: { hasUpdate: boolean }) => void;
    checkForUpdates.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    await render();
    const update = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === translation.t('about.checkUpdates'))!;
    await act(async () => update.click());
    expect(checkForUpdates).toHaveBeenCalledOnce();
    expect(update.disabled).toBe(true);
    expect(update.textContent).toBe(translation.t('about.checkingUpdates'));
    expect(container.querySelector('h2')?.textContent).toBe('GETSSH 9.7 RC');
    await act(async () => finish({ hasUpdate: false }));
    expect(update.disabled).toBe(false);
    expect(alert).toHaveBeenCalledWith(translation.t('update.latest'));
  });
});
