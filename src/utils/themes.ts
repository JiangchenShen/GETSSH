import type { ITheme } from '@xterm/xterm';

export type ThemeName = 'default' | 'dracula' | 'nord' | 'gruvbox' | 'tokyo-night' | 'catppuccin' | 'monokai' | 'solarized';

// Convert hex to rgba for glassmorphism
export const applyOpacity = (hex: string, opacity: number) => {
  if (!hex || hex === 'transparent' || hex.startsWith('rgba')) return hex;
  const c = hex.replace('#', '');
  if (c.length !== 6) return hex;
  const a = Math.round(opacity * 255).toString(16).padStart(2, '0');
  return `#${c}${a}`;
};

export const TERMINAL_THEMES: Record<Exclude<ThemeName, 'default'>, ITheme> = {
  dracula: {
    background: '#282a36',
    foreground: '#f8f8f2',
    cursor: '#f8f8f0',
    black: '#21222c',
    red: '#ff5555',
    green: '#50fa7b',
    yellow: '#f1fa8c',
    blue: '#bd93f9',
    magenta: '#ff79c6',
    cyan: '#8be9fd',
    white: '#f8f8f2',
    brightBlack: '#6272a4',
    brightRed: '#ff6e6e',
    brightGreen: '#69ff94',
    brightYellow: '#ffffa5',
    brightBlue: '#d6acff',
    brightMagenta: '#ff92df',
    brightCyan: '#a4ffff',
    brightWhite: '#ffffff',
  },
  nord: {
    background: '#2e3440',
    foreground: '#d8dee9',
    cursor: '#d8dee9',
    black: '#3b4252',
    red: '#bf616a',
    green: '#a3be8c',
    yellow: '#ebcb8b',
    blue: '#81a1c1',
    magenta: '#b48ead',
    cyan: '#88c0d0',
    white: '#e5e9f0',
    brightBlack: '#4c566a',
    brightRed: '#bf616a',
    brightGreen: '#a3be8c',
    brightYellow: '#ebcb8b',
    brightBlue: '#81a1c1',
    brightMagenta: '#b48ead',
    brightCyan: '#8fbcbb',
    brightWhite: '#eceff4',
  },
  gruvbox: {
    background: '#282828',
    foreground: '#ebdbb2',
    cursor: '#ebdbb2',
    black: '#282828',
    red: '#cc241d',
    green: '#98971a',
    yellow: '#d79921',
    blue: '#458588',
    magenta: '#b16286',
    cyan: '#689d6a',
    white: '#a89984',
    brightBlack: '#928374',
    brightRed: '#fb4934',
    brightGreen: '#b8bb26',
    brightYellow: '#fabd2f',
    brightBlue: '#83a598',
    brightMagenta: '#d3869b',
    brightCyan: '#8ec07c',
    brightWhite: '#ebdbb2',
  },
  'tokyo-night': {
    background: '#1a1b26',
    foreground: '#a9b1d6',
    cursor: '#c0caf5',
    black: '#32344a',
    red: '#f7768e',
    green: '#9ece6a',
    yellow: '#e0af68',
    blue: '#7aa2f7',
    magenta: '#ad8ee6',
    cyan: '#449dab',
    white: '#787c99',
    brightBlack: '#444b6a',
    brightRed: '#ff7a93',
    brightGreen: '#b9f27c',
    brightYellow: '#ff9e64',
    brightBlue: '#7da6ff',
    brightMagenta: '#bb9af7',
    brightCyan: '#0db9d7',
    brightWhite: '#acb0d0',
  },
  catppuccin: {
    background: '#1e1e2e',
    foreground: '#cdd6f4',
    cursor: '#f5e0dc',
    black: '#45475a',
    red: '#f38ba8',
    green: '#a6e3a1',
    yellow: '#f9e2af',
    blue: '#89b4fa',
    magenta: '#f5c2e7',
    cyan: '#94e2d5',
    white: '#bac2de',
    brightBlack: '#585b70',
    brightRed: '#f38ba8',
    brightGreen: '#a6e3a1',
    brightYellow: '#f9e2af',
    brightBlue: '#89b4fa',
    brightMagenta: '#f5c2e7',
    brightCyan: '#94e2d5',
    brightWhite: '#a6adc8',
  },
  monokai: {
    background: '#272822',
    foreground: '#f8f8f2',
    cursor: '#f8f8f0',
    black: '#272822',
    red: '#f92672',
    green: '#a6e22e',
    yellow: '#f4bf75',
    blue: '#66d9ef',
    magenta: '#ae81ff',
    cyan: '#a1efe4',
    white: '#f8f8f2',
    brightBlack: '#75715e',
    brightRed: '#f92672',
    brightGreen: '#a6e22e',
    brightYellow: '#f4bf75',
    brightBlue: '#66d9ef',
    brightMagenta: '#ae81ff',
    brightCyan: '#a1efe4',
    brightWhite: '#f9f8f5',
  },
  solarized: {
    background: '#002b36',
    foreground: '#839496',
    cursor: '#93a1a1',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#002b36',
    brightRed: '#cb4b16',
    brightGreen: '#586e75',
    brightYellow: '#657b83',
    brightBlue: '#839496',
    brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1',
    brightWhite: '#fdf6e3',
  }
};

