'use strict';

// Run after vite build. Only isolated test profiles and one real local PTY are created.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron, expect } = require('@playwright/test');
const copy = require('../src/locales/zh-CN.json').translation;
const english = require('../src/locales/en-US.json').translation;

const appDir = path.resolve(__dirname, '..');
const artifacts = process.env.GETSSH_HOME_ARTIFACTS || path.resolve(appDir, '../../docs/screenshots');
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-home-dashboard-'));
const userData = path.join(testHome, 'userData');
const bootstrap = path.join(testHome, 'main.cjs');
fs.mkdirSync(artifacts, { recursive: true });
fs.writeFileSync(bootstrap, [
  "const { app } = require('electron');",
  "app.setPath('home', process.env.HOME);",
  `app.setPath('userData', ${JSON.stringify(userData)});`,
  `app.setAppPath(${JSON.stringify(appDir)});`,
  `require(${JSON.stringify(path.join(appDir, 'dist-electron/main/index.js'))});`,
].join('\n'));

let application, electronPid, page;
const pageErrors = [];
const ipcErrors = [];
const testProfiles = ['Alpha', 'Beta', 'Gamma'].map((name, index) => ({
  id: `home-dashboard-smoke-${name.toLowerCase()}`,
  alias: `UI 测试 · ${name}`,
  host: `${name.toLowerCase()}.example.test`,
  username: 'ui-test',
  port: index === 1 ? 2222 : 22,
  protocol: 'ssh',
  group: 'UI 测试配置',
  autoStart: false,
  authType: 'password',
  password: '',
}));

