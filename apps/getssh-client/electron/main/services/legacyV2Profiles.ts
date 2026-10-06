import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { decryptLegacyMockKeychainBlob, decryptSecret } from '../security/secretStore';
import { DatabaseManager, type ProfileRow, type ProfileRowInput } from './DatabaseManager';
import { toStoreError } from './getsshStore';

/**
 * Moves the server profiles saved by the released GETSSH 2.0 into the MAIN workspace, once.
 *
 * 2.0 kept them in Electron's userData folder (~/Library/Application Support/getssh,
 * %APPDATA%\getssh), which 3.0 shares:
 * - profiles.enc   with a master password: 'GETSSH_V2' | salt 32 | IV 12 | GCM tag 16 | ciphertext,
 *                  or from 1.x salt 16 | IV 12 | tag 16 | ciphertext without the magic. The key is
 *                  PBKDF2-HMAC-SHA256 (100000 iterations, 32 bytes) of the password; AES-256-GCM, no
 *                  AAD. The plaintext is the profile array as JSON. Wins over profiles.json, as in 2.0.
 * - profiles.json  without one: the same array, readable. 1.x wrote a safeStorage blob here instead,
 *                  which is reported as unreadable.
 * - profiles.key   the 2.0 master password through safeStorage, rewritten on every encrypted save.
 *                  2.0 on macOS ran on Chromium's mock keychain, so that blob opens with a public
 *                  constant key; on Windows it is DPAPI for the same user. Neither asks anything.
 *
 * They are decrypted with node:crypto alone (no native module), and nothing in the folder is
 * changed or deleted, so GETSSH 2.x keeps working beside 3.0. The global setting 'import.v2Profiles' records a finished import
 * with the source file's SHA-256: it is never repeated by itself, and a file that changed later is
 * imported again only when the user asks (importV2WithPassword).
 *
 * 2.0 saved most servers without a port and connected them at the Default Port of its settings,
 * which lives in the window's localStorage (appConfig.defaultPort), out of the main process's
 * reach. The automatic import gives those rows port 22 and records their ids; the window then
 * passes its default port once (applyV2DefaultPort), which changes the ones still at 22.
 */

export type V2SourceKind = 'encrypted' | 'plain' | 'unreadable' | 'none';

export interface V2Detection {
  kind: V2SourceKind;
  /** profiles.key exists (whether it can be opened is only known by trying). */
  hasKey: boolean;
}

/**
 * - imported: the list was read and saved (the counts may both be 0 when every row was skipped)
 * - nothing: no 2.0 profiles here, or an empty list
 * - already: imported before; automatically, also when the file changed since
 * - needs_password: encrypted and the saved 2.0 password is missing or does not open it
 * - wrong_password: the password given does not open it
 * - unreadable: the file is damaged, too large, or a 1.x safeStorage blob
 * - failed: the 3.0 side could not take the profiles (`error` holds the store code); nothing saved
 */
export type V2ImportStatus = 'imported' | 'nothing' | 'already' | 'needs_password' | 'wrong_password' | 'unreadable' | 'failed';

export interface V2ImportResult {
  status: V2ImportStatus;
  imported: number;
  skipped: number;
  error?: string;
}

export interface V2ImportOptions {
  /** process.platform unless a test says otherwise; picks how profiles.key is opened. */
  platform?: NodeJS.Platform;
  /** The renderer's appConfig.defaultPort: 2.0 used it for profiles without a port. */
  defaultPort?: number;
}

export interface V2ImportSummary {
  /** Epoch milliseconds. */
  at: number;
  source: string;
  imported: number;
  skipped: number;
  /** The 2.0 file is different now from the one imported. */
  changed: boolean;
  /** Imported servers that had no port in 2.0 and got 22: they wait for applyV2DefaultPort. */
  portDefaulted: number;
}

/**
 * - applied: the default port was given to the recorded servers still at 22 (`changed` of them,
 *   0 when it is 22 itself); nothing waits any more
 * - nothing: no recorded servers wait for it
 * - failed: the MAIN workspace could not be read or saved (`error` holds the store code)
 */
export interface V2PortResult {
  status: 'applied' | 'nothing' | 'failed';
  changed: number;
  error?: string;
}

export interface V2ImportState {
  kind: V2SourceKind;
  /** Importing needs the user to type the 2.0 master password. */
  needsPassword: boolean;
  /** The import recorded earlier, or null. */
  imported: V2ImportSummary | null;
}

type SourceName = 'profiles.enc' | 'profiles.json';

