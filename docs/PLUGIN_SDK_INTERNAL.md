# GETSSH Plugin SDK Documentation

[🇨🇳 中文版 (Chinese Version)](./PLUGIN_SDK_INTERNAL_CN.md) | English

Welcome to the GETSSH Plugin SDK. This document is the complete reference for third-party developers, covering plugin types, the Manifest specification, APIs, the security model, and the publishing workflow.

---

## Table of Contents

1. [Plugin Types at a Glance](#1-plugin-types-at-a-glance)
2. [Manifest Specification (`package.json`)](#2-manifest-specification-packagejson)
3. [Sandbox Plugin](#3-sandbox-plugin)
4. [Backend Plugin (Node.js)](#4-backend-plugin-nodejs)
5. [Security Sandbox Model & Escape Prevention](#5-security-sandbox-model--escape-prevention)
6. [RASP Lifecycle Integration (Mandatory)](#6-rasp-lifecycle-integration-mandatory)
7. [System Monitor Data Stream (sysmon)](#7-system-monitor-data-stream-sysmon)
8. [UI Extension Points (Context Menus)](#8-ui-extension-points-context-menus)
9. [Full Example: Hello World Sandbox Plugin](#9-full-example-hello-world-sandbox-plugin)
10. [Full Example: Backend Node.js Plugin](#10-full-example-backend-nodejs-plugin)
11. [Packaging & Installation](#11-packaging--installation)
12. [Common Errors & Troubleshooting](#12-common-errors--troubleshooting)

---

## 1. Plugin Types at a Glance

GETSSH supports two fundamentally different plugin types. Read their permission boundaries carefully before choosing:

| Feature | Sandbox Plugin (`sandbox`) | Backend Plugin (Node.js) |
|---|---|---|
| **Main entry** | `index.html` (pure frontend) | `main.js` (runs in main process) |
| **Node.js access** | ❌ Fully prohibited | ✅ VM-sandboxed access |
| **Access to `electronAPI`** | ❌ Fully prohibited | ✅ Via injected `ctx` context |
| **File system (`fs`)** | ❌ Fully prohibited | ⛔ Blocked in strict mode |
| **Network (`net`)** | ❌ Fully prohibited | ⛔ Blocked in strict mode |
| **Lifecycle hook required** | ✅ Exempt | ⛔ **`deactivate()` is mandatory** |
| **Use cases** | Data dashboards, status monitors, read-only UI panels | SSH auditing, automation scripts, encrypted storage integration |

> **Strongly recommended: choose sandbox plugins first.** Sandbox plugins cannot be exploited and are unaffected by security mode switches. Users trust them more.

---

## 2. Manifest Specification (`package.json`)

Every plugin must include a `package.json` in its root directory.

### Full Field Reference

```json
{
  "name": "my-awesome-plugin",
  "version": "1.0.0",
  "displayName": "My Awesome Plugin",
  "description": "A one-line description of your plugin.",
  "author": "Your Name <email@example.com>",
  "main": "main.js",
  "getssh": {
    "pluginId": "com.example.my-awesome-plugin",
    "type": "sandbox",
    "capabilities": ["lifecycle"]
  }
}
```

### Field Reference

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | ✅ | Unique identifier (lowercase + hyphens). Used as the plugin's install directory name. |
| `version` | `string` | ✅ | Semantic version, e.g. `1.0.0`. |
| `displayName` | `string` | ✅ | Friendly name shown in the GETSSH plugin marketplace and settings UI. |
| `description` | `string` | ✅ | Short description shown in the plugin list. |
| `author` | `string` | Recommended | Author information. |
| `main` | `string` | ✅ | Main entry point. Use `index.html` for sandbox plugins, `main.js` for backend plugins. |
| `getssh.pluginId` | `string` | ✅ | **Globally unique** reverse-domain ID, e.g. `com.example.myplugin`. Duplicates are not permitted. |
| `getssh.type` | `"sandbox"` | Required for sandbox | Declares this as a sandbox plugin. **Do not set this for backend plugins.** |
| `getssh.capabilities` | `string[]` | Required for backend | Backend plugins must include `"lifecycle"`. Missing this declaration causes installation rejection. |

> **Name resolution priority:** GETSSH resolves the plugin display name as: `getssh.name` → `displayName` → `name`.

---

## 3. Sandbox Plugin

### How It Works

A sandbox plugin's HTML file is loaded inside a strictly restricted `<iframe>`. The iframe uses the `sandbox="allow-scripts"` attribute, which means:

- **No** `allow-same-origin`: The iframe's origin is `null`. It cannot read the host app's DOM, cookies, or localStorage.
- **No** Node.js environment: `require`, `process`, and `window.electronAPI` do not exist.
- **The only communication channel**: The `window.GETSSH` SDK injected by GETSSH, used via `postMessage`.

### Injected `window.GETSSH` SDK

Before your plugin code runs, GETSSH automatically injects the following SDK object into the sandbox:

```typescript
window.GETSSH = {
  /**
   * Registers a clickable icon button in the sidebar.
   * @param id     Unique button ID (unique within your plugin)
   * @param icon   SVG string (automatically sanitized; malicious scripts are stripped)
   * @param label  Tooltip label shown on hover
   */
  registerSidebarAction(id: string, icon: string, label: string): void;

  /**
   * Shows a system desktop notification (requires user notification permission).
   * @param title Notification title
   * @param body  Notification body text
   */
  showNotification(title: string, body: string): void;

  /**
   * Returns the current locale string of the host app (e.g. 'en-US', 'zh-CN').
   * This is a synchronous, snapshot read. To track changes, use onThemeChange.
   */
  getLocale(): string;

  /**
   * Subscribes to theme changes in the host app.
   * Fires immediately on change whenever the user switches between dark/light/system mode.
   * @param callback Receives the new theme value: 'dark' | 'light' | 'system'
   */
  onThemeChange(callback: (theme: 'dark' | 'light' | 'system') => void): void;
}

/**
 * Handler map for sidebar button click events.
 * Keys must match the id passed to registerSidebarAction.
 */
window.__sidebarHandlers: Record<string, () => void>;
```

### Theme & Locale Usage Example

You can use these APIs to make your plugin's UI adapt seamlessly to the host app:

```javascript
// Read locale once at startup
const locale = window.GETSSH.getLocale();
document.getElementById('greeting').textContent =
  locale.startsWith('zh') ? '你好，世界！' : 'Hello, World!';

// React to live theme changes
window.GETSSH.onThemeChange((theme) => {
  document.body.setAttribute('data-theme', theme);
  // e.g. update CSS variables, chart colors, etc.
});
```

### Receiving Messages from the Host App

The host app may push data to your plugin via `postMessage`. Listen for the `message` event:

```javascript
window.addEventListener('message', (event) => {
  // Always check the message type to avoid processing unrelated messages
  if (event.data.type === 'sysmon:data') {
    // See Section 7: System Monitor Data Stream
    const { cpus, mem, net } = event.data.payload;
  }
});
```

### PluginBridge Message Interceptor (Allowlist)

All `postMessage` requests sent from the sandbox to the host must pass through the `PluginBridge` allowlist. **Only the following actions are permitted:**

| Action | Description |
|---|---|
| `registerSidebarAction` | Register an icon button in the sidebar |
| `registerPanel` | Register a panel page |
| `showNotification` | Trigger a system desktop notification |
| `getActiveSessionId` | Get the current active SSH session ID (always returns `null` for security — plugins cannot access real session IDs) |

**The following actions are always intercepted and trigger a security warning log:**

| Blocked Action | Reason |
|---|---|
| `sshWrite` | Plugins cannot directly write to SSH terminals |
| `sshConnect` / `sshDisconnect` | Plugins cannot control connection lifecycle |
| `saveProfiles` / `unlockProfiles` | Plugins cannot access encrypted connection profiles |
| `sftpWriteFile` / `sftpDelete` | Plugins cannot modify or delete files over SFTP |

> **Security Note**: Any malicious backend plugin that tries to bypass lifecycle checks by declaring `"type": "sandbox"` will be completely stripped of execution rights. When the main process sees the `sandbox` declaration, it skips all backend JS code loading. Any malicious code hidden in `main.js` never gets a chance to run.

---

## 4. Backend Plugin (Node.js)

### How It Works

A backend plugin's `main.js` is executed inside an isolated sandbox created by the Node.js `vm` module within Electron's **main process**.

### `activate(ctx)` Context API

When the plugin is activated, the `activate` function receives a `ctx` object — this is your only legitimate API entry point:

```typescript
interface MainContextAPI {
  /**
   * @deprecated Use ctx.host.notify() instead for new plugins.
   * Shows a native system desktop notification.
   */
  showNotification(title: string, body: string): void;

  /**
   * Encrypts a string using Electron's OS-level encryption.
   * Keys are managed by the OS keychain, bound to the current user account.
   */
  safeStorageEncrypt(text: string): string;

  /**
   * Listens for SSH session connection events (read-only).
   * Called whenever the user successfully establishes a new SSH connection.
   * @param callback sessionId is the GETSSH internal session ID; host is the target hostname
   */
  onSSHSessionConnect?(callback: (sessionId: string, host: string) => void): void;

  /**
   * Persistent key-value storage isolated per plugin.
   */
  storage: {
    get(key: string): Promise<any>;
    set(key: string, value: any): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
  };

  /**
   * Bidirectional RPC bridge between the backend VM and any frontend iframe plugin.
   */
  rpc: {
    /** Register a method that the frontend can invoke via window.electronAPI.pluginRpcInvoke(). */
    registerMethod(method: string, handler: (payload: any) => Promise<any>): void;
    /** Push arbitrary data to the frontend. Received via window.electronAPI.onPluginRpcMessage(). */
    sendToFrontend(payload: any): void;
  };

  /**
   * Native OS host integration APIs.
   * ♥️ All dialog calls are logged to the main process console with [Plugin Host API] audit traces.
   */
  host: {
    /**
     * Sends a native OS desktop notification directly from the background plugin.
     * Works even when no UI is visible. Ideal for server monitors & alert systems.
     * @param title  Notification title
     * @param body   Notification body text
     * @param type   Visual intent: 'info' (default) | 'warning' | 'error'
     */
    notify(title: string, body: string, type?: 'info' | 'warning' | 'error'): void;

    /**
     * Shows a native OS message/confirmation dialog.
     * Returns a Promise resolving to the index of the button clicked by the user.
     * @param options.type        Dialog icon: 'none' | 'info' | 'warning' | 'error' | 'question'
     * @param options.buttons     Button labels array, e.g. ['OK', 'Cancel']
     * @param options.message     Main message text (displayed in bold)
     * @param options.detail      Secondary message text (smaller font, optional)
     * @param options.defaultId   Index of the button focused by default
     * @param options.cancelId    Index of the button triggered by pressing Escape
     * @param options.checkboxLabel  Optional checkbox label at the bottom
     * @returns { response: number (index of clicked button), checkboxChecked: boolean }
     */
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

    /**
     * Shows a native OS file/directory picker.
     * Security guarantee: the plugin only receives file path strings —
     * no implicit file content access is granted.
     * @param options.properties  Selection mode: 'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles'
     * @param options.filters     File type filters, e.g. [{ name: 'Images', extensions: ['png', 'jpg'] }]
     * @returns { canceled: boolean, filePaths: string[] }
     */
    showOpenDialog(options: {
      title?: string;
      defaultPath?: string;
      filters?: { name: string; extensions: string[] }[];
      properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles'>;
    }): Promise<{ canceled: boolean; filePaths: string[] }>;

    /**
     * Shows a native OS file save-path picker.
     * @param options.filters  File type filters
     * @returns { canceled: boolean, filePath?: string }
     */
    showSaveDialog(options: {
      title?: string;
      defaultPath?: string;
      filters?: { name: string; extensions: string[] }[];
    }): Promise<{ canceled: boolean; filePath?: string }>;
  };

  /**
   * SSH I/O bridge (requires capabilities: ['ssh:read', 'ssh:write']).
   */
  ssh?: {
    onData(sessionId: string, callback: (chunk: string) => void): void;
    write(sessionId: string, command: string): void;
  };

  /**
   * UI Extension Points — Inject custom context menus, or register plugin settings schema.
   * See Section 8.
   */
  ui: {
    registerTerminalContextMenu(actionId: string, label: string, handler: (context: { sessionId: string, selectionText: string }) => void): void;
    registerSFTPContextMenu(actionId: string, label: string, handler: (context: { sessionId: string, currentPath: string, selectedFiles: string[] }) => void): void;
    
    /**
     * [MANDATORY] Register the plugin's configuration schema.
     * All backend plugins MUST call this exactly once during activate().
     * Your plugin must provide at least one configuration parameter. You CANNOT pass an empty array `[]`; doing so will cause the kernel to reject the plugin.
     */
    registerSettings(schema: PluginSettingsSchema[]): void;
  };
}
```

### VM Sandbox Security Levels

Backend plugin permissions are controlled by the security mode the user selects in GETSSH settings:

| Security Mode | `require()` Permissions | Use Case |
|---|---|---|
| **Strict** | Only `path`, `os` | Maximum security, limited distribution |
| **Normal** | Blocks dangerous modules: `fs`, `child_process`, `net` | Standard plugin development |
| **Developer** | Full native `require`, no restrictions | **For development/debugging only. Do not distribute in production.** |

### `ctx.host` Usage Examples

```javascript
// ① Show a confirmation dialog and wait for user response
const result = await ctx.host.showMessageBox({
  type: 'warning',
  title: 'Confirm Action',
  message: 'Are you sure you want to delete this config file?',
  detail: 'This action cannot be undone.',
  buttons: ['Delete', 'Cancel'],
  defaultId: 1,   // focus 'Cancel' by default
  cancelId: 1,
});
if (result.response === 0) {
  // User clicked 'Delete' (index 0)
}

// ② Open a file picker to let the user choose a config file
const open = await ctx.host.showOpenDialog({
  title: 'Select Config File',
  filters: [{ name: 'JSON Config', extensions: ['json'] }],
  properties: ['openFile'],
});
if (!open.canceled) {
  const configPath = open.filePaths[0];
  // Use configPath via ctx.storage or other controlled APIs...
}

// ③ Open a save dialog to let the user pick an export path
const save = await ctx.host.showSaveDialog({
  title: 'Export Audit Report',
  defaultPath: 'audit-report.csv',
  filters: [{ name: 'CSV', extensions: ['csv'] }],
});
if (!save.canceled && save.filePath) {
  // save.filePath is the full local path chosen by the user
}
```

> **Security Note**: `showOpenDialog` only returns **path strings** — it does not implicitly grant file read access. Plugins must use existing controlled channels (like `ctx.storage` or a dedicated streaming API) to further access file data.

---

## 5. Security Sandbox Model & Escape Prevention

### Why Can't `sandbox` Type Be Used to Bypass Hooks?

This is a common question: since `sandbox` plugins are exempt from lifecycle checks, what if a malicious backend plugin lies in `package.json` by declaring `"type": "sandbox"`?

**The answer: absolutely not possible.** GETSSH's security architecture has multiple layers specifically designed to counter this deception:

```
Declares type: "sandbox"
         │
         ▼
[PluginManager] sees the sandbox flag
         │
         ▼
The main-process Node.js loader executes return immediately.
No main.js code is ever read or executed.
         │
         ▼
PluginBridge puts it in an iframe cage
(sandbox="allow-scripts", no allow-same-origin)
         │
         ▼
It can only communicate via postMessage
         │
         ▼
PluginBridge allowlist interceptor:
Any action outside the allowlist → silently dropped + security log warning
```

**Conclusion:** A plugin that lies about being `sandbox` type voluntarily gives up all Node.js backend privileges. Its `main.js` is never executed. Inside the iframe it can only do limited read-only UI rendering. This is a dead end, not a bypass.

### SVG Icon Sanitization

When you register a sidebar button with a custom SVG icon via `registerSidebarAction`, GETSSH automatically sanitizes the SVG:
- **Strips** all dangerous tags: `<script>`, `<iframe>`, `<foreignObject>`, etc.
- **Removes** all `javascript:` URI attributes.
- **The sanitizer uses Set-based $O(1)$ lookups** — no impact on UI rendering performance.

---

## 6. RASP Lifecycle Integration (Mandatory)

**This is the most important security contract for backend plugins.**

GETSSH's underlying security is monitored by a Rust-written Watchdog daemon that monitors the main process in real time. When Watchdog detects abnormal behavior (such as malicious API hook injection), it triggers the RASP (Runtime Application Self-Protection) protocol and may **forcibly terminate the Electron main process**.

Before the forced kill occurs, GETSSH attempts to execute all plugins' `deactivate()` hooks to prevent data corruption or resource leaks. **This hook is therefore not optional — it is part of system security.**

### Two Mandatory Enforcement Checkpoints

| Checkpoint | Triggered When | Consequence of Failure |
|---|---|---|
| **Install time (static scan)** | User installs the `.zip` | Installation is immediately rejected; no files are written to disk. Error shown in UI. |
| **Load time (runtime check)** | App starts and scans the plugin directory | Plugin is skipped and will not run. Warning written to the console log. |

### What `deactivate()` Must Do

```javascript
let pollingInterval = null;
let openFileHandle = null;

module.exports = {
  activate(ctx) {
    openFileHandle = fs.openSync('/tmp/plugin.log', 'w');
    pollingInterval = setInterval(() => {
      // periodic operations...
    }, 1000);
  },

  deactivate() {
    // ✅ Required: clear all timers
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }

    // ✅ Required: close all file handles
    if (openFileHandle !== null) {
      fs.closeSync(openFileHandle);
      openFileHandle = null;
    }

    // ✅ Required: destroy all network connections
    // socket.destroy(); socket = null;

    // ✅ Required: remove all event listeners
    // emitter.removeAllListeners();
  }
};
```

### Full RASP-Triggered Teardown Flow

```
User selects "Restart in Safe Mode" in RASP overlay
          │
          ▼
SecureCenter.handleAction('restart-safe')
          │
          ▼
① Calls pluginTeardownFn()
          │
          ▼
② PluginManager.deactivateAll()
   ─ Iterates all runningPlugins
   ─ Calls deactivate() for each plugin inside try/catch
          │
          ▼
③ Sends ACTION:RESTART-SAFE to Watchdog
          │
          ▼
④ app.exit(0)
```

Normal app quit (`app.on('before-quit')`) also triggers the same teardown chain via `SecureCenter.getInstance().gracefulShutdown()`.

### Required Manifest Declaration

A backend plugin missing either of the following **will not install**:

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "displayName": "My Backend Plugin",
  "description": "A backend plugin example.",
  "main": "main.js",
  "getssh": {
    "pluginId": "com.example.my-backend-plugin",
    "capabilities": ["lifecycle"]
  }
}
```

> **Note**: Backend plugins should **NOT** set `"type": "sandbox"`.

### Runtime Mandatory Contract: Settings Registration

In addition to `deactivate`, when running the `activate` hook, the plugin **MUST** register its parameter schema to prove compatibility with GETSSH's settings distribution pipeline:

```javascript
module.exports = {
  activate(ctx) {
    // ✅ MANDATORY: You must provide at least one valid parameter!
    ctx.ui.registerSettings([
      { id: 'debugMode', type: 'boolean', label: 'Enable Debug', default: false }
    ]);
    // If not called or called with an empty array, GETSSH will intercept the plugin launch, throw an exception, and destroy it.
  },
  deactivate() {
    // Actual cleanup logic goes here
  }
}
```

---

## 7. System Monitor Data Stream (sysmon)

If your sandbox plugin needs to display real-time system stats (CPU, memory, network), GETSSH automatically pushes system data to every active plugin iframe via `postMessage`.

> **Data source**: Powered by the Rust `getssh-sysprobe` N-API extension, using the `sysinfo` library under the hood. CPU utilization is pre-computed on the Rust side — **no delta calculation is needed** in your JS code.

### Data Structure

```typescript
// In your sandbox plugin HTML/JS, listen for this message:
window.addEventListener('message', (event) => {
  if (event.data.type !== 'sysmon:data') return;

  const payload: SysmonPayload = event.data.payload;
});

interface SysmonPayload {
  cpus: {
    overall: number;   // Global CPU utilization, range 0–100
    cores: number[];   // Per-core utilization array, range 0–100
  };
  mem: {
    total: number;     // Total RAM (bytes)
    used: number;      // Used RAM (bytes)
    free: number;      // Available RAM (bytes)
  };
  net: {
    rx: number;        // Bytes received since last refresh
    tx: number;        // Bytes sent since last refresh
  };
}
```

---

## 8. UI Extension Points (Context Menus)

Backend Node.js plugins can inject custom items into the **native OS context menus** of the Terminal and SFTP views, without any frontend code required.

### How It Works

1. Plugin calls `ctx.ui.registerTerminalContextMenu` or `ctx.ui.registerSFTPContextMenu` during `activate()`.
2. The GETSSH main process broadcasts a `sync-plugin-ui-extensions` event to the React frontend.
3. When the user right-clicks in the Terminal or SFTP view, the host builds a native OS menu that includes your registered items.
4. When the user clicks your item, the main process invokes your handler callback with the contextual data (selected text, file path, etc.).
5. When the plugin is **uninstalled or reloaded**, all its context menu items are immediately garbage-collected — no ghost menus.

### API Reference

```typescript
// Inside activate(ctx):

// Inject an item into the Terminal right-click menu
ctx.ui.registerTerminalContextMenu(
  'action-id',       // unique within your plugin
  'Menu Item Label', // displayed to the user
  (context) => {
    console.log('Session:', context.sessionId);
    console.log('Selected text:', context.selectionText);
  }
);

// Inject an item into the SFTP file list right-click menu
ctx.ui.registerSFTPContextMenu(
  'preview-file',
  'Preview File',
  (context) => {
    console.log('Current path:', context.currentPath);
    console.log('Selected files:', context.selectedFiles); // string[]
  }
);
```

### Context Data Shapes

| Menu Type | Context Object |
|---|---|
| `registerTerminalContextMenu` | `{ sessionId: string, selectionText: string }` |
| `registerSFTPContextMenu` | `{ sessionId: string, currentPath: string, selectedFiles: string[] }` |

> **Note**: Context menu items are registered at `activate()` time and are **persistent** for the lifetime of the plugin. You cannot dynamically add or remove individual items — to change the set, you must reload the plugin.

---

## 9. Full Example: Hello World Sandbox Plugin

The simplest possible sandbox plugin — registers a sidebar button that shows a notification when clicked.

### Directory Structure

```
hello-world/
├── package.json
└── index.html
```

### `package.json`

```json
{
  "name": "hello-world-plugin",
  "version": "1.0.0",
  "displayName": "Hello World",
  "description": "A minimal GETSSH sandbox plugin example.",
  "author": "Your Name",
  "main": "index.html",
  "getssh": {
    "pluginId": "com.example.hello-world",
    "type": "sandbox"
  }
}
```

### `index.html`

```html
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body>
<script>
// After the sandbox boots, window.GETSSH and window.__sidebarHandlers
// are already injected by GETSSH — no need to wait for any events.

const actionId = 'hello-btn';

// 1. Register the click handler
window.__sidebarHandlers[actionId] = () => {
  window.GETSSH.showNotification('Hello!', 'Greetings from a sandboxed plugin.');
};

// 2. Register the button in the sidebar (SVG is auto-sanitized)
window.GETSSH.registerSidebarAction(
  actionId,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="10" fill="currentColor"/>
  </svg>`,
  'Say Hello'
);
</script>
</body>
</html>
```

---

## 10. Full Example: Backend Node.js Plugin

An SSH audit logger that listens for connection events and writes them to a local log file.

### Directory Structure

```
ssh-auditor/
├── package.json
└── main.js
```

### `package.json`

```json
{
  "name": "ssh-auditor",
  "version": "1.0.0",
  "displayName": "SSH Audit Logger",
  "description": "Logs all SSH connection events to a local file.",
  "author": "Your Name",
  "main": "main.js",
  "getssh": {
    "pluginId": "com.example.ssh-auditor",
    "capabilities": ["lifecycle"]
  }
}
```

### `main.js`

```javascript
// Note: In strict mode, the fs module is unavailable.
// This example requires the user to set security mode to "Normal" or "Developer".
const fs = require('fs');
const os = require('os');
const path = require('path');

const logPath = path.join(os.tmpdir(), 'getssh-audit.log');
let fileStream = null;

module.exports = {
  activate(ctx) {
    fileStream = fs.createWriteStream(logPath, { flags: 'a' });
    fileStream.write(`[${new Date().toISOString()}] SSH Audit plugin started\n`);

    ctx.onSSHSessionConnect?.((sessionId, host) => {
      const line = `[${new Date().toISOString()}] Connected to: ${host} (session: ${sessionId})\n`;
      fileStream?.write(line);
    });

    // ⛔ MANDATORY: Declare the configuration parameters for this plugin
    ctx.ui.registerSettings([
      { id: 'logLevel', type: 'string', label: 'Log Level', default: 'info' }
    ]);

    ctx.showNotification('SSH Audit', `Audit logging started at ${logPath}`);
  },

  // ⛔ This hook is mandatory — the plugin cannot be installed without it
  deactivate() {
    if (fileStream) {
      fileStream.write(`[${new Date().toISOString()}] SSH Audit plugin stopped\n`);
      fileStream.end();    // ✅ Required: close the file stream
      fileStream = null;
    }
  }
};
```

---

## 11. Packaging & Installation

### Packaging Rules

Pack the plugin directory as a `.zip` file. Plugin files can be placed directly in the `.zip` root, or wrapped inside a single subdirectory:

```
# Format A (recommended): directly at the root
my-plugin.zip
├── package.json
├── main.js
└── index.html

# Format B (also supported): wrapped in a subdirectory
my-plugin.zip
└── my-plugin/
    ├── package.json
    ├── main.js
    └── index.html
```

> **Warning**: GETSSH validates all extracted paths against the plugin directory root to prevent **Zip Slip (path traversal)** attacks. Any `.zip` that attempts to extract files outside the plugin directory will be immediately rejected.

### Installation

Inside GETSSH: **Settings → Plugins → Install Plugin**, then select your `.zip` file.

---

## 12. Common Errors & Troubleshooting

### Install error: `[Security] Plugin installation rejected: ...capabilities...`

**Cause**: The backend plugin's `package.json` is missing `"getssh": { "capabilities": ["lifecycle"] }`.  
**Fix**: Add the complete `getssh` field as shown in Section 6.

### Install error: `[Security] ... does not export a 'deactivate' lifecycle hook`

**Cause**: GETSSH could not find the `deactivate` keyword in your `main.js` during static scanning, or it determined that your `deactivate` hook is an empty function (e.g., `() => {}`) during runtime analysis.
**Solution**: Ensure your `main.js` exports a `deactivate` function and that it contains actual resource cleanup logic (disconnecting sockets, clearing intervals, etc.). **Empty functions are strictly forbidden to pass the security check.**

### Install error: `Invalid Architecture: Missing package.json manifest.`

**Cause**: No `package.json` was found in the `.zip`, or the `.zip` contains multiple sibling subdirectories.  
**Fix**: Ensure `package.json` is either directly in the `.zip` root or inside a single subdirectory.

### Plugin is loaded but `window.GETSSH` is `undefined`

**Cause**: This typically means your script is loaded via an external `src` attribute, which is blocked inside the sandbox.  
**Fix**: Place your JavaScript directly inside an inline `<script>` tag in your `index.html`. The SDK is injected before any inline script runs.

### Notifications don't appear

**Cause**: OS notification permissions have not been granted to GETSSH.  
**Fix**: This is controlled by the user's operating system permissions. `showNotification` silently fails when permission is not granted — this is expected behavior.
