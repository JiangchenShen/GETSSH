import fs from 'fs';
import path from 'path';
import { app, ipcMain, Notification, safeStorage, BrowserWindow, dialog, clipboard } from 'electron';
import { getBackendConfig } from './handlers/systemHandler';
import pLimit from 'p-limit';
import type { PluginManifest, PluginSettingsSchema, MainContextAPI } from '../../src/types/plugin';
import { sshBridge } from './services/SSHBridge';
import { pluginStorageManager } from './services/PluginStorageManager';
import { SecureCenter } from './security/SecureCenter';
import { getRustCorePath } from './utils/rustCorePath';
import { PluginProcessHost } from './services/plugin/PluginProcessHost';
import { fetchForPlugin, isPrivateNetworkAddress } from './services/plugin/PluginNetworkGateway';
import {
  assertMessageSize,
  assertSafeIdentifier,
  type PluginHostMethod,
  type PluginRegistrationSnapshot
} from './services/plugin/pluginProtocol';

export function isPrivateIP(ip: string): boolean {
  return isPrivateNetworkAddress(ip);
}

interface PluginListener {
  event: string;
  callback: (...args: any[]) => void;
  subscriptionId?: string;
}

interface RunningPlugin {
  host?: PluginProcessHost;
  deactivate?: () => void | Promise<void>;
  listeners?: PluginListener[];
  rpcHandlers?: Map<string, (payload: any) => Promise<any>>;
}

export class PluginManager {
  private pluginsPath: string;
  public installedPlugins: PluginManifest[] = [];
  private approvedSshWriters: Set<string> = new Set();
  private runningPlugins: Map<string, RunningPlugin> = new Map();

  private uiExtensions: {
    terminal: Array<{ pluginId: string, actionId: string, label: string, handler: Function }>,
    sftp: Array<{ pluginId: string, actionId: string, label: string, handler: Function }>
  } = { terminal: [], sftp: [] };

  private settingsSchemas: Map<string, PluginSettingsSchema[]> = new Map();
  private _previewSourceDirCache: Record<string, string> = {};

  constructor() {
    this.pluginsPath = path.join(app.getPath('userData'), 'plugins');
  }

