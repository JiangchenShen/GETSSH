import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebglAddon } from 'xterm-addon-webgl';
import { LigaturesAddon } from 'xterm-addon-ligatures';
import { AppConfig } from '../store/appStore';
import { useSessionStore, collectSessionIds } from '../store/sessionStore';
import { TERMINAL_THEMES, applyOpacity, ThemeName } from '../utils/themes';
import 'xterm/css/xterm.css';

interface TerminalProps {
  sessionId: string;
  onDisconnected?: () => void;
  onReconnect?: () => void;
  onDisconnectedChange?: (val: boolean) => void; // notify parent to persist in Zustand
  isDisconnected?: boolean;   // driven from Zustand PaneLeaf — survives re-renders
  config: AppConfig;
  isDark?: boolean;
  isActive?: boolean;
}

// Global cache to preserve xterm instances and DOM nodes across React unmounts
const xtermCache = new Map<string, { term: XTerm; fitAddon: FitAddon; webglAddon?: WebglAddon; ligaturesAddon?: LigaturesAddon; element: HTMLDivElement; }>();

export function Terminal({ sessionId, onDisconnected, onReconnect, onDisconnectedChange, isDisconnected = false, config, isDark = true, isActive = true }: TerminalProps) {
  const { t } = useTranslation();
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isDisconnectedRef = useRef(isDisconnected);
  const overlayRef = useRef<HTMLDivElement>(null);
  const configRef = useRef(config);
  const [visualBell, setVisualBell] = useState(false);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  // Build xterm theme object based on antiGlare and isDark
  const buildTheme = (themeColor: string, isDark: boolean, antiGlare?: boolean, terminalTheme: ThemeName = 'default') => {
    let baseTheme: any = {};
    if (terminalTheme && terminalTheme !== 'default' && TERMINAL_THEMES[terminalTheme as Exclude<ThemeName, 'default'>]) {
      const palette = TERMINAL_THEMES[terminalTheme as Exclude<ThemeName, 'default'>];
      baseTheme = { ...palette };
      // Allow the theme's solid background to render at 100% opacity in the terminal area,
      // while the rest of the application (Sidebar, TabBar) retains the global glassmorphism.
    } else {
      if (antiGlare) {
        // High-Contrast Mode (Anti-Glare)
        baseTheme = {
          background: isDark ? '#000000' : '#FFFFFF',
          foreground: isDark ? '#FFFFFF' : '#000000',
          cursor: isDark ? '#FFFFFF' : '#000000',
          cursorAccent: isDark ? '#000000' : '#FFFFFF',
          // High Contrast ANSI 16 Colors
          black: isDark ? '#000000' : '#000000',
          red: isDark ? '#FF5555' : '#CC0000',
          green: isDark ? '#50FA7B' : '#008800',
          yellow: isDark ? '#F1FA8C' : '#DDBB00',
          blue: isDark ? '#BD93F9' : '#0000EE',
          magenta: isDark ? '#FF79C6' : '#CC00CC',
          cyan: isDark ? '#8BE9FD' : '#00AAAA',
          white: isDark ? '#FFFFFF' : '#FFFFFF',
          brightBlack: isDark ? '#6272A4' : '#555555',
          brightRed: isDark ? '#FF6E6E' : '#FF0000',
          brightGreen: isDark ? '#69FF94' : '#00FF00',
          brightYellow: isDark ? '#FFFFA5' : '#FFFF00',
          brightBlue: isDark ? '#D6ACFF' : '#5C5CFF',
          brightMagenta: isDark ? '#FF92DF' : '#FF00FF',
          brightCyan: isDark ? '#A4FFFF' : '#00FFFF',
          brightWhite: isDark ? '#FFFFFF' : '#FFFFFF',
        };
      } else {
        // Soft Mode (Native Canvas / Glassmorphism)
        baseTheme = {
          background: isDark ? 'transparent' : '#F1F5F9', // Fix light mode transparent disaster
          foreground: isDark ? '#E2E8F0' : '#334155',
          cursor: isDark ? '#F8FAFC' : '#0F172A',
          cursorAccent: isDark ? '#000000' : '#FFFFFF',
        };
      }
    }

    return {
      ...baseTheme,
      selectionBackground: `rgba(${themeColor}, 0.35)`,
    };
  };

  const onDisconnectedRef = useRef(onDisconnected);
  const onReconnectRef = useRef(onReconnect);
  const onDisconnectedChangeRef = useRef(onDisconnectedChange);

  useEffect(() => {
    onDisconnectedRef.current = onDisconnected;
    onReconnectRef.current = onReconnect;
    onDisconnectedChangeRef.current = onDisconnectedChange;
  }, [onDisconnected, onReconnect, onDisconnectedChange]);

  useEffect(() => {
    if (!terminalRef.current) return;

    let cache = xtermCache.get(sessionId);
    if (!cache) {
      const element = document.createElement('div');
      element.className = `w-full h-full overflow-hidden ${isDark ? 'text-white' : 'text-black'}`;
      const term = new XTerm({
        allowProposedApi: true,
        cursorBlink: config.cursorBlink ?? true,
        fontFamily: config.fontFamily || '"Fira Code", monospace, "Courier New", Courier',
        fontSize: config.fontSize || 14,
        lineHeight: config.lineHeight || 1.2,
        cursorStyle: config.cursorStyle || 'block',
        theme: buildTheme(config.themeColor || '168 85 247', isDark, config.antiGlare, config.terminalTheme as ThemeName),
        allowTransparency: true,
        scrollback: config.scrollback || 10000,
        ...({ bellStyle: config.bellStyle === 'audible' ? 'sound' : 'none' } as any),
      });
      
      term.onBell(() => {
        if (configRef.current.bellStyle === 'visual') {
          setVisualBell(true);
          setTimeout(() => setVisualBell(false), 200);
        }
      });
      
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(element);

      let ligaturesAddon: LigaturesAddon | undefined;
      // Load Ligatures Addon (Geek visual enhancement)
      try {
        ligaturesAddon = new LigaturesAddon();
        term.loadAddon(ligaturesAddon);
      } catch (e) {
        console.warn('[Terminal] Ligatures addon failed to load:', e);
      }

      let webglAddon: WebglAddon | undefined;
      // Load WebGL Addon (Hardware Acceleration) ONLY if antiGlare is true (solid background)
      if (config.antiGlare) {
        try {
          webglAddon = new WebglAddon();
          // Handle webgl context loss gracefully
          webglAddon.onContextLoss(() => {
            if (webglAddon) webglAddon.dispose();
            console.warn('[Terminal] WebGL context lost. Downgrading to native canvas renderer.');
          });
          term.loadAddon(webglAddon);
          console.debug('[Terminal] WebGL addon loaded successfully on init');
        } catch (e) {
          console.warn('[Terminal] WebGL addon failed to load, downgrading to native canvas:', e);
        }
      }
      
      cache = { term, fitAddon, webglAddon, ligaturesAddon, element };
      xtermCache.set(sessionId, cache);
    }

    const { term, fitAddon, element } = cache;
    terminalRef.current.appendChild(element);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Handle Resize via ResizeObserver
    const handleResize = () => {
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        window.electronAPI.sshResize(sessionId, dims.rows, dims.cols);
      }
    };
    
    // Initial fit
    setTimeout(handleResize, 50);
    
    const resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(terminalRef.current);

    // IPC Handlers
    const unsubData = window.electronAPI.onSshData(sessionId, (data: string) => {
      term.write(data);
    });

    const unsubClosed = window.electronAPI.onSshClosed(sessionId, () => {
      isDisconnectedRef.current = true;
      // Persist state in Zustand so it survives layout re-renders
      if (onDisconnectedChangeRef.current) onDisconnectedChangeRef.current(true);
      term.writeln('\r\n\x1b[31m[SSH Connection Closed]\x1b[0m\r\n');
    });

    // Write input to SSH
    // When disconnected, xterm still receives data events — but we only handle
    // reconnect/escape via the overlay's onKeyDown for reliable DOM focus control.
    // This branch just blocks accidental input from reaching the SSH channel.
    const dataDisp = term.onData((data) => {
      if (isDisconnectedRef.current) return; // overlay handles keys via DOM
      window.electronAPI.sshWrite(sessionId, data);
    });

    // Right-click: smart copy/paste vs native menu
    const handleContextMenu = async (e: MouseEvent) => {
      // If configured for direct paste (Windows geek mode)
      if (configRef.current.rightClickBehavior === 'paste') {
        e.preventDefault();
        e.stopPropagation();

        const selection = term.getSelection();
        if (selection) {
          try {
            await navigator.clipboard.writeText(selection);
            term.clearSelection(); // Explicitly clear to fix the "copy loop"
          } catch (err) {
            console.error('Failed to write to clipboard:', err);
          }
        } else {
          try {
            const text = await navigator.clipboard.readText();
            if (text) {
              window.electronAPI.sshWrite(sessionId, text);
            }
          } catch (err) {
            console.error('Failed to read from clipboard:', err);
          }
        }
        return;
      }
      
      // If configured for 'menu', we do not call preventDefault().
      // This allows the standard context menu to appear.
    };
    element.addEventListener('contextmenu', handleContextMenu);

    return () => {
      resizeObserver.disconnect();
      dataDisp.dispose(); // Unbind data listener
      if (unsubData) unsubData();
      if (unsubClosed) unsubClosed();
      element.removeEventListener('contextmenu', handleContextMenu);
      
      // Preserve the element in cache, just remove it from the React container
      if (terminalRef.current && element.parentNode === terminalRef.current) {
        terminalRef.current.removeChild(element);
      }
      
      // Strict Garbage Collection for Active Destruction
      const { tabs } = useSessionStore.getState();
      const isAlive = tabs.some(t => t.id === sessionId || (t.paneTree && collectSessionIds(t.paneTree).includes(sessionId)));
      if (!isAlive) {
        const cacheToKill = xtermCache.get(sessionId);
        if (cacheToKill) {
          cacheToKill.webglAddon?.dispose();
          cacheToKill.fitAddon.dispose();
          cacheToKill.term.dispose();
          xtermCache.delete(sessionId);
          console.debug(`[Terminal] Active destruction detected. Session ${sessionId} GC complete.`);
        }
      }
    };
  }, [sessionId]); // ONLY mount/dismount on SessionID change

  // Dynamic Config Observer
  useEffect(() => {
    if (!xtermRef.current) return;
    const term = xtermRef.current;
    
    // Apply options that support HMR
    term.options.fontFamily = config.fontFamily;
    term.options.fontSize = config.fontSize;
    term.options.lineHeight = config.lineHeight;
    term.options.cursorStyle = config.cursorStyle;
    term.options.scrollback = config.scrollback;
    term.options.cursorBlink = config.cursorBlink ?? true;
    (term.options as any).bellStyle = config.bellStyle === 'audible' ? 'sound' : 'none';

    // Sync theme foreground & cursor when isDark, themeColor, or antiGlare changes
    const themeColor = config.themeColor || '168 85 247';
    term.options.theme = buildTheme(themeColor, isDark, config.antiGlare, config.terminalTheme as ThemeName);

    // Dynamic Renderer Dispatch
    const cache = xtermCache.get(sessionId);
    if (cache) {
      if (config.antiGlare) {
        // High-contrast mode: We can use WebGL!
        if (!cache.webglAddon) {
          try {
            const webglAddon = new WebglAddon();
            webglAddon.onContextLoss(() => {
              if (cache.webglAddon) cache.webglAddon.dispose();
              cache.webglAddon = undefined;
              console.warn('[Terminal] WebGL context lost during dynamic load.');
            });
            term.loadAddon(webglAddon);
            cache.webglAddon = webglAddon;
            console.debug('[Terminal] WebGL addon dynamically loaded');
          } catch (e) {
            console.warn('[Terminal] Dynamic WebGL addon failed to load:', e);
          }
        }
      } else {
        // Soft mode (transparent): WebGL breaks transparent backgrounds, so degrade to Canvas
        if (cache.webglAddon) {
          cache.webglAddon.dispose();
          cache.webglAddon = undefined;
          console.debug('[Terminal] WebGL addon dynamically disposed (fallback to canvas for transparency)');
        }
      }
    }

    if (fitAddonRef.current) {
        // Request animation frame ensures DOM padding updates have applied before refitting
        requestAnimationFrame(() => {
          if (!fitAddonRef.current || !xtermRef.current) return;
          fitAddonRef.current.fit();
          const dims = fitAddonRef.current.proposeDimensions();
          if (dims) {
            window.electronAPI.sshResize(sessionId, dims.rows, dims.cols);
          }
        });
    }
  }, [config, isDark]);

  // Re-fit when tab becomes active (restores canvas after display:none hide)
  useEffect(() => {
    if (!isActive || !fitAddonRef.current) return;
    // Small delay ensures the container is fully visible before fitting
    const timer = setTimeout(() => {
      if (!fitAddonRef.current || !xtermRef.current) return;
      fitAddonRef.current.fit();
      const dims = fitAddonRef.current.proposeDimensions();
      if (dims) {
        window.electronAPI.sshResize(sessionId, dims.rows, dims.cols);
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [isActive, sessionId]);

  // Handle Copy On Select as an intercept
  useEffect(() => {
    if (!xtermRef.current) return;
    const term = xtermRef.current;
    let disp: any;
    
    if (config.copyOnSelect) {
       disp = term.onSelectionChange(() => {
         const selection = term.getSelection();
         if (selection) {
           navigator.clipboard.writeText(selection).catch((err) => {
             console.error('Failed to write to clipboard:', err);
           });
         }
       });
    }
    
    return () => {
        if (disp) disp.dispose();
    }
  }, [config.copyOnSelect]);

  // Sync the ref used inside xterm's onData closure whenever the prop changes
  useEffect(() => {
    isDisconnectedRef.current = isDisconnected;
  }, [isDisconnected]);

  // Auto-focus the overlay when it appears so keyboard events land on it
  useEffect(() => {
    if (isDisconnected && overlayRef.current) {
      overlayRef.current.focus();
    }
  }, [isDisconnected]);

  // Overlay keyboard handler — intercepts Enter (reconnect) and Esc (return to menu)
  const handleOverlayKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isDisconnected) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (onDisconnectedChange) onDisconnectedChange(false);
      isDisconnectedRef.current = false;
      const cacheEntry = xtermCache.get(sessionId);
      if (cacheEntry) {
        cacheEntry.term.writeln('\x1b[33m[Reconnecting...]\x1b[0m\r\n');
        if (cacheEntry.webglAddon) cacheEntry.webglAddon.dispose();
        if (cacheEntry.ligaturesAddon) cacheEntry.ligaturesAddon.dispose();
        cacheEntry.fitAddon.dispose();
        xtermCache.delete(sessionId);
        cacheEntry.term.dispose();
      }
      if (onReconnectRef.current) onReconnectRef.current();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (onDisconnectedChange) onDisconnectedChange(false);
      isDisconnectedRef.current = false;
      const cacheEntry = xtermCache.get(sessionId);
      if (cacheEntry) {
        if (cacheEntry.webglAddon) cacheEntry.webglAddon.dispose();
        if (cacheEntry.ligaturesAddon) cacheEntry.ligaturesAddon.dispose();
        cacheEntry.fitAddon.dispose();
        xtermCache.delete(sessionId);
        cacheEntry.term.dispose();
      }
      if (onDisconnectedRef.current) onDisconnectedRef.current();
    }
  };

  return (
    <div className="w-full h-full p-0 flex flex-col flex-1 transparent relative group text-white dark:text-white" style={{ color: 'white' }}>
      {visualBell && <div className="absolute inset-0 bg-white/20 pointer-events-none z-50 transition-opacity duration-200" />}
      <div className="flex-1 w-full h-full text-white" ref={terminalRef} style={{ color: 'white', padding: `${config.terminalPadding ?? 8}px` }}></div>
      {isDisconnected && (
        <div
          ref={overlayRef}
          tabIndex={0}
          onKeyDown={handleOverlayKeyDown}
          className="absolute top-0 left-0 w-full h-full bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-10 outline-none"
        >
          <div className="bg-black/70 text-white/90 px-7 py-5 rounded-2xl shadow-2xl border border-white/10 flex flex-col items-center space-y-3 backdrop-blur-md">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse mb-1" />
            <span className="font-bold text-base text-red-400 tracking-wide">{t('terminal.sessionClosed')}</span>
            <span className="text-sm opacity-75">Press <kbd className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono">Enter</kbd> {t('terminal.pressEnterReconnect')}</span>
            <span className="text-sm opacity-75">Press <kbd className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono">Esc</kbd> {t('terminal.pressEscMenu')}</span>
          </div>
        </div>
      )}
    </div>
  );
}
