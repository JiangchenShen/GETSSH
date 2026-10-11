import { appLock } from '../../security/appLock';
import { getStore } from '../getsshStore';
import { assertSafeIdentifier } from './pluginProtocol';

/**
 * Plugin secrets in getssh-store: one app secret per plugin, "plugin/<name>", sealed with the app
 * key like the AI keys, carried by an export and protected by the master password. It holds
 * - `secrets`: what the plugin saved through context.secrets, the same in every workspace;
 * - `settings`: the values of its password settings, by workspace, because the rest of a
 *   plugin's settings live in that workspace's plugin storage.
 *
 * Before this, a password setting went into the plugin's storage file in plain text, and the
 * settings form read it back into the window. MAIN PROCESS ONLY: nothing here goes to a renderer.
 */

export const MAX_PLUGIN_SECRETS = 64;
export const MAX_PLUGIN_SECRET_BYTES = 64 * 1024;
/** Everything one plugin keeps, as stored. */
const MAX_PLUGIN_SECRETS_TOTAL = 1024 * 1024;

const PREFIX = 'plugin/';
/** What assertSafeIdentifier accepts. */
const SETTING_ID = /^[A-Za-z0-9._:-]{1,128}$/;

interface PluginSecretsRecord {
  secrets?: Record<string, string>;
  settings?: Record<string, Record<string, string>>;
}

export class PluginSecretsLockedError extends Error {
  constructor() {
    super('GETSSH is locked. Plugin secrets can be used again after it is unlocked.');
    this.name = 'PluginSecretsLockedError';
  }
}

export function pluginSecretsOpen(): boolean {
  return appLock.isReady();
}

function secretName(pluginId: string): string {
  assertSafeIdentifier(pluginId, 'Plugin name');
  return PREFIX + pluginId;
}

function stringMap(value: unknown): Record<string, string> {
  const map = Object.create(null) as Record<string, string>;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return map;
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') map[key] = item;
  }
  return map;
}

function read(pluginId: string): { secrets: Record<string, string>; settings: Record<string, Record<string, string>> } {
  if (!pluginSecretsOpen()) throw new PluginSecretsLockedError();
  const raw = getStore().getAppSecret(secretName(pluginId));
  const record: PluginSecretsRecord = raw ? (() => {
    try {
      return JSON.parse(raw.toString('utf8')) as PluginSecretsRecord;
    } finally {
      raw.fill(0);
    }
  })() : {};
  const settings = Object.create(null) as Record<string, Record<string, string>>;
  if (record.settings && typeof record.settings === 'object') {
    for (const [workspaceId, values] of Object.entries(record.settings)) settings[workspaceId] = stringMap(values);
  }
  return { secrets: stringMap(record.secrets), settings };
}

function write(pluginId: string, record: ReturnType<typeof read>): void {
  const settings = Object.fromEntries(Object.entries(record.settings).filter(([, values]) => Object.keys(values).length));
  const out: PluginSecretsRecord = {};
  if (Object.keys(record.secrets).length) out.secrets = record.secrets;
  if (Object.keys(settings).length) out.settings = settings;
  if (!out.secrets && !out.settings) {
    getStore().setAppSecret(secretName(pluginId), null);
    return;
  }
  const json = JSON.stringify(out);
  if (Buffer.byteLength(json, 'utf8') > MAX_PLUGIN_SECRETS_TOTAL) {
    throw new Error(`A plugin can keep at most ${MAX_PLUGIN_SECRETS_TOTAL / 1024 / 1024} MiB of secrets.`);
  }
  getStore().setAppSecret(secretName(pluginId), json);
}

function checkValue(value: unknown): string {
  if (typeof value !== 'string') throw new Error('A plugin secret must be a string.');
  if (Buffer.byteLength(value, 'utf8') > MAX_PLUGIN_SECRET_BYTES) {
    throw new Error(`A plugin secret can be at most ${MAX_PLUGIN_SECRET_BYTES / 1024} KiB.`);
  }
  return value;
}

// ── context.secrets ──

export function getPluginSecret(pluginId: string, key: string): string | undefined {
  assertSafeIdentifier(key, 'Secret name');
  return read(pluginId).secrets[key];
}

export function setPluginSecret(pluginId: string, key: string, value: unknown): void {
  assertSafeIdentifier(key, 'Secret name');
  const text = checkValue(value);
  const record = read(pluginId);
  if (!(key in record.secrets) && Object.keys(record.secrets).length >= MAX_PLUGIN_SECRETS) {
    throw new Error(`A plugin can keep at most ${MAX_PLUGIN_SECRETS} secrets.`);
  }
  record.secrets[key] = text;
  write(pluginId, record);
}

export function deletePluginSecret(pluginId: string, key: string): void {
  assertSafeIdentifier(key, 'Secret name');
  const record = read(pluginId);
  if (!(key in record.secrets)) return;
  delete record.secrets[key];
  write(pluginId, record);
}

// ── password settings ──

export function getPasswordSetting(pluginId: string, workspaceId: string, fieldId: string): string | undefined {
  return read(pluginId).settings[workspaceId]?.[fieldId];
}

/** Sets a password setting, or removes it with null. */
export function setPasswordSetting(pluginId: string, workspaceId: string, fieldId: string, value: string | null): void {
  // Any storage key is removed here too, and most cannot be a setting ID.
  if (value === null && !SETTING_ID.test(fieldId)) return;
  assertSafeIdentifier(fieldId, 'Setting ID');
  const record = read(pluginId);
  const values = record.settings[workspaceId] ?? (Object.create(null) as Record<string, string>);
  if (value === null) {
    if (!(fieldId in values)) return;
    delete values[fieldId];
  } else {
    values[fieldId] = checkValue(value);
  }
  record.settings[workspaceId] = values;
  write(pluginId, record);
}

/** The password settings that have a value in this workspace. */
export function savedPasswordSettings(pluginId: string, workspaceId: string): string[] {
  return Object.keys(read(pluginId).settings[workspaceId] ?? {}).sort();
}

export function clearPasswordSettings(pluginId: string, workspaceId: string): void {
  const record = read(pluginId);
  if (!record.settings[workspaceId]) return;
  delete record.settings[workspaceId];
  write(pluginId, record);
}

// ── cleanup ──

/** When the plugin is uninstalled: its secrets and its password settings in every workspace. */
export function removePluginSecrets(pluginId: string): void {
  if (!pluginSecretsOpen()) throw new PluginSecretsLockedError();
  getStore().setAppSecret(secretName(pluginId), null);
}

/** When a workspace is deleted: every plugin's password settings in it. */
export function removeWorkspacePluginSettings(workspaceId: string): void {
  if (!pluginSecretsOpen()) throw new PluginSecretsLockedError();
  for (const name of getStore().listAppSecretNames(PREFIX)) {
    const pluginId = name.slice(PREFIX.length);
    try {
      assertSafeIdentifier(pluginId, 'Plugin name');
    } catch {
      continue;
    }
    clearPasswordSettings(pluginId, workspaceId);
  }
}
