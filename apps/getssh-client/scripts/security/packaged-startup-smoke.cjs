const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const distDir = path.resolve(__dirname, '../../../../dist');

function walk(dir, depth = 0) {
  if (depth > 6 || !fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walk(entryPath, depth + 1));
    else results.push(entryPath);
  }
  return results;
}

function findPackagedExecutable() {
  const files = walk(distDir);
  let matches;
  if (process.platform === 'win32') {
    matches = files.filter((file) =>
      path.basename(file).toLowerCase() === 'getssh.exe' && file.toLowerCase().includes('unpacked')
    );
  } else if (process.platform === 'darwin') {
    matches = files.filter((file) => file.endsWith(`${path.sep}GETSSH.app${path.sep}Contents${path.sep}MacOS${path.sep}GETSSH`));
  } else {
    matches = files.filter((file) =>
      path.basename(file).toLowerCase() === 'getssh' && file.toLowerCase().includes('unpacked')
    );
  }

  if (matches.length !== 1) {
    throw new Error(`Expected one unpacked GETSSH executable in ${distDir}, found ${matches.length}: ${matches.join(', ')}`);
  }
  return matches[0];
}

const token = crypto.randomBytes(16).toString('hex');
const resultPath = path.join(os.tmpdir(), `getssh-startup-smoke-${token}.json`);
const executable = findPackagedExecutable();
const args = [];

fs.rmSync(resultPath, { force: true });
const env = {
  ...process.env,
  CI: 'true',
  GETSSH_CI_STARTUP_SMOKE_TOKEN: token,
};
delete env.ELECTRON_RUN_AS_NODE;

const child = spawnSync(executable, args, {
  env,
  encoding: 'utf8',
  timeout: 45_000,
});

let reported;
try {
  reported = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
} catch (error) {
  const stderr = (child.stderr || '').trim();
  const stdout = (child.stdout || '').trim();
  throw new Error(
    `Packaged GETSSH did not produce a startup result (status=${child.status}, signal=${child.signal}).` +
    `${stderr ? ` stderr=${stderr}` : ''}${stdout ? ` stdout=${stdout}` : ''}`,
    { cause: error }
  );
} finally {
  fs.rmSync(resultPath, { force: true });
}

if (child.error) throw child.error;
if (child.status !== 0 || reported.status !== 'ok') {
  throw new Error(`Packaged GETSSH startup failed: ${JSON.stringify(reported)}`);
}
if (reported.platform !== process.platform || reported.arch !== process.arch) {
  throw new Error(
    `Packaged GETSSH architecture mismatch: expected ${process.platform}/${process.arch}, got ${reported.platform}/${reported.arch}`
  );
}

console.log(
  `Packaged GETSSH startup smoke passed on ${reported.platform}/${reported.arch} ` +
  `(Electron ${reported.electron}; ${reported.modules.length} native/runtime modules).`
);
