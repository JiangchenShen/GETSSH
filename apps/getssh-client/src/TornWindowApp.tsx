import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TerminalPaneRenderer } from './components/TerminalPane';
import { HostKeyVerificationModal } from './components/HostKeyVerificationModal';
import { ToastProvider } from './components/ToastProvider';
import { SplitPane } from './components/SplitPane';
import { registerSftpPanel } from './components/SFTPManager';
import { useAppStore } from './store/appStore';
import { PaneNode, useSessionStore } from './store/sessionStore';
import { usePluginStore } from './store/pluginStore';

/**
 * Root of a torn-off window (loaded with ?isHollow=true).
 *
 * The window is owned by exactly one Rust tab. The main process creates it, hands it the tab id
 * (window:get-torn-identity) and closes it when that tab disappears or is attached back, so this
 * renderer never closes itself. None of the main window's boot hooks run here: no crypto boot,
 * auto-start, workspace init, profile saves, config write-back or plugin boot. Config is read-only
 * and follows the main window through `storage` events.
 */

type TornStatus = 'loading' | 'ready' | 'missing' | 'closed';

function firstLeafId(node: PaneNode): string {
  return node.type === 'leaf' ? node.paneId : firstLeafId(node.children[0]);
}

function hasLeaf(node: PaneNode, paneId: string): boolean {
  if (node.type === 'leaf') return node.paneId === paneId;
  return hasLeaf(node.children[0], paneId) || hasLeaf(node.children[1], paneId);
}

// The torn tree renders without split controls, so this is never called.
const noSplit = () => {};

