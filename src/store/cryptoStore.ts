import { create } from 'zustand';

interface CryptoStore {
  cryptoMode: 'idle' | 'locked' | 'setup';
  masterPassword: string;
  encryptionDisabled: boolean;
  safeAction: 'none' | 'change' | 'disable' | 'enable';
  safeOldPwd: string;
  safeNewPwd: string;
  safeError: string;

  setCryptoMode: (mode: 'idle' | 'locked' | 'setup') => void;
  setMasterPassword: (pwd: string) => void;
  setEncryptionDisabled: (disabled: boolean) => void;
  setSafeAction: (action: 'none' | 'change' | 'disable' | 'enable') => void;
  setSafeOldPwd: (pwd: string) => void;
  setSafeNewPwd: (pwd: string) => void;
  setSafeError: (err: string) => void;
  resetSafeForm: () => void;
}

export const useCryptoStore = create<CryptoStore>((set) => ({
  cryptoMode: 'idle',
  masterPassword: '',
  encryptionDisabled: false,
  safeAction: 'none',
  safeOldPwd: '',
  safeNewPwd: '',
  safeError: '',

  setCryptoMode: (mode) => set({ cryptoMode: mode }),
  setMasterPassword: (pwd) => set({ masterPassword: pwd }),
  setEncryptionDisabled: (disabled) => set({ encryptionDisabled: disabled }),
  setSafeAction: (action) => set({ safeAction: action }),
  setSafeOldPwd: (pwd) => set({ safeOldPwd: pwd }),
  setSafeNewPwd: (pwd) => set({ safeNewPwd: pwd }),
  setSafeError: (err) => set({ safeError: err }),
  resetSafeForm: () => set({ safeAction: 'none', safeOldPwd: '', safeNewPwd: '', safeError: '' }),
}));
