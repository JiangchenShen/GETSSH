import { app, safeStorage, systemPreferences } from 'electron';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { join } from 'node:path';

export function registerCryptoHandlers(ipcMain: Electron.IpcMain, app: Electron.App) {
  // Dynamic path resolution helper
  const getWorkspacePaths = () => {
    const { getActiveWorkspaceId } = require('./workspaceHandler');
    const wsId = getActiveWorkspaceId();
    const wsPath = join(app.getPath('home'), '.getssh', 'workspaces', wsId);
    return {
      wsId,
      wsPath,
      PROFILES_KEY_PATH: join(wsPath, 'vault.key'),
    };
  };

  ipcMain.handle('prompt-biometric-unlock', async () => {
    try {
      const { PROFILES_KEY_PATH } = getWorkspacePaths();
      if (!fs.existsSync(PROFILES_KEY_PATH)) return { success: false, reason: 'no_key' };
      
      // Note: Actual biometric/FIDO presence is now verified by the frontend
      // via WebAuthn (navigator.credentials.create) BEFORE calling this IPC.
      // This allows cross-platform support (Windows Hello, TouchID, FIDO).
      // We only need to retrieve the key from safeStorage.

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

  // check-profiles determines whether the initial workspace is plain or encrypted
  ipcMain.handle('check-profiles', () => {
    const { getActiveWorkspaceId } = require('./workspaceHandler');
    const { DatabaseManager } = require('../services/DatabaseManager');
    const wsId = getActiveWorkspaceId();
    const db = DatabaseManager.mainDb;
    if (!db) return { status: 'none', biometricEnabled: false };
    
    try {
      const row = db.prepare('SELECT hasPassword, biometric_enabled FROM workspaces WHERE id = ?').get(wsId) as any;
      if (row) {
        return { 
          status: row.hasPassword ? 'encrypted' : 'plain',
          biometricEnabled: row.biometric_enabled === 1
        };
      }
    } catch(e) {
      console.warn('Failed to check workspace password status:', e);
    }
    
    return { status: 'plain', biometricEnabled: false };
  });

  ipcMain.handle('unlock-profiles', async (event, masterPassword) => {
    const { getActiveWorkspaceId } = require('./workspaceHandler');
    const { DatabaseManager } = require('../services/DatabaseManager');
    const workspaceId = getActiveWorkspaceId();
    
    // Mount the workspace DB via SQLCipher
    const success = DatabaseManager.mountWorkspace(workspaceId, masterPassword);
    if (!success) {
      throw new Error('Invalid master password or corrupted file');
    }

    const profiles = DatabaseManager.getProfiles(workspaceId);
    return profiles;
  });

  ipcMain.handle('save-profiles', async (event, { masterPassword, payload }) => {
    const { getActiveWorkspaceId } = require('./workspaceHandler');
    const { DatabaseManager } = require('../services/DatabaseManager');
    const workspaceId = getActiveWorkspaceId();
    
    const profilesToSave = (payload as any[]).map((p: any) => {
      return {
        id: crypto.createHash('md5').update(`${p.host}:${p.username}`).digest('hex'),
        workspace_id: workspaceId,
        host: p.host,
        username: p.username,
        password: p.password, // Stored natively in SQLCipher encrypted DB
        privateKeyPath: p.privateKeyPath,
        passphrase: p.passphrase,
        port: p.port || 22,
        autoStart: p.autoStart ? 1 : 0,
        alias: p.alias,
        osType: p.osType
      };
    });

    // Ensure it's mounted before saving
    DatabaseManager.mountWorkspace(workspaceId, masterPassword);
    DatabaseManager.saveProfiles(workspaceId, profilesToSave);
    
    try {
      DatabaseManager.logAudit(workspaceId, 'Profile Saved', `Batch Save`, `${profilesToSave.length} profiles saved/updated`);
    } catch(e) {}

    const db = DatabaseManager.getWorkspaceDb(workspaceId);
    if (db) {
       if (masterPassword) {
         if (masterPassword.length < 8) {
           throw new Error('Password must be at least 8 characters long');
         }
         try {
           db.pragma(`rekey = '${masterPassword}'`);
         } catch (e: unknown) {
           throw new Error('Workspace DB Encryption failed: ' + String(e));
         }
       } else {
         try {
           db.pragma(`rekey = ''`);
         } catch (e: unknown) {
           console.error('Failed to remove DB encryption', e);
         }
       }
    }
    
    // Update workspace in Main SQLite to reflect encryption state
    try {
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
    const { PROFILES_KEY_PATH } = getWorkspacePaths();
    if (masterPassword && safeStorage.isEncryptionAvailable()) {
      try {
        const encryptedKey = safeStorage.encryptString(masterPassword);
        
        // Ensure workspace directory exists before saving vault.key
        const wsPath = join(app.getPath('home'), '.getssh', 'workspaces', workspaceId);
        if (!fs.existsSync(wsPath)) {
          fs.mkdirSync(wsPath, { recursive: true });
        }
        
        await fs.promises.writeFile(PROFILES_KEY_PATH, encryptedKey);
      } catch (err: unknown) {
        console.error('Failed to securely store master password:', err);
      }
    } else if (!masterPassword && fs.existsSync(PROFILES_KEY_PATH)) {
      // Remove vault.key if password is removed
      try {
        fs.unlinkSync(PROFILES_KEY_PATH);
      } catch (e) {}
    }
    
    return true;
  });
}
