import fs from 'fs';
import path from 'path';
import { app, ipcMain, Notification, safeStorage } from 'electron';
import AdmZip from 'adm-zip';
import type { PluginManifest, MainContextAPI } from '../../src/types/plugin';

export class PluginManager {
  private pluginsPath: string;
  public installedPlugins: PluginManifest[] = [];

  constructor() {
    this.pluginsPath = path.join(app.getPath('userData'), 'plugins');
    if (!fs.existsSync(this.pluginsPath)) {
      fs.mkdirSync(this.pluginsPath, { recursive: true });
    }
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

  public loadPlugins() {
    const folders = fs.readdirSync(this.pluginsPath);
    for (const folder of folders) {
      const pluginDir = path.join(this.pluginsPath, folder);
      if (fs.statSync(pluginDir).isDirectory()) {
         try {
           const pkgPath = path.join(pluginDir, 'package.json');
           if (!fs.existsSync(pkgPath)) continue;
           
           const manifest: PluginManifest = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
           this.installedPlugins.push(manifest);
           
           const mainEntryPath = path.join(pluginDir, manifest.main);
           if (fs.existsSync(mainEntryPath)) {
             const pluginModule = require(mainEntryPath);
             if (typeof pluginModule.activate === 'function') {
               pluginModule.activate(this.createMainContext());
             }
           }
         } catch (err) {
           console.error(`[Plugin Kernel] Failed to load plugin from ${folder}:`, err);
         }
      }
    }
  }

  public setupIPC() {
    ipcMain.handle('get-plugin-list', () => this.installedPlugins);
    
    ipcMain.handle('uninstall-plugin', async (event, pluginName: string) => {
       try {
          const targetDir = this.getSecurePluginPath(pluginName);
          if (fs.existsSync(targetDir)) {
             fs.rmSync(targetDir, { recursive: true, force: true });
          }
          this.installedPlugins = this.installedPlugins.filter(p => p.name !== pluginName);
          return { success: true };
       } catch (err: any) {
          return { success: false, error: err.message };
       }
    });
    
    ipcMain.handle('install-plugin', async (event, zipPath: string) => {
      try {
        const zip = new AdmZip(zipPath);
        const tempDir = path.join(app.getPath('temp'), `plugin_${Date.now()}`);
        zip.extractAllTo(tempDir, true);

        let pkgPath = path.join(tempDir, 'package.json');
        let sourceDir = tempDir;

        if (!fs.existsSync(pkgPath)) {
          // Check if it's wrapped in a single root folder
          const subDirs = fs.readdirSync(tempDir);
          if (subDirs.length === 1) {
            const nestedDir = path.join(tempDir, subDirs[0]);
            if (fs.statSync(nestedDir).isDirectory()) {
              pkgPath = path.join(nestedDir, 'package.json');
              sourceDir = nestedDir;
            }
          }
        }

        if (!fs.existsSync(pkgPath)) throw new Error('Invalid Architecture: Missing package.json manifest.');
        
        const manifest = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const targetDir = this.getSecurePluginPath(manifest.name);
        
        if (fs.existsSync(targetDir)) {
          fs.rmSync(targetDir, { recursive: true, force: true });
        }
        
        fs.renameSync(sourceDir, targetDir);
        
        if (!this.installedPlugins.find(p => p.name === manifest.name)) {
          this.installedPlugins.push(manifest);
        }
        
        return { success: true, manifest };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    // Provide file paths so preload can inject renderer scripts
    ipcMain.handle('get-plugin-renderers', async () => {
      return Promise.all(
        this.installedPlugins
          .filter((p) => !!p.renderer)
          .map(async (p) => {
            try {
              const pluginPath = this.getSecurePluginPath(p.name);
              const rendererPath = path.resolve(pluginPath, p.renderer!);
              if (!rendererPath.startsWith(pluginPath + path.sep)) {
                throw new Error('Invalid renderer path');
              }
              return await fs.promises.readFile(rendererPath, 'utf8');
            } catch {
              return '';
            }
          })
      );
    });
  }
}
