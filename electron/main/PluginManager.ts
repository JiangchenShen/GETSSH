import fs from 'fs';
import path from 'path';
import { app, ipcMain, Notification, safeStorage } from 'electron';
import AdmZip from 'adm-zip';
import pLimit from 'p-limit';
import type { PluginManifest, MainContextAPI } from '../../src/types/plugin';

export class PluginManager {
  private pluginsPath: string;
  public installedPlugins: PluginManifest[] = [];

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
    return {
      showNotification: (title, body) => new Notification({ title, body }).show(),
      safeStorageEncrypt: (text) => safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text).toString('base64') : text,
      safeStorageDecrypt: (hash) => {
        try {
          return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(hash, 'base64')) : hash;
        } catch {
          return hash;
        }
      }
    };
  }

  public async loadPlugins() {
    try {
      await fs.promises.mkdir(this.pluginsPath, { recursive: true });
      const dirents = await fs.promises.readdir(this.pluginsPath, { withFileTypes: true });
      await Promise.all(
        dirents.map(async (dirent) => {
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
              const pluginModule = require(mainEntryPath);
              if (typeof pluginModule.activate === 'function') {
                pluginModule.activate(this.createMainContext());
              }
            } catch (requireErr: unknown) {
              // Only ignore MODULE_NOT_FOUND if it's the main entry point missing,
              // not a missing dependency within the plugin itself.
              const isModuleNotFound = requireErr && typeof requireErr === 'object' && (requireErr as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND';
              const isSyntaxError = requireErr instanceof SyntaxError && requireErr.message.includes('Unexpected token');
              const isEntryPoint = requireErr && typeof requireErr === 'object' && (requireErr as any).message?.includes(manifest.main);
              
              if ((isModuleNotFound || isSyntaxError) && (isEntryPoint || isSyntaxError)) {
                console.warn(`[Plugin Kernel] Main entry point '${manifest.main}' not found or is a UI file (SyntaxError). Attempting to run headless/renderer-only.`);
              } else {
                throw requireErr;
              }
            }
          } catch (err: unknown) {
            console.error(`[Plugin Kernel] Failed to load plugin from ${dirent.name}:`, err instanceof Error ? err.message : String(err));
          }
        })
      );
    } catch (err: unknown) {
      console.error('[Plugin Kernel] Failed to read plugins directory:', err instanceof Error ? err.message : String(err));
    }
  }

  public setupIPC() {
    ipcMain.handle('get-plugin-list', () => this.installedPlugins);
    
    ipcMain.handle('uninstall-plugin', async (event, pluginName: string) => {
       try {
          // Security: validate path boundary before deletion to prevent path traversal
          const targetDir = this.getSecurePluginPath(pluginName);
          // Async: use fs.promises.access to check existence before removal
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

        // Securely extract zip entries to prevent Zip Slip vulnerability
        const resolvedTempDir = path.resolve(tempDir);
        const entries = zip.getEntries();
        const validFileEntries = [];
        const directoriesToCreate = new Set<string>();

        for (const entry of entries) {
          const targetPath = path.resolve(resolvedTempDir, entry.entryName);
          // Ensure target path is strictly within the intended temporary directory
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

        // Concurrent directory creation
        await Promise.all(
          Array.from(directoriesToCreate).map(dir => fs.promises.mkdir(dir, { recursive: true }))
        );

        // Concurrent file writing with concurrency limit
        // Using p-limit to prevent EMFILE, memory exhaustion from `getData()` and unresponsiveness.
        const limit = pLimit(10);
        await Promise.all(
          validFileEntries.map(({ entry, targetPath }) =>
            limit(async () => {
              // Decompress and write inside the limited callback to avoid memory spike and UI freezing.
              await fs.promises.writeFile(targetPath, entry.getData());
            })
          )
        );

        let pkgPath = path.join(tempDir, 'package.json');
        let sourceDir = tempDir;

        const pkgExists = await fs.promises.access(pkgPath).then(() => true).catch(() => false);
        if (!pkgExists) {
          // Check if it's wrapped in a single root folder
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
        
        // Performance: async file read instead of blocking readFileSync
        const manifest = JSON.parse(await fs.promises.readFile(pkgPath, 'utf8'));
        // Security: validate the plugin name from manifest against path traversal
        const targetDir = this.getSecurePluginPath(manifest.name);
        
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

    // Provide file paths so preload can inject renderer scripts
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
