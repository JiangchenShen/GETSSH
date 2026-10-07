'use strict';

// Run after vite build. Screenshots use live isolated status; no status or telemetry is fabricated.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron, expect } = require('@playwright/test');

const appDir = path.resolve(__dirname, '..');
const artifacts = path.resolve(appDir, '../../docs/screenshots');
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-ocean-dashboard-'));
const bootstrap = path.join(testHome, 'main.cjs');
fs.writeFileSync(bootstrap, [
  "const { app } = require('electron');",
  "app.setPath('home', process.env.HOME);",
  `app.setPath('userData', ${JSON.stringify(path.join(testHome, 'userData'))});`,
  `app.setAppPath(${JSON.stringify(appDir)});`,
  `require(${JSON.stringify(path.join(appDir, 'dist-electron/main/index.js'))});`,
].join('\n'));

let application, electronPid, page;
const pageErrors = [];
const ipcErrors = [];

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
    application = await _electron.launch({ args: [bootstrap, '--use-mock-keychain', `--user-data-dir=${path.join(testHome, 'userData')}`], env, timeout: 30000 });
    electronPid = application.process().pid;
    expect(await application.evaluate(({ app }) => app.getPath('home'))).toBe(testHome);
    expect(await application.evaluate(({ app }) => app.getPath('userData'))).toBe(path.join(testHome, 'userData'));
    page = await application.firstWindow();
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' && /Error invoking remote method|No handler registered|\[Tidal\].*failed|Failed to fetch Ocean Sentinel/i.test(message.text())) ipcErrors.push(message.text());
    });
    await page.waitForFunction(() => !!window.electronAPI);
    await expect.poll(() => page.evaluate(async () => (await window.electronAPI.appLock.getState()).phase)).toBe('ready');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1360, 980));
    fs.mkdirSync(artifacts, { recursive: true });

    const configure = async theme => {
      await page.evaluate(theme => {
        const config = JSON.parse(localStorage.getItem('appConfig') || '{}');
        localStorage.setItem('appConfig', JSON.stringify({ ...config, language: 'zh-CN', theme }));
      }, theme);
      await page.reload();
      if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
      else await expect(page.locator('html')).not.toHaveClass(/dark/);
      await page.locator('button[title="设置"]').click();
      await expect(page.locator('.home-shell')).toHaveCount(0);
      await page.getByRole('navigation', { name: '设置分类', exact: true }).getByRole('button', { name: '海洋守护中心', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: '海洋守护中心', exact: true })).toBeVisible();
      await expect.poll(() => page.evaluate(async () => (await window.electronAPI.getSentinelStatus()).daemonState)).toBe('running');
      await page.evaluate(async () => { await document.fonts.ready; });
    };
    const assertNoHorizontalOverflow = async locator => {
      await expect.poll(() => locator.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    };
    const screenshot = async name => {
      await main().evaluate(element => { element.scrollTop = 0; });
      await page.evaluate(() => document.activeElement?.blur());
      await page.screenshot({ path: path.join(artifacts, name), animations: 'disabled' });
      console.log(`SCREENSHOT: ${path.join(artifacts, name)}`);
    };

    // Remaining locators follow the dashboard's accessible names; only real IPC is exercised.
    await configure('dark');
    const main = () => page.getByRole('main', { name: '海洋守护中心', exact: true });
    const overview = () => main().getByRole('region', { name: '安全总览', exact: true });
    await expect(overview()).toBeVisible();
    expect(await page.evaluate(async () => (await window.electronAPI.security.status()).scopes.find(scope => scope.workspaceId === 'default').protected)).toBe(false);
    await expect(main().getByText('这个工作区没有密码', { exact: true })).toBeVisible();
    const refresh = overview().getByRole('button', { name: '刷新状态', exact: true });
    await refresh.focus();
    await page.keyboard.press('Enter');
    await expect(overview().getByRole('status').filter({ hasText: '状态已更新' })).toBeVisible();
    await expect(refresh).toBeEnabled();
    const detailsTrigger = overview().getByRole('button', { name: '查看进程监护详情', exact: true });
    await detailsTrigger.focus();
    await page.keyboard.press('Enter');
    const details = main().locator('section[aria-label="海洋守护中心"]');
    await expect(details.getByRole('heading', { name: '运行详情', exact: true })).toBeFocused();
    await expect.poll(() => details.evaluate(element => {
      const box = element.getBoundingClientRect();
      const viewport = element.closest('main').getBoundingClientRect();
      return box.top < viewport.bottom && box.bottom > viewport.top;
    })).toBe(true);
    await expect(main().getByRole('button', { name: '刷新状态', exact: true })).toHaveCount(1);
    await expect(details.getByRole('button', { name: '刷新状态', exact: true })).toBeVisible();
    await details.getByRole('button', { name: '返回安全总览', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(details).toHaveCount(0);
    await expect(detailsTrigger).toBeFocused();
    await expect(main().getByText('这个工作区没有密码', { exact: true })).toBeVisible();
    await assertNoHorizontalOverflow(main());
    await screenshot('ocean-sentinel-dashboard-zh-dark.png');

    await configure('light');
    await expect(overview()).toBeVisible();
    await expect(main().getByText('这个工作区没有密码', { exact: true })).toBeVisible();
    await assertNoHorizontalOverflow(main());
    await screenshot('ocean-sentinel-dashboard-zh-light.png');

    // The existing Tidal divider creates an actual narrow settings pane beside a welcome pane.
    await page.getByRole('button', { name: '分屏', exact: true }).click();
    await expect(page.locator('button[title="Close Pane"]:visible')).toHaveCount(2);
    const divider = await page.locator('div.cursor-col-resize:visible').first().boundingBox();
    expect(divider).not.toBeNull();
    await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2);
    await page.mouse.down();
    await page.mouse.move(divider.x - 120, divider.y + divider.height / 2, { steps: 8 });
    await page.mouse.up();
    await assertNoHorizontalOverflow(main());
    console.log(`PASS: narrow settings viewport width ${Math.round((await main().boundingBox()).width)}px without horizontal overflow.`);
    await screenshot('ocean-sentinel-dashboard-zh-split.png');

    // Privacy remains reachable, returns focus on close, and audit retains its own destination.
    const privacy = main().getByRole('button', { name: / · 配置$/ });
    await privacy.focus();
    await page.keyboard.press('Enter');
    const privacyDetail = main().locator('section[aria-label="隐私与自动锁定"]');
    await expect(privacyDetail).toBeFocused();
    await assertNoHorizontalOverflow(main());
    await privacyDetail.getByRole('button', { name: '关闭详情', exact: true }).click();
    await expect(privacyDetail).toHaveCount(0);
    await expect(privacy).toBeFocused();
    await main().getByRole('button', { name: '查看记录', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: '数据与日志', exact: true })).toBeVisible();
    expect(pageErrors).toEqual([]);
    expect(ipcErrors).toEqual([]);
    console.log('Ocean Sentinel dashboard smoke passed: real supervisor, natural workspace warning, Chinese dark/light, split-pane overflow, keyboard refresh/details/privacy and audit navigation, no renderer or IPC errors.');
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(os.tmpdir(), 'getssh-ocean-dashboard-failure.png'), animations: 'disabled' }).catch(() => {});
    console.error('Ocean Sentinel dashboard smoke failed:', error);
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
