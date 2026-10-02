// Tests for store.fake.js, the in-memory stand-in for getssh-store.
// Run: node --test rust-core/getssh-store/store.fake.test.mjs
// Everything happens in memory or under os.tmpdir(); nothing touches ~/.getssh or a keychain.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const fakePath = path.join(here, 'store.fake.js');
const store = require(fakePath);
const fake = store.__fake;
const dts = fs.readFileSync(path.join(here, 'store.d.ts'), 'utf8');

const MASTER = 'correct horse battery';
const WS_PW = 'workspace-pw';
const EXPORT_PW = 'export password 2026';
const MINUTE = 60_000;

let root;
let homes = 0;

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-store-fake-'));
});

after(() => {
  fake.reset();
  fs.rmSync(root, { recursive: true, force: true });
});

function freshBaseDir() {
  homes += 1;
  return path.join(root, `home-${homes}`, '.getssh');
}

async function boot(seedOptions) {
  fake.reset();
  store.configure(freshBaseDir());
  if (seedOptions) fake.seed(seedOptions);
  return store.start();
}

function expectCode(code) {
  return error => {
    assert.ok(error instanceof Error, 'expected an Error object');
    assert.match(error.message, new RegExp(`^\\[store:${code}\\] \\S`), error.message);
    return true;
  };
}

const throwsWith = (fn, code, message) => assert.throws(fn, expectCode(code), message);
const rejectsWith = (fn, code, message) => assert.rejects(fn, expectCode(code), message);

function profile(id, extra = {}) {
  return {
    id, host: `${id}.example`, username: 'root', port: 22, protocol: 'ssh', authType: 'password',
    alias: null, osType: null, groupName: null, autoStart: false, useKeepAlive: true,
    strictHostKeyChecking: false, proxyJump: null, initialDirectory: null, postConnectScript: null,
    themeOverride: null, keyId: null, privateKeyPath: null, ...extra,
  };
}

