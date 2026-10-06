import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// appLock's unlock and ready transitions on a scripted store (no native module, no ~/.getssh):
// unlockApp and the GETSSH 2.0 import are promises the tests settle by hand, so the order of
// events can be checked while they are still running.

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

const mocks = vi.hoisted(() => {
  const sent: string[] = [];
  const store = {
    phase: 'locked' as 'locked' | 'ready',
    unlockCalls: [] as unknown[],
    inFlight: 0,
    maxInFlight: 0,
    /** Settles the next unlockApp: true opens the app, false rejects as a wrong password. */
    pending: [] as Array<(ok: boolean) => void>,
    legacy: false,
    startArgs: [] as unknown[],
    lockCalls: [] as string[],
    startGate: null as null | Promise<unknown>,
    startError: null as null | string,
  };
  const v2 = { calls: 0, gate: null as null | Promise<unknown> };
  return { sent, store, v2, base: '' };
});

vi.mock('electron', () => ({
  app: { getPath: () => '/nonexistent-user-data' },
  powerMonitor: { on: () => {}, getSystemIdleTime: () => 0 },
  BrowserWindow: {
    getAllWindows: () => [{
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send: (_channel: string, state: { phase: string }) => mocks.sent.push(state.phase) },
    }],
  },
}));

vi.mock('../services/getsshStore', () => {
  const fakeStore = {
    needsLegacyMigration: () => mocks.store.legacy,
    start: async (legacy?: unknown) => {
      mocks.store.startArgs.push(legacy);
      await mocks.store.startGate;
      if (mocks.store.startError) throw new Error(mocks.store.startError);
      return { migratedWorkspaces: [], deferredWorkspaces: [], presenceToReenable: [], failedWorkspaces: [] };
    },
    appState: () => ({ phase: mocks.store.phase, masterPassword: true }),
    unlockApp: (route: unknown) => {
      mocks.store.unlockCalls.push(route);
      mocks.store.inFlight++;
      mocks.store.maxInFlight = Math.max(mocks.store.maxInFlight, mocks.store.inFlight);
      return new Promise((resolve, reject) => {
        mocks.store.pending.push(ok => {
          mocks.store.inFlight--;
          if (ok) {
            mocks.store.phase = 'ready';
            resolve({ phase: 'ready' });
          } else {
            reject(new Error('[store:wrong_password] wrong password'));
          }
        });
      });
    },
    lockApp: (reason: string) => {
      mocks.store.lockCalls.push(reason);
      mocks.store.phase = 'locked';
    },
    listWorkspaces: () => [],
  };
  return {
    configureStore: () => fakeStore,
    getStore: () => fakeStore,
    storeBaseDir: () => mocks.base,
    storeMode: () => 'native',
    toStoreError: (error: unknown) => {
      const match = /\[store:(\w+)\]/.exec(String((error as Error)?.message ?? error));
      return { code: match ? match[1] : 'internal', detail: String(error) };
    },
  };
});

// safeStorage cannot open app_key.enc (the Keychain item was reset, the data came from another machine).
vi.mock('./secretStore', () => ({
  decryptSecret: () => {
    throw new Error('Error while decrypting the ciphertext');
  },
}));

vi.mock('../services/legacyV2Profiles', () => ({
  runAutomaticV2Import: async () => {
    mocks.v2.calls++;
    await mocks.v2.gate;
    return { status: 'imported', imported: 1, skipped: 0 };
  },
}));