interface Source {
  name: SourceName;
  bytes: Buffer;
  sha256: string;
}

type Found =
  | { kind: 'none'; source: null }
  | { kind: 'unreadable'; source: Source | null }
  | { kind: 'encrypted'; source: Source }
  | { kind: 'plain'; source: Source; rows: unknown[] };

interface ImportRecord {
  at: number;
  source: string;
  sha256: string;
  imported: number;
  skipped: number;
  /** Imported servers that got port 22 for want of 2.0's default port, by the workspace they went into. */
  portDefaulted: WaitingPorts[];
}

interface WaitingPorts {
  workspaceId: string;
  ids: string[];
}

function waitingCount(record: ImportRecord | null): number {
  return (record?.portDefaulted ?? []).reduce((sum, entry) => sum + entry.ids.length, 0);
}

/** Adds `ids` imported into `workspaceId` to what already waits. */
function addWaiting(waiting: WaitingPorts[], workspaceId: string, ids: string[]): WaitingPorts[] {
  const merged = waiting.map(entry => ({ workspaceId: entry.workspaceId, ids: [...entry.ids] }));
  if (ids.length === 0) return merged;
  const entry = merged.find(candidate => candidate.workspaceId === workspaceId);
  if (entry) entry.ids = [...new Set([...entry.ids, ...ids])];
  else merged.push({ workspaceId, ids: [...ids] });
  return merged;
}

function readWaiting(value: unknown): WaitingPorts[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(entry => {
    if (!isPlainObject(entry) || typeof entry.workspaceId !== 'string' || !Array.isArray(entry.ids)) return [];
    return [{ workspaceId: entry.workspaceId, ids: entry.ids.filter((id): id is string => typeof id === 'string') }];
  });
}

export const V2_IMPORT_SETTING = 'import.v2Profiles';

const ENCRYPTED_FILE = 'profiles.enc';
const PLAIN_FILE = 'profiles.json';
const KEY_FILE = 'profiles.key';

const MAGIC_V2 = Buffer.from('GETSSH_V2', 'ascii');
const V2_SALT_BYTES = 32;
const V1_SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const PBKDF2_ITERATIONS = 100_000;

const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_KEY_FILE_BYTES = 64 * 1024;
/** 2.0 never limited its password; anything longer cannot have come from a password field. */
const MAX_PASSWORD_LENGTH = 4096;
const MAX_ROWS = 5000;
// getssh-store's own limits (rust-core/getssh-store/src/profiles.rs validate). saveProfiles refuses
// the whole list for one row over them, so such rows are skipped here one by one.
const MAX_HOST_BYTES = 1024;
const MAX_TEXT_BYTES = 4096;
const MAX_SECRET_BYTES = 64 * 1024;

const PROTOCOLS = new Set(['ssh', 'local', 'telnet', 'auto']);