function splitParams(source) {
  const out = [];
  let depth = 0;
  let current = '';
  for (const ch of source) {
    if ('({[<'.includes(ch)) depth += 1;
    if (')}]>'.includes(ch)) depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map(part => part.trim()).filter(Boolean);
}

function sshString(value) {
  const body = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  return Buffer.concat([length, body]);
}

function fingerprintOf(publicKeyLine) {
  const blob = Buffer.from(publicKeyLine.split(' ')[1], 'base64');
  return `SHA256:${crypto.createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`;
}

// ──────────────────────────────────── interface ────────────────────────────────────

test('exports exactly the functions of store.d.ts, with the same arity and sync/async split', () => {
  const declared = [...dts.matchAll(/^export function (\w+)\((.*)\): (.+);$/gm)].map(match => ({
    name: match[1],
    params: splitParams(match[2]),
    isAsync: match[3].startsWith('Promise<'),
  }));
  assert.equal(declared.length, (dts.match(/^export function /gm) || []).length, 'every declaration sits on one line');
  assert.ok(declared.length > 60);
  const exported = Object.keys(store).filter(key => key !== '__fake').sort();
  assert.deepEqual(exported, declared.map(entry => entry.name).sort());
  for (const entry of declared) {
    const fn = store[entry.name];
    assert.equal(typeof fn, 'function', entry.name);
    assert.equal(fn.length, entry.params.length, `${entry.name}: parameter count`);
    assert.equal(fn.constructor.name === 'AsyncFunction', entry.isAsync, `${entry.name}: async`);
  }
  for (const control of ['reset', 'seed', 'setPresence', 'advance', 'now', 'setLatency', 'snapshot', 'secretsFor']) {
    assert.equal(typeof fake[control], 'function', `__fake.${control}`);
  }
});

test('errors use the "[store:<code>] " prefix with a StoreErrorCode', async () => {
  const union = /export type StoreErrorCode =([\s\S]*?);/.exec(dts)[1];
  const codes = new Set([...union.matchAll(/'([a-z_]+)'/g)].map(match => match[1]));
  assert.equal(codes.size, 15);
  await boot({ masterPassword: MASTER });
  const errors = [];
  const collect = async fn => {
    try {
      await fn();
    } catch (error) {
      errors.push(error);
      return;
    }
    assert.fail('expected an error');
  };
  await collect(() => store.listWorkspaces());
  await collect(() => store.unlockApp({ password: 'wrong password' }));
  await collect(() => store.unlockApp({ nope: 'x' }));
  await store.unlockApp({ password: MASTER });
  await collect(() => store.listProfiles('ghost'));
  for (const error of errors) {
    const match = /^\[store:([a-z_]+)\] \S/.exec(error.message);
    assert.ok(match, error.message);
    assert.ok(codes.has(match[1]), match[1]);
  }
  assert.deepEqual(errors.map(error => /^\[store:([a-z_]+)\]/.exec(error.message)[1]),
    ['locked', 'wrong_password', 'invalid_argument', 'not_found']);
});

test('every call before configure() fails with not_configured, and async calls reject', async () => {
  fake.reset();
  throwsWith(() => store.appState(), 'not_configured');
  throwsWith(() => store.listWorkspaces(), 'not_configured');
  throwsWith(() => store.isRecoveryCodeWellFormed('x'), 'not_configured');
  throwsWith(() => store.lockApp('manual'), 'not_configured');
  throwsWith(() => store.getAppSecret('x'), 'not_configured');
  await rejectsWith(() => store.start(), 'not_configured');
  await rejectsWith(() => store.unlockApp({ password: 'x' }), 'not_configured');
  await rejectsWith(() => store.exportBundle(path.join(root, 'never.getssh-backup'), EXPORT_PW, ['default']), 'not_configured');
  throwsWith(() => store.configure('relative/dir'), 'invalid_argument');
});

test('configure + start create the MAIN workspace; before start() only appState works', async () => {
  fake.reset();
  store.configure(freshBaseDir());
  assert.equal(store.appState().phase, 'locked');
  throwsWith(() => store.listWorkspaces(), 'not_configured');
  fake.seed({ startReport: { presenceToReenable: ['default'] } });
  const report = await store.start();
  assert.deepEqual(report, { migratedWorkspaces: [], deferredWorkspaces: [], presenceToReenable: ['default'], failedWorkspaces: [] });
  assert.deepEqual((await store.start()).presenceToReenable, []);
  const [main, ...rest] = store.listWorkspaces();
  assert.equal(rest.length, 0);
  assert.equal(main.id, 'default');
  assert.equal(main.is_main, true);
  assert.equal(main.hasPassword, false);
  assert.equal(main.state, 'open');
  assert.equal(main.preferences, '{}');
  const state = store.appState();
  assert.equal(state.phase, 'ready');
  assert.equal(state.masterPassword, false);
  assert.equal(state.masterPasswordMustChange, false);
  assert.equal(state.recoveryConfigured, false);
  assert.equal(state.deviceKeyLost, false);
  assert.equal(state.presenceSupported, true);
  assert.equal(typeof state.deviceBackend, 'string');
});

// ──────────────────────────────── profiles and secrets ────────────────────────────────

test('profile reads never return secrets; hasPassword/hasPassphrase/keyId describe them; group mirrors groupName', async () => {
  await boot({
    profiles: { default: [profile('p1', { password: 'pw-SECRET', passphrase: 'pp-SECRET', groupName: 'Prod' }), profile('p2')] },
  });
  const [p1, p2] = store.listProfiles('default');
  for (const row of [p1, p2]) {
    for (const forbidden of ['password', 'passphrase', 'privateKey']) assert.ok(!(forbidden in row), forbidden);
  }
  assert.equal(p1.hasPassword, true);
  assert.equal(p1.hasPassphrase, true);
  assert.equal(p1.groupName, 'Prod');
  assert.equal(p1.group, 'Prod');
  assert.equal(p1.workspace_id, 'default');
  assert.equal(p1.keyId, null);
  assert.equal(p2.hasPassword, false);
  assert.equal(p2.group, null);
  assert.ok(!JSON.stringify(store.listProfiles('default')).includes('SECRET'));
  const saved = store.saveProfiles('default', [{ id: 'p3', host: 'h', username: 'u' }]);
  assert.deepEqual(
    { port: saved[0].port, protocol: saved[0].protocol, authType: saved[0].authType, useKeepAlive: saved[0].useKeepAlive, autoStart: saved[0].autoStart, alias: saved[0].alias },
    { port: 22, protocol: 'ssh', authType: 'password', useKeepAlive: true, autoStart: false, alias: null },
  );
  throwsWith(() => store.saveProfiles('default', [profile('x', { protocol: 'ftp' })]), 'invalid_argument');
  throwsWith(() => store.saveProfiles('default', [profile('x'), profile('x')]), 'invalid_argument');
  throwsWith(() => store.saveProfiles('default', [profile('x', { keyId: 'no-such-key' })]), 'invalid_argument');
});

test('saveProfiles: undefined keeps a secret, null clears it, a string replaces it; missing profiles are deleted', async () => {
  await boot({
    profiles: {
      default: [
        profile('keep', { password: 'pw-keep', passphrase: 'pp-keep' }),
        profile('clear', { password: 'pw-clear', passphrase: 'pp-clear' }),
        profile('replace', { password: 'pw-old' }),
        profile('gone', { password: 'pw-gone' }),
      ],
    },
  });
  const rows = store.listProfiles('default');
  const inputs = rows.filter(row => row.id !== 'gone').map(({ workspace_id, group, hasPassword, hasPassphrase, ...input }) => input);
  inputs.find(input => input.id === 'clear').password = null;
  inputs.find(input => input.id === 'replace').password = 'pw-new';
  inputs.push(profile('fresh', { passphrase: 'pp-fresh' }));
  const saved = store.saveProfiles('default', inputs);
  assert.deepEqual(saved.map(row => row.id), ['keep', 'clear', 'replace', 'fresh']);
  const secrets = fake.secretsFor('default').profiles;
  assert.deepEqual(secrets.keep, { password: 'pw-keep', passphrase: 'pp-keep' });
  assert.deepEqual(secrets.clear, { password: null, passphrase: 'pp-clear' });
  assert.deepEqual(secrets.replace, { password: 'pw-new', passphrase: null });
  assert.deepEqual(secrets.fresh, { password: null, passphrase: 'pp-fresh' });
  assert.ok(!('gone' in secrets));
  store.deleteProfiles('default', ['fresh', 'not-there']);
  assert.deepEqual(store.listProfiles('default').map(row => row.id), ['keep', 'clear', 'replace']);
});

test('connectSecrets returns Buffers from the profile, its stored SSH key or its key file', async () => {
  await boot();
  const key = store.generateSshKey('default', { name: 'deploy', algorithm: 'ed25519' });
  const keyFile = path.join(root, `id_test_${homes}`);
  fs.writeFileSync(keyFile, 'FILE-KEY-MATERIAL', { mode: 0o600 });
  store.saveProfiles('default', [
    profile('pw', { password: 'pw-1' }),
    profile('stored', { authType: 'key', keyId: key.id, passphrase: 'pp-2' }),
    profile('file', { authType: 'key', privateKeyPath: keyFile }),
    profile('missing-file', { authType: 'key', privateKeyPath: path.join(root, 'nope') }),
    profile('agent', { authType: 'agent' }),
  ]);
  const pw = store.connectSecrets('default', 'pw');
  assert.ok(Buffer.isBuffer(pw.password));
  assert.equal(pw.password.toString(), 'pw-1');
  assert.deepEqual(Object.keys(pw), ['password']);
  const stored = store.connectSecrets('default', 'stored');
  assert.ok(Buffer.isBuffer(stored.privateKey) && Buffer.isBuffer(stored.passphrase));
  assert.match(stored.privateKey.toString(), /^-----BEGIN OPENSSH PRIVATE KEY-----\n/);
  assert.equal(stored.passphrase.toString(), 'pp-2');
  assert.equal(store.connectSecrets('default', 'file').privateKey.toString(), 'FILE-KEY-MATERIAL');
  throwsWith(() => store.connectSecrets('default', 'missing-file'), 'io');
  assert.deepEqual(store.connectSecrets('default', 'agent'), {});
  throwsWith(() => store.connectSecrets('default', 'ghost'), 'not_found');
  const again = store.connectSecrets('default', 'pw');
  again.password.fill(0);
  assert.equal(store.connectSecrets('default', 'pw').password.toString(), 'pw-1', 'each call returns a fresh Buffer');
});

test('revealSecret works only inside a 5-minute sliding reveal window', async () => {
  await boot({ profiles: { default: [profile('p1', { password: 'pw-1', passphrase: 'pp-1' }), profile('p2')] } });
  throwsWith(() => store.revealSecret('default', 'p1', 'password'), 'locked');
  await store.openReveal('default', { presence: 'Show the saved password' });
  assert.equal(store.revealSecret('default', 'p1', 'password'), 'pw-1');
  fake.advance(4 * MINUTE);
  assert.equal(store.revealSecret('default', 'p1', 'passphrase'), 'pp-1');
  fake.advance(4 * MINUTE);
  assert.equal(store.revealSecret('default', 'p1', 'password'), 'pw-1', 'each reveal extends the window');
  throwsWith(() => store.revealSecret('default', 'p2', 'password'), 'not_found');
  throwsWith(() => store.revealSecret('default', 'p1', 'privateKey'), 'invalid_argument');
  fake.advance(5 * MINUTE + 1);
  throwsWith(() => store.revealSecret('default', 'p1', 'password'), 'locked');
  await store.openReveal('default', { presence: 'Show' });
  store.closeReveal('default');
  throwsWith(() => store.revealSecret('default', 'p1', 'password'), 'locked');
  await store.openReveal('default', { presence: 'Show' });
  store.lockApp('idle');
  throwsWith(() => store.revealSecret('default', 'p1', 'password'), 'locked', 'lockApp closes reveal windows');
});

test('openReveal honours presence results and checks the password that protects the workspace', async () => {
  await boot({
    workspaces: [{ id: 'main' }, { id: 'vault', password: WS_PW }],
    profiles: { vault: [profile('p1', { password: 'pw-1' })] },
  });
  fake.setPresence('cancelled');
  await rejectsWith(() => store.openReveal('main', { presence: 'Show' }), 'cancelled');
  fake.setPresence('unsupported');
  await rejectsWith(() => store.openReveal('main', { presence: 'Show' }), 'unavailable');
  await rejectsWith(() => store.openReveal('main', { password: 'anything' }), 'invalid_argument');
  await rejectsWith(() => store.openReveal('vault', { password: WS_PW }), 'locked');
  await store.unlockWorkspace('vault', { password: WS_PW });
  await rejectsWith(() => store.openReveal('vault', { password: 'wrong-password' }), 'wrong_password');
  await store.openReveal('vault', { password: WS_PW });
  assert.equal(store.revealSecret('vault', 'p1', 'password'), 'pw-1');
  await rejectsWith(() => store.openReveal('vault', { presence: 'x', password: 'y' }), 'invalid_argument');
});

test('app secrets: getAppSecret returns a Buffer or null, null deletes, names list by prefix', async () => {
  await boot();
  store.setAppSecret('ai.openai', 'sk-1');
  store.setAppSecret('ai.claude', 'sk-2');
  store.setAppSecret('mcp.github', 'token-3');
  const value = store.getAppSecret('ai.openai');
  assert.ok(Buffer.isBuffer(value));
  assert.equal(value.toString(), 'sk-1');
  assert.equal(store.getAppSecret('missing'), null);
  assert.deepEqual(store.listAppSecretNames('ai.'), ['ai.claude', 'ai.openai']);
  assert.deepEqual(store.listAppSecretNames(), ['ai.claude', 'ai.openai', 'mcp.github']);
  store.setAppSecret('ai.openai', null);
  assert.equal(store.getAppSecret('ai.openai'), null);
  throwsWith(() => store.setAppSecret('', 'x'), 'invalid_argument');
  throwsWith(() => store.setAppSecret('bad\nname', 'x'), 'invalid_argument');
  throwsWith(() => store.setAppSecret('n', 42), 'invalid_argument');
});

// ─────────────────────────────── passwords and app lock ───────────────────────────────

test('password minimums count Unicode code points after NFC: master 12, workspace 8, export 12', async () => {
  await boot();
  await rejectsWith(() => store.setMasterPassword('elevenchars'), 'invalid_argument');
  await rejectsWith(() => store.setMasterPassword('😀'.repeat(11)), 'invalid_argument', '22 UTF-16 units, 11 characters');
  await rejectsWith(() => store.setMasterPassword('é'.repeat(11)), 'invalid_argument', 'decomposed é counts once');
  await rejectsWith(() => store.createWorkspace({ name: 'W', password: 'seven77' }), 'invalid_argument');
  const ws = await store.createWorkspace({ id: 'w8', name: 'W', password: 'eight888' });
  assert.equal(ws.hasPassword, true);
  await rejectsWith(() => store.exportBundle(path.join(root, 'short.getssh-backup'), 'elevenchars', ['default']), 'invalid_argument');
  await store.unlockWorkspace('w8', { password: 'eight888' });
  await store.removeWorkspacePassword('w8', 'eight888');
  await store.setMasterPassword('é'.repeat(12));
  store.lockApp('manual');
  await store.unlockApp({ password: 'é'.repeat(12) });
  assert.equal(store.appState().phase, 'ready', 'the decomposed form opens the composed password');
  assert.equal(store.appState().masterPasswordMustChange, false);
});

test('workspace passwords: never on MAIN, refused while a master password exists', async () => {
  await boot();
  await rejectsWith(() => store.setWorkspacePassword('default', WS_PW), 'invalid_argument');
  await store.createWorkspace({ id: 'vault', name: 'Vault', password: WS_PW });
  throwsWith(() => store.setMainWorkspace('vault'), 'invalid_argument');
  await rejectsWith(() => store.setWorkspacePassword('vault', 'new-password-1'), 'needs_password', 'current is required');
  await rejectsWith(() => store.setWorkspacePassword('vault', 'new-password-1', 'wrong-current'), 'wrong_password');
  await store.setWorkspacePassword('vault', 'new-password-1', WS_PW);
  assert.equal(await store.verifyPassword('new-password-1', 'vault'), true);
  store.lockWorkspace('vault');
  await rejectsWith(() => store.setMasterPassword(MASTER), 'locked', 'a locked password workspace blocks the first master password');
  await store.unlockWorkspace('vault', { password: 'new-password-1' });
  await store.setMasterPassword(MASTER);
  assert.equal(store.listWorkspaces().find(ws => ws.id === 'vault').hasPassword, false, 'the master password replaces it');
  await rejectsWith(() => store.createWorkspace({ name: 'Other', password: WS_PW }), 'invalid_argument');
  await rejectsWith(() => store.setWorkspacePassword('vault', WS_PW), 'invalid_argument');
});

test('removeWorkspacePassword needs the current password and leaves the workspace open', async () => {
  await boot({ workspaces: [{ id: 'main' }, { id: 'vault', password: WS_PW }] });
  await rejectsWith(() => store.removeWorkspacePassword('main', WS_PW), 'invalid_argument');
  await rejectsWith(() => store.removeWorkspacePassword('vault', 'wrong-pass'), 'wrong_password');
  await store.removeWorkspacePassword('vault', WS_PW);
  const vault = store.listWorkspaces().find(ws => ws.id === 'vault');
  assert.equal(vault.hasPassword, false);
  assert.equal(vault.state, 'open');
  store.lockApp('manual');
  assert.equal(store.listWorkspaces().find(ws => ws.id === 'vault').state, 'open');
});

test('with a master password the app starts locked; unlockApp opens every workspace and lockApp closes them', async () => {
  await boot({
    masterPassword: MASTER,
    workspaces: [{ id: 'main', name: 'Main' }, { id: 'proj', name: 'Project' }],
    profiles: { proj: [profile('p1')] },
  });
  const locked = store.appState();
  assert.equal(locked.phase, 'locked');
  assert.equal(locked.masterPassword, true);
  throwsWith(() => store.listWorkspaces(), 'locked');
  throwsWith(() => store.listProfiles('proj'), 'locked');
  throwsWith(() => store.getGlobalSetting('theme'), 'locked');
  throwsWith(() => store.exportCandidates(), 'locked');
  assert.equal(store.isEncryptedAiMemoryAvailable(), false);
  await rejectsWith(() => store.unlockApp({ password: 'not the password' }), 'wrong_password');
  const ready = await store.unlockApp({ password: MASTER });
  assert.equal(ready.phase, 'ready');
  assert.deepEqual(store.listWorkspaces().map(ws => ws.state), ['open', 'open']);
  assert.equal(store.listProfiles('proj').length, 1);
  assert.equal(store.isEncryptedAiMemoryAvailable(), true);
  store.lockApp('idle');
  assert.equal(store.appState().phase, 'locked');
  assert.equal(fake.snapshot().lastLockReason, 'idle');
  assert.deepEqual(fake.snapshot().workspaces.map(ws => ws.state), ['locked', 'locked']);
  throwsWith(() => store.listProfiles('proj'), 'locked');
  throwsWith(() => store.lockApp('bogus'), 'invalid_argument');
  await store.unlockApp({ password: MASTER });
  store.lockWorkspace('proj');
  throwsWith(() => store.listProfiles('proj'), 'locked');
  assert.equal(await store.openWorkspace('proj'), 'open', 'the master password already covers it');
});

test('unlockApp with Touch ID / Windows Hello: ok, cancelled, unsupported, not enabled', async () => {
  await boot({ masterPassword: MASTER, presenceEnabled: true });
  assert.equal(store.appState().presenceEnabled, true);
  fake.setPresence('cancelled');
  await rejectsWith(() => store.unlockApp({ presence: 'Unlock GETSSH' }), 'cancelled');
  fake.setPresence('unsupported');
  await rejectsWith(() => store.unlockApp({ presence: 'Unlock GETSSH' }), 'unavailable');
  assert.equal(store.appState().presenceSupported, false);
  fake.setPresence('ok');
  assert.equal((await store.unlockApp({ presence: 'Unlock GETSSH' })).phase, 'ready');
  assert.equal(fake.snapshot().unlockedBy, 'presence');
  await boot({ masterPassword: MASTER });
  await rejectsWith(() => store.unlockApp({ presence: 'Unlock GETSSH' }), 'needs_password');
});

test('unlockApp with a recovery code, then a new master password without the old one', async () => {
  await boot();
  const code = await store.createRecoveryCode();
  await boot({ masterPassword: MASTER, recoveryCode: code });
  assert.equal(store.appState().recoveryConfigured, true);
  await rejectsWith(() => store.unlockApp({ recoveryCode: 'not a code' }), 'invalid_argument');
  await boot();
  const otherCode = await store.createRecoveryCode();
  await boot({ masterPassword: MASTER, recoveryCode: code });
  await rejectsWith(() => store.unlockApp({ recoveryCode: otherCode }), 'wrong_password');
  const state = await store.unlockApp({ recoveryCode: code.toLowerCase().replace(/-/g, ' ') });
  assert.equal(state.phase, 'ready');
  await store.setMasterPassword('a brand new master password');
  store.lockApp('manual');
  await rejectsWith(() => store.unlockApp({ password: MASTER }), 'wrong_password');
  await store.unlockApp({ password: 'a brand new master password' });
  assert.equal(store.appState().recoveryConfigured, true, 'changing an existing master password keeps the code');
});

test('without a master password the app is always ready; password workspaces start locked', async () => {
  await boot({ workspaces: [{ id: 'main' }, { id: 'vault', password: WS_PW }] });
  assert.equal(store.appState().phase, 'ready');
  const byId = Object.fromEntries(store.listWorkspaces().map(ws => [ws.id, ws]));
  assert.equal(byId.main.state, 'open');
  assert.equal(byId.vault.state, 'locked');
  assert.equal(byId.vault.hasPassword, true);
  throwsWith(() => store.listProfiles('vault'), 'locked');
  assert.equal(await store.openWorkspace('vault'), 'locked');
  await rejectsWith(() => store.unlockWorkspace('vault', { password: 'wrong-pass' }), 'wrong_password');
  await rejectsWith(() => store.unlockWorkspace('vault', { presence: 'Open Vault' }), 'needs_password');
  await store.unlockWorkspace('vault', { password: WS_PW });
  assert.deepEqual(store.listProfiles('vault'), []);
  store.lockApp('screen-locked');
  const after = Object.fromEntries(store.listWorkspaces().map(ws => [ws.id, ws.state]));
  assert.deepEqual(after, { main: 'open', vault: 'locked' });
  assert.equal((await store.unlockApp({ password: 'anything at all' })).phase, 'ready', 'no master password: nothing to unlock');
});

test('five wrong passwords in a row rate-limit that scope for 30 seconds', async () => {
  await boot({ workspaces: [{ id: 'main' }, { id: 'a', password: WS_PW }, { id: 'b', password: 'other-password' }] });
  for (let i = 0; i < 5; i += 1) {
    await rejectsWith(() => store.unlockWorkspace('a', { password: 'nope-nope' }), 'wrong_password');
  }
  await assert.rejects(() => store.unlockWorkspace('a', { password: WS_PW }), /^Error: \[store:rate_limited\] \d+ ms/);
  await store.unlockWorkspace('b', { password: 'other-password' });
  fake.advance(29_000);
  await rejectsWith(() => store.unlockWorkspace('a', { password: WS_PW }), 'rate_limited');
  fake.advance(1_001);
  await store.unlockWorkspace('a', { password: WS_PW });
  store.lockWorkspace('a');
  await rejectsWith(() => store.unlockWorkspace('a', { password: 'nope-nope' }), 'wrong_password', 'a success resets the count');

  await boot({ masterPassword: MASTER });
  for (let i = 0; i < 5; i += 1) await rejectsWith(() => store.unlockApp({ password: 'wrong-master' }), 'wrong_password');
  await rejectsWith(() => store.unlockApp({ password: MASTER }), 'rate_limited');
  fake.advance(30_001);
  await store.unlockApp({ password: MASTER });
});

test('a master password shorter than 12 characters must be changed before exporting', async () => {
  await boot({ masterPassword: 'elevenchars', presenceEnabled: true });
  assert.equal(store.appState().masterPasswordMustChange, false, 'not known while locked');
  await store.unlockApp({ password: 'elevenchars' });
  assert.equal(store.appState().masterPasswordMustChange, true);
  const file = path.join(root, `weak-${homes}.getssh-backup`);
  await rejectsWith(() => store.exportBundle(file, EXPORT_PW, ['default']), 'must_change_master_password');
  await rejectsWith(() => store.setMasterPassword(MASTER), 'must_change_master_password');
  store.lockApp('sleep');
  assert.equal(store.appState().masterPasswordMustChange, false);
  await store.unlockApp({ presence: 'Unlock' });
  assert.equal(store.appState().masterPasswordMustChange, true, 'stays on until the password changes');
  await rejectsWith(() => store.setMasterPassword(MASTER, 'wrong'), 'wrong_password');
  assert.deepEqual(await store.setMasterPassword(MASTER, 'elevenchars'), { recoveryReset: false });
  assert.equal(store.appState().masterPasswordMustChange, false);
  const report = await store.exportBundle(file, EXPORT_PW, ['default']);
  assert.equal(report.path, file);
});

test('setting a master password resets the recovery code; changing it keeps the code', async () => {
  await boot();
  await store.createRecoveryCode();
  assert.equal(store.appState().recoveryConfigured, true);
  assert.deepEqual(await store.setMasterPassword(MASTER), { recoveryReset: true });
  const state = store.appState();
  assert.equal(state.recoveryConfigured, false);
  assert.equal(state.masterPassword, true);
  assert.equal(state.phase, 'ready');
  await rejectsWith(() => store.createRecoveryCode(), 'needs_password');
  await rejectsWith(() => store.createRecoveryCode('wrong master'), 'wrong_password');
  await store.createRecoveryCode(MASTER);
  assert.deepEqual(await store.setMasterPassword('another master password', MASTER), { recoveryReset: false });
  assert.equal(store.appState().recoveryConfigured, true);
  await rejectsWith(() => store.setMasterPassword('a third master password'), 'needs_password', 'current required');
  await store.removeRecoveryCode();
  assert.equal(store.appState().recoveryConfigured, false);
  await boot();
  assert.deepEqual(await store.setMasterPassword(MASTER), { recoveryReset: false }, 'nothing to reset');
});

test('removeMasterPassword needs the current password and turns presence off', async () => {
  await boot({ masterPassword: MASTER, presenceEnabled: true });
  await store.unlockApp({ password: MASTER });
  await rejectsWith(() => store.removeMasterPassword('wrong'), 'wrong_password');
  await store.removeMasterPassword(MASTER);
  const state = store.appState();
  assert.equal(state.masterPassword, false);
  assert.equal(state.presenceEnabled, false);
  store.lockApp('manual');
  assert.equal(store.appState().phase, 'ready');
  await rejectsWith(() => store.removeMasterPassword(MASTER), 'invalid_argument');
});

test('recovery codes use the keystore format: 32 Crockford symbols in 8 groups with a checksum', async () => {
  await boot();
  const code = await store.createRecoveryCode();
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){7}$/);
  assert.equal(code.length, 39);
  assert.equal(store.isRecoveryCodeWellFormed(code), true);
  assert.equal(store.isRecoveryCodeWellFormed(code.toLowerCase().replace(/-/g, '')), true);
  assert.equal(store.isRecoveryCodeWellFormed(` ${code.replace(/-/g, ' ')} `), true);
  assert.equal(store.isRecoveryCodeWellFormed(code.replace(/0/g, 'O').replace(/1/g, 'L')), true, 'look-alikes');
  const first = code[0] === 'A' ? 'B' : 'A';
  assert.equal(store.isRecoveryCodeWellFormed(first + code.slice(1)), false, 'checksum catches a typo');
  assert.equal(store.isRecoveryCodeWellFormed(code.slice(0, -1)), false);
  assert.equal(store.isRecoveryCodeWellFormed(`${code}-0`), false);
  assert.equal(store.isRecoveryCodeWellFormed(`U${code.slice(1)}`), false, 'U is not in the alphabet');
  assert.equal(store.isRecoveryCodeWellFormed(42), false);
  assert.notEqual(await store.createRecoveryCode(), code);
});