/** Lets every queued microtask and timer-free continuation run. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

async function freshAppLock() {
  vi.resetModules();
  const { appLock } = await import('./appLock');
  await appLock.start();
  return appLock;
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-applock-'));
afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

beforeEach(() => {
  mocks.base = path.join(home, `.getssh-${Math.random().toString(36).slice(2)}`);
  mocks.sent.length = 0;
  Object.assign(mocks.store, { phase: 'locked', unlockCalls: [], inFlight: 0, maxInFlight: 0, pending: [], legacy: false, startArgs: [], lockCalls: [], startGate: null, startError: null });
  Object.assign(mocks.v2, { calls: 0, gate: null });
});

describe('unlock', () => {
  it('announces ready to a second request only after the first one\'s 2.0 import has saved', async () => {
    const appLock = await freshAppLock();
    expect(appLock.state().phase).toBe('locked');
    const importDone = deferred<void>();
    mocks.v2.gate = importDone.promise;

    const first = appLock.unlock({ method: 'password', password: 'master password 1' });
    const second = appLock.unlock({ method: 'presence' });
    await settle();
    mocks.store.pending.shift()!(true);
    await settle();
    // The store is open and the import runs: nobody has been told 'ready' yet.
    expect(mocks.v2.calls).toBe(1);
    expect(mocks.sent).not.toContain('ready');
    expect(appLock.isReady()).toBe(false);

    importDone.resolve();
    expect(await first).toEqual({ ok: true });
    expect(await second).toEqual({ ok: true });
    // The second request found the app ready: no second Argon2 run or Touch ID prompt.
    expect(mocks.store.unlockCalls).toHaveLength(1);
    expect(mocks.sent.filter(phase => phase === 'ready')).toHaveLength(1);
  });

  it('runs a waiting request with its own credentials when the first one fails, never two at once', async () => {
    const appLock = await freshAppLock();
    const first = appLock.unlock({ method: 'password', password: 'wrong' });
    const second = appLock.unlock({ method: 'password', password: 'master password 1' });
    await settle();
    expect(mocks.store.unlockCalls).toHaveLength(1);
    mocks.store.pending.shift()!(false);
    expect(await first).toMatchObject({ ok: false, error: 'wrong_password' });
    await settle();
    expect(mocks.store.unlockCalls).toEqual([{ password: 'wrong' }, { password: 'master password 1' }]);
    mocks.store.pending.shift()!(true);
    expect(await second).toEqual({ ok: true });
    expect(mocks.store.maxInFlight).toBe(1);
  });

  it('imports the 2.0 servers once, however often the app is unlocked', async () => {
    const appLock = await freshAppLock();
    for (let i = 0; i < 3; i++) {
      const done = appLock.unlock({ method: 'password', password: 'master password 1' });
      await settle();
      mocks.store.pending.shift()!(true);
      expect(await done).toEqual({ ok: true });
      appLock.lock('manual');
      expect(appLock.state().phase).toBe('locked');
    }
    expect(mocks.v2.calls).toBe(1);
  });
});

describe('locking while an unlock finishes', () => {
  for (const when of ['during the 2.0 import', 'while the store unlocks']) {
    it(`keeps the app locked when the screen locks ${when}`, async () => {
      const appLock = await freshAppLock();
      const importDone = deferred<void>();
      mocks.v2.gate = importDone.promise;
      const unlocking = appLock.unlock({ method: 'password', password: 'master password 1' });
      await settle();
      if (when === 'while the store unlocks') {
        // The store has opened on its worker thread; the JavaScript side has not seen it yet.
        mocks.store.phase = 'ready';
        appLock.lock('screen locked');
      }
      mocks.store.pending.shift()!(true);
      await settle();
      if (when === 'during the 2.0 import') appLock.lock('screen locked');
      importDone.resolve();
      expect(await unlocking).toEqual({ ok: false, error: 'locked' });
      expect(mocks.sent).not.toContain('ready');
      expect(mocks.store.lockCalls).toEqual(['screen-locked']);
      expect(appLock.state().phase).toBe('locked');

      // Nothing is left over: the next unlock opens the app normally.
      const again = appLock.unlock({ method: 'password', password: 'master password 1' });
      await settle();
      mocks.store.pending.shift()!(true);
      expect(await again).toEqual({ ok: true });
      expect(mocks.store.lockCalls).toEqual(['screen-locked']);
    });
  }

  for (const outcome of ['fails', 'succeeds']) {
    it(`a lock while a Touch ID prompt still waits is already met: the unlock that ${outcome} is not refused for it`, async () => {
      const appLock = await freshAppLock();
      const prompt = appLock.unlock({ method: 'presence' });
      await settle();
      // Away from the computer: the idle poll fires while the store is still locked.
      appLock.lock('idle');
      mocks.store.pending.shift()!(outcome === 'succeeds');
      if (outcome === 'succeeds') {
        expect(await prompt).toEqual({ ok: true });
      } else {
        expect(await prompt).toMatchObject({ ok: false });
        const typed = appLock.unlock({ method: 'password', password: 'master password 1' });
        await settle();
        mocks.store.pending.shift()!(true);
        expect(await typed).toEqual({ ok: true });
      }
      expect(mocks.store.lockCalls).toEqual([]);
    });
  }

  it('an unlock that fails after its store opened leaves nothing open, and the lock does not carry over', async () => {
    const appLock = await freshAppLock();
    const unlocking = appLock.unlock({ method: 'password', password: 'master password 1' });
    await settle();
    mocks.store.phase = 'ready';
    appLock.lock('sleep');
    mocks.store.pending.shift()!(false);
    expect(await unlocking).toMatchObject({ ok: false });
    expect(mocks.store.lockCalls).toEqual(['sleep']);
    const again = appLock.unlock({ method: 'password', password: 'master password 1' });
    await settle();
    mocks.store.pending.shift()!(true);
    expect(await again).toEqual({ ok: true });
    expect(mocks.store.lockCalls).toEqual(['sleep']);
  });

  it('a lock asked for while the app starts does not carry over to the first unlock', async () => {
    vi.resetModules();
    const { appLock } = await import('./appLock');
    const started = deferred<void>();
    mocks.store.startGate = started.promise;
    const starting = appLock.start();
    await settle();
    appLock.lock('sleep');
    started.resolve();
    await starting;
    expect(appLock.state().phase).toBe('locked');
    const unlocking = appLock.unlock({ method: 'password', password: 'master password 1' });
    await settle();
    mocks.store.pending.shift()!(true);
    expect(await unlocking).toEqual({ ok: true });
    expect(mocks.store.lockCalls).toEqual([]);
  });

  it('forgets a lock asked for while the app was already locked and nothing was unlocking', async () => {
    const appLock = await freshAppLock();
    appLock.lock('idle');
    const unlocking = appLock.unlock({ method: 'password', password: 'master password 1' });
    await settle();
    mocks.store.pending.shift()!(true);
    expect(await unlocking).toEqual({ ok: true });
    expect(mocks.store.lockCalls).toEqual([]);
  });
});

describe('start', () => {
  it('leaves out an app key that does not decrypt, and lets the store decide whether it needs one', async () => {
    mocks.store.legacy = true;
    fs.mkdirSync(mocks.base, { recursive: true });
    fs.writeFileSync(path.join(mocks.base, 'app_key.enc'), 'GETSSH-SS1:a blob this machine cannot open');
    const appLock = await freshAppLock();
    expect(mocks.store.startArgs).toEqual([{ workspacePasswords: {} }]);
    expect(appLock.state().phase).toBe('locked');
  });

  it('names an app key that could not be read when the migration needed it', async () => {
    mocks.store.legacy = true;
    mocks.store.startError = '[store:invalid_argument] app_key.enc exists: pass its decrypted contents as appKey';
    fs.mkdirSync(mocks.base, { recursive: true });
    fs.writeFileSync(path.join(mocks.base, 'app_key.enc'), 'GETSSH-SS1:a blob this machine cannot open');
    const appLock = await freshAppLock();
    expect(appLock.state().phase).toBe('error');
    expect(appLock.state().error).toBe('app_key_unreadable: Error while decrypting the ciphertext');
  });
});
