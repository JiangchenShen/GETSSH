'use strict';

// Run after vite build. Uses isolated data and mock failures; never connects to a host.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron, expect } = require('@playwright/test');
const appDir = path.resolve(__dirname, '..');
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-button-smoke-'));
const bootstrap = path.join(testHome, 'main.cjs');
// Electron's native home path does not follow HOME on macOS; isolate it before loading app code.
fs.writeFileSync(bootstrap, [
  "const { app } = require('electron');",
  "app.setPath('home', process.env.HOME);",
  `app.setPath('userData', ${JSON.stringify(path.join(testHome, 'userData'))});`,
  `if (app.setAppPath) app.setAppPath(${JSON.stringify(appDir)});`,
  `require(${JSON.stringify(path.join(appDir, 'dist-electron/main/index.js'))});`,
].join('\n'));
let application, electronPid;

(async () => {
  try {
    const env = { ...process.env, HOME: testHome, USERPROFILE: testHome, GETSSH_FAKE_STORE: '1' };
    delete env.VITE_DEV_SERVER_URL;
    delete env.ELECTRON_RUN_AS_NODE;
    if (process.platform === 'win32') {
      env.APPDATA = path.join(testHome, 'AppData', 'Roaming');
      env.LOCALAPPDATA = path.join(testHome, 'AppData', 'Local');
      fs.mkdirSync(env.APPDATA, { recursive: true });
      fs.mkdirSync(env.LOCALAPPDATA, { recursive: true });
    }
    application = await _electron.launch({ args: [bootstrap, '--use-mock-keychain', `--user-data-dir=${path.join(testHome, 'userData')}`], env });
    electronPid = application.process().pid;
    expect(await application.evaluate(({ app }) => app.getPath('home'))).toBe(testHome);
    const page = await application.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('button[title="Settings"]').waitFor();
    await page.evaluate(() => {
      window.__buttonSmokeTabId = null;
      window.electronAPI.onTidalSyncTree(payload => { if (payload.tree) window.__buttonSmokeTabId = payload.tabId; });
    });

    // New centers must be revealed when their destination welcome pane is covered by zoom.
    await page.locator('button[title="Settings"]').click();
    await expect(page.locator('.home-shell')).toHaveCount(0);
    await page.getByRole('button', { name: 'Split', exact: true }).click();
    await expect(page.locator('button[title="Close Pane"]:visible')).toHaveCount(2);
    await page.locator('button[title="Zen Mode"]:visible').first().click();
    await expect(page.locator('button[title="Exit Zen Mode"]:visible')).toHaveCount(1);
    await page.locator('button[title="AI"]').click();
    await expect(page.locator('button[title="Exit Zen Mode"]:visible')).toHaveCount(0);
    await page.getByRole('button', { name: 'AI settings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'AI & Integrations', exact: true })).toBeVisible();
    console.log('PASS: split/zoom → first AI center revealed → AI settings destination.');

    // Details must appear within the settings viewport and receive keyboard focus.
    await page.getByRole('navigation', { name: 'Settings categories', exact: true }).getByRole('button', { name: 'Ocean Sentinel', exact: true }).click();
    await page.getByRole('button', { name: / · Configure$/ }).click();
    const privacy = page.locator('section[aria-label="Privacy & auto-lock"]');
    await expect(privacy).toBeFocused();
    await expect.poll(() => privacy.evaluate(el => {
      const detail = el.getBoundingClientRect();
      const viewport = el.closest('main').getBoundingClientRect();
      return detail.top < viewport.bottom && detail.bottom > viewport.top;
    })).toBe(true);
    await page.getByRole('button', { name: 'Close details', exact: true }).click();
    await expect(privacy).toHaveCount(0);
    await page.getByRole('button', { name: 'View logs', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Data & Logs', exact: true })).toBeVisible();
    console.log('PASS: security detail visibility/focus, close, and View logs navigation.');

    // Exercise the real main handler's resolved OS error, without launching Finder/Explorer.
    await application.evaluate(({ shell }) => { shell.openPath = async () => 'button_smoke_open_failed'; });
    await page.getByRole('button', { name: 'Open folder', exact: true }).click();
    await expect(page.getByText(/Could not open recording folder:.*button_smoke_open_failed/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open folder', exact: true })).toBeEnabled();
    console.log('PASS: OS folder failure reaches visible toast and button recovers.');

    // Inject main-process failures in this isolated process; no plugin is installed or executed.
    await application.evaluate(({ ipcMain }, stagingDir) => {
      for (const channel of ['preview-plugin', 'commit-plugin-install', 'abort-plugin-install']) ipcMain.removeHandler(channel);
      ipcMain.handle('preview-plugin', () => ({ success: true, manifest: { name: 'button-smoke', version: '1.0.0', getssh: { capabilities: [] } }, tempDir: stagingDir, sourceDir: stagingDir }));
      ipcMain.handle('commit-plugin-install', () => ({ success: false, error: 'button_smoke_install_failed' }));
      ipcMain.handle('abort-plugin-install', () => { throw new Error('button_smoke_cancel_failed'); });
    }, path.join(testHome, 'mock-preview'));
    const zip = path.join(testHome, 'button-smoke.zip');
    fs.writeFileSync(zip, 'mock preview only');
    await page.locator('button[title="Plugins"]').click();
    await page.locator('input[type="file"]').setInputFiles(zip);
    const review = page.getByRole('dialog', { name: 'Plugin Permission Review', exact: true });
    await expect(review).toBeVisible();
    await review.getByRole('button', { name: 'Accept & Install', exact: true }).click();
    await expect(review.getByRole('alert')).toContainText('button_smoke_install_failed');
    await review.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(review).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText('button_smoke_cancel_failed');
    console.log('PASS: plugin install error visible inside review, failed cleanup cannot trap Cancel.');

    // Quick addresses must not overwrite an ordinary draft or retain a previous quick address.
    await page.getByRole('button', { name: 'New Connection', exact: true }).first().click();
    // The form has its own address input; the Home input is excluded by :visible after opening.
    const formAddress = page.locator('.dashboard-shell input[placeholder="ssh://user@host:22"]:visible');
    await formAddress.fill('draft.example.test');
    await page.waitForTimeout(450); // Existing form commits edits after its 400ms debounce.
    for (const host of ['ssh://ops@quick.example.test:2222', 'ssh://root@other.example.test:2200']) {
      await page.locator('button[title="Settings"]').click();
      await page.getByRole('button', { name: 'Home', exact: true }).click();
      await page.locator('.home-connect-input').fill(host);
      await page.locator('.home-connect-submit').click();
      await expect(formAddress).toHaveValue(host.includes('other') ? 'other.example.test' : 'quick.example.test');
      await expect(page.locator('input[autocomplete="username"]:visible')).toHaveValue(host.includes('other') ? 'root' : 'ops');
      await expect(page.locator('input[type="number"]:visible').first()).toHaveValue(host.includes('other') ? '2200' : '2222');
    }
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'New Connection', exact: true }).first().click();
    await expect(formAddress).toHaveValue('draft.example.test');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    console.log('PASS: new quick addresses applied, repeated quick draft reset, ordinary draft preserved.');

    // A resolved native refusal must be visible rather than appearing to ignore a toolbar click.
    await page.locator('button[title="Settings"]').click();
    await expect(page.locator('.home-shell')).toHaveCount(0);
    await application.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('tidal:toggle-zoom');
      ipcMain.handle('tidal:toggle-zoom', () => ({ success: false, error: 'button_smoke_zoom_failed' }));
    });
    await page.locator('button[title="Zen Mode"]:visible').first().click();
    await expect(page.getByText(/button_smoke_zoom_failed/)).toBeVisible();
    console.log('PASS: resolved pane-action refusal produces visible feedback.');
    expect(errors).toEqual([]);
    console.log('Button controls UI smoke passed.');
  } catch (error) {
    console.error('Button controls UI smoke failed:', error);
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