test('verifyPresence: true when confirmed, false when cancelled, unavailable without hardware', async () => {
  await boot();
  const before = fake.snapshot().presencePrompts;
  assert.equal(await store.verifyPresence('Run a high-risk runbook'), true);
  fake.setPresence('cancelled');
  assert.equal(await store.verifyPresence('Run a high-risk runbook'), false);
  fake.setPresence('unsupported');
  await rejectsWith(() => store.verifyPresence('Run a high-risk runbook'), 'unavailable');
  assert.equal(fake.snapshot().presencePrompts - before, 2);
});

test('verifyPassword checks the password that protects the app or the workspace', async () => {
  await boot({ workspaces: [{ id: 'main' }, { id: 'vault', password: WS_PW }] });
  await rejectsWith(() => store.verifyPassword('anything'), 'invalid_argument');
  await rejectsWith(() => store.verifyPassword('anything', 'main'), 'invalid_argument');
  await rejectsWith(() => store.verifyPassword('anything', 'ghost'), 'not_found');
  assert.equal(await store.verifyPassword(WS_PW, 'vault'), true);
  assert.equal(await store.verifyPassword('wrong-pass', 'vault'), false);
  await boot({ masterPassword: MASTER });
  await rejectsWith(() => store.verifyPassword(MASTER), 'locked');
  await store.unlockApp({ password: MASTER });
  assert.equal(await store.verifyPassword(MASTER), true);
  assert.equal(await store.verifyPassword(MASTER, 'default'), true);
  assert.equal(await store.verifyPassword('wrong'), false);
});

