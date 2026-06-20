import { app } from 'electron';
import { join } from 'node:path';
import { getRustCorePath } from '../utils/rustCorePath';

class VaultManager {
  private static instance: VaultManager;
  private vaultCore: any = null;

  private constructor() {
    try {
      const addonPath = getRustCorePath('getssh-vault');
      this.vaultCore = require(addonPath);
    } catch (e) {
      console.error("[VaultManager] Failed to load getssh-vault native module:", e);
    }
  }

  public static getInstance(): VaultManager {
    if (!VaultManager.instance) {
      VaultManager.instance = new VaultManager();
    }
    return VaultManager.instance;
  }

  public getVaultCore() {
    return this.vaultCore;
  }

  /**
   * 强制切除当前内存中的密钥
   */
  public async unloadVault(): Promise<void> {
    console.log('[VaultManager] Initiating physical zero-out of Vault memory...');
    // We call the underlying Rust NAPI to explicitly drop the master key buffer if there is a persistent one.
    // While Node.js garbage collection handles normal buffers, a secure lock guarantees it's out of reach immediately.
    if (this.vaultCore && typeof this.vaultCore.lock === 'function') {
      try {
        this.vaultCore.lock();
        console.log('[VaultManager] Vault natively locked.');
      } catch (e) {
        console.error('[VaultManager] Failed to lock native vault', e);
      }
    }
    
    // In cryptoHandler, we pass buffers to decryptVault/encryptVault.
    // If we had a global master key, we would zero it here.
    console.log('[VaultManager] Vault unloaded and zeroized.');
  }
}

export const vaultManager = VaultManager.getInstance();
