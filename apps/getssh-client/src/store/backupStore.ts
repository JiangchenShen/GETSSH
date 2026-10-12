import { create } from 'zustand';
import type { ImportReport } from '../types/store';

/** Import replaces storage app-wide. Keep its non-secret restart notice across page switches.
 * Process restart clears it; do not persist it to the data directory being replaced. */
export const useBackupRestartStore = create<{ report: ImportReport | null }>(() => ({ report: null }));
