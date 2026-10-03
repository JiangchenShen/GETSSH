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
  await step('getRunbooks before start', () => s.getRunbooks('default'));
  await step('setAppSecret before start', () => s.setAppSecret('a', 'b'));
  await step('isEncryptedAiMemoryAvailable before start', () => s.isEncryptedAiMemoryAvailable(), v => v);
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
  await step('isEncryptedAiMemoryAvailable locked', () => s.isEncryptedAiMemoryAvailable(), v => v);
  await step('getAiMemoryVectors locked app', () => s.getAiMemoryVectors('default', 10));
  await step('getAuditLogs locked app', () => s.getAuditLogs('default'));
  await step('setAppSecret locked', () => s.setAppSecret('ai/openai', 'x'));
  await step('getAppSecret locked', () => s.getAppSecret('ai/openai'));
  await step('listAppSecretNames locked', () => s.listAppSecretNames());
  await step('exportCandidates locked', () => s.exportCandidates());
  await step('unlockApp presence not enabled', () => s.unlockApp({ presence: 'r' }));
  await step('unlockApp bad route', () => s.unlockApp({ password: 'a', presence: 'b' }));
  await step('unlockApp wrong', () => s.unlockApp({ password: 'wrong password!' }));
  await step('unlockApp', () => s.unlockApp({ password: 'correct horse battery' }), v => v.phase);
  await step('setGlobalSetting', () => s.setGlobalSetting('k', 'v'));
  await step('getGlobalSetting', () => s.getGlobalSetting('k'), v => v);
  await step('getGlobalSetting missing', () => s.getGlobalSetting('missing'), v => v);
  await step('setAppSecret', () => s.setAppSecret('ai/openai', 'sk-openai'));
  await step('setAppSecret 2', () => s.setAppSecret('ai/anthropic', 'sk-ant'));
  await step('setAppSecret empty value', () => s.setAppSecret('plugin/x', ''));
  await step('getAppSecret', () => s.getAppSecret('ai/openai'), v => [Buffer.isBuffer(v), v.toString()]);
  await step('getAppSecret empty value', () => s.getAppSecret('plugin/x'), v => [Buffer.isBuffer(v), v.length]);
  await step('getAppSecret missing', () => s.getAppSecret('missing'), v => v);
  await step('listAppSecretNames', () => s.listAppSecretNames(), v => v);
  await step('listAppSecretNames prefix', () => s.listAppSecretNames('ai/'), v => v);
  await step('listAppSecretNames empty prefix', () => s.listAppSecretNames(''), v => v);
  await step('listAppSecretNames null prefix', () => s.listAppSecretNames(null), v => v);
  await step('setAppSecret overwrite', () => s.setAppSecret('ai/openai', 'sk-rotated'));
  await step('getAppSecret overwritten', () => s.getAppSecret('ai/openai'), v => v.toString());
  await step('setAppSecret delete', () => s.setAppSecret('plugin/x', null));
  await step('getAppSecret deleted', () => s.getAppSecret('plugin/x'), v => v);
  await step('setAppSecret delete missing', () => s.setAppSecret('never-set', null));
  await step('setAppSecret empty name', () => s.setAppSecret('', 'v'));
  await step('setAppSecret control name', () => s.setAppSecret('a\u0001b', 'v'));
  await step('setAppSecret long name', () => s.setAppSecret('n'.repeat(257), 'v'));
  await step('getAppSecret empty name', () => s.getAppSecret(''));
  await step('isRecoveryCodeWellFormed', () => s.isRecoveryCodeWellFormed('nope'), v => v);
  await step('removeMasterPassword wrong', () => s.removeMasterPassword('nope nope nope'));
  await step('removeMasterPassword', () => s.removeMasterPassword('correct horse battery'));
  await step('appState after remove', () => s.appState(), v => [v.phase, v.masterPassword, v.recoveryConfigured]);
  await step('getAppSecret after master removed', () => s.getAppSecret('ai/openai'), v => v.toString());
  for (let i = 0; i < 6; i++) await step(`ws wrong ${i}`, () => s.unlockWorkspace('p1', { password: 'x-wrong-' + i }));
  await step('openReveal no route', () => s.openReveal('w1', {}));
  await step('revealSecret closed', () => s.revealSecret('w1', 'a', 'password'));
  await step('closeReveal', () => s.closeReveal('w1'));
  await step('exportBundle relative', () => s.exportBundle('rel.bak', 'bundle password 1', ['default']));
  await step('inspectBundle missing', () => s.inspectBundle(dir + '/missing.bak', 'bundle password 1'));
  await step('importBundle merge', () => s.importBundle(dir + '/missing.bak', 'bundle password 1', 'merge'));

  // ── S3: asset folders, runbooks, AI sessions and memory, audit log, copyProfiles ──
  const P = (id, extra = {}) => ({ id, host: id + '.example', username: 'u', ...extra });
  await step('S3 createWorkspace locked one', () => s.createWorkspace({ id: 's3l', name: 'S3L', password: 'eight-chars' }), v => v.state);
  await step('S3 lockWorkspace', () => s.lockWorkspace('s3l'));
  await step('S3 saveProfiles', () => s.saveProfiles('w1', [P('f1', { groupName: 'Prod/DB' }), P('f2'), P('c1', { password: 'c1-secret', passphrase: 'c1-passphrase' }), P('f3', { groupName: 'Production' })]), v => v.map(x => [x.id, x.groupName]));

  await step('saveProfiles round trip', () => s.saveProfiles('w1', s.listProfiles('w1')), v => v.map(x => [x.id, x.alias, x.groupName, x.hasPassword, x.hasPassphrase]));
  await step('saveProfiles null fields', () => s.saveProfiles('w1', s.listProfiles('w1').map(x => ({ ...x, alias: null, proxyJump: null, keyId: null }))), v => v.length);
  await step('getAssetFolders', () => s.getAssetFolders('w1'), v => v);
  await step('createAssetFolder', () => s.createAssetFolder('w1', 'Ops/Staging'), v => v);
  await step('createAssetFolder empty', () => s.createAssetFolder('w1', ''));
  await step('createAssetFolder double slash', () => s.createAssetFolder('w1', 'a//b'));
  await step('createAssetFolder dot dot', () => s.createAssetFolder('w1', 'a/..'));
  await step('renameAssetFolder', () => s.renameAssetFolder('w1', 'Prod', 'Live'), v => v);
  await step('renameAssetFolder onto existing', () => s.renameAssetFolder('w1', 'Live', 'Ops'));
  await step('renameAssetFolder missing', () => s.renameAssetFolder('w1', 'Nope', 'X'));
  await step('renameAssetFolder slash in name', () => s.renameAssetFolder('w1', 'Live', 'a/b'));
  await step('renameAssetFolder same name', () => s.renameAssetFolder('w1', 'Live', 'Live'), v => v);
  await step('removeAssetFolder with child', () => s.removeAssetFolder('w1', 'Live'));
  await step('removeAssetFolder with host', () => s.removeAssetFolder('w1', 'Live/DB'));
  await step('removeAssetFolder missing', () => s.removeAssetFolder('w1', 'Nope'));
  await step('removeAssetFolder', () => s.removeAssetFolder('w1', 'Ops/Staging'), v => v);
  await step('moveProfilesToAssetFolder', () => s.moveProfilesToAssetFolder('w1', ['f2', 'f1'], 'Ops'), v => v);
  await step('moveProfilesToAssetFolder out', () => s.moveProfilesToAssetFolder('w1', ['f2'], null), v => v);
  await step('moveProfilesToAssetFolder unknown host', () => s.moveProfilesToAssetFolder('w1', ['zz'], 'Ops'));
  await step('moveProfilesToAssetFolder missing folder', () => s.moveProfilesToAssetFolder('w1', ['f2'], 'Nope'));
  await step('moveProfilesToAssetFolder none', () => s.moveProfilesToAssetFolder('w1', [], null));
  await step('moveProfilesToAssetFolder duplicate', () => s.moveProfilesToAssetFolder('w1', ['f2', 'f2'], null));
  await step('getAssetFolders locked', () => s.getAssetFolders('s3l'));
  await step('getAssetFolders missing ws', () => s.getAssetFolders('nope'));

  const RB = (id, extra = {}) => ({ id, title: id + ' title', script: 'uptime', ...extra });
  await step('saveRunbooks', () => s.saveRunbooks('w1', [RB('r2', { riskLevel: 'HIGH', created_at: 2 }), RB('r1', { created_at: 1 }), RB('r3', { riskLevel: '', created_at: 2 })]));
  await step('getRunbooks', () => s.getRunbooks('w1'), v => v.map(r => [r.id, r.workspace_id, r.title, r.riskLevel, r.created_at]));
  await step('getRunbooks shape', () => s.getRunbooks('w1'));
  await step('saveRunbooks duplicate', () => s.saveRunbooks('w1', [RB('d'), RB('d')]));
  await step('saveRunbooks empty id', () => s.saveRunbooks('w1', [RB('')]));
  await step('saveRunbooks infinite created_at', () => s.saveRunbooks('w1', [RB('e', { created_at: Infinity })]));
  await step('saveRunbooks defaults', () => s.saveRunbooks('w1', [RB('r9')]));
  await step('getRunbooks defaults', () => s.getRunbooks('w1'), v => v.map(r => [r.id, r.riskLevel, r.created_at > 1e12]));
  await step('getRunbooks locked', () => s.getRunbooks('s3l'));

  const M = (id, session, role, timestamp, extra = {}) => ({ id, session_id: session, role, content: id + ' text', timestamp, ...extra });
  await step('createAiSession', () => s.createAiSession('w1', 's1', 'First', 100));
  await step('createAiSession 2', () => s.createAiSession('w1', 's2', 'Second', 200));
  await step('createAiSession duplicate', () => s.createAiSession('w1', 's1', 'Again', 300));
  await step('createAiSession empty id', () => s.createAiSession('w1', '', 'X', 1));
  await step('createAiSession NaN', () => s.createAiSession('w1', 's9', 'X', NaN));
  await step('saveAiMessage', () => s.saveAiMessage('w1', M('m2', 's1', 'assistant', 120)));
  await step('saveAiMessage 2', () => s.saveAiMessage('w1', M('m1', 's1', 'user', 110, { raw_content: '' })));
  await step('saveAiMessage tool', () => s.saveAiMessage('w1', M('t1', 's1', 'tool', 130)));
  await step('saveAiMessage missing session', () => s.saveAiMessage('w1', M('m9', 'nope', 'user', 1)));
  await step('saveAiMessage edit', () => s.saveAiMessage('w1', M('m2', 's1', 'system', 500, { content: 'edited', raw_content: 'raw' })));
  await step('saveAiMessage raw null', () => s.saveAiMessage('w1', M('m3', 's2', 'user', 210, { raw_content: null })));
  await step('saveAiMessage round trip', () => s.saveAiMessage('w1', s.getAiSessions('w1').find(x => x.id === 's2').messages[0]));
  await step('getAiSessions', () => s.getAiSessions('w1'), v => v.map(x => [x.id, x.workspace_id, x.title, x.created_at, x.updated_at, x.messages.map(m => [m.id, m.session_id, m.role, m.content, m.raw_content, m.timestamp])]));
  await step('getAiSessions shape', () => s.getAiSessions('w1'));
  await step('updateAiSessionTitle', () => s.updateAiSessionTitle('w1', 's2', 'Renamed'));
  await step('updateAiSessionTitle missing', () => s.updateAiSessionTitle('w1', 'missing', 'X'));
  await step('getRecentAiMessagesForMemory', () => s.getRecentAiMessagesForMemory('w1', 10), v => v.map(m => [m.id, m.role, m.timestamp]));
  await step('getRecentAiMessagesForMemory shape', () => s.getRecentAiMessagesForMemory('w1', 10));
  await step('getRecentAiMessagesForMemory limit 0', () => s.getRecentAiMessagesForMemory('w1', 0), v => v.length);
  await step('getRecentAiMessagesForMemory NaN', () => s.getRecentAiMessagesForMemory('w1', NaN));
  await step('getAiMessagesByIds', () => s.getAiMessagesByIds('w1', ['m2', 'm1', 'm2', 'missing']), v => v.map(m => m.id));
  await step('getAiMessagesByIds empty', () => s.getAiMessagesByIds('w1', []), v => v);
  await step('getAiSessions locked', () => s.getAiSessions('s3l'));

  const V = (id, session, timestamp, extra = {}) => ({ workspace_id: 'w1', message_id: id, session_id: session, role: 'user', embedding: Buffer.from([1, 2, 3]), dimensions: 3, content_hash: 'h-' + id, timestamp, ...extra });
  await step('isEncryptedAiMemoryAvailable', () => s.isEncryptedAiMemoryAvailable(), v => v);
  await step('upsertAiMemoryVector', () => s.upsertAiMemoryVector(V('m1', 's1', 10)));
  await step('upsertAiMemoryVector 2', () => s.upsertAiMemoryVector(V('m2', 's2', 20)));
  await step('upsertAiMemoryVector again', () => s.upsertAiMemoryVector(V('m1', 's1', 30)));
  await step('getAiMemoryVectors', () => s.getAiMemoryVectors('w1', 10), v => v.map(x => [x.workspace_id, x.message_id, x.session_id, x.role, [...x.embedding], x.dimensions, x.content_hash, x.timestamp]));
  await step('getAiMemoryVectors shape', () => s.getAiMemoryVectors('w1', 10));
  await step('getAiMemoryVectors exclude', () => s.getAiMemoryVectors('w1', 10, 's1'), v => v.map(x => x.message_id));
  await step('getAiMemoryVectors exclude empty', () => s.getAiMemoryVectors('w1', 10, ''), v => v.length);
  await step('getAiMemoryVectors limit 0', () => s.getAiMemoryVectors('w1', 0), v => v.length);
  await step('getAiMemoryVectors NaN', () => s.getAiMemoryVectors('w1', NaN));
  await step('upsertAiMemoryVector bad role', () => s.upsertAiMemoryVector(V('x', 's', 1, { role: 'system' })));
  await step('upsertAiMemoryVector bad dimensions', () => s.upsertAiMemoryVector(V('x', 's', 1, { dimensions: 1.5 })));
  await step('upsertAiMemoryVector empty id', () => s.upsertAiMemoryVector(V('', 's', 1)));
  await step('upsertAiMemoryVector locked ws', () => s.upsertAiMemoryVector(V('x', 's', 1, { workspace_id: 's3l' })));
  await step('getAiMemoryVectors locked ws', () => s.getAiMemoryVectors('s3l', 10));
  await step('upsertAiMemoryVector 3', () => s.upsertAiMemoryVector(V('m3', 's2', 40)));
  await step('upsertAiMemoryVector other workspace', () => s.upsertAiMemoryVector(V('m1', 's1', 50, { workspace_id: 'default', embedding: Buffer.from([9]) })));
  await step('getAiMemoryVectors per workspace', () => s.getAiMemoryVectors('w1', 10), v => v.map(x => [x.workspace_id, x.message_id, [...x.embedding]]));
  await step('deleteAiMemoryMessage', () => s.deleteAiMemoryMessage('w1', 'm2'));
  await step('getAiMemoryVectors after message delete', () => s.getAiMemoryVectors('w1', 10), v => v.map(x => x.message_id));
  await step('deleteAiMemorySession', () => s.deleteAiMemorySession('w1', 's1'));
  await step('getAiMemoryVectors after session delete', () => s.getAiMemoryVectors('w1', 10), v => v.map(x => x.message_id));
  await step('getAiMemoryVectors other workspace kept', () => s.getAiMemoryVectors('default', 10), v => v.map(x => [x.workspace_id, x.message_id, x.session_id]));
  await step('deleteAiSession', () => s.deleteAiSession('w1', 's1'));
  await step('getAiSessions after delete', () => s.getAiSessions('w1'), v => v.map(x => [x.id, x.title, x.messages.map(m => m.id)]));
  await step('getAiMessagesByIds after delete', () => s.getAiMessagesByIds('w1', ['m1', 'm2', 'm3']), v => v.map(m => m.id));

  await step('logAudit', () => s.logAudit('w1', 'connect'));
  await step('logAudit with target', () => s.logAudit('w1', 'delete', 'host', 'details'));
  await step('getAuditLogs', () => s.getAuditLogs('w1'), v => v.map(l => [l.workspace_id, l.action, l.target, l.details, typeof l.id, typeof l.created_at]));
  await step('getAuditLogs shape', () => s.getAuditLogs('w1'));
  await step('getAuditLogs limit 1', () => s.getAuditLogs('w1', 1), v => v.length);
  await step('getAuditLogs limit -1', () => s.getAuditLogs('w1', -1), v => v.length);
  await step('getAuditLogs limit 0', () => s.getAuditLogs('w1', 0), v => v.length);
  await step('getAuditLogs NaN', () => s.getAuditLogs('w1', NaN));
  await step('logAudit locked', () => s.logAudit('s3l', 'x'));

  await step('S3 createWorkspace copy target', () => s.createWorkspace({ id: 'cp', name: 'CP' }), v => v.state);
  await step('copyProfiles without runbooks', () => s.copyProfiles('w1', 'cp', ['c1'], { includeRunbooks: false }));
  await step('copyProfiles without runbooks: none copied', () => s.getRunbooks('cp'), v => v.map(r => r.id));
  await step('copyProfiles without runbooks: secrets', () => s.connectSecrets('cp', 'c1'), v => [v.password && v.password.toString(), v.passphrase && v.passphrase.toString()]);
  await step('copyProfiles', () => s.copyProfiles('w1', 'default', ['c1', 'f1', 'c1'], { includeRunbooks: true }));
  await step('copyProfiles secret', () => s.connectSecrets('default', 'c1'), v => [v.password && v.password.toString(), v.passphrase && v.passphrase.toString()]);
  await step('copyProfiles profiles', () => s.listProfiles('default'), v => v.map(p => [p.id, p.groupName, p.hasPassword]));
  await step('copyProfiles runbooks', () => s.getRunbooks('default'), v => v.map(r => [r.id, r.workspace_id]));
  await step('copyProfiles again (replaces)', () => s.copyProfiles('w1', 'default', ['c1'], null));
  await step('copyProfiles same workspace', () => s.copyProfiles('w1', 'w1', ['c1']));
  await step('copyProfiles missing profile', () => s.copyProfiles('w1', 'default', ['zz']));
  await step('copyProfiles missing target', () => s.copyProfiles('w1', 'nope', ['c1']));
  await step('copyProfiles locked target', () => s.copyProfiles('w1', 's3l', ['c1']));
  await step('S3 deleteWorkspace locked one', () => s.deleteWorkspace('s3l'));
  await step('S3 deleteWorkspace copy target', () => s.deleteWorkspace('cp'));

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
  await step('getRunbooks after import', () => s.getRunbooks('default'));
  await step('isEncryptedAiMemoryAvailable after import', () => s.isEncryptedAiMemoryAvailable());
  await step('getAppSecret after import', () => s.getAppSecret('ai/openai'));
  process.stdout.write(JSON.stringify(out));
}
