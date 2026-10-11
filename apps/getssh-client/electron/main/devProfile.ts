import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';

/**
 * A development run on the in-memory store (GETSSH_FAKE_STORE=1, started with a temporary HOME)
 * keeps Electron's own profile away from the real one as well. A temporary HOME does not move
 * ~/Library/Application Support on macOS, so the run read and wrote the real userData (plugins,
 * known hosts, the window's localStorage, the GETSSH 2.0 files the import looks for) and used
 * the real Keychain through safeStorage. Packaged builds never do this.
 *
 * Imported first by index.ts, before any module reads app.getPath('userData').
 */
export function isolateDevelopmentProfile(): string | null {
  if (!process.env.GETSSH_FAKE_STORE || app.isPackaged) return null;
  const home = os.homedir();
  // Started without a temporary HOME: a fresh folder for this run, nothing in the real home.
  const userData = home !== os.userInfo().homedir
    ? path.join(home, 'electron-user-data')
    : fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-dev-user-data-'));
  fs.mkdirSync(userData, { recursive: true });
  app.setPath('userData', userData);
  app.commandLine.appendSwitch('use-mock-keychain');
  return userData;
}

isolateDevelopmentProfile();
