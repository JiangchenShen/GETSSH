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

  it('rejects overlapping paths between plugin and worker or runtime home', () => {
    const tmp = os.tmpdir();
    const testDir = path.join(tmp, `test-plugin-overlap-${Date.now()}`);
    const pluginDir = path.join(testDir, 'plugin');
    const workerInsidePlugin = path.join(pluginDir, 'worker.js');
    const runtimeHomeDir = path.join(testDir, 'home');
    const userDataDir = path.join(testDir, 'userData');

    fs.mkdirSync(pluginDir, { recursive: true });
    fs.mkdirSync(runtimeHomeDir, { recursive: true });
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(workerInsidePlugin, 'console.log("worker")');

    try {
      expect(() => {
        createPluginSpawnPlan({
          pluginDir,
          workerPath: workerInsidePlugin,
          runtimeHomeDir,
          userDataDir,
          executablePath: process.execPath,
          platform: 'darwin',
          executableExists: () => true
        });
      }).toThrow('Plugin code, trusted worker, runtime, and Electron executable paths must be separate.');
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('generates a valid macOS sandbox spawn plan with strict security restrictions', () => {
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

      // Verify profile denies network and AppleEvents
      const profileIndex = plan.args.indexOf('-p') + 1;
      const profile = plan.args[profileIndex];
      expect(profile).toContain('(deny network*)');
      expect(profile).toContain('(deny appleevent-send)');
      expect(profile).toContain('(deny lsopen)');
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
});
