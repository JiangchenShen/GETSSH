'use strict';

// Run after vite build. Isolates native home/userData and never connects to a host.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron, expect } = require('@playwright/test');
const appDir = path.resolve(__dirname, '..');
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-ocean-status-'));
const bootstrap = path.join(testHome, 'main.cjs');
fs.writeFileSync(bootstrap, [
  "const { app } = require('electron');",
  "app.setPath('home', process.env.HOME);",
  `app.setPath('userData', ${JSON.stringify(path.join(testHome, 'userData'))});`,
  `app.setAppPath(${JSON.stringify(appDir)});`,
  `require(${JSON.stringify(path.join(appDir, 'dist-electron/main/index.js'))});`,
].join('\n'));
let application, electronPid;

(async () => {
  try {
    const env = { ...process.env, HOME: testHome, USERPROFILE: testHome, GETSSH_FAKE_STORE: '1' };
    delete env.VITE_DEV_SERVER_URL;
    delete env.ELECTRON_RUN_AS_NODE;
    application = await _electron.launch({ args: [bootstrap, '--use-mock-keychain'], env });
    electronPid = application.process().pid;
    expect(await application.evaluate(({ app }) => app.getPath('home'))).toBe(testHome);
    const page = await application.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => !!window.electronAPI);
    await page.evaluate(() => localStorage.setItem('appConfig', JSON.stringify({ language: 'en-US', theme: 'dark' })));
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.locator('button[title="Settings"]').click();
    await page.getByRole('navigation', { name: 'Settings categories', exact: true }).getByRole('button', { name: 'Ocean Sentinel', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Ocean Sentinel', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'View supervisor details', exact: true }).click();
    const detail = page.locator('section[aria-label="Ocean Sentinel"]');
    await expect(detail.getByRole('heading', { name: 'Runtime details', exact: true })).toBeFocused();
    await expect.poll(() => page.evaluate(async () => (await window.electronAPI.getSentinelStatus()).daemonState)).toBe('running');

    if (process.platform === 'darwin') {
      // Only terminate this isolated Electron process's own supervisor, identified by PID and parent.
      const rows = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8' }).split('\n');
      const supervisor = rows.map(row => row.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/)).find(row => row && Number(row[2]) === electronPid && row[3] === path.resolve(appDir, '../../target/release/watchdog'));
      expect(supervisor, 'isolated supervisor PID').toBeTruthy();
      process.kill(Number(supervisor[1]), 'SIGTERM');
      await expect.poll(() => page.evaluate(async () => (await window.electronAPI.getSentinelStatus()).daemonState)).toBe('unavailable');
      await detail.getByRole('button', { name: 'Refresh status', exact: true }).click();
      await expect(detail.getByText('Unavailable', { exact: true })).toBeVisible();
      await expect(detail.getByText('Healthy', { exact: true })).toHaveCount(0);
      console.log('PASS: real isolated supervisor exit is unavailable, never healthy.');
    }

    // Inject failures and pending responses only in this disposable main process.
    await application.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('get-sentinel-status');
      ipcMain.handle('get-sentinel-status', () => new Promise(resolve => { globalThis.__sentinelSmokeResolve = resolve; }));
    });
    await detail.getByRole('button', { name: 'Refresh status', exact: true }).click();
    await expect(detail.getByRole('button', { name: 'Refreshing…', exact: true })).toBeDisabled();
    await expect.poll(() => application.evaluate(() => typeof globalThis.__sentinelSmokeResolve)).toBe('function');
    await application.evaluate(() => globalThis.__sentinelSmokeResolve({ status: 'secure', daemonState: 'running', sentinelDisabled: false, lastPing: 123 }));
    await expect(detail.getByRole('status')).toContainText('Status updated');
    await expect(detail.getByRole('button', { name: 'Refresh status', exact: true })).toBeEnabled();
    await application.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('get-sentinel-status');
      ipcMain.handle('get-sentinel-status', () => { throw new Error('sentinel_smoke_status_failed'); });
    });
    await detail.getByRole('button', { name: 'Refresh status', exact: true }).click();
    await expect(detail.getByRole('alert')).toContainText('sentinel_smoke_status_failed');
    await expect(detail.getByText('Healthy', { exact: true })).toHaveCount(0);
    await expect(detail.getByRole('button', { name: 'Refresh status', exact: true })).toBeEnabled();
    await application.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('get-sentinel-status');
      ipcMain.handle('get-sentinel-status', () => ({ status: 'secure', daemonState: 'running', sentinelDisabled: false, lastPing: 456 }));
    });
    await detail.getByRole('button', { name: 'Refresh status', exact: true }).click();
    await expect(detail.getByRole('alert')).toHaveCount(0);
    await expect(detail.getByRole('status')).toContainText('Status updated');
    console.log('PASS: pending refresh, visible IPC failure, stale healthy cleared and retry succeeds.');

    await page.evaluate(() => {
      const config = JSON.parse(localStorage.getItem('appConfig') || '{}');
      localStorage.setItem('appConfig', JSON.stringify({ ...config, language: 'zh-CN', theme: 'light' }));
    });
    await page.reload();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await page.locator('button[title="设置"]').click();
    await page.getByRole('navigation', { name: '设置分类', exact: true }).getByRole('button', { name: '海洋守护中心', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: '海洋守护中心', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '查看进程监护详情', exact: true }).click();
    const chinese = page.locator('section[aria-label="海洋守护中心"]');
    await expect(chinese.getByRole('heading', { name: '运行详情', exact: true })).toBeFocused();
    await chinese.getByRole('button', { name: '刷新状态', exact: true }).click();
    await expect(chinese.getByRole('status')).toContainText('状态已更新');
    if (process.env.GETSSH_SMOKE_ARTIFACT_DIR) {
      fs.mkdirSync(process.env.GETSSH_SMOKE_ARTIFACT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.GETSSH_SMOKE_ARTIFACT_DIR, 'ocean-sentinel-zh.png') });
    }
    expect(errors).toEqual([]);
    console.log('PASS: Chinese Ocean Sentinel navigation, detail focus and refresh feedback.');
    console.log('Ocean Sentinel UI smoke passed.');
  } catch (error) {
    console.error('Ocean Sentinel UI smoke failed:', error);
    process.exitCode = 1;
  } finally {
    if (application) {
      await application.evaluate(({ app }) => app.exit(0)).catch(() => {});
      await application.close().catch(() => {});
    }
    if (process.platform === 'darwin' && electronPid) fs.rmSync(path.join(os.tmpdir(), `getssh-ocean-sentinel-${electronPid}.sock`), { force: true });
    fs.rmSync(testHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
})();
