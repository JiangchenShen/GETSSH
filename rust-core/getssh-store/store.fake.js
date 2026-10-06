'use strict';
/*
 * store.fake.js: an in-memory stand-in for the native getssh-store module (GETSSH 3.0).
 *
 * WHAT IT IS
 *   The same exports as rust-core/getssh-store/store.d.ts, the frozen interface: the same names,
 *   the same sync/async split, the same argument order, the same return shapes and the same
 *   "[store:<code>] " error messages. All data lives in this process's memory and is lost when the
 *   process exits. It lets the Electron main process (Claude) and the renderer UI (Codex) be built and
 *   tested against the interface before the Rust module exists. store.fake.test.mjs pins its behaviour.
 *
 * IT IS NOT SECURE. NEVER SHIP IT.
 *   Passwords, credentials and private keys sit in ordinary JS strings and Buffers, nothing is wiped,
 *   there is no Argon2, no SQLCipher, no Keychain / TPM / Secure Enclave, and Touch ID / Windows
 *   Hello is simulated. Packaging must never include this file and production code must never pick
 *   it. Export bundles it writes can only be read by the fake (header {"fake": true}).
 *
 * HOW TO LOAD IT
 *   Main process, in the single place that loads the store:
 *
 *     const store = process.env.GETSSH_FAKE_STORE && !app.isPackaged
 *       ? require(path.join(getRustCorePath('getssh-store'), 'store.fake.js'))
 *       : require(getRustCorePath('getssh-store'));
 *
 *   Renderer: the renderer never loads the store, real or fake (this file throws if it is
 *   required in a renderer). Start the app with GETSSH_FAKE_STORE=1 so the main process runs on the
 *   fake, and pick the starting state with the variables below. Node / Vitest tests may require()
 *   this file directly (from ESM: createRequire(import.meta.url)).
 *
 *   Optional environment variables, read once when this file is loaded:
 *     GETSSH_FAKE_STORE_SEED=/abs/path/seed.json   given to __fake.seed() on the first configure()
 *     GETSSH_FAKE_STORE_PRESENCE=ok|cancelled|unsupported   result of every Touch ID / Hello prompt
 *     GETSSH_FAKE_STORE_DELAY_MS=400               every async call waits this long (spinners)
 *
 * __fake: TEST CONTROLS (not in the real module; product code must never touch it)
 *   reset()                  a fresh, unconfigured store: presence 'ok', clock offset 0, no latency
 *   restart()                simulates relaunching the app: the data stays, every database closes
 *                            and start() must run again. Needed after importBundle(), which leaves
 *                            the store refusing every call (unavailable), as the real module does.
 *   seed(options)            replaces all data; call after configure(), then `await start()`:
 *       { masterPassword?, presenceEnabled?, recoveryCode?,
 *         workspaces?: [{ id, name?, password?, is_main?, themeColor?, presenceEnabled?, preferences? }],
 *         profiles?: { [workspaceId]: ProfileInput[] },   // secrets as plain strings
 *         globalSettings?: { [key]: string }, appSecrets?: { [name]: string },
 *         startReport?: Partial<StartReport> }
 *     A master password shorter than 12 characters is accepted here, to exercise
 *     masterPasswordMustChange. Without workspaces there is one MAIN workspace "default".
 *   setPresence(result)      'ok' | 'cancelled' | 'unsupported' for every later prompt
 *   advance(ms), now()       the clock behind reveal windows, rate limits and timestamps
 *                            (real time plus an offset, so a running app behaves normally)
 *   setLatency(ms)           delay for every async call
 *   snapshot()               the whole state for assertions; never contains a secret
 *   secretsFor(workspaceId)  the stored secrets of one workspace; tests only
 *
 * WHERE THE FAKE DIFFERS FROM THE REAL MODULE
 *   - Nothing is written under baseDir. start() never migrates anything (its report is empty unless
 *     seeded), deviceKeyLost is always false and importBundle's backupPath is a made-up path next to
 *     baseDir; no backup is made. The real app relaunches after an import (app.relaunch()); with
 *     the fake that relaunch loses everything, so tests use __fake.restart() instead.
 *   - needsLegacyMigration() is always false, since the fake never reads baseDir. start(legacy)
 *     makes the real module's checks (invalid_argument for a malformed appKey or workspacePasswords
 *     entry) and then ignores `legacy`; the real module also requires it while legacy data is on
 *     disk and migrates that data.
 *   - Bundles use scrypt + AES-256-GCM (no Argon2id, no 64 KiB chunks); the layout is
 *     "GETSSHBK" | u16 version | u32 n | header JSON | u32 n | key area | payload.
 *   - SSH keys: only the public half is parsed (OpenSSH and PuTTY public blobs; PEM through
 *     node:crypto). Passphrases of encrypted OpenSSH and PPK keys are NOT checked; PEM ones are.
 *     generateSshKey writes a real unencrypted OpenSSH ed25519 key.
 *   - Reveal windows are per workspace, exactly as store.d.ts describes them. The real module keys
 *     them by the password that protects the workspace (under a master password one window covers
 *     every workspace) and closeReveal() closes all of them.
 *   - Rate limits are per scope here; the real keystore counts wrong passwords across all scopes.
 *
 * DECISIONS WHERE store.d.ts IS SILENT (the real module should match them or the d.ts should say otherwise)
 *   - Before start() every call except configure(), needsLegacyMigration(), start(), appState(),
 *     isRecoveryCodeWellFormed() and isEncryptedAiMemoryAvailable() fails with not_configured;
 *     appState() reports 'locked'.
 *   - While the app is locked (master password set), every main.db function (workspace list,
 *     settings, app secrets, AI memory, export, import) fails with locked;
 *     isEncryptedAiMemoryAvailable() returns false and inspectBundle() still works.
 *   - verifyPresence() resolves false when the prompt is cancelled and rejects with unavailable when
 *     Touch ID / Hello is missing. verifyPassword() resolves false for a wrong password.
 *   - unlockApp / unlockWorkspace with { presence } fail with needs_password where Touch ID / Hello
 *     is not enabled; openReveal({ presence }) and verifyPresence() only need the hardware.
 *   - Five wrong passwords in a row lock that scope ('app' = master password and recovery codes,
 *     'ws:<id>' = a workspace password) for 30 s; the rate_limited detail starts with the
 *     remaining milliseconds, as the keystore's does. A correct password resets the count.
 *   - Setting the first master password needs every password-protected workspace open; their own
 *     passwords are dropped because the master password now protects them.
 *   - setMasterPassword(new) without `current` works only after unlockApp({ recoveryCode }).
 *     createRecoveryCode() needs `current` (the master password) while one is set.
 *   - masterPasswordMustChange turns on when a password unlock used a master password shorter than
 *     12 characters and stays on, while the app is unlocked, until the master password changes.
 *   - A new workspace password inherits the app-wide presence setting; setPresence(true) reaches
 *     locked password workspaces on their next password unlock.
 *   - deleteWorkspace() also deletes a locked workspace, as DatabaseManager does today.
 *   - exportCandidates(): profileCount is 0 for a locked workspace (its database cannot be read);
 *     unlockWith is [] for open workspaces and for locked ones that open without asking.
 *   - unlockWorkspaces() lists workspaces that were already open (or open without asking) in
 *     `unlocked`, so every id ends up in exactly one of the two lists.
 *   - AI memory vector functions need the workspace to be open, like every other workspace data.
 *   - workspaceStats().size is in MB with two decimals, as DatabaseManager returns it today.
 *   - copyProfiles keeps profile ids (an existing profile with the same id is replaced), copies the
 *     SSH keys they reference, and with includeRunbooks copies all runbooks of the source workspace.
 *   - deleteSshKey clears keyId on profiles that used the key.
 *   - setMasterPassword / createRecoveryCode / setWorkspacePassword without a `current` they need
 *     fail with needs_password (the UI then asks for it).
 *   - unlockWorkspace() on a workspace that is already open (or opens without asking) resolves
 *     without checking the password.
 *   - Exporting without the MAIN workspace: the first chosen workspace without its own password
 *     becomes MAIN; if every chosen one has a password, an empty "default" MAIN is added.
 *   - ProfileInput.group is ignored: send groupName.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

if (process.type === 'renderer') {
  throw new Error('[store:internal] getssh-store is main-process only; the renderer must go through IPC');
}

const scryptAsync = promisify(crypto.scrypt);

// ─────────────────────────────────────── constants ───────────────────────────────────────

const ERROR_CODES = new Set([
  'not_configured', 'locked', 'needs_password', 'wrong_password', 'rate_limited',
  'not_found', 'invalid_argument', 'corrupt', 'unavailable', 'cancelled', 'io',
  'busy', 'rotation_pending', 'must_change_master_password', 'internal',
]);
const MIN_MASTER_PASSWORD = 12;
const MIN_WORKSPACE_PASSWORD = 8;
const MIN_EXPORT_PASSWORD = 12;
const MAX_PASSWORD_BYTES = 1024;
const FREE_PASSWORD_FAILURES = 5;
const PASSWORD_LOCKOUT_MS = 30_000;
const REVEAL_WINDOW_MS = 5 * 60_000;
const MAX_MEMORY_ROWS = 2000;
const MAX_MEMORY_IDS = 32;
const DEFAULT_AUDIT_LIMIT = 50;
const LOCK_REASONS = new Set(['manual', 'idle', 'screen-locked', 'sleep']);
const PRESENCE_RESULTS = new Set(['ok', 'cancelled', 'unsupported']);
const PROTOCOLS = new Set(['ssh', 'local', 'telnet', 'auto']);
const AUTH_TYPES = new Set(['password', 'key', 'agent']);
const MEMORY_ROLES = new Set(['user', 'assistant']);
const REVEAL_FIELDS = new Set(['password', 'passphrase']);
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const MAX_WORKSPACE_ID_LENGTH = 128;
const WORKSPACE_ID_FORBIDDEN = /[/\\:*?"<>|\u0000-\u001f\u007f-\u009f]/;
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/is;
const BUNDLE_MAGIC = Buffer.from('GETSSHBK', 'latin1');
const BUNDLE_FORMAT_VERSION = 1;
const BUNDLE_KDF = { name: 'scrypt', N: 1 << 14, r: 8, p: 1 };
const FAKE_APP_VERSION = '3.0.0-fake';
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CROCKFORD_VALUES = new Map([...CROCKFORD].map((symbol, value) => [symbol, value]));
const OPENSSH_MAGIC = Buffer.from('openssh-key-v1\0', 'latin1');
const EC_CURVES = { 'P-256': 'nistp256', 'P-384': 'nistp384', 'P-521': 'nistp521' };

// ─────────────────────────────────────── errors ───────────────────────────────────────

function storeError(code, detail) {
  return new Error(`[store:${ERROR_CODES.has(code) ? code : 'internal'}] ${detail}`);
}

function fail(code, detail) {
  throw storeError(code, detail);
}

function errorCode(error) {
  const match = error instanceof Error ? /^\[store:([a-z_]+)\] /.exec(error.message) : null;
  return match ? match[1] : 'internal';
}

// ─────────────────────────────────────── state ───────────────────────────────────────

let clockOffset = 0;
let presenceResult = 'ok';
let presencePrompts = 0;
let latencyMs = 0;
let rowSeq = 0;
let pendingEnvSeed = null;
let S = emptyState();

function now() {
  return Date.now() + clockOffset;
}

function nextSeq() {
  rowSeq += 1;
  return rowSeq;
}

function emptyState() {
  return {
    configured: false,
    baseDir: null,
    appVersion: FAKE_APP_VERSION,
    replaced: false,
    started: false,
    startReport: null,
    master: null, // { password } in NFC
    weakMasterSeen: false,
    phase: 'ready', // only meaningful while a master password exists
    unlockedBy: null, // 'password' | 'presence' | 'recoveryCode'
    presenceEnabled: false,
    recovery: null, // { digest }
    lastLockReason: null,
    workspaces: [],
    globalSettings: new Map(),
    appSecrets: new Map(),
    memoryVectors: [],
    rate: new Map(), // scope -> { failures, retryAt }
    reveal: new Map(), // workspaceId -> expiresAt
  };
}

async function pause() {
  if (latencyMs > 0) await new Promise(resolve => setTimeout(resolve, latencyMs));
}

// ─────────────────────────────────────── validation ───────────────────────────────────────

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value);
}

function text(value, what) {
  if (typeof value !== 'string') fail('invalid_argument', `${what} must be a string`);
  return value;
}

function rowId(value, what) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || CONTROL_CHARS.test(value)) {
    fail('invalid_argument', `${what} must be a non-empty string without control characters`);
  }
  return value;
}

function displayName(value, what) {
  if (typeof value !== 'string' || !value.trim() || value.length > 128 || CONTROL_CHARS.test(value)) {
    fail('invalid_argument', `${what} must have 1 to 128 characters and no control characters`);
  }
  return value;
}

function nullableText(value, what) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') fail('invalid_argument', `${what} must be a string or null`);
  return value || null;
}

function finiteNumber(value, what) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail('invalid_argument', `${what} must be a finite number`);
  return value;
}

function stringList(value, what) {
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
    fail('invalid_argument', `${what} must be an array of strings`);
  }
  return value;
}

function boundedLimit(limit) {
  return Math.max(1, Math.min(Math.trunc(finiteNumber(limit, 'limit')), MAX_MEMORY_ROWS));
}

function absolutePath(value, what) {
  if (typeof value !== 'string' || !value || value.includes('\0') || !path.isAbsolute(value)) {
    fail('invalid_argument', `${what} must be an absolute path`);
  }
  return path.resolve(value);
}

/** Same rule as electron/main/utils/workspaceId.ts: ids double as file names. */
function isValidWorkspaceId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= MAX_WORKSPACE_ID_LENGTH && id === id.trim() &&
    !id.startsWith('.') && !id.endsWith('.') && !WORKSPACE_ID_FORBIDDEN.test(id) && !WINDOWS_RESERVED_NAMES.test(id);
}

