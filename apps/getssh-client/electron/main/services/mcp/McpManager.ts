import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import {
  McpServerConfig,
  McpServerState,
  McpToolDefinition,
  McpResourceDefinition,
  McpResourceReadResult,
  McpPromptDefinition,
  McpGetPromptResult
} from './mcpTypes';
import { McpClient } from './McpClient';
import { normalizeMcpServerConfig } from './McpProcessSandbox';
import { McpToolWrapper } from './McpToolWrapper';
import { mcpSamplingBridge } from './McpSamplingBridge';
import { toolRegistry } from '../agent/ToolRegistry';
import { appLock } from '../../security/appLock';
import { getStore } from '../getsshStore';

const MAX_MCP_SAMPLING_REQUESTS_PER_MINUTE = 10;
/** App secrets holding each server's environment variables and HTTP headers (tokens). */
const SECRET_PREFIX = 'mcp/';

type McpSecrets = Pick<McpServerConfig, 'env' | 'headers'>;

/** A configuration without its environment and headers, and those two (null when both are empty). */
function splitSecrets(config: McpServerConfig): { plain: McpServerConfig; secrets: McpSecrets | null } {
  const { env, headers, ...plain } = config;
  const secrets: McpSecrets = {};
  if (env && Object.keys(env).length) secrets.env = env;
  if (headers && Object.keys(headers).length) secrets.headers = headers;
  return { plain, secrets: secrets.env || secrets.headers ? secrets : null };
}

/**
 * McpManager — Master controller for all Model Context Protocol (MCP) integrations
 * (Tools, Resources, Prompts, and Reverse Sampling)
 */
export class McpManager {
  private static instance: McpManager;
  private clients = new Map<string, McpClient>();
  private serverConfigs: McpServerConfig[] = [];
  private registeredToolNames = new Map<string, string[]>(); // serverId -> toolNames[]
  private configPath: string;
  /**
   * Environment variables and headers live in getssh-store (main.db), not in mcp_servers.json.
   * They are merged in once the data is open; until then the configurations lack them and a save
   * leaves the stored ones alone.
   */
  private secretsLoaded = false;

  private constructor() {
    const configDir = path.join(app.getPath('home'), '.getssh');
    if (!fs.existsSync(configDir)) {
      try { fs.mkdirSync(configDir, { recursive: true, mode: 0o700 }); } catch {}
    }
    try { fs.chmodSync(configDir, 0o700); } catch {}
    this.configPath = path.join(configDir, 'mcp_servers.json');
    this.loadConfigs();
  }

  public static getInstance(): McpManager {
    if (!McpManager.instance) {
      McpManager.instance = new McpManager();
    }
    return McpManager.instance;
  }