(async () => {
  try {
    const env = { ...process.env, HOME: testHome, USERPROFILE: testHome, GETSSH_FAKE_STORE: '1' };
    delete env.VITE_DEV_SERVER_URL;
    delete env.ELECTRON_RUN_AS_NODE;
    // An interactive shell in an empty temporary HOME must not read the user's shell startup files.
    delete env.BASH_ENV;
    delete env.ENV;
    env.ZDOTDIR = testHome;
    if (process.platform !== 'win32') env.SHELL = '/bin/bash';
    if (process.platform === 'win32') {
      env.APPDATA = path.join(testHome, 'AppData', 'Roaming');
      env.LOCALAPPDATA = path.join(testHome, 'AppData', 'Local');
      fs.mkdirSync(env.APPDATA, { recursive: true });
      fs.mkdirSync(env.LOCALAPPDATA, { recursive: true });
    }
    application = await _electron.launch({ args: [bootstrap, '--use-mock-keychain', `--user-data-dir=${userData}`], env, timeout: 30000 });
    electronPid = application.process().pid;
    expect(await application.evaluate(({ app }) => app.getPath('home'))).toBe(testHome);
    expect(await application.evaluate(({ app }) => app.getPath('userData'))).toBe(userData);
    page = await application.firstWindow();
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' && /Error invoking remote method|No handler registered|\[Tidal\].*failed|Failed to fetch Ocean Sentinel|\[CryptoBoot\]/i.test(message.text())) ipcErrors.push(message.text());
    });
    await page.waitForFunction(() => !!window.electronAPI);
    await expect.poll(() => page.evaluate(async () => (await window.electronAPI.appLock.getState()).phase)).toBe('ready');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1360, 980));

    const home = () => page.locator('main.home-shell');
    const count = async (name, expected) => expect(home().getByTestId(`home-${name}-count`)).toHaveText(String(expected));
    const assertNoHorizontalOverflow = async () => {
      await expect.poll(() => home().evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    };
    const screenshot = async (name, atEnd = false) => {
      await home().evaluate((element, atEnd) => { element.scrollTop = atEnd ? element.scrollHeight : 0; }, atEnd);
      await page.evaluate(async () => { document.activeElement?.blur(); await document.fonts.ready; });
      await page.screenshot({ path: path.join(artifacts, name), animations: 'disabled' });
      console.log(`SCREENSHOT: ${path.join(artifacts, name)}`);
    };
    const configure = async theme => {
      // Bootstrap only appearance preferences before any live terminal is opened.
      await page.evaluate(theme => {
        const config = JSON.parse(localStorage.getItem('appConfig') || '{}');
        localStorage.setItem('appConfig', JSON.stringify({ ...config, language: 'zh-CN', theme }));
      }, theme);
      await page.reload();
      await expect(home()).toBeVisible();
      if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
      else await expect(page.locator('html')).not.toHaveClass(/dark/);
    };
    const returnHome = async () => {
      await page.getByRole('button', { name: copy.tabs.home, exact: true }).click();
      await expect(home()).toBeVisible();
    };
    const form = () => page.locator('.dashboard-shell:visible');
    const savedProfiles = () => page.evaluate(() => window.electronAPI.unlockProfiles(''));

    await configure('dark');
    expect(await savedProfiles()).toHaveLength(0);
    await count('saved', 0);
    await count('terminal', 0);
    await count('workspace', (await page.evaluate(() => window.electronAPI.workspace.getWorkspaces())).length);
    await count('disconnected', 0);
    await assertNoHorizontalOverflow();
    await screenshot('home-dashboard-zh-empty-dark.png');
    await configure('light');
    await count('saved', 0);
    await count('terminal', 0);
    await assertNoHorizontalOverflow();
    await screenshot('home-dashboard-zh-empty-light.png');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(860, 980));
    await assertNoHorizontalOverflow();
    await screenshot('home-dashboard-zh-narrow.png');
    console.log('PASS: empty workspace truthful zero counts, Chinese dark/light and narrow window without horizontal overflow.');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1360, 980));

    // Quick connect configures an address and credentials without opening a network connection.
    await home().locator('.home-connect-input').fill('ssh://ui-test@quick.example.test:2222');
    await home().locator('.home-connect-submit').click();
    await expect(form()).toBeVisible();
    await expect(form().locator('input[placeholder="ssh://user@host:22"]')).toHaveValue('quick.example.test');
    await expect(form().locator('input[autocomplete="username"]')).toHaveValue('ui-test');
    await expect(form().locator('input[type="number"]').first()).toHaveValue('2222');
    await form().getByRole('button', { name: copy.common.cancel, exact: true }).click();
    await expect(home()).toBeVisible();
    await count('saved', 0);
    expect(await savedProfiles()).toHaveLength(0);
    console.log('PASS: real Quick Connect opens parsed host/user/port configuration; Cancel leaves no saved profile or network session.');

    // This is the same production IPC used by the editor, scoped to the isolated default workspace.
    expect(await page.evaluate(profiles => window.electronAPI.saveProfiles({ workspaceId: 'default', payload: profiles }), testProfiles)).toBe(true);
    expect((await savedProfiles()).map(profile => profile.id).sort()).toEqual(testProfiles.map(profile => profile.id).sort());
    await configure('dark');
    await count('saved', 3);
    await count('terminal', 0);
    await expect(home().locator('.home-host-row')).toHaveCount(3);
    for (const profile of testProfiles) await expect(home().locator('.home-host-row').filter({ hasText: profile.alias })).toContainText(`${profile.username}@${profile.host}:${profile.port}`);
    await screenshot('home-dashboard-zh-saved-hosts.png');
    console.log('PASS: three clearly marked test profiles loaded by real IPC and normal app boot; no SSH connection is attempted.');

    await page.evaluate(() => {
      window.__homeDashboardLocal = null;
      window.electronAPI.onTidalSyncTree(snapshot => {
        const findLocal = node => {
          if (!node) return null;
          if (node.type === 'leaf') return node.paneType === 'terminal' && node.config?.protocol === 'local' ? node : null;
          return findLocal(node.children[0]) || findLocal(node.children[1]);
        };
        const local = findLocal(snapshot.tree);
        if (local) window.__homeDashboardLocal = { tabId: snapshot.tabId, sessionId: local.sessionId };
      });
    });
    // A real quick local connection stays unsaved, leaving the three SSH test profiles intact.
    await home().locator('.home-connect-input').fill('local');
    await home().locator('.home-connect-submit').click();
    await expect(form().getByText(copy.connection.localReady, { exact: true })).toBeVisible();
    await form().getByLabel(copy.connection.alias, { exact: true }).fill('本地终端 · UI 测试');
    await form().getByRole('button', { name: copy.connection.connectBtn, exact: true }).click();
    await expect(home()).toHaveCount(0);
    await expect(page.locator('.xterm-helper-textarea:visible')).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => window.__homeDashboardLocal?.sessionId)).toBeTruthy();
    const local = await page.evaluate(() => window.__homeDashboardLocal);
    const onlineLocal = () => page.evaluate(async id => (await window.electronAPI.getConnectionLogs()).filter(log => log.id === id && log.host === 'localhost' && log.disconnectedAt === 'Online'), local.sessionId);
    expect(await onlineLocal()).toHaveLength(1);
    const runMarker = async marker => {
      await page.locator('.xterm-helper-textarea:visible').focus();
      await page.keyboard.type(`printf '%s\\n' '${marker}'; pwd`);
      await page.keyboard.press('Enter');
      await expect.poll(() => page.evaluate(async id => (await window.electronAPI.sshGetScrollback(id)).data, local.sessionId)).toContain(`${marker}\r\n`);
      expect(await page.evaluate(async id => (await window.electronAPI.sshGetScrollback(id)).data, local.sessionId)).toContain(testHome);
    };
    await runMarker('GETSSH_HOME_SMOKE_BEFORE_HOME');
    await returnHome();
    await count('saved', 3);
    await count('terminal', 1);
    await count('disconnected', 0);
    expect(await onlineLocal()).toHaveLength(1);
    await expect(home().locator('.home-resume')).toContainText('本地终端 · UI 测试');
    await screenshot('home-dashboard-zh-live-terminal.png');
    await home().locator('.home-resume').click();
    await expect(home()).toHaveCount(0);
    await expect(page.locator('.xterm-helper-textarea:visible')).toHaveCount(1);
    expect(await page.evaluate(() => window.__homeDashboardLocal)).toEqual(local);
    await runMarker('GETSSH_HOME_SMOKE_AFTER_CONTINUE');
    expect(await onlineLocal()).toHaveLength(1);
    console.log('PASS: one real local PTY counted, Home preserves its backend session, Continue returns to the same session and executes a second marker.');

    // Switch the live workspace through the actual Appearance page; no reload or session reset.
    await page.locator(`button[title="${copy.statusBar.settings}"]`).click();
    await page.getByRole('navigation', { name: '设置分类', exact: true }).getByRole('button', { name: '外观', exact: true }).click();
    await page.getByRole('main', { name: '外观', exact: true }).getByRole('button', { name: copy.settings.light, exact: true }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await page.locator('div[title="本地终端 · UI 测试"][draggable="true"]').click();
    await returnHome();
    await count('saved', 3);
    await count('terminal', 1);
    await expect(home().locator('.home-resume')).toContainText('本地终端 · UI 测试');
    expect(await onlineLocal()).toHaveLength(1);
    await screenshot('home-dashboard-zh-live-terminal-light.png');

    await returnHome();
    await home().getByRole('button', { name: '管理工作区', exact: true }).click();
    await expect(home()).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: copy.workspaceCenter.title, exact: true })).toBeVisible();
    expect(await onlineLocal()).toHaveLength(1);
    await returnHome();
    await home().getByRole('button', { name: '查看海洋守护中心', exact: true }).first().click();
    await expect(home()).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: copy.settings.secureCenter, exact: true })).toBeVisible();
    expect(await onlineLocal()).toHaveLength(1);
    const logs = await page.evaluate(() => window.electronAPI.getConnectionLogs());
    expect(logs.filter(log => log.disconnectedAt === 'Online')).toHaveLength(1);
    expect(logs.every(log => log.host === 'localhost')).toBe(true);
    console.log('PASS: Home workspace and security actions reach their actual pages without closing the local session; no SSH hosts were contacted.');

    // Review the longer English copy using the same real profiles and live PTY.
    await page.getByRole('navigation', { name: '设置分类', exact: true }).getByRole('button', { name: '通用', exact: true }).click();
    await page.getByRole('main', { name: '通用', exact: true }).getByRole('combobox').selectOption('en-US');
    await page.getByRole('navigation', { name: 'Settings categories', exact: true }).getByRole('button', { name: 'Appearance', exact: true }).click();
    await page.getByRole('main', { name: 'Appearance', exact: true }).getByRole('button', { name: english.settings.dark, exact: true }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.locator('div[title="本地终端 · UI 测试"][draggable="true"]').click();
    await page.getByRole('button', { name: english.tabs.home, exact: true }).click();
    await expect(home()).toBeVisible();
    await count('saved', 3);
    await count('terminal', 1);
    await assertNoHorizontalOverflow();
    await screenshot('home-dashboard-en-live-terminal.png');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(860, 980));
    await assertNoHorizontalOverflow();
    await screenshot('home-dashboard-en-narrow.png');
    await screenshot('home-dashboard-en-narrow-context.png', true);
    await expect(home().getByRole('button', { name: english.welcome.home.manageWorkspace, exact: true })).toBeInViewport();
    await expect(home().locator('.home-context').getByRole('button', { name: english.welcome.home.reviewSecurity, exact: true })).toBeInViewport();
    expect(await onlineLocal()).toHaveLength(1);
    expect(pageErrors).toEqual([]);
    expect(ipcErrors).toEqual([]);
    console.log('PASS: actual settings theme/language controls preserve the live PTY; filled Chinese light and English wide/narrow layouts remain readable without horizontal overflow.');
    console.log('Home dashboard smoke passed: isolated data, real counts and test profile IPC, Chinese empty/filled dark/light/narrow screenshots, Quick Connect, live local terminal Home/Continue preservation, workspace/security routing, no renderer or IPC errors.');
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, 'home-dashboard-failure.png'), animations: 'disabled' }).catch(() => {});
    console.error('Home dashboard smoke failed:', error);
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
