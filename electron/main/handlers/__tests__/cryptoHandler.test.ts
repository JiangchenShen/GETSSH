import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import { app, ipcMain, safeStorage } from 'electron';
import crypto from 'node:crypto';
import { registerCryptoHandlers } from '../cryptoHandler';

vi.mock('electron', () => {
  const mockHandlers: Record<string, Function> = {};
  return {
    app: {
      getPath: vi.fn((name) => `/mock/path/${name}`)
    },
    ipcMain: {
      handle: vi.fn((channel, handler) => {
        mockHandlers[channel] = handler;
      }),
      mockHandlers
    },
    safeStorage: {
      isEncryptionAvailable: vi.fn(() => false),
      encryptString: vi.fn((str) => Buffer.from(`encrypted:${str}`)),
      decryptString: vi.fn((buf) => {
        const str = buf.toString('utf8');
        if (str.startsWith('encrypted:')) {
          return str.replace('encrypted:', '');
        }
        throw new Error('Decrypt failed');
      })
    }
  };
});

vi.mock('node:fs', () => {
  return {
    default: {
      existsSync: vi.fn(),
      promises: {
        readFile: vi.fn(),
        writeFile: vi.fn(),
        rename: vi.fn(),
        unlink: vi.fn()
      }
    }
  };
});

