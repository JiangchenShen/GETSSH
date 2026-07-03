import { dialog } from 'electron';
import fs from 'node:fs';
import crypto from 'node:crypto';


export interface ExportedProfile {
  name: string;
  host: string;
  port: number;
  username: string;
  groupId: string | null;
  autoStart: boolean;
  useKeepAlive: boolean;
  protocol?: string;
  alias?: string;
  _encrypted?: boolean;
  password?: string;
  privateKeyPath?: string;
  workspaceId?: string;
}

export interface ExportPayload {
  _format: string;
  _exportedAt: string;
  profiles: ExportedProfile[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * AES-256-GCM encrypt a string using a master password.
 * Returns a Base64 string: salt(16) | iv(12) | authTag(16) | ciphertext
 */
async function encryptField(plaintext: string, masterPassword: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const iv   = crypto.randomBytes(12);
  const key  = await pbkdf2(masterPassword, salt);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag    = cipher.getAuthTag();

  return Buffer.concat([salt, iv, tag, enc]).toString('base64');
}

/**
 * Decrypt a Base64 AES-256-GCM blob produced by encryptField.
 */
async function decryptField(blob: string, masterPassword: string): Promise<string> {
  const buf      = Buffer.from(blob, 'base64');
  const salt     = buf.subarray(0, 16);
  const iv       = buf.subarray(16, 28);
  const tag      = buf.subarray(28, 44);
  const enc      = buf.subarray(44);
  const key      = await pbkdf2(masterPassword, salt);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

function pbkdf2(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    crypto.pbkdf2(password, salt, 100000, 32, 'sha256', (err, key) =>
      err ? reject(err) : resolve(key)
    )
  );
}

// ── Handler Registration ───────────────────────────────────────────────────

export function registerProfileHandlers(ipcMain: Electron.IpcMain) {

  /**
   * export-profiles (V2 Modern SDK)
   * Produces a clean JSON file (getssh-profiles-v2):
   *   - Queries DatabaseManager for all workspaces and profiles.
   *   - Scrubber Engine: Automatically removes username, password, privateKeyPath.
   *   - Injects workspaceId.
   */
  ipcMain.handle('export-profiles', async () => {
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Export Profiles as Template',
      defaultPath: `getssh-topology-template-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'GETSSH V2 Topology', extensions: ['json'] }],
      properties: ['createDirectory'],
    });

    if (canceled || !filePath) return { success: false, reason: 'canceled' };

    try {
      // Lazy import to avoid circular dependencies if DatabaseManager requires this file
      const { DatabaseManager } = require('../services/DatabaseManager');
      const workspaces = DatabaseManager.getWorkspaces();
      
      const exported: ExportedProfile[] = [];
      
      for (const ws of workspaces) {
        const profiles = DatabaseManager.getProfiles(ws.id);
        for (const p of profiles) {
          // Scrub sensitive data: username, password, privateKeyPath
          exported.push({
            name: p.name ?? '',
            host: p.host ?? '',
            port: p.port ?? 22,
            username: '', // SCRUBBED
            groupId: p.groupId ?? null,
            autoStart: (p as any).autoStart ?? false,
            useKeepAlive: (p as any).useKeepAlive ?? false,
            protocol: p.protocol ?? 'ssh',
            alias: p.alias ?? '',
            workspaceId: ws.id
          });
        }
      }

      const payload: ExportPayload = {
        _format: 'getssh-profiles-v2',
        _exportedAt: new Date().toISOString(),
        profiles: exported,
      };

      await fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
      return { success: true, count: exported.length };
    } catch (err: unknown) {
      return { success: false, reason: err instanceof Error ? err.message : String(err) };
    }
  });

  /**
   * import-profiles (V1 Legacy & V2 Modern)
   * Receives: { masterPassword: string }
   * 
   * V1 JSON: Maps to 'default' workspace. Decrypts credentials if necessary.
   * V2 JSON: Maps to provided workspaceId. Creates workspace if missing.
   */
  ipcMain.handle('import-profiles', async (_event, { masterPassword }) => {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: 'Import Profiles',
      filters: [{ name: 'GETSSH Profile', extensions: ['json'] }],
      properties: ['openFile'],
    });

    if (canceled || !filePaths[0]) return { success: false, reason: 'canceled' };

    try {
      const { DatabaseManager } = require('../services/DatabaseManager');
      const raw     = await fs.promises.readFile(filePaths[0], 'utf8');
      const data    = JSON.parse(raw) as ExportPayload;

      if (data._format !== 'getssh-profiles-v1' && data._format !== 'getssh-profiles-v2') {
        return { success: false, reason: 'invalid_format' };
      }

      let parsedCount = 0;
      const profilesByWorkspace: Record<string, any[]> = {};

      try {
        for (const entry of data.profiles) {
          // V1 to V2 compat bridge: default to 'default' workspace if missing
          const targetWorkspaceId = entry.workspaceId || 'default';

          // If workspace doesn't exist locally, create a placeholder
          try {
            const ws = DatabaseManager.getWorkspaces().find((w: any) => w.id === targetWorkspaceId);
            if (!ws) {
              DatabaseManager.createWorkspace({
                id: targetWorkspaceId,
                name: targetWorkspaceId === 'default' ? 'Default Workspace' : `Imported: ${targetWorkspaceId}`,
                themeColor: '#1e293b',
                hasPassword: 0,
                created_at: Date.now(),
                updated_at: Date.now()
              });
            }
          } catch (e) {
            console.error('[Import] Failed to ensure workspace exists', e);
          }

          let password = entry.password ?? '';
          let privateKeyPath = entry.privateKeyPath ?? '';

          // Only V1 has encrypted fields. V2 templates are scrubbed.
          if (entry._encrypted && data._format === 'getssh-profiles-v1') {
            if (!masterPassword) {
              throw new Error('password_required');
            }
            try {
              if (entry.password)       password       = await decryptField(entry.password, masterPassword);
              if (entry.privateKeyPath) privateKeyPath = await decryptField(entry.privateKeyPath, masterPassword);
            } catch {
              throw new Error('wrong_password');
            }
          } else if (data._format === 'getssh-profiles-v1' && !entry._encrypted) {
            if (entry.password)       password       = entry.password;
            if (entry.privateKeyPath) privateKeyPath = entry.privateKeyPath;
          }

          const profileId = crypto.randomUUID();

          if (!profilesByWorkspace[targetWorkspaceId]) {
             profilesByWorkspace[targetWorkspaceId] = DatabaseManager.getProfiles(targetWorkspaceId) || [];
          }

          profilesByWorkspace[targetWorkspaceId].push({
            id: profileId,
            name: entry.name ?? '',
            host: entry.host ?? '',
            port: entry.port ?? 22,
            username: entry.username ?? '',
            password: password,
            privateKeyPath: privateKeyPath,
            groupId: entry.groupId ?? null,
            autoStart: entry.autoStart ?? false,
            useKeepAlive: entry.useKeepAlive ?? false,
            protocol: entry.protocol ?? 'ssh',
            alias: entry.alias ?? '',
            workspace_id: targetWorkspaceId,
            created_at: Date.now(),
            updated_at: Date.now()
          });

          parsedCount++;
        }

        for (const [wsId, profiles] of Object.entries(profilesByWorkspace)) {
          DatabaseManager.saveProfiles(wsId, profiles);
        }
      } catch (mapErr: unknown) {
        const msg = mapErr instanceof Error ? mapErr.message : String(mapErr);
        if (msg === 'password_required' || msg === 'wrong_password') {
          return { success: false, reason: msg };
        }
        throw mapErr;
      }

      return { success: true, count: parsedCount };
    } catch (err: unknown) {
      if (err && typeof (err as any).success === 'boolean') {
        return err as { success: boolean; reason: string };
      }
      return { success: false, reason: err instanceof Error ? err.message : String(err) };
    }
  });
}
