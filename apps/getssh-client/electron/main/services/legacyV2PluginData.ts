import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseManager } from './DatabaseManager';

/**
 * The storage of GETSSH 2.0's plugins, copied into 3.0 once.
 *
 * Both keep a plugin's context.storage in a getssh-kv SQLite file named after the plugin
 * (manifest.name) with the same kv table. 2.0 kept them in userData/plugin_data/<name>.db; 3.0
 * keeps a folder per workspace, ~/.getssh/workspaces/<id>/plugins. A 2.0 install had one set of
 * servers and one set of plugin data, so the files go to the MAIN workspace, like the servers
 * (legacyV2Profiles.ts). A file is copied only when that workspace has none for the plugin yet,
 * and nothing in plugin_data is changed, so GETSSH 2.x keeps working beside 3.0.
 *
 * The global setting 'import.v2PluginData' records the import, which never runs again: data a
 * plugin clears in 3.0, or loses with an uninstall, does not come back from 2.0.
 *
 * A password setting copied this way is still plain text in the file, as it was in 2.0.
 * PluginManager moves it into the store when the plugin reads it or the settings page lists the
 * saved passwords (movePasswordSettings).
 *
 * Runs in appLock before 'ready', so before any plugin is loaded and can create its own file.
 */

export const V2_PLUGIN_DATA_SETTING = 'import.v2PluginData';

const SOURCE_DIR = 'plugin_data';
/** manifest.name as a file name: no separators, no leading dot. */
const PLUGIN_FILE = /^([A-Za-z0-9@_-][A-Za-z0-9@._-]{0,127})\.db$/;
/** Far above 2.0's 5 MiB default quota; a larger file is skipped rather than copied. */
const MAX_FILE_BYTES = 64 * 1024 * 1024;

export interface V2PluginDataResult {
  status: 'imported' | 'nothing' | 'already' | 'failed';
  /** Plugin names whose data was copied. */
  copied: string[];
  /** Plugin names left alone: the main workspace already has data for them, or the file is unusable. */
  skipped: string[];
  error?: string;
}

const done = (status: V2PluginDataResult['status'], copied: string[] = [], skipped: string[] = [], error?: string): V2PluginDataResult =>
  error === undefined ? { status, copied, skipped } : { status, copied, skipped, error };

/** A regular file (not a link) of at most MAX_FILE_BYTES; false when it does not exist. */
function usableFile(file: string): boolean {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && stat.size <= MAX_FILE_BYTES;
  } catch {
    return false;
  }
}

function exists(file: string): boolean {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copies one plugin's file (and its write-ahead log, if 2.0 left one) to temporary names and
 * renames them into place, the database first: a crash halfway leaves no partial database under
 * the real name, at worst the database without the changes still in its log.
 */
function copyPlugin(source: string, target: string): void {
  const tag = crypto.randomBytes(6).toString('hex');
  const temporary = [`${target}.v2-${tag}.tmp`, `${target}-wal.v2-${tag}.tmp`];
  try {
    fs.copyFileSync(source, temporary[0], fs.constants.COPYFILE_EXCL);
    fs.chmodSync(temporary[0], 0o600);
    const wal = usableFile(`${source}-wal`);
    if (wal) {
      fs.copyFileSync(`${source}-wal`, temporary[1], fs.constants.COPYFILE_EXCL);
      fs.chmodSync(temporary[1], 0o600);
    }
    fs.renameSync(temporary[0], target);
    if (wal) fs.renameSync(temporary[1], `${target}-wal`);
  } finally {
    for (const file of temporary) fs.rmSync(file, { force: true });
  }
}

/**
 * Copies 2.0's plugin data (`userData`/plugin_data) into the main workspace under `home`/.getssh.
 * Does nothing when there is no plugin_data folder or the import was recorded before. Never throws.
 */
export function importV2PluginData(userData: string, home: string): V2PluginDataResult {
  try {
    if (DatabaseManager.getGlobalSetting(V2_PLUGIN_DATA_SETTING) !== null) return done('already');
    const sourceDir = path.join(userData, SOURCE_DIR);
    let names: string[];
    try {
      if (!fs.lstatSync(sourceDir).isDirectory()) return done('nothing');
      names = fs.readdirSync(sourceDir).sort();
    } catch {
      return done('nothing');
    }
    const main = DatabaseManager.getWorkspaces().find(workspace => workspace.is_main);
    if (!main) return done('failed', [], [], 'locked');

    const targetDir = path.join(home, '.getssh', 'workspaces', main.id, 'plugins');
    const copied: string[] = [];
    const skipped: string[] = [];
    for (const name of names) {
      if (!name.endsWith('.db')) continue;
      const plugin = PLUGIN_FILE.exec(name)?.[1];
      const source = path.join(sourceDir, name);
      const target = path.join(targetDir, name);
      if (!plugin || !usableFile(source) || [target, `${target}-wal`, `${target}-shm`].some(exists)) {
        skipped.push(plugin ?? name);
        continue;
      }
      try {
        fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
        copyPlugin(source, target);
        copied.push(plugin);
      } catch (error) {
        console.warn(`[LegacyV2] The data of plugin ${plugin} was not copied:`, (error as NodeJS.ErrnoException).code ?? 'error');
        skipped.push(plugin);
      }
    }
    if (copied.length === 0 && skipped.length === 0) return done('nothing');
    DatabaseManager.setGlobalSetting(V2_PLUGIN_DATA_SETTING, JSON.stringify({ at: Date.now(), workspaceId: main.id, copied, skipped }));
    if (copied.length > 0) DatabaseManager.logAudit(main.id, 'Plugin Data Imported', 'GETSSH 2.0', copied.join(', '));
    return done('imported', copied, skipped);
  } catch (error) {
    console.warn('[LegacyV2] GETSSH 2.0 plugin data was not imported:', (error as NodeJS.ErrnoException).code ?? 'error');
    return done('failed', [], [], 'internal');
  }
}
