'use strict';

// Run after `vite build`: node scripts/split-pane-smoke.cjs
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron, expect } = require('@playwright/test');

const appDir = path.resolve(__dirname, '..');
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-split-smoke-'));
const bootstrap = path.join(testHome, 'main.cjs');
fs.writeFileSync(bootstrap, [
  "const { app } = require('electron');",
  "app.setPath('home', process.env.HOME);",
  `app.setPath('userData', ${JSON.stringify(path.join(testHome, 'userData'))});`,
  `if (app.setAppPath) app.setAppPath(${JSON.stringify(appDir)});`,
  `require(${JSON.stringify(path.join(appDir, 'dist-electron/main/index.js'))});`,
].join('\n'));
let application;
let electronPid;

(async () => {
  try {
    const env = { ...process.env, HOME: testHome, USERPROFILE: testHome, GETSSH_FAKE_STORE: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.VITE_DEV_SERVER_URL;
    if (process.platform === 'win32') {
      env.APPDATA = path.join(testHome, 'AppData', 'Roaming');
      env.LOCALAPPDATA = path.join(testHome, 'AppData', 'Local');
      fs.mkdirSync(env.APPDATA, { recursive: true });
      fs.mkdirSync(env.LOCALAPPDATA, { recursive: true });
    }
    application = await _electron.launch({
      args: [bootstrap, '--use-mock-keychain', `--user-data-dir=${path.join(testHome, 'userData')}`],
      env,
      timeout: 30_000,
    });
    electronPid = application.process().pid;
    const page = await application.firstWindow();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.waitForFunction(() => !!window.electronAPI);
    await expect.poll(() => page.evaluate(async () => (await window.electronAPI.appLock.getState()).phase)).toBe('ready');

    const split = page.getByRole('button', { name: /^(Split|分屏)$/ });
    const closePanes = page.locator('button[title="Close Pane"]:visible');
    await expect(split).toBeDisabled();
    await expect(closePanes).toHaveCount(0);
    await page.evaluate(() => {
      window.__splitSmokeTabId = null;
      window.electronAPI.onTidalSyncTree(payload => {
        if (payload.tree) window.__splitSmokeTabId = payload.tabId;
      });
      window.dispatchEvent(new CustomEvent('app:open-center', { detail: { type: 'settings', title: 'Split smoke settings' } }));
    });
    await expect(closePanes).toHaveCount(1);
    await expect(split).toBeEnabled();
    // The retiring Home dashboard stays above the panes during its exit animation.
    await expect(page.locator('.home-shell')).toHaveCount(0);

    for (const count of [2, 3, 4]) {
      await split.click();
      await expect(closePanes).toHaveCount(count);
    }
    await expect(split).toBeDisabled();

    const snapshot = () => page.evaluate(() => window.electronAPI.tidalGetTab(window.__splitSmokeTabId));
    const firstPaneWidth = () => closePanes.first().evaluate(button => button.parentElement.parentElement.parentElement.getBoundingClientRect().width);
    const dragVerticalDivider = async delta => {
      const divider = await page.locator('div.cursor-col-resize:visible').first().boundingBox();
      expect(divider).not.toBeNull();
      const x = divider.x + divider.width / 2;
      const y = divider.y + divider.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + delta, y, { steps: 8 });
      await page.mouse.up();
    };
    const initial = await snapshot();
    expect(initial.tree.type).toBe('hsplit');
    const initialWidth = await firstPaneWidth();
    await dragVerticalDivider(60);
    await expect.poll(async () => (await snapshot()).tree.sizes[0]).toBeGreaterThan(initial.tree.sizes[0] + 1);
    await expect.poll(firstPaneWidth).toBeGreaterThan(initialWidth + 8);

    await closePanes.last().click();
    await expect(closePanes).toHaveCount(3);
    await expect(split).toBeEnabled();

    // A narrow pane may still split vertically: only the axis being divided needs enough space.
    await dragVerticalDivider(160 - await firstPaneWidth());
    await expect.poll(firstPaneWidth).toBeLessThan(200);
    const narrowPane = closePanes.first().locator('xpath=../../..');
    expect((await narrowPane.boundingBox()).height).toBeGreaterThanOrEqual(200);
    const splitDown = narrowPane.locator('button[title="Split Down"]');
    await expect(splitDown).toBeEnabled();
    await narrowPane.hover();
    await splitDown.click();
    await expect(closePanes).toHaveCount(4);
    await expect(split).toBeDisabled();
    expect(pageErrors).toEqual([]);
    console.log('Split pane UI smoke passed: empty state, 1→2→3→4 panes, cap, native divider resize, close/re-enable, narrow-pane vertical split.');
  } catch (error) {
    console.error('Split pane UI smoke failed:', error);
    process.exitCode = 1;
  } finally {
    if (application) {
      await application.evaluate(({ app }) => app.exit(0)).catch(() => {});
      await application.close().catch(() => {});
    }
    if (process.platform === 'darwin' && electronPid) {
      fs.rmSync(path.join(os.tmpdir(), `getssh-ocean-sentinel-${electronPid}.sock`), { force: true });
    }
    fs.rmSync(testHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
})();
