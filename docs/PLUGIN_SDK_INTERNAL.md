# GETSSH 3.0 Plugin SDK Guide

[中文](./PLUGIN_SDK_INTERNAL_CN.md) | English

> Applies to the GETSSH `3.0.0-F0A0G-PREVIEW` plugin runtime. This guide follows the current implementation and replaces the former VM-sandbox SDK documentation.

The GETSSH 3.0 SDK is a host-injected capability API, not an npm package. Backend code receives a `context` object through `activate(context)`. Plugin pages communicate with the host through `window.GETSSH`.

## 1. Choose a plugin shape

| Shape | Manifest | Runtime | Typical use |
|---|---|---|---|
| UI-only | `getssh.type: "sandbox"` | `iframe sandbox="allow-scripts"` | Panels, dashboards, read-only tools |
| Backend-only | Omit `getssh.type` | Separate OS-confined process | Storage, SSH extensions, network requests, native dialogs |
| UI + backend | Omit `getssh.type`; provide `main`, `renderer`, and HTML | UI iframe plus backend process | Interactive plugins that need controlled host capabilities |

Do not use `"type": "hybrid"`. V3 recognizes only `"sandbox"`; any plugin with a backend must omit `getssh.type`.

UI-only plugins continue to work in safe mode. Backend execution follows the user's selected policy:

| Mode | Backend behavior |
|---|---|
| `safe` | No plugin backend code runs |
| `normal` | Each backend runs in a separate OS-confined process |
| `strict` | Currently uses the same OS boundary as `normal`; the name remains for future compatibility policy |
| `developer` | Loads the plugin directly into the Electron main process as fully trusted code |

GETSSH uses Seatbelt on macOS and its AppContainer launcher on Windows. In isolated modes, plugins cannot directly access host-private files, write to host directories, use the network, spawn subprocesses, or create Workers. Use the APIs documented below for host operations.

## 2. Manifest: `package.json`

Every plugin needs a `package.json` at its root. This is a complete UI + backend example:

```json
{
  "name": "hello-getssh",
  "version": "1.0.0",
  "displayName": "Hello GETSSH",
  "description": "A GETSSH 3.0 plugin example",
  "author": "Your Name",
  "main": "main.js",
  "renderer": "renderer.js",
  "getssh": {
    "pluginId": "com.example.hello-getssh",
    "capabilities": ["lifecycle", "storage:default"]
  }
}
```

### Fields

| Field | Required | Current meaning |
|---|---|---|
| `name` | Yes | **V3 runtime identity**, installation directory, backend RPC binding, and `getssh-plugin://` hostname |
| `version` | Yes | Plugin version; semantic versioning is recommended |
| `main` | Yes | HTML for a UI-only plugin; CommonJS JavaScript entry for a backend plugin |
| `displayName` | Recommended | Friendly display name |
| `description` | Recommended | Short plugin description |
| `author` | Recommended | Author information |
| `renderer` | For host UI integration | Bootstrap script run in a hidden UI sandbox to register sidebar actions and panels |
| `getssh.type` | UI-only plugins | The only valid value is `"sandbox"`; it makes GETSSH skip backend loading completely |
| `getssh.capabilities` | Backend plugins | Capability declarations; must contain `"lifecycle"` |
| `getssh.name` | Optional | Display name with priority over `displayName` |
| `getssh.pluginId` | Optional | Compatibility and marketplace metadata; **not part of current runtime identity binding** |

Use `name` in panel URLs, RPC routing, and storage identity. Do not use `getssh.pluginId` for those operations. Public plugins should use a lowercase, cross-platform-safe name containing letters, digits, and hyphens, such as `server-health`.

### Supported capabilities

| Capability | Effect |
|---|---|
| `lifecycle` | Mandatory for every backend; confirms a `deactivate()` export |
| `storage:default` | Explicit default storage tier; omission also gives 5 MiB |
| `storage:extended` | Raises plugin KV storage to 500 MiB |
| `storage:unlimited` | Removes the plugin KV storage quota |
| `ssh:read` | Subscribes to terminal output for a specified SSH session |
| `ssh:write` | Writes to a specified SSH session; the first write requires user approval |
| `host:clipboard` | Reads and writes the system clipboard; reads notify the user |
| `net:fetch` | Makes public HTTP/HTTPS requests through the SSRF-protected gateway |

