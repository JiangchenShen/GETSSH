import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to test the initialization side-effects of i18n.ts,
// which reads from localStorage synchronously upon module load.

describe('i18n Initialization', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules(); // Ensure the module is re-evaluated for each test

    // Mock localStorage
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => store[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value.toString();
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        for (const key in store) {
          delete store[key];
        }
      })
    });

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('sets the language correctly when valid JSON with language property is in localStorage', async () => {
    localStorage.setItem('appConfig', JSON.stringify({ language: 'zh-CN' }));
    const { default: i18n } = await import('./i18n');
    expect(i18n.language).toBe('zh-CN');
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('falls back to default (en-US) when valid JSON without language property is in localStorage', async () => {
    localStorage.setItem('appConfig', JSON.stringify({ someOtherKey: 'value' }));
    const { default: i18n } = await import('./i18n');
    expect(i18n.language).toBe('en-US');
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('falls back to default (en-US) and logs error when malformed JSON is in localStorage', async () => {
    localStorage.setItem('appConfig', 'malformed json string {');
    const { default: i18n } = await import('./i18n');
    expect(i18n.language).toBe('en-US');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to parse appConfig for i18n:',
      expect.any(SyntaxError)
    );
  });

  it('falls back to default (en-US) when localStorage is empty/null', async () => {
    const { default: i18n } = await import('./i18n');
    expect(i18n.language).toBe('en-US');
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