test('unlockWorkspaces: one prompt for every presence workspace; the rest are reported in failed', async () => {
  await boot({
    workspaces: [
      { id: 'main' },
      { id: 'a', password: WS_PW, presenceEnabled: true },
      { id: 'b', password: WS_PW, presenceEnabled: true },
      { id: 'c', password: WS_PW },
      { id: 'd' },
    ],
  });
  store.lockWorkspace('d');
  const before = fake.snapshot().presencePrompts;
  const result = await store.unlockWorkspaces(['a', 'b', 'c', 'd', 'ghost', 'a'], 'Export selected workspaces');
  assert.deepEqual(result, {
    unlocked: ['a', 'b', 'd'],
    failed: [{ id: 'c', code: 'needs_password' }, { id: 'ghost', code: 'not_found' }],
  });
  assert.equal(fake.snapshot().presencePrompts - before, 1);
  store.lockApp('manual');
  fake.setPresence('cancelled');
  assert.deepEqual((await store.unlockWorkspaces(['a', 'b'], 'Export')).failed,
    [{ id: 'a', code: 'cancelled' }, { id: 'b', code: 'cancelled' }]);
  fake.setPresence('unsupported');
  const unsupported = await store.unlockWorkspaces(['a', 'c'], 'Export');
  assert.deepEqual(unsupported, { unlocked: [], failed: [{ id: 'a', code: 'unavailable' }, { id: 'c', code: 'needs_password' }] });
  await rejectsWith(() => store.unlockWorkspaces('a', 'Export'), 'invalid_argument');
});

test('setPresence turns Touch ID / Hello on for password workspaces (locked ones on their next unlock)', async () => {
  await boot({ workspaces: [{ id: 'main' }, { id: 'a', password: WS_PW }, { id: 'b', password: 'b-password' }] });
  await store.unlockWorkspace('a', { password: WS_PW });
  fake.setPresence('cancelled');
  await rejectsWith(() => store.setPresence(true, 'Use Touch ID'), 'cancelled');
  fake.setPresence('unsupported');
  await rejectsWith(() => store.setPresence(true, 'Use Touch ID'), 'unavailable');
  fake.setPresence('ok');
  await store.setPresence(true, 'Use Touch ID');
  assert.equal(store.appState().presenceEnabled, true);
  let byId = Object.fromEntries(fake.snapshot().workspaces.map(ws => [ws.id, ws]));
  assert.equal(byId.a.presenceEnabled, true);
  assert.equal(byId.b.presenceEnabled, false);
  assert.equal(byId.b.presencePending, true);
  assert.equal(byId.main.presenceEnabled, false, 'no password: nothing to unlock');
  await store.unlockWorkspace('b', { password: 'b-password' });
  store.lockApp('manual');
  await store.unlockWorkspace('b', { presence: 'Open b' });
  await store.setPresence(false, 'Turn off');
  byId = Object.fromEntries(fake.snapshot().workspaces.map(ws => [ws.id, ws]));
  assert.equal(byId.a.presenceEnabled, false);
  assert.equal(byId.b.presenceEnabled, false);
  assert.equal(store.appState().presenceEnabled, false);
});

// ──────────────────────────────── workspaces ────────────────────────────────

test('workspaces: create, update, set MAIN, open and delete', async () => {
  await boot();
  await rejectsWith(() => store.createWorkspace({ id: '..', name: 'Up' }), 'invalid_argument');
  await rejectsWith(() => store.createWorkspace({ name: '   ' }), 'invalid_argument');
  const created = await store.createWorkspace({ id: 'proj', name: 'Project', themeColor: '#ff0000' });
  assert.deepEqual(
    { ...created, created_at: 0, updated_at: 0 },
    { id: 'proj', name: 'Project', themeColor: '#ff0000', is_main: false, hasPassword: false, presenceEnabled: false, state: 'open', preferences: '{}', created_at: 0, updated_at: 0 },
  );
  assert.match((await store.createWorkspace({ name: 'Generated' })).id, /^[0-9a-f-]{36}$/);
  await rejectsWith(() => store.createWorkspace({ id: 'proj', name: 'Again' }), 'invalid_argument');
  fake.advance(10);
  const updated = store.updateWorkspace('proj', { name: 'Project 2', themeColor: null, preferences: '{"dense":true}' });
  assert.equal(updated.name, 'Project 2');
  assert.equal(updated.themeColor, null);
  assert.equal(updated.preferences, '{"dense":true}');
  assert.ok(updated.updated_at > updated.created_at);
  throwsWith(() => store.updateWorkspace('proj', { preferences: 'not json' }), 'invalid_argument');
  throwsWith(() => store.updateWorkspace('ghost', {}), 'not_found');
  store.upsertAiMemoryVector({ workspace_id: 'default', message_id: 'm', session_id: 's', role: 'user', embedding: Buffer.alloc(8), dimensions: 2, content_hash: 'h', timestamp: 1 });
  await rejectsWith(() => store.deleteWorkspace('default'), 'invalid_argument');
  store.setMainWorkspace('proj');
  assert.deepEqual(store.listWorkspaces().filter(ws => ws.is_main).map(ws => ws.id), ['proj']);
  await store.deleteWorkspace('default');
  assert.equal(fake.snapshot().aiMemoryVectorCount, 0, 'its AI memory goes with it');
  await rejectsWith(() => store.deleteWorkspace('default'), 'not_found');
  assert.equal(await store.openWorkspace('proj'), 'open');
  await rejectsWith(() => store.openWorkspace('ghost'), 'not_found');
});

