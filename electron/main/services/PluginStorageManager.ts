import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import pLimit from 'p-limit';
import { SecureCenter } from '../security/SecureCenter';

export interface IStorageEngine {
  init(): Promise<void>;
  get(pluginId: string, key: string): Promise<any>;
  set(pluginId: string, key: string, value: any, quotaBytes: number): Promise<void>;
  delete(pluginId: string, key: string): Promise<void>;
  clear(pluginId: string): Promise<void>;
}

class JsonStorageEngine implements IStorageEngine {
  private basePath: string;
  private storeCache: Map<string, Record<string, any>> = new Map();
  private writeQueue: Set<string> = new Set();
  private writeTimeout: NodeJS.Timeout | null = null;
  // Track quota limits per plugin for the async flush
  private quotaMap: Map<string, number> = new Map();

  constructor() {
    this.basePath = path.join(app.getPath('userData'), 'plugin_data');
  }

  public async init() {
    let exists = false;
    try {
      await fs.promises.access(this.basePath, fs.constants.F_OK);
      exists = true;
    } catch {
      exists = false;
    }
    if (!exists) {
      await fs.promises.mkdir(this.basePath, { recursive: true });
    }
  }

  private async loadPluginData(pluginId: string): Promise<Record<string, any>> {
    if (this.storeCache.has(pluginId)) {
      return this.storeCache.get(pluginId)!;
    }
    await this.init();
    const filePath = path.join(this.basePath, `${pluginId}.json`);
    
    if (!path.resolve(filePath).startsWith(path.resolve(this.basePath))) {
      throw new Error(`[Security] Path traversal detected for plugin ID: ${pluginId}`);
    }

    try {
      let fileExists = false;
      try {
        await fs.promises.access(filePath, fs.constants.F_OK);
        fileExists = true;
      } catch {
        fileExists = false;
      }
      if (fileExists) {
        const data = await fs.promises.readFile(filePath, 'utf8');
        const parsed = JSON.parse(data);
        this.storeCache.set(pluginId, parsed);
        return parsed;
      }
    } catch (e) {
      console.warn(`[PluginStorageManager] Failed to read or parse storage for plugin ${pluginId}. Starting fresh.`, e);
    }
    const fresh: Record<string, any> = {};
    this.storeCache.set(pluginId, fresh);
    return fresh;
  }

  private scheduleFlush(pluginId: string, quotaBytes: number) {
    this.writeQueue.add(pluginId);
    this.quotaMap.set(pluginId, quotaBytes);
    if (!this.writeTimeout) {
      this.writeTimeout = setTimeout(() => this.flushNow(), 500);
    }
  }

  private async flushNow() {
    this.writeTimeout = null;
    const targets = Array.from(this.writeQueue);
    this.writeQueue.clear();

    await this.init();

    const limit = pLimit(20);

    await Promise.all(
      targets.map((pluginId) =>
        limit(async () => {
          try {
            const data = this.storeCache.get(pluginId);
            if (!data) return;

            const quotaBytes = this.quotaMap.get(pluginId) || (5 * 1024 * 1024);
            const jsonStr = JSON.stringify(data);

            if (quotaBytes !== Infinity && Buffer.byteLength(jsonStr, 'utf8') > quotaBytes) {
              console.error(`[PluginStorageManager] FATAL: Plugin ${pluginId} exceeded quota during flush. Skipping write to prevent disk bloat.`);
              return;
            }

            const filePath = path.join(this.basePath, `${pluginId}.json`);
            await fs.promises.writeFile(filePath, jsonStr, 'utf8');
          } catch (e) {
            console.error(`[PluginStorageManager] Failed to flush data to disk for plugin ${pluginId}:`, e);
          }
        })
      )
    );
  }

  public async get(pluginId: string, key: string): Promise<any> {
    const data = await this.loadPluginData(pluginId);
    const value = data[key];
    return value !== undefined ? JSON.parse(JSON.stringify(value)) : undefined;
  }

  public async set(pluginId: string, key: string, value: any, quotaBytes: number): Promise<void> {
    const data = await this.loadPluginData(pluginId);
    const backup = data[key];
    data[key] = value;
    
    const jsonStr = JSON.stringify(data);
    if (quotaBytes !== Infinity && Buffer.byteLength(jsonStr, 'utf8') > quotaBytes) {
      if (backup === undefined) {
        delete data[key];
      } else {
        data[key] = backup;
      }
      SecureCenter.getInstance().triggerLockdown(`Plugin '${pluginId}' attempted to exceed its storage quota of ${quotaBytes} bytes.`, 'yellow');
      throw new Error(`QuotaExceededError: Plugin storage exceeded allocated limit.`);
    }

    data[key] = value !== undefined ? JSON.parse(JSON.stringify(value)) : undefined;
    this.scheduleFlush(pluginId, quotaBytes);
  }

  public async delete(pluginId: string, key: string): Promise<void> {
    const data = await this.loadPluginData(pluginId);
    if (key in data) {
      delete data[key];
      // Default to 5MB for delete flush, it won't exceed since we are deleting
      this.scheduleFlush(pluginId, 5 * 1024 * 1024);
    }
  }

