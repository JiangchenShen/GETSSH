// Electron main-process entry for run.mjs; one phase per process (KS_PHASE). Legacy files are
// written with --use-mock-keychain, never the real Keychain. Nothing here can prompt.
//
// The app side of getssh-store: the GETSSH 2.x migration (TypeScript, getssh-keystore) handing
// over to the store, appLock, and DatabaseManager on top of the store.
import { app, BrowserWindow, ipcMain } from 'electron';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3-multiple-ciphers';
import { Server as SshServer, utils as sshUtils } from 'ssh2';
import { registerAssetFolderHandlers } from '../../../electron/main/handlers/assetFolderHandler';
import { registerCryptoHandlers } from '../../../electron/main/handlers/cryptoHandler';
import { registerKeystoreHandlers } from '../../../electron/main/handlers/keystoreHandler';
import { registerSshHandlers } from '../../../electron/main/handlers/sshHandler';
import { bootstrapAppWorkspace, setupWorkspaceHandlers } from '../../../electron/main/handlers/workspaceHandler';
import { DatabaseManager as DM } from '../../../electron/main/services/DatabaseManager';
import { setMainWindow } from '../../../electron/main/windowRegistry';
import { getStore } from '../../../electron/main/services/getsshStore';
import { appLock } from '../../../electron/main/security/appLock';
import { writeSecretFile } from '../../../electron/main/security/secretStore';

app.commandLine.appendSwitch('use-mock-keychain');

const phase = process.env.KS_PHASE ?? '';
const base = path.join(os.homedir(), '.getssh');
const marker = (name: string) => path.join(os.homedir(), name);
/** Step markers for run.mjs's diagnostic rerun after a native crash. */
const trace = (step: string) => { if (process.env.KS_TRACE) process.stderr.write(`[${phase}] trace: ${step}\n`); };

const WORKSPACE_SCHEMA = 'CREATE TABLE profiles (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, host TEXT NOT NULL, username TEXT NOT NULL, password TEXT, privateKeyPath TEXT, passphrase TEXT, port INTEGER DEFAULT 22, autoStart INTEGER DEFAULT 0, alias TEXT, osType TEXT)';

function legacyDb(file: string, passphrase: string | null, setup: (db: Database.Database) => void) {
  const db = new Database(file);
  if (passphrase) {
    db.pragma("cipher = 'sqlcipher'");
    db.key(Buffer.from(passphrase, 'utf8'));
  }
  setup(db);
  db.close();
}

/**
 * Whether a database file is plain SQLite. Read from the header: opening a file getssh-store has
 * open with a second SQLite library would drop the store's locks on it.
 */
function isPlainSqlite(file: string): boolean {
  const header = Buffer.alloc(16);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, header, 0, 16, 0);
  } finally {
    fs.closeSync(fd);
  }
  return header.equals(Buffer.from('SQLite format 3\0', 'utf8'));
}

/** What GETSSH 2.x / early 3.0 left on disk: app key in safeStorage, workspace passwords in vault.key. */
function writeLegacyLayout(options: { corruptDefault?: boolean } = {}) {
  fs.mkdirSync(path.join(base, 'workspaces'), { recursive: true });
  const appKey = 'ab'.repeat(32);
  trace('safeStorage: writing app_key.enc');
  writeSecretFile(path.join(base, 'app_key.enc'), appKey);
  trace('better-sqlite3: writing the legacy main.db');
  legacyDb(path.join(base, 'main.db'), appKey, db => {
    db.exec('CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, themeColor TEXT, hasPassword INTEGER DEFAULT 0, biometric_enabled INTEGER DEFAULT 0, is_main INTEGER DEFAULT 0, preferences TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)');
    const insert = db.prepare('INSERT INTO workspaces (id, name, hasPassword, biometric_enabled, is_main, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1)');
    insert.run('default', 'Default', 0, 0, 1);
    insert.run('secret', 'Secret', 1, 1, 0);
    insert.run('lost', 'Lost', 1, 0, 0);
  });
  if (options.corruptDefault) {
    fs.writeFileSync(path.join(base, 'workspace_default.db'), Buffer.alloc(4096, 0x5a));
  } else {
    legacyDb(path.join(base, 'workspace_default.db'), null, db => {
      db.exec(WORKSPACE_SCHEMA);
      db.prepare("INSERT INTO profiles (id, workspace_id, host, username, password) VALUES ('p1', 'default', 'router.lan', 'admin', 'hunter2')").run();
    });
  }
  legacyDb(path.join(base, 'workspace_secret.db'), 'secret-pw-1', db => {
    db.exec(WORKSPACE_SCHEMA);
    db.prepare("INSERT INTO profiles (id, workspace_id, host, username, password) VALUES ('s1', 'secret', 'prod.example', 'root', 'topsecret')").run();
  });
  fs.mkdirSync(path.join(base, 'workspaces', 'secret'), { recursive: true });
  writeSecretFile(path.join(base, 'workspaces', 'secret', 'vault.key'), 'secret-pw-1');
  // A password workspace whose vault.key is missing, with a password shorter than 3.0 allows.
  legacyDb(path.join(base, 'workspace_lost.db'), 'abc', db => {
    db.exec(WORKSPACE_SCHEMA);
    db.prepare("INSERT INTO profiles (id, workspace_id, host, username, password) VALUES ('l1', 'lost', 'old.example', 'me', 'x')").run();
  });
}