function routeKind(route, allowed) {
  const keys = isPlainObject(route) ? Object.keys(route).filter(key => route[key] !== undefined) : [];
  if (keys.length !== 1 || !allowed.includes(keys[0]) || typeof route[keys[0]] !== 'string') {
    fail('invalid_argument', `route must be one of ${allowed.map(key => `{ ${key}: string }`).join(', ')}`);
  }
  return keys[0];
}

// ─────────────────────────────────────── passwords ───────────────────────────────────────

function charCount(value) {
  return [...value].length;
}

function normalizePassword(value, what) {
  if (typeof value !== 'string') fail('invalid_argument', `${what} must be a string`);
  const normalized = value.normalize('NFC');
  if (Buffer.byteLength(normalized, 'utf8') > MAX_PASSWORD_BYTES) {
    fail('invalid_argument', `${what} is longer than ${MAX_PASSWORD_BYTES} bytes`);
  }
  return normalized;
}

function newPassword(value, min, what) {
  const normalized = normalizePassword(value, what);
  if (charCount(normalized) < min) fail('invalid_argument', `${what} needs at least ${min} characters`);
  return normalized;
}

function secretsEqual(a, b) {
  const digest = value => crypto.createHash('sha256').update(value, 'utf8').digest();
  return crypto.timingSafeEqual(digest(a), digest(b));
}

/** Checks a password for a scope ('app' or 'ws:<id>') with the rate limit; false when wrong. */
function checkPassword(scope, expected, given) {
  const entry = S.rate.get(scope);
  if (entry && entry.retryAt !== null && entry.retryAt > now()) {
    fail('rate_limited', `${entry.retryAt - now()} ms until the next password attempt`);
  }
  const ok = expected !== null && secretsEqual(expected, given);
  if (ok) {
    S.rate.delete(scope);
  } else {
    const next = entry ?? { failures: 0, retryAt: null };
    next.failures += 1;
    if (next.failures >= FREE_PASSWORD_FAILURES) next.retryAt = now() + PASSWORD_LOCKOUT_MS;
    S.rate.set(scope, next);
  }
  return ok;
}

function requirePassword(scope, expected, given, what) {
  if (!checkPassword(scope, expected, normalizePassword(given, what))) fail('wrong_password', `wrong ${what}`);
}

/** One simulated Touch ID / Windows Hello prompt. `enabled` false: this route has no presence. */
function askPresence(reason, enabled) {
  if (typeof reason !== 'string') fail('invalid_argument', 'reason must be a string');
  if (presenceResult === 'unsupported') fail('unavailable', 'Touch ID / Windows Hello is not available on this computer');
  if (!enabled) fail('needs_password', 'Touch ID / Windows Hello is not enabled for this; use the password');
  presencePrompts += 1;
  if (presenceResult === 'cancelled') fail('cancelled', 'the Touch ID / Windows Hello prompt was cancelled');
}

// ─────────────────────────────────────── recovery codes ───────────────────────────────────────
// Same format as getssh-keystore/src/recovery.rs: 16 random bytes + 4 checksum bytes as 32
// Crockford base32 symbols in groups of four.

function recoveryChecksum(entropy) {
  return crypto.createHash('sha256').update('getssh-recovery/v1/checksum').update(entropy).digest().subarray(0, 4);
}

function formatRecoveryCode(entropy) {
  const raw = Buffer.concat([entropy, recoveryChecksum(entropy)]);
  let acc = 0;
  let bits = 0;
  let written = 0;
  let out = '';
  for (const byte of raw) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      if (written > 0 && written % 4 === 0) out += '-';
      out += CROCKFORD[(acc >> bits) & 31];
      written += 1;
    }
    acc &= (1 << bits) - 1;
  }
  return out;
}

/** Accepts any case, dashes and spaces, and O→0, I/L→1, like the Rust parser. Returns the entropy or null. */
function parseRecoveryCode(input) {
  if (typeof input !== 'string') return null;
  const values = [];
  for (const ch of input) {
    if (ch === '-' || /\s/u.test(ch)) continue;
    let symbol = ch >= 'a' && ch <= 'z' ? ch.toUpperCase() : ch;
    if (symbol === 'O') symbol = '0';
    else if (symbol === 'I' || symbol === 'L') symbol = '1';
    const value = CROCKFORD_VALUES.get(symbol);
    if (value === undefined) return null;
    values.push(value);
    if (values.length > 32) return null;
  }
  if (values.length !== 32) return null;
  const raw = Buffer.alloc(20);
  let acc = 0;
  let bits = 0;
  let pos = 0;
  for (const value of values) {
    acc = (acc << 5) | value;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      raw[pos] = (acc >> bits) & 0xff;
      pos += 1;
    }
    acc &= (1 << bits) - 1;
  }
  const entropy = Buffer.from(raw.subarray(0, 16));
  return crypto.timingSafeEqual(recoveryChecksum(entropy), raw.subarray(16)) ? entropy : null;
}

function recoveryDigest(entropy) {
  return crypto.createHash('sha256').update('getssh-fake-recovery/v1').update(entropy).digest('hex');
}

// ─────────────────────────────────────── gates ───────────────────────────────────────

function requireConfigured() {
  if (S.replaced) fail('unavailable', 'the data was replaced by an import; restart GETSSH');
  if (!S.configured) fail('not_configured', 'call configure(baseDir) first');
}

function requireStarted() {
  requireConfigured();
  if (!S.started) fail('not_configured', 'call start() first');
}

function appOpen() {
  return S.started && (!S.master || S.phase === 'ready');
}

function requireAppOpen() {
  requireStarted();
  if (!appOpen()) fail('locked', 'GETSSH is locked; unlock it with the master password first');
}

function lookupWorkspace(id) {
  if (typeof id !== 'string' || id.length === 0) fail('invalid_argument', 'workspace id must be a non-empty string');
  const ws = S.workspaces.find(entry => entry.id === id);
  if (!ws) fail('not_found', `workspace "${id}" does not exist`);
  return ws;
}

function requireWorkspace(id) {
  requireAppOpen();
  return lookupWorkspace(id);
}

function requireOpenWorkspace(id) {
  const ws = requireWorkspace(id);
  if (!ws.open) fail('locked', `workspace "${id}" is locked`);
  return ws;
}

function mustChangeMaster() {
  return Boolean(S.master) && appOpen() && S.weakMasterSeen;
}

// ─────────────────────────────────────── rows ───────────────────────────────────────

function workspaceRecord({ id, name, themeColor = null, is_main = false, password = null, presenceEnabled = false, preferences = '{}' }) {
  const t = now();
  return {
    id, name, themeColor, is_main, password, presenceEnabled, presencePending: false, preferences,
    created_at: t, updated_at: t, open: false,
    profiles: [], folders: new Map(), runbooks: [], sessions: [], messages: [], auditLogs: [], sshKeys: [],
  };
}

function sortedWorkspaces() {
  return [...S.workspaces].sort((a, b) => a.created_at - b.created_at);
}

function workspacePresence(ws) {
  return S.master ? S.presenceEnabled : ws.password !== null && ws.presenceEnabled;
}

function workspaceRow(ws) {
  return {
    id: ws.id,
    name: ws.name,
    themeColor: ws.themeColor,
    is_main: ws.is_main,
    hasPassword: ws.password !== null,
    presenceEnabled: workspacePresence(ws),
    state: ws.open ? 'open' : 'locked',
    preferences: ws.preferences,
    created_at: ws.created_at,
    updated_at: ws.updated_at,
  };
}

function opensQuietly(ws) {
  return appOpen() && ws.password === null;
}

function openQuietWorkspaces() {
  for (const ws of S.workspaces) if (opensQuietly(ws)) ws.open = true;
}

function profileRow(ws, p) {
  return {
    id: p.id,
    workspace_id: ws.id,
    host: p.host,
    username: p.username,
    port: p.port,
    protocol: p.protocol,
    authType: p.authType,
    alias: p.alias,
    osType: p.osType,
    groupName: p.groupName,
    group: p.groupName,
    autoStart: p.autoStart,
    useKeepAlive: p.useKeepAlive,
    strictHostKeyChecking: p.strictHostKeyChecking,
    proxyJump: p.proxyJump,
    initialDirectory: p.initialDirectory,
    postConnectScript: p.postConnectScript,
    themeOverride: p.themeOverride,
    keyId: p.keyId,
    privateKeyPath: p.privateKeyPath,
    hasPassword: p.password !== null,
    hasPassphrase: p.passphrase !== null,
  };
}

function secretInput(value, previous, what) {
  if (value === undefined) return previous;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') fail('invalid_argument', `${what} must be a string, null or undefined`);
  return value;
}

