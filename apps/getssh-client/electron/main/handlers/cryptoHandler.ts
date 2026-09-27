import { type IpcMain, type App } from 'electron';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { isMainWebContents } from '../windowRegistry';
import { isSecretStoreAvailable } from '../security/secretStore';
import { unlockWithBiometrics, verifyUserPresence } from '../security/userPresence';
import { hasWorkspaceVault, readWorkspaceVault, workspaceVaultPath, writeWorkspaceVault } from '../security/workspaceVault';

export function registerCryptoHandlers(ipcMain: IpcMain, _app: App) {
  // The master password leaves the main process only after the OS verified the user (Touch ID),
  // for a workspace that opted in to biometric unlock, and only to the main window.
  ipcMain.handle('prompt-biometric-unlock', async (event) => {
    const { getActiveWorkspaceId } = require('./workspaceHandler');
    const { DatabaseManager } = require('../services/DatabaseManager');
    return unlockWithBiometrics({
      isMainSender: isMainWebContents(event.sender),
      getActiveWorkspaceId,
      getWorkspace: (workspaceId: string) => {
        const row = DatabaseManager.mainDb
          ?.prepare('SELECT name, biometric_enabled FROM workspaces WHERE id = ?')
          .get(workspaceId) as { name?: string; biometric_enabled?: number } | undefined;
        return row ? { name: row.name || workspaceId, biometricEnabled: row.biometric_enabled === 1 } : null;
      },
      hasStoredPassword: hasWorkspaceVault,
      readStoredPassword: readWorkspaceVault,
      presence: verifyUserPresence,
    });
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
    // Only the main window mounts workspaces and holds the profile list (torn windows never need it).
    if (!isMainWebContents(event.sender)) throw new Error('Unauthorized sender');
    const { getActiveWorkspaceId } = require('./workspaceHandler');
    const { DatabaseManager } = require('../services/DatabaseManager');
    const workspaceId = getActiveWorkspaceId();
    const workspace = DatabaseManager.getWorkspaces().find((entry: { id: string }) => entry.id === workspaceId);
    if (workspace?.hasPassword) DatabaseManager.unmountWorkspace(workspaceId);
    
    // Mount the workspace DB via SQLCipher
    const success = DatabaseManager.mountWorkspace(workspaceId, masterPassword);
    if (!success) {
      throw new Error('Invalid master password or corrupted file');
    }

    const profiles = DatabaseManager.getProfiles(workspaceId);
    DatabaseManager.markAssetFolderWorkspaceUnlocked(workspaceId);
    return profiles;
  });

  ipcMain.handle('save-profiles', async (event, { masterPassword, payload, workspaceId: requestedWorkspaceId }) => {
    if (!isMainWebContents(event.sender)) throw new Error('Unauthorized sender');
    const { getActiveWorkspaceId } = require('./workspaceHandler');
    const { DatabaseManager } = require('../services/DatabaseManager');
    const workspaceId = getActiveWorkspaceId();
    // The list was built for another workspace (the active one changed meanwhile): never write it here.
    if (typeof requestedWorkspaceId === 'string' && requestedWorkspaceId && requestedWorkspaceId !== workspaceId) {
      throw new Error('workspace_changed');
    }
    
    const profilesToSave = (payload as any[]).map((p: any) => {
      return {
        id: p.id || crypto.randomUUID(),
        workspace_id: workspaceId,
        host: p.host,
        username: p.username,
        password: p.password, // Stored natively in SQLCipher encrypted DB
        privateKeyPath: p.privateKeyPath,
        passphrase: p.passphrase,
        port: p.port || (p.protocol === 'telnet' ? 23 : 22),
        autoStart: p.autoStart ? 1 : 0,
        alias: p.alias,
        osType: p.osType,
        protocol: p.protocol || 'ssh',
        groupName: p.group,
        useKeepAlive: p.useKeepAlive !== false,
        authType: p.authType || 'password',
        proxyJump: p.proxyJump,
        strictHostKeyChecking: p.strictHostKeyChecking === true,
        initialDirectory: p.initialDirectory,
        postConnectScript: p.postConnectScript,
        themeOverride: p.themeOverride
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
           const keyBuffer = Buffer.from(masterPassword, 'utf8');
           try {
             db.rekey(keyBuffer);
           } finally {
             keyBuffer.fill(0);
           }
         } catch (e: unknown) {
           throw new Error('Workspace DB Encryption failed: ' + String(e));
         }
       } else {
         try {
           db.rekey(Buffer.alloc(0));
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
    const vaultPath = workspaceVaultPath(workspaceId);
    if (masterPassword && isSecretStoreAvailable()) {
      try {
        writeWorkspaceVault(workspaceId, masterPassword);
      } catch (err: unknown) {
        console.error('Failed to securely store master password:', err);
      }
    } else if (!masterPassword && fs.existsSync(vaultPath)) {
      // Remove vault.key if password is removed
      try {
        fs.unlinkSync(vaultPath);
      } catch (e) {}
    }
    
    return true;
  });
}
