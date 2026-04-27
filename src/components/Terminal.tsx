import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';


interface TerminalProps {
  sessionId: string;
  onDisconnected?: () => void;
  config: any; // We will use AppConfig type from App.tsx loosely here to avoid cyclic if App doesn't export
}

export function Terminal({ sessionId, onDisconnected, config }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    // Initialize xterm with config defaults
    const term = new XTerm({
      cursorBlink: true,
      fontFamily: config.fontFamily || '"Fira Code", monospace, "Courier New", Courier',
      fontSize: config.fontSize || 14,
      lineHeight: config.lineHeight || 1.2,
      cursorStyle: config.cursorStyle || 'block',
      theme: {
        background: 'transparent',
        foreground: 'inherit',
        cursor: 'rgba(168, 85, 247, 0.8)',
        selectionBackground: 'rgba(168, 85, 247, 0.3)',
      },
      allowTransparency: true,
      scrollback: config.scrollback || 10000,
    });
    
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Handle Resize
    const handleResize = () => {
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        window.electronAPI.sshResize(sessionId, dims.rows, dims.cols);
      }
    };
    
    // Slight delay for initial fit to ensure container layout is done
    setTimeout(handleResize, 100);
    window.addEventListener('resize', handleResize);

    // IPC Handlers
    const unsubData = window.electronAPI.onSshData(sessionId, (data: string) => {
      term.write(data);
    });

    const unsubClosed = window.electronAPI.onSshClosed(sessionId, () => {
      term.writeln('\r\n\x1b[31m[SSH Connection Closed]\x1b[0m');
      if (onDisconnected) onDisconnected();
    });

    // Write input to SSH
    term.onData((data) => {
      window.electronAPI.sshWrite(sessionId, data);
    });

    return () => {
      window.removeEventListener('resize', handleResize);
      if (unsubData) unsubData();
      if (unsubClosed) unsubClosed();
      // @ts-ignore
      term.dispose();
      window.electronAPI.sshDisconnect(sessionId);
    };
  }, [sessionId, onDisconnected]); // Mount only once per SessionID

  // Dynamic Config Observer
  useEffect(() => {
    if (!xtermRef.current) return;
    const term = xtermRef.current;
    
    // Apply options that support HMR
    term.options.fontFamily = config.fontFamily;
    term.options.fontSize = config.fontSize;
    term.options.lineHeight = config.lineHeight;
    term.options.cursorStyle = config.cursorStyle;
    
    // Attempt scrollback override (may only affect new lines in some versions)
    term.options.scrollback = config.scrollback;
    
    // Re-trigger layout fit
    if (fitAddonRef.current) {
        fitAddonRef.current.fit();
    }
  }, [config]);

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
    <div className="w-full h-full p-4 flex flex-col flex-1 dark:text-gray-100 text-gray-900 transparent">
      <div className="flex-1 overflow-hidden" ref={terminalRef}></div>
    </div>
  );
}