  private loadConfigs() {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error('MCP configuration root must be an array.');

        const seenIds = new Set<string>();
        this.serverConfigs = [];
        for (const entry of parsed) {
          try {
            const normalized = normalizeMcpServerConfig(entry);
            if (seenIds.has(normalized.id)) {
              console.warn(`[McpManager] Ignoring duplicate MCP server id '${normalized.id}'.`);
              continue;
            }
            seenIds.add(normalized.id);
            this.serverConfigs.push(normalized);
          } catch (error: any) {
            console.warn('[McpManager] Ignoring invalid MCP server configuration:', error.message);
          }
        }
        try { fs.chmodSync(this.configPath, 0o600); } catch {}
      } else {
        this.serverConfigs = [
          {
            id: 'mcp-docs',
            name: 'MCP Official Documentation',
            transport: 'http',
            enabled: false,
            url: 'https://modelcontextprotocol.io/mcp'
          }
        ];
        this.saveConfigs();
      }
    } catch (e: any) {
      console.error('[McpManager] Failed to load mcp_servers.json:', e.message);
      this.serverConfigs = [];
    }
  }

  /**
   * Merges each server's stored environment and headers. A file written before they moved into
   * the store still holds them: they are kept and moved now.
   */
  private async loadSecrets(): Promise<void> {
    await appLock.whenOpen();
    if (!appLock.isReady() || this.secretsLoaded) return;
    const store = getStore();
    let inline = false;
    this.serverConfigs = this.serverConfigs.map(config => {
      if (splitSecrets(config).secrets) {
        inline = true;
        return config;
      }
      const stored = store.getAppSecret(SECRET_PREFIX + config.id);
      if (!stored) return config;
      try {
        return normalizeMcpServerConfig({ ...config, ...JSON.parse(stored.toString('utf8')) }, config.id);
      } catch (error: any) {
        console.warn(`[McpManager] The stored secrets of '${config.name}' are unusable:`, error.message);
        return config;
      } finally {
        stored.fill(0);
      }
    });
    this.secretsLoaded = true;
    if (inline) this.saveConfigs();
  }

  /**
   * Writes mcp_servers.json without environment variables and headers, and those to the store.
   * Before the stored ones were merged in, a configuration that has some cannot be saved (they
   * would land in the file), and the stored ones are left as they are.
   */
  public saveConfigs() {
    const parts = this.serverConfigs.map(splitSecrets);
    const storeOpen = this.secretsLoaded && appLock.isReady();
    if (!storeOpen && parts.some(part => part.secrets)) {
      throw new Error('GETSSH is locked: MCP environment variables and headers can be saved once it is unlocked.');
    }
    if (storeOpen) {
      const store = getStore();
      const ids = new Set(this.serverConfigs.map(config => config.id));
      this.serverConfigs.forEach((config, i) => {
        const secrets = parts[i].secrets;
        store.setAppSecret(SECRET_PREFIX + config.id, secrets ? JSON.stringify(secrets) : null);
      });
      for (const name of store.listAppSecretNames(SECRET_PREFIX)) {
        if (!ids.has(name.slice(SECRET_PREFIX.length))) store.setAppSecret(name, null);
      }
    }
    const tempPath = `${this.configPath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tempPath, JSON.stringify(parts.map(part => part.plain), null, 2), {
        encoding: 'utf-8',
        mode: 0o600,
        flag: 'w'
      });
      try { fs.chmodSync(tempPath, 0o600); } catch {}
      fs.renameSync(tempPath, this.configPath);
      try { fs.chmodSync(this.configPath, 0o600); } catch {}
    } catch (e: any) {
      console.error('[McpManager] Failed to save mcp_servers.json:', e.message);
      try { fs.unlinkSync(tempPath); } catch {}
      throw e;
    }
  }

  /** Starts the enabled servers once the data is open (their tokens are in the store). */
  public async init() {
    await this.loadSecrets();
    console.log(`[McpManager] Initializing ${this.serverConfigs.length} configured MCP servers...`);
    for (const config of this.serverConfigs) {
      if (config.enabled) {
        this.startServer(config).catch((err) => {
          console.warn(`[McpManager] Initial connection failed for '${config.name}':`, err.message);
        });
      }
    }
  }

  public async startServer(config: McpServerConfig): Promise<{ tools: McpToolDefinition[]; resources: McpResourceDefinition[]; prompts: McpPromptDefinition[] }> {
    const normalizedConfig = normalizeMcpServerConfig(config, config.id);
    this.stopServer(normalizedConfig.id);

    const client = new McpClient(normalizedConfig);
    this.clients.set(normalizedConfig.id, client);
    client.on('disconnected', () => {
      if (this.clients.get(normalizedConfig.id) !== client) return;
      const registered = this.registeredToolNames.get(normalizedConfig.id) || [];
      registered.forEach(name => toolRegistry.unregister(name));
      this.registeredToolNames.delete(normalizedConfig.id);
    });

    // ── Module B: Wire up Reverse LLM Sampling Bridge ──
    const samplingTimestamps: number[] = [];
    let samplingInFlight = false;
    client.on('sampling/createMessage', async (event: any) => {
      const { params, respond } = event;
      const now = Date.now();
      while (samplingTimestamps.length > 0 && samplingTimestamps[0] <= now - 60_000) {
        samplingTimestamps.shift();
      }
      if (normalizedConfig.permissions?.sampling !== true) {
        respond(undefined, { code: -32001, message: 'Reverse sampling is disabled for this MCP server.' });
        return;
      }
      if (samplingInFlight || samplingTimestamps.length >= MAX_MCP_SAMPLING_REQUESTS_PER_MINUTE) {
        respond(undefined, { code: -32002, message: 'Reverse sampling rate limit exceeded.' });
        return;
      }

      samplingInFlight = true;
      samplingTimestamps.push(now);
      try {
        const samplingRes = await mcpSamplingBridge.handleSamplingRequest(normalizedConfig.name, params);
        respond(samplingRes);
      } catch (err: any) {
        respond(undefined, { code: -32603, message: err.message });
      } finally {
        samplingInFlight = false;
      }
    });

    try {
      const { tools, resources, prompts } = await client.connect();
      if (this.clients.get(normalizedConfig.id) !== client) {
        client.disconnect();
        throw new Error(`MCP Server '${normalizedConfig.name}' start was superseded by a newer request.`);
      }

      // Unregister previous tools
      const previousTools = this.registeredToolNames.get(normalizedConfig.id) || [];
      previousTools.forEach(t => toolRegistry.unregister(t));

      // Register new tools to Agent ToolRegistry
      const registered: string[] = [];
      try {
        for (const toolDef of tools) {
          const wrapper = new McpToolWrapper(normalizedConfig.id, normalizedConfig.name, toolDef, client);
          toolRegistry.register(wrapper);
          registered.push(wrapper.name);
        }
      } catch (registrationError: any) {
        registered.forEach(name => toolRegistry.unregister(name));
        const error = new Error(`MCP tool registration failed: ${registrationError.message}`);
        client.terminateWithError(error);
        throw error;
      }
      this.registeredToolNames.set(normalizedConfig.id, registered);

      console.log(`[McpManager] Server '${normalizedConfig.name}' active: ${registered.length} Tools, ${resources.length} Resources, ${prompts.length} Prompts.`);
      return { tools, resources, prompts };
    } catch (err: any) {
      console.error(`[McpManager] Failed to start MCP Server '${normalizedConfig.name}':`, err.message);
      throw err;
    }
  }

  public stopServer(serverId: string) {
    const client = this.clients.get(serverId);
    if (client) {
      client.disconnect();
      this.clients.delete(serverId);
    }

    const registered = this.registeredToolNames.get(serverId) || [];
    registered.forEach(name => toolRegistry.unregister(name));
    this.registeredToolNames.delete(serverId);
  }

  public async addServer(config: Omit<McpServerConfig, 'id'>): Promise<McpServerConfig> {
    const generatedId = `mcp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newConfig = normalizeMcpServerConfig({
      ...config,
      id: generatedId
    }, generatedId);

    this.serverConfigs.push(newConfig);
    this.saveConfigs();

    if (newConfig.enabled) {
      try {
        await this.startServer(newConfig);
      } catch (error) {
        this.stopServer(newConfig.id);
        this.serverConfigs = this.serverConfigs.filter(server => server.id !== newConfig.id);
        this.saveConfigs();
        throw error;
      }
    }

    return newConfig;
  }

  public async updateServer(id: string, updates: Partial<McpServerConfig>): Promise<McpServerConfig> {
    const idx = this.serverConfigs.findIndex(s => s.id === id);
    if (idx === -1) throw new Error(`MCP Server not found: ${id}`);

    this.serverConfigs[idx] = normalizeMcpServerConfig(
      { ...this.serverConfigs[idx], ...updates, id },
      id
    );
    this.saveConfigs();

    const updated = this.serverConfigs[idx];
    if (updated.enabled) {
      await this.startServer(updated);
    } else {
      this.stopServer(id);
    }

    return updated;
  }

  public removeServer(serverId: string) {
    this.stopServer(serverId);
    this.serverConfigs = this.serverConfigs.filter(s => s.id !== serverId);
    this.saveConfigs();
  }

  public getAllServersState(): McpServerState[] {
    return this.serverConfigs.map(config => {
      const client = this.clients.get(config.id);
      if (!client) {
        return {
          config,
          status: 'disconnected',
          tools: [],
          resources: [],
          prompts: []
        };
      }

      return {
        config,
        status: client.getStatus(),
        error: client.getError(),
        tools: client.getTools(),
        resources: client.getResources(),
        prompts: client.getPrompts()
      };
    });
  }

  public getActiveMcpTools(): Array<{ serverName: string; tool: McpToolDefinition }> {
    const allTools: Array<{ serverName: string; tool: McpToolDefinition }> = [];
    for (const [serverId, client] of this.clients.entries()) {
      const config = client.getConfig();
      if (client.getStatus() === 'connected') {
        client.getTools().forEach(tool => {
          allTools.push({ serverName: config.name, tool });
        });
      }
    }
    return allTools;
  }

  // ── Module A: Resources API ───────────────────────────────────────────
  public getAllResources(): Array<{ serverName: string; serverId: string; resource: McpResourceDefinition }> {
    const list: Array<{ serverName: string; serverId: string; resource: McpResourceDefinition }> = [];
    for (const [serverId, client] of this.clients.entries()) {
      if (client.getStatus() === 'connected') {
        const config = client.getConfig();
        client.getResources().forEach(resource => {
          list.push({ serverName: config.name, serverId, resource });
        });
      }
    }
    return list;
  }

  public async readResource(serverId: string, uri: string): Promise<McpResourceReadResult> {
    const client = this.clients.get(serverId);
    if (!client) throw new Error(`MCP Server not active: ${serverId}`);
    return await client.readResource(uri);
  }

  // ── Module A: Prompts API ─────────────────────────────────────────────
  public getAllPrompts(): Array<{ serverName: string; serverId: string; prompt: McpPromptDefinition }> {
    const list: Array<{ serverName: string; serverId: string; prompt: McpPromptDefinition }> = [];
    for (const [serverId, client] of this.clients.entries()) {
      if (client.getStatus() === 'connected') {
        const config = client.getConfig();
        client.getPrompts().forEach(prompt => {
          list.push({ serverName: config.name, serverId, prompt });
        });
      }
    }
    return list;
  }

  public async getPrompt(serverId: string, promptName: string, args: Record<string, string> = {}): Promise<McpGetPromptResult> {
    const client = this.clients.get(serverId);
    if (!client) throw new Error(`MCP Server not active: ${serverId}`);
    return await client.getPrompt(promptName, args);
  }
}

export const mcpManager = McpManager.getInstance();
