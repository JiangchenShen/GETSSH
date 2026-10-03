/**
 * What the renderer sees of getssh-store, through window.electronAPI.store.
 *
 * The renderer never receives a password, passphrase or private key. Profiles carry
 * hasPassword / hasPassphrase / keyId instead; a saved secret is shown in a system dialog by the
 * main process, and only that dialog can copy it (see `reveal`). The full interface, which only
 * the main process loads, is rust-core/getssh-store/store.d.ts.
 *
 * In development, GETSSH_FAKE_STORE=1 runs the whole app on an in-memory fake. After an import
 * the calls answer `unavailable` until the app relaunches, and so do the SSH key functions the
 * native module does not have yet (phase B).
 */
export type {
  BundleInfo,
  ExportCandidate,
  ExportReport,
  ImportReport,
  Profile,
  ProfileInput,
  SshKey,
  StoreErrorCode,
} from '../../../../rust-core/getssh-store/store';

import type { StoreErrorCode } from '../../../../rust-core/getssh-store/store';

/**
 * `error` is a StoreErrorCode, or one of: 'unauthorized' (not the main window, or the app is
 * locked), 'cancelled' (the user closed a file dialog or a Touch ID / Windows Hello prompt),
 * 'file_too_large' (an SSH key file over 64 KiB). `retryAfterMs` comes with 'rate_limited'.
 */
export type StoreResult<T extends object = {}> =
  | ({ ok: true } & T)
  | { ok: false; error: StoreErrorCode | 'unauthorized' | 'file_too_large'; retryAfterMs?: number };

export type SecretField = 'password' | 'passphrase';

/** Opens a 5-minute reveal window for one workspace; every reveal call extends it. */
export type RevealRoute = { method: 'presence' } | { method: 'password'; password: string };

/** Language of the system dialog that shows a secret; its words are fixed in the main process. */
export type RevealLanguage = 'zh-CN' | 'en-US';