A capability unlocks only its corresponding host API. It does not grant arbitrary Electron, Node.js, or operating-system access.

## 3. Supported layouts

### UI-only

```text
hello-ui/
├── package.json
├── renderer.js
├── index.html
└── ui.js
```

```json
{
  "name": "hello-ui",
  "version": "1.0.0",
  "displayName": "Hello UI",
  "description": "A UI-only plugin",
  "main": "index.html",
  "renderer": "renderer.js",
  "getssh": { "type": "sandbox" }
}
```

`main` points to HTML and is never executed as Node.js. Third-party UI plugins should provide `renderer.js` so GETSSH can register an entry point for their panel.

### Backend-only

```text
hello-backend/
├── package.json
└── main.js
```

```json
{
  "name": "hello-backend",
  "version": "1.0.0",
  "displayName": "Hello Backend",
  "description": "A backend-only plugin",
  "main": "main.js",
  "getssh": {
    "capabilities": ["lifecycle", "storage:default"]
  }
}
```

### UI + backend

```text
hello-getssh/
├── package.json
├── main.js
├── renderer.js
├── index.html
└── ui.js
```

Use the full manifest from section 2. `renderer.js` registers the UI, `index.html` is the visible page, and `main.js` registers backend methods.

## 4. Build a UI + backend plugin

### `renderer.js`: register the UI

The renderer bootstrap runs in a hidden sandboxed iframe. Use it only for host UI registration; backend RPC is not available there.

```javascript
const panelId = 'hello-getssh.main';
const actionId = 'open-hello-panel';

window.GETSSH.registerPanel(
  panelId,
  'Hello GETSSH',
  'getssh-plugin://hello-getssh/index.html'
);

window.__sidebarHandlers[actionId] = () => {
  window.GETSSH.openPanel(panelId);
};

window.GETSSH.registerSidebarAction(
  actionId,
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/></svg>',
  'Open Hello plugin'
);
```

The `hello-getssh` URL hostname must exactly match the manifest `name`. Relative JavaScript, CSS, JSON, and common image assets are served from the same plugin package.

### `main.js`: register backend behavior

The backend entry must be CommonJS and export both lifecycle functions.

```javascript
let unsubscribe = null;

module.exports = {
  async activate(context) {
    context.ui.registerSettings([
      {
        id: 'greeting',
        type: 'string',
        label: 'Greeting',
        default: 'Hello from GETSSH'
      }
    ]);

    context.rpc.registerMethod('greet', async (payload) => {
      const configured = await context.storage.get('greeting');
      const greeting = configured ?? 'Hello from GETSSH';
      return { message: `${greeting}, ${payload?.name || 'developer'}!` };
    });

    context.ui.registerTerminalContextMenu(
      'remember-selection',
      'Remember selected text',
      async ({ selectionText }) => {
        await context.storage.set('lastSelection', selectionText);
        context.host.notify('Hello GETSSH', 'The selection was saved');
      }
    );
  },

  async deactivate() {
    unsubscribe?.();
    unsubscribe = null;
  }
};
```

### `index.html` and `ui.js`: call the backend

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Hello GETSSH</title>
</head>
<body>
  <input id="name" value="GETSSH">
  <button id="run">Call backend</button>
  <pre id="output"></pre>
  <script src="./ui.js"></script>
</body>
</html>
```

```javascript
const output = document.querySelector('#output');

document.querySelector('#run').addEventListener('click', async () => {
  try {
    const result = await window.GETSSH.invokeBackend('greet', {
      name: document.querySelector('#name').value
    });
    output.textContent = result.message;
  } catch (error) {
    output.textContent = error instanceof Error ? error.message : String(error);
  }
});

