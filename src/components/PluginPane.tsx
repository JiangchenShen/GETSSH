import React, { useEffect, useRef } from 'react';

interface PluginPaneProps {
  paneId: string;
  pluginUrl?: string;
  isDark: boolean;
}

const PLACEHOLDER_URL = "data:text/html;charset=utf-8,<html><body style='color:#666;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:monospace;'>Plugin Slot Ready</body></html>";

function resolvePluginUrl(pluginUrl?: string): string {
  if (!pluginUrl) return PLACEHOLDER_URL;
  // In production (file:// protocol), resolve relative to the app's public dir
  if (window.location.protocol === 'file:') {
    const base = window.location.href.replace(/\/[^/]*$/, '');
    return `${base}${pluginUrl}`;
  }
  // In dev (http://), Vite serves public/ at root
  return pluginUrl;
}

export const PluginPane: React.FC<PluginPaneProps> = ({ paneId, pluginUrl, isDark }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const resolvedUrl = resolvePluginUrl(pluginUrl);

  useEffect(() => {
    // 1. Set up the event listener for messages coming from the iframe
    const handleMessage = (event: MessageEvent) => {
      // Security Check: Ensure the message is strictly from our sandbox iframe
      if (iframeRef.current && event.source !== iframeRef.current.contentWindow) {
        return;
      }

      const { type, payload } = event.data || {};
      if (!type) return;

      // Handle Ping from Plugin
      if (type === 'sysmon:alive') {
        console.log('[Host] 收到插件心跳:', payload);
      }
      
      // Here we could handle other generic plugin actions like 'open-tab', 'show-notification', etc.
    };

    window.addEventListener('message', handleMessage);

    // Forward sysmon data from main process to iframe if this is the sysmon plugin
    const unsubscribeSysmon = window.electronAPI.onSysmonData((data) => {
      if (iframeRef.current && iframeRef.current.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type: 'sysmon:data', payload: data }, '*');
      }
    });

    return () => {
      window.removeEventListener('message', handleMessage);
      unsubscribeSysmon();
    };
  }, [paneId]);

  // 2. Push theme state to plugin whenever it changes
  useEffect(() => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      const currentTheme = isDark ? 'dark' : 'light';
      // Send theme state to plugin
      iframeRef.current.contentWindow.postMessage(
        { type: 'host:theme-change', payload: currentTheme },
        '*'
      );
    }
  }, [isDark]);

  return (
    <div className="flex-1 w-full h-full relative overflow-hidden min-h-0">
      <iframe
        ref={iframeRef}
        src={resolvedUrl}
        className="w-full h-full border-none"
        sandbox="allow-scripts" // Strict security baseline: only allow scripts, no popups/navigation
        title={`plugin-${paneId}`}
      />
    </div>
  );
};
