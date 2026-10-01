import os from 'node:os';
import path from 'node:path';
import { getRustCorePath } from '../utils/rustCorePath';
import { isValidWorkspaceId } from '../utils/workspaceId';

/**
 * Typed access to the native getssh-keystore module. Every key and credential encryption happens
 * in Rust; this process only receives what other libraries need (SQLCipher keys, a credential
 * while connecting). Nothing returned here may be forwarded to a renderer except status and
 * revealed fields.
 *
 * Scopes: "app" (main database, app-wide secrets) and "ws:<workspace id>".
 */

export type KeystoreErrorCode =
  | 'not_configured'
  | 'not_initialized'
  | 'already_initialized'
  | 'unknown_scope'
  | 'scope_exists'
  | 'locked'
  | 'no_password'
  | 'wrong_password'
  | 'rate_limited'
  | 'cancelled'
  | 'unavailable'
  | 'device_key_lost'
  | 'invalid_recovery_code'
  | 'reveal_locked'
  | 'rotation_pending'
  | 'no_rotation'
  | 'invalid_argument'
  | 'corrupt'
  | 'io'
  | 'internal';

export class KeystoreError extends Error {
  readonly code: KeystoreErrorCode;
  readonly detail: string;

  constructor(code: KeystoreErrorCode, detail: string) {
    super(detail ? `keystore ${code}: ${detail}` : `keystore ${code}`);
    this.name = 'KeystoreError';
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

const NATIVE_ERROR = /^\[keystore:([a-z_]+)\]\s*([\s\S]*)$/;

export function toKeystoreError(error: unknown): KeystoreError {
  if (error instanceof KeystoreError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const match = NATIVE_ERROR.exec(message);
  if (!match) return new KeystoreError('internal', message);
  return new KeystoreError(match[1] as KeystoreErrorCode, match[2]);
}

export function isKeystoreError(error: unknown, code?: KeystoreErrorCode): error is KeystoreError {
  return error instanceof KeystoreError && (code === undefined || error.code === code);
}

export const APP_SCOPE = 'app';

export function workspaceScope(workspaceId: string): string {
  if (!isValidWorkspaceId(workspaceId)) throw new KeystoreError('invalid_argument', 'invalid workspace id');
  return `ws:${workspaceId}`;
}

export interface ScopeStatus {
  id: string;
  protected: boolean;
  ownPassword: boolean;
  presence: boolean;
  unlocked: boolean;
  staged: boolean;
  recovery: boolean;
  masterLinked: boolean;
  revealRemainingMs?: number;
}

export interface KeystoreStatus {
  initialized: boolean;
  appProtected: boolean;
  recoveryConfigured: boolean;
  presenceSupported: boolean;
  quietBackend?: string;
  deviceKeyLost: boolean;
  scopes: ScopeStatus[];
}

interface NativeKeystore {
  configure(keyringPath: string): void;
  status(): KeystoreStatus;
  initialize(): Promise<void>;
  openScope(scope: string): Promise<void>;
  unlockWithPassword(scope: string, password: string): Promise<void>;
  unlockWithPresence(scope: string, reason: string): Promise<void>;
  unlockWithRecovery(code: string): Promise<string[]>;
  lockProtected(): void;
  lockScope(scope: string): void;
  createScope(scope: string, password?: string | null): Promise<void>;
  createScopeWithLegacyPassword(scope: string, password: string): Promise<void>;
  deleteScope(scope: string): Promise<void>;
  setPassword(scope: string, password: string): Promise<string[]>;
  removePassword(scope: string): Promise<string[]>;
  enablePresence(scope: string, reason: string): Promise<void>;
  disablePresence(scope: string): Promise<void>;
  setupRecovery(): Promise<string>;
  removeRecovery(): Promise<void>;
  commitRotation(scope: string): Promise<void>;
  abortRotation(scope: string): Promise<void>;
  databaseKey(scope: string, label: string, staged?: boolean | null): Buffer;
  sealField(scope: string, context: string, plaintext: string): string;
  openField(scope: string, context: string, sealed: string): string;
  isSealedField(value: string): boolean;
  openRevealWithPresence(scope: string, reason: string): Promise<void>;
  openRevealWithPassword(scope: string, password: string): Promise<void>;
  revealField(scope: string, context: string, sealed: string): string;
  closeReveal(): void;
  verifyPresence(reason: string): Promise<void>;
  verifyPassword(scope: string, password: string): Promise<void>;
  probeDevice(): Promise<string>;
  setParentWindow(handle: Buffer): void;
  isRecoveryCodeWellFormed(code: string): boolean;
}

let native: NativeKeystore | null = null;

function binding(): NativeKeystore {
  if (!native) native = require(getRustCorePath('getssh-keystore')) as NativeKeystore;
  return native;
}

function call<T>(fn: (keystore: NativeKeystore) => T): T {
  try {
    return fn(binding());
  } catch (error) {
    throw toKeystoreError(error);
  }
}

async function callAsync<T>(fn: (keystore: NativeKeystore) => Promise<T>): Promise<T> {
  try {
    return await fn(binding());
  } catch (error) {
    throw toKeystoreError(error);
  }
}

export function defaultKeyringPath(): string {
  return path.join(os.homedir(), '.getssh', 'keyring.json');
}

/** Labels for keys derived from a scope (letters, digits and dashes). */
export const DATABASE_KEY_LABEL = 'database';

export const keystore = {
  /** Once per process. */
  configure: (keyringPath: string = defaultKeyringPath()) => call(k => k.configure(keyringPath)),
  status: () => call(k => k.status()),
  initialize: () => callAsync(k => k.initialize()),

  openScope: (scope: string) => callAsync(k => k.openScope(scope)),
  unlockWithPassword: (scope: string, password: string) => callAsync(k => k.unlockWithPassword(scope, password)),
  unlockWithPresence: (scope: string, reason: string) => callAsync(k => k.unlockWithPresence(scope, reason)),
  unlockWithRecovery: (code: string) => callAsync(k => k.unlockWithRecovery(code)),
  lockProtected: () => call(k => k.lockProtected()),
  lockScope: (scope: string) => call(k => k.lockScope(scope)),

  createScope: (scope: string, password?: string) => callAsync(k => k.createScope(scope, password ?? null)),
  /** Migration only: keeps a pre-3.0 workspace password even if it is shorter than allowed now. */
  createScopeWithLegacyPassword: (scope: string, password: string) =>
    callAsync(k => k.createScopeWithLegacyPassword(scope, password)),
  deleteScope: (scope: string) => callAsync(k => k.deleteScope(scope)),
  setPassword: (scope: string, password: string) => callAsync(k => k.setPassword(scope, password)),
  removePassword: (scope: string) => callAsync(k => k.removePassword(scope)),
  enablePresence: (scope: string, reason: string) => callAsync(k => k.enablePresence(scope, reason)),
  disablePresence: (scope: string) => callAsync(k => k.disablePresence(scope)),
  setupRecovery: () => callAsync(k => k.setupRecovery()),
  removeRecovery: () => callAsync(k => k.removeRecovery()),
  commitRotation: (scope: string) => callAsync(k => k.commitRotation(scope)),
  abortRotation: (scope: string) => callAsync(k => k.abortRotation(scope)),

  /** A fresh Buffer: pass it to SQLCipher and zero-fill it right after. */
  databaseKey: (scope: string, options: { label?: string; staged?: boolean } = {}) =>
    call(k => k.databaseKey(scope, options.label ?? DATABASE_KEY_LABEL, options.staged ?? false)),

  sealField: (scope: string, context: string, plaintext: string) => call(k => k.sealField(scope, context, plaintext)),
  /** For use in this process only (connecting). Never send the result to a renderer. */
  openField: (scope: string, context: string, sealed: string) => call(k => k.openField(scope, context, sealed)),
  isSealedField: (value: unknown): value is string => typeof value === 'string' && call(k => k.isSealedField(value)),

  openRevealWithPresence: (scope: string, reason: string) => callAsync(k => k.openRevealWithPresence(scope, reason)),
  openRevealWithPassword: (scope: string, password: string) => callAsync(k => k.openRevealWithPassword(scope, password)),
  /** For display; needs an open reveal session. */
  revealField: (scope: string, context: string, sealed: string) => call(k => k.revealField(scope, context, sealed)),
  closeReveal: () => call(k => k.closeReveal()),

  verifyPresence: (reason: string) => callAsync(k => k.verifyPresence(reason)),
  verifyPassword: (scope: string, password: string) => callAsync(k => k.verifyPassword(scope, password)),
  probeDevice: () => callAsync(k => k.probeDevice()),
  setParentWindow: (handle: Buffer) => call(k => k.setParentWindow(handle)),
  isRecoveryCodeWellFormed: (code: string) => call(k => k.isRecoveryCodeWellFormed(code)),
};

/** Runs `use` with a database key and zero-fills it afterwards, whatever happens. */
export function withDatabaseKey<T>(scope: string, use: (key: Buffer) => T, options: { staged?: boolean } = {}): T {
  const key = keystore.databaseKey(scope, options);
  try {
    return use(key);
  } finally {
    key.fill(0);
  }
}