window.GETSSH.onBackendMessage((payload) => console.log('backend event:', payload));
window.GETSSH.onThemeChange((theme) => {
  document.documentElement.dataset.theme = theme;
});
```

`invokeBackend()` rejects when safe mode disables the backend, activation fails, or the method does not exist. Always handle that error.

## 5. Backend lifecycle contract

```typescript
interface PluginModule {
  activate(context: MainContextAPI): void | Promise<void>;
  deactivate(): void | Promise<void>;
}
```

- `activate()` has an 8-second timeout.
- Register RPC methods, terminal actions, SFTP actions, and the settings schema before `activate()` resolves. The isolated runtime sends one registration snapshot at the end of activation; late registrations do not reach the host.
- Every backend currently must call `context.ui.registerSettings()` with at least one valid field. If the plugin has no tuning options, expose a meaningful boolean such as `enabled`.
- `deactivate()` should close timers, streams, listeners, and subscriptions. Keep cleanup below roughly two seconds because GETSSH will terminate an unresponsive process.
- Threat mitigation can force-kill a plugin without completing `deactivate()`. Persist important state as it changes.
- Use `console.log/info/warn/error` for logs. Stdout is the isolated process protocol channel; do not replace `process.stdout` or write custom protocol frames.

The entry is loaded with `require()`. Compile TypeScript or ESM source to CommonJS before packaging.

## 6. Backend API: `context`

Boundary values use this data model:

```typescript
type StructuredData =
  | null
  | string
  | boolean
  | number
  | StructuredData[]
  | { [key: string]: StructuredData };
```

### Notifications and OS encryption

```typescript
interface MainContextAPI {
  showNotification(title: string, body: string): void;
  safeStorageEncrypt(text: string): Promise<string>;
  host: {
    notify(
      title: string,
      body: string,
      type?: 'info' | 'warning' | 'error'
    ): void;
  };
}
```

`showNotification()` is a compatibility alias; new plugins should use `host.notify()`. Notification appearance is controlled by the operating system.

`safeStorageEncrypt()` returns base64 ciphertext and must be awaited. The current plugin SDK exposes no matching decrypt operation, so it is not a complete plugin secret vault.

### Plugin KV storage

```typescript
interface PluginStorageAPI {
  get(key: string): Promise<StructuredData | undefined>;
  set(key: string, value: StructuredData): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}
```

Storage is bound to the manifest `name`. Keys are limited to 256 characters. The default quota is 5 MiB, `storage:extended` provides 500 MiB, and `storage:unlimited` removes the quota.

Use JSON-style values: `null`, strings, booleans, finite numbers, arrays, and plain objects. Do not pass functions, symbols, BigInt, Date, Map, Set, Buffer, class instances, circular references, or `undefined`.

### Frontend/backend RPC

```typescript
interface PluginRpcAPI {
  registerMethod(
    method: string,
    handler: (payload: StructuredData | undefined) =>
      StructuredData | undefined | Promise<StructuredData | undefined>
  ): void;
  sendToFrontend(payload: StructuredData): void;
}
```

Method names may contain letters, digits, `.`, `_`, `:`, and `-`; length is 1-128. `__proto__`, `prototype`, and `constructor` are reserved.

```javascript
context.rpc.registerMethod('server:list', async ({ group }) => ({
  group,
  items: await context.storage.get(`group:${group}`) ?? []
}));

context.rpc.sendToFrontend({ type: 'sync-complete', count: 12 });
```

Payloads and results must be structured data, no larger than 2 MiB after encoding and no deeper than 24 levels. Calls time out after 15 seconds. Paginate large results.

### Settings schema

```typescript
interface PluginSettingsField {
  id: string;
  type: 'string' | 'number' | 'boolean' | 'password';
  label: string;
  description?: string;
  default?: StructuredData;
}

