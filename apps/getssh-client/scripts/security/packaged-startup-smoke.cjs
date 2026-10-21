const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

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
const smokeRoot = path.join(os.tmpdir(), `getssh-startup-smoke-${token}`);
const args = ['--use-mock-keychain', `--user-data-dir=${path.join(smokeRoot, 'bootstrap')}`];

fs.rmSync(resultPath, { force: true });
const env = {
  ...process.env,
  HOME: smokeRoot,
  USERPROFILE: smokeRoot,
  APPDATA: path.join(smokeRoot, 'AppData', 'Roaming'),
  LOCALAPPDATA: path.join(smokeRoot, 'AppData', 'Local'),
  CI: 'true',
  GETSSH_CI_STARTUP_SMOKE_TOKEN: token,
};
delete env.ELECTRON_RUN_AS_NODE;

const TIMEOUT_MS = Number(process.env.GETSSH_SMOKE_TIMEOUT_MS) || 120_000;

/** Every process the app started too: the watchdog and helpers can hold its output pipes open. */
function killTree(pid) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}

/** Where a hung app waits: thread stacks of the main process and the process list (macOS). */
function hangDiagnostics(pid) {
  if (process.platform !== 'darwin') return '';
  const sample = spawnSync('sample', [String(pid), '5'], { encoding: 'utf8', timeout: 60_000 });
  const processes = spawnSync('ps', ['-axo', 'pid,ppid,stat,etime,command'], { encoding: 'utf8' });
  const lines = `${sample.stdout || sample.stderr || ''}`.split('\n').slice(0, 4000).join('\n');
  const ours = `${processes.stdout || ''}`.split('\n').filter(line => /GETSSH|watchdog|Electron/i.test(line)).join('\n');
  return `\n--- sample ${pid} ---\n${lines}\n--- processes ---\n${ours}`;
}

/** The app's exit, not its pipes closing: spawnSync waited for those and hung a job for 83 minutes. */
function runApp() {
  return new Promise(resolve => {
    const child = spawn(executable, args, { env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-200_000); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-200_000); });
    const timer = setTimeout(() => {
      const diagnostics = hangDiagnostics(child.pid);
      killTree(child.pid);
      resolve({ status: null, signal: 'timeout', stdout, stderr, diagnostics });
    }, TIMEOUT_MS);
    child.on('error', error => { clearTimeout(timer); resolve({ status: null, signal: null, stdout, stderr, error }); });
    child.on('exit', (status, signal) => {
      clearTimeout(timer);
      killTree(child.pid);
      resolve({ status, signal, stdout, stderr });
    });
  });
}

(async () => {
  let run;
  let reported;
  // Exclusive creation makes this runner the only owner of the directory it later removes.
  fs.mkdirSync(smokeRoot, { mode: 0o700 });
  try {
    run = await runApp();
    if (run.error) throw run.error;
    reported = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  } catch (error) {
    const stderr = (run?.stderr || '').trim();
    const stdout = (run?.stdout || '').trim();
    throw new Error(
      `Packaged GETSSH did not produce a startup result (status=${run?.status}, signal=${run?.signal}).` +
      `${stderr ? ` stderr=${stderr}` : ''}${stdout ? ` stdout=${stdout}` : ''}${run?.diagnostics || ''}`,
      { cause: error }
    );
  } finally {
    fs.rmSync(resultPath, { force: true });
    fs.rmSync(smokeRoot, { recursive: true, force: true });
  }

  if (run.status !== 0 || reported.status !== 'ok') {
    throw new Error(`Packaged GETSSH startup failed (status=${run.status}, signal=${run.signal}): ${JSON.stringify(reported)}${run.diagnostics || ''}`);
  }
  if (reported.platform !== process.platform || reported.arch !== process.arch) {
    throw new Error(
      `Packaged GETSSH architecture mismatch: expected ${process.platform}/${process.arch}, got ${reported.platform}/${reported.arch}`
    );
  }

  console.log(
    `Packaged GETSSH startup smoke passed on ${reported.platform}/${reported.arch} ` +
    `(Electron ${reported.electron}; ${reported.modules.length} native/runtime modules: ${reported.modules.join(', ')}).`
  );
})().catch(error => {
  console.error(error);
  process.exit(1);
});