function profileRecord(ws, input, previous) {
  if (!isPlainObject(input)) fail('invalid_argument', 'each profile must be an object');
  const id = rowId(input.id, 'profile id');
  const before = previous.get(id);
  const port = input.port ?? 22;
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail('invalid_argument', `profile "${id}": port must be an integer from 0 to 65535`);
  const protocol = input.protocol ?? 'ssh';
  if (!PROTOCOLS.has(protocol)) fail('invalid_argument', `profile "${id}": unknown protocol`);
  const authType = input.authType ?? 'password';
  if (!AUTH_TYPES.has(authType)) fail('invalid_argument', `profile "${id}": unknown authType`);
  const keyId = nullableText(input.keyId, 'keyId');
  if (keyId !== null && !ws.sshKeys.some(key => key.id === keyId)) {
    fail('invalid_argument', `profile "${id}": keyId is not an SSH key of this workspace`);
  }
  return {
    id,
    host: text(input.host, `profile "${id}": host`),
    username: text(input.username, `profile "${id}": username`),
    port,
    protocol,
    authType,
    alias: nullableText(input.alias, 'alias'),
    osType: nullableText(input.osType, 'osType'),
    groupName: nullableText(input.groupName, 'groupName'),
    autoStart: Boolean(input.autoStart),
    useKeepAlive: !(input.useKeepAlive === false || input.useKeepAlive === 0),
    strictHostKeyChecking: Boolean(input.strictHostKeyChecking),
    proxyJump: nullableText(input.proxyJump, 'proxyJump'),
    initialDirectory: nullableText(input.initialDirectory, 'initialDirectory'),
    postConnectScript: nullableText(input.postConnectScript, 'postConnectScript'),
    themeOverride: nullableText(input.themeOverride, 'themeOverride'),
    keyId,
    privateKeyPath: nullableText(input.privateKeyPath, 'privateKeyPath'),
    password: secretInput(input.password, before ? before.password : null, 'password'),
    passphrase: secretInput(input.passphrase, before ? before.passphrase : null, 'passphrase'),
  };
}

function buildProfiles(ws, inputs) {
  if (!Array.isArray(inputs)) fail('invalid_argument', 'profiles must be an array');
  const previous = new Map(ws.profiles.map(p => [p.id, p]));
  const seen = new Set();
  return inputs.map(input => {
    const record = profileRecord(ws, input, previous);
    if (seen.has(record.id)) fail('invalid_argument', `duplicate profile id "${record.id}"`);
    seen.add(record.id);
    return record;
  });
}

function sshKeyRow(key) {
  return {
    id: key.id,
    name: key.name,
    algorithm: key.algorithm,
    fingerprint: key.fingerprint,
    publicKey: key.publicKey,
    hasPassphrase: key.hasPassphrase,
    created_at: key.created_at,
  };
}

function runbookRow(ws, rb) {
  return { id: rb.id, workspace_id: ws.id, title: rb.title, script: rb.script, riskLevel: rb.riskLevel, created_at: rb.created_at };
}

function messageRow(m) {
  return { id: m.id, session_id: m.session_id, role: m.role, content: m.content, raw_content: m.raw_content, timestamp: m.timestamp };
}

function memoryMessageRow(m) {
  return { id: m.id, session_id: m.session_id, role: m.role, content: m.content, timestamp: m.timestamp };
}

function vectorRow(v) {
  return {
    workspace_id: v.workspace_id,
    message_id: v.message_id,
    session_id: v.session_id,
    role: v.role,
    embedding: Buffer.from(v.embedding),
    dimensions: v.dimensions,
    content_hash: v.content_hash,
    timestamp: v.timestamp,
  };
}

function newestFirst(a, b, field) {
  return b[field] - a[field] || b.seq - a.seq;
}

// ─────────────────────────────── lifecycle and app lock ───────────────────────────────

function configure(baseDir, appVersion) {
  const dir = absolutePath(baseDir, 'baseDir');
  if (appVersion !== undefined && typeof appVersion !== 'string') fail('invalid_argument', 'appVersion must be a string');
  if (S.configured) {
    if (dir === S.baseDir) return;
    if (S.started) fail('busy', 'the store already runs on another directory');
  }
  S.configured = true;
  S.baseDir = dir;
  if (appVersion) S.appVersion = appVersion.slice(0, 64);
  if (pendingEnvSeed) {
    const file = pendingEnvSeed;
    pendingEnvSeed = null;
    let options;
    try {
      options = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      fail('invalid_argument', `GETSSH_FAKE_STORE_SEED could not be read: ${error.message}`);
    }
    seed(options);
  }
}

/**
 * Same checks as LegacySecrets::validate in legacy.rs. `legacy` itself may be null or undefined;
 * its fields may be left out but not null (the real module refuses null there too).
 */
function checkLegacySecrets(legacy) {
  if (legacy === undefined || legacy === null) return;
  if (!isPlainObject(legacy)) fail('invalid_argument', 'legacy must be an object');
  const { appKey, workspacePasswords } = legacy;
  if (appKey !== undefined && (typeof appKey !== 'string' || !/^[0-9a-f]{64}$/i.test(appKey))) {
    fail('invalid_argument', 'appKey must be 64 hex characters');
  }
  if (workspacePasswords === undefined) return;
  if (!isPlainObject(workspacePasswords)) fail('invalid_argument', 'workspacePasswords must be an object');
  // An entry the store cannot use (an invalid id, an empty password) is left out, not refused.
  for (const password of Object.values(workspacePasswords)) {
    if (typeof password !== 'string') fail('invalid_argument', 'workspacePasswords values must be strings');
  }
}

function needsLegacyMigration() {
  requireConfigured();
  return false;
}

async function start(legacy) {
  await pause();
  requireConfigured();
  checkLegacySecrets(legacy);
  const report = { migratedWorkspaces: [], deferredWorkspaces: [], presenceToReenable: [], failedWorkspaces: [] };
  if (S.started) return report;
  if (S.workspaces.length === 0) {
    S.workspaces.push(workspaceRecord({ id: 'default', name: 'Default Workspace', is_main: true }));
  }
  S.started = true;
  S.phase = S.master ? 'locked' : 'ready';
  S.unlockedBy = null;
  for (const ws of S.workspaces) ws.open = !S.master && ws.password === null;
  const seeded = S.startReport ?? {};
  S.startReport = null;
  for (const key of Object.keys(report)) if (Array.isArray(seeded[key])) report[key] = [...seeded[key]];
  return report;
}

function appState() {
  if (!S.replaced) requireConfigured();
  const backend = process.platform === 'darwin' ? 'secure-enclave' : process.platform === 'win32' ? 'tpm' : 'unsupported';
  return {
    phase: !S.replaced && appOpen() ? 'ready' : 'locked',
    masterPassword: Boolean(S.master),
    masterPasswordMustChange: mustChangeMaster(),
    presenceSupported: presenceResult !== 'unsupported',
    presenceEnabled: S.presenceEnabled,
    recoveryConfigured: Boolean(S.recovery),
    deviceKeyLost: false,
    deviceBackend: backend,
  };
}

async function unlockApp(route) {
  await pause();
  requireStarted();
  const kind = routeKind(route, ['password', 'presence', 'recoveryCode']);
  const recoveryEntropy = kind === 'recoveryCode' ? parseRecoveryCode(route.recoveryCode) : null;
  if (kind === 'recoveryCode' && !recoveryEntropy) fail('invalid_argument', 'the recovery code is not well formed');
  if (appOpen()) return appState();
  if (kind === 'password') {
    requirePassword('app', S.master.password, route.password, 'master password');
    if (charCount(S.master.password) < MIN_MASTER_PASSWORD) S.weakMasterSeen = true;
  } else if (kind === 'presence') {
    askPresence(route.presence, S.presenceEnabled);
  } else {
    const digest = recoveryDigest(recoveryEntropy);
    if (!checkPassword('app', S.recovery ? S.recovery.digest : null, digest)) {
      fail('wrong_password', 'this recovery code does not open GETSSH');
    }
  }
  S.phase = 'ready';
  S.unlockedBy = kind;
  openQuietWorkspaces();
  return appState();
}

function lockApp(reason) {
  requireStarted();
  if (!LOCK_REASONS.has(reason)) fail('invalid_argument', `reason must be one of ${[...LOCK_REASONS].join(', ')}`);
  S.lastLockReason = reason;
  S.reveal.clear();
  if (S.master) {
    S.phase = 'locked';
    S.unlockedBy = null;
    for (const ws of S.workspaces) ws.open = false;
  } else {
    for (const ws of S.workspaces) if (ws.password !== null) ws.open = false;
  }
}

// ───────────────────────── master password, presence, recovery ─────────────────────────

async function setMasterPassword(password, current) {
  await pause();
  requireAppOpen();
  const next = newPassword(password, MIN_MASTER_PASSWORD, 'master password');
  if (current !== undefined && current !== null && typeof current !== 'string') fail('invalid_argument', 'current must be a string');
  if (S.master) {
    if (current === undefined || current === null) {
      if (mustChangeMaster()) fail('must_change_master_password', 'confirm the current master password to replace it');
      if (S.unlockedBy !== 'recoveryCode') fail('needs_password', '`current` is required to change the master password');
    } else {
      requirePassword('app', S.master.password, current, 'master password');
    }
    S.master = { password: next };
    S.weakMasterSeen = false;
    S.unlockedBy = 'password';
    return { recoveryReset: false };
  }
  const locked = S.workspaces.filter(ws => ws.password !== null && !ws.open);
  if (locked.length) fail('locked', `unlock ${locked.map(ws => `"${ws.id}"`).join(', ')} first`);
  for (const ws of S.workspaces) {
    ws.password = null;
    ws.presenceEnabled = false;
    ws.presencePending = false;
    S.rate.delete(`ws:${ws.id}`);
  }
  const recoveryReset = S.recovery !== null;
  S.recovery = null;
  S.master = { password: next };
  S.weakMasterSeen = false;
  S.phase = 'ready';
  S.unlockedBy = 'password';
  openQuietWorkspaces();
  return { recoveryReset };
}

async function removeMasterPassword(current) {
  await pause();
  requireAppOpen();
  if (!S.master) fail('invalid_argument', 'no master password is set');
  requirePassword('app', S.master.password, current, 'master password');
  S.master = null;
  S.weakMasterSeen = false;
  S.presenceEnabled = false;
  S.phase = 'ready';
  S.unlockedBy = null;
}

async function setPresence(enabled, reason) {
  await pause();
  requireAppOpen();
  if (typeof enabled !== 'boolean') fail('invalid_argument', 'enabled must be a boolean');
  if (typeof reason !== 'string') fail('invalid_argument', 'reason must be a string');
  if (!enabled) {
    S.presenceEnabled = false;
    for (const ws of S.workspaces) {
      ws.presenceEnabled = false;
      ws.presencePending = false;
    }
    return;
  }
  askPresence(reason, true);
  S.presenceEnabled = true;
  for (const ws of S.workspaces) {
    if (ws.password === null) continue;
    if (ws.open) ws.presenceEnabled = true;
    else ws.presencePending = true; // its key is not in memory: enabled on its next unlock
  }
}

async function createRecoveryCode(current) {
  await pause();
  requireAppOpen();
  if (S.master) {
    if (current === undefined || current === null) fail('needs_password', '`current` (the master password) is required');
    requirePassword('app', S.master.password, current, 'master password');
  }
  const entropy = crypto.randomBytes(16);
  S.recovery = { digest: recoveryDigest(entropy) };
  return formatRecoveryCode(entropy);
}

async function removeRecoveryCode() {
  await pause();
  requireAppOpen();
  S.recovery = null;
}

function isRecoveryCodeWellFormed(code) {
  requireConfigured();
  return parseRecoveryCode(code) !== null;
}

async function verifyPresence(reason) {
  await pause();
  requireStarted();
  try {
    askPresence(reason, true);
    return true;
  } catch (error) {
    if (errorCode(error) === 'cancelled') return false;
    throw error;
  }
}

