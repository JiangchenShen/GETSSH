import { describe, it, expect } from 'vitest';
import { applyOpacity } from './themes';

describe('applyOpacity', () => {
  it('applies opacity to a valid 6-character hex code starting with #', () => {
    // 0.5 * 255 = 127.5 -> 128 -> '80'
    expect(applyOpacity('#ff0000', 0.5)).toBe('#ff000080');

    // 1.0 * 255 = 255 -> 'ff'
    expect(applyOpacity('#00ff00', 1)).toBe('#00ff00ff');

    // 0.0 * 255 = 0 -> '00'
    expect(applyOpacity('#0000ff', 0)).toBe('#0000ff00');
  });

  it('applies opacity to a valid 6-character hex code without #', () => {
    expect(applyOpacity('ff0000', 0.5)).toBe('#ff000080');
  });

  it('returns the original input if it is transparent', () => {
    expect(applyOpacity('transparent', 0.5)).toBe('transparent');
  });

  it('returns the original input if it starts with rgba', () => {
    expect(applyOpacity('rgba(255, 0, 0, 0.5)', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
    expect(applyOpacity('rgba(0,0,0,1)', 0.8)).toBe('rgba(0,0,0,1)');
  });

  it('returns the original input if it is falsy', () => {
    expect(applyOpacity('', 0.5)).toBe('');
  });

  it('returns the original input if the hex code is not 6 characters long', () => {
    expect(applyOpacity('#fff', 0.5)).toBe('#fff');
    expect(applyOpacity('fff', 0.5)).toBe('fff');
    expect(applyOpacity('#ff000000', 0.5)).toBe('#ff000000');
    expect(applyOpacity('ff000000', 0.5)).toBe('ff000000');
    expect(applyOpacity('invalid', 0.5)).toBe('invalid');
  });

  it('correctly calculates fractional opacities', () => {
    // 0.1 * 255 = 25.5 -> 26 -> '1a'
    expect(applyOpacity('#123456', 0.1)).toBe('#1234561a');

    // 0.9 * 255 = 229.5 -> 230 -> 'e6'
    expect(applyOpacity('#abcdef', 0.9)).toBe('#abcdefe6');
  });
});
