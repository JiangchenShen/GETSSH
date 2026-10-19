import { create } from 'zustand';

/**
 * A recovery code was created in this run and nobody confirmed saving it. The code itself lives
 * only in SafeStorageTab and is gone once that closes or the app locks; this flag outlives it, so
 * Settings can say the code was never confirmed. It holds no secret and is not persisted.
 */
interface RecoveryReminderStore {
  unconfirmed: boolean;
  /** SafeStorageTab is showing the code right now (no reminder needed while it is on screen). */
  visible: boolean;
  setUnconfirmed: (unconfirmed: boolean) => void;
  setVisible: (visible: boolean) => void;
}

export const useRecoveryReminderStore = create<RecoveryReminderStore>(set => ({
  unconfirmed: false,
  visible: false,
  setUnconfirmed: unconfirmed => set({ unconfirmed }),
  setVisible: visible => set({ visible }),
}));
