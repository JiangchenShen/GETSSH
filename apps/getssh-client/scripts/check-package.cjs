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
// Entries are compared with "/" everywhere. @electron/asar lists and looks them up with the
// platform's separator, so on Windows every lookup goes through native().
const native = entry => entry.split('/').join(path.sep);
const entries = asar.listPackage(archive).map(entry => entry.split(path.sep).join('/').replace(/^\/+/, ''));

function diskFile(file) {
  const stat = fs.statSync(file);
  assert(stat.isFile() && stat.size > 0, `Missing or empty file: ${file}`);
}

function archiveFile(entry) {
  entry = entry.replace(/^\/+/, '');
  const stat = asar.statFile(archive, native(entry));
  assert(stat.size > 0, `Missing or empty archive file: ${entry}`);
  if (stat.unpacked) diskFile(path.join(`${archive}.unpacked`, native(entry)));
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

/**
 * A 64-bit Mach-O file for `arch`, or a universal one that contains it. electron-builder packs
 * whatever native files it finds, so a package for one architecture can carry another's.
 */
function macBinary(file) {
  diskFile(file);
  const bytes = fs.readFileSync(file);
  const cpu = { x64: 0x01000007, arm64: 0x0100000c }[arch];
  assert(cpu, `Unsupported macOS architecture: ${arch}`);
  assert(bytes.length >= 8, `Not a Mach-O binary: ${file}`);
  if (bytes.readUInt32LE(0) === 0xfeedfacf) {
    assert.equal(bytes.readUInt32LE(4), cpu, `Wrong macOS binary architecture (${arch} required): ${file}`);
    return;
  }
  const fat = bytes.readUInt32BE(0);
  assert(fat === 0xcafebabe || fat === 0xcafebabf, `Not a 64-bit Mach-O binary: ${file}`);
  const size = fat === 0xcafebabe ? 20 : 32;
  const cpus = Array.from({ length: bytes.readUInt32BE(4) }, (_, i) => bytes.readUInt32BE(8 + i * size));
  assert(cpus.includes(cpu), `Universal macOS binary without ${arch}: ${file}`);
}

const nativeBinary = platform === 'win32' ? windowsBinary : platform === 'darwin' ? macBinary : diskFile;

function windowsArchiveBinary(entry) {
  archiveFile(entry);
  assert(asar.statFile(archive, native(entry)).unpacked, `Windows native binary must be unpacked: ${entry}`);
  windowsBinary(path.join(`${archive}.unpacked`, entry));
}

// better-sqlite3-multiple-ciphers and adm-zip went with step S6: getssh-store is the only database
// engine, and nothing else may open the data directory's files.
const forbidden = ['src', 'electron', 'scripts', ...[
  'react-icons', 'framer-motion', 'fuse.js', 'immer', 'react-markdown',
  'react-syntax-highlighter', 'remark-gfm', '@xterm/addon-serialize', '@types',
  'better-sqlite3-multiple-ciphers', 'adm-zip',
].map(name => `node_modules/${name}`)];
for (const entry of entries) {
  assert(!forbidden.some(prefix => entry === prefix || entry.startsWith(`${prefix}/`)), `Unneeded package entry: ${entry}`);
  assert(!entry.endsWith('.tsbuildinfo'), `Unneeded TypeScript build state: ${entry}`);
  assert(!/(^|\/)better_sqlite3\.node$/.test(entry), `Unneeded SQLite engine: ${entry}`);
}
assert(!fs.existsSync(path.join(resources, 'rust-core', 'getssh-keystore')), 'The standalone getssh-keystore module must not be packaged');

for (const entry of [
  'package.json', 'dist/index.html', 'dist-electron/main/index.js',
  'dist-electron/preload/index.js', 'dist-electron/main/plugin-host.js',
  'dist-electron/main/plugin-sandbox.js', 'dist-electron/main/package.json',
]) archiveFile(entry);
const html = asar.extractFile(archive, native('dist/index.html')).toString();
for (const [, reference] of html.matchAll(/\b(?:src|href)="([^"]+\.(?:js|css))"/g)) {
  archiveFile(path.posix.join('dist', reference));
}
assert.equal(JSON.parse(asar.extractFile(archive, native('dist-electron/main/package.json'))).type, 'commonjs');
for (const pattern of [
  /^dist\/assets\/[^/]+\.js$/, /^dist\/assets\/[^/]+\.css$/,
  /^dist\/assets\/MiSans-Normal-[^/]+\.woff2?$/, /^dist\/assets\/MiSans-Bold-[^/]+\.woff2?$/,
]) {
  const matches = entries.filter(entry => pattern.test(entry));
  assert(matches.length > 0, `Missing compiled asset: ${pattern}`);
  matches.forEach(archiveFile);
}

