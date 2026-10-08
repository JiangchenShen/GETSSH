import { describe, expect, it } from 'vitest';
import { clampScrollback } from './terminalLimits';

describe('clampScrollback', () => {
  it('keeps the scrollback between 1,000 and 100,000 lines', () => {
    expect(clampScrollback(10_000)).toBe(10_000);
    expect(clampScrollback(1_000_000)).toBe(100_000);
    expect(clampScrollback(2 ** 32)).toBe(100_000);
    expect(clampScrollback(50)).toBe(1_000);
    expect(clampScrollback(25_000.7)).toBe(25_000);
  });

  it('uses the default for what is not a positive number', () => {
    for (const value of [-5, 0, NaN, Infinity, '', 'lots', undefined, null]) expect(clampScrollback(value)).toBe(10_000);
  });
});
