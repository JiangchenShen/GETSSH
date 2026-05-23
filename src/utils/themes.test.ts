import { describe, it, expect } from 'vitest';
import { parseCustomTheme, applyOpacity } from './themes';

describe('themes utility', () => {
  describe('applyOpacity', () => {
    it('applies opacity to a valid 6-character hex code starting with #', () => {
      // 0.5 opacity * 255 = 127.5 -> 128 -> '80'
      expect(applyOpacity('#ff0000', 0.5)).toBe('#ff000080');
      expect(applyOpacity('#000000', 0.5)).toBe('#00000080');

      // 1.0 opacity * 255 = 255 -> 'ff'
      expect(applyOpacity('#00ff00', 1)).toBe('#00ff00ff');
      expect(applyOpacity('#ffffff', 1)).toBe('#ffffffff');

      // 0.0 opacity * 255 = 0 -> '00'
      expect(applyOpacity('#0000ff', 0)).toBe('#0000ff00');
      expect(applyOpacity('#abcdef', 0)).toBe('#abcdef00');
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
      expect(applyOpacity('#123', 0.5)).toBe('#123');
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

  describe('parseCustomTheme', () => {
    it('returns null for invalid JSON string', () => {
      expect(parseCustomTheme('{invalid json}')).toBeNull();
      expect(parseCustomTheme('')).toBeNull();
    });

    it('returns null for non-object JSON values', () => {
      expect(parseCustomTheme('"just a string"')).toBeNull();
      expect(parseCustomTheme('null')).toBeNull();
      expect(parseCustomTheme('123')).toBeNull();
      expect(parseCustomTheme('[]')).toBeNull(); // handled by flatting check or just no background found
    });

    it('returns null if no background is found', () => {
      expect(parseCustomTheme('{"foreground": "#ffffff"}')).toBeNull();
    });

    it('parses valid simple flat custom theme', () => {
      const themeString = JSON.stringify({
        background: '#000000',
        foreground: '#ffffff',
        cursor: '#aaaaaa',
        black: '#111111',
        red: '#ff0000',
        green: '#00ff00',
        yellow: '#ffff00',
        blue: '#0000ff',
        magenta: '#ff00ff',
        cyan: '#00ffff',
        white: '#ffffff',
        brightBlack: '#222222',
        brightRed: '#ff3333',
        brightGreen: '#33ff33',
        brightYellow: '#ffff33',
        brightBlue: '#3333ff',
        brightMagenta: '#ff33ff',
        brightCyan: '#33ffff',
        brightWhite: '#ffffff',
      });
      const theme = parseCustomTheme(themeString);
      expect(theme).not.toBeNull();
      expect(theme?.background).toBe('#000000');
      expect(theme?.foreground).toBe('#ffffff');
      expect(theme?.cursor).toBe('#aaaaaa');
      expect(theme?.red).toBe('#ff0000');
      expect(theme?.brightRed).toBe('#ff3333');
    });

    it('provides fallback for foreground if only background exists', () => {
      const themeString = JSON.stringify({
        background: '#123456',
      });
      const theme = parseCustomTheme(themeString);
      expect(theme).not.toBeNull();
      expect(theme?.background).toBe('#123456');
      expect(theme?.foreground).toBe('#ffffff'); // Default fallback
    });

    it('flattens nested object properties successfully', () => {
      const themeString = JSON.stringify({
        colors: {
          primary: {
            background: '#112233',
            foreground: '#eeddcc',
          },
          cursor: {
            cursorColor: '#aabbcc'
          },
          normal: {
            black: '#000000',
            red: '#ff0000',
            green: '#00ff00',
            yellow: '#ffff00',
            blue: '#0000ff',
            magenta: '#ff00ff',
            cyan: '#00ffff',
            white: '#eeeeee'
          },
          bright: {
            brightBlack: '#111111',
            brightRed: '#ff1111',
            brightGreen: '#11ff11',
            brightYellow: '#ffff11',
            brightBlue: '#1111ff',
            brightMagenta: '#ff11ff',
            brightCyan: '#11ffff',
            brightWhite: '#ffffff'
          }
        }
      });
      const theme = parseCustomTheme(themeString);
      expect(theme).not.toBeNull();
      expect(theme?.background).toBe('#112233');
      expect(theme?.foreground).toBe('#eeddcc');
      expect(theme?.cursor).toBe('#aabbcc');
      expect(theme?.red).toBe('#ff0000');
      expect(theme?.brightRed).toBe('#ff1111');
    });

    it('matches color aliases like color0, color1, etc.', () => {
      const themeString = JSON.stringify({
        bg: '#010101',
        text: '#f1f1f1',
        color0: '#000000',
        color1: '#aa0000',
        color2: '#00aa00',
        color3: '#aaaa00',
        color4: '#0000aa',
        color5: '#aa00aa',
        color6: '#00aaaa',
        color7: '#aaaaaa',
        color8: '#555555',
        color9: '#ff5555',
        color10: '#55ff55',
        color11: '#ffff55',
        color12: '#5555ff',
        color13: '#ff55ff',
        color14: '#55ffff',
        color15: '#ffffff'
      });
      const theme = parseCustomTheme(themeString);
      expect(theme).not.toBeNull();
      expect(theme?.background).toBe('#010101');
      expect(theme?.foreground).toBe('#f1f1f1');
      expect(theme?.black).toBe('#000000');
      expect(theme?.red).toBe('#aa0000');
      expect(theme?.brightBlack).toBe('#555555');
      expect(theme?.brightRed).toBe('#ff5555');
    });

    it('ignores invalid hex color strings', () => {
      const themeString = JSON.stringify({
        background: 'invalidhex',
        foreground: '#ggg',
      });
      const theme = parseCustomTheme(themeString);
      expect(theme).toBeNull(); // Background was invalid, so it falls back to finding no background
    });
  });
});
