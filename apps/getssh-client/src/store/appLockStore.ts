import { create } from 'zustand';
import type { AppLockState } from '../types/ipc';

/** Mirror of the main process app lock (see electron/main/security/appLock.ts). */
interface AppLockStore {
  state: AppLockState | null;
  setState: (state: AppLockState | null) => void;
}

export const useAppLockStore = create<AppLockStore>((set) => ({
  state: null,
  setState: (state) => set({ state }),
}));
