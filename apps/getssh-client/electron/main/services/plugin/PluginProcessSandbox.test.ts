import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { createPluginSpawnPlan, pluginFilesystemBackingPath } from './PluginProcessSandbox';

describe('PluginProcessSandbox', () => {
  it('collapses virtual app.asar paths correctly', () => {
    const asarPath = path.join('/mock', 'app.asar', 'dist', 'worker.js');
    const backing = pluginFilesystemBackingPath(asarPath);
    expect(backing).toContain('app.asar');

    const normalPath = path.join('/mock', 'dist', 'worker.js');
    const normalBacking = pluginFilesystemBackingPath(normalPath);
    expect(normalBacking).toBe(path.resolve('/mock', 'dist'));
  });

  it('rejects nonexistent or overlapping paths in spawn plan', () => {
    expect(() => {
      createPluginSpawnPlan({
        pluginDir: '/nonexistent/plugin/dir',
        workerPath: '/valid/worker.js',
        runtimeHomeDir: '/valid/home',
        userDataDir: '/valid/userData'
      });
    }).toThrow('Plugin directory does not exist');
  });

  it('generates a valid macOS sandbox spawn plan', () => {
    const tmp = os.tmpdir();
    const testDir = path.join(tmp, `test-plugin-sandbox-${Date.now()}`);
    const pluginDir = path.join(testDir, 'plugin');
    const workerPath = path.join(testDir, 'worker.js');
    const runtimeHomeDir = path.join(testDir, 'home');
    const userDataDir = path.join(testDir, 'userData');

    fs.mkdirSync(pluginDir, { recursive: true });
    fs.mkdirSync(runtimeHomeDir, { recursive: true });
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(workerPath, 'console.log("worker")');

    try {
      const plan = createPluginSpawnPlan({
        pluginDir,
        workerPath,
        runtimeHomeDir,
        userDataDir,
        executablePath: process.execPath,
        platform: 'darwin',
        executableExists: () => true
      });

      expect(plan.isolation).toBe('macos-seatbelt');
      expect(plan.command).toBe('/usr/bin/sandbox-exec');
      expect(plan.args).toContain('-p');
      expect(plan.cwd).toBe(fs.realpathSync.native(pluginDir));
      expect(plan.env.HOME).toBe(fs.realpathSync.native(runtimeHomeDir));
      expect(plan.env.ELECTRON_RUN_AS_NODE).toBe('1');
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});
