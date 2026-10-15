// Writes dist/THIRD_PARTY_NOTICES.txt: the copyright and license notices of everything GETSSH
// ships that it did not write. electron-builder runs it before packing (the beforePack hook in
// package.json) and puts the file next to app.asar; `node scripts/third-party-notices.cjs`
// writes it by hand.
//
// - JavaScript bundled by Vite into the window, the main process and the preload: the
//   license.md files Vite writes with build.license (dist/.vite, dist-electron/*/.vite), so run
//   `vite build` first.
// - The production node_modules electron-builder packs into app.asar: the dependency closure of
//   package.json "dependencies", with each package's own license files.
// - The Rust crates linked into the native modules and tools (rust-core/*, watchdog,
//   getssh-sandbox): every normal dependency of the workspace from `cargo metadata`, with the
//   license files in each crate's source.
// - The fonts in src/assets/fonts: copyright and license as the font files state them.
// - Electron and Chromium (with FFmpeg) bring their own LICENSE.electron.txt and
//   LICENSES.chromium.html, placed beside this file.
//
// Fails instead of writing an incomplete file: a release must not ship without its notices.

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const APP_DIR = path.resolve(__dirname, '..');
const REPO_DIR = path.resolve(APP_DIR, '..', '..');
const LICENSE_FILE = /^(licen[cs]e|copying|copyright|notice|unlicense)([-._ ].*)?$/i;
const RULE = '-'.repeat(78);

function fail(message) {
  throw new Error(`THIRD_PARTY_NOTICES: ${message}`);
}

function licenseFiles(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter(name => LICENSE_FILE.test(name) && fs.statSync(path.join(dir, name)).isFile())
    .sort()
    .map(name => ({ name, text: fs.readFileSync(path.join(dir, name), 'utf8').replace(/\r\n/g, '\n').trim() }));
}

// --- JavaScript bundled by Vite ---

function viteLicenses() {
  const sources = [
    ['the window', path.join(APP_DIR, 'dist', '.vite', 'license.md')],
    ['the main process', path.join(APP_DIR, 'dist-electron', 'main', '.vite', 'license.md')],
    ['the preload script', path.join(APP_DIR, 'dist-electron', 'preload', '.vite', 'license.md')],
  ];
  return sources.map(([part, file]) => {
    if (!fs.existsSync(file)) fail(`${path.relative(APP_DIR, file)} is missing; run vite build first`);
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
      .replace(/^# Licenses\n+/, '')
      .replace(/^The app bundles dependencies which contain the following licenses:\n+/, '')
      .trim();
    return { part, text };
  });
}

// --- node_modules packed into app.asar ---

/** Where Node would find `name` from `fromDir`: the nearest node_modules/<name> above it. */
function findPackage(name, fromDir) {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate);
    if (path.dirname(dir) === dir) return null;
  }
}

function packedNodeModules() {
  const manifest = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));
  const ignored = new Set(manifest.pnpm?.ignoredOptionalDependencies ?? []);
  const seen = new Map();
  const visit = (name, fromDir, optional) => {
    if (ignored.has(name)) return;
    const dir = findPackage(name, fromDir);
    if (!dir) {
      if (optional) return;
      fail(`production dependency ${name} is not installed (from ${fromDir})`);
    }
    if (seen.has(dir)) return;
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    seen.set(dir, { name: pkg.name, version: pkg.version, license: typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? 'unknown', homepage: pkg.homepage || pkg.repository?.url || pkg.repository || '', files: licenseFiles(dir) });
    for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, dir, false);
    for (const dep of Object.keys(pkg.optionalDependencies ?? {})) visit(dep, dir, true);
  };
  for (const dep of Object.keys(manifest.dependencies ?? {})) visit(dep, APP_DIR, false);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

// --- Rust crates ---

/** The Rust target this machine builds for: packages are built on the OS and CPU they ship to. */
function hostTarget() {
  const host = /^host: (\S+)$/m.exec(execFileSync('rustc', ['-vV'], { encoding: 'utf8' }))?.[1];
  if (!host) fail('rustc -vV did not name the host target');
  return host;
}

