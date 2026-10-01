import { create } from 'zustand';

/**
 * Renderer view of the active workspace's protection. No password is ever kept here: unlocking
 * happens in the main process, which only reports the outcome.
 */
interface CryptoStore {
  cryptoMode: 'idle' | 'locked' | 'setup';
  /** The active workspace opens without a password of its own (anyone at this computer can use it). */
  workspaceUnprotected: boolean;
  safeAction: 'none' | 'change' | 'disable' | 'enable';
  safeOldPwd: string;
  safeNewPwd: string;
  safeError: string;

  setCryptoMode: (mode: 'idle' | 'locked' | 'setup') => void;
  setWorkspaceUnprotected: (unprotected: boolean) => void;
  setSafeAction: (action: 'none' | 'change' | 'disable' | 'enable') => void;
  setSafeOldPwd: (pwd: string) => void;
  setSafeNewPwd: (pwd: string) => void;
  setSafeError: (err: string) => void;
  resetSafeForm: () => void;
}

export const useCryptoStore = create<CryptoStore>((set) => ({
  cryptoMode: 'idle',
  workspaceUnprotected: true,
  safeAction: 'none',
  safeOldPwd: '',
  safeNewPwd: '',
  safeError: '',

  setCryptoMode: (mode) => set({ cryptoMode: mode }),
  setWorkspaceUnprotected: (unprotected) => set({ workspaceUnprotected: unprotected }),
  setSafeAction: (action) => set({ safeAction: action }),
  setSafeOldPwd: (pwd) => set({ safeOldPwd: pwd }),
  setSafeNewPwd: (pwd) => set({ safeNewPwd: pwd }),
  setSafeError: (err) => set({ safeError: err }),
  resetSafeForm: () => set({ safeAction: 'none', safeOldPwd: '', safeNewPwd: '', safeError: '' }),
}));
