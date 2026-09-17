import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { PluginManifest } from '../../../../src/types/plugin';
import { resolveWindowsSandboxLauncherPath } from '../../security/WindowsProcessSandbox';
import { createPluginSpawnPlan, type PluginSpawnPlan } from './PluginProcessSandbox';
import {
  PLUGIN_ACTIVATION_TIMEOUT_MS,
  PLUGIN_RPC_TIMEOUT_MS,
  MAX_PLUGIN_EVENT_CHARS,
  assertMessageSize,
  assertSafeIdentifier,
  encodePluginMessage,
  errorMessage,
  PluginJsonLineDecoder,
  type MainToPluginMessage,
  type PluginHostMethod,
  type PluginInvocationKind,
  type PluginRegistrationSnapshot,
  type PluginToMainMessage
} from './pluginProtocol';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface PluginProcessHostOptions {
  pluginId: string;
  pluginDir: string;
  entryPath: string;
  workerPath: string;
  manifest: PluginManifest;
  onHostCall: (method: PluginHostMethod, args: unknown[]) => Promise<unknown>;
  onHostNotify: (method: PluginHostMethod, args: unknown[]) => Promise<void> | void;
  onExit: (code: number) => void;
}

const MAX_PLUGIN_LOG_BYTES = 64 * 1024;
const MAX_PLUGIN_MESSAGES_PER_SECOND = 500;
const MAX_PLUGIN_MESSAGE_BYTES_PER_SECOND = 16 * 1024 * 1024;
const MAX_PLUGIN_OUTBOUND_BUFFER_BYTES = 8 * 1024 * 1024;

export class PluginProcessHost {
  private readonly options: PluginProcessHostOptions;
  private child: ChildProcess | null = null;
  private nextRequestId = 1;
  private pending = new Map<string, PendingRequest>();
  private activationResolve?: (registrations: PluginRegistrationSnapshot) => void;
  private activationReject?: (error: Error) => void;
  private activationTimer?: NodeJS.Timeout;
  private shuttingDown = false;
  private callsInWindow = 0;
  private callWindowStartedAt = Date.now();
  private messagesInWindow = 0;
  private messageBytesInWindow = 0;
  private messageWindowStartedAt = Date.now();
  private inFlightHostCalls = 0;
  private spawnedDetached = false;
  private requiresGracefulLauncherCleanup = false;
  private runtimeHomeDir: string | null = null;
  private logBytes = 0;
  private decoder = new PluginJsonLineDecoder();
  private targetPidIsDirectChild = true;
  private reportedTargetPid: number | undefined;
  private terminationStarted = false;

  constructor(options: PluginProcessHostOptions) {
    assertSafeIdentifier(options.pluginId, 'pluginId');
    this.options = options;
  }

  public get pid(): number | undefined {
    return this.reportedTargetPid ?? this.child?.pid;
  }

  public async start(): Promise<PluginRegistrationSnapshot> {
    if (this.child) {
      throw new Error(`Plugin '${this.options.pluginId}' is already running.`);
    }

    this.shuttingDown = false;
    this.logBytes = 0;
    this.messagesInWindow = 0;
    this.messageBytesInWindow = 0;
    this.messageWindowStartedAt = Date.now();
    this.decoder = new PluginJsonLineDecoder();
    this.reportedTargetPid = undefined;
    this.terminationStarted = false;
    const safePluginId = this.options.pluginId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 96);
    const runtimeHomeDir = fs.mkdtempSync(
      path.join(app.getPath('temp'), `getssh-plugin-${safePluginId}-`)
    );
    this.runtimeHomeDir = runtimeHomeDir;
    try { fs.chmodSync(runtimeHomeDir, 0o700); } catch {}

    let spawnPlan: PluginSpawnPlan;
    try {
      spawnPlan = createPluginSpawnPlan({
        pluginDir: this.options.pluginDir,
        workerPath: this.options.workerPath,
        runtimeHomeDir,
        userDataDir: app.getPath('userData'),
        homeDir: app.getPath('home'),
        tempDir: app.getPath('temp'),
        sandboxLauncherPath: process.platform === 'win32'
          ? resolveWindowsSandboxLauncherPath({
              isPackaged: app.isPackaged,
              appPath: app.getAppPath(),
              resourcesPath: process.resourcesPath
            })
          : undefined
      });
    } catch (error) {
      this.releaseRuntimeHome();
      throw error;
    }
    this.spawnedDetached = spawnPlan.detached;
    this.requiresGracefulLauncherCleanup = spawnPlan.isolation === 'windows-appcontainer';
    this.targetPidIsDirectChild = spawnPlan.targetPidIsDirectChild;

