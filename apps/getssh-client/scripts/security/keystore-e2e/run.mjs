// End-to-end test of the keystore integration (migration, app lock, master password, workspace
// passwords, rollback) in a real Electron main process. Each phase runs in its own process with
// HOME pointed at a temporary directory, so nothing touches the real ~/.getssh or Keychain.
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

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-keystore-e2e-'));
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
  output: { file: bundle, format: 'cjs' },
  logLevel: 'warn',
});
// The bundle resolves better-sqlite3-multiple-ciphers from the app's node_modules.
fs.symlinkSync(path.join(appDir, 'node_modules'), path.join(workDir, 'node_modules'), 'junction');

const electron = require('electron');
const allSequences = [
  ['legacy', 'migrate', 'restart-plain', 'set-master', 'restart-master', 'remove-master', 'restart-after-removal'],
  ['fresh'],
  ['asset-folders'],
  ['rollback-setup', 'damaged'],
  ['legacy', 'rollback-main', 'rollback'],
];
// `run.mjs <phase>` runs only the sequences that contain that phase.
const only = process.argv[2];
const sequences = only ? allSequences.filter(sequence => sequence.includes(only)) : allSequences;
if (sequences.length === 0) throw new Error(`unknown phase ${only}`);

let failed = false;
try {
  for (const phases of sequences) {
    const home = fs.mkdtempSync(path.join(workDir, 'home-'));
    for (const phase of phases) {
      const result = spawnSync(electron, [bundle], {
        env: { ...process.env, HOME: home, USERPROFILE: home, KS_PHASE: phase, ELECTRON_ENABLE_LOGGING: '0' },
        encoding: 'utf8',
        timeout: 120_000,
      });
      const line = `${result.stdout}\n${result.stderr}`.split('\n').find(l => l.startsWith(`[${phase}]`));
      console.log(line || `[${phase}] no result (exit ${result.status})`);
      if (result.status !== 0 || !line?.includes(' OK ')) {
        failed = true;
        console.error(result.stdout.slice(-4000), result.stderr.slice(-4000));
        break;
      }
    }
    if (failed) break;
  }
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