const pbkdf2 = promisify(crypto.pbkdf2);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PASSWORD_LENGTH;
}

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** The file's bytes; null when it does not exist; false when it is not a readable file within `limit`. */
function readLimited(file: string, limit: number): Buffer | null | false {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? null : false;
  }
  if (!stat.isFile() || stat.size > limit) return false;
  try {
    return fs.readFileSync(file);
  } catch {
    return false;
  }
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** A JSON array from UTF-8 bytes, or null. Parse errors are dropped unseen: they quote the input. */
function parseList(bytes: Buffer): unknown[] | null {
  try {
    let text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

interface VaultParts {
  salt: Buffer;
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
}

/** Splits a vault as getssh-vault decrypt_vault reads it; the tag comes before the ciphertext. */
function vaultParts(file: Buffer): VaultParts | null {
  const v2 = file.subarray(0, MAGIC_V2.length).equals(MAGIC_V2);
  const start = v2 ? MAGIC_V2.length : 0;
  const saltBytes = v2 ? V2_SALT_BYTES : V1_SALT_BYTES;
  const header = start + saltBytes + IV_BYTES + TAG_BYTES;
  if (file.length < header) return null;
  const ivStart = start + saltBytes;
  return {
    salt: file.subarray(start, ivStart),
    iv: file.subarray(ivStart, ivStart + IV_BYTES),
    tag: file.subarray(ivStart + IV_BYTES, header),
    ciphertext: file.subarray(header),
  };
}

/**
 * Decrypts a 2.0 (or 1.x) profiles.enc. Null when the password does not open it (the GCM tag is
 * the check) or the file is too short. The caller fills the returned plaintext with zeros.
 */
export async function decryptV2Vault(file: Buffer, password: string): Promise<Buffer | null> {
  const parts = vaultParts(file);
  if (!parts || !validPassword(password)) return null;
  // UTF-8 without normalization, as 2.0 passed Buffer.from(masterPassword) to the vault.
  const secret = Buffer.from(password, 'utf8');
  let key: Buffer | null = null;
  try {
    key = await pbkdf2(secret, parts.salt, PBKDF2_ITERATIONS, KEY_BYTES, 'sha256');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, parts.iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(parts.tag);
    const head = decipher.update(parts.ciphertext);
    try {
      return Buffer.concat([head, decipher.final()]);
    } finally {
      head.fill(0);
    }
  } catch {
    return null;
  } finally {
    secret.fill(0);
    key?.fill(0);
  }
}

/** The 2.0 profiles in `dir`, as 2.0's check-profiles found them. */
function readSource(dir: string): Found {
  for (const name of [ENCRYPTED_FILE, PLAIN_FILE] as const) {
    const bytes = readLimited(path.join(dir, name), MAX_SOURCE_BYTES);
    if (bytes === null) continue;
    if (bytes === false) return { kind: 'unreadable', source: null };
    const source: Source = { name, bytes, sha256: sha256Hex(bytes) };
    if (name === ENCRYPTED_FILE) return vaultParts(bytes) ? { kind: 'encrypted', source } : { kind: 'unreadable', source };
    const rows = parseList(bytes);
    return rows ? { kind: 'plain', source, rows } : { kind: 'unreadable', source };
  }
  return { kind: 'none', source: null };
}

/** profiles.json holds the passwords readable: the copy read here is wiped once it is used. */
function release(found: Found): void {
  found.source?.bytes.fill(0);
}

/**
 * The 2.0 master password kept in profiles.key, opened without any prompt; null when there is
 * none or it does not open. Its value is only trusted once the vault decrypts with it.
 */
function savedPassword(dir: string, platform: NodeJS.Platform): string | null {
  const blob = readLimited(path.join(dir, KEY_FILE), MAX_KEY_FILE_BYTES);
  if (!blob) return null;
  try {
    let value: string | null = null;
    if (platform === 'darwin') {
      // Only the mock-keychain format. A profiles.key last written by 1.x uses the real Keychain
      // item; safeStorage would show a Keychain prompt for it, so it is never tried.
      value = decryptLegacyMockKeychainBlob(blob);
    } else if (platform === 'win32') {
      // DPAPI, through the key in userData\Local State that 2.0 and 3.0 share: no prompt.
      value = decryptSecret(blob).value;
    }
    return validPassword(value) ? value : null;
  } catch {
    return null;
  } finally {
    blob.fill(0);
  }
}

function readRecord(): ImportRecord | null {
  const raw = DatabaseManager.getGlobalSetting(V2_IMPORT_SETTING);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isPlainObject(value) || typeof value.sha256 !== 'string') return null;
    const count = (field: unknown) => (typeof field === 'number' && Number.isFinite(field) ? field : 0);
    return {
      at: count(value.at),
      source: typeof value.source === 'string' ? value.source : '',
      sha256: value.sha256,
      imported: count(value.imported),
      skipped: count(value.skipped),
      portDefaulted: readWaiting(value.portDefaulted),
    };
  } catch {
    return null;
  }
}

