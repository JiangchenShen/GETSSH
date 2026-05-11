import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
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
const xtermCache = new Map<string, { term: XTerm; fitAddon: FitAddon; element: HTMLDivElement; }>();

export function Terminal({ sessionId, onDisconnected, onReconnect, config, isDark = true, isActive = true }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isDisconnectedRef = useRef(false);

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
      
      cache = { term, fitAddon, element };
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
      term.writeln('\r\n\x1b[31m[SSH Connection Closed] - Press Enter to reconnect...\x1b[0m\r\n');
      if (onDisconnectedRef.current) onDisconnectedRef.current();
      xtermCache.delete(sessionId);
      term.dispose();
    });

    if (isNew) {
      // Write input to SSH (bind only once per term instance)
      term.onData((data) => {
        if (isDisconnectedRef.current) {
           if (data === '\r' && onReconnectRef.current) {
              isDisconnectedRef.current = false;
              term.writeln('\x1b[33m[Reconnecting...]\x1b[0m\r\n');
              onReconnectRef.current();
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
      
      // DO NOT DISCONNECT SSH OR DISPOSE TERM ON UNMOUNT
      // window.electronAPI.sshDisconnect(sessionId);
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
    </div>
  );
}
