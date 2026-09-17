import path from 'node:path';
import {
  PLUGIN_RPC_TIMEOUT_MS,
  assertMessageSize,
  assertSafeIdentifier,
  encodePluginMessage,
  errorMessage,
  PluginJsonLineDecoder,
  type MainToPluginMessage,
  type PluginHostMethod,
  type PluginRegistrationSnapshot,
  type PluginToMainMessage,
  type PluginUiRegistration
} from './services/plugin/pluginProtocol';

interface PendingHostCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface SerializedFetchResponse {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  bodyBase64: string;
  url: string;
}

const MAX_PROTOCOL_OUTPUT_BUFFER_BYTES = 8 * 1024 * 1024;
const protocolWrite = process.stdout.write.bind(process.stdout);
// stdout is the authenticated framing channel. Ordinary console output and the
// common process.stdout.write path are moved to stderr so plugin logs cannot be
// mistaken for protocol frames.
Object.defineProperty(process.stdout, 'write', {
  configurable: true,
  value: (...args: unknown[]) => Reflect.apply(process.stderr.write, process.stderr, args)
});
console.log = (...args: unknown[]) => console.error(...args);
console.info = (...args: unknown[]) => console.error(...args);
console.warn = (...args: unknown[]) => console.error(...args);

let initialized = false;
let activated = false;
let pluginModule: { activate?: (context: unknown) => unknown; deactivate?: () => unknown } | null = null;
let nextHostRequestId = 1;
let nextHandlerId = 1;
let nextSubscriptionId = 1;
const pendingHostCalls = new Map<string, PendingHostCall>();
const rpcHandlers = new Map<string, (payload: unknown) => unknown>();
const uiHandlers = new Map<string, (payload: unknown) => unknown>();
const sshSubscriptions = new Map<string, (chunk: string) => void>();
const terminalActions: PluginUiRegistration[] = [];
const sftpActions: PluginUiRegistration[] = [];
let settings: PluginRegistrationSnapshot['settings'] | null = null;

function post(message: PluginToMainMessage): void {
  const encoded = encodePluginMessage(message);
  if (process.stdout.writableLength + encoded.byteLength > MAX_PROTOCOL_OUTPUT_BUFFER_BYTES) {
    throw new Error('Plugin protocol output buffer limit exceeded.');
  }
  protocolWrite(encoded);
}

function notifyHost(method: PluginHostMethod, args: unknown[]): void {
  assertMessageSize(args);
  post({ type: 'getssh:host-notify', method, args });
}

