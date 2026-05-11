import React, { useEffect, useRef } from 'react';

interface PluginPaneProps {
  paneId: string;
  pluginUrl?: string;
  isDark: boolean;
}

export const PluginPane: React.FC<PluginPaneProps> = ({ paneId, pluginUrl = './plugins/sysmon/index.html', isDark }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    // 1. Set up the event listener for messages coming from the iframe
    const handleMessage = (event: MessageEvent) => {
      // Security Check: Ensure the message is strictly from our sandbox iframe
      if (iframeRef.current && event.source !== iframeRef.current.contentWindow) {
        return;
      }

      const { type, payload, nonce } = event.data || {};
      if (!type) return;

      // Handle Ping from Plugin
      if (type === 'ping') {
        console.log(`[PluginBridge] Received Ping from Plugin (${paneId}):`, payload, 'Nonce:', nonce);
      }
      
      // Here we could handle other generic plugin actions like 'open-tab', 'show-notification', etc.
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [paneId]);

  // 2. Push theme state to plugin whenever it changes
  useEffect(() => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      // Send theme state to plugin
      iframeRef.current.contentWindow.postMessage(
        { type: 'theme-change', payload: { isDark }, nonce: Date.now().toString() },
        '*' // We use '*' because iframe is sandboxed and we might not know its exact origin, but it's safe to broadcast to our own iframe reference.
      );
    }
  }, [isDark]);

  return (
    <div className="flex-1 w-full h-full relative">
      <iframe
        ref={iframeRef}
        src={pluginUrl}
        className="w-full h-full border-none"
        sandbox="allow-scripts" // Strict security baseline: only allow scripts, no popups/navigation
        title={`plugin-${paneId}`}
      />
    </div>
  );
};