function rustCrates() {
  let raw;
  try {
    // Only the crates of this target: the others are not in the package (and their sources may
    // not have been downloaded, which cargo needs to read their manifests).
    raw = execFileSync('cargo', ['metadata', '--format-version', '1', '--locked', '--filter-platform', hostTarget()], { cwd: REPO_DIR, maxBuffer: 256 * 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    fail(`cargo metadata failed: ${error.stderr || error.message}`);
  }
  const metadata = JSON.parse(raw);
  const members = new Set(metadata.workspace_members);
  const packages = new Map(metadata.packages.map(pkg => [pkg.id, pkg]));
  const nodes = new Map(metadata.resolve.nodes.map(node => [node.id, node]));
  const reached = new Set();
  const queue = [...members];
  while (queue.length) {
    const id = queue.pop();
    if (reached.has(id)) continue;
    reached.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) {
      // Normal dependencies only: dev-dependencies and build scripts are not in what ships.
      if (dep.dep_kinds.some(kind => kind.kind === null)) queue.push(dep.pkg);
    }
  }
  return [...reached]
    .filter(id => !members.has(id))
    .map(id => packages.get(id))
    .map(pkg => ({ name: pkg.name, version: pkg.version, license: pkg.license || (pkg.license_file ? `see ${pkg.license_file}` : 'unknown'), homepage: pkg.repository || pkg.homepage || '', files: licenseFiles(path.dirname(pkg.manifest_path)) }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

// --- fonts ---

/** The sfnt tables of a TTF/OTF or WOFF 1.0 file, by tag. */
function fontTables(bytes) {
  const tables = new Map();
  if (bytes.toString('latin1', 0, 4) === 'wOFF') {
    const count = bytes.readUInt16BE(12);
    for (let i = 0; i < count; i++) {
      const at = 44 + i * 20;
      const [offset, compressed, original] = [bytes.readUInt32BE(at + 4), bytes.readUInt32BE(at + 8), bytes.readUInt32BE(at + 12)];
      const data = bytes.subarray(offset, offset + compressed);
      tables.set(bytes.toString('latin1', at, at + 4), compressed < original ? zlib.inflateSync(data) : data);
    }
    return tables;
  }
  const count = bytes.readUInt16BE(4);
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16;
    const [offset, length] = [bytes.readUInt32BE(at + 8), bytes.readUInt32BE(at + 12)];
    tables.set(bytes.toString('latin1', at, at + 4), bytes.subarray(offset, offset + length));
  }
  return tables;
}

/** Name-table strings: 0 copyright, 1 family, 13 license, 14 license URL (English Windows names first). */
function fontNames(file) {
  const name = fontTables(fs.readFileSync(file)).get('name');
  if (!name) fail(`${file} has no name table`);
  const count = name.readUInt16BE(2);
  const strings = name.readUInt16BE(4);
  const found = {};
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 12;
    const [platform, encoding, language, id, length, offset] = [0, 2, 4, 6, 8, 10].map(o => name.readUInt16BE(at + o));
    const raw = name.subarray(strings + offset, strings + offset + length);
    let text;
    if (platform === 3 && (encoding === 1 || encoding === 10)) text = Buffer.from(raw).swap16().toString('utf16le');
    else if (platform === 1 && encoding === 0) text = raw.toString('latin1');
    else continue;
    const rank = platform === 3 && language === 0x409 ? 0 : platform === 3 ? 1 : 2;
    if (!found[id] || found[id].rank > rank) found[id] = { rank, text: text.trim() };
  }
  return Object.fromEntries(Object.entries(found).map(([id, entry]) => [id, entry.text]));
}

const FONT_DIR = path.join(APP_DIR, 'src', 'assets', 'fonts');

function fonts() {
  return fs.readdirSync(FONT_DIR).filter(name => /\.(ttf|otf|woff)$/i.test(name)).sort().map(file => {
    const names = fontNames(path.join(FONT_DIR, file));
    return { file, family: names[1] ?? file, copyright: names[0] ?? '', license: names[13] ?? '', url: names[14] ?? '' };
  });
}

/** License texts kept beside the fonts (RedditSans-OFL.txt: the OFL asks for the full text). */
function fontLicenseTexts() {
  return fs.readdirSync(FONT_DIR).filter(name => name.endsWith('.txt')).sort()
    .map(name => `${RULE}\n${name}:\n\n${fs.readFileSync(path.join(FONT_DIR, name), 'utf8').replace(/\r\n/g, '\n').trim()}\n`);
}

// --- the file ---

function section(title) {
  return `\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}\n`;
}

/**
 * Package entries with their license files. Texts used by many packages (the Apache-2.0 text,
 * mostly) are printed once at the end of the section and referred to by number.
 */
function packageEntries(list) {
  const shared = new Map();
  const counts = new Map();
  for (const entry of list) for (const file of entry.files) {
    const hash = crypto.createHash('sha256').update(file.text).digest('hex');
    counts.set(hash, (counts.get(hash) ?? 0) + 1);
  }
  const out = [];
  for (const entry of list) {
    out.push(RULE, `${entry.name} ${entry.version}`, `License: ${entry.license}`);
    if (entry.homepage) out.push(`Source: ${entry.homepage}`);
    if (entry.files.length === 0) out.push('', `(No license file in the package. It is distributed under ${entry.license}; the full text is at https://spdx.org/licenses/.)`);
    for (const file of entry.files) {
      const hash = crypto.createHash('sha256').update(file.text).digest('hex');
      if (counts.get(hash) > 2) {
        if (!shared.has(hash)) shared.set(hash, { number: shared.size + 1, name: file.name, text: file.text });
        out.push('', `${file.name}: text [${shared.get(hash).number}] below.`);
      } else {
        out.push('', `${file.name}:`, '', file.text);
      }
    }
    out.push('');
  }
  for (const text of shared.values()) out.push(RULE, `[${text.number}] ${text.name}`, '', text.text, '');
  return out.join('\n');
}

function render() {
  const manifest = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));
  const electron = JSON.parse(fs.readFileSync(path.join(path.dirname(require.resolve('electron/package.json', { paths: [APP_DIR] })), 'package.json'), 'utf8'));
  const vite = viteLicenses();
  const modules = packedNodeModules();
  const crates = rustCrates();
  const fontList = fonts();
  if (crates.length === 0) fail('no Rust crates found');
  const parts = [
    `GETSSH ${manifest.version}: third-party notices`,
    '',
    'GETSSH is licensed under the Apache License 2.0. It includes the third-party software listed',
    'below, each under its own license. The licenses of Electron and of Chromium (including FFmpeg,',
    `under the LGPL) are in LICENSE.electron.txt and LICENSES.chromium.html beside this file (Electron ${electron.version}).`,
    'The source of FFmpeg as built for Electron is part of the Chromium sources (https://chromium.googlesource.com/chromium/third_party/ffmpeg).',
    section('1. JavaScript bundled into the application'),
    ...vite.map(entry => `${RULE}\nBundled into ${entry.part}:\n\n${entry.text || '(nothing bundled)'}\n`),
    section('2. Node.js packages shipped in app.asar'),
    packageEntries(modules),
    section('3. Rust crates linked into the native modules and tools'),
    packageEntries(crates),
    section('4. Fonts'),
    ...fontList.map(font => [RULE, `${font.family} (${font.file})`, font.copyright, font.license, font.url].filter(Boolean).join('\n') + '\n'),
    ...fontLicenseTexts(),
  ];
  return { text: parts.join('\n').replace(/\n{3,}/g, '\n\n') + '\n', counts: { bundled: vite.reduce((n, entry) => n + (entry.text.match(/^## /gm) ?? []).length, 0), modules: modules.length, crates: crates.length, fonts: fontList.length } };
}

function writeThirdPartyNotices(out = path.join(APP_DIR, 'dist', 'THIRD_PARTY_NOTICES.txt')) {
  const { text, counts } = render();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text);
  console.log(`[notices] ${path.relative(APP_DIR, out)}: ${counts.bundled} bundled JavaScript packages, ${counts.modules} packed node_modules, ${counts.crates} Rust crates, ${counts.fonts} fonts`);
  return out;
}

module.exports = { writeThirdPartyNotices, fontNames };
// electron-builder's beforePack hook.
module.exports.default = async () => {
  writeThirdPartyNotices();
};

if (require.main === module) writeThirdPartyNotices(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