  public async clear(pluginId: string): Promise<void> {
    this.storeCache.set(pluginId, {});
    this.scheduleFlush(pluginId, 5 * 1024 * 1024);
  }
}

class SqliteStorageEngine implements IStorageEngine {
  private basePath: string;
  private rustKv: any;

  constructor() {
    this.basePath = path.join(app.getPath('userData'), 'plugin_data');
    const addonPath = path.join(__dirname, '../../rust-core/getssh-kv');
    try {
      this.rustKv = require(addonPath);
    } catch (e) {
      if (process.env.VITEST) {
        this.rustKv = {
          Database: class {
            get() {}
            set() {}
            delete() {}
            close() {}
          }
        };
      } else {
        throw e;
      }
    }
  }


  public async init() {
    let exists = false;
    try {
      await fs.promises.access(this.basePath, fs.constants.F_OK);
      exists = true;
    } catch {
      exists = false;
    }
    if (!exists) {
      await fs.promises.mkdir(this.basePath, { recursive: true });
    }
  }

  private getDbPath(pluginId: string): string {
    const dbPath = path.join(this.basePath, `${pluginId}.db`);
    if (!path.resolve(dbPath).startsWith(path.resolve(this.basePath))) {
      throw new Error(`[Security] Path traversal detected for plugin ID: ${pluginId}`);
    }
    return dbPath;
  }

  public async get(pluginId: string, key: string): Promise<any> {
    await this.init();
    const dbPath = this.getDbPath(pluginId);
    let exists = false;
    try {
      await fs.promises.access(dbPath, fs.constants.F_OK);
      exists = true;
    } catch {
      exists = false;
    }
    if (!exists) {
      return undefined;
    }
    const val = this.rustKv.getVal(dbPath, key);
    return val ? JSON.parse(val) : undefined;
  }

  public async set(pluginId: string, key: string, value: any, quotaBytes: number): Promise<void> {
    await this.init();
    const dbPath = this.getDbPath(pluginId);
    
    let exists = false;
    try {
      await fs.promises.access(dbPath, fs.constants.F_OK);
      exists = true;
    } catch {
      exists = false;
    }
    if (!exists) {
      this.rustKv.initDb(dbPath);
    }

    const valueStr = value !== undefined ? JSON.stringify(value) : "";
    const currentSize = this.rustKv.getStorageSize(dbPath);
    const addedSize = Buffer.byteLength(valueStr, 'utf8');

    if (quotaBytes !== Infinity && (currentSize + addedSize) > quotaBytes) {
      SecureCenter.getInstance().triggerLockdown(`Plugin '${pluginId}' attempted to exceed its storage quota of ${quotaBytes} bytes.`, 'yellow');
      throw new Error(`QuotaExceededError: Plugin storage exceeded allocated limit.`);
    }

    this.rustKv.setVal(dbPath, key, valueStr);
  }

  public async delete(pluginId: string, key: string): Promise<void> {
    await this.init();
    const dbPath = this.getDbPath(pluginId);
    let exists = false;
    try {
      await fs.promises.access(dbPath, fs.constants.F_OK);
      exists = true;
    } catch {
      exists = false;
    }
    if (!exists) return;
    this.rustKv.deleteVal(dbPath, key);
  }

  public async clear(pluginId: string): Promise<void> {
    await this.init();
    const dbPath = this.getDbPath(pluginId);
    let exists = false;
    try {
      await fs.promises.access(dbPath, fs.constants.F_OK);
      exists = true;
    } catch {
      exists = false;
    }
    if (!exists) return;
    this.rustKv.clearVal(dbPath);
  }
}

export class PluginStorageManager {
  private static instance: PluginStorageManager;
  private engine: IStorageEngine;

  private constructor() {
    this.engine = new SqliteStorageEngine();
  }

  public static getInstance(): PluginStorageManager {
    if (!PluginStorageManager.instance) {
      PluginStorageManager.instance = new PluginStorageManager();
    }
    return PluginStorageManager.instance;
  }

  private getQuotaLimit(capabilities: string[] = []): number {
    if (capabilities.includes('storage:unlimited')) return Infinity;
    if (capabilities.includes('storage:extended')) return 500 * 1024 * 1024;
    return 5 * 1024 * 1024;
  }

  public async get(pluginId: string, key: string): Promise<any> {
    return this.engine.get(pluginId, key);
  }

  public async set(pluginId: string, key: string, value: any, capabilities: string[] = []): Promise<void> {
    const quotaBytes = this.getQuotaLimit(capabilities);
    return this.engine.set(pluginId, key, value, quotaBytes);
  }

  public async delete(pluginId: string, key: string): Promise<void> {
    return this.engine.delete(pluginId, key);
  }

  public async clear(pluginId: string): Promise<void> {
    return this.engine.clear(pluginId);
  }
}

export const pluginStorageManager = PluginStorageManager.getInstance();