    const child = spawn(spawnPlan.command, spawnPlan.args, {
      cwd: spawnPlan.cwd,
      env: spawnPlan.env,
      detached: spawnPlan.detached,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child = child;

    child.stdout?.on('data', (chunk: Buffer | string) => {
      if (this.child !== child || this.terminationStarted) return;
      try {
        for (const decoded of this.decoder.push(chunk)) {
          this.checkInboundBudget(decoded.bytes);
          void this.handleMessage(decoded.value);
        }
      } catch (error) {
        this.failProtocol(error);
      }
    });
    child.stdout?.once('end', () => {
      if (this.child !== child || this.terminationStarted) return;
      try {
        this.decoder.finish();
      } catch (error) {
        this.failProtocol(error);
      }
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      if (this.logBytes >= MAX_PLUGIN_LOG_BYTES) return;
      const raw = Buffer.from(chunk).subarray(0, MAX_PLUGIN_LOG_BYTES - this.logBytes);
      this.logBytes += raw.byteLength;
      const text = raw.toString().trimEnd();
      if (text) console.warn(`[Plugin ${this.options.pluginId} stderr] ${text}`);
    });
    child.on('error', (error) => {
      if (this.child !== child || this.terminationStarted) return;
      this.rejectActivation(new Error(`Plugin process failed: ${error.message}`));
      this.kill();
    });
    child.on('close', (code, signal) => {
      this.child = null;
      this.terminationStarted = false;
      this.spawnedDetached = false;
      this.requiresGracefulLauncherCleanup = false;
      this.reportedTargetPid = undefined;
      this.releaseRuntimeHome();
      const exitCode = code ?? -1;
      this.failAll(new Error(`Plugin process exited with code ${exitCode}, signal ${signal}.`));
      this.options.onExit(exitCode);
    });

    const activation = new Promise<PluginRegistrationSnapshot>((resolve, reject) => {
      this.activationResolve = resolve;
      this.activationReject = reject;
      this.activationTimer = setTimeout(() => {
        reject(new Error(`Plugin '${this.options.pluginId}' activation timed out.`));
        this.kill();
      }, PLUGIN_ACTIVATION_TIMEOUT_MS);
    });

    child.once('spawn', () => {
      const init: MainToPluginMessage = {
        type: 'getssh:init',
        pluginId: this.options.pluginId,
        displayName: this.options.manifest.displayName || this.options.manifest.name,
        pluginDir: this.options.pluginDir,
        entryPath: this.options.entryPath,
        capabilities: [...(this.options.manifest.getssh?.capabilities || [])]
      };
      this.post(init);
    });

    return activation;
  }

  public async invoke(kind: PluginInvocationKind, handlerId: string, payload: unknown): Promise<unknown> {
    assertSafeIdentifier(handlerId, 'handlerId');
    assertMessageSize(payload);
    const requestId = this.createRequestId('invoke');
    const result = this.waitForResponse(requestId, PLUGIN_RPC_TIMEOUT_MS);
    this.post({ type: 'getssh:invoke', requestId, kind, handlerId, payload });
    return result;
  }

  public sendSshData(subscriptionId: string, chunk: string): void {
    assertSafeIdentifier(subscriptionId, 'subscriptionId');
    for (let offset = 0; offset < chunk.length; offset += MAX_PLUGIN_EVENT_CHARS) {
      this.post({
        type: 'getssh:event',
        event: 'ssh-data',
        subscriptionId,
        payload: chunk.slice(offset, offset + MAX_PLUGIN_EVENT_CHARS)
      });
    }
  }

  public async shutdown(): Promise<void> {
    if (!this.child) return;
    this.shuttingDown = true;
    const requestId = this.createRequestId('shutdown');
    const completion = this.waitForResponse(requestId, 2_000);
    this.post({ type: 'getssh:shutdown', requestId });
    try {
      await completion;
    } finally {
      await this.waitForProcessExit(2_000);
      if (this.child) this.kill();
    }
  }

  public kill(): void {
    const child = this.child;
    if (this.terminationStarted) {
      this.failAll(new Error(`Plugin '${this.options.pluginId}' was stopped.`));
      return;
    }
    this.terminationStarted = true;
    if (child?.pid !== undefined) {
      if (this.requiresGracefulLauncherCleanup) {
        try { child.stdin?.end(); } catch {}
        const forceTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            try { child.kill('SIGTERM'); } catch {}
          }
        }, 1_500);
        forceTimer.unref();
        child.once('close', () => clearTimeout(forceTimer));
      } else {
        try {
          if (this.spawnedDetached) process.kill(-child.pid, 'SIGTERM');
          else child.kill('SIGTERM');
        } catch {
          try { child.kill('SIGTERM'); } catch {}
        }
        const forceTimer = setTimeout(() => {
          if (child.exitCode !== null || child.signalCode !== null) return;
          try {
            if (this.spawnedDetached) process.kill(-child.pid!, 'SIGKILL');
            else child.kill('SIGKILL');
          } catch {
            try { child.kill('SIGKILL'); } catch {}
          }
        }, 1_500);
        forceTimer.unref();
        child.once('close', () => clearTimeout(forceTimer));
      }
    }
    this.reportedTargetPid = undefined;
    if (child?.pid === undefined) {
      this.child = null;
      this.terminationStarted = false;
      this.spawnedDetached = false;
      this.requiresGracefulLauncherCleanup = false;
      this.releaseRuntimeHome();
    }
    this.failAll(new Error(`Plugin '${this.options.pluginId}' was stopped.`));
  }

  private createRequestId(prefix: string): string {
    return `${prefix}:${this.nextRequestId++}`;
  }

  private waitForResponse(requestId: string, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Plugin request '${requestId}' timed out.`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
    });
  }

  private post(message: MainToPluginMessage): void {
    const child = this.child;
    const input = child?.stdin;
    if (!child || this.terminationStarted || !input || input.destroyed || !input.writable) {
      throw new Error(`Plugin '${this.options.pluginId}' is not running.`);
    }
    const encoded = encodePluginMessage(message);
    if (input.writableLength + encoded.byteLength > MAX_PLUGIN_OUTBOUND_BUFFER_BYTES) {
      const error = new Error('Plugin outbound IPC buffer limit exceeded.');
      this.rejectActivation(error);
      this.kill();
      throw error;
    }
    input.write(encoded, (error) => {
      if (!error || this.child !== child) return;
      this.rejectActivation(error);
      this.kill();
    });
  }

  private checkRateLimit(): void {
    const now = Date.now();
    if (now - this.callWindowStartedAt >= 1_000) {
      this.callWindowStartedAt = now;
      this.callsInWindow = 0;
    }
    this.callsInWindow++;
    if (this.callsInWindow > 250) {
      throw new Error('Plugin exceeded the host-call rate limit.');
    }
  }

  private checkInboundBudget(messageBytes: number): void {
    const now = Date.now();
    if (now - this.messageWindowStartedAt >= 1_000) {
      this.messageWindowStartedAt = now;
      this.messagesInWindow = 0;
      this.messageBytesInWindow = 0;
    }
    this.messagesInWindow++;
    this.messageBytesInWindow += messageBytes;
    if (
      this.messagesInWindow > MAX_PLUGIN_MESSAGES_PER_SECOND ||
      this.messageBytesInWindow > MAX_PLUGIN_MESSAGE_BYTES_PER_SECOND
    ) {
      throw new Error('Plugin exceeded the inbound IPC rate limit.');
    }
  }

  private async handleMessage(raw: unknown): Promise<void> {
    try {
      assertMessageSize(raw);
      const message = raw as PluginToMainMessage;
      if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
        throw new Error('Malformed plugin message.');
      }

      switch (message.type) {
        case 'getssh:ready':
          if (!this.isValidTargetPid(message.pid) || this.reportedTargetPid !== undefined) {
            throw new Error('Plugin process sent an invalid ready message.');
          }
          this.reportedTargetPid = message.pid;
          return;
        case 'getssh:activated':
          if (
            !this.activationResolve ||
            !this.isValidTargetPid(message.pid) ||
            message.pid !== this.reportedTargetPid
          ) {
            throw new Error('Plugin process reported an invalid PID.');
          }
          this.resolveActivation(message.registrations);
          return;
        case 'getssh:activation-error':
          if (typeof message.error !== 'string' || message.error.length > 8_192) {
            throw new Error('Plugin process sent an invalid activation error.');
          }
          this.rejectActivation(new Error(message.error));
          this.kill();
          return;
        case 'getssh:host-call': {
          assertSafeIdentifier(message.requestId, 'Host request ID');
          if (typeof message.method !== 'string' || !Array.isArray(message.args)) {
            throw new Error('Plugin process sent a malformed host call.');
          }
          this.checkRateLimit();
          if (this.inFlightHostCalls >= 32) {
            throw new Error('Plugin exceeded the concurrent host-call limit.');
          }
          this.inFlightHostCalls++;
          try {
            const response: MainToPluginMessage = await this.callHost(message);
            this.post(response);
          } finally {
            this.inFlightHostCalls--;
          }
          return;
        }
        case 'getssh:host-notify':
          if (typeof message.method !== 'string' || !Array.isArray(message.args)) {
            throw new Error('Plugin process sent a malformed host notification.');
          }
          this.checkRateLimit();
          if (this.inFlightHostCalls >= 32) {
            throw new Error('Plugin exceeded the concurrent host-call limit.');
          }
          this.inFlightHostCalls++;
          try {
            await this.options.onHostNotify(message.method, message.args);
          } finally {
            this.inFlightHostCalls--;
          }
          return;
        case 'getssh:invoke-response':
          assertSafeIdentifier(message.requestId, 'Invocation response ID');
          if (typeof message.ok !== 'boolean') {
            throw new Error('Plugin process sent a malformed invocation response.');
          }
          this.resolvePending(message.requestId, message.ok, message.result, message.error);
          return;
        case 'getssh:shutdown-complete':
          assertSafeIdentifier(message.requestId, 'Shutdown response ID');
          this.resolvePending(message.requestId, true, undefined);
          return;
        case 'getssh:log':
          if (
            (message.level !== 'info' && message.level !== 'warn' && message.level !== 'error') ||
            typeof message.message !== 'string' ||
            message.message.length > 8_192
          ) {
            throw new Error('Plugin process sent a malformed log message.');
          }
          console[message.level](`[Plugin ${this.options.pluginId}] ${message.message}`);
          return;
        default:
          throw new Error('Unknown plugin protocol message.');
      }
    } catch (error) {
      console.error(`[Plugin ${this.options.pluginId}] Protocol violation:`, errorMessage(error));
      this.rejectActivation(error instanceof Error ? error : new Error(errorMessage(error)));
      this.kill();
    }
  }

  private isValidTargetPid(candidate: unknown): candidate is number {
    if (!Number.isSafeInteger(candidate) || (candidate as number) <= 0) return false;
    if (this.targetPidIsDirectChild) return candidate === this.child?.pid;
    return candidate !== process.pid && candidate !== this.child?.pid;
  }

  private failProtocol(error: unknown): void {
    if (!this.child) return;
    const normalized = error instanceof Error ? error : new Error(errorMessage(error));
    console.error(`[Plugin ${this.options.pluginId}] Protocol violation:`, normalized.message);
    this.rejectActivation(normalized);
    this.kill();
  }

  private waitForProcessExit(timeoutMs: number): Promise<void> {
    const child = this.child;
    if (!child) return Promise.resolve();
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        child.removeListener('exit', onExit);
        resolve();
      }, timeoutMs);
      const onExit = () => {
        clearTimeout(timer);
        resolve();
      };
      child.once('exit', onExit);
    });
  }

  private async callHost(
    message: Extract<PluginToMainMessage, { type: 'getssh:host-call' }>
  ): Promise<MainToPluginMessage> {
    try {
      const result = await this.options.onHostCall(message.method, message.args);
      assertMessageSize(result);
      return { type: 'getssh:host-response', requestId: message.requestId, ok: true, result };
    } catch (error) {
      return {
        type: 'getssh:host-response',
        requestId: message.requestId,
        ok: false,
        error: errorMessage(error)
      };
    }
  }

  private resolvePending(requestId: string, ok: boolean, result?: unknown, error?: string): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    if (ok) pending.resolve(result);
    else pending.reject(new Error(error || 'Plugin request failed.'));
  }

  private resolveActivation(registrations: PluginRegistrationSnapshot): void {
    const resolve = this.activationResolve;
    this.clearActivation();
    resolve?.(registrations);
  }

  private rejectActivation(error: Error): void {
    const reject = this.activationReject;
    this.clearActivation();
    reject?.(error);
  }

  private clearActivation(): void {
    if (this.activationTimer) clearTimeout(this.activationTimer);
    this.activationTimer = undefined;
    this.activationResolve = undefined;
    this.activationReject = undefined;
  }

  private failAll(error: Error): void {
    if (!this.shuttingDown) this.rejectActivation(error);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private releaseRuntimeHome(): void {
    const runtimeHomeDir = this.runtimeHomeDir;
    this.runtimeHomeDir = null;
    if (!runtimeHomeDir) return;
    const timer = setTimeout(() => {
      try { fs.rmSync(runtimeHomeDir, { recursive: true, force: true }); } catch {}
    }, 1_000);
    timer.unref();
  }
}
