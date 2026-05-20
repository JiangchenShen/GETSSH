import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebglAddon } from 'xterm-addon-webgl';
import { LigaturesAddon } from 'xterm-addon-ligatures';
import 'xterm/css/xterm.css';
import { isSSHConfig, PaneConfig } from '../store/sessionStore';

interface TerminalProps {
  sessionId: string;
  onDisconnected?: () => void;
  onReconnect?: () => void;
  onDisconnectedChange?: (val: boolean) => void; // notify parent to persist in Zustand
  isDisconnected?: boolean;   // driven from Zustand PaneLeaf — survives re-renders
  config: PaneConfig;
  isDark?: boolean;
  isActive?: boolean;
}

// Global cache to preserve xterm instances and DOM nodes across React unmounts
const xtermCache = new Map<string, { term: XTerm; fitAddon: FitAddon; webglAddon?: WebglAddon; ligaturesAddon?: LigaturesAddon; element: HTMLDivElement; }>();

export function Terminal({ sessionId, onDisconnected, onReconnect, onDisconnectedChange, isDisconnected = false, config, isDark = true, isActive = true }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isDisconnectedRef = useRef(isDisconnected);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Build xterm theme object
  const buildTheme = (themeColor: string) => ({
    background: '#000000',
    foreground: '#FFFFFF',
    cursor: '#FFFFFF',
    cursorAccent: '#000000',
    selectionBackground: `rgba(${themeColor}, 0.35)`,
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
      element.className = "w-full h-full overflow-hidden text-white dark:text-white";
      element.style.color = 'white';

      const sshConfig = isSSHConfig(config) ? config : {} as Record<string, any>;
      const term = new XTerm({
        allowProposedApi: true,
        cursorBlink: true,
        fontFamily: sshConfig.fontFamily || '"Fira Code", monospace, "Courier New", Courier',
        fontSize: sshConfig.fontSize || 14,
        lineHeight: sshConfig.lineHeight || 1.2,
        cursorStyle: sshConfig.cursorStyle || 'block',
        theme: buildTheme(sshConfig.themeColor || '168 85 247'),
        allowTransparency: true,
        scrollback: sshConfig.scrollback || 10000,
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
      // Persist state in Zustand so it survives layout re-renders
      if (onDisconnectedChange) onDisconnectedChange(true);
      term.writeln('\r\n\x1b[31m[SSH Connection Closed]\x1b[0m\r\n');
    });

    if (isNew) {
      // Write input to SSH (bind only once per term instance)
      // When disconnected, xterm still receives data events — but we only handle
      // reconnect/escape via the overlay's onKeyDown for reliable DOM focus control.
      // This branch just blocks accidental input from reaching the SSH channel.
      term.onData((data) => {
        if (isDisconnectedRef.current) return; // overlay handles keys via DOM
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
    
    const sshConfig = isSSHConfig(config) ? config : {} as Record<string, any>;

    // Apply options that support HMR
    term.options.fontFamily = sshConfig.fontFamily;
    term.options.fontSize = sshConfig.fontSize;
    term.options.lineHeight = sshConfig.lineHeight;
    term.options.cursorStyle = sshConfig.cursorStyle;
    term.options.scrollback = sshConfig.scrollback;

    // Sync theme foreground & cursor when isDark or themeColor changes
    const themeColor = sshConfig.themeColor || '168 85 247';
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
    
    const copyOnSelect = isSSHConfig(config) ? config.copyOnSelect : false;
    if (copyOnSelect) {
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
  }, [config]);

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
      <div className="flex-1 w-full h-full text-white" ref={terminalRef} style={{ color: 'white' }}></div>
      {isDisconnected && (
        <div
          ref={overlayRef}
          tabIndex={0}
          onKeyDown={handleOverlayKeyDown}
          className="absolute top-0 left-0 w-full h-full bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-10 outline-none"
        >
          <div className="bg-black/70 text-white/90 px-7 py-5 rounded-2xl shadow-2xl border border-white/10 flex flex-col items-center space-y-3 backdrop-blur-md">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse mb-1" />
            <span className="font-bold text-base text-red-400 tracking-wide">Session Closed</span>
            <span className="text-sm opacity-75">Press <kbd className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono">Enter</kbd> to Reconnect</span>
            <span className="text-sm opacity-75">Press <kbd className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono">Esc</kbd> to Return to Menu</span>
          </div>
        </div>
      )}
    </div>
  );
}
