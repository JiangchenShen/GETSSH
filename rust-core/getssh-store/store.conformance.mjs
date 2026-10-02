// Conformance check: runs one scenario against the real getssh-store module and against
// store.fake.js, in separate processes, and reports every step where the error code or the
// shape of the result differs. Extend the scenario when a function moves from the fake to Rust.
//
//   GETSSH_STORE_CONFORMANCE=1 node rust-core/getssh-store/store.conformance.mjs
//
// Needs the built .node. Uses temporary directories only. On a Mac with a Secure Enclave nothing
// persists outside them; on Windows or a Mac without one, the real module creates TPM keys or
// Keychain items named GETSSH-Keystore-*, hence the explicit opt-in. Never prompts: the scenario
// avoids Touch ID / Windows Hello.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const [mode, which, dir] = process.argv.slice(2);

if (mode !== '--child') {
  if (process.env.GETSSH_STORE_CONFORMANCE !== '1') {
    console.error('set GETSSH_STORE_CONFORMANCE=1 (see the top of this file)');
    process.exit(2);
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-conformance-'));
  try {
    const run = (kind) => {
      const target = path.join(root, kind);
      fs.mkdirSync(target);
      return JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--child', kind, target], { encoding: 'utf8' }));
    };
    const real = run('real');
    const fake = run('fake');
    let diffs = 0;
    for (let i = 0; i < Math.max(real.length, fake.length); i++) {
      if (JSON.stringify(real[i]) !== JSON.stringify(fake[i])) {
        diffs++;
        console.log(`DIFF ${real[i]?.[0] ?? fake[i]?.[0]}\n  real: ${JSON.stringify(real[i]?.slice(1))}\n  fake: ${JSON.stringify(fake[i]?.slice(1))}`);
      }
    }
    console.log(`${real.length} steps, ${diffs} differences`);
    process.exitCode = diffs ? 1 : 0;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
} else {
  const s = require(path.join(here, which === 'fake' ? 'store.fake.js' : 'index.js'));
  const shape = (v) => {
    if (v === null || v === undefined) return String(v);
    if (Buffer.isBuffer(v)) return 'Buffer';
    if (Array.isArray(v)) return v.length ? [shape(v[0]), `len${v.length}`] : [];
    if (typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, shape(v[k])]));
    return typeof v;
  };
  const out = [];
  const step = async (name, fn, keep) => {
    try {
      const v = await fn();
      out.push([name, 'ok', keep ? keep(v) : shape(v)]);
    } catch (e) {
      const m = /^\[store:([a-z_]+)\]/.exec(e.message);
      out.push([name, 'ERR', m ? m[1] : 'RAW ' + e.message]);
    }
  };

  await step('appState before configure', () => s.appState(), v => v.phase);
  s.configure(dir, '3.0.0');
  await step('listWorkspaces before start', () => s.listWorkspaces());
  await step('start', () => s.start());
  await step('appState', () => s.appState());
  await step('appState backend', () => s.appState(), v => ['secure-enclave', 'keychain', 'tpm', 'dpapi', 'unsupported'].includes(v.deviceBackend));
  await step('listWorkspaces', () => s.listWorkspaces());
  await step('createWorkspace bad id', () => s.createWorkspace({ id: '../x', name: 'X' }));
  await step('createWorkspace', () => s.createWorkspace({ id: 'w1', name: 'W1', themeColor: '#fff' }));
  await step('createWorkspace dup', () => s.createWorkspace({ id: 'w1', name: 'W1' }));
  await step('createWorkspace pw short', () => s.createWorkspace({ id: 'p0', name: 'P0', password: 'short' }));
  await step('createWorkspace pw', () => s.createWorkspace({ id: 'p1', name: 'P1', password: 'eight-chars' }));
  await step('setWorkspacePassword on main', () => s.setWorkspacePassword('default', 'eight-chars'));
  await step('saveProfiles', () => s.saveProfiles('w1', [{ id: 'a', host: 'h', username: 'u', password: 'pw-a', groupName: 'G' }]));
  await step('listProfiles', () => s.listProfiles('w1'));
  await step('listProfiles missing ws', () => s.listProfiles('nope'));
  await step('connectSecrets', () => s.connectSecrets('w1', 'a'));
  await step('connectSecrets missing', () => s.connectSecrets('w1', 'zz'));
  await step('saveProfiles keep', () => s.saveProfiles('w1', [{ id: 'a', host: 'h2', username: 'u' }]));
  await step('secret kept', () => s.connectSecrets('w1', 'a'), v => v.password && v.password.toString());
  await step('saveProfiles clear', () => s.saveProfiles('w1', [{ id: 'a', host: 'h2', username: 'u', password: null }]));
  await step('secret cleared', () => s.connectSecrets('w1', 'a'), v => v.password);
  await step('deleteProfiles', () => s.deleteProfiles('w1', ['a']));
  await step('workspaceStats', () => s.workspaceStats('w1'));
  await step('updateWorkspace', () => s.updateWorkspace('w1', { name: 'W1b' }));
  await step('setMainWorkspace', () => s.setMainWorkspace('w1'));
  await step('setMainWorkspace back', () => s.setMainWorkspace('default'));
  await step('deleteWorkspace main', () => s.deleteWorkspace('default'));
  await step('lockWorkspace p1', () => s.lockWorkspace('p1'));
  await step('listProfiles locked', () => s.listProfiles('p1'));
  await step('openWorkspace locked', () => s.openWorkspace('p1'));
  await step('unlockWorkspace wrong', () => s.unlockWorkspace('p1', { password: 'wrong-pass' }));
  await step('unlockWorkspaces', () => s.unlockWorkspaces(['w1', 'p1'], 'r'));
  await step('exportCandidates', () => s.exportCandidates());
  await step('verifyPassword app wrong (no master)', () => s.verifyPassword('whatever-pass'));
  await step('verifyPassword ws wrong', () => s.verifyPassword('wrong-pass', 'p1'));
  await step('verifyPassword ws right', () => s.verifyPassword('eight-chars', 'p1'));
  await step('setMasterPassword short', () => s.setMasterPassword('short-pass'));
  await step('setMasterPassword with locked pw ws', () => s.setMasterPassword('correct horse battery'));
  await step('unlockWorkspace p1', () => s.unlockWorkspace('p1', { password: 'eight-chars' }));
  await step('setMasterPassword', () => s.setMasterPassword('correct horse battery'));
  await step('p1 after master', () => s.listWorkspaces(), v => v.filter(w => w.id === 'p1').map(w => [w.hasPassword, w.state]));
  await step('setMasterPassword again no current', () => s.setMasterPassword('another long password'));
  await step('setMasterPassword wrong current', () => s.setMasterPassword('another long password', 'nope nope nope'));
  await step('createWorkspace pw under master', () => s.createWorkspace({ id: 'p2', name: 'P2', password: 'eight-chars' }));
  await step('createRecoveryCode no current', () => s.createRecoveryCode());
  await step('createRecoveryCode', () => s.createRecoveryCode('correct horse battery'), v => typeof v);
  await step('appState master', () => s.appState(), v => [v.phase, v.masterPassword, v.recoveryConfigured]);
  await step('lockApp', () => s.lockApp('manual'));
  await step('appState locked', () => s.appState(), v => v.phase);
  await step('listWorkspaces locked', () => s.listWorkspaces());
  await step('listProfiles locked app', () => s.listProfiles('default'));
  await step('getGlobalSetting locked', () => s.getGlobalSetting('x'));
  await step('exportCandidates locked', () => s.exportCandidates());
  await step('unlockApp presence not enabled', () => s.unlockApp({ presence: 'r' }));
  await step('unlockApp bad route', () => s.unlockApp({ password: 'a', presence: 'b' }));
  await step('unlockApp wrong', () => s.unlockApp({ password: 'wrong password!' }));
  await step('unlockApp', () => s.unlockApp({ password: 'correct horse battery' }), v => v.phase);
  await step('setGlobalSetting', () => s.setGlobalSetting('k', 'v'));
  await step('getGlobalSetting', () => s.getGlobalSetting('k'), v => v);
  await step('getGlobalSetting missing', () => s.getGlobalSetting('missing'), v => v);
  await step('isRecoveryCodeWellFormed', () => s.isRecoveryCodeWellFormed('nope'), v => v);
  await step('removeMasterPassword wrong', () => s.removeMasterPassword('nope nope nope'));
  await step('removeMasterPassword', () => s.removeMasterPassword('correct horse battery'));
  await step('appState after remove', () => s.appState(), v => [v.phase, v.masterPassword, v.recoveryConfigured]);
  for (let i = 0; i < 6; i++) await step(`ws wrong ${i}`, () => s.unlockWorkspace('p1', { password: 'x-wrong-' + i }));
  await step('openReveal no route', () => s.openReveal('w1', {}));
  await step('revealSecret closed', () => s.revealSecret('w1', 'a', 'password'));
  await step('closeReveal', () => s.closeReveal('w1'));
  await step('exportBundle relative', () => s.exportBundle('rel.bak', 'bundle password 1', ['default']));
  await step('inspectBundle missing', () => s.inspectBundle(dir + '/missing.bak', 'bundle password 1'));
  await step('importBundle merge', () => s.importBundle(dir + '/missing.bak', 'bundle password 1', 'merge'));

  await step('createWorkspace q1', () => s.createWorkspace({ id: 'q1', name: 'Q1', password: 'eight-chars' }), v => [v.hasPassword, v.state]);
  await step('saveProfiles q1', () => s.saveProfiles('q1', [{ id: 'k', host: 'h', username: 'u', password: 'k-secret' }]), v => v.length);
  await step('lockWorkspace q1', () => s.lockWorkspace('q1'));
  await step('exportCandidates mixed', () => s.exportCandidates(), v => v.map(c => [c.id, c.state, c.unlockWith, c.profileCount]));
  await step('exportBundle locked', () => s.exportBundle(dir + '/out.bak', 'bundle password 1', ['default', 'q1']));
  await step('unlockWorkspaces mixed', () => s.unlockWorkspaces(['w1', 'q1'], 'r'), v => v);
  await step('unlockWorkspace q1', () => s.unlockWorkspace('q1', { password: 'eight-chars' }));
  await step('unlockWorkspace q1 again (open)', () => s.unlockWorkspace('q1', { password: 'wrong-but-open' }));
  await step('exportBundle', () => s.exportBundle(dir + '/out.bak', 'bundle password 1', ['default', 'q1']), v => [v.workspaceIds, typeof v.bytes, typeof v.path]);
  await step('inspectBundle wrong', () => s.inspectBundle(dir + '/out.bak', 'wrong password!'));
  await step('inspectBundle', () => s.inspectBundle(dir + '/out.bak', 'bundle password 1'), v => [v.formatVersion, v.appVersion, v.workspaces, typeof v.createdAt]);
  await step('inspectBundle not a bundle', async () => { fs.writeFileSync(dir + '/junk.bak', 'SQLite format 3\0'); return s.inspectBundle(dir + '/junk.bak', 'bundle password 1'); });
  await step('importBundle', () => s.importBundle(dir + '/out.bak', 'bundle password 1', 'replace'), v => [v.workspaceIds, typeof v.backupPath]);
  await step('listWorkspaces after import', () => s.listWorkspaces());
  await step('appState after import', () => s.appState(), v => v.phase);
  process.stdout.write(JSON.stringify(out));
}