// Intelligent JSON parser for custom themes (Gogh, iTerm2, Windows Terminal, etc.)
export const parseCustomTheme = (jsonString: string): ITheme | null => {
  try {
    const raw = JSON.parse(jsonString);
    if (typeof raw !== 'object' || raw === null) return null;

    // Flatten object
    const flatten = (obj: any, prefix = ''): Record<string, string> => {
      return Object.keys(obj).reduce((acc: any, k) => {
        const pre = prefix.length ? prefix + '.' : '';
        if (typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k])) {
          Object.assign(acc, flatten(obj[k], pre + k));
        } else if (typeof obj[k] === 'string') {
          acc[pre + k] = obj[k];
        }
        return acc;
      }, {});
    };

    const flat = flatten(raw);
    const theme: any = {};
    const keys = Object.keys(flat);

    const findColor = (names: string[]) => {
      for (const name of names) {
        const match = keys.find(k => k.toLowerCase().endsWith(name.toLowerCase()) || k.toLowerCase() === name.toLowerCase());
        if (match) {
          const val = flat[match].trim();
          // Validate Hex
          if (/^#[0-9a-fA-F]{3,8}$/.test(val)) {
            return val;
          }
        }
      }
      return undefined;
    };

    theme.background = findColor(['background', 'bg']);
    theme.foreground = findColor(['foreground', 'fg', 'text']);
    theme.cursor = findColor(['cursor', 'cursorcolor']);
    theme.black = findColor(['black', 'color0']);
    theme.red = findColor(['red', 'color1']);
    theme.green = findColor(['green', 'color2']);
    theme.yellow = findColor(['yellow', 'color3']);
    theme.blue = findColor(['blue', 'color4']);
    theme.magenta = findColor(['magenta', 'purple', 'color5']);
    theme.cyan = findColor(['cyan', 'color6']);
    theme.white = findColor(['white', 'color7']);
    theme.brightBlack = findColor(['brightBlack', 'bright_black', 'color8']);
    theme.brightRed = findColor(['brightRed', 'bright_red', 'color9']);
    theme.brightGreen = findColor(['brightGreen', 'bright_green', 'color10']);
    theme.brightYellow = findColor(['brightYellow', 'bright_yellow', 'color11']);
    theme.brightBlue = findColor(['brightBlue', 'bright_blue', 'color12']);
    theme.brightMagenta = findColor(['brightMagenta', 'bright_magenta', 'brightPurple', 'color13']);
    theme.brightCyan = findColor(['brightCyan', 'bright_cyan', 'color14']);
    theme.brightWhite = findColor(['brightWhite', 'bright_white', 'color15']);

    // Ensure at least background exists
    if (theme.background) {
      if (!theme.foreground) theme.foreground = '#ffffff'; // Fallback
      return theme as ITheme;
    }
    return null;
  } catch (e) {
    return null;
  }
};