test('every workspace data function refuses a locked workspace', async () => {
  await boot({ workspaces: [{ id: 'main' }, { id: 'vault', password: WS_PW }] });
  const calls = {
    listProfiles: () => store.listProfiles('vault'),
    saveProfiles: () => store.saveProfiles('vault', []),
    deleteProfiles: () => store.deleteProfiles('vault', []),
    copyProfiles: () => store.copyProfiles('main', 'vault', []),
    connectSecrets: () => store.connectSecrets('vault', 'p1'),
    revealSecret: () => store.revealSecret('vault', 'p1', 'password'),
    importSshKey: () => store.importSshKey('vault', { name: 'k', data: Buffer.from('x') }),
    generateSshKey: () => store.generateSshKey('vault', { name: 'k', algorithm: 'ed25519' }),
    listSshKeys: () => store.listSshKeys('vault'),
    deleteSshKey: () => store.deleteSshKey('vault', 'k'),
    getAssetFolders: () => store.getAssetFolders('vault'),
    createAssetFolder: () => store.createAssetFolder('vault', 'X'),
    renameAssetFolder: () => store.renameAssetFolder('vault', 'X', 'Y'),
    removeAssetFolder: () => store.removeAssetFolder('vault', 'X'),
    moveProfilesToAssetFolder: () => store.moveProfilesToAssetFolder('vault', ['p1'], null),
    getRunbooks: () => store.getRunbooks('vault'),
    saveRunbooks: () => store.saveRunbooks('vault', []),
    getAiSessions: () => store.getAiSessions('vault'),
    createAiSession: () => store.createAiSession('vault', 's', 'title', 1),
    saveAiMessage: () => store.saveAiMessage('vault', { id: 'm', session_id: 's', role: 'user', content: 'c', raw_content: null, timestamp: 1 }),
    updateAiSessionTitle: () => store.updateAiSessionTitle('vault', 's', 't'),
    deleteAiSession: () => store.deleteAiSession('vault', 's'),
    upsertAiMemoryVector: () => store.upsertAiMemoryVector({ workspace_id: 'vault', message_id: 'm', session_id: 's', role: 'user', embedding: Buffer.alloc(4), dimensions: 1, content_hash: 'h', timestamp: 1 }),
    getAiMemoryVectors: () => store.getAiMemoryVectors('vault', 10),
    deleteAiMemoryMessage: () => store.deleteAiMemoryMessage('vault', 'm'),
    deleteAiMemorySession: () => store.deleteAiMemorySession('vault', 's'),
    getRecentAiMessagesForMemory: () => store.getRecentAiMessagesForMemory('vault', 10),
    getAiMessagesByIds: () => store.getAiMessagesByIds('vault', ['m']),
    logAudit: () => store.logAudit('vault', 'connect'),
    getAuditLogs: () => store.getAuditLogs('vault'),
    workspaceStats: () => store.workspaceStats('vault'),
  };
  for (const [name, call] of Object.entries(calls)) throwsWith(call, 'locked', name);
  await rejectsWith(() => store.openReveal('vault', { presence: 'Show' }), 'locked');
  await rejectsWith(() => store.exportBundle(path.join(root, 'locked.getssh-backup'), EXPORT_PW, ['vault']), 'locked');
});

test('workspaceStats counts profiles and runbooks and reports the size in MB', async () => {
  await boot();
  assert.deepEqual(store.workspaceStats('default'), { size: 0, profileCount: 0, runbookCount: 0 });
  store.saveProfiles('default', [profile('p1'), profile('p2')]);
  store.saveRunbooks('default', [{ id: 'r1', title: 'Disk', script: 'df -h', riskLevel: 'LOW', created_at: 1 }]);
  assert.deepEqual(store.workspaceStats('default'), { size: 0.01, profileCount: 2, runbookCount: 1 });
  throwsWith(() => store.workspaceStats('ghost'), 'not_found');
});

test('copyProfiles copies secrets, the SSH keys they use and, when asked, runbooks', async () => {
  await boot({ workspaces: [{ id: 'a' }, { id: 'b' }, { id: 'vault', password: WS_PW }] });
  const key = store.generateSshKey('a', { name: 'deploy', algorithm: 'ed25519' });
  store.saveProfiles('a', [profile('p1', { password: 'pw-1', keyId: key.id, authType: 'key' }), profile('p2')]);
  store.saveRunbooks('a', [{ id: 'r1', title: 'Uptime', script: 'uptime', riskLevel: 'LOW', created_at: 5 }]);
  store.copyProfiles('a', 'b', ['p1'], { includeRunbooks: true });
  assert.deepEqual(store.listProfiles('b').map(p => [p.id, p.keyId, p.hasPassword]), [['p1', key.id, true]]);
  assert.equal(fake.secretsFor('b').profiles.p1.password, 'pw-1');
  assert.deepEqual(store.listSshKeys('b').map(k => k.fingerprint), [key.fingerprint]);
  assert.deepEqual(store.getRunbooks('b').map(rb => [rb.id, rb.workspace_id]), [['r1', 'b']]);
  store.copyProfiles('a', 'b', ['p2']);
  assert.deepEqual(store.listProfiles('b').map(p => p.id), ['p1', 'p2']);
  throwsWith(() => store.copyProfiles('a', 'a', ['p1']), 'invalid_argument');
  throwsWith(() => store.copyProfiles('a', 'b', ['ghost']), 'not_found');
  throwsWith(() => store.copyProfiles('a', 'vault', ['p1']), 'locked');
});

// ──────────────────────────────── SSH keys ────────────────────────────────

test('generateSshKey makes a real OpenSSH ed25519 key that importSshKey reads back', async () => {
  await boot({ workspaces: [{ id: 'a' }, { id: 'b' }] });
  const key = store.generateSshKey('a', { name: 'laptop', algorithm: 'ed25519' });
  assert.deepEqual(Object.keys(key).sort(), ['algorithm', 'created_at', 'fingerprint', 'hasPassphrase', 'id', 'name', 'publicKey']);
  assert.equal(key.algorithm, 'ed25519');
  assert.equal(key.hasPassphrase, false);
  assert.match(key.publicKey, /^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5[A-Za-z0-9+/=]+ laptop$/);
  assert.match(key.fingerprint, /^SHA256:[A-Za-z0-9+/]{43}$/);
  assert.equal(key.fingerprint, fingerprintOf(key.publicKey));
  store.saveProfiles('a', [profile('p1', { authType: 'key', keyId: key.id })]);
  const pem = store.connectSecrets('a', 'p1').privateKey;
  assert.match(pem.toString(), /^-----BEGIN OPENSSH PRIVATE KEY-----\n[\s\S]+\n-----END OPENSSH PRIVATE KEY-----\n$/);
  const imported = store.importSshKey('b', { name: 'copy', data: pem });
  assert.equal(imported.fingerprint, key.fingerprint);
  assert.equal(imported.algorithm, 'ed25519');
  assert.equal(imported.publicKey.split(' ')[1], key.publicKey.split(' ')[1]);
  assert.ok(!JSON.stringify(store.listSshKeys('a')).includes('PRIVATE'));
  throwsWith(() => store.generateSshKey('a', { name: 'rsa', algorithm: 'rsa' }), 'invalid_argument');
  throwsWith(() => store.importSshKey('a', { name: 'junk', data: Buffer.from('hello') }), 'invalid_argument');
  throwsWith(() => store.importSshKey('a', { name: 'junk', data: 'not a buffer' }), 'invalid_argument');
  store.deleteSshKey('a', key.id);
  assert.deepEqual(store.listSshKeys('a'), []);
  assert.equal(store.listProfiles('a')[0].keyId, null, 'profiles that used it lose the reference');
  throwsWith(() => store.deleteSshKey('a', key.id), 'not_found');
});