function callHost(method: PluginHostMethod, args: unknown[]): Promise<unknown> {
  assertMessageSize(args);
  const requestId = `host:${nextHostRequestId++}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingHostCalls.delete(requestId);
      reject(new Error(`Host call '${method}' timed out.`));
    }, PLUGIN_RPC_TIMEOUT_MS);
    pendingHostCalls.set(requestId, { resolve, reject, timer });
    post({ type: 'getssh:host-call', requestId, method, args });
  });
}

function normalizeHeaders(headers?: HeadersInit): Array<[string, string]> {
  return headers ? Array.from(new Headers(headers).entries()) : [];
}

function serializeRequestBody(body: BodyInit | null | undefined): { bodyText?: string; bodyBase64?: string } {
  if (body === null || body === undefined) return {};
  if (typeof body === 'string') return { bodyText: body };
  if (body instanceof URLSearchParams) return { bodyText: body.toString() };
  if (body instanceof ArrayBuffer) {
    return { bodyBase64: Buffer.from(body).toString('base64') };
  }
  if (ArrayBuffer.isView(body)) {
    return {
      bodyBase64: Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString('base64')
    };
  }
  throw new Error('Plugin fetch only supports string, URLSearchParams, ArrayBuffer, or typed-array bodies.');
}

function serializeFetchOptions(options: RequestInit = {}): Record<string, unknown> {
  if (options.signal) {
    throw new Error('AbortSignal cannot cross the plugin process boundary.');
  }
  return {
    method: options.method,
    headers: normalizeHeaders(options.headers),
    redirect: options.redirect,
    ...serializeRequestBody(options.body)
  };
}

function createPluginContext(capabilities: string[]) {
  const caps = new Set(capabilities);
  const context: Record<string, unknown> = Object.create(null);

  context.showNotification = (title: string, body: string) => {
    notifyHost('notification.show', [title, body]);
  };
  context.safeStorageEncrypt = async (text: string) => callHost('safeStorage.encrypt', [text]);

  if (caps.has('ssh:read') || caps.has('ssh:write')) {
    context.ssh = Object.freeze({
      onData: (sessionId: string, callback: (chunk: string) => void) => {
        if (!caps.has('ssh:read')) throw new Error('SecurityError: Missing ssh:read capability.');
        if (typeof callback !== 'function') throw new Error('ssh.onData requires a callback.');
        const subscriptionId = `ssh:${nextSubscriptionId++}`;
        sshSubscriptions.set(subscriptionId, callback);
        notifyHost('ssh.subscribe', [subscriptionId, sessionId]);
        return () => {
          if (!sshSubscriptions.delete(subscriptionId)) return;
          notifyHost('ssh.unsubscribe', [subscriptionId]);
        };
      },
      write: async (sessionId: string, command: string) => {
        if (!caps.has('ssh:write')) throw new Error('SecurityError: Missing ssh:write capability.');
        await callHost('ssh.write', [sessionId, command]);
      }
    });
  }

  context.storage = Object.freeze({
    get: (key: string) => callHost('storage.get', [key]),
    set: (key: string, value: unknown) => callHost('storage.set', [key, value]).then(() => undefined),
    delete: (key: string) => callHost('storage.delete', [key]).then(() => undefined),
    clear: () => callHost('storage.clear', []).then(() => undefined)
  });

  context.rpc = Object.freeze({
    registerMethod: (method: string, handler: (payload: unknown) => unknown) => {
      assertSafeIdentifier(method, 'RPC method');
      if (typeof handler !== 'function') throw new Error('RPC handler must be a function.');
      rpcHandlers.set(method, handler);
    },
    sendToFrontend: (payload: unknown) => notifyHost('rpc.sendToFrontend', [payload])
  });

  context.ui = Object.freeze({
    registerTerminalContextMenu: (actionId: string, label: string, handler: (payload: unknown) => unknown) => {
      assertSafeIdentifier(actionId, 'Terminal action ID');
      if (typeof label !== 'string' || !label.trim()) throw new Error('Terminal action label is required.');
      if (typeof handler !== 'function') throw new Error('Terminal action handler must be a function.');
      const handlerId = `ui:${nextHandlerId++}`;
      uiHandlers.set(handlerId, handler);
      terminalActions.push({ handlerId, actionId, label });
    },
    registerSFTPContextMenu: (actionId: string, label: string, handler: (payload: unknown) => unknown) => {
      assertSafeIdentifier(actionId, 'SFTP action ID');
      if (typeof label !== 'string' || !label.trim()) throw new Error('SFTP action label is required.');
      if (typeof handler !== 'function') throw new Error('SFTP action handler must be a function.');
      const handlerId = `ui:${nextHandlerId++}`;
      uiHandlers.set(handlerId, handler);
      sftpActions.push({ handlerId, actionId, label });
    },
    registerSettings: (schema: PluginRegistrationSnapshot['settings']) => {
      if (!Array.isArray(schema) || schema.length === 0) {
        throw new Error('Plugins must register at least one valid setting.');
      }
      assertMessageSize(schema);
      settings = structuredClone(schema);
    }
  });

  context.host = Object.freeze({
    notify: (title: string, body: string, type: 'info' | 'warning' | 'error' = 'info') => {
      notifyHost('host.notify', [title, body, type]);
    },
    clipboard: Object.freeze({
      writeText: (text: string) => callHost('host.clipboard.writeText', [text]).then(() => undefined),
      readText: () => callHost('host.clipboard.readText', []) as Promise<string>
    }),
    showMessageBox: (options: unknown) => callHost('host.showMessageBox', [options]),
    showOpenDialog: (options: unknown) => callHost('host.showOpenDialog', [options]),
    showSaveDialog: (options: unknown) => callHost('host.showSaveDialog', [options])
  });

  if (caps.has('net:fetch')) {
    context.net = Object.freeze({
      fetch: async (url: string, options?: RequestInit) => {
        const raw = await callHost('net.fetch', [url, serializeFetchOptions(options)]);
        const response = raw as SerializedFetchResponse;
        return new Response(Buffer.from(response.bodyBase64, 'base64'), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      }
    });
  }

  return Object.freeze(context);
}

async function initialize(message: Extract<MainToPluginMessage, { type: 'getssh:init' }>): Promise<void> {
  if (initialized) throw new Error('Plugin host has already been initialized.');
  initialized = true;
  assertSafeIdentifier(message.pluginId, 'pluginId');

  const pluginDir = path.resolve(message.pluginDir);
  const entryPath = path.resolve(message.entryPath);
  if (entryPath !== pluginDir && !entryPath.startsWith(`${pluginDir}${path.sep}`)) {
    throw new Error('Plugin entry path escapes its installation directory.');
  }

  const resolved = require.resolve(entryPath);
  delete require.cache[resolved];
  pluginModule = require(resolved);
  if (typeof pluginModule?.activate !== 'function' || typeof pluginModule?.deactivate !== 'function') {
    throw new Error('Backend plugins must export activate() and deactivate().');
  }

  await pluginModule.activate(createPluginContext(message.capabilities));
  if (!settings) {
    throw new Error('Backend plugins must call context.ui.registerSettings() during activation.');
  }

  post({
    type: 'getssh:activated',
    pid: process.pid,
    registrations: {
      rpcMethods: [...rpcHandlers.keys()],
      terminalActions,
      sftpActions,
      settings
    }
  });
  activated = true;
}

async function invoke(message: Extract<MainToPluginMessage, { type: 'getssh:invoke' }>): Promise<void> {
  try {
    const handler = message.kind === 'rpc'
      ? rpcHandlers.get(message.handlerId)
      : uiHandlers.get(message.handlerId);
    if (!handler) throw new Error(`Plugin handler '${message.handlerId}' is not registered.`);
    const result = await handler(message.payload);
    assertMessageSize(result);
    post({ type: 'getssh:invoke-response', requestId: message.requestId, ok: true, result });
  } catch (error) {
    post({
      type: 'getssh:invoke-response',
      requestId: message.requestId,
      ok: false,
      error: errorMessage(error)
    });
  }
}

async function shutdown(requestId: string): Promise<void> {
  try {
    await pluginModule?.deactivate?.();
  } catch (error) {
    post({ type: 'getssh:log', level: 'warn', message: `deactivate() failed: ${errorMessage(error)}` });
  } finally {
    for (const subscriptionId of sshSubscriptions.keys()) {
      notifyHost('ssh.unsubscribe', [subscriptionId]);
    }
    sshSubscriptions.clear();
    rpcHandlers.clear();
    uiHandlers.clear();
    post({ type: 'getssh:shutdown-complete', requestId });
    setImmediate(() => process.exit(0));
  }
}

function handleParentMessage(raw: unknown): void {
  void (async () => {
    try {
      assertMessageSize(raw);
      const message = raw as MainToPluginMessage;
      switch (message.type) {
        case 'getssh:init':
          await initialize(message);
          return;
        case 'getssh:host-response': {
          const pending = pendingHostCalls.get(message.requestId);
          if (!pending) return;
          pendingHostCalls.delete(message.requestId);
          clearTimeout(pending.timer);
          if (message.ok) pending.resolve(message.result);
          else pending.reject(new Error(message.error || 'Host call failed.'));
          return;
        }
        case 'getssh:invoke':
          await invoke(message);
          return;
        case 'getssh:event': {
          if (message.event !== 'ssh-data') return;
          sshSubscriptions.get(message.subscriptionId)?.(message.payload);
          return;
        }
        case 'getssh:shutdown':
          await shutdown(message.requestId);
          return;
        default:
          throw new Error('Unknown host protocol message.');
      }
    } catch (error) {
      if (!activated) {
        post({ type: 'getssh:activation-error', error: errorMessage(error) });
        setImmediate(() => process.exit(1));
      } else {
        post({ type: 'getssh:log', level: 'error', message: errorMessage(error) });
      }
    }
  })();
}

const parentDecoder = new PluginJsonLineDecoder();
process.stdin.on('data', (chunk: Buffer | string) => {
  try {
    for (const decoded of parentDecoder.push(chunk)) handleParentMessage(decoded.value);
  } catch (error) {
    try {
      post(activated
        ? { type: 'getssh:log', level: 'error', message: errorMessage(error) }
        : { type: 'getssh:activation-error', error: errorMessage(error) });
    } finally {
      setImmediate(() => process.exit(70));
    }
  }
});
process.stdin.once('end', () => {
  try { parentDecoder.finish(); } catch {}
  process.exit(0);
});
process.stdin.once('error', () => process.exit(70));
process.stdin.resume();

post({ type: 'getssh:ready', pid: process.pid });