async function verifyPassword(password, workspaceId) {
  await pause();
  requireAppOpen();
  const given = normalizePassword(password, 'password');
  if (workspaceId === undefined || workspaceId === null) {
    if (!S.master) fail('invalid_argument', 'no master password is set');
    return checkPassword('app', S.master.password, given);
  }
  const ws = lookupWorkspace(workspaceId);
  if (S.master) return checkPassword('app', S.master.password, given);
  if (ws.password === null) fail('invalid_argument', `workspace "${ws.id}" has no password; use verifyPresence`);
  return checkPassword(`ws:${ws.id}`, ws.password, given);
}

// ──────────────────────────────────── workspaces ────────────────────────────────────

function listWorkspaces() {
  requireAppOpen();
  return sortedWorkspaces().map(workspaceRow);
}

async function createWorkspace(input) {
  await pause();
  requireAppOpen();
  if (!isPlainObject(input)) fail('invalid_argument', 'input must be an object');
  const name = displayName(input.name, 'name');
  const id = input.id === undefined ? crypto.randomUUID() : input.id;
  if (!isValidWorkspaceId(id)) fail('invalid_argument', 'invalid workspace id');
  if (S.workspaces.some(ws => ws.id === id)) fail('invalid_argument', `workspace "${id}" already exists`);
  let password = null;
  if (input.password !== undefined && input.password !== null) {
    if (S.master) fail('invalid_argument', 'a workspace cannot have its own password while a master password is set');
    password = newPassword(input.password, MIN_WORKSPACE_PASSWORD, 'workspace password');
  }
  const ws = workspaceRecord({
    id,
    name,
    themeColor: nullableText(input.themeColor, 'themeColor'),
    password,
    presenceEnabled: password !== null && S.presenceEnabled,
  });
  ws.open = true;
  S.workspaces.push(ws);
  return workspaceRow(ws);
}

function updateWorkspace(id, changes) {
  const ws = requireWorkspace(id);
  if (!isPlainObject(changes)) fail('invalid_argument', 'changes must be an object');
  const name = changes.name === undefined ? ws.name : displayName(changes.name, 'name');
  const themeColor = changes.themeColor === undefined ? ws.themeColor : nullableText(changes.themeColor, 'themeColor');
  let preferences = ws.preferences;
  if (changes.preferences !== undefined) {
    preferences = text(changes.preferences, 'preferences');
    try {
      JSON.parse(preferences);
    } catch {
      fail('invalid_argument', 'preferences must be JSON text');
    }
  }
  Object.assign(ws, { name, themeColor, preferences, updated_at: now() });
  return workspaceRow(ws);
}

function setMainWorkspace(id) {
  const ws = requireWorkspace(id);
  if (ws.password !== null) fail('invalid_argument', 'the MAIN workspace cannot have its own password');
  for (const entry of S.workspaces) entry.is_main = entry === ws;
}

async function deleteWorkspace(id) {
  await pause();
  const ws = requireWorkspace(id);
  if (ws.is_main) fail('invalid_argument', 'the MAIN workspace cannot be deleted');
  S.workspaces = S.workspaces.filter(entry => entry !== ws);
  S.memoryVectors = S.memoryVectors.filter(v => v.workspace_id !== ws.id);
  S.reveal.delete(ws.id);
  S.rate.delete(`ws:${ws.id}`);
}

async function openWorkspace(id) {
  await pause();
  const ws = requireWorkspace(id);
  if (!ws.open && opensQuietly(ws)) ws.open = true;
  return ws.open ? 'open' : 'locked';
}

async function unlockWorkspace(id, route) {
  await pause();
  const ws = requireWorkspace(id);
  const kind = routeKind(route, ['password', 'presence']);
  if (ws.open) return;
  if (ws.password !== null) {
    if (kind === 'password') requirePassword(`ws:${ws.id}`, ws.password, route.password, 'workspace password');
    else askPresence(route.presence, ws.presenceEnabled);
  }
  ws.open = true;
  if (ws.presencePending) {
    ws.presenceEnabled = true;
    ws.presencePending = false;
  }
}

async function unlockWorkspaces(ids, reason) {
  await pause();
  requireAppOpen();
  stringList(ids, 'ids');
  if (typeof reason !== 'string') fail('invalid_argument', 'reason must be a string');
  const order = [...new Set(ids)];
  const outcome = new Map(); // id -> null (unlocked) | error code
  const viaPresence = [];
  for (const id of order) {
    const ws = S.workspaces.find(entry => entry.id === id);
    if (!ws) outcome.set(id, 'not_found');
    else if (ws.open || ws.password === null) {
      ws.open = true;
      outcome.set(id, null);
    } else if (!ws.presenceEnabled) outcome.set(id, 'needs_password');
    else viaPresence.push(ws);
  }
  if (viaPresence.length) {
    let code = null;
    try {
      askPresence(reason, true);
    } catch (error) {
      code = errorCode(error);
    }
    for (const ws of viaPresence) {
      if (code === null) ws.open = true;
      outcome.set(ws.id, code);
    }
  }
  const unlocked = [];
  const failed = [];
  for (const id of order) {
    const code = outcome.get(id);
    if (code === null) unlocked.push(id);
    else failed.push({ id, code });
  }
  return { unlocked, failed };
}

function lockWorkspace(id) {
  const ws = requireWorkspace(id);
  ws.open = false;
  S.reveal.delete(ws.id);
}

async function setWorkspacePassword(id, password, current) {
  await pause();
  const ws = requireWorkspace(id);
  if (S.master) fail('invalid_argument', 'workspace passwords are not available while a master password is set');
  if (ws.is_main) fail('invalid_argument', 'the MAIN workspace cannot have its own password');
  const next = newPassword(password, MIN_WORKSPACE_PASSWORD, 'workspace password');
  if (ws.password !== null) {
    if (current === undefined || current === null) fail('needs_password', '`current` is required to change a workspace password');
    requirePassword(`ws:${ws.id}`, ws.password, current, 'workspace password');
  } else {
    ws.presenceEnabled = S.presenceEnabled;
  }
  ws.password = next;
  ws.open = true;
  ws.updated_at = now();
}

async function removeWorkspacePassword(id, current) {
  await pause();
  const ws = requireWorkspace(id);
  if (ws.password === null) fail('invalid_argument', `workspace "${ws.id}" has no password`);
  requirePassword(`ws:${ws.id}`, ws.password, current, 'workspace password');
  ws.password = null;
  ws.presenceEnabled = false;
  ws.presencePending = false;
  ws.open = true;
  ws.updated_at = now();
}

function workspaceStats(id) {
  const ws = requireOpenWorkspace(id);
  const bytes = Buffer.byteLength(JSON.stringify(serializeWorkspace(ws)), 'utf8');
  let sizeMb = bytes / (1024 * 1024);
  if (sizeMb < 0.01 && (ws.profiles.length > 0 || ws.runbooks.length > 0)) sizeMb = 0.01;
  return { size: Number.parseFloat(sizeMb.toFixed(2)), profileCount: ws.profiles.length, runbookCount: ws.runbooks.length };
}

// ───────────────────────────── server profiles (no secrets) ─────────────────────────────

function listProfiles(workspaceId) {
  const ws = requireOpenWorkspace(workspaceId);
  return ws.profiles.map(p => profileRow(ws, p));
}

function saveProfiles(workspaceId, inputs) {
  const ws = requireOpenWorkspace(workspaceId);
  ws.profiles = buildProfiles(ws, inputs);
  return listProfiles(workspaceId);
}

function deleteProfiles(workspaceId, ids) {
  const ws = requireOpenWorkspace(workspaceId);
  const doomed = new Set(stringList(ids, 'ids'));
  ws.profiles = ws.profiles.filter(p => !doomed.has(p.id));
}

function copyProfiles(fromWorkspaceId, toWorkspaceId, ids, options) {
  const from = requireOpenWorkspace(fromWorkspaceId);
  const to = requireOpenWorkspace(toWorkspaceId);
  if (from === to) fail('invalid_argument', 'source and target workspace are the same');
  stringList(ids, 'ids');
  if (options !== undefined && options !== null && !isPlainObject(options)) fail('invalid_argument', 'options must be an object');
  const picked = [...new Set(ids)].map(id => {
    const profile = from.profiles.find(p => p.id === id);
    if (!profile) fail('not_found', `profile "${id}" does not exist in workspace "${from.id}"`);
    return profile;
  });
  for (const profile of picked) {
    if (profile.keyId && !to.sshKeys.some(key => key.id === profile.keyId)) {
      const key = from.sshKeys.find(entry => entry.id === profile.keyId);
      if (key) to.sshKeys.push({ ...key, privateKey: Buffer.from(key.privateKey) });
    }
    const copy = { ...profile };
    const index = to.profiles.findIndex(p => p.id === profile.id);
    if (index >= 0) to.profiles[index] = copy;
    else to.profiles.push(copy);
  }
  if (options && options.includeRunbooks === true) {
    for (const rb of from.runbooks) {
      const index = to.runbooks.findIndex(entry => entry.id === rb.id);
      if (index >= 0) to.runbooks[index] = { ...rb };
      else to.runbooks.push({ ...rb });
    }
  }
}

// ─────────────────────────── secrets (main process only) ───────────────────────────

function connectSecrets(workspaceId, profileId) {
  const ws = requireOpenWorkspace(workspaceId);
  const profile = ws.profiles.find(p => p.id === profileId);
  if (!profile) fail('not_found', `profile "${profileId}" does not exist`);
  const secrets = {};
  if (profile.password !== null) secrets.password = Buffer.from(profile.password, 'utf8');
  let passphrase = profile.passphrase;
  if (profile.keyId) {
    const key = ws.sshKeys.find(entry => entry.id === profile.keyId);
    if (!key) fail('not_found', `SSH key "${profile.keyId}" does not exist`);
    secrets.privateKey = Buffer.from(key.privateKey);
    if (passphrase === null && key.passphrase !== null) passphrase = key.passphrase;
  } else if (profile.privateKeyPath) {
    const keyPath = profile.privateKeyPath.replace(/^~/, os.homedir());
    try {
      secrets.privateKey = fs.readFileSync(keyPath);
    } catch (error) {
      fail('io', `cannot read the private key file (${error.code || error.message})`);
    }
  }
  if (passphrase !== null) secrets.passphrase = Buffer.from(passphrase, 'utf8');
  return secrets;
}

async function openReveal(workspaceId, route) {
  await pause();
  const ws = requireOpenWorkspace(workspaceId);
  const kind = routeKind(route, ['presence', 'password']);
  if (kind === 'presence') {
    askPresence(route.presence, true);
  } else if (S.master) {
    requirePassword('app', S.master.password, route.password, 'master password');
  } else if (ws.password !== null) {
    requirePassword(`ws:${ws.id}`, ws.password, route.password, 'workspace password');
  } else {
    fail('invalid_argument', `workspace "${ws.id}" has no password; use { presence }`);
  }
  S.reveal.set(ws.id, now() + REVEAL_WINDOW_MS);
}

function revealSecret(workspaceId, profileId, field) {
  const ws = requireOpenWorkspace(workspaceId);
  if (!REVEAL_FIELDS.has(field)) fail('invalid_argument', "field must be 'password' or 'passphrase'");
  const expiresAt = S.reveal.get(ws.id);
  if (expiresAt === undefined || expiresAt <= now()) {
    S.reveal.delete(ws.id);
    fail('locked', 'no reveal window is open for this workspace; call openReveal first');
  }
  const profile = ws.profiles.find(p => p.id === profileId);
  if (!profile) fail('not_found', `profile "${profileId}" does not exist`);
  if (profile[field] === null) fail('not_found', `profile "${profileId}" has no ${field}`);
  S.reveal.set(ws.id, now() + REVEAL_WINDOW_MS);
  return profile[field];
}

