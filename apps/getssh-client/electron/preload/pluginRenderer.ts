import { contextBridge, ipcRenderer } from 'electron'

/**
 * Preload of the page a plugin's renderer.js runs in (electron/main/services/plugin/pluginRendererHost.ts).
 * The page gets window.GETSSH as the sandboxed iframe in the main window gave it, so renderer.js
 * needs no change, and no RTCPeerConnection. Everything it sends goes to the main process, which
 * tells plugins apart by WebContents and checks every call; nothing else is exposed.
 */

// Before any script of the page runs. The page's own first script does the same (pluginPageProtocol.ts).
contextBridge.executeInMainWorld({
  func: () => {
    delete (window as any).RTCPeerConnection
    delete (window as any).webkitRTCPeerConnection
  },
})

let deliver: ((event: unknown) => void) | null = null
ipcRenderer.on('plugin-renderer:event', (_event, data: unknown) => deliver?.(data))

contextBridge.exposeInMainWorld('__getsshPluginHost', {
  send: (action: string, payload: unknown) => ipcRenderer.send('plugin-renderer:action', action, payload),
  // Taken once, by the window.GETSSH below, before the page's scripts run.
  onEvent: (callback: (event: unknown) => void) => {
    if (!deliver) deliver = callback
  },
})

// The app's language, which the main process put in the page URL.
const locale = new URLSearchParams(location.search).get('locale')

contextBridge.executeInMainWorld({
  func: (appLocale: string | null) => {
    const page = window as any
    const host = page.__getsshPluginHost
    page.__GETSSH_LOCALE = appLocale || navigator.language
    page.__themeListeners = []
    page.__sidebarHandlers = {}
    page.GETSSH = {
      // renderer.js only registers UI; a plugin page calls its backend.
      invokeBackend: () => Promise.reject(new Error('invokeBackend() is not available in renderer.js; call it from a plugin page.')),
      onBackendMessage: () => {},
      registerPanel: (panelId: unknown, title: unknown, renderUrl: unknown) => host.send('registerPanel', { panelId, title, renderUrl }),
      openPanel: (panelId: unknown) => host.send('openPanel', { panelId }),
      registerSidebarAction: (id: unknown, icon: unknown, label: unknown) => host.send('registerSidebarAction', { id, icon, label }),
      showNotification: (title: unknown, body: unknown) => host.send('showNotification', { title, body }),
      getLocale: () => page.__GETSSH_LOCALE,
      onThemeChange: (callback: unknown) => {
        page.__themeListeners.push(callback)
      },
    }
    host.onEvent((event: any) => {
      if (!event || typeof event !== 'object') return
      if (event.event === 'sidebarClick') {
        const handler = page.__sidebarHandlers[event.actionId]
        if (typeof handler === 'function') handler()
      } else if (event.event === 'envChange') {
        if (event.locale) page.__GETSSH_LOCALE = event.locale
        if (event.theme) page.__themeListeners.forEach((callback: unknown) => { if (typeof callback === 'function') callback(event.theme) })
      }
    })
  },
  args: [locale && /^[a-z]{2,8}(?:-[a-z0-9]{1,8}){0,4}$/i.test(locale) ? locale : null],
})
