// Plugins' renderer.js in a real Electron (plugin-renderer-smoke.cjs). This runner bundles the code
// under test from source and starts Electron with HOME and USERPROFILE in a temporary directory
// and a mock Keychain, so nothing touches the real ~/.getssh or Keychain items:
// - the main process side: pluginRendererHost (each plugin's WebContents and session), the
//   getssh-plugin:// handler, pluginRendererPages and the window registry;
// - the preloads: the one of renderer.js pages, and the main window's;
// - the window side: the real PluginBridge, plugin store and session store. Only the app store
//   (theme and language) and the workspace store (the active workspace) are stand-ins.
//
//   npm run test:plugin-renderer
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '../..');
const require = createRequire(import.meta.url);
const { build } = await import(pathToFileURL(require.resolve('rolldown', { paths: [require.resolve('vite')] })).href);

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-plugin-renderer-'));
const home = path.join(workDir, 'home');
fs.mkdirSync(home);

let status = 1;
try {
  const source = file => JSON.stringify(path.join(appDir, file));
  await build({
    cwd: appDir,
    input: '\0renderer-smoke-main',
    platform: 'node',
    external: ['electron'],
    plugins: [{
      name: 'renderer-smoke-main',
      resolveId: id => (id === '\0renderer-smoke-main' ? id : null),
      load: id => (id === '\0renderer-smoke-main' ? `export * from ${source('electron/main/services/plugin/pluginRendererHost.ts')};
export * from ${source('electron/main/services/plugin/pluginPageProtocol.ts')};
export { setMainWindow } from ${source('electron/main/windowRegistry.ts')};` : null),
    }],
    output: { file: path.join(workDir, 'main.cjs'), format: 'cjs' },
    logLevel: 'warn',
  });
  // Sandboxed preloads: one file each, needing nothing but electron.
  for (const [input, file] of [['electron/preload/pluginRenderer.ts', 'plugin-preload.js'], ['electron/preload/index.ts', 'window-preload.js']]) {
    await build({
      cwd: appDir,
      input: path.join(appDir, input),
      platform: 'node',
      external: ['electron'],
      output: { file: path.join(workDir, file), format: 'cjs' },
      logLevel: 'warn',
    });
  }

  const stubs = {
    appStore: "import { create } from 'zustand';\nexport const useAppStore = create(() => ({ appConfig: { theme: 'dark', language: 'zh-CN' } }));",
    workspaceStore: "export const useWorkspaceStore = { getState: () => ({ activeWorkspaceId: 'smoke' }) };",
  };
  await build({
    cwd: appDir,
    input: '\0renderer-smoke-entry',
    platform: 'browser',
    plugins: [{
      name: 'renderer-smoke',
      resolveId(id) {
        if (id === '\0renderer-smoke-entry') return id;
        const stub = /(?:^|\/)(appStore|workspaceStore)$/.exec(id)?.[1];
        return stub ? `\0renderer-smoke-${stub}` : null;
      },
      load(id) {
        if (id === '\0renderer-smoke-entry') {
          return `import { initPluginBridge } from ${source('src/plugins/PluginBridge.ts')};
import { usePluginStore } from ${source('src/store/pluginStore.ts')};
import { useSessionStore } from ${source('src/store/sessionStore.ts')};
window.__smoke = { initPluginBridge, usePluginStore, useSessionStore };`;
        }
        const stub = /^\0renderer-smoke-(appStore|workspaceStore)$/.exec(id)?.[1];
        return stub ? stubs[stub] : null;
      },
    }],
    transform: { define: { 'process.env.NODE_ENV': '"production"' } },
    output: { file: path.join(workDir, 'bridge.js'), format: 'iife' },
    logLevel: 'warn',
  });

  const env = { ...process.env, HOME: home, USERPROFILE: home, GETSSH_RENDERER_SMOKE_DIR: workDir };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), ['--use-mock-keychain', path.join(here, 'plugin-renderer-smoke.cjs')], {
    cwd: appDir,
    env,
    stdio: 'inherit',
    timeout: 240_000,
  });
  if (result.error) console.error(`plugin renderer smoke failed: ${result.error.message}`);
  else status = result.status ?? 1;
} catch (error) {
  console.error(`plugin renderer smoke failed: ${error?.stack || error}`);
} finally {
  // Windows can keep a file of the exited Electron open for a moment; a leftover temp dir is no failure.
  try { fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
}
process.exit(status);
