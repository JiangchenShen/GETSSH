// Plugins' renderer.js in a real Electron window (plugin-renderer-smoke.cjs). This runner bundles
// the code under test from source and starts Electron with HOME and USERPROFILE in a temporary
// directory and a mock Keychain, so nothing touches the real ~/.getssh or Keychain items:
// - the getssh-plugin:// handler and pluginRendererPages, as the main process runs them;
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
  await build({
    cwd: appDir,
    input: path.join(appDir, 'electron/main/services/plugin/pluginPageProtocol.ts'),
    platform: 'node',
    output: { file: path.join(workDir, 'protocol.cjs'), format: 'cjs' },
    logLevel: 'warn',
  });

  const stubs = {
    appStore: "import { create } from 'zustand';\nexport const useAppStore = create(() => ({ appConfig: { theme: 'dark', language: 'zh-CN' } }));",
    workspaceStore: "export const useWorkspaceStore = { getState: () => ({ activeWorkspaceId: 'smoke' }) };",
  };
  const source = file => JSON.stringify(path.join(appDir, file));
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
          return `import { bootSandboxedPlugins, initPluginBridge } from ${source('src/plugins/PluginBridge.ts')};
import { usePluginStore } from ${source('src/store/pluginStore.ts')};
import { useSessionStore } from ${source('src/store/sessionStore.ts')};
window.__smoke = { bootSandboxedPlugins, initPluginBridge, usePluginStore, useSessionStore };`;
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
    timeout: 120_000,
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
