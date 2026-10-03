// End-to-end test of the data layer in a real Electron main process: the GETSSH 2.x migration
// handing over to getssh-store, app lock, master password, workspace passwords, profiles, asset
// folders, rollback. Each phase runs in its own process with HOME pointed at a temporary
// directory, so nothing touches the real ~/.getssh or existing Keychain items.
//
//   npm run test:keystore-e2e
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../../..');
const rustCore = path.resolve(appDir, '../../rust-core');
const require = createRequire(import.meta.url);
const { build } = await import(pathToFileURL(require.resolve('rolldown', { paths: [require.resolve('vite')] })).href);

// The bundle lives under the app's node_modules/.cache so that Node finds its dependencies by
// walking up the tree, whether pnpm installed them next to the app or hoisted them to the root.
const cacheDir = path.join(appDir, 'node_modules', '.cache');
fs.mkdirSync(cacheDir, { recursive: true });
const workDir = fs.mkdtempSync(path.join(cacheDir, 'getssh-keystore-e2e-'));
const homesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-keystore-e2e-home-'));
const implementation = path.join(workDir, 'main-impl.cjs');
const bundle = path.join(workDir, 'main.cjs');
await build({
  input: path.join(here, 'entry.ts'),
  platform: 'node',
  external: ['electron', 'better-sqlite3-multiple-ciphers', /\.node$/],
  plugins: [{
    name: 'rust-core-path',
    resolveId(source) { return source.endsWith('utils/rustCorePath') ? '\0rust-core-path' : null; },
    load(id) {
      return id === '\0rust-core-path'
        ? `export function getRustCorePath(name) { return ${JSON.stringify(rustCore)} + '/' + name; }`
        : null;
    },
  }],
  output: { file: implementation, format: 'cjs' },
  logLevel: 'warn',
});
// A failure while loading the bundle exits instead of leaving Electron's error dialog open
// (on Windows that dialog blocks until the timeout).
fs.writeFileSync(bundle, `const trace = step => { if (process.env.KS_TRACE) process.stderr.write('[' + process.env.KS_PHASE + '] trace: ' + step + '\\n'); };
try {
  trace('loading better-sqlite3-multiple-ciphers');
  require('better-sqlite3-multiple-ciphers');
  trace('loading the test bundle');
  require('./main-impl.cjs');
  trace('loaded');
} catch (error) {
  console.error('[' + (process.env.KS_PHASE || '?') + '] FAIL loading the test bundle:', error && error.stack || error);
  process.exit(1);
}
`);

const electron = require('electron');
const allSequences = [
  ['legacy', 'migrate', 'restart-plain', 'set-master', 'restart-master', 'remove-master', 'restart-after-removal'],
  ['fresh', 'profiles', 'bridge'],
  ['asset-folders'],
  ['ipc'],
  ['rollback-setup', 'damaged'],
  ['legacy', 'rollback-main', 'rollback'],
];
// `run.mjs <phase>` runs only the sequences that contain that phase.
const only = process.argv[2];
const sequences = only ? allSequences.filter(sequence => sequence.includes(only)) : allSequences;
if (sequences.length === 0) throw new Error(`unknown phase ${only}`);

/** Windows crash codes are easier to recognise in hex (0x80000003 is a breakpoint). */
const exitCode = status => (status != null && status > 255 ? `${status} (0x${status.toString(16)})` : String(status));

let failed = false;
try {
  for (const phases of sequences) {
    const home = fs.mkdtempSync(path.join(homesDir, 'home-'));
    // USERPROFILE points Node's os.homedir() at the temporary home. Windows expands its known
    // folders (%USERPROFILE%\AppData\...) from the same variable, so give Chromium a complete
    // profile there instead of paths that do not exist.
    const windowsProfile = {};
    if (process.platform === 'win32') {
      windowsProfile.APPDATA = path.join(home, 'AppData', 'Roaming');
      windowsProfile.LOCALAPPDATA = path.join(home, 'AppData', 'Local');
      for (const dir of Object.values(windowsProfile)) fs.mkdirSync(dir, { recursive: true });
    }
    for (const phase of phases) {
      // The real store, never the in-memory fake.
      const { GETSSH_FAKE_STORE: _fake, ...inherited } = process.env;
      const env = { ...inherited, HOME: home, USERPROFILE: home, ...windowsProfile, KS_PHASE: phase, ELECTRON_ENABLE_LOGGING: '0' };
      const result = spawnSync(electron, [bundle], {
        env,
        encoding: 'utf8',
        timeout: 120_000,
      });
      const line = `${result.stdout}\n${result.stderr}`.split('\n').find(l => l.startsWith(`[${phase}]`));
      console.log(line || `[${phase}] no result (exit ${exitCode(result.status)})`);
      if (result.status !== 0 || !line?.includes(' OK ')) {
        failed = true;
        console.error(result.stdout.slice(-4000), result.stderr.slice(-4000));
        // Run the phase once more with Chromium logging and step traces: a native crash (for
        // example 0x80000003 on Windows) leaves no JavaScript error behind.
        const rerun = spawnSync(electron, ['--enable-logging=stderr', bundle], {
          env: { ...env, KS_TRACE: '1', ELECTRON_ENABLE_LOGGING: '1', ELECTRON_ENABLE_STACK_DUMPING: '1' },
          encoding: 'utf8',
          timeout: 120_000,
        });
        console.error(`[${phase}] diagnostic rerun: exit ${exitCode(rerun.status)}${rerun.signal ? ` signal ${rerun.signal}` : ''}`);
        console.error(`${rerun.stdout ?? ''}\n${rerun.stderr ?? ''}`.slice(-12000));
        break;
      }
    }
    if (failed) break;
  }
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.rmSync(homesDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
