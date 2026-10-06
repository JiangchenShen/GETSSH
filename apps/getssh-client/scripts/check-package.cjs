const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

// Use electron-builder's installed archive reader without loading Electron or native addons.
const builderRequire = createRequire(require.resolve('electron-builder/package.json'));
const packagerRequire = createRequire(builderRequire.resolve('app-builder-lib/package.json'));
const asar = packagerRequire('@electron/asar');
const [archiveArgument, platform = process.platform, arch = process.arch] = process.argv.slice(2);
assert(archiveArgument, 'Usage: node scripts/check-package.cjs <app.asar> [platform] [arch]');
const archive = path.resolve(archiveArgument);
const resources = path.dirname(archive);
const entries = asar.listPackage(archive).map(entry => entry.replace(/^\/+/, ''));

function diskFile(file) {
  const stat = fs.statSync(file);
  assert(stat.isFile() && stat.size > 0, `Missing or empty file: ${file}`);
}

function archiveFile(entry) {
  entry = entry.replace(/^\/+/, '');
  const stat = asar.statFile(archive, entry);
  assert(stat.size > 0, `Missing or empty archive file: ${entry}`);
  if (stat.unpacked) diskFile(path.join(`${archive}.unpacked`, entry));
}

function windowsBinary(file) {
  diskFile(file);
  const bytes = fs.readFileSync(file);
  assert(bytes.length >= 0x40 && bytes.readUInt16LE(0) === 0x5a4d, `Not a Windows PE binary: ${file}`);
  const offset = bytes.readUInt32LE(0x3c);
  assert(offset + 6 <= bytes.length && bytes.readUInt32LE(offset) === 0x4550, `Invalid Windows PE header: ${file}`);
  const machine = { x64: 0x8664, arm64: 0xaa64 }[arch];
  assert(machine, `Unsupported Windows architecture: ${arch}`);
  assert.equal(bytes.readUInt16LE(offset + 4), machine, `Wrong Windows binary architecture (${arch} required): ${file}`);
}

function windowsArchiveBinary(entry) {
  archiveFile(entry);
  assert(asar.statFile(archive, entry).unpacked, `Windows native binary must be unpacked: ${entry}`);
  windowsBinary(path.join(`${archive}.unpacked`, entry));
}

const forbidden = ['src', 'electron', 'scripts', ...[
  'react-icons', 'framer-motion', 'fuse.js', 'immer', 'react-markdown',
  'react-syntax-highlighter', 'remark-gfm', '@xterm/addon-serialize', '@types',
].map(name => `node_modules/${name}`)];
for (const entry of entries) {
  assert(!forbidden.some(prefix => entry === prefix || entry.startsWith(`${prefix}/`)), `Unneeded package entry: ${entry}`);
  assert(!entry.endsWith('.tsbuildinfo'), `Unneeded TypeScript build state: ${entry}`);
}

for (const entry of [
  'package.json', 'dist/index.html', 'dist-electron/main/index.js',
  'dist-electron/preload/index.js', 'dist-electron/main/plugin-host.js',
  'dist-electron/main/plugin-sandbox.js', 'dist-electron/main/package.json',
]) archiveFile(entry);
const html = asar.extractFile(archive, 'dist/index.html').toString();
for (const [, reference] of html.matchAll(/\b(?:src|href)="([^"]+\.(?:js|css))"/g)) {
  archiveFile(path.posix.join('dist', reference));
}
assert.equal(JSON.parse(asar.extractFile(archive, 'dist-electron/main/package.json')).type, 'commonjs');
for (const pattern of [
  /^dist\/assets\/[^/]+\.js$/, /^dist\/assets\/[^/]+\.css$/,
  /^dist\/assets\/MiSans-Normal-[^/]+\.woff2?$/, /^dist\/assets\/MiSans-Bold-[^/]+\.woff2?$/,
]) {
  const matches = entries.filter(entry => pattern.test(entry));
  assert(matches.length > 0, `Missing compiled asset: ${pattern}`);
  matches.forEach(archiveFile);
}

for (const name of ['adm-zip', 'electron-updater', 'ssh2', 'node-pty', 'better-sqlite3-multiple-ciphers']) {
  const directory = `node_modules/${name}`;
  archiveFile(`${directory}/package.json`);
  const metadata = JSON.parse(asar.extractFile(archive, `${directory}/package.json`));
  archiveFile(path.posix.join(directory, metadata.main || 'index.js'));
}
archiveFile(`node_modules/better-sqlite3-multiple-ciphers/prebuilds/${platform}-${arch}.node`);
if (platform === 'win32') {
  windowsArchiveBinary(`node_modules/better-sqlite3-multiple-ciphers/prebuilds/${platform}-${arch}.node`);
  for (const name of [
    'pty.node', 'conpty.node', 'conpty_console_list.node', 'winpty-agent.exe', 'winpty.dll',
    'conpty/OpenConsole.exe', 'conpty/conpty.dll',
  ]) windowsArchiveBinary(`node_modules/node-pty/prebuilds/${platform}-${arch}/${name}`);
}

for (const name of [
  'getssh-kv', 'getssh-sysprobe', 'getssh-vault', 'getssh-unarchive', 'sftp-stream',
  'tidal-engine', 'audit-stream', 'ocean-sentinel', 'getssh-keystore', 'getssh-store',
]) {
  const directory = path.join(resources, 'rust-core', name);
  const metadataFile = path.join(directory, 'package.json');
  diskFile(metadataFile);
  const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
  assert(metadata.main, `Missing Rust module entry point: ${name}`);
  diskFile(path.join(directory, metadata.main));
  const nativeFiles = fs.readdirSync(directory).filter(entry => entry.endsWith('.node'));
  assert(nativeFiles.length > 0, `Missing Rust native addon: ${name}`);
  nativeFiles.forEach(entry => (platform === 'win32' ? windowsBinary : diskFile)(path.join(directory, entry)));
}
if (platform === 'win32') {
  for (const name of ['watchdog.exe', 'getssh-sandbox.exe']) windowsBinary(path.join(resources, name));
} else {
  diskFile(path.join(resources, 'watchdog'));
}
console.log(`Package checks passed: ${archive} (${platform}/${arch}; ${entries.length} entries)`);
