import { useEffect } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useAppStore } from '../store/appStore';
import { usePluginStore } from '../store/pluginStore';
import { usePanelStore } from '../store/panelStore';
import { initPluginBridge, bootSandboxedPlugins } from '../plugins/PluginBridge';
import { SFTPManager } from '../components/SFTPManager';

export function useAppBoot() {
  const initWorkspaces = useWorkspaceStore(state => state.initWorkspaces);
  const loadStoredConfig = useAppStore(state => state.loadStoredConfig);
  const setSystemIsDark = useAppStore(state => state.setSystemIsDark);
  const setIsAppBlurred = useAppStore(state => state.setIsAppBlurred);
  const syncConfigEffects = useAppStore(state => state.syncConfigEffects);
  const appConfig = useAppStore(state => state.appConfig);
  const systemIsDark = useAppStore(state => state.systemIsDark);

  // Initialize workspaces
  useEffect(() => {
    initWorkspaces();
  }, [initWorkspaces]);

  // Sync config effect
  useEffect(() => {
    syncConfigEffects();
  }, [appConfig, systemIsDark, syncConfigEffects]);

  // Check global app boot lock
  useEffect(() => {
    const checkAppBootLock = async () => {
      if (window.electronAPI && window.electronAPI.getGlobalSetting) {
        try {
          const hash = await window.electronAPI.getGlobalSetting('app_boot_password_hash');
          if (hash) {
            useAppStore.getState().setIsAppBootLocked(true);
          } else {
            useAppStore.getState().setIsAppBootLocked(false);
          }
        } catch (e) {
          useAppStore.getState().setIsAppBootLocked(false);
        }
        useAppStore.getState().setIsAppBootLoading(false);
      } else {
        useAppStore.getState().setIsAppBootLoading(false);
      }
    };
    checkAppBootLock();
  }, []);

  useEffect(() => {
    loadStoredConfig();

    // Fetch plugins as early as possible so UI is responsive instantly
    if (window.electronAPI && window.electronAPI.getPluginsList) {
      window.electronAPI.getPluginsList().then((res) => {
        usePluginStore.getState().setPlugins(res || []);
      });
    }

    // Boot Plugins in Sandbox (secure)
    const cleanupPluginBridge = initPluginBridge();
    bootSandboxedPlugins().catch(e => console.error('Failed to boot plugins:', e));

    // Register core panels in the dynamic panel engine
    usePanelStore.getState().registerPanel({
      id: 'sftp',
      title: 'SFTP Manager',
      component: SFTPManager,
      position: 'bottom',
      defaultSize: 280,
      minSize: 180,
      maxSize: 520,
    });

    // Init Theme Sync & Window Blur
    let unsubTheme: (() => void) | undefined;
    let unsubBlur: (() => void) | undefined;
    let unsubFocus: (() => void) | undefined;
    
    if (window.electronAPI && window.electronAPI.getTheme) {
      window.electronAPI.getTheme().then(setSystemIsDark);
      unsubTheme = window.electronAPI.onThemeChanged(setSystemIsDark);
      
      if (window.electronAPI.onAppBlur) {
        unsubBlur = window.electronAPI.onAppBlur(() => setIsAppBlurred(true));
        unsubFocus = window.electronAPI.onAppFocus(() => setIsAppBlurred(false));
      }
    }
    
    return () => {
      if (unsubTheme) unsubTheme();
      if (unsubBlur) unsubBlur();
      if (unsubFocus) unsubFocus();
      if (cleanupPluginBridge) cleanupPluginBridge();
    };
  }, [loadStoredConfig, setSystemIsDark, setIsAppBlurred]);
}
