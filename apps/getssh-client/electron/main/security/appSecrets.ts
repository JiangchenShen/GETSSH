import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { getStore, toStoreError } from '../services/getsshStore';
import { appLock } from './appLock';
import { decryptSecret } from './secretStore';

/**
 * App-wide secrets in getssh-store (main.db, sealed with the app key, carried by an export):
 * AI provider keys and the renderer's sensitive settings. They replace files and localStorage
 * blobs encrypted with Electron safeStorage, whose synchronous Keychain access blocked the main
 * thread at startup and asked again after every new ad-hoc-signed build. Each old blob is read
 * one last time, moved here and deleted.
 *
 * MAIN PROCESS ONLY. AI keys never go to a renderer; the renderer's settings go back to the main
 * window that saved them.
 */

const AI_PREFIX = 'ai/';
/** ai_vault.enc, from before each provider had its own key: used by every provider without one. */
const AI_SHARED = 'ai/shared';
const RENDERER_CONFIG = 'config/renderer';
const MAX_RENDERER_CONFIG = 256 * 1024;
/** What the renderer keeps in localStorage ('appConfig_secure') instead of an encrypted blob. */
export const RENDERER_CONFIG_MARKER = 'getssh-store:config/v1';

function readText(name: string): string | null {
  const value = getStore().getAppSecret(name);
  if (!value) return null;
  try {
    return value.toString('utf8');
  } finally {
    value.fill(0);
  }
}

// ── AI provider keys ──

function providerName(provider?: string): string {
  const name = (provider || 'default').toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name)) throw new Error('invalid AI provider name');
  return name;
}

function vaultFile(provider: string | null): string {
  return path.join(app.getPath('userData'), provider === null ? 'ai_vault.enc' : `ai_vault_${provider}.enc`);
}

/** Moves one safeStorage vault file into the store; false when there is none or it does not open. */
function migrateVaultFile(file: string, name: string): boolean {
  if (!fs.existsSync(file)) return false;
  try {
    getStore().setAppSecret(name, decryptSecret(fs.readFileSync(file)).value);
  } catch (error) {
    console.warn(`[AppSecrets] ${path.basename(file)} could not be moved into the store; it stays where it is:`, error);
    return false;
  }
  fs.rmSync(file, { force: true });
  return true;
}

/** The provider's API key, or '' when none is set or the app is locked. */
export function getAiApiKey(provider?: string): string {
  try {
    const name = AI_PREFIX + providerName(provider);
    let key = readText(name);
    if (key === null && migrateVaultFile(vaultFile(providerName(provider)), name)) key = readText(name);
    if (key === null) key = readText(AI_SHARED);
    if (key === null && migrateVaultFile(vaultFile(null), AI_SHARED)) key = readText(AI_SHARED);
    return key ?? '';
  } catch (error) {
    console.warn('[AppSecrets] The AI API key could not be read:', toStoreError(error).code);
    return '';
  }
}

export function setAiApiKey(provider: string | undefined, key: string): void {
  const name = providerName(provider);
  getStore().setAppSecret(AI_PREFIX + name, key);
  fs.rmSync(vaultFile(name), { force: true });
}

/** Removes the provider's key and the shared one from before per-provider keys, as before. */
export function deleteAiApiKey(provider?: string): void {
  const name = providerName(provider);
  getStore().setAppSecret(AI_PREFIX + name, null);
  getStore().setAppSecret(AI_SHARED, null);
  fs.rmSync(vaultFile(name), { force: true });
  fs.rmSync(vaultFile(null), { force: true });
}

// ── the renderer's sensitive settings (init script, proxy, AI endpoint and model) ──

/**
 * Whether the main window received the stored settings since this process started. Until it
 * has, it holds none of them, and a save would replace them with empty values.
 */
let rendererConfigDelivered = false;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

/** A blob from before 3.0: safeStorage, or base64 JSON where safeStorage was unavailable. */
function openLegacyConfig(blob: string): Record<string, unknown> | null {
  const raw = Buffer.from(blob, 'base64');
  for (const read of [() => decryptSecret(raw, undefined, 'config').value, () => raw.toString('utf8')]) {
    try {
      const value = JSON.parse(read());
      if (isPlainObject(value)) return value;
    } catch {
      // Try the next format.
    }
  }
  return null;
}

/**
 * The settings for the main window. Waits until the data is open (after the master password
 * when one is set). `blob` is what the renderer kept in localStorage: the marker, or an old
 * safeStorage blob that is moved into the store here.
 */
export async function readRendererConfig(blob: unknown): Promise<Record<string, unknown> | null> {
  await appLock.whenOpen();
  if (!appLock.isReady()) return null;
  try {
    const stored = readText(RENDERER_CONFIG);
    if (stored !== null) {
      rendererConfigDelivered = true;
      return JSON.parse(stored);
    }
    const legacy = typeof blob === 'string' && blob !== RENDERER_CONFIG_MARKER ? openLegacyConfig(blob) : null;
    if (legacy) getStore().setAppSecret(RENDERER_CONFIG, JSON.stringify(legacy));
    rendererConfigDelivered = true;
    return legacy;
  } catch (error) {
    console.warn('[AppSecrets] The stored settings could not be read:', toStoreError(error).code);
    return null;
  }
}

/**
 * Saves the main window's settings; returns the marker for localStorage, or null when nothing
 * was saved (the app is locked, or the window never received what is stored).
 */
export function saveRendererConfig(data: unknown): string | null {
  if (!appLock.isReady() || !isPlainObject(data)) return null;
  const json = JSON.stringify(data);
  if (json.length > MAX_RENDERER_CONFIG) return null;
  try {
    const store = getStore();
    if (!rendererConfigDelivered && store.listAppSecretNames('config/').includes(RENDERER_CONFIG)) return null;
    store.setAppSecret(RENDERER_CONFIG, json);
    rendererConfigDelivered = true;
    return RENDERER_CONFIG_MARKER;
  } catch (error) {
    console.warn('[AppSecrets] The settings could not be saved:', toStoreError(error).code);
    return null;
  }
}

/** Tests only. */
export function resetAppSecretsForTest(): void {
  rendererConfigDelivered = false;
}