function closeReveal(workspaceId) {
  requireStarted();
  if (typeof workspaceId !== 'string') fail('invalid_argument', 'workspace id must be a string');
  S.reveal.delete(workspaceId);
}

function secretName(name) {
  if (typeof name !== 'string' || !name || name.length > 256 || CONTROL_CHARS.test(name)) {
    fail('invalid_argument', 'secret name must have 1 to 256 characters and no control characters');
  }
  return name;
}

function setAppSecret(name, value) {
  requireAppOpen();
  secretName(name);
  if (value === null) {
    S.appSecrets.delete(name);
    return;
  }
  S.appSecrets.set(name, text(value, 'value'));
}

function getAppSecret(name) {
  requireAppOpen();
  secretName(name);
  return S.appSecrets.has(name) ? Buffer.from(S.appSecrets.get(name), 'utf8') : null;
}

function listAppSecretNames(prefix) {
  requireAppOpen();
  if (prefix !== undefined && prefix !== null && typeof prefix !== 'string') fail('invalid_argument', 'prefix must be a string');
  return [...S.appSecrets.keys()].filter(name => !prefix || name.startsWith(prefix)).sort();
}

// ───────────────────────────────── SSH keys ─────────────────────────────────

function sshString(value) {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  return Buffer.concat([length, body]);
}

function sshMpint(bytes) {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
  let value = bytes.subarray(start);
  if (value[0] & 0x80) value = Buffer.concat([Buffer.from([0]), value]);
  return sshString(value);
}

function uint32(value) {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value);
  return out;
}

function sshReader(buffer) {
  let offset = 0;
  const u32 = () => {
    if (offset + 4 > buffer.length) throw new RangeError('truncated');
    const value = buffer.readUInt32BE(offset);
    offset += 4;
    return value;
  };
  const string = () => {
    const length = u32();
    if (offset + length > buffer.length) throw new RangeError('truncated');
    const value = buffer.subarray(offset, offset + length);
    offset += length;
    return value;
  };
  return { u32, string };
}

function bitLength(bytes) {
  let start = 0;
  while (start < bytes.length && bytes[start] === 0) start += 1;
  if (start === bytes.length) return 0;
  return (bytes.length - start - 1) * 8 + (32 - Math.clz32(bytes[start]));
}

function describePublicBlob(blob) {
  let type;
  let algorithm;
  try {
    const reader = sshReader(blob);
    type = reader.string().toString('latin1');
    if (type === 'ssh-ed25519') {
      if (reader.string().length !== 32) throw new RangeError('ed25519 key length');
      algorithm = 'ed25519';
    } else if (type === 'ssh-rsa') {
      reader.string();
      algorithm = `rsa-${bitLength(reader.string())}`;
    } else if (type.startsWith('ecdsa-sha2-nistp')) {
      algorithm = `ecdsa-p${type.slice('ecdsa-sha2-nistp'.length)}`;
    } else if (type === 'ssh-dss') {
      algorithm = 'dsa';
    } else if (/^[a-z0-9@.-]+$/i.test(type)) {
      algorithm = type;
    } else {
      throw new RangeError('key type');
    }
  } catch {
    fail('invalid_argument', 'the public key inside this file is damaged');
  }
  return { type, algorithm };
}

function publicBlobFromKeyObject(publicKey) {
  const jwk = publicKey.export({ format: 'jwk' });
  const raw = value => Buffer.from(value, 'base64url');
  if (jwk.kty === 'OKP' && jwk.crv === 'Ed25519') return Buffer.concat([sshString('ssh-ed25519'), sshString(raw(jwk.x))]);
  if (jwk.kty === 'RSA') return Buffer.concat([sshString('ssh-rsa'), sshMpint(raw(jwk.e)), sshMpint(raw(jwk.n))]);
  if (jwk.kty === 'EC' && EC_CURVES[jwk.crv]) {
    const curve = EC_CURVES[jwk.crv];
    const point = Buffer.concat([Buffer.from([4]), raw(jwk.x), raw(jwk.y)]);
    return Buffer.concat([sshString(`ecdsa-sha2-${curve}`), sshString(curve), sshString(point)]);
  }
  return fail('invalid_argument', `unsupported key type ${jwk.kty}${jwk.crv ? ` ${jwk.crv}` : ''}`);
}

function parseOpenSshKey(source, passphrase) {
  const match = /-----BEGIN OPENSSH PRIVATE KEY-----([\s\S]*?)-----END OPENSSH PRIVATE KEY-----/.exec(source);
  if (!match) fail('invalid_argument', 'the OpenSSH private key has no END line');
  const raw = Buffer.from(match[1].replace(/\s+/g, ''), 'base64');
  let cipher;
  let blob;
  try {
    if (!raw.subarray(0, OPENSSH_MAGIC.length).equals(OPENSSH_MAGIC)) throw new RangeError('magic');
    const reader = sshReader(raw.subarray(OPENSSH_MAGIC.length));
    cipher = reader.string().toString('latin1');
    reader.string(); // kdf name
    reader.string(); // kdf options
    if (reader.u32() !== 1) throw new RangeError('key count');
    blob = Buffer.from(reader.string());
  } catch {
    fail('invalid_argument', 'the OpenSSH private key is damaged');
  }
  const encrypted = cipher !== 'none';
  if (encrypted && !passphrase) fail('needs_password', 'this key is protected by a passphrase');
  return { blob, encrypted };
}

function parsePuttyKey(source, passphrase) {
  const lines = source.split(/\r?\n/).map(line => line.trim());
  const encryption = lines.find(line => line.startsWith('Encryption:'))?.slice('Encryption:'.length).trim();
  const countAt = lines.findIndex(line => /^Public-Lines: \d+$/.test(line));
  if (!encryption || countAt < 0) fail('invalid_argument', 'the PuTTY key is damaged');
  const count = Number(lines[countAt].slice('Public-Lines:'.length));
  const blob = Buffer.from(lines.slice(countAt + 1, countAt + 1 + count).join(''), 'base64');
  if (blob.length === 0) fail('invalid_argument', 'the PuTTY key is damaged');
  const encrypted = encryption !== 'none';
  if (encrypted && !passphrase) fail('needs_password', 'this key is protected by a passphrase');
  return { blob, encrypted };
}

function parsePemKey(source, passphrase) {
  const encrypted = /ENCRYPTED/.test(source);
  if (encrypted && !passphrase) fail('needs_password', 'this key is protected by a passphrase');
  let privateKey;
  try {
    privateKey = crypto.createPrivateKey(encrypted ? { key: source, format: 'pem', passphrase } : { key: source, format: 'pem' });
  } catch {
    fail(encrypted ? 'wrong_password' : 'invalid_argument', encrypted ? 'wrong passphrase for this key' : 'the PEM private key is damaged');
  }
  return { blob: publicBlobFromKeyObject(crypto.createPublicKey(privateKey)), encrypted };
}

function parsePrivateKey(data, passphrase) {
  const source = data.toString('utf8');
  if (source.includes('-----BEGIN OPENSSH PRIVATE KEY-----')) return parseOpenSshKey(source, passphrase);
  if (/^PuTTY-User-Key-File-[23]:/m.test(source)) return parsePuttyKey(source, passphrase);
  if (/-----BEGIN (?:RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----/.test(source)) return parsePemKey(source, passphrase);
  return fail('invalid_argument', 'not an OpenSSH, PEM or PuTTY private key');
}

function sshKeyRecord(name, blob, encrypted, privateKey, passphrase) {
  const { type, algorithm } = describePublicBlob(blob);
  return {
    id: crypto.randomUUID(),
    name,
    algorithm,
    fingerprint: `SHA256:${crypto.createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`,
    publicKey: `${type} ${blob.toString('base64')} ${name}`,
    hasPassphrase: encrypted,
    created_at: now(),
    privateKey: Buffer.from(privateKey),
    passphrase: encrypted ? passphrase : null,
  };
}

/** A real, unencrypted OpenSSH ("openssh-key-v1") ed25519 private key. */
function generateEd25519(comment) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  const seedBytes = Buffer.from(privateKey.export({ format: 'jwk' }).d, 'base64url');
  const blob = Buffer.concat([sshString('ssh-ed25519'), sshString(pub)]);
  const check = crypto.randomBytes(4);
  const secretPart = Buffer.concat([
    check, check, sshString('ssh-ed25519'), sshString(pub), sshString(Buffer.concat([seedBytes, pub])), sshString(comment),
  ]);
  const padding = [];
  for (let i = 1; (secretPart.length + padding.length) % 8 !== 0; i += 1) padding.push(i);
  const body = Buffer.concat([
    OPENSSH_MAGIC, sshString('none'), sshString('none'), sshString(Buffer.alloc(0)), uint32(1),
    sshString(blob), sshString(Buffer.concat([secretPart, Buffer.from(padding)])),
  ]);
  seedBytes.fill(0);
  const lines = body.toString('base64').match(/.{1,70}/g).join('\n');
  return { blob, pem: Buffer.from(`-----BEGIN OPENSSH PRIVATE KEY-----\n${lines}\n-----END OPENSSH PRIVATE KEY-----\n`, 'utf8') };
}

function importSshKey(workspaceId, input) {
  const ws = requireOpenWorkspace(workspaceId);
  if (!isPlainObject(input)) fail('invalid_argument', 'input must be an object');
  const name = displayName(input.name, 'name');
  if (!(input.data instanceof Uint8Array) || input.data.length === 0) fail('invalid_argument', 'data must be a non-empty Buffer');
  const passphrase = input.passphrase === undefined || input.passphrase === null || input.passphrase === ''
    ? null : text(input.passphrase, 'passphrase');
  const data = Buffer.from(input.data);
  const { blob, encrypted } = parsePrivateKey(data, passphrase);
  const key = sshKeyRecord(name, blob, encrypted, data, passphrase);
  ws.sshKeys.push(key);
  return sshKeyRow(key);
}

function generateSshKey(workspaceId, input) {
  const ws = requireOpenWorkspace(workspaceId);
  if (!isPlainObject(input)) fail('invalid_argument', 'input must be an object');
  const name = displayName(input.name, 'name');
  if (input.algorithm !== 'ed25519') fail('invalid_argument', "algorithm must be 'ed25519'");
  const { blob, pem } = generateEd25519(name);
  const key = sshKeyRecord(name, blob, false, pem, null);
  ws.sshKeys.push(key);
  return sshKeyRow(key);
}

function listSshKeys(workspaceId) {
  const ws = requireOpenWorkspace(workspaceId);
  return [...ws.sshKeys].sort((a, b) => a.created_at - b.created_at).map(sshKeyRow);
}

function deleteSshKey(workspaceId, id) {
  const ws = requireOpenWorkspace(workspaceId);
  const key = ws.sshKeys.find(entry => entry.id === id);
  if (!key) fail('not_found', `SSH key "${id}" does not exist`);
  ws.sshKeys = ws.sshKeys.filter(entry => entry !== key);
  for (const profile of ws.profiles) if (profile.keyId === id) profile.keyId = null;
}

// ───────────────── other tables: one function per DatabaseManager method ─────────────────

