import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// App secrets on rust-core/getssh-store/store.fake.js, with a stand-in for safeStorage that counts
// every decryption (each one is a Keychain access in the real app).

const mocks = vi.hoisted(() => {
  const PREFIX = Buffer.from('fake-os:');
  const state = { decrypts: 0, userData: '', phase: 'ready' as 'starting' | 'locked' | 'ready' | 'error', waiters: [] as Array<() => void> };
  return {
    state,
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.concat([PREFIX, Buffer.from(value, 'utf8')]),
      decryptString: (blob: Buffer) => {
        state.decrypts++;
        if (!blob.subarray(0, PREFIX.length).equals(PREFIX)) throw new Error('Error while decrypting the ciphertext');
        return blob.subarray(PREFIX.length).toString('utf8');
      },
    },
    app: {
      isPackaged: false,
      getAppPath: () => process.cwd(),
      getVersion: () => '3.0.0-test',
      getPath: () => state.userData,
    },
    appLock: {
      isReady: () => state.phase === 'ready',
      whenOpen: () => state.phase === 'ready' || state.phase === 'error'
        ? Promise.resolve()
        : new Promise<void>(resolve => state.waiters.push(resolve)),
    },
  };
});

vi.mock('electron', () => ({ app: mocks.app, safeStorage: mocks.safeStorage }));
vi.mock('./appLock', () => ({ appLock: mocks.appLock }));

import { configureStore, getStore, resetStoreForTest } from '../services/getsshStore';
import { encryptSecret } from './secretStore';
import {
  deleteAiApiKey,
  getAiApiKey,
  readRendererConfig,
  RENDERER_CONFIG_MARKER,
  resetAppSecretsForTest,
  saveRendererConfig,
  setAiApiKey,
} from './appSecrets';

const fake = createRequire(import.meta.url)(path.resolve(process.cwd(), '../../rust-core/getssh-store/store.fake.js'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-app-secrets-'));
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, GETSSH_FAKE_STORE: process.env.GETSSH_FAKE_STORE };

function open(phase: typeof mocks.state.phase) {
  mocks.state.phase = phase;
  if (phase === 'ready' || phase === 'error') for (const resolve of mocks.state.waiters.splice(0)) resolve();
}

beforeEach(async () => {
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.GETSSH_FAKE_STORE = '1';
  mocks.state.userData = fs.mkdtempSync(path.join(home, 'user-data-'));
  mocks.state.decrypts = 0;
  open('ready');
  fake.__fake.reset();
  resetStoreForTest();
  resetAppSecretsForTest();
  await configureStore().start();
});

afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(home, { recursive: true, force: true });
});

const vault = (name: string) => path.join(mocks.state.userData, name);

describe('AI API keys', () => {
  it('moves a safeStorage vault file into the store once, then never touches the Keychain', () => {
    fs.writeFileSync(vault('ai_vault_openai.enc'), encryptSecret('sk-openai-1'));
    expect(getAiApiKey('OpenAI')).toBe('sk-openai-1');
    expect(fs.existsSync(vault('ai_vault_openai.enc'))).toBe(false);
    expect(mocks.state.decrypts).toBe(1);
    expect(getAiApiKey('openai')).toBe('sk-openai-1');
    expect(mocks.state.decrypts).toBe(1);
    expect(getStore().listAppSecretNames('ai/')).toEqual(['ai/openai']);
  });

  it('falls back to the shared key from before per-provider keys', () => {
    fs.writeFileSync(vault('ai_vault.enc'), encryptSecret('sk-shared'));
    setAiApiKey('gemini', 'sk-gemini');
    expect(getAiApiKey('gemini')).toBe('sk-gemini');
    expect(getAiApiKey('claude')).toBe('sk-shared');
    expect(fs.existsSync(vault('ai_vault.enc'))).toBe(false);
    deleteAiApiKey('claude');
    expect(getAiApiKey('claude')).toBe('');
    expect(getAiApiKey('gemini')).toBe('sk-gemini');
  });

  it('saving replaces an old vault file; a file that does not open stays', () => {
    fs.writeFileSync(vault('ai_vault_openai.enc'), encryptSecret('sk-old'));
    setAiApiKey('openai', 'sk-new');
    expect(fs.existsSync(vault('ai_vault_openai.enc'))).toBe(false);
    expect(getAiApiKey('openai')).toBe('sk-new');
    fs.writeFileSync(vault('ai_vault_broken.enc'), Buffer.from('GETSSH-SS1:not-ours'));
    expect(getAiApiKey('broken')).toBe('');
    expect(fs.existsSync(vault('ai_vault_broken.enc'))).toBe(true);
  });

  it('refuses provider names that are not plain names, and answers empty while locked', () => {
    expect(() => setAiApiKey('../escape', 'x')).toThrow(/provider/);
    expect(getAiApiKey('../escape')).toBe('');
    setAiApiKey('openai', 'sk-openai-1');
    getStore().lockApp('manual');
    fake.__fake.restart();
    expect(getAiApiKey('openai')).toBe('');
  });
});

