import fs from 'fs';
import path from 'path';

const mockAppPath = path.join(__dirname, 'mock_userData');

import { mock } from 'bun:test';

mock.module('electron', () => {
  return {
    app: {
      getPath: (name: string) => mockAppPath
    },
    ipcMain: {
      handle: () => {}
    },
    Notification: class { show() {} },
    safeStorage: {
      isEncryptionAvailable: () => false
    }
  };
});

import { PluginManager } from './electron/main/PluginManager.ts';

async function measure() {
  const pluginsPath = path.join(mockAppPath, 'plugins');
  if (fs.existsSync(pluginsPath)) {
    fs.rmSync(pluginsPath, { recursive: true, force: true });
  }
  fs.mkdirSync(pluginsPath, { recursive: true });

  for (let i = 0; i < 1000; i++) {
    const pluginDir = path.join(pluginsPath, `plugin_${i}`);
    fs.mkdirSync(pluginDir);
    fs.writeFileSync(path.join(pluginDir, 'package.json'), JSON.stringify({ name: `plugin_${i}`, main: 'index.js' }));
    fs.writeFileSync(path.join(pluginDir, 'index.js'), 'module.exports = { activate: () => {} };');
  }

  const start = performance.now();
  const manager = new PluginManager();
  await manager.loadPlugins();
  const end = performance.now();

  console.log(`Loaded ${manager.installedPlugins.length} plugins in ${end - start}ms`);
}

measure();
