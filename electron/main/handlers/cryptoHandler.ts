import { app, safeStorage, systemPreferences } from 'electron';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { join } from 'node:path';

let vault: any = null;
try {
  const addonPath = join(__dirname, '../../rust-core/getssh-vault');
  if (fs.existsSync(addonPath)) {
     vault = require(addonPath);
  } else {
     console.warn('Vault native module not found at', addonPath);
  }
} catch (e) {
  console.error("Failed to load getssh-vault native module:", e);
}

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
        } catch (e: unknown) {
          // If parsing fails, it might be an old safeStorage encrypted file.
          // We will attempt to decrypt it, but this WILL trigger a keychain prompt on unsigned macOS apps.
          // To avoid prompting on launch, we ONLY fallback to safeStorage if absolutely necessary.
          if (app.isPackaged && process.platform === 'darwin') {
             // For macOS unsigned apps, avoid calling safeStorage automatically
             // But if we must recover data, we'll try catching the prompt later or just return empty for now.
          }
          if (safeStorage.isEncryptionAvailable()) {
            try {
              return JSON.parse(safeStorage.decryptString(data));
            } catch (err) {
              // Decryption failed (e.g. Dev vs Packaged bundle ID mismatch).
              // Backup the file before returning [] so we don't permanently lose user data if they save!
              try {
                fs.renameSync(PROFILES_PLAIN_PATH, PROFILES_PLAIN_PATH + '.bak');
                console.warn('safeStorage decryption failed. Backed up old profiles to profiles.json.bak');
              } catch (e) {}
              return [];
            }
          }
          try {
            fs.renameSync(PROFILES_PLAIN_PATH, PROFILES_PLAIN_PATH + '.bak');
          } catch (e) {}
          return [];
        }
      } catch (e: unknown) {
        return [];
      }
    }

    let buffer: Buffer;
    try {
      buffer = await fs.promises.readFile(PROFILES_ENC_PATH);
    } catch (e: unknown) {
      throw new Error('No profiles found');
    }
    
    let decryptedBuffer: Buffer | null = null;
    let masterPasswordBuffer: Buffer | null = null;
    try {
      if (!vault) throw new Error('Vault native module not loaded');
      
      masterPasswordBuffer = Buffer.from(masterPassword);
      decryptedBuffer = vault.decryptVault(masterPasswordBuffer, buffer);
      if (!decryptedBuffer) throw new Error('Decryption returned null');
      return JSON.parse(decryptedBuffer.toString('utf8'));
    } catch (e: unknown) {
      throw new Error('Invalid master password or corrupted file');
    } finally {
      // 物理级擦除 (Zeroize) - 脱离 V8 GC 控制
      if (decryptedBuffer) decryptedBuffer.fill(0);
      if (masterPasswordBuffer) masterPasswordBuffer.fill(0);
    }
  });

  ipcMain.handle('save-profiles', async (event, { masterPassword, payload }) => {
    const tmpPath = join(app.getPath('userData'), `profiles_${crypto.randomUUID()}.tmp`);
    
    if (!masterPassword) {
       const payloadStr = JSON.stringify(payload, null, 2);
       // REMOVED safeStorage for plain profiles. 
       // If users want encryption, they must use the Master Password feature (Vault).
       // This prevents aggressive keychain prompts on unsigned macOS apps.
       await fs.promises.writeFile(tmpPath, payloadStr);
       await fs.promises.rename(tmpPath, PROFILES_PLAIN_PATH); // Atomic write
       try {
         await fs.promises.unlink(PROFILES_ENC_PATH);
       } catch (err: unknown) {
         if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
       }
       try {
         await fs.promises.unlink(PROFILES_KEY_PATH);
       } catch (err: unknown) {
         if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
       }
       return true;
    }
    
    let masterPasswordBuffer: Buffer | null = null;
    try {
      if (!vault) throw new Error('Vault native module not loaded');
      
      masterPasswordBuffer = Buffer.from(masterPassword);
      const payloadBuffer = Buffer.from(JSON.stringify(payload), 'utf8');
      
      const output = vault.encryptVault(masterPasswordBuffer, payloadBuffer);
      payloadBuffer.fill(0); // Erase payload
      
      await fs.promises.writeFile(tmpPath, output);
      await fs.promises.rename(tmpPath, PROFILES_ENC_PATH); // Atomic write
      try {
        await fs.promises.unlink(PROFILES_PLAIN_PATH);
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    } catch (e: unknown) {
      throw new Error('Encryption failed');
    } finally {
      if (masterPasswordBuffer) masterPasswordBuffer.fill(0);
    }
    
    // Save master password for biometric unlock
    if (safeStorage.isEncryptionAvailable()) {
      try {
        const encryptedKey = safeStorage.encryptString(masterPassword);
        await fs.promises.writeFile(PROFILES_KEY_PATH, encryptedKey);
      } catch (err: unknown) {
        console.error('Failed to securely store master password:', err);
      }
    }
    
    return true;
  });
}