describe('renderer settings', () => {
  const settings = { initScript: 'echo hi', proxyHost: 'proxy.lan', proxyPort: 3128, aiEndpoint: 'https://ai.lan' };
  const legacyBlob = () => encryptSecret(JSON.stringify(settings), 'config').toString('base64');

  it('moves an old safeStorage blob into the store; afterwards the marker is enough', async () => {
    expect(await readRendererConfig(legacyBlob())).toEqual(settings);
    expect(mocks.state.decrypts).toBe(1);
    expect(saveRendererConfig(settings)).toBe(RENDERER_CONFIG_MARKER);
    resetAppSecretsForTest();
    expect(await readRendererConfig(RENDERER_CONFIG_MARKER)).toEqual(settings);
    expect(mocks.state.decrypts).toBe(1);
  });

  it('reads base64 JSON written where safeStorage was unavailable', async () => {
    expect(await readRendererConfig(Buffer.from(JSON.stringify(settings)).toString('base64'))).toEqual(settings);
  });

  it('waits for the data to open before reading', async () => {
    saveRendererConfig(settings);
    resetAppSecretsForTest();
    open('locked');
    let result: unknown = 'pending';
    const read = readRendererConfig(RENDERER_CONFIG_MARKER).then(value => { result = value; });
    await Promise.resolve();
    expect(result).toBe('pending');
    open('ready');
    await read;
    expect(result).toEqual(settings);
  });

  it('never replaces stored settings the window has not received', async () => {
    saveRendererConfig(settings);
    resetAppSecretsForTest();
    expect(saveRendererConfig({ initScript: '' })).toBeNull();
    expect(await readRendererConfig(RENDERER_CONFIG_MARKER)).toEqual(settings);
    expect(saveRendererConfig({ ...settings, proxyPort: 8080 })).toBe(RENDERER_CONFIG_MARKER);
    expect(await readRendererConfig(RENDERER_CONFIG_MARKER)).toEqual({ ...settings, proxyPort: 8080 });
  });

  it('saves nothing while locked, and only plain objects of a sane size', async () => {
    await readRendererConfig(null);
    open('locked');
    expect(saveRendererConfig(settings)).toBeNull();
    open('ready');
    expect(saveRendererConfig(['not', 'an', 'object'])).toBeNull();
    expect(saveRendererConfig({ huge: 'x'.repeat(300 * 1024) })).toBeNull();
    expect(saveRendererConfig(settings)).toBe(RENDERER_CONFIG_MARKER);
  });

  it('answers null after a failed start instead of waiting forever', async () => {
    open('starting');
    const read = readRendererConfig(RENDERER_CONFIG_MARKER);
    open('error');
    expect(await read).toBeNull();
  });
});