test('importSshKey reads PEM keys (passphrase checked) and the public half of OpenSSH and PuTTY keys', async () => {
  await boot();
  const rsa = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'key-pass' },
  });
  const data = Buffer.from(rsa.privateKey);
  throwsWith(() => store.importSshKey('default', { name: 'rsa', data }), 'needs_password');
  throwsWith(() => store.importSshKey('default', { name: 'rsa', data, passphrase: 'wrong' }), 'wrong_password');
  const rsaKey = store.importSshKey('default', { name: 'rsa', data, passphrase: 'key-pass' });
  assert.equal(rsaKey.algorithm, 'rsa-2048');
  assert.equal(rsaKey.hasPassphrase, true);
  assert.match(rsaKey.publicKey, /^ssh-rsa AAAAB3NzaC1yc2E/);
  store.saveProfiles('default', [profile('p1', { authType: 'key', keyId: rsaKey.id })]);
  assert.equal(store.connectSecrets('default', 'p1').passphrase.toString(), 'key-pass', 'the key passphrase is used at connect');

  const ec = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'sec1', format: 'pem' },
  });
  const ecKey = store.importSshKey('default', { name: 'ec', data: Buffer.from(ec.privateKey) });
  assert.equal(ecKey.algorithm, 'ecdsa-p256');
  assert.match(ecKey.publicKey, /^ecdsa-sha2-nistp256 /);

  const generated = store.generateSshKey('default', { name: 'g', algorithm: 'ed25519' });
  const blob = Buffer.from(generated.publicKey.split(' ')[1], 'base64');
  const encryptedOpenSsh = Buffer.concat([
    Buffer.from('openssh-key-v1\0', 'latin1'), sshString('aes256-ctr'), sshString('bcrypt'), sshString(crypto.randomBytes(24)),
    Buffer.from([0, 0, 0, 1]), sshString(blob), sshString(crypto.randomBytes(64)),
  ]).toString('base64');
  const openSshPem = Buffer.from(`-----BEGIN OPENSSH PRIVATE KEY-----\n${encryptedOpenSsh}\n-----END OPENSSH PRIVATE KEY-----\n`);
  throwsWith(() => store.importSshKey('default', { name: 'enc', data: openSshPem }), 'needs_password');
  const encrypted = store.importSshKey('default', { name: 'enc', data: openSshPem, passphrase: 'anything' });
  assert.equal(encrypted.hasPassphrase, true);
  assert.equal(encrypted.fingerprint, generated.fingerprint);

  const ppkLines = blob.toString('base64').match(/.{1,64}/g);
  const ppk = Buffer.from([
    'PuTTY-User-Key-File-3: ssh-ed25519', 'Encryption: none', 'Comment: test',
    `Public-Lines: ${ppkLines.length}`, ...ppkLines, 'Private-Lines: 1', 'AAAA', 'Private-MAC: 00', '',
  ].join('\r\n'));
  const putty = store.importSshKey('default', { name: 'putty', data: ppk });
  assert.equal(putty.fingerprint, generated.fingerprint);
  assert.equal(putty.hasPassphrase, false);
  assert.deepEqual(store.listSshKeys('default').map(k => k.name), ['rsa', 'ec', 'g', 'enc', 'putty']);
});

// ──────────────────────────────── other tables ────────────────────────────────

test('global settings round-trip strings', async () => {
  await boot();
  assert.equal(store.getGlobalSetting('theme'), null);
  store.setGlobalSetting('theme', 'dark');
  store.setGlobalSetting('theme', 'light');
  assert.equal(store.getGlobalSetting('theme'), 'light');
  throwsWith(() => store.setGlobalSetting('theme', 3), 'invalid_argument');
});

test('asset folders follow DatabaseManager: parents, validation, rename, remove and move', async () => {
  await boot({ profiles: { default: [profile('p1', { groupName: 'Prod/Web' }), profile('p2'), profile('p3', { groupName: 'a//b' })] } });
  assert.deepEqual(store.getAssetFolders('default'), ['Prod', 'Prod/Web'], 'a malformed legacy label is not a folder');
  assert.deepEqual(store.createAssetFolder('default', 'Dev/API'), { folders: ['Dev', 'Dev/API', 'Prod', 'Prod/Web'], memberships: [] });
  for (const bad of ['', '../x', 'a//b', 'x/./y', `${'x'.repeat(129)}`, 'tab\there', `${'abc/'.repeat(130)}x`, ' ']) {
    assert.throws(() => store.createAssetFolder('default', bad), { message: '[store:invalid_argument] Invalid folder path' }, JSON.stringify(bad));
  }
  const renamed = store.renameAssetFolder('default', 'Prod', 'Production');
  assert.deepEqual(renamed.folders, ['Dev', 'Dev/API', 'Production', 'Production/Web']);
  assert.deepEqual(renamed.memberships, [{ id: 'p1', group: 'Production/Web' }]);
  assert.equal(store.listProfiles('default')[0].group, 'Production/Web');
  assert.throws(() => store.renameAssetFolder('default', 'Production', 'Dev'), { message: '[store:invalid_argument] Destination folder already exists' });
  assert.throws(() => store.renameAssetFolder('default', 'Nope', 'X'), { message: '[store:not_found] Folder does not exist' });
  assert.throws(() => store.renameAssetFolder('default', 'Dev', 'a/b'), { message: '[store:invalid_argument] Invalid folder name' });
  assert.throws(() => store.removeAssetFolder('default', 'Production'), { message: '[store:invalid_argument] Move child folders first' });
  assert.throws(() => store.removeAssetFolder('default', 'Production/Web'), { message: '[store:invalid_argument] Move hosts out of this folder first' });
  assert.deepEqual(store.moveProfilesToAssetFolder('default', ['p1', 'p2'], 'Dev/API').memberships,
    [{ id: 'p1', group: 'Dev/API' }, { id: 'p2', group: 'Dev/API' }]);
  assert.deepEqual(store.getAssetFolders('default'), ['Dev', 'Dev/API'], 'folders that only existed through hosts disappear');
  assert.throws(() => store.moveProfilesToAssetFolder('default', ['p1'], 'Missing'), { message: '[store:not_found] Destination folder does not exist' });
  assert.throws(() => store.moveProfilesToAssetFolder('default', ['ghost'], 'Dev'), { message: '[store:not_found] Saved host does not exist in this workspace' });
  for (const ids of [[], ['p1', 'p1'], [''], 'p1']) {
    assert.throws(() => store.moveProfilesToAssetFolder('default', ids, 'Dev'), { message: '[store:invalid_argument] Invalid profile IDs' });
  }
  assert.deepEqual(store.moveProfilesToAssetFolder('default', ['p1'], 'Dev/API').memberships, [], 'unchanged rows are not reported');
  store.moveProfilesToAssetFolder('default', ['p1', 'p2'], null);
  store.removeAssetFolder('default', 'Dev/API');
  assert.deepEqual(store.removeAssetFolder('default', 'Dev'), { folders: [], memberships: [] });
  assert.equal(store.listProfiles('default')[2].groupName, 'a//b');
});

test('runbooks are replaced as a whole and read oldest first', async () => {
  await boot();
  store.saveRunbooks('default', [
    { id: 'r2', title: 'Restart', script: 'systemctl restart app', riskLevel: 'HIGH', created_at: 20 },
    { id: 'r1', title: 'Disk', script: 'df -h', created_at: 10 },
  ]);
  assert.deepEqual(store.getRunbooks('default'), [
    { id: 'r1', workspace_id: 'default', title: 'Disk', script: 'df -h', riskLevel: 'LOW', created_at: 10 },
    { id: 'r2', workspace_id: 'default', title: 'Restart', script: 'systemctl restart app', riskLevel: 'HIGH', created_at: 20 },
  ]);
  store.saveRunbooks('default', [{ id: 'r3', title: 'Now', script: 'date' }]);
  const [only] = store.getRunbooks('default');
  assert.equal(only.id, 'r3');
  assert.equal(only.created_at, fake.now());
  throwsWith(() => store.saveRunbooks('default', [{ id: 'x', title: 'T' }]), 'invalid_argument');
});

test('AI sessions and messages behave like DatabaseManager', async () => {
  await boot();
  store.createAiSession('default', 's1', 'First', 1000);
  store.createAiSession('default', 's2', 'Second', 2000);
  throwsWith(() => store.createAiSession('default', 's1', 'Again', 1), 'invalid_argument');
  assert.deepEqual(store.getAiSessions('default').map(s => s.id), ['s2', 's1']);
  store.saveAiMessage('default', { id: 'm1', session_id: 's1', role: 'user', content: 'hi', raw_content: null, timestamp: 3000 });
  store.saveAiMessage('default', { id: 'm2', session_id: 's1', role: 'assistant', content: 'hello', raw_content: '{"x":1}', timestamp: 3500 });
  store.saveAiMessage('default', { id: 'm1', session_id: 's1', role: 'user', content: 'hi there', raw_content: null, timestamp: 9999 });
  throwsWith(() => store.saveAiMessage('default', { id: 'm9', session_id: 'ghost', role: 'user', content: 'x', raw_content: null, timestamp: 1 }), 'not_found');
  const [s1, s2] = store.getAiSessions('default');
  assert.equal(s1.id, 's1');
  assert.equal(s1.updated_at, 9999);
  assert.equal(s1.workspace_id, 'default');
  assert.deepEqual(s1.messages, [
    { id: 'm1', session_id: 's1', role: 'user', content: 'hi there', raw_content: null, timestamp: 3000 },
    { id: 'm2', session_id: 's1', role: 'assistant', content: 'hello', raw_content: '{"x":1}', timestamp: 3500 },
  ]);
  assert.deepEqual(s2.messages, []);
  store.updateAiSessionTitle('default', 's1', 'Renamed');
  store.updateAiSessionTitle('default', 'ghost', 'Ignored');
  assert.equal(store.getAiSessions('default')[0].title, 'Renamed');
  store.deleteAiSession('default', 's1');
  assert.deepEqual(store.getAiSessions('default').map(s => s.id), ['s2']);
  assert.deepEqual(store.getAiMessagesByIds('default', ['m1', 'm2']), [], 'messages go with their session');
});

