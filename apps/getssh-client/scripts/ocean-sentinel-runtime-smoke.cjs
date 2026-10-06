'use strict';

// Run after vite build. Uses real IPC/native redaction and an ephemeral loopback-only model.
// Screenshot counts come from the synthetic prompt below; no renderer telemetry is fabricated.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { _electron, expect } = require('@playwright/test');

const appDir = path.resolve(__dirname, '..');
const artifacts = process.env.GETSSH_SMOKE_ARTIFACT_DIR
  ? path.resolve(process.env.GETSSH_SMOKE_ARTIFACT_DIR)
  : path.resolve(appDir, '../../docs/screenshots');
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-ocean-runtime-'));
const userData = path.join(testHome, 'userData');
const bootstrap = path.join(testHome, 'main.cjs');
fs.writeFileSync(bootstrap, [
  "const { app } = require('electron');",
  "app.setPath('home', process.env.HOME);",
  `app.setPath('userData', ${JSON.stringify(userData)});`,
  `app.setAppPath(${JSON.stringify(appDir)});`,
  `require(${JSON.stringify(path.join(appDir, 'dist-electron/main/index.js'))});`,
].join('\n'));

const env = { ...process.env, HOME: testHome, USERPROFILE: testHome, GETSSH_FAKE_STORE: '1' };
delete env.VITE_DEV_SERVER_URL;
delete env.ELECTRON_RUN_AS_NODE;
if (process.platform === 'win32') {
  env.APPDATA = path.join(testHome, 'AppData', 'Roaming');
  env.LOCALAPPDATA = path.join(testHome, 'AppData', 'Local');
  fs.mkdirSync(env.APPDATA, { recursive: true });
  fs.mkdirSync(env.LOCALAPPDATA, { recursive: true });
}

let application, page, currentPid;
const ownedPids = new Set();
const ownedSupervisors = new Map();
const pageErrors = [], ipcErrors = [], wireRequests = [];
const quitDiagnostics = [];
const model = http.createServer((request, response) => {
  if (request.socket.remoteAddress !== '127.0.0.1' || request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404).end();
    return;
  }
  let body = '';
  request.setEncoding('utf8');
  request.on('data', chunk => {
    body += chunk;
    if (body.length > 64 * 1024) request.destroy();
  });
  request.on('end', () => {
    try {
      wireRequests.push(JSON.parse(body));
      // The current Ollama adapter uses its OpenAI-compatible SSE endpoint.
      const delta = { choices: [{ index: 0, delta: { content: 'Synthetic UI test complete.' }, finish_reason: null }] };
      const done = { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      response.end(`data: ${JSON.stringify(delta)}\n\ndata: ${JSON.stringify(done)}\n\ndata: [DONE]\n\n`);
    } catch { response.writeHead(400).end(); }
  });
});

const nav = () => page.getByRole('navigation', { name: /^(设置分类|Settings categories)$/ });
const main = () => page.getByRole('main', { name: /^(海洋守护中心|Ocean Sentinel)$/ });
const runtime = () => main().locator('section[aria-label="海洋守护中心"], section[aria-label="Ocean Sentinel"]');
const entry = () => main().getByRole('button', { name: /^(查看进程监护详情|View supervisor details)$/ });
const refresh = () => runtime().getByRole('button', { name: /^(刷新状态|Refresh status)$/ });
const readStatus = () => page.evaluate(() => window.electronAPI.getSentinelStatus());
const counts = status => ({ run: status.stats.runtimeHits, today: status.stats.todayHits, total: status.stats.totalHits });