function TornWindowApp() {
  const { i18n } = useTranslation();
  const [status, setStatus] = useState<TornStatus>('loading');
  const [tornTabId, setTornTabId] = useState<string | null>(null);

  const tab = useSessionStore(state => (tornTabId ? state.tabs.find(t => t.id === tornTabId) : undefined));
  const appConfig = useAppStore(state => state.appConfig);
  const isDark = useAppStore(state => state.isDark);
  const isMac = useAppStore(state => state.isMac);
  const isFullScreen = useAppStore(state => state.isFullScreen);
  const isAppBlurred = useAppStore(state => state.isAppBlurred);

  // Read-only config, theme, privacy blur, fullscreen state and host-key prompts.
  // This window has its own panel host; the SFTP panel follows the active pane of the torn tab.
  useEffect(() => { registerSftpPanel(); }, []);

  useEffect(() => {
    const app = useAppStore.getState();
    const api = window.electronAPI;
    const cleanups: Array<() => void> = [];

    app.loadConfigReadOnly();
    // The main window persists every config change to localStorage; follow it live without writing back.
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === 'appConfig') useAppStore.getState().loadConfigReadOnly();
    };
    window.addEventListener('storage', onStorage);
    cleanups.push(() => window.removeEventListener('storage', onStorage));

    const applySystemTheme = (dark: boolean) => {
      useAppStore.getState().setSystemIsDark(dark);
      useAppStore.getState().refreshConfigVisuals();
    };
    if (api?.getTheme) {
      api.getTheme().then(applySystemTheme).catch(() => {});
      if (api.onThemeChanged) cleanups.push(api.onThemeChanged(applySystemTheme));
    }
    if (api?.onAppBlur) cleanups.push(api.onAppBlur(() => app.setIsAppBlurred(true)));
    if (api?.onAppFocus) cleanups.push(api.onAppFocus(() => app.setIsAppBlurred(false)));
    if (api?.onFullScreenState) cleanups.push(api.onFullScreenState((full) => app.setIsFullScreen(full)));
    if (api?.onPromptHostVerification) {
      // A reconnect started in this window gets its host-key prompt here.
      cleanups.push(api.onPromptHostVerification((data) => {
        app.enqueueSecurityPrompt({
          requestId: data.requestId,
          hostname: data.hostname,
          fingerprint: data.fingerprint,
          isChanged: data.isChanged,
          oldFingerprint: data.oldFingerprint,
        });
      }));
    }
    if (api?.onHostVerificationCancelled) {
      cleanups.push(api.onHostVerificationCancelled((requestId) => app.dropSecurityPrompt(requestId)));
    }

    // Plugin terminal/SFTP menu extensions and settings schemas: follow the broadcasts and pull the
    // current state once (this window may open long after the last broadcast). No plugin boot here.
    let disposed = false;
    cleanups.push(() => { disposed = true; });
    if (api?.onSyncPluginUIExtensions) {
      cleanups.push(api.onSyncPluginUIExtensions((payload) => usePluginStore.getState().setUIExtensions(payload)));
    }
    if (api?.onSyncPluginSettingsSchemas) {
      cleanups.push(api.onSyncPluginSettingsSchemas((payload) => usePluginStore.getState().setSettingsSchemas(payload)));
    }
    api?.getPluginUiExtensions?.()
      .then((payload) => { if (!disposed && payload) usePluginStore.getState().setUIExtensions(payload); })
      .catch(() => {});
    api?.getPluginSettingsSchemas?.()
      .then((payload) => { if (!disposed && payload) usePluginStore.getState().setSettingsSchemas(payload); })
      .catch(() => {});

    return () => cleanups.forEach(fn => fn());
  }, []);

  // Identity + layout sync: seed the session store with exactly our tab, then apply only newer
  // payloads for that tab. Everything else broadcast by tidal-engine belongs to other windows.
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.windowGetTornIdentity || !api.onTidalSyncTree) {
      setStatus('missing');
      return;
    }

    let disposed = false;
    let ownTabId: string | null = null;
    let lastRev = 0;
    const early: TidalTabSync[] = [];

    const apply = (payload: TidalTabSync) => {
      if (payload.tabId !== ownTabId || payload.rev <= lastRev) return;
      lastRev = payload.rev;
      const tree = payload.tree;
      if (!tree) {
        // The tab is gone; the main process closes this window.
        useSessionStore.setState(state => {
          state.tabs = [];
          state.activeTabId = null;
          state.activePaneId = null;
        });
        setStatus('closed');
        return;
      }
      useSessionStore.setState(state => {
        const prev = state.tabs.find(t => t.id === payload.tabId);
        state.tabs = [{
          id: payload.tabId,
          title: payload.title || prev?.title || 'Terminal',
          config: tree.type === 'leaf' ? tree.config : (prev?.config ?? null),
          workspaceId: payload.workspaceId ?? prev?.workspaceId,
          paneTree: tree,
          isTornOff: payload.isTornOff,
        }];
        state.activeTabId = payload.tabId;
        if (!state.activePaneId || !hasLeaf(tree, state.activePaneId)) {
          state.activePaneId = firstLeafId(tree);
        }
      });
      setStatus('ready');
    };

    // Subscribe before asking for the identity so no payload emitted in between is lost.
    const unsubscribe = api.onTidalSyncTree((payload) => {
      if (disposed) return;
      if (ownTabId) apply(payload);
      else early.push(payload);
    });

    (async () => {
      const identity = await api.windowGetTornIdentity().catch(() => null);
      if (disposed) return;
      if (!identity?.tabId) {
        setStatus('missing');
        return;
      }
      ownTabId = identity.tabId;
      setTornTabId(identity.tabId);
      let snapshot = identity.snapshot;
      if (!snapshot && api.tidalGetTab) snapshot = await api.tidalGetTab(identity.tabId).catch(() => null);
      if (disposed) return;
      if (snapshot) apply(snapshot);
      early.splice(0).forEach(apply);
    })();

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    i18n.changeLanguage(appConfig.language);
  }, [appConfig.language, i18n]);

  useEffect(() => {
    if (tab?.title) document.title = tab.title;
  }, [tab?.title]);

  const isWindows = window.electronAPI?.getEnvInfo?.().platform === 'win32';
  let backgroundColor: string;
  if (!isDark) {
    const uiOpacity = appConfig.enableGlassmorphism ? (appConfig.bgOpacity ?? 0.8) : 1;
    backgroundColor = `rgba(244, 244, 245, ${uiOpacity})`;
  } else if (!appConfig.enableGlassmorphism) {
    backgroundColor = '#09090b';
  } else {
    backgroundColor = `rgba(9, 9, 11, ${appConfig.bgOpacity ?? 1})`;
  }

  const statusText =
    status === 'missing' ? 'This window is not attached to a tab.'
    : status === 'closed' ? 'This tab was closed.'
    : 'Loading…';

  return (
    <div
      className={`w-screen h-screen overflow-hidden flex flex-col font-sans text-ink transition-all duration-200 relative ${isAppBlurred && appConfig.privacyMode ? 'blur-2xl brightness-50 pointer-events-none' : ''}`}
      style={{ backgroundColor }}
    >
      {!isFullScreen && (
        // Drag title bar; leaves room for the macOS traffic lights / the Windows caption buttons.
        <div
          className={`drag-region flex items-center justify-center shrink-0 w-full text-xs font-medium select-none ${isMac ? 'h-10 pl-20' : 'h-8'} ${isWindows ? 'pr-[140px]' : ''}`}
        >
          <span className="truncate font-bold tracking-widest text-ink-3">{tab?.title || 'GETSSH'}</span>
        </div>
      )}

      <div className="flex-1 min-h-0 w-full relative flex flex-col">
        {status === 'ready' && tab?.paneTree ? (
          // The SFTP panel docks below the torn tab, same as in the main window.
          <SplitPane isDark={isDark} activeTabId={tab.id}>
            <div className="absolute inset-0">
              <TerminalPaneRenderer
                node={tab.paneTree}
                tabId={tab.id}
                appConfig={appConfig}
                isDark={isDark}
                isTabActive={true}
                onSplit={noSplit}
              />
            </div>
          </SplitPane>
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-ink-3">{statusText}</div>
        )}
      </div>

      <HostKeyVerificationModal />
      <ToastProvider />
    </div>
  );
}

export default TornWindowApp;