function getGlobalSetting(key) {
  requireAppOpen();
  text(key, 'key');
  return S.globalSettings.has(key) ? S.globalSettings.get(key) : null;
}

function setGlobalSetting(key, value) {
  requireAppOpen();
  text(key, 'key');
  S.globalSettings.set(key, text(value, 'value'));
}

// Asset folders: a port of DatabaseManager (assertFolderPath, folderPaths and the four mutations).

function assertFolderPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 ||
      value.split('/').some(part => part.length > 128 || !part.trim() || part === '.' || part === '..' || CONTROL_CHARS.test(part))) {
    fail('invalid_argument', 'Invalid folder path');
  }
}

function assertFolderName(value) {
  if (typeof value !== 'string' || value.includes('/')) fail('invalid_argument', 'Invalid folder name');
  assertFolderPath(value);
}

function isFolderPath(value) {
  try {
    assertFolderPath(value);
    return true;
  } catch {
    return false;
  }
}

function folderPaths(ws) {
  const paths = new Set();
  const includeParents = folder => {
    const segments = folder.split('/');
    for (let i = 1; i <= segments.length; i += 1) paths.add(segments.slice(0, i).join('/'));
  };
  for (const folder of ws.folders.keys()) if (isFolderPath(folder)) includeParents(folder);
  for (const profile of ws.profiles) {
    if (profile.groupName !== null && isFolderPath(profile.groupName)) includeParents(profile.groupName);
  }
  return [...paths].sort((a, b) => a.localeCompare(b));
}

function folderSnapshot(ws, changedIds = []) {
  return {
    folders: folderPaths(ws),
    memberships: changedIds.map(id => ({ id, group: ws.profiles.find(p => p.id === id).groupName })),
  };
}

const insideFolder = (candidate, folder) => candidate === folder || candidate.startsWith(`${folder}/`);

function getAssetFolders(workspaceId) {
  return folderPaths(requireOpenWorkspace(workspaceId));
}

function createAssetFolder(workspaceId, folderPath) {
  requireStarted();
  assertFolderPath(folderPath);
  const ws = requireOpenWorkspace(workspaceId);
  const parts = folderPath.split('/');
  const t = now();
  for (let i = 1; i <= parts.length; i += 1) {
    const prefix = parts.slice(0, i).join('/');
    if (!ws.folders.has(prefix)) ws.folders.set(prefix, t);
  }
  return folderSnapshot(ws);
}

function renameAssetFolder(workspaceId, folderPath, newName) {
  requireStarted();
  assertFolderPath(folderPath);
  assertFolderName(newName);
  const ws = requireOpenWorkspace(workspaceId);
  const nextPath = [...folderPath.split('/').slice(0, -1), newName].join('/');
  assertFolderPath(nextPath);
  const all = folderPaths(ws);
  if (!all.includes(folderPath)) fail('not_found', 'Folder does not exist');
  if (nextPath === folderPath) return folderSnapshot(ws);
  const source = all.filter(folder => insideFolder(folder, folderPath));
  const sourceSet = new Set(source);
  const target = source.map(folder => nextPath + folder.slice(folderPath.length));
  for (const folder of target) assertFolderPath(folder);
  if (target.some(folder => all.includes(folder) && !sourceSet.has(folder))) fail('invalid_argument', 'Destination folder already exists');
  const moved = [...ws.folders.entries()].filter(([folder]) => insideFolder(folder, folderPath));
  for (const [folder] of moved) ws.folders.delete(folder);
  for (const [folder, createdAt] of moved) ws.folders.set(nextPath + folder.slice(folderPath.length), createdAt);
  const changedIds = [];
  for (const profile of ws.profiles) {
    if (profile.groupName !== null && insideFolder(profile.groupName, folderPath)) {
      profile.groupName = nextPath + profile.groupName.slice(folderPath.length);
      changedIds.push(profile.id);
    }
  }
  return folderSnapshot(ws, changedIds);
}

function removeAssetFolder(workspaceId, folderPath) {
  requireStarted();
  assertFolderPath(folderPath);
  const ws = requireOpenWorkspace(workspaceId);
  const all = folderPaths(ws);
  if (!all.includes(folderPath)) fail('not_found', 'Folder does not exist');
  if (all.some(folder => folder.startsWith(`${folderPath}/`))) fail('invalid_argument', 'Move child folders first');
  if (ws.profiles.some(p => p.groupName !== null && insideFolder(p.groupName, folderPath))) {
    fail('invalid_argument', 'Move hosts out of this folder first');
  }
  ws.folders.delete(folderPath);
  return folderSnapshot(ws);
}

function moveProfilesToAssetFolder(workspaceId, profileIds, folderPath) {
  requireStarted();
  if (!Array.isArray(profileIds) || profileIds.length < 1 || profileIds.length > 500 ||
      profileIds.some(id => typeof id !== 'string' || !id || id.length > 256 || CONTROL_CHARS.test(id)) ||
      new Set(profileIds).size !== profileIds.length) {
    fail('invalid_argument', 'Invalid profile IDs');
  }
  if (folderPath !== null) assertFolderPath(folderPath);
  const ws = requireOpenWorkspace(workspaceId);
  if (folderPath !== null && !folderPaths(ws).includes(folderPath)) fail('not_found', 'Destination folder does not exist');
  const rows = profileIds.map(id => ws.profiles.find(p => p.id === id));
  if (rows.some(row => !row)) fail('not_found', 'Saved host does not exist in this workspace');
  const changedIds = [];
  rows.forEach(row => {
    if (row.groupName !== folderPath) {
      row.groupName = folderPath;
      changedIds.push(row.id);
    }
  });
  if (folderPath !== null && !ws.folders.has(folderPath)) ws.folders.set(folderPath, now());
  return folderSnapshot(ws, changedIds);
}

function getRunbooks(workspaceId) {
  const ws = requireOpenWorkspace(workspaceId);
  return [...ws.runbooks].sort((a, b) => a.created_at - b.created_at).map(rb => runbookRow(ws, rb));
}

function saveRunbooks(workspaceId, runbooks) {
  const ws = requireOpenWorkspace(workspaceId);
  if (!Array.isArray(runbooks)) fail('invalid_argument', 'runbooks must be an array');
  const seen = new Set();
  const next = runbooks.map(rb => {
    if (!isPlainObject(rb)) fail('invalid_argument', 'each runbook must be an object');
    const id = rowId(rb.id, 'runbook id');
    if (seen.has(id)) fail('invalid_argument', `duplicate runbook id "${id}"`);
    seen.add(id);
    return {
      id,
      title: text(rb.title, 'title'),
      script: text(rb.script, 'script'),
      riskLevel: rb.riskLevel ? text(rb.riskLevel, 'riskLevel') : 'LOW',
      created_at: rb.created_at ? finiteNumber(rb.created_at, 'created_at') : now(),
    };
  });
  ws.runbooks = next;
}

function getAiSessions(workspaceId) {
  const ws = requireOpenWorkspace(workspaceId);
  return [...ws.sessions].sort((a, b) => newestFirst(a, b, 'updated_at')).map(session => ({
    id: session.id,
    workspace_id: ws.id,
    title: session.title,
    created_at: session.created_at,
    updated_at: session.updated_at,
    messages: ws.messages
      .filter(m => m.session_id === session.id)
      .sort((a, b) => a.timestamp - b.timestamp || a.seq - b.seq)
      .map(messageRow),
  }));
}

function createAiSession(workspaceId, id, title, timestamp) {
  const ws = requireOpenWorkspace(workspaceId);
  rowId(id, 'session id');
  text(title, 'title');
  finiteNumber(timestamp, 'timestamp');
  if (ws.sessions.some(session => session.id === id)) fail('invalid_argument', `AI session "${id}" already exists`);
  ws.sessions.push({ id, title, created_at: timestamp, updated_at: timestamp, seq: nextSeq() });
}

function saveAiMessage(workspaceId, message) {
  const ws = requireOpenWorkspace(workspaceId);
  if (!isPlainObject(message)) fail('invalid_argument', 'message must be an object');
  const id = rowId(message.id, 'message id');
  const sessionId = rowId(message.session_id, 'session_id');
  const role = text(message.role, 'role');
  const content = text(message.content, 'content');
  const rawContent = nullableText(message.raw_content, 'raw_content');
  const timestamp = finiteNumber(message.timestamp, 'timestamp');
  const existing = ws.messages.find(m => m.id === id);
  if (existing) {
    existing.content = content;
    existing.raw_content = rawContent;
  } else {
    if (!ws.sessions.some(session => session.id === sessionId)) fail('not_found', `AI session "${sessionId}" does not exist`);
    ws.messages.push({ id, session_id: sessionId, role, content, raw_content: rawContent, timestamp, seq: nextSeq() });
  }
  const session = ws.sessions.find(entry => entry.id === sessionId);
  if (session) session.updated_at = timestamp;
}

function updateAiSessionTitle(workspaceId, id, title) {
  const ws = requireOpenWorkspace(workspaceId);
  text(id, 'session id');
  text(title, 'title');
  const session = ws.sessions.find(entry => entry.id === id);
  if (session) session.title = title;
}

function deleteAiSession(workspaceId, id) {
  const ws = requireOpenWorkspace(workspaceId);
  text(id, 'session id');
  ws.sessions = ws.sessions.filter(session => session.id !== id);
  ws.messages = ws.messages.filter(m => m.session_id !== id);
}

function isEncryptedAiMemoryAvailable() {
  requireConfigured();
  return appOpen();
}

function upsertAiMemoryVector(row) {
  requireAppOpen();
  if (!isPlainObject(row)) fail('invalid_argument', 'row must be an object');
  const ws = requireOpenWorkspace(row.workspace_id);
  const messageId = rowId(row.message_id, 'message_id');
  const sessionId = rowId(row.session_id, 'session_id');
  if (!MEMORY_ROLES.has(row.role)) fail('invalid_argument', "role must be 'user' or 'assistant'");
  if (!(row.embedding instanceof Uint8Array)) fail('invalid_argument', 'embedding must be a Buffer');
  if (!Number.isInteger(row.dimensions) || row.dimensions < 0) fail('invalid_argument', 'dimensions must be a non-negative integer');
  const record = {
    workspace_id: ws.id,
    message_id: messageId,
    session_id: sessionId,
    role: row.role,
    embedding: Buffer.from(row.embedding),
    dimensions: row.dimensions,
    content_hash: text(row.content_hash, 'content_hash'),
    timestamp: finiteNumber(row.timestamp, 'timestamp'),
    seq: nextSeq(),
  };
  const index = S.memoryVectors.findIndex(v => v.workspace_id === ws.id && v.message_id === messageId);
  if (index >= 0) S.memoryVectors[index] = record;
  else S.memoryVectors.push(record);
}

function getAiMemoryVectors(workspaceId, limit, excludeSessionId) {
  const ws = requireOpenWorkspace(workspaceId);
  const bounded = boundedLimit(limit);
  if (excludeSessionId !== undefined && excludeSessionId !== null) text(excludeSessionId, 'excludeSessionId');
  return S.memoryVectors
    .filter(v => v.workspace_id === ws.id && (!excludeSessionId || v.session_id !== excludeSessionId))
    .sort((a, b) => newestFirst(a, b, 'timestamp'))
    .slice(0, bounded)
    .map(vectorRow);
}

function deleteAiMemoryMessage(workspaceId, messageId) {
  const ws = requireOpenWorkspace(workspaceId);
  text(messageId, 'messageId');
  S.memoryVectors = S.memoryVectors.filter(v => !(v.workspace_id === ws.id && v.message_id === messageId));
}

