import fs from 'fs';
import path from 'path';
import vm from 'vm';
import dns from 'dns/promises';
import { app, ipcMain, Notification, safeStorage, BrowserWindow, dialog, net, clipboard } from 'electron';
import { getBackendConfig } from './handlers/systemHandler';
import pLimit from 'p-limit';
import type { PluginManifest, PluginSettingsSchema, MainContextAPI } from '../../src/types/plugin';
import { sshBridge } from './services/SSHBridge';
import { pluginStorageManager } from './services/PluginStorageManager';
import { SecureCenter } from './security/SecureCenter';

export function isPrivateIP(ip: string): boolean {
  // Check against common private/loopback IP ranges
  if (ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0' || ip === '::') return true;
  
  // Parse IPv4 segments
  const parts = ip.split('.');
  if (parts.length === 4) {
    const p1 = parseInt(parts[0], 10);
    const p2 = parseInt(parts[1], 10);
    
    // 10.0.0.0/8
    if (p1 === 10) return true;
    // 172.16.0.0/12 (172.16.x.x - 172.31.x.x)
    if (p1 === 172 && p2 >= 16 && p2 <= 31) return true;
    // 192.168.0.0/16
    if (p1 === 192 && p2 === 168) return true;
    // 169.254.0.0/16 (Link-local)
    if (p1 === 169 && p2 === 254) return true;
    // 127.0.0.0/8
    if (p1 === 127) return true;
  }
  return false;
}

export class PluginManager {
  private pluginsPath: string;
  public installedPlugins: PluginManifest[] = [];
  private runningPlugins: Map<string, { deactivate: () => void, listeners?: Array<{event: string, callback: any}>, rpcHandlers?: Map<string, (payload: any) => Promise<any>> }> = new Map();
  
  private uiExtensions: {
    terminal: Array<{ pluginId: string, actionId: string, label: string, handler: Function }>,
    sftp: Array<{ pluginId: string, actionId: string, label: string, handler: Function }>
  } = { terminal: [], sftp: [] };
  
  private settingsSchemas: Map<string, PluginSettingsSchema[]> = new Map();

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

  private syncUIExtensions() {
    const allWindows = BrowserWindow.getAllWindows();
    if (allWindows.length > 0) {
      allWindows[0].webContents.send('sync-plugin-ui-extensions', {
        terminal: this.uiExtensions.terminal.map(ext => ({ pluginId: ext.pluginId, actionId: ext.actionId, label: ext.label, target: 'terminal' })),
        sftp: this.uiExtensions.sftp.map(ext => ({ pluginId: ext.pluginId, actionId: ext.actionId, label: ext.label, target: 'sftp' }))
      });
      
      const schemasObj: Record<string, PluginSettingsSchema[]> = {};
      this.settingsSchemas.forEach((schema, id) => { schemasObj[id] = schema; });
      allWindows[0].webContents.send('sync-plugin-settings-schemas', schemasObj);
    }
  }

  private createMainContext(manifest: PluginManifest): MainContextAPI {
    const context = Object.create(null) as MainContextAPI;
    context.showNotification = (title: string, body: string) => new Notification({ title, body }).show();
    context.safeStorageEncrypt = (text: string) => safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text).toString('base64') : text;
    
    // Inject SSH namespace if capabilities are requested
    const caps = manifest.getssh?.capabilities || [];
    if (caps.includes('ssh:read') || caps.includes('ssh:write')) {
      const sshContext = Object.create(null);
      
      if (caps.includes('ssh:read')) {
        sshContext.onData = (sessionId: string, callback: (chunk: string) => void) => {
          sshBridge.on(`data:${sessionId}`, callback);
          // Register cleanup hook
          if (!this.runningPlugins.has(manifest.name)) {
            // Might be called before runningPlugins is set, so we defer
            setTimeout(() => {
              const p = this.runningPlugins.get(manifest.name);
              if (p) p.listeners = p.listeners || [];
              this.runningPlugins.get(manifest.name)?.listeners?.push({ event: `data:${sessionId}`, callback });
            }, 0);
          } else {
            const p = this.runningPlugins.get(manifest.name);
            if (p) {
              p.listeners = p.listeners || [];
              p.listeners.push({ event: `data:${sessionId}`, callback });
            }
          }
        };
      } else {
        sshContext.onData = () => { throw new Error(`[Security] Plugin '${manifest.name}' missing 'ssh:read' capability`); };
      }
      
      if (caps.includes('ssh:write')) {
        sshContext.write = (sessionId: string, command: string) => {
          sshBridge.writeCommand(sessionId, command);
        };
      } else {
        sshContext.write = () => { throw new Error(`[Security] Plugin '${manifest.name}' missing 'ssh:write' capability`); };
      }
      
      context.ssh = Object.freeze(sshContext);
    }
    
    // Inject Storage API hardbound to this plugin's ID
    context.storage = Object.freeze({
      get: (key: string) => pluginStorageManager.get(manifest.name, key),
      set: (key: string, value: any) => pluginStorageManager.set(manifest.name, key, value),
      delete: (key: string) => pluginStorageManager.delete(manifest.name, key),
      clear: () => pluginStorageManager.clear(manifest.name)
    });
    
    // Inject RPC context (using a closure-captured temp map to avoid activation-time race)
    const pendingRpcHandlers = new Map<string, (payload: any) => Promise<any>>();
    context.rpc = Object.freeze({
      registerMethod: (method: string, handler: (payload: any) => Promise<any>) => {
        // Always write to pendingRpcHandlers; loadPlugins merges this into runningPlugins after activate()
        pendingRpcHandlers.set(method, handler);
        // Also try to write into the live map if the plugin is already registered (e.g. hot-reload)
        const p = this.runningPlugins.get(manifest.name);
        if (p) {
          p.rpcHandlers = p.rpcHandlers || new Map();
          p.rpcHandlers.set(method, handler);
        }
      },
      sendToFrontend: (payload: any) => {
        const allWindows = BrowserWindow.getAllWindows();
        if (allWindows.length > 0) {
          allWindows[0].webContents.send('plugin-rpc-message', manifest.name, payload);
        }
      }
    });
    
    // Expose the pendingRpcHandlers so loadPlugins can merge after activate()
    (context as any).__pendingRpcHandlers = pendingRpcHandlers;
    
    // Inject UI Extensions context
    context.ui = Object.freeze({
      registerTerminalContextMenu: (actionId: string, label: string, handler: Function) => {
        this.uiExtensions.terminal.push({ pluginId: manifest.name, actionId, label, handler });
        this.syncUIExtensions();
      },
      registerSFTPContextMenu: (actionId: string, label: string, handler: Function) => {
        this.uiExtensions.sftp.push({ pluginId: manifest.name, actionId, label, handler });
        this.syncUIExtensions();
      },
      registerSettings: (schema: PluginSettingsSchema[]) => {
        if (!schema || schema.length === 0) {
          throw new Error(`[Security] Plugins must register at least one valid parameter. Empty schemas are not allowed. Plugin: ${manifest.name}`);
        }
        (context as any).__settingsRegistered = true;
        this.settingsSchemas.set(manifest.name, schema);
        this.syncUIExtensions();
      }
    });

    // Inject Native OS Host context
    const clipboardApi = {
      writeText: async (text: string) => {
        if (!caps.includes('host:clipboard')) {
          throw new Error(`[SecurityError] Plugin '${manifest.name}' missing 'host:clipboard' capability`);
        }
        console.log(`[Plugin Clipboard API] [${manifest.name}] copied text to clipboard.`);
        clipboard.writeText(text);
      },
      readText: async () => {
        if (!caps.includes('host:clipboard')) {
          throw new Error(`[SecurityError] Plugin '${manifest.name}' missing 'host:clipboard' capability`);
        }
        const text = clipboard.readText();
        console.log(`[Plugin Clipboard API] [${manifest.name}] read text from clipboard.`);
        new Notification({
          title: '⚠️ 剪贴板安全提醒',
          body: `插件 [${manifest.name}] 刚刚读取了您的系统剪贴板`
        }).show();
        return text;
      }
    };

    context.host = Object.freeze({
      notify: (title: string, body: string, type: 'info' | 'warning' | 'error' = 'info') => {
        new Notification({ title, body }).show();
        console.log(`[Plugin Host API] [${manifest.name}] host.notify() called - type: ${type}`);
      },
      clipboard: Object.freeze(clipboardApi),

      showMessageBox: async (options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> => {
        console.log(`[Plugin Host API] [${manifest.name}] host.showMessageBox() called - type: ${options.type || 'info'}, message: "${options.message}"`);
        const allWindows = BrowserWindow.getAllWindows();
        const focusedWindow = allWindows.find(w => w.isFocused()) ?? allWindows[0];
        if (focusedWindow) {
          return dialog.showMessageBox(focusedWindow, options);
        }
        return dialog.showMessageBox(options);
      },

      showOpenDialog: async (options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> => {
        console.log(`[Plugin Host API] [${manifest.name}] host.showOpenDialog() called - title: "${options.title || '(no title)'}"`);
        const allWindows = BrowserWindow.getAllWindows();
        const focusedWindow = allWindows.find(w => w.isFocused()) ?? allWindows[0];
        if (focusedWindow) {
          return dialog.showOpenDialog(focusedWindow, options);
        }
        return dialog.showOpenDialog(options);
      },

      showSaveDialog: async (options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> => {
        console.log(`[Plugin Host API] [${manifest.name}] host.showSaveDialog() called - title: "${options.title || '(no title)'}"`);
        const allWindows = BrowserWindow.getAllWindows();
        const focusedWindow = allWindows.find(w => w.isFocused()) ?? allWindows[0];
        if (focusedWindow) {
          return dialog.showSaveDialog(focusedWindow, options);
        }
        return dialog.showSaveDialog(options);
      }
    });

    // Inject Network context
    context.net = Object.freeze({
      fetch: async (url: string, options?: RequestInit) => {
        if (!manifest.getssh?.capabilities?.includes('net:fetch')) {
          throw new Error('SecurityError: Plugin missing "net:fetch" capability');
        }

        let parsedUrl: URL;
        try {
          parsedUrl = new URL(url);
        } catch (e) {
          throw new Error(`SecurityError: Invalid URL "${url}"`);
        }

        const hostname = parsedUrl.hostname;

        // Block obvious loopbacks immediately
        if (hostname === 'localhost' || hostname === '0.0.0.0' || hostname === '127.0.0.1') {
          SecureCenter.getInstance().triggerLockdown(`SSRF Attack Detected: Blocked request to local hostname ${hostname} by plugin ${manifest.name}`, 'red');
          this.runningPlugins.get(manifest.name)?.deactivate();
          this.runningPlugins.delete(manifest.name);
          throw new Error('SecurityError: SSRF attack blocked. Plugin terminated.');
        }

        // DNS Lookup to prevent DNS rebinding or custom domains pointing to local IPs
        try {
          const lookupResult = await dns.lookup(hostname);
          if (isPrivateIP(lookupResult.address)) {
            SecureCenter.getInstance().triggerLockdown(`SSRF Attack Detected: Blocked request to private IP ${lookupResult.address} (resolved from ${hostname}) by plugin ${manifest.name}`, 'red');
            this.runningPlugins.get(manifest.name)?.deactivate();
            this.runningPlugins.delete(manifest.name);
            throw new Error('SecurityError: SSRF attack blocked. Plugin terminated.');
          }
        } catch (e: any) {
          if (e.message.includes('SecurityError')) throw e;
          throw new Error(`NetworkError: Failed to resolve hostname ${hostname}`);
        }

        console.log(`[Plugin Net API] [${manifest.name}] Fetching: ${url}`);
        return net.fetch(url, options);
      }
    });

    return Object.freeze(context) as MainContextAPI;
  }

  public async reloadPlugin(pluginId: string) {
    const running = this.runningPlugins.get(pluginId);
    if (running) {
      try {
        running.deactivate();
      } catch (err) {
        console.error(`[PluginManager] Error deactivating plugin ${pluginId}:`, err);
      }
      this.runningPlugins.delete(pluginId);
    }
    
    // Clear previously registered UI hooks and schemas for this plugin to prevent duplication
    this.uiExtensions.terminal = this.uiExtensions.terminal.filter(ext => ext.pluginId !== pluginId);
    this.uiExtensions.sftp = this.uiExtensions.sftp.filter(ext => ext.pluginId !== pluginId);
    this.settingsSchemas.delete(pluginId);
    this.syncUIExtensions();

    const pluginDir = path.join(this.pluginsPath, pluginId);
    try {
      const pkgPath = path.join(pluginDir, 'package.json');
      const manifestRaw = await fs.promises.readFile(pkgPath, 'utf8');
      const manifest: PluginManifest = JSON.parse(manifestRaw);
      
      const isDevMode = getBackendConfig()?.pluginSecurityMode === 'developer';
      if (!isDevMode && manifest.getssh?.type !== 'sandbox' && (!manifest.getssh?.capabilities || !manifest.getssh.capabilities.includes('lifecycle'))) {
         console.warn(`[PluginManager] Plugin ${manifest.name} blocked from reload: Missing lifecycle capabilities.`);
         return;
      }
      
      if (manifest.getssh?.type !== 'sandbox') {
        const mainPath = path.join(pluginDir, manifest.main);
        const code = await fs.promises.readFile(mainPath, 'utf8');
        const context = this.createMainContext(manifest);
        const sandbox: any = {
          console,
          setTimeout,
          clearTimeout,
          setInterval,
          clearInterval,
          Promise,
          Buffer
        };

        const securityMode = getBackendConfig()?.pluginSecurityMode || 'normal';
        if (securityMode === 'strict') {
          sandbox.require = (moduleName: string) => {
            if (['path', 'os'].includes(moduleName)) return require(moduleName);
            throw new Error(`[Security] Module '${moduleName}' is blocked in Strict Mode`);
          };
        } else if (securityMode === 'normal') {
          sandbox.require = (moduleName: string) => {
            if (['fs', 'child_process', 'net', 'http', 'https', 'cluster'].includes(moduleName)) {
              throw new Error(`[Security] Dangerous module '${moduleName}' is blocked in Normal Mode`);
            }
            return require(moduleName);
          };
        } else if (securityMode === 'developer') {
          sandbox.require = require;
        }

        const script = new vm.Script(
          `(function(exports, require, module, __filename, __dirname) { 
            ${code}
            return { activate, deactivate }; 
          })`
        );
        const resultFn = script.runInNewContext(sandbox);
        
        const mod = { exports: {} };
        const result = resultFn(mod.exports, sandbox.require, mod, mainPath, pluginDir);
        const activateFn = result.activate || (mod.exports as any).activate;
        const deactivateFn = result.deactivate || (mod.exports as any).deactivate;
        
        if (typeof activateFn === 'function') {
          // Find pending handlers captured during context creation
          let tempRpcHandlers: Map<string, (payload: any) => Promise<any>> | undefined;
          context.rpc.registerMethod = (method: string, handler: any) => {
             tempRpcHandlers = tempRpcHandlers || new Map();
             tempRpcHandlers.set(method, handler);
          };

          (context as any).__settingsRegistered = false;
          await activateFn(context);
          
          if (!(context as any).__settingsRegistered) {
             throw new Error(`Plugin '${manifest.name}' rejected: Plugins MUST call context.ui.registerSettings() during activation. If you have no parameters, call it with an empty array: context.ui.registerSettings([]).`);
          }
          
          this.runningPlugins.set(manifest.name, {
            deactivate: typeof deactivateFn === 'function' ? deactivateFn : () => {},
            listeners: [],
            rpcHandlers: tempRpcHandlers
          });
        } else {
           throw new Error(`Plugin '${manifest.name}' rejected: Missing required lifecycle hook 'activate'`);
        }
      }
    } catch (err) {
       console.error(`[PluginManager] Failed to reload plugin ${pluginId}:`, err);
    }
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
            
            // UI Sandbox plugins do not have a backend Node.js entry point, 
            // their main file is loaded in the renderer (e.g. index.html).
            if (manifest.getssh?.type === 'sandbox') {
              return;
            }

            // Node.js plugins MUST declare 'lifecycle' in getssh.capabilities
            if (!manifest.getssh?.capabilities?.includes('lifecycle')) {
              throw new Error(
                `Plugin '${manifest.name}' rejected: Node.js plugins must declare "getssh.capabilities": ["lifecycle"] in package.json to confirm deactivate() is implemented.`
              );
            }
            
            try {
              const securityMode = getBackendConfig().pluginSecurityMode || 'normal';

              // SAFE MODE: Return early, load nothing.
              if (securityMode === 'safe') {
                return;
              }

              // DEVELOPER MODE: Full native require, no sandbox
              if (securityMode === 'developer') {
                try {
                  const resolvedPath = require.resolve(mainEntryPath);
                  if (require.cache[resolvedPath]) {
                    delete require.cache[resolvedPath];
                  }
                } catch (e) {
                  // Ignore if not resolvable yet
                }
                const pluginModule = require(mainEntryPath);
                
                const activateFn = typeof pluginModule.activate === 'function' ? pluginModule.activate : undefined;
                const deactivateFn = typeof pluginModule.deactivate === 'function' ? pluginModule.deactivate : undefined;
                
                if (typeof deactivateFn !== 'function') {
                   throw new Error(`Plugin '${manifest.name}' rejected: Missing required lifecycle hook 'deactivate'`);
                }
                
                const deactSource = deactivateFn.toString().replace(/\s|\/\/.*|\/\*[\s\S]*?\*\//g, '');
                if (deactSource === '()=>{}' || deactSource === 'function(){}' || deactSource === 'deactivate(){}') {
                   throw new Error(`[Security] Plugin installation rejected: The 'deactivate' hook cannot be empty. It must contain actual cleanup logic.`);
                }
                
                if (typeof activateFn === 'function') {
                  const ctx = this.createMainContext(manifest);
                  (ctx as any).__settingsRegistered = false;
                  await activateFn(ctx);
                  
                  if (!(ctx as any).__settingsRegistered) {
                     throw new Error(`Plugin '${manifest.name}' rejected: Plugins MUST call context.ui.registerSettings() during activation. If you have no parameters, call it with an empty array: context.ui.registerSettings([]).`);
                  }
                  
                  const pending = (ctx as any).__pendingRpcHandlers as Map<string, any> | undefined;
                  this.runningPlugins.set(manifest.name, { deactivate: deactivateFn, rpcHandlers: pending });
                } else {
                  throw new Error(`Plugin '${manifest.name}' rejected: Missing required lifecycle hook 'activate'`);
                }
                return;
              }

              // STRICT AND NORMAL MODES: VM Sandboxing
              const pluginCode = await fs.promises.readFile(mainEntryPath, 'utf8');

              const safeRequire = (moduleName: string) => {
                const normalizedModuleName = moduleName.startsWith('node:') ? moduleName.slice(5) : moduleName;
                
                if (securityMode === 'strict') {
                  // STRICT: Only path and os
                  const whitelist = ['path', 'os'];
                  if (whitelist.includes(normalizedModuleName)) return require(moduleName);
                  SecureCenter.getInstance().triggerLockdown(`Sandbox violation: Plugin '${manifest.name}' attempted to require restricted module '${moduleName}' in Strict Mode.`, 'yellow');
                  throw new Error(`Sandbox violation: Cannot require module '${moduleName}' in Strict Mode`);
                } else {
                  // NORMAL: Relaxed but block extremely dangerous ones
                  const blacklist = ['fs', 'fs/promises', 'child_process', 'net'];
                  if (blacklist.includes(normalizedModuleName)) {
                    SecureCenter.getInstance().triggerLockdown(`Sandbox violation: Plugin '${manifest.name}' attempted to require dangerous module '${moduleName}' in Normal Mode.`, 'yellow');
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
              
              const deactSource = deactivateFn.toString().replace(/\s|\/\/.*|\/\*[\s\S]*?\*\//g, '');
              if (deactSource === '()=>{}' || deactSource === 'function(){}' || deactSource === 'deactivate(){}') {
                 throw new Error(`[Security] Plugin installation rejected: The 'deactivate' hook cannot be empty. It must contain actual cleanup logic.`);
              }

              if (typeof activateFn === 'function') {
                const ctx = this.createMainContext(manifest);
                (ctx as any).__settingsRegistered = false;
                await activateFn(ctx);
                
                if (!(ctx as any).__settingsRegistered) {
                   throw new Error(`Plugin '${manifest.name}' rejected: Plugins MUST call context.ui.registerSettings() during activation. If you have no parameters, call it with an empty array: context.ui.registerSettings([]).`);
                }
                
                const pending = (ctx as any).__pendingRpcHandlers as Map<string, any> | undefined;
                this.runningPlugins.set(manifest.name, { deactivate: deactivateFn, rpcHandlers: pending });
              } else {
                throw new Error(`Plugin '${manifest.name}' rejected: Missing required lifecycle hook 'activate'`);
              }
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

  public deactivateAll() {
    for (const [name, plugin] of this.runningPlugins.entries()) {
      try {
        plugin.deactivate();
        if (plugin.listeners) {
          for (const l of plugin.listeners) {
            sshBridge.off(l.event, l.callback);
          }
        }
      } catch (e) {
        console.error(`[Plugin Kernel] Error deactivating plugin ${name} during teardown:`, e);
      }
    }
    this.runningPlugins.clear();
    this.uiExtensions = { terminal: [], sftp: [] };
    this.syncUIExtensions();
    console.log('[Plugin Kernel] All plugins deactivated.');
  }

  public setupIPC() {
    ipcMain.handle('get-plugin-list', () => this.installedPlugins);

    ipcMain.on('trigger-plugin-action', (event, { pluginId, actionId, contextData }) => {
      let ext = this.uiExtensions.terminal.find(e => e.pluginId === pluginId && e.actionId === actionId);
      if (!ext) {
        ext = this.uiExtensions.sftp.find(e => e.pluginId === pluginId && e.actionId === actionId);
      }
      if (ext) {
        try {
          ext.handler(contextData);
        } catch (err) {
          console.error(`[Plugin Kernel] Error executing plugin UI handler ${pluginId}.${actionId}:`, err);
        }
      }
    });
    
    ipcMain.handle('plugin-rpc-invoke', async (event, pluginId: string, method: string, payload: any) => {
      const plugin = this.runningPlugins.get(pluginId);
      if (!plugin) {
        return { success: false, error: `Plugin '${pluginId}' is not running.` };
      }
      if (!plugin.rpcHandlers || !plugin.rpcHandlers.has(method)) {
        return { success: false, error: `Method '${method}' not found on plugin '${pluginId}'.` };
      }
      
      try {
        const handler = plugin.rpcHandlers.get(method)!;
        const result = await handler(payload);
        return { success: true, result };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    });
    
     ipcMain.handle('reload-plugins', async () => {
      for (const [name, plugin] of this.runningPlugins.entries()) {
         try {
            plugin.deactivate();
            if (plugin.listeners) {
              for (const l of plugin.listeners) {
                sshBridge.off(l.event, l.callback);
              }
            }
         } catch (e) {
            console.error(`[Plugin Kernel] Error deactivating plugin ${name}:`, e);
         }
      }
      this.runningPlugins.clear();
      this.uiExtensions = { terminal: [], sftp: [] };
      this.settingsSchemas.clear();
      this.syncUIExtensions();
      this.installedPlugins = [];
      await this.loadPlugins();
      return { success: true };
    });

    ipcMain.handle('reload-plugin', async (event, pluginId: string) => {
       try {
          await this.reloadPlugin(pluginId);
          return { success: true };
       } catch (e: any) {
          return { success: false, error: e.message };
       }
    });

    ipcMain.handle('plugin-storage-get', async (event, pluginId: string, key: string) => {
      try {
        return await pluginStorageManager.get(pluginId, key);
      } catch (e) {
        console.error(`[PluginManager] plugin-storage-get failed:`, e);
        return null;
      }
    });

    ipcMain.handle('plugin-storage-set', async (event, pluginId: string, key: string, value: any) => {
      try {
        await pluginStorageManager.set(pluginId, key, value);
        return { success: true };
      } catch (e: any) {
        console.error(`[PluginManager] plugin-storage-set failed:`, e);
        return { success: false, error: e.message };
      }
    });
    
    ipcMain.handle('uninstall-plugin', async (event, pluginName: string) => {
       try {
          if (this.runningPlugins.has(pluginName)) {
             try {
                const p = this.runningPlugins.get(pluginName)!;
                p.deactivate();
                if (p.listeners) {
                  for (const l of p.listeners) {
                    sshBridge.off(l.event, l.callback);
                  }
                }
             } catch (e) {
                console.error(`[Plugin Kernel] Error deactivating plugin ${pluginName}:`, e);
             }
             this.runningPlugins.delete(pluginName);
             this.uiExtensions.terminal = this.uiExtensions.terminal.filter(ext => ext.pluginId !== pluginName);
             this.uiExtensions.sftp = this.uiExtensions.sftp.filter(ext => ext.pluginId !== pluginName);
             this.syncUIExtensions();
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
    
    ipcMain.handle('preview-plugin', async (event, zipPath: string) => {
      try {
        const tempDir = await fs.promises.mkdtemp(path.join(app.getPath('temp'), 'getssh-plugin-preview-'));
        const resolvedTempDir = path.resolve(tempDir);

        const addonPath = path.join(__dirname, '../../rust-core/getssh-unarchive');
        const unarchive = require(addonPath);
        
        await unarchive.extractPlugin(zipPath, resolvedTempDir);

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

        // === LIFECYCLE GATE (install-time) ===
        // Node.js plugins MUST declare 'lifecycle' capability in package.json.
        // Sandbox plugins are exempt (they have no backend code).
        if (manifest.getssh?.type !== 'sandbox') {
          if (!manifest.getssh?.capabilities?.includes('lifecycle')) {
            throw new Error(
              `[Security] Plugin '${manifest.name}' installation rejected: ` +
              `Node.js plugins must declare "getssh": { "capabilities": ["lifecycle"] } in package.json ` +
              `to confirm that a deactivate() lifecycle hook is implemented. ` +
              `This is required for safe RASP shutdown compatibility.`
            );
          }

          // Static Code Analysis: Verify that the main JS file actually exports 'deactivate'
          const mainEntryPath = path.join(sourceDir, manifest.main || 'index.js');
          try {
            const pluginCode = await fs.promises.readFile(mainEntryPath, 'utf8');
            const strippedCode = pluginCode.replace(/\s|\/\/.*|\/\*[\s\S]*?\*\//g, '');
            if (!pluginCode.includes('deactivate')) {
              throw new Error(`[Security] Plugin '${manifest.name}' installation rejected: ` +
                `The main script '${manifest.main || 'index.js'}' does not export a 'deactivate' lifecycle hook. ` +
                `All backend plugins must clean up their resources for system stability.`
              );
            }
            if (strippedCode.includes('deactivate:()=>{}') || strippedCode.includes('deactivate:function(){}') || strippedCode.includes('deactivate(){}')) {
              throw new Error(`[Security] Plugin installation rejected: The 'deactivate' hook cannot be empty. It must contain actual cleanup logic.`);
            }
          } catch (e: any) {
            // If the error was generated by us, rethrow it
            if (e.message.includes('[Security]')) throw e;
            // Otherwise it's an I/O error
            throw new Error(`[Security] Failed to validate lifecycle hooks: ${e.message}`);
          }
        }

        return { success: true, manifest, sourceDir, tempDir };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    });

    ipcMain.handle('commit-plugin-install', async (event, { sourceDir, tempDir, manifest: _ignoredManifest }: { sourceDir: string; tempDir: string; manifest?: any }) => {
      try {
        // #5 FIX: Validate that the path is actually a plugin temp directory before manipulating it
        const osTempDir = app.getPath('temp');
        const resolvedTemp = path.resolve(tempDir);
        const resolvedBase = path.resolve(osTempDir);
        if (!resolvedTemp.startsWith(resolvedBase + path.sep) || !path.basename(resolvedTemp).startsWith('getssh-plugin-preview-')) {
          console.warn(`[Security] commit-plugin-install rejected suspicious temp path: ${resolvedTemp}`);
          return { success: false, error: 'Invalid temp directory: not a plugin temp directory.' };
        }

        const resolvedSource = path.resolve(sourceDir);
        if (resolvedSource !== resolvedTemp && !resolvedSource.startsWith(resolvedTemp + path.sep)) {
          console.warn(`[Security] commit-plugin-install rejected suspicious source path: ${resolvedSource}`);
          return { success: false, error: 'Invalid source directory: path traversal detected.' };
        }

        // #4 FIX: Do NOT trust the manifest from the renderer — re-read from the server-side sourceDir
        const serverManifest = JSON.parse(
          await fs.promises.readFile(path.join(sourceDir, 'package.json'), 'utf8')
        );

        // If the renderer passed a manifest, explicitly validate it matches the server-side source of truth
        if (_ignoredManifest) {
          if (serverManifest.name !== _ignoredManifest.name || serverManifest.version !== _ignoredManifest.version) {
            throw new Error(`Manifest mismatch: expected ${_ignoredManifest.name}@${_ignoredManifest.version}, got ${serverManifest.name}@${serverManifest.version}`);
          }
        }

        const targetDir = this.getSecurePluginPath(serverManifest.name);
        
        if (this.runningPlugins.has(serverManifest.name)) {
           try {
              const p = this.runningPlugins.get(serverManifest.name)!;
              p.deactivate();
              if (p.listeners) {
                for (const l of p.listeners) {
                  sshBridge.off(l.event, l.callback);
                }
              }
           } catch (e) {
              console.error(`[Plugin Kernel] Error deactivating plugin ${serverManifest.name}:`, e);
           }
           this.runningPlugins.delete(serverManifest.name);
        }
        
        await fs.promises.rm(targetDir, { recursive: true, force: true });
        await fs.promises.rename(sourceDir, targetDir);
        
        serverManifest.localPath = targetDir;
        if (!this.installedPlugins.find(p => p.name === serverManifest.name)) {
          this.installedPlugins.push(serverManifest);
        }
        
        return { success: true, manifest: serverManifest };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    });

    ipcMain.handle('abort-plugin-install', async (event, tempDir: string) => {
      try {
        // #5 FIX: Validate that the path is actually a plugin temp directory before rm -rf
        const osTempDir = app.getPath('temp');
        const resolved = path.resolve(tempDir);
        const resolvedBase = path.resolve(osTempDir);
        if (!resolved.startsWith(resolvedBase + path.sep) || !path.basename(resolved).startsWith('getssh-plugin-preview-')) {
          console.warn(`[Security] abort-plugin-install rejected suspicious path: ${resolved}`);
          return { success: false, error: 'Invalid path: not a plugin temp directory.' };
        }
        await fs.promises.rm(resolved, { recursive: true, force: true });
        return { success: true };
      } catch (e) {
        return { success: false };
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