async function launch() {
  application = await _electron.launch({
    args: [bootstrap, '--use-mock-keychain', `--user-data-dir=${userData}`], env, timeout: 30000,
  });
  currentPid = application.process().pid;
  ownedPids.add(currentPid);
  application.process().stderr.on('data', chunk => {
    const text = chunk.toString();
    if (/Waiting for the debugger|quit|teardown/i.test(text)) quitDiagnostics.push(text.trim());
  });
  application.on('console', message => {
    if (/quit|teardown|shutdown/i.test(message.text())) quitDiagnostics.push(message.text());
  });
  expect(await application.evaluate(({ app }) => app.getPath('home'))).toBe(testHome);
  expect(await application.evaluate(({ app }) => app.getPath('userData'))).toBe(userData);
  page = await application.firstWindow();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /Error invoking remote method|No handler registered|\[Tidal\].*failed|Failed to fetch Ocean Sentinel/i.test(message.text())) ipcErrors.push(message.text());
  });
  await page.waitForFunction(() => !!window.electronAPI);
  await expect.poll(() => page.evaluate(async () => (await window.electronAPI.appLock.getState()).phase)).toBe('ready');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1360, 980));
  await expect.poll(async () => (await readStatus()).daemonState).toBe('running');
  const status = await readStatus();
  expect(status.supervisedPid).toBe(currentPid);
  expect(Number.isInteger(status.supervisorPid) && status.supervisorPid > 0).toBe(true);
  ownedSupervisors.set(status.supervisorPid, currentPid);
  if (process.platform === 'darwin') {
    const parent = execFileSync('/bin/ps', ['-p', String(status.supervisorPid), '-o', 'ppid='], { encoding: 'utf8' }).trim();
    expect(Number(parent)).toBe(currentPid);
  }
  expect(status.gateway).toMatchObject({ mode: 'native', state: 'ready' });
  console.log(`ISOLATION: HOME=${testHome}; userData=${userData}; main PID=${currentPid}; own watchdog PID=${status.supervisorPid}`);
  return status;
}

async function quit() {
  if (!application) return;
  // Playwright's close() disconnects the Node inspector immediately after app.quit().
  // Keep it attached until GETSSH's asynchronous will-quit teardown finishes.
  const child = application.process();
  const exited = new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
    child.once('close', resolve);
  });
  await application.evaluate(({ app }) => { setTimeout(() => app.quit(), 0); }).catch(() => {});
  let timer;
  const graceful = await Promise.race([exited.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 10000); })]);
  clearTimeout(timer);
  if (!graceful) {
    console.log(`LIMITATION: isolated Electron PID ${child.pid} did not exit within 10s after app.quit(); using app.exit(0) for restart. This does not prove graceful-shutdown flush. ${JSON.stringify(quitDiagnostics)}`);
    await application.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`isolated Electron PID ${child.pid} did not exit`)), 5000); })]).finally(() => clearTimeout(timer));
  }
  await application.close();
  expect(child.exitCode).toBe(0);
  application = undefined;
  page = undefined;
  if (process.platform === 'darwin') fs.rmSync(path.join(os.tmpdir(), `getssh-ocean-sentinel-${currentPid}.sock`), { force: true });
  return graceful;
}

async function configure(language, theme) {
  if (await nav().count() === 0) await page.locator('button[title="Settings"], button[title="设置"]').click();
  await nav().getByRole('button', { name: /^(通用|General)$/ }).click();
  await page.getByRole('main', { name: /^(通用|General)$/ }).locator('select').selectOption(language);
  await nav().getByRole('button', { name: language === 'zh-CN' ? '外观' : 'Appearance', exact: true }).click();
  await page.getByRole('button', { name: language === 'zh-CN' ? (theme === 'dark' ? '深色' : '浅色') : (theme === 'dark' ? 'Dark' : 'Light'), exact: true }).click();
  if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
  else await expect(page.locator('html')).not.toHaveClass(/dark/);
  await nav().getByRole('button', { name: language === 'zh-CN' ? '海洋守护中心' : 'Ocean Sentinel', exact: true }).click();
  await expect(main().getByRole('heading', { level: 1, name: language === 'zh-CN' ? '海洋守护中心' : 'Ocean Sentinel', exact: true })).toBeVisible();
}