function deleteAiMemorySession(workspaceId, sessionId) {
  const ws = requireOpenWorkspace(workspaceId);
  text(sessionId, 'sessionId');
  S.memoryVectors = S.memoryVectors.filter(v => !(v.workspace_id === ws.id && v.session_id === sessionId));
}

function getRecentAiMessagesForMemory(workspaceId, limit) {
  const ws = requireOpenWorkspace(workspaceId);
  const bounded = boundedLimit(limit);
  const sessions = new Set(ws.sessions.map(session => session.id));
  return ws.messages
    .filter(m => sessions.has(m.session_id) && MEMORY_ROLES.has(m.role))
    .sort((a, b) => newestFirst(a, b, 'timestamp'))
    .slice(0, bounded)
    .map(memoryMessageRow);
}

function getAiMessagesByIds(workspaceId, messageIds) {
  const ws = requireOpenWorkspace(workspaceId);
  stringList(messageIds, 'messageIds');
  if (messageIds.length === 0) return [];
  const wanted = new Set([...new Set(messageIds)].slice(0, MAX_MEMORY_IDS));
  const sessions = new Set(ws.sessions.map(session => session.id));
  return ws.messages.filter(m => wanted.has(m.id) && sessions.has(m.session_id)).map(memoryMessageRow);
}

function logAudit(workspaceId, action, target, details) {
  const ws = requireOpenWorkspace(workspaceId);
  text(action, 'action');
  if (target !== undefined && target !== null) text(target, 'target');
  if (details !== undefined && details !== null) text(details, 'details');
  ws.auditLogs.push({
    id: crypto.randomUUID(),
    workspace_id: ws.id,
    action,
    target: target || '',
    details: details || '',
    created_at: now(),
    seq: nextSeq(),
  });
}

function getAuditLogs(workspaceId, limit) {
  const ws = requireOpenWorkspace(workspaceId);
  const count = limit === undefined ? DEFAULT_AUDIT_LIMIT : Math.trunc(finiteNumber(limit, 'limit'));
  const rows = [...ws.auditLogs].sort((a, b) => newestFirst(a, b, 'created_at'));
  return (count < 0 ? rows : rows.slice(0, count)).map(({ seq, ...row }) => row);
}

// ─────────────────────────────── export and import ───────────────────────────────

function exportCandidates() {
  requireAppOpen();
  return sortedWorkspaces().map(ws => {
    const unlockWith = [];
    if (!ws.open && ws.password !== null) {
      if (workspacePresence(ws) && presenceResult !== 'unsupported') unlockWith.push('presence');
      unlockWith.push('password');
    }
    return {
      id: ws.id,
      name: ws.name,
      is_main: ws.is_main,
      state: ws.open ? 'open' : 'locked',
      unlockWith,
      profileCount: ws.open ? ws.profiles.length : 0,
    };
  });
}

function serializeWorkspace(ws) {
  return {
    id: ws.id,
    name: ws.name,
    themeColor: ws.themeColor,
    is_main: ws.is_main,
    password: ws.password,
    preferences: ws.preferences,
    created_at: ws.created_at,
    updated_at: ws.updated_at,
    profiles: ws.profiles.map(p => ({ ...p })),
    folders: [...ws.folders.entries()],
    runbooks: ws.runbooks.map(rb => ({ ...rb })),
    sessions: ws.sessions.map(({ seq, ...session }) => session),
    messages: ws.messages.map(({ seq, ...m }) => m),
    auditLogs: ws.auditLogs.map(({ seq, ...log }) => log),
    sshKeys: ws.sshKeys.map(key => ({ ...key, privateKey: key.privateKey.toString('base64') })),
  };
}

function restoreWorkspace(raw) {
  if (!isPlainObject(raw) || !isValidWorkspaceId(raw.id) || typeof raw.name !== 'string' ||
      !Number.isFinite(raw.created_at) || !Number.isFinite(raw.updated_at)) {
    throw new TypeError('workspace');
  }
  const ws = workspaceRecord({
    id: raw.id,
    name: raw.name,
    themeColor: raw.themeColor ?? null,
    is_main: raw.is_main === true,
    password: typeof raw.password === 'string' ? raw.password : null,
    preferences: typeof raw.preferences === 'string' ? raw.preferences : '{}',
  });
  ws.created_at = raw.created_at;
  ws.updated_at = raw.updated_at;
  ws.profiles = raw.profiles.map(p => ({ ...p }));
  ws.folders = new Map(raw.folders);
  ws.runbooks = raw.runbooks.map(rb => ({ ...rb }));
  ws.sessions = raw.sessions.map(session => ({ ...session, seq: nextSeq() }));
  ws.messages = raw.messages.map(m => ({ ...m, seq: nextSeq() }));
  ws.auditLogs = raw.auditLogs.map(log => ({ ...log, seq: nextSeq() }));
  ws.sshKeys = raw.sshKeys.map(key => ({ ...key, privateKey: Buffer.from(key.privateKey, 'base64') }));
  ws.open = true;
  return ws;
}

function gcmSeal(key, plaintext, aad) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([nonce, body, cipher.getAuthTag()]);
}

function gcmOpen(key, sealed, aad) {
  if (sealed.length < 12 + 16) throw new RangeError('too short');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12));
  decipher.setAAD(aad);
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  return Buffer.concat([decipher.update(sealed.subarray(12, sealed.length - 16)), decipher.final()]);
}

function deriveBundleKey(password, kdf, salt) {
  return scryptAsync(password, salt, 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * kdf.N * kdf.r + 1024 * 1024 });
}

async function sealBundle(payload, password) {
  const salt = crypto.randomBytes(16);
  const header = {
    fake: true,
    formatVersion: BUNDLE_FORMAT_VERSION,
    createdAt: payload.createdAt,
    appVersion: S.appVersion,
    kdf: { ...BUNDLE_KDF, salt: salt.toString('base64') },
    cipher: 'aes-256-gcm',
  };
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  const version = Buffer.alloc(2);
  version.writeUInt16BE(BUNDLE_FORMAT_VERSION);
  const prefix = Buffer.concat([BUNDLE_MAGIC, version, uint32(headerBytes.length), headerBytes]);
  const kek = await deriveBundleKey(password, BUNDLE_KDF, salt);
  const payloadKey = crypto.randomBytes(32);
  try {
    const keyArea = gcmSeal(kek, payloadKey, prefix);
    const body = gcmSeal(payloadKey, Buffer.from(JSON.stringify(payload), 'utf8'), Buffer.concat([prefix, keyArea]));
    return Buffer.concat([prefix, uint32(keyArea.length), keyArea, body]);
  } finally {
    kek.fill(0);
    payloadKey.fill(0);
  }
}

async function openBundle(filePath, password) {
  const file = absolutePath(filePath, 'path');
  const given = normalizePassword(password, 'export password');
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch (error) {
    fail(error.code === 'ENOENT' ? 'not_found' : 'io', `cannot read ${file} (${error.code || error.message})`);
  }
  const damaged = () => fail('corrupt', 'this file is not a readable GETSSH backup');
  if (bytes.length < BUNDLE_MAGIC.length + 6 || !bytes.subarray(0, BUNDLE_MAGIC.length).equals(BUNDLE_MAGIC)) damaged();
  const version = bytes.readUInt16BE(BUNDLE_MAGIC.length);
  if (version !== BUNDLE_FORMAT_VERSION) fail('corrupt', `unsupported backup format version ${version}`);
  const headerLength = bytes.readUInt32BE(BUNDLE_MAGIC.length + 2);
  const headerEnd = BUNDLE_MAGIC.length + 6 + headerLength;
  if (headerEnd + 4 > bytes.length) damaged();
  let header;
  try {
    header = JSON.parse(bytes.subarray(BUNDLE_MAGIC.length + 6, headerEnd).toString('utf8'));
  } catch {
    damaged();
  }
  if (!isPlainObject(header) || header.fake !== true) {
    fail('corrupt', 'this backup was not written by store.fake.js; only the real getssh-store can read it');
  }
  const kdf = header.kdf;
  // Bounded so that a hostile header cannot make scrypt allocate more than 64 MiB.
  if (!isPlainObject(kdf) || kdf.name !== 'scrypt' || !Number.isInteger(kdf.N) || kdf.N < 2 || kdf.N > (1 << 16) ||
      (kdf.N & (kdf.N - 1)) !== 0 || !Number.isInteger(kdf.r) || kdf.r < 1 || kdf.r > 8 ||
      !Number.isInteger(kdf.p) || kdf.p < 1 || kdf.p > 4 || typeof kdf.salt !== 'string') {
    damaged();
  }
  const prefix = bytes.subarray(0, headerEnd);
  const keyAreaLength = bytes.readUInt32BE(headerEnd);
  const keyAreaEnd = headerEnd + 4 + keyAreaLength;
  if (keyAreaEnd > bytes.length) damaged();
  const keyArea = bytes.subarray(headerEnd + 4, keyAreaEnd);
  const kek = await deriveBundleKey(given, kdf, Buffer.from(kdf.salt, 'base64'));
  let payloadKey;
  try {
    payloadKey = gcmOpen(kek, keyArea, prefix);
  } catch {
    fail('wrong_password', 'wrong export password');
  } finally {
    kek.fill(0);
  }
  let payload;
  try {
    payload = JSON.parse(gcmOpen(payloadKey, bytes.subarray(keyAreaEnd), Buffer.concat([prefix, keyArea])).toString('utf8'));
  } catch {
    damaged();
  } finally {
    payloadKey.fill(0);
  }
  if (!isPlainObject(payload) || !Array.isArray(payload.workspaces)) damaged();
  return { header, payload };
}

async function exportBundle(filePath, password, workspaceIds) {
  await pause();
  requireAppOpen();
  if (mustChangeMaster()) fail('must_change_master_password', 'change the master password before exporting');
  const file = absolutePath(filePath, 'path');
  const exportPassword = newPassword(password, MIN_EXPORT_PASSWORD, 'export password');
  stringList(workspaceIds, 'workspaceIds');
  if (workspaceIds.length === 0) fail('invalid_argument', 'choose at least one workspace');
  const ids = [...new Set(workspaceIds)];
  const chosen = ids.map(lookupWorkspace);
  const locked = chosen.filter(ws => !ws.open);
  if (locked.length) fail('locked', `unlock ${locked.map(ws => `"${ws.id}"`).join(', ')} first`);
  const payload = {
    formatVersion: BUNDLE_FORMAT_VERSION,
    createdAt: now(),
    appVersion: S.appVersion,
    master: S.master ? { password: S.master.password } : null,
    workspaces: chosen.map(serializeWorkspace),
    globalSettings: [...S.globalSettings.entries()],
    appSecrets: [...S.appSecrets.entries()],
    aiMemoryVectors: S.memoryVectors
      .filter(v => ids.includes(v.workspace_id))
      .map(({ seq, ...v }) => ({ ...v, embedding: v.embedding.toString('base64') })),
  };
  const bytes = await sealBundle(payload, exportPassword);
  const temporary = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, bytes, { mode: 0o600 });
    fs.renameSync(temporary, file);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch { /* nothing to clean up */ }
    fail('io', `cannot write ${file} (${error.code || error.message})`);
  }
  return { path: file, workspaceIds: ids, bytes: bytes.length };
}

async function inspectBundle(filePath, password) {
  await pause();
  requireStarted();
  const { header, payload } = await openBundle(filePath, password);
  return {
    formatVersion: header.formatVersion,
    createdAt: header.createdAt,
    appVersion: header.appVersion,
    workspaces: payload.workspaces.map(ws => ({ id: ws.id, name: ws.name, hasPassword: typeof ws.password === 'string' })),
  };
}