describe('cryptoHandler', () => {
  let handlers: Record<string, Function>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = (ipcMain as any).mockHandlers;
    registerCryptoHandlers(ipcMain, app);
  });

  describe('check-profiles', () => {
    it('returns "encrypted" if .enc exists', async () => {
      const handler = handlers['check-profiles'];
      vi.mocked(fs.existsSync).mockImplementation((path: any) => path.endsWith('.enc'));
      const result = await handler(null);
      expect(result).toBe('encrypted');
    });

    it('returns "plain" if .json exists and .enc does not', async () => {
      const handler = handlers['check-profiles'];
      vi.mocked(fs.existsSync).mockImplementation((path: any) => path.endsWith('.json'));
      const result = await handler(null);
      expect(result).toBe('plain');
    });

    it('returns "none" if neither exists', async () => {
      const handler = handlers['check-profiles'];
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const result = await handler(null);
      expect(result).toBe('none');
    });
  });

  describe('unlock-profiles (No master password)', () => {
    it('successfully parses plain json', async () => {
      const handler = handlers['unlock-profiles'];
      const mockProfiles = [{ id: '1' }];
      vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from(JSON.stringify(mockProfiles)));

      const result = await handler(null, '');
      expect(result).toEqual(mockProfiles);
      expect(fs.promises.readFile).toHaveBeenCalledWith('/mock/path/userData/profiles.json');
    });

    it('falls back to safeStorage if JSON parsing fails and safeStorage is available', async () => {
      const handler = handlers['unlock-profiles'];
      const mockProfiles = [{ id: '2' }];
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);

      vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from(`encrypted:${JSON.stringify(mockProfiles)}`));

      const result = await handler(null, '');
      expect(result).toEqual(mockProfiles);
    });

    it('returns [] if JSON parsing fails and safeStorage fails to decrypt', async () => {
      const handler = handlers['unlock-profiles'];
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);

      vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from('corrupted-data'));

      const result = await handler(null, '');
      expect(result).toEqual([]);
    });

    it('returns [] if file read fails', async () => {
      const handler = handlers['unlock-profiles'];
      vi.mocked(fs.promises.readFile).mockRejectedValue(new Error('ENOENT'));

      const result = await handler(null, '');
      expect(result).toEqual([]);
    });
  });

  describe('unlock-profiles (With master password)', () => {
    const generateEncryptedBuffer = async (password: string, payload: any) => {
      const salt = crypto.randomBytes(16);
      const iv = crypto.randomBytes(12);

      const key = await new Promise<Buffer>((resolve, reject) => {
        crypto.pbkdf2(password, salt, 100000, 32, 'sha256', (err, derivedKey) => {
          if (err) reject(err);
          else resolve(derivedKey);
        });
      });

      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      let encrypted = cipher.update(JSON.stringify(payload), 'utf8');
      encrypted = Buffer.concat([encrypted, cipher.final()]);
      const authTag = cipher.getAuthTag();

      return Buffer.concat([salt, iv, authTag, encrypted]);
    };

    it('successfully decrypts and parses valid encrypted file', async () => {
      const handler = handlers['unlock-profiles'];
      const password = 'my-secure-password';
      const mockProfiles = [{ id: 'secret' }];

      const encryptedBuffer = await generateEncryptedBuffer(password, mockProfiles);
      vi.mocked(fs.promises.readFile).mockResolvedValue(encryptedBuffer);

      const result = await handler(null, password);
      expect(result).toEqual(mockProfiles);
      expect(fs.promises.readFile).toHaveBeenCalledWith('/mock/path/userData/profiles.enc');
    });

    it('throws "No profiles found" if reading encrypted file fails', async () => {
      const handler = handlers['unlock-profiles'];
      vi.mocked(fs.promises.readFile).mockRejectedValue(new Error('ENOENT'));

      await expect(handler(null, 'password')).rejects.toThrow('No profiles found');
    });

    it('throws "Invalid encrypted profile" if file is too small', async () => {
      const handler = handlers['unlock-profiles'];
      vi.mocked(fs.promises.readFile).mockResolvedValue(Buffer.from('too-small'));

      await expect(handler(null, 'password')).rejects.toThrow('Invalid encrypted profile');
    });

    it('throws "Invalid master password or corrupted file" on decryption error', async () => {
      const handler = handlers['unlock-profiles'];
      const correctPassword = 'my-secure-password';
      const wrongPassword = 'wrong-password';
      const mockProfiles = [{ id: 'secret' }];

      const encryptedBuffer = await generateEncryptedBuffer(correctPassword, mockProfiles);
      vi.mocked(fs.promises.readFile).mockResolvedValue(encryptedBuffer);

      await expect(handler(null, wrongPassword)).rejects.toThrow('Invalid master password or corrupted file');
    });
  });

  describe('save-profiles (No master password)', () => {
    it('saves plainly if safeStorage is unavailable', async () => {
      const handler = handlers['save-profiles'];
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false);

      const payload = [{ id: '1' }];
      const result = await handler(null, { masterPassword: '', payload });

      expect(result).toBe(true);
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.tmp'),
        JSON.stringify(payload, null, 2)
      );
      expect(fs.promises.rename).toHaveBeenCalledWith(
        expect.stringContaining('.tmp'),
        '/mock/path/userData/profiles.json'
      );
      expect(fs.promises.unlink).toHaveBeenCalledWith('/mock/path/userData/profiles.enc');
    });

    it('saves encrypted via safeStorage if available', async () => {
      const handler = handlers['save-profiles'];
      vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true);

      const payload = [{ id: '1' }];
      const result = await handler(null, { masterPassword: '', payload });

      expect(result).toBe(true);
      expect(safeStorage.encryptString).toHaveBeenCalledWith(JSON.stringify(payload, null, 2));
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.tmp'),
        Buffer.from(`encrypted:${JSON.stringify(payload, null, 2)}`)
      );
    });

    it('ignores ENOENT when unlinking .enc file', async () => {
      const handler = handlers['save-profiles'];
      const err = new Error('ENOENT');
      (err as any).code = 'ENOENT';
      vi.mocked(fs.promises.unlink).mockRejectedValueOnce(err);

      const result = await handler(null, { masterPassword: '', payload: [] });
      expect(result).toBe(true);
    });

    it('throws other errors when unlinking .enc file fails', async () => {
      const handler = handlers['save-profiles'];
      const err = new Error('EACCES');
      (err as any).code = 'EACCES';
      vi.mocked(fs.promises.unlink).mockRejectedValueOnce(err);

      await expect(handler(null, { masterPassword: '', payload: [] })).rejects.toThrow('EACCES');
    });
  });

  describe('save-profiles (With master password)', () => {
    it('encrypts payload via crypto module and writes atomically', async () => {
      const handler = handlers['save-profiles'];
      const password = 'my-secure-password';
      const payload = [{ id: 'secret' }];

      const result = await handler(null, { masterPassword: password, payload });

      expect(result).toBe(true);

      // Ensure it was written to a tmp file
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('.tmp'),
        expect.any(Buffer)
      );

      // Find the correct call to writeFile, since other tests might have triggered it
      // if clearAllMocks didn't clear the call history properly (it does in beforeEach, but just to be safe)
      const writeCall = vi.mocked(fs.promises.writeFile).mock.calls.find(call =>
        (call[0] as string).includes('.tmp') && Buffer.isBuffer(call[1])
      );
      expect(writeCall).toBeDefined();

      const bufferWritten = writeCall![1] as Buffer;
      expect(bufferWritten).toBeInstanceOf(Buffer);
      expect(bufferWritten.length).toBeGreaterThan(44);

      // Verify the salt matches the extraction logic in unlock-profiles
      const salt = bufferWritten.subarray(0, 16);
      const iv = bufferWritten.subarray(16, 28);
      const authTag = bufferWritten.subarray(28, 44);
      const cipherText = bufferWritten.subarray(44);

      // Attempt to manually decrypt it to verify correctness
      const key = await new Promise<Buffer>((resolve, reject) => {
        crypto.pbkdf2(password, salt, 100000, 32, 'sha256', (err, derivedKey) => {
          if (err) reject(err);
          else resolve(derivedKey);
        });
      });

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(cipherText);
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      expect(JSON.parse(decrypted.toString('utf8'))).toEqual(payload);

      // Renames to profiles.enc
      expect(fs.promises.rename).toHaveBeenCalledWith(
        expect.stringContaining('.tmp'),
        '/mock/path/userData/profiles.enc'
      );

      // Unlinks plain file
      expect(fs.promises.unlink).toHaveBeenCalledWith('/mock/path/userData/profiles.json');
    });

    it('ignores ENOENT when unlinking .json file', async () => {
      const handler = handlers['save-profiles'];
      const err = new Error('ENOENT');
      (err as any).code = 'ENOENT';
      vi.mocked(fs.promises.unlink).mockRejectedValueOnce(err);

      const result = await handler(null, { masterPassword: 'pass', payload: [] });
      expect(result).toBe(true);
    });

    it('throws other errors when unlinking .json file fails', async () => {
      const handler = handlers['save-profiles'];
      const err = new Error('EACCES');
      (err as any).code = 'EACCES';
      vi.mocked(fs.promises.unlink).mockRejectedValueOnce(err);

      await expect(handler(null, { masterPassword: 'pass', payload: [] })).rejects.toThrow('EACCES');
    });
  });
});