interface PluginSettingsAPI {
  registerSettings(fields: PluginSettingsField[]): void;
}
```

- Every backend must register 1-256 fields.
- IDs follow the safe identifier rule and must be unique.
- Labels contain 1-256 characters; descriptions are limited to 4096.
- GETSSH stores each saved value under its field ID and reloads the plugin.
- Read a setting with `await context.storage.get(field.id)`.
- `password` masks the input control; it does not add a separate encryption guarantee.

### Terminal and SFTP context menus

```typescript
interface PluginContextMenuAPI {
  registerTerminalContextMenu(
    actionId: string,
    label: string,
    handler: (data: {
      sessionId: string;
      selectionText: string;
    }) => unknown | Promise<unknown>
  ): void;
  registerSFTPContextMenu(
    actionId: string,
    label: string,
    handler: (data: {
      sessionId: string;
      currentPath: string;
      selectedFiles: string[];
    }) => unknown | Promise<unknown>
  ): void;
}
```

Action IDs follow the safe identifier rule, labels contain 1-256 characters, and each menu type accepts at most 128 registrations.

### SSH

```typescript
interface PluginSshAPI {
  onData(sessionId: string, callback: (chunk: string) => void): () => void;
  write(sessionId: string, command: string): Promise<void>;
}
```

- `ssh:read` unlocks `onData()`; `ssh:write` unlocks `write()`.
- Plugin pages do not receive raw session IDs. A backend normally gets one from a terminal or SFTP context-menu event.
- Save and call the unsubscribe function returned by `onData()`.
- `write()` accepts up to about 1 MiB per call. On first use, the user can deny, allow once, or allow for the current run.

### Clipboard and native dialogs

```typescript
interface PluginHostAPI {
  clipboard: {
    writeText(text: string): Promise<void>;
    readText(): Promise<string>;
  };
  showMessageBox(options: {
    type?: 'none' | 'info' | 'warning' | 'error' | 'question';
    buttons?: string[];
    defaultId?: number;
    cancelId?: number;
    title?: string;
    message: string;
    detail?: string;
    checkboxLabel?: string;
  }): Promise<{ response: number; checkboxChecked: boolean }>;
  showOpenDialog(options: {
    title?: string;
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
    properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles'>;
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
  showSaveDialog(options: {
    title?: string;
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<{ canceled: boolean; filePath?: string }>;
}
```

Clipboard operations require `host:clipboard`; dialogs need no extra capability. A file dialog returns path strings only. In normal and strict modes it does not grant the plugin direct `fs` access to those host files.

### Public network requests

Declare `net:fetch`, then use the host gateway:

```javascript
const response = await context.net.fetch('https://api.example.com/v1/status', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ source: 'getssh' }),
  redirect: 'follow'
});

if (!response.ok) throw new Error(`HTTP ${response.status}`);
const data = await response.json();
```

The gateway:

- allows only HTTP and HTTPS URLs up to 8192 characters;
- rejects embedded URL credentials and any DNS result in loopback, private, link-local, reserved, or multicast ranges;
- follows at most five redirects and strips `authorization` and `cookie` on cross-origin redirects;
- times out after 30 seconds and limits response bodies to 1 MiB;
- accepts at most 128 headers and controls connection-level headers itself;
- supports `method`, `headers`, `body`, and `redirect` options;
- accepts string, URLSearchParams, ArrayBuffer, and typed-array bodies in isolated mode; use strings for developer-mode portability;
- does not support AbortSignal, FormData, Blob, streaming request bodies, or raw sockets.

A network policy violation raises `SecurityError`, activates the security center, and stops the plugin. Ordinary request failures reject with `NetworkError`.

## 7. Frontend API: `window.GETSSH`

GETSSH must load a page through `getssh-plugin://<name>/<file>` for the SDK to exist. Opening the HTML directly in a browser or from disk does not inject `window.GETSSH`.

| API | `renderer.js` bootstrap | Visible HTML panel |
|---|---:|---:|
| `registerSidebarAction` | Yes | Yes |
| `registerPanel` / `openPanel` | Yes | Yes |
| `showNotification` | Yes | Yes |
| `getLocale` / `onThemeChange` | Yes | Yes |
| `invokeBackend` / `onBackendMessage` | No | Yes |

### Sidebar actions

```typescript
interface RendererContextAPI {
  registerSidebarAction(id: string, svgIcon: string, label: string): void;
}
```

GETSSH sanitizes the SVG. Store the click callback in `window.__sidebarHandlers` under the same ID:

```javascript
window.__sidebarHandlers.open = () => window.GETSSH.openPanel('server-dashboard.main');
window.GETSSH.registerSidebarAction('open', svg, 'Open dashboard');
```

### Panels

```typescript
interface RendererContextAPI {
  registerPanel(panelId: string, title: string, renderUrl: string): void;
  openPanel(panelId: string): void;
}
```

Register before opening and use a package-local URL. The current panel registry uses `panelId` as a global key, so prefix it with the plugin name:

```javascript
window.GETSSH.registerPanel(
  'server-dashboard.main',
  'Server Dashboard',
  'getssh-plugin://server-dashboard/index.html'
);
```

### Environment and notifications

```typescript
interface RendererContextAPI {
  showNotification(title: string, body: string): void;
  getLocale(): string;
  onThemeChange(
    callback: (theme: 'dark' | 'light' | 'system') => void
  ): void;
}
```

Frontend notifications depend on OS notification permission. `getLocale()` returns the current snapshot and updates after a host language change. `onThemeChange()` currently has no unsubscribe return value, so register a callback once per page.

### Backend communication

```typescript
interface RendererContextAPI {
  invokeBackend(
    method: string,
    payload?: StructuredData
  ): Promise<StructuredData | undefined>;
  onBackendMessage(callback: (payload: StructuredData) => void): void;
}
```

RPC is bound to the manifest `name` taken from the current panel URL. A page cannot select another plugin ID and call across plugin boundaries. `onBackendMessage()` receives values sent by `context.rpc.sendToFrontend()` and is released when the iframe is destroyed.

### System-monitor compatibility event

Active plugin panels currently receive a `sysmon:data` message about once per second:

```javascript
window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  if (event.data?.type !== 'sysmon:data') return;
  const { cpus, mem, net } = event.data.payload;
});
```

`cpus` contains `overall` and `cores`; `mem` contains byte counts for `total`, `used`, and `free`; `net` contains `rx` and `tx`. This is a host event rather than a `window.GETSSH` method.

## 8. Limits

| Item | Current limit |
|---|---:|
| Process protocol message | 2 MiB |
| Structured-data depth | 24 levels |
| RPC/host-call timeout | 15 seconds |
| Activation timeout | 8 seconds |
| RPC methods | 128 |
| Terminal actions | 128 |
| SFTP actions | 128 |
| Settings fields | 1-256 |
| Host calls from one isolated plugin | 250/second |
| Isolated protocol traffic | 500 messages/second and 16 MiB/second |
| Collected backend logs | 64 KiB per run |

Throttle polling, logs, and event delivery. Paginate large results.

## 9. Node.js rules in isolated modes

Backend plugins are JavaScript processes and may load CommonJS modules bundled inside their package, but the OS sandbox is the authority:

- the plugin directory is read-only;
- GETSSH provides a random private temporary HOME for temporary writes and removes it when the process exits;
- host home, GETSSH user data, system temporary roots, and mounted volumes are not directly accessible;
- direct networking is disabled; use `context.net.fetch()`;
- subprocesses, Workers, cross-process signals, debugging, and native addons are not portable plugin capabilities;
- only a small environment-variable allowlist is inherited.

Bundle business logic as pure JavaScript and keep host interaction behind `context`. Do not build production plugins around direct file, network, subprocess, Electron, or other access that happens to work in developer mode.

Normal and strict mode require the platform isolation backend: Seatbelt on macOS or the bundled AppContainer launcher on Windows. If that backend is unavailable, GETSSH refuses to start backend plugins. UI-only plugins are unaffected.

## 10. Dependencies, packaging, and installation

GETSSH does not run `npm install` during installation. Include every runtime JavaScript, CSS, image, and dependency in the archive. Bundling backend dependencies into one CommonJS file and frontend dependencies into static browser assets is recommended.

A ZIP may contain plugin files at its root or inside exactly one top-level directory:

```text
hello-getssh.zip
├── package.json
├── main.js
├── renderer.js
├── index.html
└── ui.js
```

macOS:

```bash
cd hello-getssh
zip -r ../hello-getssh.zip . -x '*.DS_Store'
```

Windows PowerShell:

```powershell
Compress-Archive -Path .\hello-getssh\* -DestinationPath .\hello-getssh.zip -Force
```

Open **Settings → Plugins**, drop the ZIP into the installer, review its permissions, and install it. A package with the same `name` replaces the existing plugin directory.

Internal TypeScript interfaces live in [`apps/getssh-client/src/types/plugin.d.ts`](../apps/getssh-client/src/types/plugin.d.ts). Third-party plugins should use the signatures in this guide as the authoritative reference.

## 11. Migrating from the old SDK

| Old SDK assumption | V3 behavior |
|---|---|
| Backend uses `vm.Script` in the main process | Normal/strict use a separate OS-confined process |
| `getssh.type: "hybrid"` | Omit `getssh.type`; combine `renderer` with backend `main` |
| `getssh.pluginId` is runtime identity | `name` is runtime identity; `pluginId` is currently metadata |
| `safeStorageEncrypt()` is synchronous | `await context.safeStorageEncrypt()` |
| `ssh.onData()` has no cleanup | Save and call its unsubscribe function |
| `ssh.write()` is synchronous | `await context.ssh.write()` |
| `pluginRpcInvoke()` | `window.GETSSH.invokeBackend()` |
| `onPluginRpcMessage()` | `window.GETSSH.onBackendMessage()` |
| `registerSettingsSchema()` | `context.ui.registerSettings()` |
| `registerUIExtension()` | `registerTerminalContextMenu()` or `registerSFTPContextMenu()` |
| `onSSHSessionConnect` | Not exposed; obtain a session ID from a context-menu event |
| Normal mode can access host files/network directly | Use `context.storage`, `context.net`, `context.ssh`, and `context.host` |

## 12. Troubleshooting

### `Node.js plugins must declare ... lifecycle`

Add `lifecycle` to backend capabilities and export a real `deactivate()` function.

### `Backend plugins must export activate() and deactivate()`

The entry is not CommonJS, has incorrect exports, or `main` points to the wrong built file.

### `Backend plugins must call context.ui.registerSettings()`

Call `registerSettings()` before activation completes and provide at least one valid field.

### `Plugin '<name>' is not running`

The backend may be disabled by safe mode, may have failed activation, may lack the OS isolation runtime, or the panel URL hostname may not match the manifest `name`.

### `Method '<method>' not found`

Register the exact name with `context.rpc.registerMethod()` before `activate()` resolves.

### `window.GETSSH` is undefined

Load the page through a GETSSH `getssh-plugin://<name>/...` panel. Direct browser and disk loads do not receive the SDK.

### A `SecurityError` stops the plugin

The plugin crossed a security boundary, commonly because a `net.fetch` destination resolved to a private or reserved address. Correct the destination or capability declaration, then reload the plugin.

### RPC or storage rejects a value

Convert it to plain JSON-style data, remove functions, classes, BigInt, circular references, and large binary values, then check the 2 MiB message limit.

## 13. Release checklist

- Keep `name` lowercase and identical in every `getssh-plugin://<name>/...` URL.
- Set `getssh.type: "sandbox"` only for UI-only plugins; omit `type` for every backend.
- Compile the backend to CommonJS and export both lifecycle functions.
- Declare `lifecycle` plus only the capabilities the plugin actually needs.
- Complete activation within eight seconds and register every method, action, and setting before it resolves.
- Clean up timers, subscriptions, streams, and listeners in `deactivate()`.
- Handle `invokeBackend()` rejection and render a useful UI when the backend is unavailable.
- Keep all boundary data serializable and within size and rate limits.
- Avoid dependencies on direct file, network, subprocess, native addon, or Electron access.
- Include all dependencies in the ZIP and put `package.json` at its root or in its only top-level directory.
- Test normal/strict mode on both macOS and Windows.
