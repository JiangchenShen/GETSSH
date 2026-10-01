import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_SCOPE, isKeystoreError, keystore, KeystoreError, toKeystoreError, withDatabaseKey, workspaceScope } from './keystore';

// Runs against the real native module and this machine's device key (Secure Enclave or Keychain on
// macOS, TPM or DPAPI on Windows) with a keyring in a temporary directory. Only operations that
// never prompt are used: nothing here touches Touch ID, Windows Hello or ~/.getssh. The native
// keystore can be configured once per process, so every case shares one keyring.

let dir: string;

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    return isKeystoreError(error) ? error.code : `unexpected: ${String(error)}`;
  }
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-keystore-test-'));
  keystore.configure(path.join(dir, 'keyring.json'));
  await keystore.initialize();
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('error mapping', () => {
  it('parses native error codes', () => {
    const error = toKeystoreError(new Error('[keystore:rate_limited] 1500'));
    expect(error).toBeInstanceOf(KeystoreError);
    expect(error.code).toBe('rate_limited');
    expect(error.retryAfterMs).toBe(1500);
    expect(toKeystoreError(new Error('[keystore:locked] ws:a')).detail).toBe('ws:a');
    expect(toKeystoreError(new Error('boom')).code).toBe('internal');
  });

  it('refuses invalid workspace ids before they reach native code', () => {
    expect(workspaceScope('生产 环境')).toBe('ws:生产 环境');
    expect(() => workspaceScope('../x')).toThrow(KeystoreError);
    expect(() => workspaceScope('a|b')).toThrow(KeystoreError);
  });
});

describe('real keystore', () => {
  it('reports its device backend and a round trip through it', async () => {
    const status = keystore.status();
    expect(status.initialized).toBe(true);
    expect(status.appProtected).toBe(false);
    expect(status.quietBackend).toMatch(/^(macos-se|macos-keychain|windows-tpm|windows-dpapi)$/);
    expect(await keystore.probeDevice()).toMatch(/^(macos-se|macos-keychain|windows-tpm|windows-dpapi)$/);
    expect(await code(keystore.initialize())).toBe('already_initialized');
    expect(() => keystore.configure(path.join(dir, 'other.json'))).toThrow(/invalid_argument/);
  });

  it('derives stable database keys and zero-fills them after use', () => {
    let seen: Buffer | undefined;
    const hex = withDatabaseKey(APP_SCOPE, key => {
      seen = key;
      return key.toString('hex');
    });
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(seen?.every(byte => byte === 0)).toBe(true);
    expect(withDatabaseKey(APP_SCOPE, key => key.toString('hex'))).toBe(hex);
    expect(keystore.databaseKey(APP_SCOPE, { label: 'memory' }).toString('hex')).not.toBe(hex);
  });

  it('protects a workspace with its own password and rotates its key', async () => {
    const scope = workspaceScope('keystore-test-own');
    await keystore.createScope(scope);
    const sealed = keystore.sealField(scope, 'profile:1:password', 'hunter2 🔑');
    expect(sealed.startsWith('gk1:')).toBe(true);
    expect(keystore.isSealedField(sealed)).toBe(true);
    expect(keystore.isSealedField('hunter2')).toBe(false);
    expect(keystore.openField(scope, 'profile:1:password', sealed)).toBe('hunter2 🔑');
    expect(() => keystore.openField(scope, 'profile:2:password', sealed)).toThrow(KeystoreError);

    const before = keystore.databaseKey(scope).toString('hex');
    expect(await keystore.setPassword(scope, 'correct horse')).toEqual([scope]);
    const staged = keystore.databaseKey(scope, { staged: true }).toString('hex');
    expect(staged).not.toBe(before);
    await keystore.commitRotation(scope);
    expect(keystore.databaseKey(scope).toString('hex')).toBe(staged);

    keystore.lockProtected();
    expect(await code(keystore.openScope(scope))).toBe('locked');
    expect(() => keystore.databaseKey(scope)).toThrow(/locked/);
    expect(await code(keystore.unlockWithPassword(scope, 'wrong horse'))).toBe('wrong_password');
    await keystore.unlockWithPassword(scope, 'correct horse');
    expect(keystore.openField(scope, 'profile:1:password', sealed)).toBe('hunter2 🔑');
  });

  it('keeps revealing behind a reveal session', async () => {
    const scope = workspaceScope('keystore-test-own');
    const sealed = keystore.sealField(scope, 'profile:9:password', 'shown');
    keystore.closeReveal();
    expect(() => keystore.revealField(scope, 'profile:9:password', sealed)).toThrow(/reveal_locked/);
    expect(await code(keystore.openRevealWithPassword(scope, 'nope nope'))).toBe('wrong_password');
    await keystore.openRevealWithPassword(scope, 'correct horse');
    expect(keystore.revealField(scope, 'profile:9:password', sealed)).toBe('shown');
    expect(keystore.status().scopes.find(s => s.id === scope)?.revealRemainingMs).toBeGreaterThan(0);
    keystore.closeReveal();
  });

  it('creates recovery codes that are well formed and shown once', async () => {
    const code1 = await keystore.setupRecovery();
    expect(code1).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){7}$/);
    expect(keystore.isRecoveryCodeWellFormed(code1.toLowerCase().replace(/-/g, ' '))).toBe(true);
    expect(keystore.isRecoveryCodeWellFormed('AAAA-AAAA')).toBe(false);
    const text = fs.readFileSync(path.join(dir, 'keyring.json'), 'utf8');
    expect(text).not.toContain(code1);
    expect(text).not.toContain(code1.replace(/-/g, ''));
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('correct horse');
    expect(await keystore.unlockWithRecovery(code1)).toContain(APP_SCOPE);
  });
});
