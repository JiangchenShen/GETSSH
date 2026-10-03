import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import type * as StoreModule from '../../../../../rust-core/getssh-store/store';
import type { StoreErrorCode } from '../../../../../rust-core/getssh-store/store';
import { getRustCorePath } from '../utils/rustCorePath';

/**
 * The one place in the main process that loads getssh-store (docs/GETSSH_STORE_DESIGN_CN.md).
 *
 * Normally the native module. In development, GETSSH_FAKE_STORE=1 runs the whole app on the
 * in-memory fake instead (nothing is read from or written to ~/.getssh); packaged builds never do.
 *
 * Until step S6, data written before the keystore existed (GETSSH 2.x) is still moved by
 * security/keystoreMigration.ts, with getssh-keystore and better-sqlite3-multiple-ciphers. appLock
 * runs that migration to the end, every file closed again, before configureStore(): two SQLite
 * libraries holding the same database files at the same time can corrupt them.
 */

export type GetsshStore = typeof StoreModule;
export type { StoreErrorCode };
export type StoreMode = 'native' | 'fake';

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
    const ms = Number.parseInt(/\d+/.exec(this.detail)?.[0] ?? '', 10);
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

export function isStoreError(error: unknown, code: StoreErrorCode): boolean {
  return toStoreError(error).code === code;
}

export function storeMode(): StoreMode {
  return process.env.GETSSH_FAKE_STORE && !app.isPackaged ? 'fake' : 'native';
}

export function storeBaseDir(): string {
  return path.join(os.homedir(), '.getssh');
}

/** Phase B functions the native module does not have yet: they answer `unavailable`. */
const NOT_YET = ['importSshKey', 'generateSshKey', 'listSshKeys', 'deleteSshKey'] as const;

let loaded: GetsshStore | null = null;

function load(): GetsshStore {
  if (storeMode() === 'fake') {
    console.warn('[Store] Running on the in-memory fake (GETSSH_FAKE_STORE=1); nothing is saved.');
    return require(path.join(getRustCorePath('getssh-store'), 'store.fake.js')) as GetsshStore;
  }
  const native = require(getRustCorePath('getssh-store')) as Record<string, unknown>;
  const store: Record<string, unknown> = { ...native };
  for (const name of NOT_YET) {
    if (typeof store[name] !== 'function') {
      store[name] = () => { throw new Error('[store:unavailable] not in this version of GETSSH'); };
    }
  }
  return store as unknown as GetsshStore;
}

/** Loads the store and points it at ~/.getssh. Call once, after the legacy migration. */
export function configureStore(): GetsshStore {
  if (!loaded) {
    const store = load();
    store.configure(storeBaseDir(), app.getVersion());
    loaded = store;
  }
  return loaded;
}

export function getStore(): GetsshStore {
  if (!loaded) throw new StoreError('not_configured', 'getssh-store has not started');
  return loaded;
}

/** Tests only: forget the loaded module so the next configureStore() loads it again. */
export function resetStoreForTest(): void {
  loaded = null;
}
