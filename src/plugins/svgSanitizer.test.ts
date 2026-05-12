import { describe, it, expect, vi, afterEach } from 'vitest';
import { sanitizeSVG } from './svgSanitizer';

describe('sanitizeSVG edge cases', () => {
  const originalDOMParser = (global as any).DOMParser;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalDOMParser) {
      (global as any).DOMParser = originalDOMParser;
    } else {
      delete (global as any).DOMParser;
    }
  });

  it('should return empty string for non-string input', () => {
    // Mock console.error to avoid spamming logs during tests
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(sanitizeSVG('')).toBe('');
    // @ts-expect-error
    expect(sanitizeSVG(null)).toBe('');
    // @ts-expect-error
    expect(sanitizeSVG(undefined)).toBe('');
    // @ts-expect-error
    expect(sanitizeSVG(123)).toBe('');
  });

  it('should return empty string and log error when DOMParser throws', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Mock DOMParser to throw
    (global as any).DOMParser = vi.fn().mockImplementation(() => ({
      parseFromString: () => {
        throw new Error('Forced error');
      }
    })) as any;

    const result = sanitizeSVG('<svg></svg>');

    expect(result).toBe('');
    expect(consoleSpy).toHaveBeenCalledWith(
      '[PluginBridge] Failed to sanitize SVG:',
      expect.any(Error)
    );
  });
});
