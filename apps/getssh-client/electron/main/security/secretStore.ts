import { safeStorage } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Local secrets (the SQLCipher app key, workspace master passwords, AI API keys) encrypted with the
 * OS secret store: the macOS Keychain or Windows DPAPI.
 *
 * Until 3.0 the macOS build ran Chromium with --use-mock-keychain, whose "Safe Storage" key is
 * derived from the constant "mock_password". Every blob written that way can be decrypted by
 * anyone holding the file. Those legacy blobs are still read here and rewritten with the real
 * Keychain key the first time they are loaded.
 *
 * New blobs carry a prefix. It is what tells the two apart: AES-CBC decryption with the wrong key
 * succeeds by chance about once in 256 tries and would return garbage, so "try one key, then the
 * other" cannot be relied on. The prefix also separates purposes: renderer-held config blobs
 * ('config') can neither be decrypted as nor pass for the files that hold identity secrets.
 */
export type SecretPurpose = 'secret' | 'config';

const FORMAT_MAGIC: Record<SecretPurpose, Buffer> = {
  secret: Buffer.from('GETSSH-SS1:', 'ascii'),
  config: Buffer.from('GETSSH-CF1:', 'ascii'),
};

function hasPrefix(blob: Buffer, prefix: Buffer): boolean {
  return blob.length >= prefix.length && blob.subarray(0, prefix.length).equals(prefix);
}

const LEGACY_PREFIX = Buffer.from('v10', 'ascii');
// Chromium os_crypt on macOS: PBKDF2-SHA1(keychain password, "saltysalt", 1003) -> AES-128-CBC, IV of spaces.
const LEGACY_MOCK_KEY = crypto.pbkdf2Sync('mock_password', 'saltysalt', 1003, 16, 'sha1');
const LEGACY_IV = Buffer.alloc(16, 0x20);

export class SecretStoreUnavailableError extends Error {
  constructor() {
    super('OS secure storage (Keychain / DPAPI) is unavailable');
    this.name = 'SecretStoreUnavailableError';
  }
}

export interface DecryptedSecret {
  value: string;
  /** The blob predates FORMAT_MAGIC and should be rewritten with encryptSecret(). */
  legacy: boolean;
}

export function isSecretStoreAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export function encryptSecret(value: string, purpose: SecretPurpose = 'secret'): Buffer {
  if (!safeStorage.isEncryptionAvailable()) throw new SecretStoreUnavailableError();
  return Buffer.concat([FORMAT_MAGIC[purpose], safeStorage.encryptString(value)]);
}

/** Checks a decrypted value's expected shape; a failing value is never returned or migrated. */
export type SecretValidator = (value: string) => boolean;

const acceptAny: SecretValidator = () => true;

function accepted(value: string, validate: SecretValidator): string {
  if (!validate(value)) throw new Error('Secret did not decrypt to the expected value');
  return value;
}

export function decryptSecret(blob: Buffer, validate: SecretValidator = acceptAny, purpose: SecretPurpose = 'secret'): DecryptedSecret {
  const own = FORMAT_MAGIC[purpose];
  if (hasPrefix(blob, own)) {
    if (!safeStorage.isEncryptionAvailable()) throw new SecretStoreUnavailableError();
    return { value: accepted(safeStorage.decryptString(blob.subarray(own.length)), validate), legacy: false };
  }
  if ((Object.keys(FORMAT_MAGIC) as SecretPurpose[]).some(other => other !== purpose && hasPrefix(blob, FORMAT_MAGIC[other]))) {
    throw new Error(`Blob was not written as ${purpose} data`);
  }
  if (process.platform === 'darwin') {
    const value = decryptLegacyMockKeychainBlob(blob);
    if (value !== null && validate(value)) return { value, legacy: true };
  }
  // Windows DPAPI blobs from before the prefix, or a macOS blob written with a real Keychain key by
  // a build that never used the mock keychain.
  if (!safeStorage.isEncryptionAvailable()) throw new SecretStoreUnavailableError();
  return { value: accepted(safeStorage.decryptString(blob), validate), legacy: true };
}

/** Plaintext of a blob written under --use-mock-keychain, or null if it is not one. */
export function decryptLegacyMockKeychainBlob(blob: Buffer): string | null {
  if (blob.length <= LEGACY_PREFIX.length || !blob.subarray(0, LEGACY_PREFIX.length).equals(LEGACY_PREFIX)) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', LEGACY_MOCK_KEY, LEGACY_IV);
    const plain = Buffer.concat([decipher.update(blob.subarray(LEGACY_PREFIX.length)), decipher.final()]);
    // A wrong key that happens to leave valid padding almost never yields valid UTF-8 as well.
    return new TextDecoder('utf-8', { fatal: true }).decode(plain);
  } catch {
    return null;
  }
}

/**
 * Writes an encrypted secret atomically: the new blob is decrypted again and compared before it
 * replaces the file, so a failed write never leaves a secret nobody can read.
 */
export function writeSecretFile(filePath: string, value: string): void {
  const blob = encryptSecret(value);
  if (decryptSecret(blob).value !== value) throw new Error('Secret store round-trip check failed');
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    const fd = fs.openSync(tempPath, 'wx', 0o600);
    try {
      fs.writeSync(fd, blob);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
}

/**
 * Reads a secret file. A legacy blob is rewritten in the current format; if that rewrite fails the
 * legacy file is left exactly as it was and the secret is still returned.
 */
export function readSecretFile(filePath: string, validate?: SecretValidator): string {
  const { value, legacy } = decryptSecret(fs.readFileSync(filePath), validate);
  if (legacy) migrateSecretFile(filePath, value);
  return value;
}

export async function readSecretFileAsync(filePath: string, validate?: SecretValidator): Promise<string> {
  const { value, legacy } = decryptSecret(await fs.promises.readFile(filePath), validate);
  if (legacy) migrateSecretFile(filePath, value);
  return value;
}

function migrateSecretFile(filePath: string, value: string): void {
  try {
    writeSecretFile(filePath, value);
  } catch (error) {
    console.warn(`[SecretStore] Could not upgrade ${path.basename(filePath)} to the OS secret store; keeping the legacy file:`, error);
  }
}