function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.set(path.relative(dir, full), fs.readFileSync(full).toString('base64'));
    }
  };
  walk(dir);
  return out;
}

/** host:password of every profile; the password as the main process gets it to connect. */
const hosts = (workspaceId: string) => DM.getProfiles(workspaceId).map(p => {
  const secrets = getStore().connectSecrets(workspaceId, p.id);
  return `${p.host}:${secrets.password?.toString('utf8')}`;
}).sort();

async function run(): Promise<string> {
  trace('app ready');
  if (process.env.KS_TRACE) {
    const localState = path.join(app.getPath('userData'), 'Local State');
    const text = fs.existsSync(localState) ? fs.readFileSync(localState, 'utf8') : null;
    trace(`Local State ${text === null ? 'missing' : `present, os_crypt key ${text.includes('"encrypted_key"') ? 'stored' : 'absent'}`} (${localState})`);
  }
  switch (phase) {
    case 'legacy':
      writeLegacyLayout();
      return 'legacy layout written';

    case 'migrate': {
      await appLock.start();
      const state = appLock.state();
      assert.equal(state.phase, 'ready', JSON.stringify(state));
      assert.deepEqual([...(state.migration?.migratedWorkspaces ?? [])].sort(), ['default', 'secret']);
      assert.deepEqual(state.migration?.deferredWorkspaces, ['lost']);
      assert.deepEqual(state.migration?.presenceToReenable, ['secret']);
      assert.deepEqual(state.migration?.failedWorkspaces, []);
      for (const gone of ['app_key.enc', 'workspaces/secret/vault.key', '.keystore-migration-backup']) {
        assert.ok(!fs.existsSync(path.join(base, gone)), `${gone} should be gone`);
      }
      assert.equal(await DM.openWorkspace('default'), 'open');
      assert.deepEqual(hosts('default'), ['router.lan:hunter2']);
      assert.ok(!isPlainSqlite(path.join(base, 'workspace_default.db')), 'default is encrypted now');
      assert.equal(await DM.openWorkspace('secret'), 'locked');
      assert.deepEqual(DM.getProfiles('secret'), [], 'a locked workspace lists nothing');
      assert.equal(await DM.unlockWorkspaceWithPassword('secret', 'wrong-pw'), false);
      assert.equal(await DM.unlockWorkspaceWithPassword('secret', 'secret-pw-1'), true);
      assert.deepEqual(hosts('secret'), ['prod.example:topsecret']);
      assert.equal(await DM.openWorkspace('lost'), 'legacy');
      assert.equal(await DM.unlockWorkspaceWithPassword('lost', 'nope'), false);
      assert.equal(await DM.unlockWorkspaceWithPassword('lost', 'abc'), true, 'short legacy passwords survive');
      assert.deepEqual(hosts('lost'), ['old.example:x']);
      assert.ok(DM.getWorkspace('lost')?.hasPassword);
      return 'migrated ' + JSON.stringify(state.migration);
    }

    case 'restart-plain': {
      await appLock.start();
      assert.equal(appLock.state().phase, 'ready');
      assert.equal(appLock.state().migration, undefined, 'no second migration');
      assert.equal(await DM.openWorkspace('default'), 'open');
      assert.equal(await DM.openWorkspace('secret'), 'locked');
      assert.equal(await DM.unlockWorkspaceWithPassword('lost', 'abc'), true);
      appLock.lock('idle');
      assert.ok(!DM.isWorkspaceOpen('lost'), 'protected workspaces close on idle');
      assert.ok(DM.isWorkspaceOpen('default'), 'the rest stays open without a master password');
      assert.equal(appLock.state().phase, 'ready');
      return 'restart without master password ok';
    }

    case 'set-master': {
      await appLock.start();
      const store = getStore();
      // The first master password replaces the workspace passwords: those workspaces are unlocked first.
      await assert.rejects(store.setMasterPassword('master-password-1'), /\[store:locked\]/);
      assert.equal(await DM.unlockWorkspaceWithPassword('secret', 'secret-pw-1'), true);
      assert.equal(await DM.unlockWorkspaceWithPassword('lost', 'abc'), true);
      await assert.rejects(store.setMasterPassword('short-pw'), /\[store:invalid_argument\]/);
      await store.setMasterPassword('master-password-1');
      assert.ok(appLock.state().appProtected);
      assert.deepEqual(DM.getWorkspaces().filter(w => w.hasPassword).map(w => w.id), [], 'no workspace keeps its own password');
      assert.deepEqual(hosts('default'), ['router.lan:hunter2']);
      assert.deepEqual(hosts('secret'), ['prod.example:topsecret']);
      assert.ok(!appLock.state().recoveryConfigured, 'setting the master password discards the old code');
      await assert.rejects(store.createRecoveryCode(), /\[store:needs_password\]/);
      fs.writeFileSync(marker('recovery.txt'), await store.createRecoveryCode('master-password-1'));
      return 'master password set';
    }

    case 'restart-master': {
      await appLock.start();
      assert.equal(appLock.state().phase, 'locked');
      assert.deepEqual(DM.getWorkspaces(), [], 'nothing is readable while locked');
      assert.ok(!DM.isEncryptedAiMemoryAvailable());
      assert.deepEqual(await appLock.unlock({ method: 'password', password: 'wrong-password-1' }), { ok: false, error: 'wrong_password', retryAfterMs: undefined });
      assert.deepEqual(await appLock.unlock({ method: 'password', password: 'master-password-1' }), { ok: true });
      assert.ok(DM.isEncryptedAiMemoryAvailable());
      assert.equal(await DM.openWorkspace('default'), 'open', 'one master unlock opens it');
      assert.equal(await DM.openWorkspace('secret'), 'open', 'and every other workspace');
      assert.deepEqual(hosts('secret'), ['prod.example:topsecret']);
      appLock.lock('screen locked');
      assert.equal(appLock.state().phase, 'locked');
      assert.ok(!DM.isEncryptedAiMemoryAvailable() && getStore().appState().phase === 'locked');
      assert.deepEqual(await appLock.unlock({ method: 'recovery', code: 'GSRC-0000-0000-0000-0000' }), { ok: false, error: 'invalid_recovery_code', retryAfterMs: undefined });
      assert.deepEqual(await appLock.unlock({ method: 'recovery', code: fs.readFileSync(marker('recovery.txt'), 'utf8') }), { ok: true });
      assert.equal(await DM.openWorkspace('secret'), 'open');
      return 'master password lock/unlock ok';
    }

    case 'remove-master': {
      await appLock.start();
      assert.deepEqual(await appLock.unlock({ method: 'password', password: 'master-password-1' }), { ok: true });
      assert.equal(await DM.openWorkspace('default'), 'open');
      await assert.rejects(getStore().removeMasterPassword('wrong-password-1'), /\[store:wrong_password\]/);
      await getStore().removeMasterPassword('master-password-1');
      assert.ok(!appLock.state().appProtected);
      assert.deepEqual(hosts('default'), ['router.lan:hunter2']);
      return 'master password removed';
    }

    case 'restart-after-removal': {
      await appLock.start();
      assert.equal(appLock.state().phase, 'ready', 'no master password: opens without a prompt');
      assert.equal(await DM.openWorkspace('default'), 'open');
      // Its own password went away when the master password took over.
      assert.equal(await DM.openWorkspace('secret'), 'open');
      assert.deepEqual(hosts('secret'), ['prod.example:topsecret']);
      return 'restart after removing the master password ok';
    }

    case 'fresh': {
      await appLock.start();
      assert.equal(appLock.state().phase, 'ready');
      assert.equal(appLock.state().migration, undefined);
      assert.deepEqual(DM.getWorkspaces().map(w => w.id), ['default']);
      assert.equal(await DM.openWorkspace('default'), 'open');
      assert.ok(!isPlainSqlite(path.join(base, 'main.db')));
      assert.ok(!fs.existsSync(path.join(base, '.keystore-migration-backup')));
      return 'fresh install ok';
    }

    case 'profiles': {
      // The transitional profile list (credentials included) and its save semantics.
      await appLock.start();
      const longScript = 'echo ready\n'.repeat(1000);
      DM.saveProfiles('default', [
        { id: 'a', host: 'a.example', username: 'root', password: 'pw-a', passphrase: 'pp-a', port: '2222', group: 'Prod', autoStart: 1, postConnectScript: longScript },
        { id: 'b', host: 'b.example', username: 'root', password: 'pw-b', protocol: 'bogus', useKeepAlive: 0 },
      ]);
      const [a, b] = DM.getProfiles('default');
      assert.ok(a.hasPassword && a.hasPassphrase && !JSON.stringify(DM.getProfiles('default')).includes('pw-'), 'no credentials reach the renderer');
      assert.deepEqual(hosts('default'), ['a.example:pw-a', 'b.example:pw-b']);
      assert.equal(a.port, 2222);
      assert.equal(a.groupName, 'Prod');
      assert.equal(a.group, 'Prod');
      assert.equal(a.autoStart, true);
      assert.equal(a.postConnectScript, longScript);
      assert.equal(b.protocol, 'ssh');
      assert.equal(b.useKeepAlive, false);
      // undefined keeps a secret, '' clears it, a string replaces it.
      DM.saveProfiles('default', [{ ...a, password: undefined, passphrase: '' }, { ...b, password: 'pw-b2' }]);
      const [a2] = DM.getProfiles('default');
      assert.ok(a2.hasPassword && !a2.hasPassphrase);
      assert.deepEqual(hosts('default'), ['a.example:pw-a', 'b.example:pw-b2']);
      const listed = JSON.stringify(getStore().listProfiles('default'));
      assert.ok(!listed.includes('pw-a') && !listed.includes('pw-b2'), 'the store itself never lists a secret');
      return 'profiles round-trip';
    }

    case 'bridge': {
      // workspace:bridge:importProfiles copies through the store: credentials are sealed again for the target.
      await appLock.start();
      DM.saveProfiles('default', [{ id: 'src', host: 'src.example', username: 'root', password: 'bridge-pw' }]);
      DM.saveRunbooks('default', [{ id: 'rb1', title: 'Restart', script: 'systemctl restart x' }, { id: 'rb2', title: 'Other', script: 'true' }]);
      await DM.createWorkspace({ id: 'target', name: 'Target' });
      getStore().copyProfiles('default', 'target', ['src']);
      assert.deepEqual(hosts('target'), ['src.example:bridge-pw']);
      assert.deepEqual(DM.getRunbooks('target'), [], 'runbooks are copied only when picked');
      await getStore().setWorkspacePassword('target', 'target-password');
      DM.lockWorkspace('target');
      assert.deepEqual(DM.getProfiles('target'), []);
      assert.equal(await DM.unlockWorkspaceWithPassword('target', 'target-password'), true);
      assert.deepEqual(hosts('target'), ['src.example:bridge-pw']);
      await DM.deleteWorkspace('target');
      assert.ok(!fs.existsSync(path.join(base, 'workspace_target.db')));
      assert.deepEqual(DM.getWorkspaces().map(w => w.id), ['default']);
      return 'bridge copy ok';
    }

    case 'ipc': {
      // The IPC handlers the renderer uses, called as the main window would call them (a hidden
      // window; nothing is shown). Nothing here asks for Touch ID / Windows Hello.
      await appLock.start();
      // What the app runs once the data opens: the MAIN workspace of a fresh install gets its folder.
      await bootstrapAppWorkspace();
      assert.ok(fs.existsSync(path.join(base, 'workspaces', 'default')), 'the default workspace folder exists');
      const win = new BrowserWindow({ show: false });
      setMainWindow(win);
      type Handler = (event: unknown, ...args: unknown[]) => any;
      const handlers = new Map<string, Handler>();
      const handle = (channel: string, run: Handler) => { handlers.set(channel, run); };
      // workspaceHandler registers on electron's ipcMain itself.
      (ipcMain as unknown as { handle: typeof handle }).handle = handle;
      const fakeIpc = { handle } as unknown as Electron.IpcMain;
      registerKeystoreHandlers(fakeIpc);
      registerCryptoHandlers(fakeIpc, app);
      setupWorkspaceHandlers();
      registerAssetFolderHandlers(fakeIpc, () => win);
      const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
      const call = (channel: string, ...args: unknown[]) => {
        const run = handlers.get(channel);
        if (!run) throw new Error(`no handler for ${channel}`);
        return run(event, ...args);
      };
      const listed = async () => Object.fromEntries((await call('workspace:list')).map((w: any) => [w.id, w.visualMeta]));

      assert.deepEqual(Object.keys(await listed()), ['default']);
      assert.equal((await listed()).default.isMain, true);
      assert.equal(await call('save-profiles', { payload: [{ id: 'web', host: 'web.example', username: 'root', password: 'pw1', group: 'G' }], workspaceId: 'default' }), true);
      DM.saveRunbooks('default', [{ id: 'rb', title: 'Check', script: 'uptime' }]);
      const unlocked = await call('unlock-profiles');
      assert.ok(unlocked[0].hasPassword && !JSON.stringify(unlocked).includes('pw1'), 'unlock-profiles carries no password');
      assert.equal((await call('check-profiles')).status, 'plain');
      assert.equal((await call('workspace:create', 'team', { name: 'Team' })).success, true);
      assert.deepEqual(await call('workspace:set-password', { workspaceId: 'default', password: 'main-password' }), { ok: false, error: 'main_workspace_needs_master_password' });
      assert.deepEqual(await call('workspace:set-password', { workspaceId: 'team', password: 'team-password' }), { ok: true });

      // A listed workspace whose folder went missing gets it back; an unknown id is refused.
      fs.rmSync(path.join(base, 'workspaces', 'team'), { recursive: true, force: true });
      await assert.rejects(call('workspace:switch', 'nowhere'), /does not exist/);
      const intoTeam = await call('workspace:switch', 'team');
      assert.ok(fs.existsSync(path.join(base, 'workspaces', 'team')));
      assert.equal(intoTeam.isLocked, false);
      assert.equal(intoTeam.visualMeta.hasPassword, true);
      const backHome = await call('workspace:switch', 'default');
      assert.ok(backHome.profiles[0].hasPassword && !JSON.stringify(backHome).includes('pw1'), 'workspace:switch carries no password');
      assert.ok(!DM.isWorkspaceOpen('team'), 'leaving a workspace with its own password locks it');
      assert.equal((await listed()).team.protected, true);
      assert.deepEqual(await call('workspace:unlock', { workspaceId: 'team', method: 'presence' }), { ok: false, error: 'unavailable' });
      assert.deepEqual(await call('workspace:unlock', { workspaceId: 'team', method: 'password', password: 'nope-nope' }), { ok: false, error: 'wrong_password' });
      assert.deepEqual(await call('workspace:unlock', { workspaceId: 'team', method: 'password', password: 'team-password' }), { ok: true });

      const fetched = await call('workspace:bridge:fetchProfiles', 'default');
      assert.ok(fetched.success && fetched.profiles[0].hasPassword);
      assert.ok(!JSON.stringify(fetched).includes('pw1'), 'the bridge listing carries no credentials');
      assert.deepEqual(await call('workspace:bridge:importProfiles', 'team', fetched.profiles, fetched.runbooks), { success: true });
      assert.deepEqual(hosts('team'), ['web.example:pw1']);
      assert.deepEqual(DM.getRunbooks('team').map(r => r.id), ['rb']);
      assert.deepEqual(await call('workspace:bridge:importProfiles', 'team', [{ id: 'web', workspace_id: 'team' }], []), { success: false, error: 'invalid_argument' });

      assert.deepEqual(await call('security:set-master-password', { password: 'master-password-12' }), { ok: true, recoveryReset: true });
      assert.deepEqual(await call('security:setup-recovery', {}), { ok: false, error: 'current_password_required', retryAfterMs: undefined });
      assert.equal((await call('security:setup-recovery', { currentPassword: 'master-password-12' })).ok, true);
      const status = await call('security:status');
      assert.equal(status.appProtected, true);
      assert.equal(status.scopes.find((scope: any) => scope.workspaceId === 'team').ownPassword, false);
      assert.deepEqual(await call('workspace:set-password', { workspaceId: 'team', password: 'team-password' }), { ok: false, error: 'master_password_protects_workspaces' });
      assert.deepEqual(await call('security:set-master-password', { password: 'master-password-13' }), { ok: false, error: 'current_password_required', retryAfterMs: undefined });
      assert.deepEqual(await call('security:remove-master-password', {}), { ok: false, error: 'current_password_required' });
      assert.deepEqual(await call('security:remove-master-password', { currentPassword: 'wrong-password-1' }), { ok: false, error: 'wrong_password', retryAfterMs: undefined });
      assert.deepEqual(await call('security:remove-master-password', { currentPassword: 'master-password-12' }), { ok: true });

      assert.equal((await call('workspace:updatePreferences', 'default', '{"isolationRules":{"disableSftp":true}}')).success, true);
      assert.equal((await listed()).default.preferences.isolationRules.disableSftp, true);
      const stats = await call('workspace:getStats', 'default');
      assert.equal(stats.stats.profileCount, 1);
      assert.equal(stats.stats.runbookCount, 1);
      assert.deepEqual(await call('asset-folders:list', 'default'), { success: true, folders: ['G'] });
      assert.equal((await call('asset-folders:list', 'team')).success, false, 'only the active workspace');
      assert.equal(await call('app-lock:lock'), true);
      assert.deepEqual(await call('workspace:delete', 'team'), { success: true });
      assert.ok(!fs.existsSync(path.join(base, 'workspace_team.db')) && !fs.existsSync(path.join(base, 'workspaces', 'team')));
      assert.deepEqual(Object.keys(await listed()), ['default']);
      win.destroy();
      return 'IPC handlers ok';
    }

    case 'connect': {
      // Connecting by profile id against an SSH server on 127.0.0.1: the saved address and
      // credentials are used whatever the request says; typed credentials still work.
      fs.mkdirSync(path.join(os.homedir(), 'user-data'), { recursive: true });
      app.setPath('userData', path.join(os.homedir(), 'user-data'));
      await appLock.start();
      const win = new BrowserWindow({ show: false });
      setMainWindow(win);
      type Handler = (event: unknown, ...args: unknown[]) => any;
      const handlers = new Map<string, Handler>();
      const fakeIpc = { handle: (channel: string, run: Handler) => handlers.set(channel, run), on: (channel: string, run: Handler) => handlers.set(channel, run) } as unknown as Electron.IpcMain;
      registerSshHandlers(fakeIpc, app, () => win);
      const event = { sender: win.webContents, senderFrame: win.webContents.mainFrame };
      const connect = (request: Record<string, unknown>) => handlers.get('ssh-connect')!(event, { protocol: 'ssh', keepaliveInterval: 0, ...request });

      const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      const hostKey = privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
      const logins: string[] = [];
      const server = new SshServer({ hostKeys: [hostKey] }, connection => {
        connection.on('authentication', context => {
          if (context.method !== 'password') return context.reject(['password']);
          logins.push(`${context.username}:${context.password}`);
          context.accept();
        });
        connection.on('session', accept => {
          const session = accept();
          session.on('pty', acceptPty => acceptPty?.());
          session.on('shell', acceptShell => acceptShell().write('ready\n'));
        });
        connection.on('error', () => {});
      });
      const port = await new Promise<number>(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)));
      // The server is known already, so no host-key prompt is needed.
      const parsedKey = sshUtils.parseKey(hostKey);
      if (parsedKey instanceof Error || Array.isArray(parsedKey)) throw new Error('could not read the test host key');
      const fingerprint = 'SHA256:' + crypto.createHash('sha256').update(parsedKey.getPublicSSH()).digest('base64').replace(/=*$/, '');
      fs.writeFileSync(path.join(app.getPath('userData'), 'known_hosts.json'), JSON.stringify({ [`127.0.0.1:${port}`]: { host: '127.0.0.1', port, fingerprint, trustedAt: 1 } }));

      DM.saveProfiles('default', [{ id: 'srv', host: '127.0.0.1', port, username: 'saved-user', password: 'saved-pw' }]);
      const byId = await connect({ profileId: 'srv', workspaceId: 'default', host: 'attacker.invalid', port: 1, username: 'attacker' });
      assert.ok(byId.success, JSON.stringify(byId));
      assert.deepEqual(logins, ['saved-user:saved-pw'], 'the saved address and credentials, not the request\'s');

      const typed = await connect({ profileId: 'srv', workspaceId: 'default', host: '127.0.0.1', port, username: 'typed-user', password: 'typed-pw' });
      assert.ok(typed.success, JSON.stringify(typed));
      assert.deepEqual(logins.slice(1), ['typed-user:typed-pw'], 'typed credentials are used as they are');

      const reconnected = await handlers.get('ssh-reconnect')!(event, byId.sessionId);
      assert.ok(reconnected.success, JSON.stringify(reconnected));
      assert.deepEqual(logins.slice(2), ['saved-user:saved-pw'], 'a reconnect takes the credentials from the store again');

      await DM.createWorkspace({ id: 'vault', name: 'Vault' });
      DM.saveProfiles('vault', [{ id: 'srv2', host: '127.0.0.1', port, username: 'vault-user', password: 'vault-pw' }]);
      await getStore().setWorkspacePassword('vault', 'vault-password');
      DM.lockWorkspace('vault');
      const locked = await connect({ profileId: 'srv2', workspaceId: 'vault', host: '127.0.0.1', port, username: 'x' });
      assert.equal(locked.success, false);
      assert.match(locked.error, /locked/);
      assert.equal(logins.length, 3, 'nothing is sent for a locked workspace');

      for (const id of [byId.sessionId, typed.sessionId, reconnected.sessionId]) handlers.get('ssh-disconnect')!(event, id);
      server.close();
      win.destroy();
      return 'connecting by profile id ok';
    }

    case 'asset-folders': {
      // Folder operations never reach a locked workspace: its key is simply not in memory.
      await appLock.start();
      const plainId = 'plain-folder-smoke';
      await DM.createWorkspace({ id: plainId, name: plainId });
      assert.equal(await DM.openWorkspace(plainId), 'open');
      assert.deepEqual(DM.getAssetFolders(plainId), []);
      DM.createAssetFolder(plainId, 'Projects/Live');
      assert.deepEqual(DM.getAssetFolders(plainId), ['Projects', 'Projects/Live']);

      const id = 'folder-smoke';
      await DM.createWorkspace({ id, name: id });
      assert.equal(await DM.openWorkspace(id), 'open');
      await getStore().setWorkspacePassword(id, 'folder-password');
      DM.saveProfiles(id, [
        { id: 'db-host', host: 'db.example', username: 'root', groupName: 'Prod/DB' },
        { id: 'web-host', host: 'web.example', username: 'root', groupName: 'Prod/Web' },
        { id: 'legacy-host', host: 'legacy.example', username: 'root', groupName: ' Ops / DB ' },
      ]);
      const group = (profileId: string) => DM.getProfiles(id).find(p => p.id === profileId)?.groupName ?? null;

      assert.deepEqual(DM.getAssetFolders(id), [' Ops ', ' Ops / DB ', 'Prod', 'Prod/DB', 'Prod/Web']);
      DM.renameAssetFolder(id, ' Ops ', 'Team');
      assert.equal(group('legacy-host'), 'Team/ DB ');
      DM.createAssetFolder(id, 'Empty/Sub');
      assert.ok(DM.getAssetFolders(id).includes('Empty/Sub'));
      assert.throws(() => DM.createAssetFolder(id, 'Prod//Bad'), /Invalid folder path/);
      assert.throws(() => DM.createAssetFolder(id, '../Bad'), /Invalid folder path/);
      const renamed = DM.renameAssetFolder(id, 'Prod', 'Live');
      assert.deepEqual(renamed.memberships.map(entry => entry.id).sort(), ['db-host', 'web-host']);
      assert.equal(group('db-host'), 'Live/DB');
      DM.createAssetFolder(id, 'Taken');
      assert.throws(() => DM.renameAssetFolder(id, 'Live', 'Taken'), /already exists/i);
      assert.throws(() => DM.removeAssetFolder(id, 'Live'), /child folders/i);
      assert.throws(() => DM.removeAssetFolder(id, 'Live/DB'), /Move hosts/i);
      assert.throws(() => DM.moveProfilesToAssetFolder(id, ['db-host', 'other-workspace-host'], 'Empty/Sub'), /does not exist/i);
      const moved = DM.moveProfilesToAssetFolder(id, ['db-host', 'web-host'], 'Empty/Sub');
      assert.deepEqual(moved.memberships.map(entry => entry.id).sort(), ['db-host', 'web-host']);
      assert.deepEqual(Object.keys(moved.memberships[0]).sort(), ['group', 'id']);
      DM.moveProfilesToAssetFolder(id, ['db-host', 'web-host'], null);
      DM.removeAssetFolder(id, 'Empty/Sub');
      assert.throws(() => DM.moveProfileToAssetFolder(id, 'missing', null), /does not exist/);

      DM.lockWorkspace(id);
      assert.throws(() => DM.getAssetFolders(id), /locked/i);
      assert.throws(() => DM.createAssetFolder(id, 'Nope'), /locked/i);
      assert.equal(await DM.unlockWorkspaceWithPassword(id, 'wrong-password'), false);
      assert.throws(() => DM.getAssetFolders(id), /locked/i);
      assert.equal(await DM.unlockWorkspaceWithPassword(id, 'folder-password'), true);
      assert.ok(DM.getAssetFolders(id).includes('Taken'), 'folders survive a lock and unlock');
      DM.lockWorkspace(id);
      assert.ok(!isPlainSqlite(path.join(base, `workspace_${id}.db`)), 'the folder database is encrypted');
      return 'asset folders respect workspace locks';
    }

    case 'rollback-setup':
      writeLegacyLayout({ corruptDefault: true });
      return 'legacy layout with a damaged workspace written';

    case 'damaged': {
      await appLock.start();
      assert.equal(appLock.state().phase, 'ready', JSON.stringify(appLock.state()));
      assert.deepEqual(appLock.state().migration?.failedWorkspaces, ['default']);
      assert.equal(await DM.unlockWorkspaceWithPassword('secret', 'secret-pw-1'), true);
      assert.deepEqual(hosts('secret'), ['prod.example:topsecret']);
      return 'a damaged workspace does not block the rest';
    }

    case 'rollback-main':
      fs.writeFileSync(path.join(base, 'main.db'), Buffer.alloc(4096, 0x5a));
      fs.writeFileSync(marker('legacy-snapshot.json'), JSON.stringify([...snapshot(base)]));
      return 'damaged main.db written';

    case 'rollback': {
      await appLock.start();
      assert.equal(appLock.state().phase, 'error');
      const before = new Map<string, string>(JSON.parse(fs.readFileSync(marker('legacy-snapshot.json'), 'utf8')));
      const after = snapshot(base);
      for (const [file, content] of before) assert.equal(after.get(file), content, `${file} restored byte for byte`);
      for (const file of after.keys()) {
        assert.ok(before.has(file) || file.startsWith('.keystore-migration-backup') || file === 'keyring.json', `${file} left behind`);
      }
      return 'a failed migration restored every file';
    }
  }
  throw new Error(`unknown phase ${phase}`);
}

app.whenReady().then(run).then(
  message => {
    console.log(`[${phase}] OK ${message}`);
    // A normal quit, not app.exit(): on Windows the safeStorage key lives in Chromium's Local
    // State, which must reach the disk for the next phase to read app_key.enc.
    app.quit();
  },
  error => {
    console.error(`[${phase}] FAILED`, error);
    app.exit(1);
  },
);
