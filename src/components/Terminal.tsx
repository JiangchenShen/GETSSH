import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebglAddon } from 'xterm-addon-webgl';
import { LigaturesAddon } from 'xterm-addon-ligatures';
import 'xterm/css/xterm.css';

interface TerminalProps {
  sessionId: string;
  onDisconnected?: () => void;
  onReconnect?: () => void;
  config: any;
  isDark?: boolean;
  isActive?: boolean;
}

// Global cache to preserve xterm instances and DOM nodes across React unmounts
const xtermCache = new Map<string, { term: XTerm; fitAddon: FitAddon; webglAddon?: WebglAddon; ligaturesAddon?: LigaturesAddon; element: HTMLDivElement; }>();

export function Terminal({ sessionId, onDisconnected, onReconnect, config, isDark = true, isActive = true }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isDisconnectedRef = useRef(false);
  const [isDisconnected, setIsDisconnected] = useState(false);

  // Convert "r g b" string → "#rrggbb" hex (xterm requires solid hex for cursor)
  const toHex = (rgbStr: string) => {
    const [r, g, b] = rgbStr.split(' ').map(Number);
    return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
  };

  // Build xterm theme object
  const buildTheme = (themeColor: string) => ({
    background: 'transparent',
    foreground: isDark ? '#e5e7eb' : '#111827',
    cursor: toHex(themeColor),
    cursorAccent: isDark ? '#111827' : '#ffffff',
    selectionBackground: isDark
      ? `rgba(${themeColor}, 0.35)`
      : `rgba(${themeColor}, 0.25)`,
  });

  const onDisconnectedRef = useRef(onDisconnected);
  const onReconnectRef = useRef(onReconnect);

  useEffect(() => {
    onDisconnectedRef.current = onDisconnected;
    onReconnectRef.current = onReconnect;
  }, [onDisconnected, onReconnect]);

  useEffect(() => {
    if (!terminalRef.current) return;

    let cache = xtermCache.get(sessionId);
    let isNew = false;

    if (!cache) {
      isNew = true;
      const element = document.createElement('div');
      element.className = "w-full h-full overflow-hidden";
      const term = new XTerm({
        allowProposedApi: true,
        cursorBlink: true,
        fontFamily: config.fontFamily || '"Fira Code", monospace, "Courier New", Courier',
        fontSize: config.fontSize || 14,
        lineHeight: config.lineHeight || 1.2,
        cursorStyle: config.cursorStyle || 'block',
        theme: buildTheme(config.themeColor || '168 85 247'),
        allowTransparency: true,
        scrollback: config.scrollback || 10000,
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
      // Load WebGL Addon (Hardware Acceleration)
      try {
        webglAddon = new WebglAddon();
        // Handle webgl context loss gracefully
        webglAddon.onContextLoss(() => {
          if (webglAddon) webglAddon.dispose();
          console.warn('[Terminal] WebGL context lost. Downgrading to native canvas renderer.');
        });
        term.loadAddon(webglAddon);
        console.log('[Terminal] WebGL addon loaded successfully');
      } catch (e) {
        console.warn('[Terminal] WebGL addon failed to load, downgrading to native canvas:', e);
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
      setIsDisconnected(true);
      term.writeln('\r\n\x1b[31m[SSH Connection Closed]\x1b[0m\r\n');
    });

    if (isNew) {
      // Write input to SSH (bind only once per term instance)
      term.onData((data) => {
        if (isDisconnectedRef.current) {
           if (data === '\r' && onReconnectRef.current) {
              isDisconnectedRef.current = false;
              setIsDisconnected(false);
              term.writeln('\x1b[33m[Reconnecting...]\x1b[0m\r\n');
              // Remove from cache BEFORE reconnecting so the new session gets a fresh terminal
              const cacheEntry = xtermCache.get(sessionId);
              if (cacheEntry) {
                 if (cacheEntry.webglAddon) cacheEntry.webglAddon.dispose();
                 if (cacheEntry.ligaturesAddon) cacheEntry.ligaturesAddon.dispose();
                 cacheEntry.fitAddon.dispose();
              }
              xtermCache.delete(sessionId);
              term.dispose();
              onReconnectRef.current();
           } else if (data === '\x1b' && onDisconnectedRef.current) {
              const cacheEntry = xtermCache.get(sessionId);
              if (cacheEntry) {
                 if (cacheEntry.webglAddon) cacheEntry.webglAddon.dispose();
                 if (cacheEntry.ligaturesAddon) cacheEntry.ligaturesAddon.dispose();
                 cacheEntry.fitAddon.dispose();
              }
              xtermCache.delete(sessionId);
              term.dispose();
              onDisconnectedRef.current();
           }
           return;
        }
        window.electronAPI.sshWrite(sessionId, data);
      });
    }

    // Right-click: smart copy/paste
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const selection = term.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection).catch(() => {});
      } else {
        navigator.clipboard.readText().then((text) => {
          if (text) term.paste(text);
        }).catch(() => {});
      }
    };
    element.addEventListener('contextmenu', handleContextMenu);

    return () => {
      resizeObserver.disconnect();
      if (unsubData) unsubData();
      if (unsubClosed) unsubClosed();
      element.removeEventListener('contextmenu', handleContextMenu);
      
      // Preserve the element in cache, just remove it from the React container
      if (terminalRef.current && element.parentNode === terminalRef.current) {
        terminalRef.current.removeChild(element);
      }
      
      // Memory cleanup if component is actually destroyed
      // But we cache instances, so we don't dispose them here unless we evict cache
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

    // Sync theme foreground & cursor when isDark or themeColor changes
    const themeColor = config.themeColor || '168 85 247';
    term.options.theme = buildTheme(themeColor);

    if (fitAddonRef.current) {
        fitAddonRef.current.fit();
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
           navigator.clipboard.writeText(selection);
         }
       });
    }
    
    return () => {
        if (disp) disp.dispose();
    }
  }, [config.copyOnSelect]);

  return (
    <div className="w-full h-full p-0 flex flex-col flex-1 transparent relative group">
      <div className="flex-1 w-full h-full" ref={terminalRef}></div>
      {isDisconnected && (
        <div className="absolute top-0 left-0 w-full h-full bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-10 transition-all animate-in fade-in duration-300">
          <div className="bg-black/60 text-white/90 px-6 py-4 rounded-xl shadow-2xl border border-white/10 flex flex-col items-center space-y-2 backdrop-blur-md">
            <span className="font-bold text-lg text-red-400">Session Closed</span>
            <span className="text-sm opacity-80">Press <kbd className="px-2 py-1 bg-white/10 rounded mx-1 text-xs">Enter</kbd> to Reconnect</span>
            <span className="text-sm opacity-80">Press <kbd className="px-2 py-1 bg-white/10 rounded mx-1 text-xs">Esc</kbd> to Return to Menu</span>
          </div>
        </div>
      )}
    </div>
  );
}
