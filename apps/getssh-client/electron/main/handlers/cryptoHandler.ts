import { app, safeStorage, systemPreferences } from 'electron';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { join } from 'node:path';
import { getRustCorePath } from '../utils/rustCorePath';

let vault: any = null;

export function setVaultForTest(mockVault: any) {
  vault = mockVault;
}

export function registerCryptoHandlers(ipcMain: Electron.IpcMain, app: Electron.App) {
  if (!vault) {
    try {
      const addonPath = getRustCorePath('getssh-vault');
      vault = require(addonPath);
    } catch (e) {
      console.error("Failed to load getssh-vault native module:", e);
    }
  }
  // Dynamic path resolution helper
  const getWorkspacePaths = () => {
    const { getActiveWorkspaceId } = require('./workspaceHandler');
    const wsId = getActiveWorkspaceId();
    const wsPath = join(app.getPath('home'), '.getssh', 'workspaces', wsId);
    return {
      wsId,
      wsPath,
      PROFILES_ENC_PATH: join(wsPath, 'profiles.enc'),
      PROFILES_PLAIN_PATH: join(wsPath, 'profiles.json'),
      PROFILES_KEY_PATH: join(wsPath, 'vault.key'),
    };
  };

  ipcMain.handle('prompt-biometric-unlock', async () => {
    try {
      const { PROFILES_KEY_PATH } = getWorkspacePaths();
      if (!fs.existsSync(PROFILES_KEY_PATH)) return { success: false, reason: 'no_key' };
      
      if (process.platform === 'darwin' && systemPreferences.canPromptTouchID()) {
        try {
          await systemPreferences.promptTouchID('Unlock GETSSH Profiles');
        } catch (err: unknown) {
          return { success: false, reason: 'touchid_failed' };
        }
      } else {
        return { success: false, reason: 'unsupported' };
      }

      const encryptedKey = await fs.promises.readFile(PROFILES_KEY_PATH);
      if (safeStorage.isEncryptionAvailable()) {
        const masterPassword = safeStorage.decryptString(encryptedKey);
        return { success: true, masterPassword };
      }
      return { success: false, reason: 'safeStorage_unavailable' };
    } catch (e: unknown) {
      return { success: false, reason: (e instanceof Error ? e.message : String(e)) };
    }
  });

  ipcMain.handle('check-profiles', () => {
    const { PROFILES_ENC_PATH, PROFILES_PLAIN_PATH } = getWorkspacePaths();
    if (fs.existsSync(PROFILES_ENC_PATH)) return 'encrypted';
    if (fs.existsSync(PROFILES_PLAIN_PATH)) return 'plain';
    return 'none';
  });

  ipcMain.handle('unlock-profiles', async (event, masterPassword) => {
    const { getActiveWorkspaceId } = require('./workspaceHandler');
    const { DatabaseManager } = require('../services/DatabaseManager');
    const workspaceId = getActiveWorkspaceId();
    const profiles = DatabaseManager.getProfiles(workspaceId);

    if (profiles.length === 0) return [];

    if (!masterPassword) {
      return profiles;
    }

    let masterPasswordBuffer: Buffer | null = null;
    try {
      if (!vault) throw new Error('Vault native module not loaded');
      masterPasswordBuffer = Buffer.from(masterPassword);

      for (const p of profiles) {
        if (p.password) {
          const decrypted = vault.decryptVault(masterPasswordBuffer, Buffer.from(p.password, 'base64'));
          if (decrypted) p.password = decrypted.toString('utf8');
        }
        if (p.privateKeyPath) {
          const decrypted = vault.decryptVault(masterPasswordBuffer, Buffer.from(p.privateKeyPath, 'base64'));
          if (decrypted) p.privateKeyPath = decrypted.toString('utf8');
        }
      }
      return profiles;
    } catch (e: unknown) {
      throw new Error('Invalid master password or corrupted file');
    } finally {
      if (masterPasswordBuffer) masterPasswordBuffer.fill(0);
    }
  });

  ipcMain.handle('save-profiles', async (event, { masterPassword, payload }) => {
    // Phase 4: Save Profiles into SQLite Master Database
    const { getActiveWorkspaceId } = require('./workspaceHandler');
    const workspaceId = getActiveWorkspaceId();
    
    // Convert frontend SessionProfile to ProfileRow
    const profilesToSave = (payload as any[]).map((p: any) => {
      return {
        id: crypto.createHash('md5').update(`${p.host}:${p.username}`).digest('hex'),
        workspace_id: workspaceId,
        host: p.host,
        username: p.username,
        password: p.password, // We will encrypt this below if masterPassword is provided
        privateKeyPath: p.privateKeyPath,
        port: p.port || 22,
        autoStart: p.autoStart ? 1 : 0,
        alias: p.alias,
        osType: p.osType
      };
    });

    if (!masterPassword) {
       // Plaintext SQLite save
       const { DatabaseManager } = require('../services/DatabaseManager');
       DatabaseManager.saveProfiles(workspaceId, profilesToSave);
       return true;
    }

    if (!masterPassword || masterPassword.length < 8) {
      throw new Error('Password must be at least 8 characters long');
    }
    
    let masterPasswordBuffer: Buffer | null = null;
    try {
      if (!vault) throw new Error('Vault native module not loaded');
      
      masterPasswordBuffer = Buffer.from(masterPassword);
      
      for (const p of profilesToSave) {
        if (p.password) {
          const enc = vault.encryptVault(masterPasswordBuffer, Buffer.from(p.password, 'utf8'));
          p.password = enc.toString('base64');
        }
        if (p.privateKeyPath) {
          const enc = vault.encryptVault(masterPasswordBuffer, Buffer.from(p.privateKeyPath, 'utf8'));
          p.privateKeyPath = enc.toString('base64');
        }
      }
      
      const { DatabaseManager } = require('../services/DatabaseManager');
      DatabaseManager.saveProfiles(workspaceId, profilesToSave);
      
      // Update hasPassword flag in workspace table was handled below.
      
    } catch (e: unknown) {
      throw new Error('Encryption failed');
    } finally {
      if (masterPasswordBuffer) masterPasswordBuffer.fill(0);
    }
    
    // Update workspace in SQLite to reflect encryption state
    try {
      const { DatabaseManager } = require('../services/DatabaseManager');
      const workspaceId = getActiveWorkspaceId();
      const workspaces = DatabaseManager.getWorkspaces();
      const ws = workspaces.find((w: any) => w.id === workspaceId);
      if (ws) {
        ws.hasPassword = !!masterPassword ? 1 : 0;
        ws.updated_at = Date.now();
        DatabaseManager.createWorkspace(ws);
      }
    } catch (err) {
      console.error('Failed to update workspace meta:', err);
    }
    
    // Save master password for biometric unlock
    if (safeStorage.isEncryptionAvailable()) {
      try {
        const encryptedKey = safeStorage.encryptString(masterPassword);
        const { PROFILES_KEY_PATH } = getWorkspacePaths();
        await fs.promises.writeFile(PROFILES_KEY_PATH, encryptedKey);
      } catch (err: unknown) {
        console.error('Failed to securely store master password:', err);
      }
    }
    
    return true;
  });
}