// --- Mapping 2.0 rows ---

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function validPort(value: unknown): number | null {
  const n = typeof value === 'string' && /^\d{1,5}$/.test(value) ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

function byteLength(value: string | null): number {
  return value === null ? 0 : Buffer.byteLength(value, 'utf8');
}

type ImportRow = ProfileRowInput & {
  host: string;
  username: string;
  port: number;
  protocol: string;
  alias: string | null;
  osType: string | null;
  groupName: string | null;
  privateKeyPath: string | null;
  password?: string;
};

/**
 * One 2.0 SessionProfile as a 3.0 profile, with the defaults 2.0 applied at connect time: a
 * missing port is 23 for telnet and appConfig.defaultPort or 22 otherwise, keepalive is on unless
 * switched off, and a key file wins over the password. 2.0 had no passphrase field.
 */
function mapRow(raw: Record<string, unknown>, defaultPort: number | null): ImportRow {
  const protocol = PROTOCOLS.has(raw.protocol as string) ? (raw.protocol as string) : 'ssh';
  const privateKeyPath = nonEmpty(raw.privateKeyPath);
  const password = nonEmpty(raw.password);
  const row: ImportRow = {
    id: '',
    host: typeof raw.host === 'string' ? raw.host : '',
    username: typeof raw.username === 'string' ? raw.username : '',
    port: validPort(raw.port) ?? (protocol === 'telnet' ? 23 : defaultPort ?? 22),
    protocol,
    authType: privateKeyPath ? 'key' : 'password',
    alias: nonEmpty(raw.alias) ?? nonEmpty(raw.name),
    osType: nonEmpty(raw.osType),
    groupName: nonEmpty(raw.groupId),
    autoStart: raw.autoStart === true,
    useKeepAlive: raw.useKeepAlive !== false,
    strictHostKeyChecking: false,
    proxyJump: null,
    initialDirectory: null,
    postConnectScript: null,
    themeOverride: null,
    keyId: null,
    privateKeyPath,
  };
  if (password !== null) row.password = password;
  return row;
}

function withinStoreLimits(row: ImportRow): boolean {
  const texts = [row.host, row.username, row.alias, row.osType, row.groupName, row.privateKeyPath];
  if (texts.some(value => value !== null && value.includes('\0'))) return false;
  if (byteLength(row.host) > MAX_HOST_BYTES || byteLength(row.username) > MAX_HOST_BYTES) return false;
  if ([row.alias, row.osType, row.groupName, row.privateKeyPath].some(value => byteLength(value) > MAX_TEXT_BYTES)) return false;
  return byteLength(row.password ?? null) <= MAX_SECRET_BYTES;
}

function sameServer(protocol: string, host: string, port: number, username: string): string {
  return JSON.stringify([protocol, host, port, username]);
}

/**
 * The rows to add, in 2.0's order. Ids are derived from the row, so the same file always gives
 * the same ids: 'v2-' + sha256(protocol|host|port|username|n), n counting identical servers
 * before it in the 2.0 list. The port in the id is the row's own, or 'default' when it has none,
 * whatever default port is passed: a server imported at 22 and waiting for the default port keeps
 * its id when a later import knows that port, and is skipped there; and a server without a port
 * never shares an id with one saved at port 22. Skipped: anything that is not an object, blank rows (except 'local',
 * whose host is empty), rows over the store's limits, and servers 3.0 already has. `portDefaulted`
 * lists the added rows that got 22 because 2.0 would have used its default port (not passed).
 */
function planRows(rows: unknown[], existing: ProfileRow[], defaultPort: number | null): { add: ImportRow[]; skipped: number; portDefaulted: string[] } {
  const known = new Set(existing.map(profile => sameServer(profile.protocol, profile.host, profile.port, profile.username)));
  const ids = new Set(existing.map(profile => profile.id));
  const seen = new Map<string, number>();
  const add: ImportRow[] = [];
  const portDefaulted: string[] = [];
  let skipped = Math.max(0, rows.length - MAX_ROWS);
  for (const raw of rows.slice(0, MAX_ROWS)) {
    if (!isPlainObject(raw)) {
      skipped++;
      continue;
    }
    const row = mapRow(raw, defaultPort);
    const server = sameServer(row.protocol, row.host, row.port, row.username);
    const idPort = validPort(raw.port) ?? 'default';
    const identity = JSON.stringify([row.protocol, row.host, idPort, row.username]);
    const n = seen.get(identity) ?? 0;
    seen.set(identity, n + 1);
    row.id = `v2-${sha256Hex(`${row.protocol}|${row.host}|${idPort}|${row.username}|${n}`).slice(0, 32)}`;
    const blank = row.protocol !== 'local' && row.host.trim() === '';
    if (blank || !withinStoreLimits(row) || known.has(server) || ids.has(row.id)) {
      skipped++;
      continue;
    }
    ids.add(row.id);
    add.push(row);
    // 2.0: `port || appConfig.defaultPort || 22`; telnet used 23, a local shell has no port.
    if (defaultPort === null && validPort(raw.port) === null && row.protocol !== 'telnet' && row.protocol !== 'local') portDefaulted.push(row.id);
  }
  return { add, skipped, portDefaulted };
}

// --- Import ---

const result = (status: V2ImportStatus, imported = 0, skipped = 0): V2ImportResult => ({ status, imported, skipped });
const failed = (error: string): V2ImportResult => ({ status: 'failed', imported: 0, skipped: 0, error });

/**
 * Adds the rows to the MAIN workspace. getssh-store replaces the whole list on save, so the list
 * saved is the current one (without credentials: undefined secrets are kept) plus the new rows.
 */
async function saveIntoMain(rows: unknown[], source: Source, options: V2ImportOptions): Promise<V2ImportResult> {
  const main = DatabaseManager.getWorkspaces().find(workspace => workspace.is_main);
  if (!main || (await DatabaseManager.openWorkspace(main.id)) !== 'open') return failed('locked');
  // Nothing below waits, so the list read here is the list that gets replaced.
  if (!DatabaseManager.isWorkspaceOpen(main.id)) return failed('locked');
  const existing = DatabaseManager.getProfiles(main.id);
  const { add, skipped, portDefaulted } = planRows(rows, existing, validPort(options.defaultPort));
  if (add.length > 0) {
    const list: ProfileRowInput[] = [...existing.map(profile => ({ ...profile })), ...add];
    DatabaseManager.saveProfiles(main.id, list);
    // saveProfiles quietly does nothing on a locked workspace; only a list that is really there counts.
    const saved = new Set(DatabaseManager.getProfiles(main.id).map(profile => profile.id));
    if (!list.every(row => saved.has(row.id))) return failed('not_saved');
  }
  DatabaseManager.logAudit(main.id, 'Profiles Imported', 'GETSSH 2.0', `${add.length} imported, ${skipped} skipped`);
  // Rows of an earlier import that still wait for the default port keep waiting.
  const waiting = addWaiting(readRecord()?.portDefaulted ?? [], main.id, portDefaulted);
  const record: ImportRecord = { at: Date.now(), source: source.name, sha256: source.sha256, imported: add.length, skipped, portDefaulted: waiting };
  DatabaseManager.setGlobalSetting(V2_IMPORT_SETTING, JSON.stringify(record));
  console.log(`[LegacyV2] Imported ${add.length} GETSSH 2.0 profile(s) into the MAIN workspace, skipped ${skipped}.`);
  return result('imported', add.length, skipped);
}

/** `password` null: the saved 2.0 password, if it opens the file. `automatic`: never repeat an import. */
async function importProfiles(dir: string, password: string | null, automatic: boolean, options: V2ImportOptions): Promise<V2ImportResult> {
  const found = readSource(dir);
  try {
    if (found.kind === 'none') return result('nothing');
    if (found.kind === 'unreadable') return result('unreadable');
    const record = readRecord();
    if (record && (automatic || record.sha256 === found.source.sha256)) return result('already');
    let rows: unknown[] | null;
    if (found.kind === 'plain') {
      rows = found.rows;
    } else {
      const candidate = password ?? savedPassword(dir, options.platform ?? process.platform);
      if (candidate === null) return result('needs_password');
      const plaintext = await decryptV2Vault(found.source.bytes, candidate);
      if (!plaintext) return result(password === null ? 'needs_password' : 'wrong_password');
      try {
        rows = parseList(plaintext);
      } finally {
        plaintext.fill(0);
      }
      if (!rows) return result('unreadable');
    }
    if (rows.length === 0) return result('nothing');
    return await saveIntoMain(rows, found.source, options);
  } finally {
    release(found);
  }
}

let queue: Promise<unknown> = Promise.resolve();

/** One import (or port change) at a time, and never a thrown error: a failure is a status. */
function queued<T>(task: () => Promise<T>, onError: (code: string) => T): Promise<T> {
  const guarded = async (): Promise<T> => {
    try {
      return await task();
    } catch (error) {
      // Only the code: a message could quote what was being read.
      const code = toStoreError(error).code;
      console.warn('[LegacyV2] GETSSH 2.0 profiles were not changed:', code);
      return onError(code);
    }
  };
  const run = queue.then(guarded, guarded);
  queue = run;
  return run;
}

function runImport(task: () => Promise<V2ImportResult>): Promise<V2ImportResult> {
  return queued(task, failed);
}

/**
 * Gives the recorded servers still at 22 the default port of 2.0 (see the top of this file), in
 * the workspace each import went into, which may no longer be MAIN. All or nothing as far as
 * locks go: while one of those workspaces cannot be opened, nothing changes and all keep waiting.
 * A workspace deleted since has nothing left to change.
 */
async function applyDefaultPort(port: number): Promise<V2PortResult> {
  const workspaces = DatabaseManager.getWorkspaces();
  if (!workspaces.some(workspace => workspace.is_main)) return { status: 'failed', changed: 0, error: 'locked' };
  const record = readRecord();
  if (!record || waitingCount(record) === 0) return { status: 'nothing', changed: 0 };
  const targets = record.portDefaulted.filter(entry => workspaces.some(workspace => workspace.id === entry.workspaceId));
  for (const entry of targets) {
    if ((await DatabaseManager.openWorkspace(entry.workspaceId)) !== 'open') return { status: 'failed', changed: 0, error: 'locked' };
  }
  // Nothing below waits, so each list read here is the list that gets replaced.
  if (!targets.every(entry => DatabaseManager.isWorkspaceOpen(entry.workspaceId))) return { status: 'failed', changed: 0, error: 'locked' };
  let changed = 0;
  for (const entry of targets) {
    const waiting = new Set(entry.ids);
    let here = 0;
    // A row changed in 3.0 since (another port) is left as it is.
    const list: ProfileRowInput[] = DatabaseManager.getProfiles(entry.workspaceId).map(profile => {
      if (port === 22 || !waiting.has(profile.id) || profile.port !== 22) return { ...profile };
      here++;
      return { ...profile, port };
    });
    if (here === 0) continue;
    DatabaseManager.saveProfiles(entry.workspaceId, list);
    const saved = new Map(DatabaseManager.getProfiles(entry.workspaceId).map(profile => [profile.id, profile.port]));
    // The record stays as it was: rows saved already are no longer at 22 and are left alone next time.
    if (!list.every(row => saved.get(row.id) === row.port)) return { status: 'failed', changed, error: 'not_saved' };
    DatabaseManager.logAudit(entry.workspaceId, 'Profiles Updated', 'GETSSH 2.0', `${here} given the 2.0 default port ${port}`);
    changed += here;
  }
  DatabaseManager.setGlobalSetting(V2_IMPORT_SETTING, JSON.stringify({ ...record, portDefaulted: [] }));
  return { status: 'applied', changed };
}

/** What `dir` (2.0's userData folder) holds. Reads files only; asks nothing and opens nothing. */
export function detectV2Profiles(dir: string): V2Detection {
  const found = readSource(dir);
  release(found);
  return { kind: found.kind, hasKey: isFile(path.join(dir, KEY_FILE)) };
}

/**
 * The import appLock runs once the data is open, before the window loads any profile: plain
 * files and files the saved 2.0 password opens are imported without asking. Never repeats a
 * recorded import, never throws.
 */
export function runAutomaticV2Import(dir: string, options: V2ImportOptions = {}): Promise<V2ImportResult> {
  return runImport(() => importProfiles(dir, null, true, options));
}

/**
 * The import the user asked for, with the 2.0 master password they typed (any length from 1 to
 * 4096 characters; 2.0 had no minimum). Without one (null or '') the saved 2.0 password is tried.
 * Also imports a file that changed after an earlier import; servers already in 3.0 are skipped.
 */
export function importV2WithPassword(dir: string, password: string | null, options: V2ImportOptions = {}): Promise<V2ImportResult> {
  return runImport(() => importProfiles(dir, password ? password : null, false, options));
}

/**
 * The window's appConfig.defaultPort (2.0's Default Port, which the 3.0 window reads from the same
 * localStorage) for the servers the automatic import gave 22. Applied once: afterwards nothing
 * waits, whatever the port. An integer from 1 to 65535.
 */
export function applyV2DefaultPort(port: number): Promise<V2PortResult> {
  if (validPort(port) === null || typeof port !== 'number') return Promise.resolve({ status: 'failed', changed: 0, error: 'invalid_argument' });
  return queued(() => applyDefaultPort(port), code => ({ status: 'failed', changed: 0, error: code }));
}

/** For the window: what is there, whether importing it needs the typed password, and what was done. */
export async function getV2ImportState(dir: string, options: V2ImportOptions = {}): Promise<V2ImportState> {
  const found = readSource(dir);
  try {
    const record = readRecord();
    const changed = !!record && found.source !== null && found.source.sha256 !== record.sha256;
    let needsPassword = false;
    if (found.kind === 'encrypted' && (!record || changed)) {
      const saved = savedPassword(dir, options.platform ?? process.platform);
      const plaintext = saved === null ? null : await decryptV2Vault(found.source.bytes, saved);
      needsPassword = plaintext === null;
      plaintext?.fill(0);
    }
    return {
      kind: found.kind,
      needsPassword,
      imported: record
        ? { at: record.at, source: record.source, imported: record.imported, skipped: record.skipped, changed, portDefaulted: waitingCount(record) }
        : null,
    };
  } finally {
    release(found);
  }
}