test('AI memory vectors: newest first, at most 2000 rows, session exclusion and deletes', async () => {
  await boot({ workspaces: [{ id: 'main' }, { id: 'other' }] });
  assert.equal(store.isEncryptedAiMemoryAvailable(), true);
  for (let i = 0; i < 2100; i += 1) {
    store.upsertAiMemoryVector({
      workspace_id: 'main', message_id: `m${i}`, session_id: i % 2 ? 'sB' : 'sA', role: i % 2 ? 'assistant' : 'user',
      embedding: Buffer.from([i & 0xff, 1, 2, 3]), dimensions: 1, content_hash: `h${i}`, timestamp: i,
    });
  }
  store.upsertAiMemoryVector({ workspace_id: 'other', message_id: 'x', session_id: 'sA', role: 'user', embedding: Buffer.alloc(4), dimensions: 1, content_hash: 'hx', timestamp: 99_999 });
  const rows = store.getAiMemoryVectors('main', 5000);
  assert.equal(rows.length, 2000);
  assert.equal(rows[0].timestamp, 2099);
  assert.ok(rows.every((row, i) => i === 0 || rows[i - 1].timestamp > row.timestamp));
  assert.ok(Buffer.isBuffer(rows[0].embedding));
  rows[0].embedding.fill(0);
  assert.equal(store.getAiMemoryVectors('main', 1)[0].embedding[1], 1, 'returned buffers are copies');
  assert.equal(store.getAiMemoryVectors('main', 0).length, 1, 'the limit is at least 1');
  assert.ok(store.getAiMemoryVectors('main', 50, 'sA').every(row => row.session_id === 'sB'));
  store.upsertAiMemoryVector({ workspace_id: 'main', message_id: 'm2099', session_id: 'sB', role: 'assistant', embedding: Buffer.alloc(4), dimensions: 1, content_hash: 'new', timestamp: 5000 });
  assert.equal(store.getAiMemoryVectors('main', 1)[0].content_hash, 'new');
  assert.equal(fake.snapshot().aiMemoryVectorCount, 2101);
  store.deleteAiMemoryMessage('main', 'm2099');
  store.deleteAiMemorySession('main', 'sB');
  assert.ok(store.getAiMemoryVectors('main', 2000).every(row => row.session_id === 'sA'));
  assert.equal(store.getAiMemoryVectors('other', 10).length, 1);
  throwsWith(() => store.upsertAiMemoryVector({ workspace_id: 'main', message_id: 'z', session_id: 's', role: 'system', embedding: Buffer.alloc(4), dimensions: 1, content_hash: 'h', timestamp: 1 }), 'invalid_argument');
  throwsWith(() => store.upsertAiMemoryVector({ workspace_id: 'ghost', message_id: 'z', session_id: 's', role: 'user', embedding: Buffer.alloc(4), dimensions: 1, content_hash: 'h', timestamp: 1 }), 'not_found');
  throwsWith(() => store.getAiMemoryVectors('main', Number.NaN), 'invalid_argument');
});

test('AI memory messages: user and assistant only, newest first, at most 2000; by ids at most 32 distinct', async () => {
  await boot();
  store.createAiSession('default', 's1', 'Chat', 0);
  const roles = ['user', 'assistant', 'system', 'tool'];
  for (let i = 0; i < 2100; i += 1) {
    store.saveAiMessage('default', { id: `m${i}`, session_id: 's1', role: roles[i % 4], content: `c${i}`, raw_content: null, timestamp: i });
  }
  const recent = store.getRecentAiMessagesForMemory('default', 10);
  assert.deepEqual(recent.map(m => m.id), ['m2097', 'm2096', 'm2093', 'm2092', 'm2089', 'm2088', 'm2085', 'm2084', 'm2081', 'm2080']);
  assert.deepEqual(Object.keys(recent[0]).sort(), ['content', 'id', 'role', 'session_id', 'timestamp']);
  assert.equal(store.getRecentAiMessagesForMemory('default', 1_000_000).length, 1050, 'only user and assistant rows');
  store.createAiSession('default', 's2', 'More', 0);
  for (let i = 0; i < 1000; i += 1) {
    store.saveAiMessage('default', { id: `n${i}`, session_id: 's2', role: 'user', content: 'x', raw_content: null, timestamp: 10_000 + i });
  }
  assert.equal(store.getRecentAiMessagesForMemory('default', 1_000_000).length, 2000);
  const ids = Array.from({ length: 40 }, (_, i) => `m${i}`);
  const byIds = store.getAiMessagesByIds('default', [...ids, ...ids, 'not-there']);
  assert.equal(byIds.length, 32);
  assert.deepEqual(byIds.map(m => m.id), ids.slice(0, 32));
  assert.deepEqual(store.getAiMessagesByIds('default', []), []);
});

test('audit logs are read newest first, 50 by default', async () => {
  await boot();
  for (let i = 0; i < 60; i += 1) {
    store.logAudit('default', `action-${i}`, i % 2 ? `host-${i}` : undefined);
    fake.advance(1);
  }
  const logs = store.getAuditLogs('default');
  assert.equal(logs.length, 50);
  assert.equal(logs[0].action, 'action-59');
  assert.equal(logs[0].target, 'host-59');
  assert.equal(logs[1].target, '');
  assert.equal(logs[0].details, '');
  assert.equal(logs[0].workspace_id, 'default');
  assert.deepEqual(Object.keys(logs[0]).sort(), ['action', 'created_at', 'details', 'id', 'target', 'workspace_id']);
  assert.equal(store.getAuditLogs('default', 5).length, 5);
  throwsWith(() => store.logAudit('default', 42), 'invalid_argument');
});

// ──────────────────────────────── export and import ────────────────────────────────

const SECRET_MARKERS = ['pw-SECRET-1', 'pp-SECRET-2', 'sk-SECRET-3', 'Alpha Workspace', 'alpha.example', WS_PW];

async function bootExportFixture() {
  await boot({
    workspaces: [
      { id: 'main', name: 'Main' },
      { id: 'alpha', name: 'Alpha Workspace', password: WS_PW, presenceEnabled: true },
      { id: 'beta', name: 'Beta', password: 'beta-password' },
      { id: 'gamma', name: 'Gamma' },
    ],
    profiles: {
      main: [profile('m1')],
      alpha: [{ ...profile('a1', { password: 'pw-SECRET-1', passphrase: 'pp-SECRET-2' }), host: 'alpha.example' }],
    },
    appSecrets: { 'ai.openai': 'sk-SECRET-3' },
    globalSettings: { theme: 'dark' },
  });
  store.lockWorkspace('gamma');
}

test('exportCandidates lists every workspace with its state, unlock routes and profile count', async () => {
  await bootExportFixture();
  assert.deepEqual(store.exportCandidates(), [
    { id: 'main', name: 'Main', is_main: true, state: 'open', unlockWith: [], profileCount: 1 },
    { id: 'alpha', name: 'Alpha Workspace', is_main: false, state: 'locked', unlockWith: ['presence', 'password'], profileCount: 0 },
    { id: 'beta', name: 'Beta', is_main: false, state: 'locked', unlockWith: ['password'], profileCount: 0 },
    { id: 'gamma', name: 'Gamma', is_main: false, state: 'locked', unlockWith: [], profileCount: 0 },
  ]);
  fake.setPresence('unsupported');
  assert.deepEqual(store.exportCandidates()[1].unlockWith, ['password']);
  fake.setPresence('ok');
  await store.unlockWorkspaces(['alpha'], 'Export');
  assert.deepEqual(store.exportCandidates()[1], { id: 'alpha', name: 'Alpha Workspace', is_main: false, state: 'open', unlockWith: [], profileCount: 1 });
});

test('exportBundle needs every chosen workspace open and never writes secrets in plain text', async () => {
  await bootExportFixture();
  const file = path.join(root, `export-${homes}.getssh-backup`);
  await rejectsWith(() => store.exportBundle(file, EXPORT_PW, ['main', 'alpha']), 'locked');
  await rejectsWith(() => store.exportBundle(file, EXPORT_PW, ['main', 'ghost']), 'not_found');
  await rejectsWith(() => store.exportBundle(file, EXPORT_PW, []), 'invalid_argument');
  await rejectsWith(() => store.exportBundle('relative.getssh-backup', EXPORT_PW, ['main']), 'invalid_argument');
  await rejectsWith(() => store.exportBundle(file, 'short', ['main']), 'invalid_argument');
  assert.ok(!fs.existsSync(file));
  await store.unlockWorkspaces(['alpha'], 'Export');
  const report = await store.exportBundle(file, EXPORT_PW, ['main', 'alpha', 'main']);
  assert.deepEqual(report, { path: file, workspaceIds: ['main', 'alpha'], bytes: fs.statSync(file).size });
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.subarray(0, 8).toString('latin1'), 'GETSSHBK');
  assert.equal(bytes.readUInt16BE(8), 1);
  const header = JSON.parse(bytes.subarray(14, 14 + bytes.readUInt32BE(10)).toString('utf8'));
  assert.equal(header.fake, true);
  assert.equal(header.formatVersion, 1);
  const raw = bytes.toString('latin1');
  for (const marker of SECRET_MARKERS) assert.ok(!raw.includes(marker), `"${marker}" must not be readable in the file`);
  assert.ok(!raw.includes(Buffer.from('pw-SECRET-1').toString('base64').slice(0, 12)));
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o077, 0, 'owner-only file');
});

