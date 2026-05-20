# GETSSH Plugin SDK Internal Documentation

This document defines the internal architecture, security boundaries, and data structures for the GETSSH plugin system. It is intended for core maintainers and AI agents integrating or debugging plugins.

## 1. Core Data Structures & Interfaces

The plugin system relies on strict TypeScript interfaces to bridge the main process and sandboxed renderers.

### Manifest

The `package.json` of a plugin must conform to the `PluginManifest` interface:

```typescript
export interface PluginManifest {
  name: string;
  version: string;
  displayName: string;
  icon?: string;
  description: string;
  main: string;
  renderer?: string;
  localPath?: string;
  _rendererContentCache?: string;
}
```

### Main Process API

If a plugin exposes a main entry point, its `activate` function is called with the following context API:

```typescript
export interface MainContextAPI {
  showNotification: (title: string, body: string) => void;
  safeStorageEncrypt: (text: string) => string;
  safeStorageDecrypt: (encryptedData: string) => string;
  onSSHSessionConnect?: (callback: (sessionId: string, host: string) => void) => void;
}
```

### Renderer Process API

A minimal SDK is injected into the isolated plugin iframe, proxying these methods back to the host:

```typescript
export interface RendererContextAPI {
  registerSidebarAction: (
    id: string,
    icon: string,
    label: string,
    onClick: () => void
  ) => void;
}
```

### IPC Message Routing (PluginBridge)

Communication between the plugin iframe and the host app occurs via `postMessage`. `PluginBridge` strictly filters these messages.

**Allowed Actions:**
- `registerSidebarAction`
- `registerPanel`
- `showNotification`
- `getActiveSessionId`

**Blocked Actions (Security Enforcement):**
- `sshWrite`
- `sshConnect`
- `sshDisconnect`
- `saveProfiles`
- `unlockProfiles`
- `sftpWriteFile`
- `sftpDelete`

## 2. Lifecycle & Sandbox Architecture

The lifecycle of a local `.zip` plugin ensures absolute isolation from extraction to execution.

1.  **Extraction & Validation:**
    *   The `PluginManager` extracts the `.zip` archive into a temporary directory.
    *   **Security:** During extraction, paths are strictly validated against the temporary root to prevent **Zip Slip** vulnerabilities.
    *   The manager locates the `package.json` (handling cases where the plugin is wrapped in a single root folder) and validates it.
    *   The valid plugin is then securely moved to the `userData/plugins` directory.

2.  **Mounting & Booting:**
    *   The `bootSandboxedPlugins` routine fetches the renderer scripts.
    *   For each plugin, it generates an isolated `<iframe>` with `sandbox="allow-scripts"` and `display: none`.
    *   A minimal JavaScript SDK is injected into the document before appending the plugin's renderer script.

3.  **Security Architecture:**
    *   **DOM Isolation:** Because the iframe uses the sandbox attribute without `allow-same-origin`, it has no access to the host's DOM.
    *   **Node/Electron Isolation:** The iframe has zero access to Node.js modules or the `window.electronAPI`.
    *   **Action Enforcement:** `PluginBridge` intercepts all `postMessage` calls and cross-references them against `BLOCKED_ACTIONS`. Any dangerous operation explicitly triggers a console warning and is dropped.

## 3. Best Practice "Hello World" Example

This minimal implementation demonstrates a valid manifest and a frontend script that leverages the injected SDK to register a sidebar action.

### `package.json`

```json
{
  "name": "hello-world-plugin",
  "version": "1.0.0",
  "displayName": "Hello World",
  "description": "A minimal example plugin.",
  "main": "main.js",
  "renderer": "renderer.js"
}
```

### `renderer.js`

```javascript
// The SDK is automatically injected by PluginBridge.
// window.GETSSH and window.__sidebarHandlers are available globally.

const actionId = "hello-btn";

// 1. Register the click handler
window.__sidebarHandlers[actionId] = () => {
  window.GETSSH.showNotification("Hello", "World from sandboxed plugin!");
};

// 2. Register the UI element with the host
window.GETSSH.registerSidebarAction(
  actionId,
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='12' cy='12' r='10' fill='currentColor'/></svg>",
  "Say Hello"
);
```