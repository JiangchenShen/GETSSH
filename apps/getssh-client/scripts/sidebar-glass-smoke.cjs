'use strict';

// Run against vite build. Every preference is changed through the real Appearance controls.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron, expect } = require('@playwright/test');

const appDir = path.resolve(__dirname, '..');
const artifacts = process.env.GETSSH_GLASS_ARTIFACTS || path.join(os.tmpdir(), 'getssh-sidebar-glass-validation-20261004');
const testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-sidebar-glass-'));
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
    application = await _electron.launch({ args: [bootstrap, '--use-mock-keychain', `--user-data-dir=${userData}`], env, timeout: 30000 });
    electronPid = application.process().pid;
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
    await page.evaluate(() => {
      const config = JSON.parse(localStorage.getItem('appConfig') || '{}');
      localStorage.setItem('appConfig', JSON.stringify({ ...config, language: 'en-US', theme: 'dark', enableGlassmorphism: true, bgOpacity: 1 }));
    });
    await page.reload();
    await page.locator('button[title="Settings"]').click();
    await page.getByRole('navigation', { name: 'Settings categories', exact: true }).getByRole('button', { name: 'Appearance', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Appearance', exact: true })).toBeVisible();
    await page.evaluate(async () => { await document.fonts.ready; });

    const cdp = await page.context().newCDPSession(page);
    const emulateTransparency = async value => {
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value }] });
      expect(await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches)).toBe(value === 'reduce');
    };
    await emulateTransparency('no-preference');
    const main = page.getByRole('main', { name: 'Appearance', exact: true });
    const opacity = main.getByRole('slider', { name: 'Background opacity', exact: true });
    const glass = main.getByRole('switch', { name: 'Enable Glassmorphism', exact: true });
    const materials = [
      ['workspace rail', page.locator('div.sidebar-material').nth(0)],
      ['asset sidebar', page.locator('div.sidebar-material').nth(1)],
      ['settings navigation', page.getByRole('complementary', { name: 'Settings navigation', exact: true })],
    ];
    await expect(page.locator('div.sidebar-material')).toHaveCount(2);

    const readMaterials = async (entries = materials) => Promise.all(entries.map(async ([name, locator]) => ({ name, ...await locator.evaluate(element => {
      const style = getComputedStyle(element);
      const context = document.createElement('canvas').getContext('2d');
      context.fillStyle = style.backgroundColor;
      context.fillRect(0, 0, 1, 1);
      return { color: style.backgroundColor, alpha: context.getImageData(0, 0, 1, 1).data[3] / 255, blur: style.backdropFilter };
    }) })));
    const assertMaterials = async (expectedAlpha, blurred) => {
      const styles = await readMaterials();
      console.log(`MATERIALS: ${JSON.stringify(styles)}`);
      for (const style of styles) {
        expect(style.alpha, `${style.name} alpha (${style.color})`).toBeCloseTo(expectedAlpha, 2);
        if (blurred) expect(style.blur, `${style.name} blur`).toMatch(/blur\(/);
        else expect(style.blur, `${style.name} blur disabled`).toBe('none');
      }
    };
    const changeOpacity = async value => {
      await opacity.focus();
      await page.keyboard.press(value === 1 ? 'End' : 'Home');
      await expect(opacity).toHaveValue(String(value));
      await page.evaluate(async () => {
        document.activeElement?.blur();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
    };
    const screenshot = async name => {
      await page.evaluate(() => document.activeElement?.blur());
      await page.screenshot({ path: path.join(artifacts, `${name}.png`), animations: 'disabled' });
      // Use the empty settings-navigation area: the native outer backdrop can match its tint.
      const box = await materials[2][1].boundingBox();
      const pixels = await page.screenshot({ clip: { x: box.x + 16, y: box.y + box.height * 0.7, width: box.width - 32, height: Math.min(200, box.height * 0.25) }, animations: 'disabled' });
      console.log(`SCREENSHOT: ${path.join(artifacts, `${name}.png`)}`);
      return pixels.toString('base64');
    };
    const comparePixels = async (opaque, translucent) => page.evaluate(async ([a, b]) => {
      const load = async bytes => {
        const image = new Image();
        image.src = `data:image/png;base64,${bytes}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height).data;
      };
      const [first, second] = await Promise.all([load(a), load(b)]);
      if (first.length !== second.length) throw new Error('Sidebar screenshots changed dimensions');
      let total = 0, changed = 0;
      for (let index = 0; index < first.length; index += 4) {
        const delta = Math.abs(first[index] - second[index]) + Math.abs(first[index + 1] - second[index + 1]) + Math.abs(first[index + 2] - second[index + 2]);
        total += delta;
        if (delta > 3) changed++;
      }
      return { meanRgbDifference: total / (first.length / 4 * 3), changedPixelFraction: changed / (first.length / 4) };
    }, [opaque, translucent]);

    for (const theme of ['dark', 'light']) {
      await main.getByRole('button', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true }).click();
      if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/);
      else await expect(page.locator('html')).not.toHaveClass(/dark/);
      await changeOpacity(1);
      const opaqueStyles = await readMaterials();
      console.log(`OPAQUE MATERIALS (${theme}): ${JSON.stringify(opaqueStyles)}`);
      const opaque = await screenshot(`sidebar-glass-${theme}-100`);
      await changeOpacity(0.25);
      const translucent = await screenshot(`sidebar-glass-${theme}-25`);
      const comparison = await comparePixels(opaque, translucent);
      console.log(`PIXELS (settings navigation, ${theme}): ${JSON.stringify(comparison)}`);
      // Read all three styles before asserting, so the old fixed alpha failure remains reviewable.
      await assertMaterials(0.25, true);
      for (const style of opaqueStyles) expect(style.alpha, `${style.name} 100% opacity`).toBe(1);
      expect(comparison.meanRgbDifference, `${theme} actual settings-navigation pixels change`).toBeGreaterThan(0.5);
      expect(comparison.changedPixelFraction, `${theme} visible changed settings-navigation area`).toBeGreaterThan(0.5);

      await glass.click();
      await expect(glass).toHaveAttribute('aria-checked', 'false');
      await expect(opacity).toHaveCount(0);
      await assertMaterials(1, false);
      await glass.click();
      await expect(glass).toHaveAttribute('aria-checked', 'true');
      await expect(opacity).toHaveValue('0.25');
      await assertMaterials(0.25, true);

      await emulateTransparency('reduce');
      await assertMaterials(1, false);
      await expect(opacity).toHaveValue('0.25');
      await emulateTransparency('no-preference');
      await assertMaterials(0.25, true);
      if (theme === 'dark') {
        await page.locator('button[title="Zen Mode"]').click();
        await expect(page.locator('button[title="Exit Zen Mode"]')).toBeVisible();
        await assertMaterials(0.25, true);
        const canvases = await readMaterials([
          ['center container', page.locator('.center-workbench:has(> .center-side-nav)')],
          ['zoomed pane container', page.locator('.bg-bg:has(> .center-workbench > .center-side-nav)')],
          ['reading canvas', main],
        ]);
        console.log(`ZOOMED CANVASES: ${JSON.stringify(canvases)}`);
        for (const style of canvases) expect(style.alpha, style.name).toBe(style.name === 'reading canvas' ? 1 : 0);
        await page.locator('button[title="Exit Zen Mode"]').click();
        await expect(page.locator('button[title="Zen Mode"]')).toBeVisible();
      }
      console.log(`PASS: ${theme} real range, visible opacity change, glass off/on and reduced transparency.`);
    }
    expect(pageErrors).toEqual([]);
    expect(ipcErrors).toEqual([]);
    console.log('Sidebar glass smoke passed: isolated app, actual keyboard range, all three sidebar materials, dark/light screenshots and settings-navigation pixel differences, opaque off/reduced fallbacks, restored preferences, no renderer or IPC errors.');
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, 'sidebar-glass-failure.png'), animations: 'disabled' }).catch(() => {});
    console.error('Sidebar glass smoke failed:', error);
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
