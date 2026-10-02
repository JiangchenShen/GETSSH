import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import type * as StoreModule from '../../../../../rust-core/getssh-store/store';
import type { StoreErrorCode } from '../../../../../rust-core/getssh-store/store';
import { getRustCorePath } from '../utils/rustCorePath';

/**
 * The one place in the main process that loads getssh-store (docs/GETSSH_STORE_DESIGN_CN.md).
 *
 * The real module is not loaded yet. Its start() opens keyring.json and main.db, which
 * getssh-keystore and better-sqlite3-multiple-ciphers already hold; two SQLite libraries with the
 * same database files open in one process can corrupt them. It replaces both once DatabaseManager
 * moves onto the store. Until then only the in-memory fake runs, in development with
 * GETSSH_FAKE_STORE=1, so the store screens can be built; every store IPC call answers
 * `unavailable` otherwise.
 */

export type GetsshStore = typeof StoreModule;
export type { StoreErrorCode };
export type StoreMode = 'fake' | 'off';

export class StoreError extends Error {
  readonly code: StoreErrorCode;
  readonly detail: string;

  constructor(code: StoreErrorCode, detail: string) {
    super(detail ? `store ${code}: ${detail}` : `store ${code}`);
    this.name = 'StoreError';
    this.code = code;
    this.detail = detail;
  }

  /** For rate_limited: how long to wait before the next password attempt. */
  get retryAfterMs(): number | undefined {
    if (this.code !== 'rate_limited') return undefined;
    const ms = Number.parseInt(this.detail, 10);
    return Number.isFinite(ms) ? ms : undefined;
  }
}

const NATIVE_ERROR = /^\[store:([a-z_]+)\]\s*([\s\S]*)$/;

export function toStoreError(error: unknown): StoreError {
  if (error instanceof StoreError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const match = NATIVE_ERROR.exec(message);
  if (!match) return new StoreError('internal', message);
  return new StoreError(match[1] as StoreErrorCode, match[2]);
}

export function storeMode(): StoreMode {
  return process.env.GETSSH_FAKE_STORE && !app.isPackaged ? 'fake' : 'off';
}

let loaded: GetsshStore | null = null;
let starting: Promise<void> | null = null;

/** Loads and starts the store when this build uses one. Later calls return the same promise. */
export function startStore(): Promise<void> {
  if (storeMode() === 'off') return Promise.resolve();
  if (!starting) {
    starting = (async () => {
      const store = require(path.join(getRustCorePath('getssh-store'), 'store.fake.js')) as GetsshStore;
      store.configure(path.join(os.homedir(), '.getssh'), app.getVersion());
      await store.start();
      loaded = store;
      console.warn('[Store] Running on the in-memory fake (GETSSH_FAKE_STORE=1); nothing is saved.');
    })();
  }
  return starting;
}

export function getStore(): GetsshStore {
  if (storeMode() === 'off') throw new StoreError('unavailable', 'getssh-store is not connected yet');
  if (!loaded) throw new StoreError('not_configured', 'getssh-store has not started');
  return loaded;
}

/** Tests only: forget the loaded module so the next startStore() loads it again. */
export function resetStoreForTest(): void {
  loaded = null;
  starting = null;
}
