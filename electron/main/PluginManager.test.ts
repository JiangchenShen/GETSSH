import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { app, ipcMain } from 'electron';
import { PluginManager } from './PluginManager';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return path.join(__dirname, '.mock_userData');
      if (name === 'temp') return path.join(__dirname, '.mock_temp');
      return __dirname;
    }),
  },
  ipcMain: {
    handle: vi.fn(),
  },
  Notification: vi.fn(),
  safeStorage: {
    isEncryptionAvailable: () => false,
  }
}));

describe('PluginManager', () => {
  let pluginManager: PluginManager;
  let installHandler: Function;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock directories
    const userData = app.getPath('userData');
    const tempDir = app.getPath('temp');
    if (!fs.existsSync(userData)) fs.mkdirSync(userData, { recursive: true });
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    pluginManager = new PluginManager();
    pluginManager.setupIPC();

    // Find the install-plugin handler
    const calls = (ipcMain.handle as any).mock.calls;
    const installCall = calls.find((call: any) => call[0] === 'install-plugin');
    installHandler = installCall[1];
  });

  afterEach(() => {
    // Clean up mock directories
    const userData = app.getPath('userData');
    const tempDir = app.getPath('temp');
    if (fs.existsSync(userData)) fs.rmSync(userData, { recursive: true, force: true });
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should return error if zip file is missing package.json', async () => {
    // Create a dummy zip without package.json
    const zipPath = path.join(app.getPath('temp'), 'dummy.zip');
    const zip = new AdmZip();
    zip.addFile('index.js', Buffer.from('console.log("hello");'));
    zip.writeZip(zipPath);

    // Call the handler
    const result = await installHandler({} as any, zipPath);

    expect(result).toEqual({
      success: false,
      error: 'Invalid Architecture: Missing package.json manifest.'
    });
  });
});
