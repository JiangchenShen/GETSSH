# GETSSH Ultimate Security Audit Report V3.0 (Full Codebase Line-by-Line Scan · Final Draft)

> **Version**: V3.0 — Final Draft (Anti-CVE Edition)
> **Audit Scope**: All `.ts`, `.tsx`, `.js`, `.json`, `.html`, `.bat` files in the project root directory
> **Methodology**: Full file line-by-line audit + IPC data flow tracing + Attack chain combination analysis + Race condition/TOCTOU/Timing analysis
> **Tone**: Exclusively listing vulnerabilities for collective review and unified remediation

---

## ⚠️ Severity Definitions

| Level | Meaning |
|---|---|
| 🔴 CRITICAL | Remotely exploitable, directly leading to data breach, system takeover, or app crash |
| 🟠 HIGH | Locally exploitable under specific conditions, compromising security boundaries |
| 🟡 MEDIUM | Requires a multi-step chain to exploit, or has a limited scope of impact |
| 🟢 LOW | Theoretical vulnerability, extremely difficult to exploit, or only affects app stability |

---

## Warning: Two extremely stealthy nuclear-level vulnerabilities (C-05, C-06) discovered in the 4th round deep dive
After your prompt, a penetrating audit of the deep logic of the code (especially Windows platform specifics and Electron's `will-navigate` mechanism) was conducted. Two critical vulnerabilities were found that could directly lead to **credentials being stolen in seconds** and **complete failure of the sandbox and CSP**.

---

## Chapter 1: Protocol Layer Vulnerabilities — Arbitrary Local File Read

### 🔴 [C-01] Path Traversal in `getssh-plugin://` leading to Local File Inclusion (LFI)

**File**: [index.ts:112-118](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/index.ts#L112-L118)

```typescript
protocol.handle('getssh-plugin', (request) => {
  const url = request.url.substring('getssh-plugin://'.length);
  const decodedUrl = decodeURIComponent(url);
  const pluginPath = join(app.getPath('userData'), 'plugins', decodedUrl);
  return net.fetch(pathToFileURL(pluginPath).toString());
});
```

`join()` does not prevent `../` traversal. An attacker executing `fetch('getssh-plugin://../../../../../../Users/xxx/.ssh/id_rsa')` via XSS can steal **arbitrary local files** such as SSH private keys and browser credential databases.

---

## Chapter 2: Plugin System — Complete Compromise

### 🔴 [C-02] Main Process Plugins Run with Highest Node.js Privileges (Unsandboxed)

**File**: [PluginManager.ts:65](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/PluginManager.ts#L65)

```typescript
const pluginModule = require(mainEntryPath);
pluginModule.activate(this.createMainContext());
```

Third-party plugins are directly loaded into the Electron Main Process via `require()`. Plugins can access `fs`, `child_process`, `net`, and all Node.js APIs, granting them **the full system privileges of the current user**. This is the most fundamental architectural flaw in the entire project.

---

### 🔴 [C-03] `safeStorageDecrypt` Exposed to Plugins = Complete Plaintext Credential Leak

**File**: [PluginManager.ts:29-34](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/PluginManager.ts#L29-L34)

```typescript
safeStorageDecrypt: (hash) => {
  return safeStorage.decryptString(Buffer.from(hash, 'base64'));
}
```

Any plugin can call this API. A malicious plugin simply needs to read `profiles.key` (which stores the OS-encrypted Master Password) from the disk, pass it to this function, and it will receive the plaintext Master Password. This allows decryption of **all SSH passwords and private key paths** stored in `profiles.enc`.

---

### 🔴 [C-04] Windows OS Biometric Authentication Bypass = "ATM-style" Master Password Theft

**File**: [cryptoHandler.ts:21-30](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/handlers/cryptoHandler.ts#L21-L30)

```typescript
} else if (process.platform === 'win32') {
  // Windows DPAPI is implicit via user login, so proceed
}
// ...
const masterPassword = safeStorage.decryptString(encryptedKey);
return { success: true, masterPassword };
```

On Windows systems, Electron's `safeStorage` underlyingly uses DPAPI, which means decryption is implicit and **will not prompt for fingerprint or password confirmation like macOS does**! The code explicitly gives a green light just because it's `win32` and returns the **plaintext master password**.
Any XSS script executing `await window.electronAPI.promptBiometricUnlock()` on a Windows PC will immediately make GETSSH spit out the core master password in plaintext, acting like an undefended ATM.

---

### 🔴 [C-05] `will-navigate` Protocol Validation Logic Flaw Leading to Global CSP Bypass + RCE

**File**: [windowHandler.ts:87-89](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/handlers/windowHandler.ts#L87-L89)

```typescript
if (parsedUrl.protocol === 'file:') {
  return; // Allow local file navigation (dist/index.html)
}
```

To allow loading `dist/index.html` locally, the code bluntly allows **all** `file://` protocol navigations.
If an attacker executes `window.location.href = 'file:///tmp/malicious.html'` via XSS (the malicious HTML could be dropped locally via the SFTP `edit-sync` feature or social engineering), the main GETSSH window will directly navigate to and load this malicious web page.
**The Fatal Flaw**: The navigated malicious local web page not only **escapes the original `index.html`'s CSP restrictions** (allowing it to freely load external scripts or exfiltrate data), but because it is rendered in the main window, **it inherits the globally injected `window.electronAPI`!** This escalates a low-severity local file drop into an unrestricted RCE and full system takeover.

---

### 🟠 [H-01] XSS → RCE Loop: `installPlugin` Exposed to Renderer Process

**File**: [preload/index.ts:50](file:///Users/shenjiangchen/Documents/GETSSH/electron/preload/index.ts#L50)

```typescript
installPlugin: (zipPath: string) => ipcRenderer.invoke('install-plugin', zipPath),
```

Any JS executing in the renderer process (XSS, malicious translation packs, tampered localStorage) can call this API to install a malicious ZIP pre-placed in `~/Downloads`, forming a complete attack chain: **XSS → Plugin Installation → Main Process RCE**.

---

### 🟠 [H-02] Sandbox Escape via `allow-same-origin` in `PluginPane`

**File**: [PluginPane.tsx:82](file:///Users/shenjiangchen/Documents/GETSSH/src/components/PluginPane.tsx#L82)

```html
sandbox="allow-scripts allow-same-origin"
```

The `allow-same-origin` directive allows plugin scripts running inside the iframe in the production Electron build (which uses `file://` protocol) to **directly access the parent window's localStorage** (containing `appConfig` and `initScript`) and DOM, completely bypassing the sandbox isolation.

---

### 🟡 [M-01] `LeafPane` Directly Constructs `file://` URL to Load Plugins

**File**: [LeafPane.tsx:269](file:///Users/shenjiangchen/Documents/GETSSH/src/components/LeafPane.tsx#L269)

```typescript
const pluginUrl = `file://${plugin.localPath}/${plugin.main}`;
```

The plugin's `localPath` and `main` (from `package.json`) are directly concatenated into a `file://` URL without path validation. If a malicious `package.json` sets the `main` field to `../../../../../../etc/passwd`, this URL will point to a system file.

---

### 🟡 [M-02] PluginBridge `postMessage` Origin Unverified

**File**: [PluginBridge.ts:26-41](file:///Users/shenjiangchen/Documents/GETSSH/src/plugins/PluginBridge.ts#L26-L41)

```typescript
function handlePluginMessage(event: MessageEvent) {
  const data = event.data;
  if (!data || !data.__getssh_plugin) return;
  // ❌ Missing validation for event.origin or event.source
```

Any iframe (including ad iframes) can forge a message with `__getssh_plugin: true` to trigger sidebar registration, popup notifications, etc. Contrast this with `PluginPane.tsx:34`, which correctly validates `event.source`.

---

### 🟡 [M-03] Memory Bloat via `require.cache` Accumulation

**File**: [PluginManager.ts:65](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/PluginManager.ts#L65)

Node.js `require()` permanently caches modules. Upon frequent plugin installation/uninstallation, old versions of the code can never be garbage collected (GC'd).

---

## Chapter 3: XSS and Injections

### 🟠 [H-03] Permissive CSP: `unsafe-inline` + `unsafe-eval`

**File**: [index.html:5](file:///Users/shenjiangchen/Documents/GETSSH/index.html#L5)

```html
script-src 'self' 'unsafe-inline' 'unsafe-eval'
```

These two directives completely abolish CSP protections against inline scripts. In an Electron app, this means any inline script injected into the DOM will execute unhindered.

---

### 🟠 [H-04] Unsanitized i18n Injection via `dangerouslySetInnerHTML`

**File**: [SettingsView.tsx:968](file:///Users/shenjiangchen/Documents/GETSSH/src/components/SettingsView.tsx#L968)

```tsx
<p dangerouslySetInnerHTML={{ __html: t('about.openSourceDesc') as string }} />
```

There is **no DOMPurify sanitization** here. Contrast this with `Sidebar.tsx:152` which uses `DOMPurify.sanitize()`. If community translations are allowed, a malicious translation file could directly trigger XSS.

---

### 🟡 [M-04] Prototype Pollution Risk via Custom Theme Imports

**File**: [SettingsView.tsx:48-69](file:///Users/shenjiangchen/Documents/GETSSH/src/components/SettingsView.tsx#L48-L69) + [themes.ts:parseCustomTheme](file:///Users/shenjiangchen/Documents/GETSSH/src/utils/themes.ts)

Users can import arbitrary JSON files as terminal themes. `parseCustomTheme` uses `JSON.parse` and iterates via `Object.entries`. If a malicious JSON contains a `__proto__` key, it can lead to prototype pollution. The parsed object is stored in `localStorage` and passed to Xterm.js, potentially affecting terminal rendering logic.

---

### 🟡 [M-05] Overly Permissive `connect-src` CSP

**File**: [index.html:5](file:///Users/shenjiangchen/Documents/GETSSH/index.html#L5)

```
connect-src 'self' ws: http: https:
```

Allows the renderer process to initiate HTTP/WebSocket requests to **any domain**. If an attacker gains execution rights via XSS, they can `fetch()` stolen passwords/keys directly to an external server without CSP intervention.

---

## Chapter 4: Credential and Password Security

### 🟠 [H-05] `initScript` Command Injection to Remote Servers

**File**: [App.tsx:242-246](file:///Users/shenjiangchen/Documents/GETSSH/src/App.tsx#L242-L246)

```typescript
window.electronAPI.sshWrite(sessionId, config.initScript + '\n');
```

`initScript` is an arbitrary shell command stored in plaintext within `localStorage`. If an attacker tampers with this field via XSS or a malicious plugin, the malicious command will automatically execute on the **remote server** during the next SSH connection. This constitutes a cross-domain attack escalation from "Local Vulnerability → Remote Server Compromise."

---

### 🟡 [M-06] Sensitive Configurations Stored in Plaintext in `localStorage`

**File**: [appStore.ts:148](file:///Users/shenjiangchen/Documents/GETSSH/src/store/appStore.ts#L148)

```typescript
localStorage.setItem('appConfig', JSON.stringify(appConfig));
```

`appConfig` contains `initScript` (remote commands), `proxyHost/proxyPort` (proxy configs), `globalHotkey`, etc. Everything is stored as plaintext JSON, which can be read and tampered with by any code running in the renderer process.

---

### 🟡 [M-07] Infinite Lifetime of Master Password in Zustand/React State

**File**: [App.tsx:85](file:///Users/shenjiangchen/Documents/GETSSH/src/App.tsx#L85), [cryptoStore.ts](file:///Users/shenjiangchen/Documents/GETSSH/src/store/cryptoStore.ts)

Once unlocked, the master password resides as React state in the V8 heap memory until GC occurs. It can be extracted via Electron debugging interfaces or process memory dumps.

---

### 🟡 [M-08] `CryptoModal` Password Strength Too Low: Min 4 Characters

**File**: [CryptoModal.tsx:30-31](file:///Users/shenjiangchen/Documents/GETSSH/src/components/CryptoModal.tsx#L30-L31)

```typescript
if (password.length < 4) {
  setError('Password too short (min 4 chars)');
```

A 4-character password can be brute-forced in seconds, even with PBKDF2-100000 rounds. The industry standard minimum is 8 characters.

---

## Chapter 5: Memory Safety and DoS

### 🔴 [C-06] Out of Memory (OOM) Crash via Unbounded SFTP "Swallow-All" File Reads

**File**: [sftpHandler.ts:78-89](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/handlers/sftpHandler.ts#L78-L89)

```typescript
session.sftp.readFile(remotePath, 'utf8', (err, data) => {
  resolve({ success: true, data }); // data could be multi-GB
});
```

No size limits exist. Double-clicking a 2GB `.log` file on the server → Node.js V8 instantly throws OOM → Application crashes.

---

### 🟠 [H-06] Unbounded PTY Terminal Dimensions

**File**: [ptyHandler.ts:82-83](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/handlers/ptyHandler.ts#L82-L83)

```typescript
const cols = config.cols || 80;
const rows = config.rows || 24;
```

Unclamped dimensions. Forging an IPC message `{ cols: 99999999, rows: 99999999 }` → `node-pty` C++ layer attempts to allocate massive buffers → Process crash or system freeze.

---

### 🟡 [M-09] `sysmon setInterval` Permanent Leak

**File**: [systemHandler.ts:91-99](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/handlers/systemHandler.ts#L91-L99)

```typescript
setInterval(() => {
  win.webContents.send('sysmon:data', { cpus: os.cpus(), ... });
}, 1000);
```

`intervalId` is unrecorded, with no cleanup mechanism. Even if the window is destroyed, the main process still executes the `os.cpus()` syscall every second.

---

### 🟡 [M-10] PTY Zombie Processes (Upon Renderer Crash)

**File**: [ptyHandler.ts](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/handlers/ptyHandler.ts)

PTY cleanup relies entirely on the frontend sending `ssh-disconnect`. If the renderer process crashes, the local `bash/zsh` child process becomes an orphaned zombie process on the host system. Cleanup should be enforced in the `BrowserWindow.closed` event.

---

## Chapter 6: IPC Security Boundaries

### 🟡 [M-11] All `ipcMain.on` Handlers Lack `event.senderFrame` Validation

**File**: [sshHandler.ts:391](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/handlers/sshHandler.ts#L391), [systemHandler.ts:102](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/handlers/systemHandler.ts#L102)

```typescript
ipcMain.on('ssh-write', (event, { sessionId, data }) => { ... });
ipcMain.on('update-backend-config', (event, config) => { ... });
```

Electron officially recommends validating `event.senderFrame.url` in every IPC handler to ensure the sender is the app's own page, preventing injected webviews/iframes from directly manipulating the main process via IPC. Currently, **none** of the `ipcMain.on` or `ipcMain.handle` endpoints validate the sender's identity.

---

### 🟡 [M-12] Predictable `SessionId` (Linear Increment)

**File**: [ConnectionManager.ts:17-19](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/services/ConnectionManager.ts#L17-L19)

```typescript
generateSessionId() {
  return `req-${++this.sessionCounter}`;
}
```

`SessionId` is a simple auto-incrementing counter (`req-1, req-2...`). If an attacker can execute `electronAPI.sshWrite('req-1', 'malicious command\n')` via XSS, they can inject commands into **another user's active SSH session**. `crypto.randomUUID()` should be utilized instead.

---

## Chapter 7: SFTP Specific Vulnerabilities

### 🟡 [M-13] SFTP Temp File Symlink Race Condition (TOCTOU)

**File**: [sftpHandler.ts:104-140](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/handlers/sftpHandler.ts#L104-L140)

```typescript
const tempPath = join(os.tmpdir(), `getssh_sync_${Date.now()}_${fileName}`);
// ... fastGet downloads to tempPath ...
const watcher = fs.watch(tempPath, (eventType) => {
  session.sftp!.fastPut(tempPath, remoteFilePath, ...);
});
```

`tempPath` is located in `/tmp` and relies on a predictable `Date.now()` naming convention. An attacker can predict the filename and create a symlink with the same name during the window between `fastGet` completion and `fs.watch` initiation, forcing `fastPut` to upload an attacker-controlled file to the target remote path.

---

### 🟢 [L-01] `sftp-edit-sync` lacks File Extension/Size Validation

Double-clicking any file (including massive binaries) triggers a full download to local storage + `fs.watch` monitoring. There is no blacklist, whitelist, or size limitation.

---

## Chapter 8: Network and Update Security

### 🟢 [L-02] HTTP Update Check Lacks Certificate Pinning

**File**: [systemHandler.ts:41-78](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/handlers/systemHandler.ts#L41-L78)

Uses native `https.get` to query the GitHub API without certificate pinning. Under a malicious Wi-Fi network, API responses could be forged to trick users into visiting phishing sites.

---

### 🟢 [L-03] `.npmrc` Enables `ignore-scripts=false`

**File**: [.npmrc](file:///Users/shenjiangchen/Documents/GETSSH/.npmrc)

```
ignore-scripts=false
```

Permits all npm packages' `postinstall` scripts to execute. If a supply chain attacker poisons a dependency, its malicious `postinstall` script will auto-execute during `pnpm install`.

---

## Chapter 9: System Level and Miscellaneous

### 🟠 [H-07] Environment Variable Hijacking in Windows Uninstaller Script

**File**: [GETSSH_Force_Uninstaller.bat:19-27](file:///Users/shenjiangchen/Documents/GETSSH/GETSSH_Force_Uninstaller.bat#L19-L27)

```batch
rmdir /s /q "%LocalAppData%\Programs\getssh"
```

If `%LocalAppData%` is hijacked by malware to point to `C:\Windows`, this command will recursively delete system directories.

---

### 🟡 [M-14] PTY Process Inherits Full `process.env`

**File**: [ptyHandler.ts:90](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/handlers/ptyHandler.ts#L90)

```typescript
env: process.env as Record<string, string>,
```

The local terminal inherits the **entire environment variables** of the Electron main process, potentially including API tokens and secrets. A filtered subset of `env` should be used.

---

### 🟡 [M-15] `connection_history.json` Lacks Schema Validation

**File**: [sshHandler.ts:121-123](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/handlers/sshHandler.ts#L121-L123)

```typescript
history = JSON.parse(data);
```

External tampering with this file can inject malformed data, affecting log rendering in the renderer process.

---

### 🟢 [L-04] DevTools Menu Enabled in Production

**File**: [index.ts:82](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/index.ts#L82)

```typescript
{ role: 'toggleDevTools' },
```

The macOS menu still contains `toggleDevTools` after production packaging. Users can open DevTools via the menu and directly execute arbitrary JS in the Console (accessing `electronAPI`, `localStorage`, etc.).

---

## Statistics Summary

| Severity Level | Count | Vulnerability IDs |
|---|---|---|
| 🔴 CRITICAL | 6 | C-01 ~ C-06 |
| 🟠 HIGH | 7 | H-01 ~ H-07 |
| 🟡 MEDIUM | 15 | M-01 ~ M-15 |
| 🟢 LOW | 4 | L-01 ~ L-04 |
| **Total** | **32** | |

---

## Remediation Priority Matrix

| Priority | Vulnerability | Remediation Cost | Rationale |
|---|---|---|---|
| **P0 (Immediate)** | C-01 (LFI) | ⬇️ 2 Lines | Add `startsWith()` path validation |
| **P0** | C-03 (safeStorageDecrypt Exposed) | ⬇️ 3 Lines | Remove from Plugin SDK |
| **P0** | C-04 (Windows Biometric Bypass) | ⬇️ 5 Lines | Add system password prompt for Windows platform |
| **P0** | C-05 (File Protocol Navigation / CSP Bypass) | ⬇️ 2 Lines | Tighten `will-navigate` to allow only exact `index.html` matches |
| **P0** | H-01 (XSS→RCE) | ⬇️ 5 Lines | Remove `installPlugin` from preload |
| **P1** | C-02 (Unsandboxed Plugins) | ⬆️ Architectural | Migrate to `vm` sandbox or independent Workers |
| **P1** | C-06 (SFTP OOM) | ⬆️ Medium | Switch to streaming read/write |
| **P1** | H-03+H-04 (CSP+XSS) | ⬆️ Medium | Tighten CSP, remove `unsafe-eval` |
| **P1** | H-05 (initScript Injection) | ⬇️ 5 Lines | Add confirmation prompt or encrypt with safeStorage |
| **P1** | M-12 (Predictable SessionId) | ⬇️ 1 Line | Switch to `crypto.randomUUID()` |
| **P2** | H-02, H-06, H-07 | ⬇️~⬆️ | Conditional exploitation |
| **P3** | Remaining MEDIUM/LOW | — | Handle collectively when appropriate |

> **Total P0 vulnerability fixes require fewer than 20 lines of code and immediately eliminate the most fatal attack vectors.**