async function importBundle(filePath, password, mode) {
  await pause();
  requireAppOpen();
  if (mode !== 'replace') fail('invalid_argument', "mode must be 'replace' (merge comes in a later release)");
  const { payload } = await openBundle(filePath, password);
  let workspaces;
  let globalSettings;
  let appSecrets;
  let memoryVectors;
  let master;
  try {
    workspaces = payload.workspaces.map(restoreWorkspace);
    if (new Set(workspaces.map(ws => ws.id)).size !== workspaces.length) throw new TypeError('duplicate workspace');
    globalSettings = new Map(payload.globalSettings);
    appSecrets = new Map(payload.appSecrets);
    memoryVectors = payload.aiMemoryVectors.map(v => ({ ...v, embedding: Buffer.from(v.embedding, 'base64'), seq: nextSeq() }));
    master = payload.master && typeof payload.master.password === 'string' ? { password: payload.master.password } : null;
  } catch {
    fail('corrupt', 'the backup content is damaged');
  }
  const mains = workspaces.filter(ws => ws.is_main);
  mains.slice(1).forEach(ws => { ws.is_main = false; });
  if (mains.length === 0) {
    const candidate = workspaces.find(ws => ws.password === null);
    if (candidate) {
      candidate.is_main = true;
    } else {
      const main = workspaceRecord({ id: 'default', name: 'Default Workspace', is_main: true });
      main.open = true;
      if (workspaces.some(ws => ws.id === main.id)) main.id = crypto.randomUUID();
      workspaces.unshift(main);
    }
  }
  // <dir>-backup-YYYYMMDD-HHMMSS (UTC), as the real module names it.
  const stamp = new Date(now()).toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  const backupPath = path.join(path.dirname(S.baseDir), `${path.basename(S.baseDir)}-backup-${stamp}`);
  Object.assign(S, {
    master,
    weakMasterSeen: false,
    phase: 'ready',
    unlockedBy: null,
    presenceEnabled: false,
    recovery: null,
    workspaces,
    globalSettings,
    appSecrets,
    memoryVectors,
    rate: new Map(),
    reveal: new Map(),
    replaced: true,
  });
  return { workspaceIds: payload.workspaces.map(ws => ws.id), backupPath };
}

// ─────────────────────────────────────── __fake ───────────────────────────────────────

function seed(options = {}) {
  if (!isPlainObject(options)) fail('invalid_argument', 'seed options must be an object');
  const next = emptyState();
  next.configured = S.configured;
  next.baseDir = S.baseDir;
  if (options.masterPassword !== undefined && options.masterPassword !== null) {
    const password = normalizePassword(options.masterPassword, 'seed masterPassword');
    if (!password) fail('invalid_argument', 'seed masterPassword must not be empty');
    next.master = { password };
  }
  next.presenceEnabled = options.presenceEnabled === true;
  if (options.recoveryCode !== undefined) {
    const entropy = parseRecoveryCode(options.recoveryCode);
    if (!entropy) fail('invalid_argument', 'seed recoveryCode is not well formed');
    next.recovery = { digest: recoveryDigest(entropy) };
  }
  const specs = options.workspaces ?? [];
  if (!Array.isArray(specs)) fail('invalid_argument', 'seed workspaces must be an array');
  for (const spec of specs) {
    if (!isPlainObject(spec) || !isValidWorkspaceId(spec.id)) fail('invalid_argument', 'seed: every workspace needs a valid id');
    if (next.workspaces.some(ws => ws.id === spec.id)) fail('invalid_argument', `seed: duplicate workspace "${spec.id}"`);
    let password = null;
    if (spec.password !== undefined && spec.password !== null) {
      if (next.master) fail('invalid_argument', 'seed: workspace passwords cannot coexist with a master password');
      password = normalizePassword(spec.password, 'seed workspace password');
      if (!password) fail('invalid_argument', 'seed: workspace password must not be empty');
    }
    next.workspaces.push(workspaceRecord({
      id: spec.id,
      name: displayName(spec.name ?? spec.id, 'seed workspace name'),
      themeColor: nullableText(spec.themeColor, 'themeColor'),
      is_main: spec.is_main === true,
      password,
      presenceEnabled: password !== null && (spec.presenceEnabled ?? next.presenceEnabled) === true,
      preferences: spec.preferences === undefined ? '{}' : text(spec.preferences, 'preferences'),
    }));
  }
  if (next.workspaces.length === 0) {
    next.workspaces.push(workspaceRecord({ id: 'default', name: 'Default Workspace', is_main: true }));
  }
  const mains = next.workspaces.filter(ws => ws.is_main);
  if (mains.length > 1) fail('invalid_argument', 'seed: only one workspace can be MAIN');
  if (mains.length === 1 && mains[0].password !== null) fail('invalid_argument', 'seed: the MAIN workspace cannot have a password');
  if (mains.length === 0) {
    const candidate = next.workspaces.find(ws => ws.password === null);
    if (!candidate) fail('invalid_argument', 'seed: at least one workspace without a password is needed for MAIN');
    candidate.is_main = true;
  }
  const profiles = options.profiles ?? {};
  if (!isPlainObject(profiles)) fail('invalid_argument', 'seed profiles must be an object keyed by workspace id');
  for (const [workspaceId, inputs] of Object.entries(profiles)) {
    const ws = next.workspaces.find(entry => entry.id === workspaceId);
    if (!ws) fail('invalid_argument', `seed: profiles for unknown workspace "${workspaceId}"`);
    ws.profiles = buildProfiles(ws, inputs);
  }
  for (const [key, value] of Object.entries(options.globalSettings ?? {})) next.globalSettings.set(key, text(value, `setting ${key}`));
  for (const [name, value] of Object.entries(options.appSecrets ?? {})) next.appSecrets.set(secretName(name), text(value, `secret ${name}`));
  if (options.startReport !== undefined) {
    if (!isPlainObject(options.startReport)) fail('invalid_argument', 'seed startReport must be an object');
    next.startReport = options.startReport;
  }
  S = next;
}

function snapshot() {
  return {
    configured: S.configured,
    started: S.started,
    baseDir: S.baseDir,
    phase: appOpen() ? 'ready' : 'locked',
    masterPassword: Boolean(S.master),
    masterPasswordMustChange: mustChangeMaster(),
    unlockedBy: S.unlockedBy,
    presence: presenceResult,
    presenceEnabled: S.presenceEnabled,
    presencePrompts,
    recoveryConfigured: Boolean(S.recovery),
    lastLockReason: S.lastLockReason,
    clockOffset,
    latencyMs,
    workspaces: sortedWorkspaces().map(ws => ({
      ...workspaceRow(ws),
      presencePending: ws.presencePending,
      profiles: ws.profiles.map(p => profileRow(ws, p)),
      sshKeys: ws.sshKeys.map(sshKeyRow),
      assetFolders: [...ws.folders.keys()],
      runbookCount: ws.runbooks.length,
      aiSessionCount: ws.sessions.length,
      aiMessageCount: ws.messages.length,
      auditLogCount: ws.auditLogs.length,
    })),
    globalSettings: Object.fromEntries(S.globalSettings),
    appSecretNames: [...S.appSecrets.keys()].sort(),
    aiMemoryVectorCount: S.memoryVectors.length,
    revealWindows: Object.fromEntries(S.reveal),
    rateLimits: Object.fromEntries([...S.rate].map(([scope, entry]) => [scope, { ...entry }])),
  };
}

function secretsFor(workspaceId) {
  const ws = S.workspaces.find(entry => entry.id === workspaceId);
  if (!ws) fail('not_found', `workspace "${workspaceId}" does not exist`);
  return {
    workspacePassword: ws.password,
    profiles: Object.fromEntries(ws.profiles.map(p => [p.id, { password: p.password, passphrase: p.passphrase }])),
    sshKeys: Object.fromEntries(ws.sshKeys.map(key => [key.id, { privateKey: key.privateKey.toString('utf8'), passphrase: key.passphrase }])),
  };
}

function setPresenceResult(result) {
  if (!PRESENCE_RESULTS.has(result)) fail('invalid_argument', "presence result must be 'ok', 'cancelled' or 'unsupported'");
  presenceResult = result;
}

function reset() {
  S = emptyState();
  clockOffset = 0;
  presenceResult = 'ok';
  presencePrompts = 0;
  latencyMs = 0;
  pendingEnvSeed = null;
}

/** Simulates relaunching the app: the data stays, everything closes, start() must run again. */
function restart() {
  if (!S.configured) fail('not_configured', 'call configure(baseDir) first');
  S.replaced = false;
  S.started = false;
  S.phase = 'locked';
  S.unlockedBy = null;
  S.weakMasterSeen = false;
  S.reveal = new Map();
  for (const ws of S.workspaces) ws.open = false;
}

const __fake = Object.freeze({
  reset,
  restart,
  seed,
  setPresence: setPresenceResult,
  advance(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) fail('invalid_argument', 'ms must be a non-negative number');
    clockOffset += ms;
  },
  now,
  setLatency(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) fail('invalid_argument', 'ms must be a non-negative number');
    latencyMs = ms;
  },
  snapshot,
  secretsFor,
});

// Development switches (see the top of the file).
if (process.env.GETSSH_FAKE_STORE_PRESENCE) setPresenceResult(process.env.GETSSH_FAKE_STORE_PRESENCE);
if (process.env.GETSSH_FAKE_STORE_DELAY_MS) __fake.setLatency(Number(process.env.GETSSH_FAKE_STORE_DELAY_MS));
if (process.env.GETSSH_FAKE_STORE_SEED) pendingEnvSeed = process.env.GETSSH_FAKE_STORE_SEED;

module.exports = {
  configure,
  needsLegacyMigration,
  start,
  appState,
  unlockApp,
  lockApp,
  setMasterPassword,
  removeMasterPassword,
  setPresence,
  createRecoveryCode,
  removeRecoveryCode,
  isRecoveryCodeWellFormed,
  verifyPresence,
  verifyPassword,
  listWorkspaces,
  createWorkspace,
  updateWorkspace,
  setMainWorkspace,
  deleteWorkspace,
  openWorkspace,
  unlockWorkspace,
  unlockWorkspaces,
  lockWorkspace,
  setWorkspacePassword,
  removeWorkspacePassword,
  workspaceStats,
  listProfiles,
  saveProfiles,
  deleteProfiles,
  copyProfiles,
  connectSecrets,
  openReveal,
  revealSecret,
  closeReveal,
  setAppSecret,
  getAppSecret,
  listAppSecretNames,
  importSshKey,
  generateSshKey,
  listSshKeys,
  deleteSshKey,
  getGlobalSetting,
  setGlobalSetting,
  getAssetFolders,
  createAssetFolder,
  renameAssetFolder,
  removeAssetFolder,
  moveProfilesToAssetFolder,
  getRunbooks,
  saveRunbooks,
  getAiSessions,
  createAiSession,
  saveAiMessage,
  updateAiSessionTitle,
  deleteAiSession,
  isEncryptedAiMemoryAvailable,
  upsertAiMemoryVector,
  getAiMemoryVectors,
  deleteAiMemoryMessage,
  deleteAiMemorySession,
  getRecentAiMessagesForMemory,
  getAiMessagesByIds,
  logAudit,
  getAuditLogs,
  exportCandidates,
  exportBundle,
  inspectBundle,
  importBundle,
  __fake,
};
