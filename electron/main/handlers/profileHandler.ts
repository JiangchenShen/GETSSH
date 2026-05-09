import { dialog } from 'electron';
import fs from 'node:fs';
import crypto from 'node:crypto';

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
   * export-profiles
   * Receives: { sessions: SessionProfile[], masterPassword: string }
   * Produces a Hybrid JSON file:
   *   - Metadata fields (name, host, port, username, groupId, …) → plaintext
   *   - Sensitive fields (password, privateKey) → AES-256-GCM Base64 ciphertext
   */
  ipcMain.handle('export-profiles', async (_event, { sessions, masterPassword }) => {
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'Export Profiles',
      defaultPath: `getssh-profiles-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'GETSSH Profile', extensions: ['json'] }],
      properties: ['createDirectory'],
    });

    if (canceled || !filePath) return { success: false, reason: 'canceled' };

    try {
      const exported: any[] = [];

      for (const s of sessions) {
        const entry: any = {
          // ── Plaintext metadata ──
          name:         (s as any).name         ?? '',
          host:         s.host                  ?? '',
          port:         s.port                  ?? 22,
          username:     s.username              ?? '',
          groupId:      (s as any).groupId      ?? null,
          autoStart:    s.autoStart             ?? false,
          useKeepAlive: s.useKeepAlive          ?? false,
          // ── Encrypted sentinel ──
          _encrypted:   !!masterPassword,
        };

        if (masterPassword) {
          // Encrypt sensitive fields
          if (s.password)       entry.password       = await encryptField(s.password, masterPassword);
          if (s.privateKeyPath) entry.privateKeyPath = await encryptField(s.privateKeyPath, masterPassword);
        } else {
          // No master password — store plaintext (user opted out of encryption)
          if (s.password)       entry.password       = s.password;
          if (s.privateKeyPath) entry.privateKeyPath = s.privateKeyPath;
        }

        exported.push(entry);
      }

      const payload = {
        _format:    'getssh-profiles-v1',
        _exportedAt: new Date().toISOString(),
        profiles:   exported,
      };

      await fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
      return { success: true, count: exported.length };
    } catch (err: any) {
      return { success: false, reason: err.message };
    }
  });

  /**
   * import-profiles
   * Receives: { masterPassword: string }
   * Returns: { success: boolean, profiles?: SessionProfile[], reason?: string }
   *
   * Decrypts sensitive fields if _encrypted === true.
   * If the master password is wrong the decrypt will throw — we surface the error.
   */
  ipcMain.handle('import-profiles', async (_event, { masterPassword }) => {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: 'Import Profiles',
      filters: [{ name: 'GETSSH Profile', extensions: ['json'] }],
      properties: ['openFile'],
    });

    if (canceled || !filePaths[0]) return { success: false, reason: 'canceled' };

    try {
      const raw     = await fs.promises.readFile(filePaths[0], 'utf8');
      const data    = JSON.parse(raw);

      if (data._format !== 'getssh-profiles-v1') {
        return { success: false, reason: 'invalid_format' };
      }

      const profiles: any[] = [];

      for (const entry of data.profiles) {
        const profile: any = {
          name:         entry.name         ?? '',
          host:         entry.host         ?? '',
          port:         entry.port         ?? 22,
          username:     entry.username     ?? '',
          groupId:      entry.groupId      ?? null,
          autoStart:    entry.autoStart    ?? false,
          useKeepAlive: entry.useKeepAlive ?? false,
        };

        if (entry._encrypted) {
          // Decrypt using provided master password
          if (!masterPassword) {
            return { success: false, reason: 'password_required' };
          }
          try {
            if (entry.password)       profile.password       = await decryptField(entry.password, masterPassword);
            if (entry.privateKeyPath) profile.privateKeyPath = await decryptField(entry.privateKeyPath, masterPassword);
          } catch {
            return { success: false, reason: 'wrong_password' };
          }
        } else {
          if (entry.password)       profile.password       = entry.password;
          if (entry.privateKeyPath) profile.privateKeyPath = entry.privateKeyPath;
        }

        profiles.push(profile);
      }

      return { success: true, profiles };
    } catch (err: any) {
      return { success: false, reason: err.message };
    }
  });
}
