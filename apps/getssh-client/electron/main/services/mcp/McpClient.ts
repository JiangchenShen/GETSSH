import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { resolveWindowsSandboxLauncherPath } from '../../security/WindowsProcessSandbox';
import {
  McpServerConfig,
  McpToolDefinition,
  McpResourceDefinition,
  McpResourceReadResult,
  McpPromptDefinition,
  McpGetPromptResult,
  McpJsonRpcRequest,
  McpJsonRpcResponse,
  McpCallToolResult,
  McpSamplingParams
} from './mcpTypes';
import { createMcpSpawnPlan } from './McpProcessSandbox';
import {
  normalizeMcpPromptDefinitions,
  normalizeMcpResourceDefinitions,
  normalizeMcpToolDefinitions
} from './McpProtocolPolicy';

const MAX_MCP_MESSAGE_BYTES = 8 * 1024 * 1024;
const MAX_PENDING_REQUESTS = 64;
const MAX_STDERR_LOG_BYTES = 64 * 1024;
const MAX_INBOUND_MESSAGES_PER_SECOND = 500;
const MAX_INBOUND_BYTES_PER_SECOND = 32 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isJsonRpcId(value: unknown): value is string | number {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

/**
 * McpClient — Handles bidirectional JSON-RPC 2.0 communication with an MCP Server
 * (Supports Tools, Resources, Prompts, and Reverse Sampling)
 */
export class McpClient extends EventEmitter {
  private config: McpServerConfig;
  private childProcess: ChildProcess | null = null;
  private pendingRequests = new Map<string | number, { resolve: (val: any) => void; reject: (err: any) => void; timer: NodeJS.Timeout }>();
  private nextRequestId = 1;
  private stdoutBuffer = '';
  private isConnected = false;
  private isConnecting = false;
  private lastError: string | null = null;
  private stopping = false;
  private spawnedDetached = false;
  private spawnedThroughWindowsLauncher = false;
  private processCleanupPending = false;
  private stderrLogBytes = 0;
  private runtimeHomeDir: string | null = null;
  private httpControllers = new Set<AbortController>();
  private inboundWindowStartedAt = Date.now();
  private inboundMessagesInWindow = 0;
  private inboundBytesInWindow = 0;

  private tools: McpToolDefinition[] = [];
  private resources: McpResourceDefinition[] = [];
  private prompts: McpPromptDefinition[] = [];

  constructor(config: McpServerConfig) {
    super();
    this.config = config;
  }

  public getStatus(): 'connected' | 'connecting' | 'disconnected' | 'error' {
    if (this.isConnected) return 'connected';
    if (this.isConnecting || this.childProcess) return 'connecting';
    if (this.lastError) return 'error';
    return 'disconnected';
  }

  public getError(): string | undefined {
    return this.lastError || undefined;
  }

  public getTools(): McpToolDefinition[] {
    return this.tools;
  }

  public getResources(): McpResourceDefinition[] {
    return this.resources;
  }

  public getPrompts(): McpPromptDefinition[] {
    return this.prompts;
  }

  public getConfig(): McpServerConfig {
    return this.config;
  }

  /**
   * Connect to the MCP server and perform initialization handshake
   */
  public async connect(): Promise<{ tools: McpToolDefinition[]; resources: McpResourceDefinition[]; prompts: McpPromptDefinition[] }> {
    if (this.processCleanupPending) {
      throw new Error(`MCP Server '${this.config.name}' is still stopping its previous isolated process.`);
    }
    this.lastError = null;
    this.stopping = false;
    this.isConnecting = true;
    this.inboundWindowStartedAt = Date.now();
    this.inboundMessagesInWindow = 0;
    this.inboundBytesInWindow = 0;
    try {
      if (this.config.transport === 'stdio') {
        return await this.connectStdio();
      } else if (this.config.transport === 'http' || this.config.transport === 'sse') {
        return await this.connectHttp();
      }
      throw new Error(`Unsupported MCP transport: ${this.config.transport}`);
    } catch (error: any) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.releaseRuntimeHome();
      throw error;
    } finally {
      this.isConnecting = false;
    }
  }

  private async connectStdio(): Promise<{ tools: McpToolDefinition[]; resources: McpResourceDefinition[]; prompts: McpPromptDefinition[] }> {
    if (!this.config.command) {
      throw new Error(`MCP Server '${this.config.name}' requires a 'command' for stdio transport.`);
    }

    const runtimeId = this.config.id.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 96);
    const runtimeHomeDir = fs.mkdtempSync(path.join(app.getPath('temp'), `getssh-mcp-${runtimeId}-`));
    this.runtimeHomeDir = runtimeHomeDir;
    try { fs.chmodSync(runtimeHomeDir, 0o700); } catch {}

    const spawnPlan = createMcpSpawnPlan(this.config, {
      homeDir: app.getPath('home'),
      userDataDir: app.getPath('userData'),
      tempDir: app.getPath('temp'),
      runtimeHomeDir,
      sandboxLauncherPath: process.platform === 'win32'
        ? resolveWindowsSandboxLauncherPath({
            isPackaged: app.isPackaged,
            appPath: app.getAppPath(),
            resourcesPath: process.resourcesPath
          })
        : undefined
    });
    this.spawnedDetached = spawnPlan.detached;
    this.spawnedThroughWindowsLauncher = spawnPlan.isolation === 'windows-appcontainer';
    this.stderrLogBytes = 0;

    console.log(
      `[MCP Client] Starting stdio server '${this.config.name}' with ${spawnPlan.isolation} ` +
      `(command=${path.basename(this.config.command)}, args=${this.config.args?.length || 0}, network=${this.config.permissions?.network === true ? 'allowed' : 'blocked'}).`
    );

    return new Promise((resolve, reject) => {
      let settled = false;
      const safeReject = (err: Error) => {
        if (settled) return;
        settled = true;
        this.lastError = err.message;
        this.cleanup(err);
        reject(err);
      };
      const safeResolve = (val: any) => {
        if (settled) return;
        settled = true;
        resolve(val);
      };

      try {
        this.childProcess = spawn(spawnPlan.command, spawnPlan.args, {
          env: spawnPlan.env,
          cwd: spawnPlan.cwd,
          detached: spawnPlan.detached,
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe']
        });

        this.childProcess.stdout?.on('data', (chunk: Buffer) => {
          this.handleStdoutData(chunk.toString('utf-8'));
        });

        this.childProcess.stderr?.on('data', (chunk: Buffer) => {
          if (this.stderrLogBytes >= MAX_STDERR_LOG_BYTES) return;
          const remaining = MAX_STDERR_LOG_BYTES - this.stderrLogBytes;
          const logged = chunk.subarray(0, remaining);
          this.stderrLogBytes += logged.byteLength;
          console.warn(`[MCP Server (${this.config.name}) stderr]:`, logged.toString('utf-8'));
          if (this.stderrLogBytes >= MAX_STDERR_LOG_BYTES) {
            console.warn(`[MCP Server (${this.config.name}) stderr]: further output suppressed.`);
          }
        });

        this.childProcess.on('error', (err) => {
          console.error(`[MCP Server (${this.config.name}) Process Error]:`, err);
          safeReject(err);
        });

        this.childProcess.on('exit', (code, signal) => {
          console.log(`[MCP Server (${this.config.name}) Exited]: code=${code}, signal=${signal}`);
          if (this.stopping) return;
          const exitError = new Error(
            `MCP Server '${this.config.name}' exited unexpectedly (code=${code}, signal=${signal})`
          );
          this.lastError = exitError.message;
          this.emit('disconnected');
          if (!settled) {
            safeReject(exitError);
          } else {
            this.cleanup(exitError);
          }
        });

        // Start initialization handshake
        this.performHandshake()
          .then(async () => {
            this.isConnected = true;
            // Discover Tools, Resources, and Prompts in parallel
            const [discoveredTools, discoveredResources, discoveredPrompts] = await Promise.all([
              this.fetchTools(),
              this.fetchResources(),
              this.fetchPrompts()
            ]);

            this.tools = discoveredTools;
            this.resources = discoveredResources;
            this.prompts = discoveredPrompts;

            console.log(`[MCP Client] Server '${this.config.name}' initialized. (${this.tools.length} Tools, ${this.resources.length} Resources, ${this.prompts.length} Prompts)`);
            this.emit('connected', { tools: this.tools, resources: this.resources, prompts: this.prompts });
            safeResolve({ tools: this.tools, resources: this.resources, prompts: this.prompts });
          })
          .catch((err) => {
            safeReject(err);
          });
      } catch (err) {
        safeReject(err as Error);
      }
    });
  }

  private async connectHttp(): Promise<{ tools: McpToolDefinition[]; resources: McpResourceDefinition[]; prompts: McpPromptDefinition[] }> {
    if (!this.config.url) {
      throw new Error(`MCP Server '${this.config.name}' requires a 'url' for http transport.`);
    }

    const initRes = await this.sendHttpRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
        resources: { subscribe: true },
        prompts: {},
        ...(this.config.permissions?.sampling === true ? { sampling: {} } : {})
      },
      clientInfo: { name: 'getssh', version: '3.0.0' }
    });

    if (initRes.error) {
      throw new Error(`HTTP MCP initialize error: ${initRes.error.message}`);
    }

    this.isConnected = true;
    const [discoveredTools, discoveredResources, discoveredPrompts] = await Promise.all([
      this.fetchTools(),
      this.fetchResources(),
      this.fetchPrompts()
    ]);

    this.tools = discoveredTools;
    this.resources = discoveredResources;
    this.prompts = discoveredPrompts;

    this.emit('connected', { tools: this.tools, resources: this.resources, prompts: this.prompts });
    return { tools: this.tools, resources: this.resources, prompts: this.prompts };
  }

  private async performHandshake(): Promise<any> {
    const initResult = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        roots: { listChanged: true },
        resources: { subscribe: true },
        prompts: {},
        tools: {},
        ...(this.config.permissions?.sampling === true ? { sampling: {} } : {})
      },
      clientInfo: {
        name: 'getssh-client',
        version: '3.0.0'
      }
    }, 15000);

    // Send initialized notification
    this.sendNotification('notifications/initialized');
    return initResult;
  }

  // ── Tools ─────────────────────────────────────────────────────────────
  public async fetchTools(): Promise<McpToolDefinition[]> {
    try {
      const res = await this.sendRequest('tools/list', {}, 10000);
      if (res && Array.isArray(res.tools)) {
        return normalizeMcpToolDefinitions(res.tools);
      }
      return [];
    } catch (e: any) {
      return [];
    }
  }

  public async callTool(name: string, argumentsObj: any = {}): Promise<McpCallToolResult> {
    if (!this.isConnected && this.config.transport === 'stdio') {
      throw new Error(`MCP Server '${this.config.name}' is not connected.`);
    }

    try {
      const res = await this.sendRequest('tools/call', {
        name,
        arguments: argumentsObj
      }, 60000);

      if (res && res.content) {
        return res as McpCallToolResult;
      }

      return {
        content: [{ type: 'text', text: typeof res === 'string' ? res : JSON.stringify(res, null, 2) }]
      };
    } catch (err: any) {
      return {
        content: [{ type: 'text', text: `[MCP Error]: ${err.message}` }],
        isError: true
      };
    }
  }

  // ── Resources ─────────────────────────────────────────────────────────
  public async fetchResources(): Promise<McpResourceDefinition[]> {
    try {
      const res = await this.sendRequest('resources/list', {}, 10000);
      if (res && Array.isArray(res.resources)) {
        return normalizeMcpResourceDefinitions(res.resources);
      }
      return [];
    } catch (e: any) {
      return [];
    }
  }

  public async readResource(uri: string): Promise<McpResourceReadResult> {
    const res = await this.sendRequest('resources/read', { uri }, 30000);
    return res as McpResourceReadResult;
  }

  // ── Prompts ───────────────────────────────────────────────────────────
  public async fetchPrompts(): Promise<McpPromptDefinition[]> {
    try {
      const res = await this.sendRequest('prompts/list', {}, 10000);
      if (res && Array.isArray(res.prompts)) {
        return normalizeMcpPromptDefinitions(res.prompts);
      }
      return [];
    } catch (e: any) {
      return [];
    }
  }

  public async getPrompt(name: string, args: Record<string, string> = {}): Promise<McpGetPromptResult> {
    const res = await this.sendRequest('prompts/get', { name, arguments: args }, 20000);
    return res as McpGetPromptResult;
  }

  // ── JSON-RPC 2.0 Engine ───────────────────────────────────────────────
  private sendRequest(method: string, params: any = {}, timeoutMs = 15000): Promise<any> {
    if (this.config.transport === 'http' || this.config.transport === 'sse') {
      return this.sendHttpRequest(method, params, timeoutMs);
    }

    return new Promise((resolve, reject) => {
      if (!this.childProcess || !this.childProcess.stdin?.writable) {
        return reject(new Error('Process stdin is not writable'));
      }
      if (this.pendingRequests.size >= MAX_PENDING_REQUESTS) {
        return reject(new Error(`MCP request limit exceeded (${MAX_PENDING_REQUESTS} concurrent requests).`));
      }

      const id = this.nextRequestId++;
      const req: McpJsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      let raw: string;
      try {
        raw = JSON.stringify(req) + '\n';
      } catch {
        reject(new Error(`MCP request could not be serialized: method=${method}`));
        return;
      }
      if (Buffer.byteLength(raw, 'utf8') > MAX_MCP_MESSAGE_BYTES) {
        reject(new Error(`MCP request exceeds ${MAX_MCP_MESSAGE_BYTES} bytes.`));
        return;
      }

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP Request timed out after ${timeoutMs}ms: method=${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this.childProcess.stdin.write(raw, 'utf-8', (err) => {
        if (err) {
          clearTimeout(timer);
          this.pendingRequests.delete(id);
          reject(err);
          this.failProtocol(err);
        }
      });
    });
  }

  public sendResponse(id: string | number, result?: any, error?: { code: number; message: string }) {
    if (this.config.transport !== 'stdio') return;
    const resp: McpJsonRpcResponse = {
      jsonrpc: '2.0',
      id,
      ...(error ? { error } : { result: result ?? {} })
    };
    this.writeStdioMessage(resp);
  }

  private sendNotification(method: string, params: any = {}): void {
    if (this.config.transport !== 'stdio') return;
    this.writeStdioMessage({ jsonrpc: '2.0', method, params });
  }

  private writeStdioMessage(payload: unknown): void {
    const stdin = this.childProcess?.stdin;
    if (!stdin?.writable) return;

    let raw: string;
    try {
      raw = JSON.stringify(payload) + '\n';
    } catch {
      this.failProtocol(new Error('MCP response could not be serialized.'));
      return;
    }
    if (Buffer.byteLength(raw, 'utf8') > MAX_MCP_MESSAGE_BYTES) {
      this.failProtocol(new Error(`MCP response exceeds ${MAX_MCP_MESSAGE_BYTES} bytes.`));
      return;
    }
    stdin.write(raw, 'utf8', (writeError) => {
      if (writeError) this.failProtocol(writeError);
    });
  }

  private async sendHttpRequest(method: string, params: any = {}, timeoutMs = 15000): Promise<any> {
    if (this.httpControllers.size >= MAX_PENDING_REQUESTS) {
      throw new Error(`MCP request limit exceeded (${MAX_PENDING_REQUESTS} concurrent requests).`);
    }
    const controller = new AbortController();
    this.httpControllers.add(controller);
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const id = this.nextRequestId++;
      const requestBody = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params
      });
      if (Buffer.byteLength(requestBody, 'utf8') > MAX_MCP_MESSAGE_BYTES) {
        throw new Error(`MCP request exceeds ${MAX_MCP_MESSAGE_BYTES} bytes.`);
      }

      const response = await fetch(this.config.url!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.headers || {})
        },
        body: requestBody,
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
      }

      const declaredLength = Number(response.headers.get('content-length') || 0);
      if (Number.isFinite(declaredLength) && declaredLength > MAX_MCP_MESSAGE_BYTES) {
        throw new Error(`MCP response exceeds ${MAX_MCP_MESSAGE_BYTES} bytes.`);
      }
      const reader = response.body?.getReader();
      const chunks: Buffer[] = [];
      let received = 0;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (received > MAX_MCP_MESSAGE_BYTES) {
            await reader.cancel();
            throw new Error(`MCP response exceeds ${MAX_MCP_MESSAGE_BYTES} bytes.`);
          }
          chunks.push(Buffer.from(value));
        }
      }
      let json: McpJsonRpcResponse;
      try {
        json = JSON.parse(Buffer.concat(chunks, received).toString('utf8')) as McpJsonRpcResponse;
      } catch {
        throw new Error('MCP HTTP response was not valid JSON.');
      }
      if (!isRecord(json) || json.jsonrpc !== '2.0' || json.id !== id) {
        throw new Error('MCP HTTP response did not match the JSON-RPC request.');
      }
      if (json.error) {
        throw new Error(`MCP RPC Error [${json.error.code}]: ${json.error.message}`);
      }
      return json.result;
    } catch (err: any) {
      throw err;
    } finally {
      clearTimeout(timer);
      this.httpControllers.delete(controller);
    }
  }

  private handleStdoutData(data: string) {
    if (!this.consumeInboundByteBudget(Buffer.byteLength(data, 'utf8'))) return;
    this.stdoutBuffer += data;
    const lines = this.stdoutBuffer.split('\n');
    this.stdoutBuffer = lines.pop() || '';

    if (Buffer.byteLength(this.stdoutBuffer, 'utf8') > MAX_MCP_MESSAGE_BYTES) {
      this.failProtocol(new Error(`MCP stdio message exceeds ${MAX_MCP_MESSAGE_BYTES} bytes.`));
      return;
    }

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (!this.consumeInboundMessageBudget()) return;
      if (Buffer.byteLength(trimmed, 'utf8') > MAX_MCP_MESSAGE_BYTES) {
        this.failProtocol(new Error(`MCP stdio message exceeds ${MAX_MCP_MESSAGE_BYTES} bytes.`));
        return;
      }

      try {
        const msg = JSON.parse(trimmed);
        this.handleMessage(msg);
      } catch {
        console.warn(
          `[MCP Client (${this.config.name})] Rejected invalid JSON-RPC line (${Buffer.byteLength(trimmed, 'utf8')} bytes).`
        );
      }
    }
  }

  private resetInboundWindow(now: number): void {
    if (now - this.inboundWindowStartedAt < 1_000) return;
    this.inboundWindowStartedAt = now;
    this.inboundMessagesInWindow = 0;
    this.inboundBytesInWindow = 0;
  }

  private consumeInboundByteBudget(bytes: number): boolean {
    this.resetInboundWindow(Date.now());
    this.inboundBytesInWindow += bytes;
    if (this.inboundBytesInWindow <= MAX_INBOUND_BYTES_PER_SECOND) return true;
    this.failProtocol(new Error(`MCP inbound data rate exceeds ${MAX_INBOUND_BYTES_PER_SECOND} bytes per second.`));
    return false;
  }

  private consumeInboundMessageBudget(): boolean {
    const now = Date.now();
    this.resetInboundWindow(now);
    this.inboundMessagesInWindow += 1;
    if (this.inboundMessagesInWindow <= MAX_INBOUND_MESSAGES_PER_SECOND) return true;
    this.failProtocol(new Error(`MCP inbound message rate exceeds ${MAX_INBOUND_MESSAGES_PER_SECOND} per second.`));
    return false;
  }

  private handleMessage(msg: unknown) {
    if (!isRecord(msg) || msg.jsonrpc !== '2.0') return;
    const hasId = Object.prototype.hasOwnProperty.call(msg, 'id');
    if (hasId && !isJsonRpcId(msg.id)) return;
    const hasResult = Object.prototype.hasOwnProperty.call(msg, 'result');
    const hasError = Object.prototype.hasOwnProperty.call(msg, 'error');

    // 1. Response to our pending request
    if (hasId && (hasResult || hasError)) {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(msg.id);
        if (hasError) {
          const rpcError = isRecord(msg.error) ? msg.error : {};
          const message = typeof rpcError.message === 'string'
            ? rpcError.message.slice(0, 4_096)
            : `RPC Error code ${String(rpcError.code ?? 'unknown')}`;
          pending.reject(new Error(message));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // 2. Reverse incoming requests from MCP Server (e.g. Sampling & Ping)
    if (hasId && typeof msg.method === 'string' && msg.method.length <= 256) {
      if (msg.method === 'ping') {
        this.sendResponse(msg.id, {});
        return;
      }

      if (msg.method === 'sampling/createMessage') {
        if (this.config.permissions?.sampling !== true) {
          this.sendResponse(msg.id, undefined, {
            code: -32001,
            message: 'Reverse sampling is disabled for this MCP server.'
          });
          return;
        }
        this.emit('sampling/createMessage', {
          id: msg.id,
          params: msg.params as McpSamplingParams,
          respond: (result?: any, error?: any) => this.sendResponse(msg.id, result, error)
        });
        return;
      }

      // Default unrecognized incoming request
      this.sendResponse(msg.id, undefined, { code: -32601, message: `Method not found: ${msg.method}` });
      return;
    }

    // 3. Notifications from Server
    if (typeof msg.method === 'string' && msg.method.length <= 256) {
      this.emit('notification', msg.method, msg.params);
    }
  }

  public terminateWithError(error: Error) {
    this.lastError = error.message;
    this.stopping = true;
    this.cleanup(error);
  }

  public disconnect() {
    this.stopping = true;
    this.lastError = null;
    this.cleanup(new Error('MCP Server disconnected'));
  }

  private cleanup(reason = new Error('MCP Server disconnected')) {
    this.isConnected = false;
    this.isConnecting = false;
    const child = this.childProcess;
    this.childProcess = null;
    const windowsLauncher = this.spawnedThroughWindowsLauncher;
    this.spawnedThroughWindowsLauncher = false;
    const spawnedDetached = this.spawnedDetached;
    const runtimeHomeDir = this.runtimeHomeDir;
    if (child) {
      child.removeAllListeners();
      if (child.exitCode === null && child.signalCode === null) {
        // Keep the runtime directory alive until the sandbox launcher is gone.
        // On Windows this also gives the native launcher time to revoke its ACL
        // lease; on Unix it prevents a stopped client racing a quick reconnect.
        this.runtimeHomeDir = null;
        this.processCleanupPending = true;
        if (windowsLauncher) {
          try { child.stdin?.end(); } catch {}
        } else {
          try {
            if (spawnedDetached && child.pid) process.kill(-child.pid, 'SIGTERM');
            else child.kill('SIGTERM');
          } catch {
            try { child.kill('SIGTERM'); } catch {}
          }
        }
        const forceTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            try {
              if (!windowsLauncher && spawnedDetached && child.pid) process.kill(-child.pid, 'SIGKILL');
              else child.kill(windowsLauncher ? 'SIGTERM' : 'SIGKILL');
            } catch {
              try { child.kill(windowsLauncher ? 'SIGTERM' : 'SIGKILL'); } catch {}
            }
          }
        }, 1_500);
        forceTimer.unref();
        child.once('close', () => {
          clearTimeout(forceTimer);
          this.processCleanupPending = false;
          this.releaseRuntimeHome(runtimeHomeDir);
        });
      }
    }
    this.spawnedDetached = false;

    for (const controller of this.httpControllers) controller.abort();
    this.httpControllers.clear();

    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.pendingRequests.clear();
    this.stdoutBuffer = '';
    this.removeAllListeners();
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      this.releaseRuntimeHome(runtimeHomeDir);
    }
  }

  private failProtocol(error: Error) {
    if (this.stopping) return;
    this.lastError = error.message;
    this.stopping = true;
    this.emit('disconnected', error);
    this.cleanup(error);
  }

  private releaseRuntimeHome(runtimeHomeDir: string | null = this.runtimeHomeDir) {
    if (!runtimeHomeDir) return;
    if (this.runtimeHomeDir === runtimeHomeDir) this.runtimeHomeDir = null;

    const cleanupTimer = setTimeout(() => {
      try { fs.rmSync(runtimeHomeDir, { recursive: true, force: true }); } catch {}
    }, 1_000);
    cleanupTimer.unref();
  }
}
