import type { PluginSettingsSchema } from '../../../../src/types/plugin';

export const PLUGIN_RPC_TIMEOUT_MS = 15_000;
export const PLUGIN_ACTIVATION_TIMEOUT_MS = 8_000;
export const MAX_PLUGIN_MESSAGE_BYTES = 2 * 1024 * 1024;
export const MAX_PLUGIN_EVENT_CHARS = 256 * 1024;

export type PluginInvocationKind = 'rpc' | 'ui';

export type PluginHostMethod =
  | 'notification.show'
  | 'safeStorage.encrypt'
  | 'storage.get'
  | 'storage.set'
  | 'storage.delete'
  | 'storage.clear'
  | 'ssh.subscribe'
  | 'ssh.unsubscribe'
  | 'ssh.write'
  | 'rpc.sendToFrontend'
  | 'host.notify'
  | 'host.clipboard.writeText'
  | 'host.clipboard.readText'
  | 'host.showMessageBox'
  | 'host.showOpenDialog'
  | 'host.showSaveDialog'
  | 'net.fetch';

export interface PluginUiRegistration {
  handlerId: string;
  actionId: string;
  label: string;
}

export interface PluginRegistrationSnapshot {
  rpcMethods: string[];
  terminalActions: PluginUiRegistration[];
  sftpActions: PluginUiRegistration[];
  settings: PluginSettingsSchema[];
}

export type MainToPluginMessage =
  | {
      type: 'getssh:init';
      pluginId: string;
      displayName: string;
      pluginDir: string;
      entryPath: string;
      capabilities: string[];
    }
  | {
      type: 'getssh:host-response';
      requestId: string;
      ok: boolean;
      result?: unknown;
      error?: string;
    }
  | {
      type: 'getssh:invoke';
      requestId: string;
      kind: PluginInvocationKind;
      handlerId: string;
      payload: unknown;
    }
  | {
      type: 'getssh:event';
      event: 'ssh-data';
      subscriptionId: string;
      payload: string;
    }
  | {
      type: 'getssh:shutdown';
      requestId: string;
    };

export type PluginToMainMessage =
  | { type: 'getssh:ready'; pid: number }
  | {
      type: 'getssh:activated';
      pid: number;
      registrations: PluginRegistrationSnapshot;
    }
  | { type: 'getssh:activation-error'; error: string }
  | {
      type: 'getssh:host-call';
      requestId: string;
      method: PluginHostMethod;
      args: unknown[];
    }
  | {
      type: 'getssh:host-notify';
      method: PluginHostMethod;
      args: unknown[];
    }
  | {
      type: 'getssh:invoke-response';
      requestId: string;
      ok: boolean;
      result?: unknown;
      error?: string;
    }
  | { type: 'getssh:shutdown-complete'; requestId: string }
  | { type: 'getssh:log'; level: 'info' | 'warn' | 'error'; message: string };

export function assertSafeIdentifier(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    throw new Error(`${label} must be a non-empty identifier of at most 128 characters.`);
  }
  if (value === '__proto__' || value === 'prototype' || value === 'constructor') {
    throw new Error(`${label} uses a reserved identifier.`);
  }
}

export function assertStructuredData(
  value: unknown,
  label = 'payload',
  depth = 0,
  seen = new WeakSet<object>()
): void {
  if (depth > 24) {
    throw new Error(`${label} exceeds the maximum nesting depth.`);
  }

  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${label} contains a non-finite number.`);
    }
    return;
  }

  if (typeof value !== 'object') {
    throw new Error(`${label} contains a non-serializable ${typeof value}.`);
  }

  if (seen.has(value)) {
    throw new Error(`${label} contains a circular reference.`);
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      assertStructuredData(value[i], `${label}[${i}]`, depth + 1, seen);
    }
    seen.delete(value);
    return;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} contains a non-plain object.`);
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    assertStructuredData(child, `${label}.${key}`, depth + 1, seen);
  }
  seen.delete(value);
}

export function assertMessageSize(value: unknown): number {
  assertStructuredData(value, 'message');
  const encoded = JSON.stringify(value);
  const bytes = encoded === undefined ? 0 : Buffer.byteLength(encoded, 'utf8');
  if (bytes > MAX_PLUGIN_MESSAGE_BYTES) {
    throw new Error(`Plugin message exceeds ${MAX_PLUGIN_MESSAGE_BYTES} bytes.`);
  }
  return bytes;
}

export function encodePluginMessage(value: MainToPluginMessage | PluginToMainMessage): Buffer {
  assertMessageSize(value);
  return Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
}

export interface DecodedPluginMessage {
  value: unknown;
  bytes: number;
}

/** Bounded newline-delimited JSON decoder shared by both sides of plugin IPC. */
export class PluginJsonLineDecoder {
  private pending = Buffer.alloc(0);
  private readonly textDecoder = new TextDecoder('utf-8', { fatal: true });

  public push(chunk: Buffer | string): DecodedPluginMessage[] {
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
    this.pending = this.pending.length === 0
      ? Buffer.from(incoming)
      : Buffer.concat([this.pending, incoming], this.pending.length + incoming.length);

    const messages: DecodedPluginMessage[] = [];
    let consumed = 0;
    while (true) {
      const newline = this.pending.indexOf(0x0a, consumed);
      if (newline === -1) break;
      const line = this.pending.subarray(consumed, newline);
      consumed = newline + 1;
      if (line.byteLength === 0) throw new Error('Plugin protocol contains an empty line.');
      if (line.byteLength > MAX_PLUGIN_MESSAGE_BYTES) {
        throw new Error(`Plugin message exceeds ${MAX_PLUGIN_MESSAGE_BYTES} bytes.`);
      }
      let decoded: string;
      try {
        decoded = this.textDecoder.decode(line);
      } catch {
        throw new Error('Plugin protocol contains invalid UTF-8.');
      }
      let value: unknown;
      try {
        value = JSON.parse(decoded);
      } catch {
        throw new Error('Plugin protocol contains malformed JSON.');
      }
      assertMessageSize(value);
      messages.push({ value, bytes: line.byteLength });
    }

    if (consumed > 0) this.pending = Buffer.from(this.pending.subarray(consumed));
    if (this.pending.byteLength > MAX_PLUGIN_MESSAGE_BYTES) {
      throw new Error(`Plugin message exceeds ${MAX_PLUGIN_MESSAGE_BYTES} bytes without a delimiter.`);
    }
    return messages;
  }

  public finish(): void {
    if (this.pending.byteLength !== 0) {
      this.pending = Buffer.alloc(0);
      throw new Error('Plugin protocol ended with an incomplete message.');
    }
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