  private getSecurePluginPath(pluginName: string): string {
    assertSafeIdentifier(pluginName, 'Plugin name');
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

      const schemasObj = Object.create(null) as Record<string, PluginSettingsSchema[]>;
      this.settingsSchemas.forEach((schema, id) => { schemasObj[id] = schema; });
      allWindows[0].webContents.send('sync-plugin-settings-schemas', schemasObj);
    }
  }

  private createMainContext(manifest: PluginManifest): MainContextAPI {
    const context = Object.create(null) as MainContextAPI;
    context.showNotification = (title: string, body: string) => new Notification({ title, body }).show();
    context.safeStorageEncrypt = async (text: string) => {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('SecurityError: OS safe storage is unavailable.');
      }
      return safeStorage.encryptString(text).toString('base64');
    };

    // Inject SSH namespace if capabilities are requested
    const caps = manifest.getssh?.capabilities || [];
    if (caps.includes('ssh:read') || caps.includes('ssh:write')) {
      const sshContext = Object.create(null);

      if (caps.includes('ssh:read')) {
        sshContext.onData = (sessionId: string, callback: (chunk: string) => void) => {
          sshBridge.on(`data:${sessionId}`, callback);

          const listener = { event: `data:${sessionId}`, callback };

          // Register cleanup hook
          if (!this.runningPlugins.has(manifest.name)) {
            // Might be called before runningPlugins is set, so we defer
            setTimeout(() => {
              const p = this.runningPlugins.get(manifest.name);
              if (p) {
                p.listeners = p.listeners || [];
                p.listeners.push(listener);
              }
            }, 0);
          } else {
            const p = this.runningPlugins.get(manifest.name);
            if (p) {
              p.listeners = p.listeners || [];
              p.listeners.push(listener);
            }
          }

          return () => {
            sshBridge.off(`data:${sessionId}`, callback);
            const p = this.runningPlugins.get(manifest.name);
            if (p && p.listeners) {
              p.listeners = p.listeners.filter(l => l !== listener);
            }
          };
        };
      } else {
        sshContext.onData = () => { throw new Error(`[Security] Plugin '${manifest.name}' missing 'ssh:read' capability`); };
      }

      if (caps.includes('ssh:write')) {
        sshContext.write = async (sessionId: string, command: string) => {
          if (!this.approvedSshWriters.has(manifest.name)) {
            const allWindows = BrowserWindow.getAllWindows();
            const focusedWindow = allWindows.find(w => w.isFocused()) ?? allWindows[0];

            const options = {
              type: 'warning' as const,
              buttons: ['拒绝写入 (Deny)', '仅本次允许 (Allow Once)', '总是允许 (Always Allow)'],
              defaultId: 0,
              title: '高危权限请求 (High-Risk Permission Request)',
              message: `插件 [${manifest.name}] 正在尝试向终端会话发送命令。`,
              detail: `执行内容 (Command snippet): ${command.substring(0, 50)}...`
            };

            const choice = focusedWindow
              ? await dialog.showMessageBox(focusedWindow, options)
              : await dialog.showMessageBox(options);

            if (choice.response === 0) {
              throw new Error(`Permission denied for ssh:write by user`);
            }
            if (choice.response === 2) {
              this.approvedSshWriters.add(manifest.name);
            }
          }
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
      set: (key: string, value: any) => pluginStorageManager.set(manifest.name, key, value, caps),
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
        this.settingsSchemas.set(manifest.name, this.validateSettingsSchema(schema, manifest.name));
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
        if (!caps.includes('net:fetch')) {
          throw new Error('SecurityError: Plugin missing "net:fetch" capability');
        }
        const headers = options?.headers ? Array.from(new Headers(options.headers).entries()) : [];
        const bodyText = typeof options?.body === 'string' ? options.body : undefined;
        if (options?.body && bodyText === undefined) {
          throw new Error('NetworkError: Developer-mode plugin fetch only supports string bodies.');
        }
        try {
          const response = await fetchForPlugin(url, {
            method: options?.method,
            headers,
            redirect: options?.redirect,
            bodyText
          });
          return new Response(Buffer.from(response.bodyBase64, 'base64'), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
        } catch (error) {
          if (error instanceof Error && error.message.startsWith('SecurityError:')) {
            SecureCenter.getInstance().triggerLockdown(
              `Plugin network policy violation by '${manifest.name}': ${error.message}`,
              'red'
            );
            this.forceKill(manifest.name);
          }
          throw error;
        }
      }
    });

    return Object.freeze(context) as MainContextAPI;
  }

  private requireCapability(manifest: PluginManifest, capability: string): void {
    if (!manifest.getssh?.capabilities?.includes(capability)) {
      throw new Error(`SecurityError: Plugin '${manifest.name}' is missing '${capability}' capability.`);
    }
  }

  private validateSettingsSchema(schema: unknown, pluginId: string): PluginSettingsSchema[] {
    if (!Array.isArray(schema) || schema.length === 0 || schema.length > 256) {
      throw new Error(`Plugin '${pluginId}' must register 1-256 valid settings.`);
    }
    const seenIds = new Set<string>();
    return schema.map((rawField, index) => {
      if (!rawField || typeof rawField !== 'object' || Array.isArray(rawField)) {
        throw new Error(`Plugin '${pluginId}' setting ${index} must be an object.`);
      }
      const field = rawField as Record<string, unknown>;
      assertSafeIdentifier(field.id, `Plugin '${pluginId}' setting ID`);
      if (seenIds.has(field.id)) {
        throw new Error(`Plugin '${pluginId}' registered duplicate setting '${field.id}'.`);
      }
      seenIds.add(field.id);
      if (
        field.type !== 'string' &&
        field.type !== 'number' &&
        field.type !== 'boolean' &&
        field.type !== 'password'
      ) {
        throw new Error(`Plugin '${pluginId}' setting '${field.id}' has an invalid type.`);
      }
      if (typeof field.label !== 'string' || field.label.length === 0 || field.label.length > 256) {
        throw new Error(`Plugin '${pluginId}' setting '${field.id}' has an invalid label.`);
      }
      if (field.description !== undefined && (typeof field.description !== 'string' || field.description.length > 4_096)) {
        throw new Error(`Plugin '${pluginId}' setting '${field.id}' has an invalid description.`);
      }
      if (field.default !== undefined) assertMessageSize(field.default);
      return {
        id: field.id,
        type: field.type,
        label: field.label,
        ...(field.description !== undefined ? { description: field.description } : {}),
        ...(field.default !== undefined ? { default: structuredClone(field.default) } : {})
      };
    });
  }

  private stringArg(args: unknown[], index: number, label: string, maxLength = 65_536): string {
    const value = args[index];
    if (typeof value !== 'string' || value.length > maxLength) {
      throw new Error(`${label} must be a string of at most ${maxLength} characters.`);
    }
    return value;
  }

  private objectArg(args: unknown[], index: number, label: string): Record<string, any> {
    const value = args[index];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${label} must be a plain object.`);
    }
    return value as Record<string, any>;
  }

  private async dispatchPluginHostCall(
    pluginId: string,
    manifest: PluginManifest,
    host: PluginProcessHost,
    method: PluginHostMethod,
    args: unknown[]
  ): Promise<unknown> {
    assertMessageSize(args);
    const running = this.runningPlugins.get(pluginId);
    if (!running || running.host !== host) {
      throw new Error(`Plugin '${pluginId}' is no longer running.`);
    }

    switch (method) {
      case 'notification.show': {
        const title = this.stringArg(args, 0, 'Notification title', 256);
        const body = this.stringArg(args, 1, 'Notification body', 4_096);
        new Notification({ title, body }).show();
        return null;
      }
      case 'safeStorage.encrypt': {
        const text = this.stringArg(args, 0, 'Safe-storage value', 1024 * 1024);
        if (!safeStorage.isEncryptionAvailable()) {
          throw new Error('SecurityError: OS safe storage is unavailable.');
        }
        return safeStorage.encryptString(text).toString('base64');
      }
      case 'storage.get': {
        const key = this.stringArg(args, 0, 'Storage key', 256);
        return pluginStorageManager.get(pluginId, key);
      }
      case 'storage.set': {
        const key = this.stringArg(args, 0, 'Storage key', 256);
        await pluginStorageManager.set(
          pluginId,
          key,
          args[1],
          manifest.getssh?.capabilities || []
        );
        return null;
      }
      case 'storage.delete': {
        const key = this.stringArg(args, 0, 'Storage key', 256);
        await pluginStorageManager.delete(pluginId, key);
        return null;
      }
      case 'storage.clear':
        await pluginStorageManager.clear(pluginId);
        return null;
      case 'ssh.subscribe': {
        this.requireCapability(manifest, 'ssh:read');
        const subscriptionId = this.stringArg(args, 0, 'SSH subscription ID', 128);
        const sessionId = this.stringArg(args, 1, 'SSH session ID', 256);
        assertSafeIdentifier(subscriptionId, 'SSH subscription ID');
        if (running.listeners?.some(listener => listener.subscriptionId === subscriptionId)) {
          throw new Error(`SSH subscription '${subscriptionId}' is already registered.`);
        }
        const event = `data:${sessionId}`;
        const callback = (chunk: string) => host.sendSshData(subscriptionId, String(chunk));
        sshBridge.on(event, callback);
        running.listeners = running.listeners || [];
        running.listeners.push({ event, callback, subscriptionId });
        return null;
      }
      case 'ssh.unsubscribe': {
        const subscriptionId = this.stringArg(args, 0, 'SSH subscription ID', 128);
        const listener = running.listeners?.find(item => item.subscriptionId === subscriptionId);
        if (listener) {
          sshBridge.off(listener.event, listener.callback);
          running.listeners = running.listeners?.filter(item => item !== listener);
        }
        return null;
      }
      case 'ssh.write': {
        this.requireCapability(manifest, 'ssh:write');
        const sessionId = this.stringArg(args, 0, 'SSH session ID', 256);
        const command = this.stringArg(args, 1, 'SSH command', 1024 * 1024);
        if (!this.approvedSshWriters.has(pluginId)) {
          const allWindows = BrowserWindow.getAllWindows();
          const focusedWindow = allWindows.find(window => window.isFocused()) ?? allWindows[0];
          const options = {
            type: 'warning' as const,
            buttons: ['拒绝写入 (Deny)', '仅本次允许 (Allow Once)', '本次运行始终允许 (Allow This Run)'],
            defaultId: 0,
            title: '高危权限请求 (High-Risk Permission Request)',
            message: `插件 [${manifest.name}] 正在尝试向终端会话发送命令。`,
            detail: `执行内容 (Command snippet): ${command.substring(0, 200)}`
          };
          const choice = focusedWindow
            ? await dialog.showMessageBox(focusedWindow, options)
            : await dialog.showMessageBox(options);
          if (choice.response === 0) throw new Error('Permission denied for ssh:write by user.');
          if (choice.response === 2) this.approvedSshWriters.add(pluginId);
        }
        sshBridge.writeCommand(sessionId, command);
        return null;
      }
      case 'rpc.sendToFrontend': {
        const allWindows = BrowserWindow.getAllWindows();
        allWindows[0]?.webContents.send('plugin-rpc-message', pluginId, args[0]);
        return null;
      }
      case 'host.notify': {
        const title = this.stringArg(args, 0, 'Notification title', 256);
        const body = this.stringArg(args, 1, 'Notification body', 4_096);
        new Notification({ title, body }).show();
        return null;
      }
      case 'host.clipboard.writeText':
        this.requireCapability(manifest, 'host:clipboard');
        clipboard.writeText(this.stringArg(args, 0, 'Clipboard text', 1024 * 1024));
        return null;
      case 'host.clipboard.readText':
        this.requireCapability(manifest, 'host:clipboard');
        new Notification({
          title: '⚠️ 剪贴板安全提醒',
          body: `插件 [${manifest.name}] 刚刚读取了您的系统剪贴板`
        }).show();
        return clipboard.readText();
      case 'host.showMessageBox': {
        const options = this.objectArg(args, 0, 'Message-box options') as Electron.MessageBoxOptions;
        const allWindows = BrowserWindow.getAllWindows();
        const focusedWindow = allWindows.find(window => window.isFocused()) ?? allWindows[0];
        return focusedWindow
          ? dialog.showMessageBox(focusedWindow, options)
          : dialog.showMessageBox(options);
      }
      case 'host.showOpenDialog': {
        const options = this.objectArg(args, 0, 'Open-dialog options') as Electron.OpenDialogOptions;
        const allWindows = BrowserWindow.getAllWindows();
        const focusedWindow = allWindows.find(window => window.isFocused()) ?? allWindows[0];
        return focusedWindow
          ? dialog.showOpenDialog(focusedWindow, options)
          : dialog.showOpenDialog(options);
      }
      case 'host.showSaveDialog': {
        const options = this.objectArg(args, 0, 'Save-dialog options') as Electron.SaveDialogOptions;
        const allWindows = BrowserWindow.getAllWindows();
        const focusedWindow = allWindows.find(window => window.isFocused()) ?? allWindows[0];
        return focusedWindow
          ? dialog.showSaveDialog(focusedWindow, options)
          : dialog.showSaveDialog(options);
      }
      case 'net.fetch': {
        this.requireCapability(manifest, 'net:fetch');
        const url = this.stringArg(args, 0, 'Network URL', 8_192);
        const options = args[1] === undefined
          ? undefined
          : this.objectArg(args, 1, 'Network options');
        try {
          return await fetchForPlugin(url, options);
        } catch (error) {
          if (error instanceof Error && error.message.startsWith('SecurityError:')) {
            SecureCenter.getInstance().triggerLockdown(
              `Plugin network policy violation by '${pluginId}': ${error.message}`,
              'red'
            );
            this.forceKill(pluginId);
          }
          throw error;
        }
      }
      default:
        throw new Error(`SecurityError: Unknown plugin host method '${method}'.`);
    }
  }

  private registerIsolatedPlugin(
    pluginId: string,
    host: PluginProcessHost,
    registrations: PluginRegistrationSnapshot
  ): void {
    assertMessageSize(registrations);
    if (!registrations || typeof registrations !== 'object') {
      throw new Error(`Plugin '${pluginId}' sent invalid activation registrations.`);
    }
    if (!Array.isArray(registrations.rpcMethods) || registrations.rpcMethods.length > 128) {
      throw new Error(`Plugin '${pluginId}' registered too many RPC methods.`);
    }
    if (!Array.isArray(registrations.terminalActions) || registrations.terminalActions.length > 128) {
      throw new Error(`Plugin '${pluginId}' registered too many terminal actions.`);
    }
    if (!Array.isArray(registrations.sftpActions) || registrations.sftpActions.length > 128) {
      throw new Error(`Plugin '${pluginId}' registered too many SFTP actions.`);
    }
    const settings = this.validateSettingsSchema(registrations.settings, pluginId);

    const rpcHandlers = new Map<string, (payload: any) => Promise<any>>();
    for (const method of registrations.rpcMethods) {
      assertSafeIdentifier(method, 'Plugin RPC method');
      if (rpcHandlers.has(method)) throw new Error(`Duplicate plugin RPC method '${method}'.`);
      rpcHandlers.set(method, payload => host.invoke('rpc', method, payload));
    }

    const seenActions = new Set<string>();
    const registerActions = (
      target: 'terminal' | 'sftp',
      actions: PluginRegistrationSnapshot['terminalActions']
    ) => {
      for (const action of actions) {
        assertSafeIdentifier(action.actionId, 'Plugin action ID');
        assertSafeIdentifier(action.handlerId, 'Plugin handler ID');
        if (typeof action.label !== 'string' || action.label.length === 0 || action.label.length > 256) {
          throw new Error('Plugin action label must contain 1-256 characters.');
        }
        const key = `${target}:${action.actionId}`;
        if (seenActions.has(key)) throw new Error(`Duplicate plugin action '${key}'.`);
        seenActions.add(key);
        this.uiExtensions[target].push({
          pluginId,
          actionId: action.actionId,
          label: action.label,
          handler: (payload: unknown) => host.invoke('ui', action.handlerId, payload)
        });
      }
    };
    registerActions('terminal', registrations.terminalActions);
    registerActions('sftp', registrations.sftpActions);

    const running = this.runningPlugins.get(pluginId);
    if (!running || running.host !== host) {
      throw new Error(`Plugin '${pluginId}' exited during activation.`);
    }
    running.rpcHandlers = rpcHandlers;
    this.settingsSchemas.set(pluginId, settings);
    this.syncUIExtensions();
  }

  private async startIsolatedPlugin(
    pluginId: string,
    pluginDir: string,
    entryPath: string,
    manifest: PluginManifest
  ): Promise<void> {
    assertSafeIdentifier(pluginId, 'Plugin ID');
    if (manifest.name !== pluginId) {
      throw new Error(
        `Plugin identity mismatch: directory '${pluginId}' declares manifest name '${manifest.name}'.`
      );
    }

    const realPluginDir = await fs.promises.realpath(pluginDir);
    const realEntryPath = await fs.promises.realpath(entryPath);
    if (!realEntryPath.startsWith(`${realPluginDir}${path.sep}`)) {
      throw new Error(`Plugin '${pluginId}' entry point escapes its installation directory.`);
    }

    let host!: PluginProcessHost;
    host = new PluginProcessHost({
      pluginId,
      pluginDir: realPluginDir,
      entryPath: realEntryPath,
      workerPath: path.join(__dirname, 'plugin-host.js'),
      manifest,
      onHostCall: (method, args) => this.dispatchPluginHostCall(pluginId, manifest, host, method, args),
      onHostNotify: async (method, args) => {
        await this.dispatchPluginHostCall(pluginId, manifest, host, method, args);
      },
      onExit: () => {
        if (this.runningPlugins.get(pluginId)?.host === host) {
          this.cleanupPluginState(pluginId, false);
        }
      }
    });

    this.runningPlugins.set(pluginId, { host, listeners: [], rpcHandlers: new Map() });
    try {
      const registrations = await host.start();
      this.registerIsolatedPlugin(pluginId, host, registrations);
      console.log(`[Plugin Kernel] Plugin '${pluginId}' activated in OS-confined process ${host.pid}.`);
    } catch (error) {
      this.cleanupPluginState(pluginId, true);
      throw error;
    }
  }

  private async startDeveloperPlugin(
    pluginId: string,
    entryPath: string,
    manifest: PluginManifest
  ): Promise<void> {
    if (manifest.name !== pluginId) {
      throw new Error(
        `Plugin identity mismatch: directory '${pluginId}' declares manifest name '${manifest.name}'.`
      );
    }
    const resolvedPath = require.resolve(entryPath);
    delete require.cache[resolvedPath];
    const pluginModule = require(resolvedPath);
    if (typeof pluginModule.activate !== 'function' || typeof pluginModule.deactivate !== 'function') {
      throw new Error(`Plugin '${pluginId}' must export activate() and deactivate().`);
    }

    const state: RunningPlugin = {
      deactivate: pluginModule.deactivate,
      listeners: [],
      rpcHandlers: new Map()
    };
    this.runningPlugins.set(pluginId, state);
    this.settingsSchemas.delete(pluginId);
    try {
      const context = this.createMainContext(manifest);
      await pluginModule.activate(context);
      if (!this.settingsSchemas.has(pluginId)) {
        throw new Error(`Plugin '${pluginId}' must call context.ui.registerSettings() during activation.`);
      }
      state.rpcHandlers = (context as any).__pendingRpcHandlers || new Map();
      console.warn(`[Plugin Kernel] Developer plugin '${pluginId}' is running inside the main process.`);
    } catch (error) {
      this.cleanupPluginState(pluginId, false);
      throw error;
    }
  }

  private cleanupPluginState(pluginId: string, killProcess: boolean): void {
    const plugin = this.runningPlugins.get(pluginId);
    if (plugin?.listeners) {
      for (const listener of plugin.listeners) {
        sshBridge.off(listener.event, listener.callback);
      }
    }
    plugin?.rpcHandlers?.clear();
    if (killProcess) plugin?.host?.kill();
    this.uiExtensions.terminal = this.uiExtensions.terminal.filter(item => item.pluginId !== pluginId);
    this.uiExtensions.sftp = this.uiExtensions.sftp.filter(item => item.pluginId !== pluginId);
    this.settingsSchemas.delete(pluginId);
    this.approvedSshWriters.delete(pluginId);
    this.runningPlugins.delete(pluginId);
    this.syncUIExtensions();
  }

  public async gracefulDeactivate(pluginId: string): Promise<void> {
    const plugin = this.runningPlugins.get(pluginId);
    if (!plugin) return;
    try {
      if (plugin.host) {
        await plugin.host.shutdown();
      } else {
        await plugin.deactivate?.();
      }
    } catch (err) {
      console.error(`[PluginManager] Error deactivating plugin ${pluginId}:`, err);
    } finally {
      this.cleanupPluginState(pluginId, true);
    }
  }

  public async reloadPlugin(pluginId: string) {
    if (this.runningPlugins.has(pluginId)) {
      await this.gracefulDeactivate(pluginId);
    }

    // Clear previously registered UI hooks and schemas for this plugin to prevent duplication
    this.uiExtensions.terminal = this.uiExtensions.terminal.filter(ext => ext.pluginId !== pluginId);
    this.uiExtensions.sftp = this.uiExtensions.sftp.filter(ext => ext.pluginId !== pluginId);
    this.settingsSchemas.delete(pluginId);
    this.syncUIExtensions();

    const pluginDir = this.getSecurePluginPath(pluginId);
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
        const securityMode = getBackendConfig()?.pluginSecurityMode || 'safe';

        // SAFE MODE: Return early, load nothing. loadPlugins() enforces this at startup,
        // but reloadPlugin() is reachable on its own (saving plugin settings calls it),
        // so without this check safe mode is bypassed by executing the plugin here.
        if (securityMode === 'safe') {
          console.warn(`[PluginManager] Reload of Node plugin '${manifest.name}' skipped: safe mode does not load Node plugins.`);
          return;
        }

        const mainPath = path.join(pluginDir, manifest.main);
        if (securityMode === 'developer') {
          await this.startDeveloperPlugin(pluginId, mainPath, manifest);
        } else {
          await this.startIsolatedPlugin(pluginId, pluginDir, mainPath, manifest);
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
      const limit = pLimit(8);
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

            const securityMode = getBackendConfig().pluginSecurityMode || 'safe';
            if (securityMode === 'safe') return;

            if (securityMode === 'developer') {
              await this.startDeveloperPlugin(dirent.name, mainEntryPath, manifest);
            } else {
              await this.startIsolatedPlugin(dirent.name, pluginDir, mainEntryPath, manifest);
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

  public async deactivateAll(): Promise<void> {
    await Promise.all(
      Array.from(this.runningPlugins.keys()).map(pluginId => this.gracefulDeactivate(pluginId))
    );
    console.log('[Plugin Kernel] All plugins deactivated.');
  }

  /**
   * Host-managed resource eviction.
   * Completely bypasses the plugin's JS code and forcibly revokes all registered
   * listeners, RPC handlers, and UI extensions. Used by RASP during active threat mitigation.
   */
  public forceKill(pluginId: string) {
    if (!this.runningPlugins.has(pluginId)) return;
    this.cleanupPluginState(pluginId, true);
    console.log(`[Plugin Kernel] Plugin ${pluginId} forcibly killed. Resources reclaimed by host.`);
  }

  public forceKillAll() {
    for (const pluginId of Array.from(this.runningPlugins.keys())) {
      this.forceKill(pluginId);
    }
    console.log(`[Plugin Kernel] ALL plugins forcibly killed.`);
  }

  public setupIPC() {
    ipcMain.handle('get-plugin-list', () => this.installedPlugins);

    ipcMain.on('trigger-plugin-action', (event, { pluginId, actionId, contextData }) => {
      let ext = this.uiExtensions.terminal.find(e => e.pluginId === pluginId && e.actionId === actionId);
      if (!ext) {
        ext = this.uiExtensions.sftp.find(e => e.pluginId === pluginId && e.actionId === actionId);
      }
      if (ext) {
        void Promise.resolve(ext.handler(contextData)).catch((err) => {
          console.error(`[Plugin Kernel] Error executing plugin UI handler ${pluginId}.${actionId}:`, err);
        });
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
      await Promise.all(
        Array.from(this.runningPlugins.keys()).map(pluginId => this.gracefulDeactivate(pluginId))
      );
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
             await this.gracefulDeactivate(pluginName);
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

        const addonPath = getRustCorePath('getssh-unarchive');
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
        }

        this._previewSourceDirCache[resolvedTempDir] = sourceDir;

        return { success: true, manifest, sourceDir, tempDir };
      } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    });

    ipcMain.handle('commit-plugin-install', async (event, { tempDir, manifest: _ignoredManifest }: { tempDir: string; manifest?: any }) => {
      try {
        // #5 FIX: Validate that the path is actually a plugin temp directory before manipulating it
        const osTempDir = app.getPath('temp');
        const resolvedTemp = path.resolve(tempDir);
        const resolvedBase = path.resolve(osTempDir);
        if (path.dirname(resolvedTemp) !== resolvedBase || !path.basename(resolvedTemp).startsWith('getssh-plugin-preview-')) {
          console.warn(`[Security] commit-plugin-install rejected suspicious temp path: ${resolvedTemp}`);
          return { success: false, error: 'Invalid temp directory: not a plugin temp directory.' };
        }

        // #4 FIX: Do NOT trust the manifest from the renderer — re-read from the server-side sourceDir
        const sourceDir = this._previewSourceDirCache[resolvedTemp];
        if (!sourceDir) {
          return { success: false, error: 'Preview cache expired or missing. Please re-select the file.' };
        }
        delete this._previewSourceDirCache[resolvedTemp];

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
          await this.gracefulDeactivate(serverManifest.name);
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
        if (path.dirname(resolved) !== resolvedBase || !path.basename(resolved).startsWith('getssh-plugin-preview-')) {
          console.warn(`[Security] abort-plugin-install rejected suspicious path: ${resolved}`);
          return { success: false, error: 'Invalid path: not a plugin temp directory.' };
        }
        delete this._previewSourceDirCache[resolved];
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
              const pluginPath = await fs.promises.realpath(this.getSecurePluginPath(p.name));
              const rendererPath = await fs.promises.realpath(path.resolve(pluginPath, p.renderer!));
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
