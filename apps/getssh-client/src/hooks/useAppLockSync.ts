import { useEffect } from 'react';
import { loadActiveWorkspace } from '../lib/workspaceUnlock';
import { useAppLockStore } from '../store/appLockStore';
import { useCryptoStore } from '../store/cryptoStore';
import { useSessionStore } from '../store/sessionStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { AppLockState } from '../types/ipc';

/**
 * Keeps the renderer in step with the main process lock: the app lock itself, and workspaces
 * that were locked behind the window's back (idle time, screen lock, sleep).
 */
export function useAppLockSync() {
  const setState = useAppLockStore(state => state.setState);

  useEffect(() => {
    if (!window.electronAPI?.appLock) {
      // Development without the main process: behave as an unlocked app.
      setState({ phase: 'ready', appProtected: false, presenceSupported: false, presenceEnabled: false, recoveryConfigured: false, deviceKeyLost: false });
      return;
    }
    let disposed = false;
    let wasLocked = false;
    const apply = (state: AppLockState | null) => {
      if (disposed || !state) return;
      setState(state);
      if (state.phase === 'locked') {
        // Whatever the locked app had loaded leaves the window too.
        wasLocked = true;
        useSessionStore.getState().setSessions([]);
      } else if (state.phase === 'ready') {
        if (wasLocked) {
          wasLocked = false;
          void reloadActiveWorkspace();
        } else {
          void recheckActiveWorkspace();
        }
      }
    };
    void window.electronAPI.appLock.getState().then(apply);
    const unsubscribe = window.electronAPI.appLock.onChanged(apply);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [setState]);
}

/** After the whole app was locked: open the active workspace again (or ask for its password). */
async function reloadActiveWorkspace() {
  const result = await window.electronAPI.checkProfiles().catch(() => null);
  if (!result) return;
  useCryptoStore.getState().setWorkspaceUnprotected(!result.hasPassword);
  if (result.status === 'plain' && (await loadActiveWorkspace())) return;
  useWorkspaceStore.setState({ isVaultLocked: true, isUnlockModalOpen: false });
}

/** If the active workspace was locked meanwhile, drop its profiles and show its unlock screen. */
async function recheckActiveWorkspace() {
  if (useWorkspaceStore.getState().isVaultLocked) return;
  try {
    const result = await window.electronAPI.checkProfiles();
    if (result.status === 'encrypted') {
      useSessionStore.getState().setSessions([]);
      useWorkspaceStore.setState({ isVaultLocked: true, isUnlockModalOpen: false });
      useCryptoStore.getState().setWorkspaceUnprotected(!result.hasPassword);
    }
  } catch {
    // The next workspace action reports the problem.
  }
}
