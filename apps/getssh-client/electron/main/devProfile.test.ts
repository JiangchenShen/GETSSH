import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The development profile: a fake-store run keeps Electron's userData and Keychain out of the
// real profile; every other run, and every packaged build, is left alone.

const mocks = vi.hoisted(() => ({
  isPackaged: false,
  setPath: vi.fn(),
  appendSwitch: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    get isPackaged() { return mocks.isPackaged; },
    setPath: mocks.setPath,
    commandLine: { appendSwitch: mocks.appendSwitch },
  },
}));

const saved = { HOME: process.env.HOME, GETSSH_FAKE_STORE: process.env.GETSSH_FAKE_STORE };
let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-dev-profile-'));
  mocks.isPackaged = false;
  mocks.setPath.mockReset();
  mocks.appendSwitch.mockReset();
  delete process.env.GETSSH_FAKE_STORE;
  vi.resetModules();
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

const load = async () => (await import('./devProfile')).isolateDevelopmentProfile;

describe('development profile', () => {
  it('puts userData in the temporary home and uses the mock Keychain on the fake store', async () => {
    process.env.HOME = root;
    process.env.GETSSH_FAKE_STORE = '1';
    await load();
    expect(mocks.setPath).toHaveBeenCalledExactlyOnceWith('userData', path.join(root, 'electron-user-data'));
    expect(fs.statSync(path.join(root, 'electron-user-data')).isDirectory()).toBe(true);
    expect(mocks.appendSwitch).toHaveBeenCalledExactlyOnceWith('use-mock-keychain');
  });

  it('uses a fresh folder, not the real home, when HOME was not changed', async () => {
    process.env.HOME = os.userInfo().homedir;
    process.env.GETSSH_FAKE_STORE = '1';
    await load();
    const [, userData] = mocks.setPath.mock.calls[0];
    expect(userData.startsWith(os.tmpdir())).toBe(true);
    expect(userData).not.toBe(path.join(os.userInfo().homedir, 'electron-user-data'));
    fs.rmSync(userData, { recursive: true, force: true });
  });

  it('leaves real-store runs and packaged builds alone', async () => {
    process.env.HOME = root;
    await load();
    process.env.GETSSH_FAKE_STORE = '1';
    mocks.isPackaged = true;
    vi.resetModules();
    await load();
    expect(mocks.setPath).not.toHaveBeenCalled();
    expect(mocks.appendSwitch).not.toHaveBeenCalled();
  });
});