test('inspectBundle checks the password and describes the bundle; damaged files are corrupt', async () => {
  await bootExportFixture();
  await store.unlockWorkspaces(['alpha'], 'Export');
  const file = path.join(root, `inspect-${homes}.getssh-backup`);
  await store.exportBundle(file, EXPORT_PW, ['main', 'alpha']);
  const info = await store.inspectBundle(file, EXPORT_PW);
  assert.equal(info.formatVersion, 1);
  assert.equal(typeof info.createdAt, 'number');
  assert.equal(typeof info.appVersion, 'string');
  assert.deepEqual(info.workspaces, [{ id: 'main', name: 'Main', hasPassword: false }, { id: 'alpha', name: 'Alpha Workspace', hasPassword: true }]);
  await rejectsWith(() => store.inspectBundle(file, 'not the export password'), 'wrong_password');
  const bytes = fs.readFileSync(file);
  const flipped = Buffer.from(bytes);
  flipped[flipped.length - 40] ^= 0x01;
  const damaged = path.join(root, `damaged-${homes}.getssh-backup`);
  fs.writeFileSync(damaged, flipped);
  await rejectsWith(() => store.inspectBundle(damaged, EXPORT_PW), 'corrupt');
  fs.writeFileSync(damaged, bytes.subarray(0, 30));
  await rejectsWith(() => store.inspectBundle(damaged, EXPORT_PW), 'corrupt');
  fs.writeFileSync(damaged, 'SQLite format 3\0 definitely not a bundle');
  await rejectsWith(() => store.inspectBundle(damaged, EXPORT_PW), 'corrupt');
  await rejectsWith(() => store.inspectBundle(path.join(root, 'missing.getssh-backup'), EXPORT_PW), 'not_found');
  assert.equal(store.listWorkspaces().length, 4, 'inspect changes nothing');
});

test('importBundle replaces everything and keeps secrets, workspace passwords and the master password', async () => {
  await boot({
    masterPassword: MASTER,
    workspaces: [{ id: 'main', name: 'Main' }, { id: 'proj', name: 'Project' }],
    profiles: { proj: [profile('p1', { password: 'pw-1' })] },
    appSecrets: { 'ai.openai': 'sk-1' },
    globalSettings: { theme: 'dark' },
  });
  await store.unlockApp({ password: MASTER });
  const key = store.generateSshKey('proj', { name: 'deploy', algorithm: 'ed25519' });
  store.createAiSession('proj', 's1', 'Chat', 1);
  store.saveAiMessage('proj', { id: 'm1', session_id: 's1', role: 'user', content: 'hello', raw_content: null, timestamp: 2 });
  for (const ws of ['main', 'proj']) {
    store.upsertAiMemoryVector({ workspace_id: ws, message_id: 'm1', session_id: 's1', role: 'user', embedding: Buffer.from([1, 2, 3, 4]), dimensions: 1, content_hash: 'h', timestamp: 2 });
  }
  const file = path.join(root, `import-${homes}.getssh-backup`);
  await store.exportBundle(file, EXPORT_PW, ['proj']);

  await boot({ workspaces: [{ id: 'other', name: 'Other' }] });
  await store.createRecoveryCode();
  await rejectsWith(() => store.importBundle(file, 'wrong export password', 'replace'), 'wrong_password');
  await rejectsWith(() => store.importBundle(file, EXPORT_PW, 'merge'), 'invalid_argument');
  assert.deepEqual(store.listWorkspaces().map(ws => ws.id), ['other']);
  const report = await store.importBundle(file, EXPORT_PW, 'replace');
  assert.deepEqual(report.workspaceIds, ['proj']);
  assert.equal(typeof report.backupPath, 'string');
  assert.match(report.backupPath, /\.getssh-backup-\d{8}-\d{6}$/);
  // Until the app relaunches, the store refuses every call.
  throwsWith(() => store.listWorkspaces(), 'unavailable');
  assert.equal(store.appState().phase, 'locked');
  await rejectsWith(() => store.start(), 'unavailable');
  fake.restart();
  await store.start();
  assert.equal(store.appState().phase, 'locked', 'the imported master password protects it');
  await store.unlockApp({ password: MASTER });
  assert.deepEqual(store.listWorkspaces().map(ws => [ws.id, ws.is_main, ws.state]), [['proj', true, 'open']]);
  const state = store.appState();
  assert.equal(state.masterPassword, true);
  assert.equal(state.phase, 'ready');
  assert.equal(state.recoveryConfigured, false, 'recovery codes stay on the old computer');
  assert.equal(state.presenceEnabled, false);
  assert.equal(fake.secretsFor('proj').profiles.p1.password, 'pw-1');
  assert.equal(store.listSshKeys('proj')[0].fingerprint, key.fingerprint);
  assert.equal(store.getAiSessions('proj')[0].messages[0].content, 'hello');
  assert.equal(store.getAppSecret('ai.openai').toString(), 'sk-1');
  assert.equal(store.getGlobalSetting('theme'), 'dark');
  assert.equal(fake.snapshot().aiMemoryVectorCount, 1, 'AI memory of the chosen workspaces only');
  store.lockApp('manual');
  await rejectsWith(() => store.unlockApp({ password: EXPORT_PW }), 'wrong_password');
  await store.unlockApp({ password: MASTER });
  assert.equal(store.listProfiles('proj').length, 1);
});

test('an imported workspace keeps its own password', async () => {
  await bootExportFixture();
  await store.unlockWorkspace('alpha', { password: WS_PW });
  const file = path.join(root, `own-pw-${homes}.getssh-backup`);
  await store.exportBundle(file, EXPORT_PW, ['main', 'alpha']);
  await boot();
  await store.importBundle(file, EXPORT_PW, 'replace');
  fake.restart();
  await store.start();
  assert.deepEqual(store.listWorkspaces().map(ws => [ws.id, ws.hasPassword, ws.is_main, ws.state]), [['main', false, true, 'open'], ['alpha', true, false, 'locked']]);
  store.lockApp('manual');
  throwsWith(() => store.listProfiles('alpha'), 'locked');
  await store.unlockWorkspace('alpha', { password: WS_PW });
  assert.equal(fake.secretsFor('alpha').profiles.a1.passphrase, 'pp-SECRET-2');
});

// ──────────────────────────────── __fake ────────────────────────────────

test('snapshot() never contains a secret; secretsFor() is the only way to see them', async () => {
  await bootExportFixture();
  await store.unlockWorkspace('alpha', { password: WS_PW });
  store.generateSshKey('alpha', { name: 'k', algorithm: 'ed25519' });
  await store.openReveal('alpha', { presence: 'Show' });
  const text = JSON.stringify(fake.snapshot());
  for (const marker of ['pw-SECRET-1', 'pp-SECRET-2', 'sk-SECRET-3', WS_PW, 'PRIVATE KEY']) {
    assert.ok(!text.includes(marker), marker);
  }
  const secrets = fake.secretsFor('alpha');
  assert.equal(secrets.workspacePassword, WS_PW);
  assert.deepEqual(secrets.profiles.a1, { password: 'pw-SECRET-1', passphrase: 'pp-SECRET-2' });
  assert.match(Object.values(secrets.sshKeys)[0].privateKey, /OPENSSH PRIVATE KEY/);
  throwsWith(() => fake.secretsFor('ghost'), 'not_found');
});

test('__fake.seed validates its input and setLatency delays async calls', async () => {
  fake.reset();
  store.configure(freshBaseDir());
  throwsWith(() => fake.seed({ masterPassword: MASTER, workspaces: [{ id: 'w', password: WS_PW }] }), 'invalid_argument');
  throwsWith(() => fake.seed({ workspaces: [{ id: 'w', password: WS_PW, is_main: true }] }), 'invalid_argument');
  throwsWith(() => fake.seed({ workspaces: [{ id: '../x' }] }), 'invalid_argument');
  throwsWith(() => fake.seed({ profiles: { ghost: [] } }), 'invalid_argument');
  throwsWith(() => fake.setPresence('maybe'), 'invalid_argument');
  fake.seed({ workspaces: [{ id: 'w1', name: 'One' }] });
  await store.start();
  fake.setLatency(40);
  const startedAt = Date.now();
  await store.openWorkspace('w1');
  assert.ok(Date.now() - startedAt >= 35);
  fake.setLatency(0);
  const t = fake.now();
  fake.advance(1234);
  assert.ok(fake.now() - t >= 1234);
});

test('GETSSH_FAKE_STORE_SEED and GETSSH_FAKE_STORE_PRESENCE prepare a running app', () => {
  const seedFile = path.join(root, 'seed.json');
  fs.writeFileSync(seedFile, JSON.stringify({ masterPassword: 'elevenchars', presenceEnabled: true, workspaces: [{ id: 'main', name: 'Main' }] }));
  const script = `
    const store = require(${JSON.stringify(fakePath)});
    (async () => {
      store.configure(${JSON.stringify(path.join(root, 'env-home', '.getssh'))});
      await store.start();
      const before = store.appState();
      let presence = null;
      try { await store.unlockApp({ presence: 'Unlock' }); } catch (error) { presence = error.message; }
      await store.unlockApp({ password: 'elevenchars' });
      console.log(JSON.stringify({ before, presence, after: store.appState(), workspaces: store.listWorkspaces().map(ws => ws.id) }));
    })().catch(error => { console.error(error); process.exit(1); });`;
  const env = { ...process.env, GETSSH_FAKE_STORE_SEED: seedFile, GETSSH_FAKE_STORE_PRESENCE: 'cancelled' };
  delete env.GETSSH_FAKE_STORE_DELAY_MS;
  const result = JSON.parse(execFileSync(process.execPath, ['-e', script], { env, encoding: 'utf8' }));
  assert.equal(result.before.phase, 'locked');
  assert.equal(result.before.masterPassword, true);
  assert.match(result.presence, /^\[store:cancelled\] /);
  assert.equal(result.after.masterPasswordMustChange, true);
  assert.deepEqual(result.workspaces, ['main']);
});
