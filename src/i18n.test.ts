import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('./locales/en-US.json', () => ({
  default: {
    translation: {
      about: {
        title: "About MOCK"
      },
      sftp: {
        deleteConfirm: "Delete {{name}}?"
      }
    }
  }
}));

vi.mock('./locales/zh-CN.json', () => ({
  default: {
    translation: {
      about: {
        title: "关于 MOCK"
      }
    }
  }
}));

describe('i18n configuration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(),
      setItem: vi.fn(),
      clear: vi.fn(),
    });
  });

  it('should use en-US by default when localStorage is empty', async () => {
    vi.mocked(localStorage.getItem).mockReturnValue(null);
    const i18nModule = await import('./i18n');
    const i18n = i18nModule.default;
    expect(i18n.language).toBe('en-US');
  });

  it('should use language from localStorage if valid', async () => {
    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify({ language: 'zh-CN' }));
    const i18nModule = await import('./i18n');
    const i18n = i18nModule.default;
    expect(i18n.language).toBe('zh-CN');
  });

  it('should fallback to en-US if localStorage contains invalid JSON', async () => {
    vi.mocked(localStorage.getItem).mockReturnValue('{ invalid json');
    const i18nModule = await import('./i18n');
    const i18n = i18nModule.default;
    expect(i18n.language).toBe('en-US');
  });

  it('should fallback to en-US if localStorage json lacks language', async () => {
    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify({ someOtherKey: 'value' }));
    const i18nModule = await import('./i18n');
    const i18n = i18nModule.default;
    expect(i18n.language).toBe('en-US');
  });
});

describe('i18next translation instance', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(),
    });
  });

  it('should return translated string without values', async () => {
    vi.mocked(localStorage.getItem).mockReturnValue(null);
    const { default: i18n } = await import('./i18n');
    // Ensure initialization is complete
    await i18n.init();
    expect(i18n.t('about.title')).toBe('About MOCK');
  });

  it('should return translated string with correct language', async () => {
    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify({ language: 'zh-CN' }));
    const { default: i18n } = await import('./i18n');
    await i18n.init();
    expect(i18n.t('about.title')).toBe('关于 MOCK');
  });

  it('should replace values in translation string', async () => {
    vi.mocked(localStorage.getItem).mockReturnValue(null);
    const { default: i18n } = await import('./i18n');
    await i18n.init();
    expect(i18n.t('sftp.deleteConfirm', { name: 'file.txt' })).toBe('Delete file.txt?');
  });

  it('should fallback to key if not found', async () => {
    vi.mocked(localStorage.getItem).mockReturnValue(null);
    const { default: i18n } = await import('./i18n');
    await i18n.init();
    expect(i18n.t('non.existent.key')).toBe('non.existent.key');
  });
});