async function openRuntime() {
  await entry().focus();
  await page.keyboard.press('Enter');
  const heading = runtime().getByRole('heading', { level: 2, name: /^(运行详情|Runtime details)$/ });
  await expect(heading).toBeFocused();
  await expect(runtime().getByTestId('sentinel-gateway-state')).toHaveText(/^(原生脱敏|Native redaction)$/);
  await expect(runtime().getByTestId('runtime-supervised-pid')).toHaveText(String(currentPid));
}

async function back() {
  await runtime().getByRole('button', { name: /^(返回安全总览|Back to security overview)$/ }).focus();
  await page.keyboard.press('Enter');
  await expect(runtime()).toHaveCount(0);
  await expect(entry()).toBeFocused();
}

async function assertCounts(expected) {
  await refresh().click();
  await expect(runtime().getByRole('status')).toContainText(/状态已更新|Status updated/);
  await expect(runtime().getByTestId('sentinel-runtime-hits')).toHaveText(String(expected.run));
  await expect(runtime().getByTestId('sentinel-today-hits')).toHaveText(String(expected.today));
  await expect(runtime().getByTestId('sentinel-total-hits')).toHaveText(String(expected.total));
  expect(counts(await readStatus())).toEqual(expected);
}

async function screenshot(name) {
  await expect.poll(() => main().evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await main().evaluate(element => { element.scrollTop = 0; });
  await page.evaluate(() => document.fonts.ready);
  const file = path.join(artifacts, name);
  await page.screenshot({ path: file, animations: 'disabled' });
  console.log(`SCREENSHOT: ${file} (real counts from a synthetic localhost UI test)`);
}

(async () => {
  try {
    fs.mkdirSync(artifacts, { recursive: true });
    await new Promise((resolve, reject) => { model.once('error', reject); model.listen(0, '127.0.0.1', resolve); });
    const endpoint = `http://127.0.0.1:${model.address().port}`;
    const initial = await launch();
    expect(counts(initial)).toEqual({ run: 0, today: 0, total: 0 });
    await configure('zh-CN', 'dark');
    await openRuntime();
    await assertCounts({ run: 0, today: 0, total: 0 });
    await back();
    await openRuntime();
    console.log('PASS: real supervisor/native gateway, initial zero counts, keyboard entry heading focus and return entry focus.');

    const stream = await page.evaluate(async endpoint => {
      const requestId = `ocean-runtime-smoke-${Date.now()}`;
      let finish, timer;
      const completed = new Promise(resolve => { finish = resolve; });
      const chunks = [];
      // Install the stream listener before invoke, including for an immediate local response.
      const unsubscribe = window.electronAPI.ai.onStreamChunk(requestId, message => {
        if (message.chunk) chunks.push(message.chunk);
        if (message.isDone) finish({ text: chunks.join(''), error: message.error || null });
      });
      timer = setTimeout(() => finish({ text: chunks.join(''), error: 'local model stream timed out' }), 15000);
      try {
        const ack = await window.electronAPI.ai.invokePrivileged({
          requestId, provider: 'ollama', mode: 'readonly', model: 'ocean-runtime-fixture', endpoint,
          prompt: 'UI test 10.8.7.6 10.8.7.6',
        });
        return { ack, result: await completed };
      } finally { clearTimeout(timer); unsubscribe(); }
    }, endpoint);
    expect(stream.ack.success).toBe(true);
    expect(stream.ack._audit.sentinelActive).toBe(true);
    expect(stream.result).toEqual({ text: 'Synthetic UI test complete.', error: null });
    expect(wireRequests).toHaveLength(1);
    const wire = JSON.stringify(wireRequests[0]);
    expect(wire).not.toContain('10.8.7.6');
    expect([...wire.matchAll(/\[GETSSH_[0-9A-F]{32}_IP_\d+\]/g)]).toHaveLength(2);
    await assertCounts({ run: 2, today: 2, total: 2 });
    const recorded = await readStatus();
    expect(recorded.stats.persistence).toBe('available');
    expect(recorded.stats.recordedSince).toBeGreaterThan(0);
    await assertCounts({ run: 2, today: 2, total: 2 });
    console.log('PASS: real privileged AI IPC/local Ollama SSE, redacted wire body, two repeated replacements counted twice; audit/status refresh add zero.');
    console.log(`REAL STATUS: ${JSON.stringify(recorded)}`);
    await screenshot('ocean-sentinel-runtime-zh-dark.png');

    await back();
    await configure('zh-CN', 'light');
    await openRuntime();
    await assertCounts({ run: 2, today: 2, total: 2 });
    await screenshot('ocean-sentinel-runtime-zh-light.png');

    await page.getByRole('button', { name: '分屏', exact: true }).click();
    await expect(page.locator('button[title="Close Pane"]:visible')).toHaveCount(2);
    if (await entry().count()) await openRuntime();
    const divider = await page.locator('div.cursor-col-resize:visible').first().boundingBox();
    expect(divider).not.toBeNull();
    await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2);
    await page.mouse.down();
    await page.mouse.move(divider.x - 120, divider.y + divider.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await main().boundingBox()).width).toBeLessThan(400);
    await assertCounts({ run: 2, today: 2, total: 2 });
    console.log(`PASS: actual narrow split settings content ${Math.round((await main().boundingBox()).width)}px.`);
    await screenshot('ocean-sentinel-runtime-zh-split.png');
    await page.locator('button[title="Close Pane"]:visible').last().click();
    await expect(page.locator('button[title="Close Pane"]:visible')).toHaveCount(1);

    await back();
    await configure('en-US', 'dark');
    await openRuntime();
    await assertCounts({ run: 2, today: 2, total: 2 });
    await screenshot('ocean-sentinel-runtime-en-dark.png');
    expect(pageErrors).toEqual([]);
    expect(ipcErrors).toEqual([]);

    const gracefulRestart = await quit();
    const restarted = await launch();
    const expected = { run: 0, today: restarted.stats.day === recorded.stats.day ? 2 : 0, total: 2 };
    expect(counts(restarted)).toEqual(expected);
    expect(restarted.stats.recordedSince).toBe(recorded.stats.recordedSince);
    await configure('en-US', 'dark');
    await openRuntime();
    await assertCounts(expected);
    expect(wireRequests).toHaveLength(1);
    expect(pageErrors).toEqual([]);
    expect(ipcErrors).toEqual([]);
    console.log(`PASS: ${gracefulRestart ? 'graceful restart' : 'real process restart after app.exit'} using the same isolated HOME/userData resets run count to zero and retains stored totals (${JSON.stringify(expected)}).`);
    console.log('Ocean Sentinel runtime smoke passed: real native metrics, durable counters, watchdog PID, themes/languages, narrow split and keyboard focus; no renderer/IPC errors.');
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, 'ocean-sentinel-runtime-failure.png'), animations: 'disabled' }).catch(() => {});
    console.error('Ocean Sentinel runtime smoke failed:', error);
    process.exitCode = 1;
  } finally {
    try { if (process.exitCode) throw new Error('failed smoke cleanup'); await quit(); }
    catch {
      if (application) {
        await application.evaluate(({ app }) => app.exit(1)).catch(() => {});
        await application.close().catch(() => {});
      }
    }
    // Only the captured supervisors from these disposable main processes may be signalled.
    if (process.platform === 'darwin') {
      for (const [pid, parentPid] of ownedSupervisors) {
        try {
          const row = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'ppid=,comm='], { encoding: 'utf8' }).trim();
          const match = row.match(/^(\d+)\s+(.+)$/);
          if (match && Number(match[1]) === parentPid && match[2] === path.resolve(appDir, '../../target/release/watchdog')) process.kill(pid, 'SIGTERM');
        } catch {}
      }
      for (const pid of ownedPids) fs.rmSync(path.join(os.tmpdir(), `getssh-ocean-sentinel-${pid}.sock`), { force: true });
    }
    model.closeAllConnections();
    await new Promise(resolve => model.close(resolve));
    fs.rmSync(testHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
})();
