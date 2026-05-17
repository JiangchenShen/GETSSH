import { safeStorage, systemPreferences } from 'electron';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { join } from 'node:path';

export function registerCryptoHandlers(ipcMain: Electron.IpcMain, app: Electron.App) {
  const PROFILES_ENC_PATH = join(app.getPath('userData'), 'profiles.enc');
  const PROFILES_PLAIN_PATH = join(app.getPath('userData'), 'profiles.json');
  const PROFILES_KEY_PATH = join(app.getPath('userData'), 'profiles.key');

  ipcMain.handle('prompt-biometric-unlock', async () => {
    try {
      if (!fs.existsSync(PROFILES_KEY_PATH)) return { success: false, reason: 'no_key' };
      
      if (process.platform === 'darwin' && systemPreferences.canPromptTouchID()) {
        try {
          await systemPreferences.promptTouchID('Unlock GETSSH Profiles');
        } catch (err) {
          return { success: false, reason: 'touchid_failed' };
        }
      } else if (process.platform === 'win32') {
        // Windows DPAPI is implicit via user login, so proceed
      } else {
        return { success: false, reason: 'unsupported' };
      }

      const encryptedKey = await fs.promises.readFile(PROFILES_KEY_PATH);
      if (safeStorage.isEncryptionAvailable()) {
        const masterPassword = safeStorage.decryptString(encryptedKey);
        return { success: true, masterPassword };
      }
      return { success: false, reason: 'safeStorage_unavailable' };
    } catch (e: any) {
      return { success: false, reason: e.message };
    }
  });

  ipcMain.handle('check-profiles', () => {
    if (fs.existsSync(PROFILES_ENC_PATH)) return 'encrypted';
    if (fs.existsSync(PROFILES_PLAIN_PATH)) return 'plain';
    return 'none';
  });

  ipcMain.handle('unlock-profiles', async (event, masterPassword) => {
    if (!masterPassword) {
      try {
        const data = await fs.promises.readFile(PROFILES_PLAIN_PATH);
        try {
          return JSON.parse(data.toString('utf8'));
        } catch (e) {
          if (safeStorage.isEncryptionAvailable()) {
            try {
              return JSON.parse(safeStorage.decryptString(data));
            } catch (err) {
              console.error('Failed to decrypt safeStorage fallback:', err);
              return [];
            }
          }
          return [];
        }
      } catch (e) {
        return [];
      }
    }

    let buffer: Buffer;
    try {
      buffer = await fs.promises.readFile(PROFILES_ENC_PATH);
    } catch (e) {
      throw new Error('No profiles found');
    }
    
    if (buffer.length < 44) throw new Error('Invalid encrypted profile');
    
    const salt = buffer.subarray(0, 16);
    const iv = buffer.subarray(16, 28);
    const authTag = buffer.subarray(28, 44);
    const cipherText = buffer.subarray(44);
    
    const key = await new Promise<Buffer>((resolve, reject) => {
      crypto.pbkdf2(masterPassword, salt, 100000, 32, 'sha256', (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      });
    });
    
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(cipherText);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      return JSON.parse(decrypted.toString('utf8'));
    } catch (e) {
      throw new Error('Invalid master password or corrupted file');
    }
  });

  ipcMain.handle('save-profiles', async (event, { masterPassword, payload }) => {
    const tmpPath = join(app.getPath('userData'), `profiles_${crypto.randomUUID()}.tmp`);
    
    if (!masterPassword) {
       const payloadStr = JSON.stringify(payload, null, 2);
       if (safeStorage.isEncryptionAvailable()) {
         const encrypted = safeStorage.encryptString(payloadStr);
         await fs.promises.writeFile(tmpPath, encrypted);
       } else {
         await fs.promises.writeFile(tmpPath, payloadStr);
       }
       await fs.promises.rename(tmpPath, PROFILES_PLAIN_PATH); // Atomic write
       try {
         await fs.promises.unlink(PROFILES_ENC_PATH);
       } catch (err: any) {
         if (err.code !== 'ENOENT') throw err;
       }
       try {
         await fs.promises.unlink(PROFILES_KEY_PATH);
       } catch (err: any) {
         if (err.code !== 'ENOENT') throw err;
       }
       return true;
    }
    
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = await new Promise<Buffer>((resolve, reject) => {
      crypto.pbkdf2(masterPassword, salt, 100000, 32, 'sha256', (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      });
    });
    
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(JSON.stringify(payload), 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const authTag = cipher.getAuthTag();
    
    const output = Buffer.concat([salt, iv, authTag, encrypted]);
    await fs.promises.writeFile(tmpPath, output);
    await fs.promises.rename(tmpPath, PROFILES_ENC_PATH); // Atomic write
    try {
      await fs.promises.unlink(PROFILES_PLAIN_PATH);
    } catch (err: any) {
      if (err.code !== 'ENOENT') throw err;
    }
    
    // Save master password for biometric unlock
    if (safeStorage.isEncryptionAvailable()) {
      try {
        const encryptedKey = safeStorage.encryptString(masterPassword);
        await fs.promises.writeFile(PROFILES_KEY_PATH, encryptedKey);
      } catch (err) {
        console.error('Failed to securely store master password:', err);
      }
    }
    
    return true;
  });
}