for (const name of ['electron-updater', 'ssh2', 'node-pty']) {
  const directory = `node_modules/${name}`;
  archiveFile(`${directory}/package.json`);
  const metadata = JSON.parse(asar.extractFile(archive, native(`${directory}/package.json`)));
  archiveFile(path.posix.join(directory, metadata.main || 'index.js'));
}
if (platform === 'win32') {
  for (const name of [
    'pty.node', 'conpty.node', 'conpty_console_list.node', 'winpty-agent.exe', 'winpty.dll',
    'conpty/OpenConsole.exe', 'conpty/conpty.dll',
  ]) windowsArchiveBinary(`node_modules/node-pty/prebuilds/${platform}-${arch}/${name}`);
}
if (platform === 'darwin') {
  // node-pty loads build/Release first: the copy electron-builder rebuilt for this architecture.
  for (const entry of ['node_modules/node-pty/build/Release/pty.node', 'node_modules/node-pty/build/Release/spawn-helper']) {
    archiveFile(entry);
    macBinary(path.join(`${archive}.unpacked`, entry));
  }
  macBinary(path.join(resources, '..', 'MacOS', 'GETSSH'));
}

for (const name of [
  'getssh-kv', 'getssh-sysprobe', 'getssh-vault', 'getssh-unarchive', 'sftp-stream',
  'tidal-engine', 'audit-stream', 'ocean-sentinel', 'getssh-store',
]) {
  const directory = path.join(resources, 'rust-core', name);
  const metadataFile = path.join(directory, 'package.json');
  diskFile(metadataFile);
  const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
  assert(metadata.main, `Missing Rust module entry point: ${name}`);
  diskFile(path.join(directory, metadata.main));
  const nativeFiles = fs.readdirSync(directory).filter(entry => entry.endsWith('.node'));
  assert(nativeFiles.length > 0, `Missing Rust native addon: ${name}`);
  nativeFiles.forEach(entry => nativeBinary(path.join(directory, entry)));
}
if (platform === 'win32') {
  for (const name of ['watchdog.exe', 'getssh-sandbox.exe']) windowsBinary(path.join(resources, name));
} else {
  nativeBinary(path.join(resources, 'watchdog'));
}
// Third-party notices (scripts/third-party-notices.cjs), and Electron's and Chromium's
// licenses: beside app.asar on macOS (added by mac.extraResources), next to GETSSH.exe on Windows.
const notices = path.join(resources, 'THIRD_PARTY_NOTICES.txt');
diskFile(notices);
const noticesText = fs.readFileSync(notices, 'utf8');
for (const name of ['react ', 'ssh2 ', 'node-pty ', 'aes-gcm ', 'napi ', 'SIL OPEN FONT LICENSE']) {
  assert(noticesText.includes(name), `THIRD_PARTY_NOTICES.txt does not mention ${name.trim()}`);
}
const electronLicenses = platform === 'win32' ? path.dirname(resources) : resources;
for (const name of ['LICENSE.electron.txt', 'LICENSES.chromium.html']) diskFile(path.join(electronLicenses, name));
console.log(`Package checks passed: ${archive} (${platform}/${arch}; ${entries.length} entries)`);
