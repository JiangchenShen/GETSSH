import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { app, ipcMain, Notification, safeStorage } from 'electron';
import { getBackendConfig } from './handlers/systemHandler';
import AdmZip from 'adm-zip';
import pLimit from 'p-limit';
import type { PluginManifest, MainContextAPI } from '../../src/types/plugin';

export class PluginManager {
  private pluginsPath: string;
  public installedPlugins: PluginManifest[] = [];
  private runningPlugins: Map<string, { deactivate: () => void }> = new Map();

  constructor() {
    this.pluginsPath = path.join(app.getPath('userData'), 'plugins');
  }

  private getSecurePluginPath(pluginName: string): string {
    const targetPath = path.resolve(this.pluginsPath, pluginName);
    const basePath = path.resolve(this.pluginsPath) + path.sep;
    if (!targetPath.startsWith(basePath)) {
      throw new Error('Invalid plugin path: Path traversal detected.');
    }
    return targetPath;
  }

  private createMainContext(): MainContextAPI {
    const context = Object.create(null);
    context.showNotification = (title: string, body: string) => new Notification({ title, body }).show();
    context.safeStorageEncrypt = (text: string) => safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text).toString('base64') : text;
    return Object.freeze(context) as MainContextAPI;
  }

  public async loadPlugins() {
    try {
      await fs.promises.mkdir(this.pluginsPath, { recursive: true });
      const dirents = await fs.promises.readdir(this.pluginsPath, { withFileTypes: true });
      const limit = pLimit(50);
      await Promise.all(
        dirents.map((dirent) => limit(async () => {
          if (!dirent.isDirectory()) return;
          const pluginDir = path.join(this.pluginsPath, dirent.name);
          try {
            const pkgPath = path.join(pluginDir, 'package.json');
            let manifestRaw: string;
            try {
              manifestRaw = await fs.promises.readFile(pkgPath, 'utf8');
            } catch (err: unknown) {
              if ((err as NodeJS.ErrnoException).code === 'ENOENT') return; // Package.json does not exist
              throw err;
            }

            const manifest: PluginManifest = JSON.parse(manifestRaw);
            manifest.localPath = pluginDir;

            this.installedPlugins.push(manifest);

            const mainEntryPath = path.join(pluginDir, manifest.main);
            try {
              const securityMode = getBackendConfig().pluginSecurityMode || 'normal';

              // SAFE MODE: Return early, load nothing.
              if (securityMode === 'safe') {
                return;
              }

              // DEVELOPER MODE: Full native require, no sandbox
              if (securityMode === 'developer') {
                const pluginModule = require(mainEntryPath);
                
                const activateFn = typeof pluginModule.activate === 'function' ? pluginModule.activate : undefined;
                const deactivateFn = typeof pluginModule.deactivate === 'function' ? pluginModule.deactivate : undefined;
                
                if (typeof deactivateFn !== 'function') {
                   throw new Error(`Plugin '${manifest.name}' rejected: Missing required lifecycle hook 'deactivate'`);
                }
                
                if (activateFn) {
                  activateFn(this.createMainContext());
                }
                
                this.runningPlugins.set(manifest.name, { deactivate: deactivateFn });
                return;
              }

              // STRICT AND NORMAL MODES: VM Sandboxing
              const pluginCode = await fs.promises.readFile(mainEntryPath, 'utf8');

              const safeRequire = (moduleName: string) => {
                if (securityMode === 'strict') {
                  // STRICT: Only path and os
                  const whitelist = ['path', 'os'];
                  if (whitelist.includes(moduleName)) return require(moduleName);
                  throw new Error(`Sandbox violation: Cannot require module '${moduleName}' in Strict Mode`);
                } else {
                  // NORMAL: Relaxed but block extremely dangerous ones
                  const blacklist = ['fs', 'fs/promises', 'child_process', 'net'];
                  if (blacklist.includes(moduleName)) {
                    throw new Error(`Sandbox violation: Cannot require dangerous module '${moduleName}' in Normal Mode`);
                  }
                  return require(moduleName);
                }
              };

              const sandboxExports = securityMode === 'strict' ? Object.create(null) : {};
              const sandboxModule = securityMode === 'strict' ? Object.create(null) : {};
              sandboxModule.exports = sandboxExports;

              const sandboxGlobals = securityMode === 'strict' ? Object.create(null) : {};
              Object.assign(sandboxGlobals, {
                module: sandboxModule,
                exports: sandboxExports,
                console: console,
                require: safeRequire,
                __dirname: pluginDir,
                __filename: mainEntryPath,
                Buffer: Buffer,
                setTimeout,
                clearTimeout,
                setInterval,
                clearInterval
              });

              const sandboxContext = vm.createContext(sandboxGlobals);

              vm.runInContext(pluginCode, sandboxContext, {
                filename: mainEntryPath,
                timeout: 5000
              });

              const exportsObj = sandboxContext.module.exports as any;
              const activateFn = exportsObj.activate;
              const deactivateFn = exportsObj.deactivate;

              if (typeof deactivateFn !== 'function') {
                 throw new Error(`Plugin '${manifest.name}' rejected: Missing required lifecycle hook 'deactivate'`);
              }

              if (typeof activateFn === 'function') {
                activateFn(this.createMainContext());
              }
              
              this.runningPlugins.set(manifest.name, { deactivate: deactivateFn });
            } catch (loadErr: unknown) {
              const isModuleNotFound = loadErr && typeof loadErr === 'object' && (loadErr as NodeJS.ErrnoException).code === 'ENOENT';
              const isSyntaxError = loadErr instanceof SyntaxError;
              
              if (isModuleNotFound || isSyntaxError) {
                console.warn(`[Plugin Kernel] Main entry point '${manifest.main}' not found or is a UI file (SyntaxError). Attempting to run headless/renderer-only.`);
              } else {
                throw loadErr;
              }
            }
          } catch (err: unknown) {
            console.error(`[Plugin Kernel] Failed to load plugin from ${dirent.name}:`, err instanceof Error ? err.message : String(err));
          }
        }))
      );
    } catch (err: unknown) {
      console.error('[Plugin Kernel] Failed to read plugins directory:', err instanceof Error ? err.message : String(err));
    }
  }

  public setupIPC() {
    ipcMain.handle('get-plugin-list', () => this.installedPlugins);
    
    ipcMain.handle('reload-plugins', async () => {
      for (const [name, plugin] of this.runningPlugins.entries()) {
         try {
            plugin.deactivate();
         } catch (e) {
            console.error(`[Plugin Kernel] Error deactivating plugin ${name}:`, e);
         }
      }
      this.runningPlugins.clear();
      this.installedPlugins = [];
      await this.loadPlugins();
      return { success: true };
    });
    
    ipcMain.handle('uninstall-plugin', async (event, pluginName: string) => {
       try {
          if (this.runningPlugins.has(pluginName)) {
             try {
                this.runningPlugins.get(pluginName)!.deactivate();
             } catch (e) {
                console.error(`[Plugin Kernel] Error deactivating plugin ${pluginName}:`, e);
             }
             this.runningPlugins.delete(pluginName);
          }
          const targetDir = this.getSecurePluginPath(pluginName);
          const dirExists = await fs.promises.access(targetDir).then(() => true).catch(() => false);
          if (dirExists) {
             await fs.promises.rm(targetDir, { recursive: true, force: true });
          }
          this.installedPlugins = this.installedPlugins.filter(p => p.name !== pluginName);
          return { success: true };
       } catch (err: unknown) {
          return { success: false, error: err instanceof Error ? err.message : String(err) };
       }
    });
    
    ipcMain.handle('install-plugin', async (event, zipPath: string) => {
      try {
        const zip = new AdmZip(zipPath);
        const tempDir = await fs.promises.mkdtemp(path.join(app.getPath('temp'), 'plugin_'));

        const resolvedTempDir = path.resolve(tempDir);
        const entries = zip.getEntries();
        const validFileEntries = [];
        const directoriesToCreate = new Set<string>();

        for (const entry of entries) {
          const targetPath = path.resolve(resolvedTempDir, entry.entryName);
          if (!targetPath.startsWith(resolvedTempDir + path.sep) && targetPath !== resolvedTempDir) {
            console.warn(`[Plugin Kernel] Skipped malicious or invalid zip entry: ${entry.entryName}`);
            continue;
          }

          if (entry.isDirectory) {
            directoriesToCreate.add(targetPath);
          } else {
            directoriesToCreate.add(path.dirname(targetPath));
            validFileEntries.push({ entry, targetPath });
          }
        }

        const limit = pLimit(10);

        await Promise.all(
          Array.from(directoriesToCreate).map(dir => limit(() => fs.promises.mkdir(dir, { recursive: true })))
        );

        await Promise.all(
          validFileEntries.map(({ entry, targetPath }) =>
            limit(async () => {
              await fs.promises.writeFile(targetPath, entry.getData());
            })
          )
        );

        let pkgPath = path.join(tempDir, 'package.json');
        let sourceDir = tempDir;

        const pkgExists = await fs.promises.access(pkgPath).then(() => true).catch(() => false);
        if (!pkgExists) {
          const subDirs = await fs.promises.readdir(tempDir);
          if (subDirs.length === 1) {
            const nestedDir = path.join(tempDir, subDirs[0]);
            if ((await fs.promises.stat(nestedDir)).isDirectory()) {
              pkgPath = path.join(nestedDir, 'package.json');
              sourceDir = nestedDir;
            }
          }
        }

        const finalPkgExists = await fs.promises.access(pkgPath).then(() => true).catch(() => false);
        if (!finalPkgExists) throw new Error('Invalid Architecture: Missing package.json manifest.');
        
        const manifest = JSON.parse(await fs.promises.readFile(pkgPath, 'utf8'));
        const targetDir = this.getSecurePluginPath(manifest.name);
        
        if (this.runningPlugins.has(manifest.name)) {
           try {
              this.runningPlugins.get(manifest.name)!.deactivate();
           } catch (e) {
              console.error(`[Plugin Kernel] Error deactivating plugin ${manifest.name}:`, e);
           }
           this.runningPlugins.delete(manifest.name);
        }
        
        await fs.promises.rm(targetDir, { recursive: true, force: true });
        
        await fs.promises.rename(sourceDir, targetDir);
        
        manifest.localPath = targetDir;
        if (!this.installedPlugins.find(p => p.name === manifest.name)) {
          this.installedPlugins.push(manifest);
        }
        
        return { success: true, manifest };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    });

    ipcMain.handle('get-plugin-renderers', async () => {
      return Promise.all(
        this.installedPlugins
          .filter((p) => !!p.renderer)
          .map(async (p) => {
            if (p._rendererContentCache !== undefined) {
              return p._rendererContentCache;
            }
            try {
              const pluginPath = this.getSecurePluginPath(p.name);
              const rendererPath = path.resolve(pluginPath, p.renderer!);
              if (!rendererPath.startsWith(pluginPath + path.sep)) {
                throw new Error('Invalid renderer path');
              }
              p._rendererContentCache = await fs.promises.readFile(rendererPath, 'utf8');
              return p._rendererContentCache;
            } catch {
              p._rendererContentCache = '';
              return p._rendererContentCache;
            }
          })
      );
    });
  }
}
