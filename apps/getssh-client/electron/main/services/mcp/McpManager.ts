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

const MAX_MCP_SAMPLING_REQUESTS_PER_MINUTE = 10;

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

  public saveConfigs() {
    const tempPath = `${this.configPath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tempPath, JSON.stringify(this.serverConfigs, null, 2), {
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

  public async init() {
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
