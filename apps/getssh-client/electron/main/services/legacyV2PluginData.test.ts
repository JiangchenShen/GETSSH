import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// GETSSH 2.0's plugin storage, copied into the main workspace on rust-core/getssh-store/store.fake.js.
// The 2.0 files are written with the real getssh-kv module, as 2.0 wrote them, in a temporary
// userData folder; HOME points at a temporary directory.

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getVersion: () => '3.0.0-test',
    getPath: () => {
      throw new Error('tests never use the real userData folder');
    },
  },
}));

import { DatabaseManager } from './DatabaseManager';
import { configureStore, resetStoreForTest } from './getsshStore';
import { importV2PluginData, V2_PLUGIN_DATA_SETTING } from './legacyV2PluginData';

const load = createRequire(import.meta.url);
const fake = load(path.resolve(process.cwd(), '../../rust-core/getssh-store/store.fake.js'));
const kv = load(path.resolve(process.cwd(), '../../rust-core/getssh-kv'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-legacy-v2-plugins-'));
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, GETSSH_FAKE_STORE: process.env.GETSSH_FAKE_STORE };

let home: string;
let userData: string;
const pluginData = () => path.join(userData, 'plugin_data');
const target = (workspaceId = 'home') => path.join(home, '.getssh', 'workspaces', workspaceId, 'plugins');

/** A plugin's storage as 2.0's SqliteStorageEngine wrote it: userData/plugin_data/<name>.db. */
function write2(name: string, values: Record<string, unknown>) {
  fs.mkdirSync(pluginData(), { recursive: true });
  const db = path.join(pluginData(), `${name}.db`);
  kv.initDb(db);
  for (const [key, value] of Object.entries(values)) kv.setVal(db, key, JSON.stringify(value));
}

const read = (file: string, key: string) => {
  const value = kv.getVal(file, key);
  return value === null ? null : JSON.parse(value);
};

/** Every file under plugin_data with its content hash and modification time. */
function sourceState() {
  return fs.readdirSync(pluginData()).sort().map(name => {
    const file = path.join(pluginData(), name);
    return { name, mtimeMs: fs.statSync(file).mtimeMs, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
  });
}

beforeEach(async () => {
  home = fs.mkdtempSync(path.join(root, 'home-'));
  userData = fs.mkdtempSync(path.join(root, 'user-data-'));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.GETSSH_FAKE_STORE = '1';
  fake.__fake.reset();
  resetStoreForTest();
  fake.configure(path.join(home, '.getssh'), '3.0.0-test');
  fake.__fake.seed({ workspaces: [{ id: 'default', name: 'Default' }, { id: 'home', name: 'Home', is_main: true }] });
  await configureStore().start();
});

afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

describe('GETSSH 2.0 plugin data', () => {
  it('copies each plugin file into the main workspace once and leaves 2.0 its files', () => {
    write2('server-monitor', { interval: 30, hosts: ['web.example.com'], token: 'plain-in-2.0' });
    write2('@acme.notes', { notes: '备份在周五' });
    const before = sourceState();

    expect(importV2PluginData(userData, home)).toEqual({ status: 'imported', copied: ['@acme.notes', 'server-monitor'], skipped: [] });
    expect(read(path.join(target(), 'server-monitor.db'), 'interval')).toBe(30);
    expect(read(path.join(target(), 'server-monitor.db'), 'hosts')).toEqual(['web.example.com']);
    expect(read(path.join(target(), '@acme.notes.db'), 'notes')).toBe('备份在周五');
    expect(fs.existsSync(target('default'))).toBe(false);
    if (process.platform !== 'win32') expect(fs.statSync(path.join(target(), 'server-monitor.db')).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(target()).filter(name => name.includes('.tmp'))).toEqual([]);
    expect(sourceState()).toEqual(before);
    expect(JSON.parse(DatabaseManager.getGlobalSetting(V2_PLUGIN_DATA_SETTING)!)).toMatchObject({ workspaceId: 'home', copied: ['@acme.notes', 'server-monitor'] });

    // Cleared in 3.0 (the plugin's file is gone): 2.0's data does not come back.
    fs.rmSync(path.join(target(), 'server-monitor.db'));
    expect(importV2PluginData(userData, home).status).toBe('already');
    expect(fs.existsSync(path.join(target(), 'server-monitor.db'))).toBe(false);
  });

  it('keeps the data 3.0 already has and skips files that are not plugin databases', () => {
    write2('server-monitor', { interval: 30 });
    write2('fresh', { theme: 'dark' });
    fs.mkdirSync(target(), { recursive: true });
    kv.initDb(path.join(target(), 'server-monitor.db'));
    kv.setVal(path.join(target(), 'server-monitor.db'), 'interval', '5');
    fs.writeFileSync(path.join(pluginData(), '.hidden.db'), 'x');
    fs.writeFileSync(path.join(pluginData(), 'notes.json'), '{}');
    fs.mkdirSync(path.join(pluginData(), 'folder.db'));
    if (process.platform !== 'win32') fs.symlinkSync(path.join(pluginData(), 'fresh.db'), path.join(pluginData(), 'link.db'));

    const result = importV2PluginData(userData, home);
    expect(result.status).toBe('imported');
    expect(result.copied).toEqual(['fresh']);
    expect(result.skipped.sort()).toEqual(['.hidden.db', 'folder', ...(process.platform !== 'win32' ? ['link'] : []), 'server-monitor'].sort());
    expect(read(path.join(target(), 'server-monitor.db'), 'interval')).toBe(5);
    expect(read(path.join(target(), 'fresh.db'), 'theme')).toBe('dark');
    expect(fs.existsSync(path.join(target(), 'link.db'))).toBe(false);
  });

  it('copies the write-ahead log 2.0 left behind with its database', () => {
    write2('server-monitor', { interval: 30 });
    // A log 2.0 left after a crash travels with the database (here a stand-in byte string).
    fs.writeFileSync(path.join(pluginData(), 'server-monitor.db-wal'), 'wal bytes');
    expect(importV2PluginData(userData, home).copied).toEqual(['server-monitor']);
    expect(fs.readFileSync(path.join(target(), 'server-monitor.db-wal'), 'utf8')).toBe('wal bytes');
  });

  it('records nothing when 2.0 left no plugin data', () => {
    expect(importV2PluginData(userData, home)).toEqual({ status: 'nothing', copied: [], skipped: [] });
    fs.mkdirSync(pluginData());
    expect(importV2PluginData(userData, home).status).toBe('nothing');
    expect(DatabaseManager.getGlobalSetting(V2_PLUGIN_DATA_SETTING)).toBeNull();
    // A later 2.0 run that adds data is still picked up.
    write2('server-monitor', { interval: 30 });
    expect(importV2PluginData(userData, home).copied).toEqual(['server-monitor']);
  });
});
