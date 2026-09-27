import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A stand-in for the OS secret store: reversible, and it rejects anything it did not produce,
// like a real Keychain/DPAPI key would.
const fakeSafeStorage = vi.hoisted(() => {
  const PREFIX = Buffer.from('fake-os:');
  const state = { available: true, failEncrypt: false };
  return {
    state,
    isEncryptionAvailable: () => state.available,
    encryptString: (value: string) => {
      if (state.failEncrypt) throw new Error('encrypt failed');
      return Buffer.concat([PREFIX, Buffer.from(value, 'utf8').map(byte => byte ^ 0x5a)]);
    },
    decryptString: (blob: Buffer) => {
      if (!blob.subarray(0, PREFIX.length).equals(PREFIX)) throw new Error('Error while decrypting the ciphertext');
      return Buffer.from(blob.subarray(PREFIX.length).map(byte => byte ^ 0x5a)).toString('utf8');
    },
  };
});

vi.mock('electron', () => ({ safeStorage: fakeSafeStorage }));

import {
  decryptLegacyMockKeychainBlob,
  decryptSecret,
  encryptSecret,
  readSecretFile,
  readSecretFileAsync,
  SecretStoreUnavailableError,
  writeSecretFile,
} from './secretStore';

// Produced by Electron 42 on macOS: safeStorage.encryptString('golden-secret 密码 ✓') under --use-mock-keychain.
const GOLDEN_MOCK_BLOB = Buffer.from('763130543fda89a767b3ef1901c61cddcd79b55235520f6c05cba0e0bda02a32f983b2', 'hex');
const GOLDEN_VALUE = 'golden-secret 密码 ✓';

const realPlatform = process.platform;
function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-secret-store-'));
  fakeSafeStorage.state.available = true;
  fakeSafeStorage.state.failEncrypt = false;
  setPlatform('darwin');
});
afterEach(() => {
  setPlatform(realPlatform);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('legacy mock-keychain blobs', () => {
  it('decrypts a blob written by Electron under --use-mock-keychain', () => {
    expect(decryptLegacyMockKeychainBlob(GOLDEN_MOCK_BLOB)).toBe(GOLDEN_VALUE);
  });

  it('does not accept blobs that are not mock-keychain blobs', () => {
    expect(decryptLegacyMockKeychainBlob(Buffer.from('plain text'))).toBeNull();
    expect(decryptLegacyMockKeychainBlob(Buffer.concat([Buffer.from('v10'), Buffer.alloc(32, 7)]))).toBeNull();
    expect(decryptLegacyMockKeychainBlob(encryptSecret('x'))).toBeNull();
  });

  it('is only trusted on macOS; elsewhere un-prefixed blobs go to the OS store', () => {
    expect(decryptSecret(GOLDEN_MOCK_BLOB)).toEqual({ value: GOLDEN_VALUE, legacy: true });
    setPlatform('win32');
    expect(() => decryptSecret(GOLDEN_MOCK_BLOB)).toThrow(/decrypting/);
  });
});

describe('current format', () => {
  it('round-trips through the OS store and is marked as current', () => {
    const blob = encryptSecret('hunter2 🔑');
    expect(blob.subarray(0, 11).toString('ascii')).toBe('GETSSH-SS1:');
    expect(decryptSecret(blob)).toEqual({ value: 'hunter2 🔑', legacy: false });
  });

  it('never falls back to the public mock key for prefixed blobs', () => {
    const forged = Buffer.concat([Buffer.from('GETSSH-SS1:'), GOLDEN_MOCK_BLOB]);
    expect(() => decryptSecret(forged)).toThrow();
  });

  it('refuses to encrypt when the OS store is unavailable', () => {
    fakeSafeStorage.state.available = false;
    expect(() => encryptSecret('x')).toThrow(SecretStoreUnavailableError);
  });

  it('rejects values that fail validation', () => {
    expect(() => decryptSecret(encryptSecret('not-hex'), value => /^[0-9a-f]+$/.test(value))).toThrow(/expected value/);
  });
});

describe('secret files', () => {
  it('upgrades a legacy file in place and keeps it private', async () => {
    const file = path.join(dir, 'vault.key');
    fs.writeFileSync(file, GOLDEN_MOCK_BLOB);
    expect(await readSecretFileAsync(file)).toBe(GOLDEN_VALUE);
    const upgraded = fs.readFileSync(file);
    expect(upgraded.subarray(0, 11).toString('ascii')).toBe('GETSSH-SS1:');
    expect(decryptLegacyMockKeychainBlob(upgraded)).toBeNull();
    expect(decryptSecret(upgraded)).toEqual({ value: GOLDEN_VALUE, legacy: false });
    if (process.platform !== 'win32' && realPlatform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(dir)).toEqual(['vault.key']);
  });

  it('leaves the legacy file untouched when validation fails', () => {
    const file = path.join(dir, 'app_key.enc');
    fs.writeFileSync(file, GOLDEN_MOCK_BLOB);
    expect(() => readSecretFile(file, value => /^[0-9a-f]{64}$/.test(value))).toThrow();
    expect(fs.readFileSync(file).equals(GOLDEN_MOCK_BLOB)).toBe(true);
  });

  it('still returns the secret and keeps the legacy file when the upgrade cannot be written', () => {
    const file = path.join(dir, 'vault.key');
    fs.writeFileSync(file, GOLDEN_MOCK_BLOB);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    fakeSafeStorage.state.failEncrypt = true;
    expect(readSecretFile(file)).toBe(GOLDEN_VALUE);
    fakeSafeStorage.state.failEncrypt = false;
    fakeSafeStorage.state.available = false;
    expect(readSecretFile(file)).toBe(GOLDEN_VALUE);
    expect(fs.readFileSync(file).equals(GOLDEN_MOCK_BLOB)).toBe(true);
    expect(fs.readdirSync(dir)).toEqual(['vault.key']);
    warn.mockRestore();
  });

  it('writes atomically without leaving temporary files', () => {
    const file = path.join(dir, 'nested', 'ai_vault_default.enc');
    writeSecretFile(file, 'first');
    writeSecretFile(file, 'second');
    expect(readSecretFile(file)).toBe('second');
    expect(fs.readdirSync(path.dirname(file))).toEqual(['ai_vault_default.enc']);
  });
});
