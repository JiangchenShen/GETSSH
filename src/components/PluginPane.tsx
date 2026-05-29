import React, { useEffect, useRef } from 'react';

interface PluginPaneProps {
  paneId: string;
  pluginUrl?: string;
  isDark: boolean;
}

const PLACEHOLDER_URL = "data:text/html;charset=utf-8,<html><body style='color:#666;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:monospace;'>Plugin Slot Ready</body></html>";

function resolvePluginUrl(pluginUrl?: string): string {
  if (!pluginUrl) return PLACEHOLDER_URL;
  // If it's an absolute URL or our custom protocol, don't touch it
  if (pluginUrl.startsWith('http://') || pluginUrl.startsWith('https://') || pluginUrl.startsWith('getssh-plugin://') || pluginUrl.startsWith('data:') || pluginUrl.startsWith('file://')) {
    return encodeURI(pluginUrl);
  }
  // In production (file:// protocol), resolve relative to the app's public dir
  if (window.location.protocol === 'file:') {
    const base = window.location.href.replace(/\/[^/]*$/, '');
    return encodeURI(`${base}${pluginUrl}`);
  }
  // In dev (http://), Vite serves public/ at root
  return encodeURI(pluginUrl);
}

export const PluginPane: React.FC<PluginPaneProps> = ({ paneId, pluginUrl, isDark }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const resolvedUrl = resolvePluginUrl(pluginUrl);

  useEffect(() => {
    // 1. Set up the event listener for messages coming from the iframe
    const handleMessage = async (event: MessageEvent) => {
      // Security Check: Ensure the message is strictly from our sandbox iframe
      // #7 FIX: Use short-circuit negation — if iframeRef is null OR source doesn't match, reject
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) {
        return;
      }

      const { type, method, payload, reqId } = event.data || {};
      if (!type) return;

      // Handle Ping from Plugin
      if (type === 'sysmon:alive') {
        // Heartbeat received
      }
      
      // Handle RPC Invoke
      if (type === 'rpc-invoke') {
        try {
          // #8 FIX: Ignore untrusted pluginId. Extract real pluginId from the pluginUrl.
          const realPluginId = pluginUrl?.startsWith('getssh-plugin://') 
            ? pluginUrl.split('/')[2] 
            : (event.data.pluginId || paneId);
            
          const res = await window.electronAPI.pluginRpcInvoke(realPluginId, method, payload);
          if (iframeRef.current && iframeRef.current.contentWindow) {
            iframeRef.current.contentWindow.postMessage({ type: 'rpc-response', reqId, ...res }, '*');
          }
        } catch (err: any) {
          if (iframeRef.current && iframeRef.current.contentWindow) {
            iframeRef.current.contentWindow.postMessage({ type: 'rpc-response', reqId, error: err.message }, '*');
          }
        }
      }
    };

    window.addEventListener('message', handleMessage);

    // Forward sysmon data from main process to iframe if this is the sysmon plugin
    const unsubscribeSysmon = window.electronAPI.onSysmonData((data) => {
      if (iframeRef.current && iframeRef.current.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type: 'sysmon:data', payload: data }, '*');
      }
    });

    // Forward backend push messages
    const resolvedPluginId = pluginUrl?.startsWith('getssh-plugin://') 
      ? pluginUrl.split('/')[2] 
      : paneId;
      
    const unsubscribeRpc = window.electronAPI.onPluginRpcMessage(resolvedPluginId, (payload: any) => {
      if (iframeRef.current && iframeRef.current.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ type: 'backend-message', payload }, '*');
      }
    });

    return () => {
      window.removeEventListener('message', handleMessage);
      unsubscribeSysmon();
      unsubscribeRpc();
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
        sandbox="allow-scripts" // [H-02] Security Fix: Removed allow-same-origin to enforce opaque origin
        title={`plugin-${paneId}`}
        data-plugin-id={paneId}
      />
    </div>
  );
};
