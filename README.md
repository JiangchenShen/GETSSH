# GETSSH

[中文版](README_CN.md) | English

[![Version](https://img.shields.io/badge/version-2.0.0--preview-blueviolet?style=flat-square)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-007ACC?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![Electron](https://img.shields.io/badge/Electron-42-47848F?style=flat-square&logo=electron&logoColor=white)](https://electronjs.org/)
[![Rust](https://img.shields.io/badge/Rust-N--API-CE4A00?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue?style=flat-square)](LICENSE)
[![Changelog](https://img.shields.io/badge/Changelog-v2.0-brightgreen?style=flat-square&logo=gitbook)](docs/CHANGELOG_EN.md)

**GETSSH** is a next-generation cross-platform SSH terminal client built for developers and DevOps engineers. It is designed around three uncompromising principles: **military-grade physical security**, **a GPU-accelerated terminal experience**, and **a Glassmorphism UI that makes you actually want to open your terminal**.

Under the hood, GETSSH v2.0 is a full **TypeScript + Rust** hybrid. Five Rust native addons handle everything your CPU and memory care about most — cryptography, file I/O, system monitoring, and the physical-level watchdog daemon — while React 19 and Electron 42 handle the rest with an architectural discipline that keeps startup time low and renders butter-smooth.

📢 **[View Full Changelog (v2.0)](docs/CHANGELOG_EN.md)**

---

## ✨ What's New in v2.0

v2.0 is a ground-up architectural overhaul — not just a feature release:

- 🦀 **Full Rust Native Core** — Five production Rust N-API addons replace the entire JS-layer crypto, SFTP I/O, and system monitoring stack
- 🛡 **Six-Layer Physical Security Architecture** — Watchdog daemon, AES-256-GCM Vault, Zeroize memory scrubbing, Zero-copy network engine, RASP runtime defense, and native memory integrity scanning
- 🔒 **32 Security Vulnerabilities Fixed** — Full internal security audit covering Critical, High, Medium, and Low severity findings, all resolved
- ⚛️ **React 19 + Electron 42** — Rebuilt on the latest stable foundation
- 🎨 **Tailwind CSS v4** — Complete style system overhaul

---

## 🖥 Screenshots

> *Glassmorphism dark mode with split-pane terminal sessions and the Security Center RASP dashboard.*

---

## 🔒 Security Architecture

GETSSH v2.0 implements a **six-layer defense-in-depth architecture** extending from the OS kernel to the application layer:

| Layer | Component | What It Does |
|---|---|---|
| **1. Rust Watchdog** | `rust-core/watchdog` — standalone binary | Runs independently from Electron. Monitors the main process via IPC heartbeat. If the heartbeat is missed for >5s, it calls OS-level APIs to forcibly kill the entire Node.js process — bypassing JavaScript entirely. |
| **2. Memory Zeroize** | `getssh-vault` Rust N-API | All AES keys and decrypted credential buffers are wrapped in `ZeroizeOnDrop`. TypeScript's `finally` blocks call `buffer.fill(0)` as a second pass. No plaintext ever lingers in heap. |
| **3. Crypto Vault** | `getssh-vault` Rust N-API | AES-256-GCM authenticated encryption. Key derived via PBKDF2-HMAC-SHA256 with 100,000 iterations and a 32-byte salt (NIST SP 800-132). V2 format with magic header for safe migration. |
| **4. Zero-Copy Network** | `sftp-stream` Rust N-API | SFTP large-file transfers bypass the V8 heap entirely. Rust owns the disk I/O. No OOM from large file transfers. |
| **5. RASP Defense** | `SecureCenter.ts` | Runtime Application Self-Protection. Audits plugin shell commands for fork bombs, `rm -rf /`, `mkfs`, and disk-destroying `dd`. Triggers the Watchdog lockdown protocol on detection. |
| **6. Memory Scanner** | `getssh-sysprobe` Rust N-API | Periodically validates the first bytes of critical system function memory to detect Inline Hook attempts. Requires elevated privileges. |

### IPC Security

All `ipcMain.on` and `ipcMain.handle` calls are globally patched to reject any request originating from a sub-frame (`event.senderFrame.parent !== null`). Plugin iframes cannot escape their sandbox to call privileged IPC channels.

### Plugin Sandbox

Plugin UIs run inside `<iframe sandbox="allow-scripts">` — `allow-same-origin` is explicitly removed. `PluginBridge` validates every `postMessage` against the originating iframe's `contentWindow`. Dangerous actions (`sshWrite`, `saveProfiles`, `sftpDelete`, etc.) are on a permanent blocklist.

---

## 🧩 Plugin System

GETSSH has a dual-mode plugin architecture:

- **Main-process plugins** — Run as sandboxed `vm.Script` contexts in the Electron main process. They get a capability-gated API: `ssh:read`, `ssh:write`, `storage`, `clipboard`, `notification`, etc. Each capability must be declared in `package.json` and approved by the user at install time.
- **Renderer plugins** — Run as sandboxed iframes. They communicate via a typed RPC bridge with `BLOCKED_ACTIONS` enforcement.

**Extension Points:**
- `registerSidebarAction` — Inject custom sidebar buttons (SVG sanitized via DOMPurify)
- `registerPanel` / `openPanel` — Register and open custom panels as Pane Tree nodes
- `registerUIExtension` — Add actions to terminal right-click menus and SFTP toolbars
- `registerSettingsSchema` — Inject a custom settings UI into the settings panel
- `pluginStorage` — Isolated KV store per plugin (`getssh-kv` Rust module)
- `onSysmonData` — Subscribe to live CPU/memory/network data from the Rust sysprobe

---

## ⚡ Core Features

### Multi-Protocol Terminal

- **SSH** — `ssh2` library, password and private key auth, SOCKS5/HTTP proxy support
- **Local Shell** — `node-pty`, macOS (Zsh/Bash), Windows (PowerShell), shell allowlist enforcement
- **Telnet** — Raw `net.Socket` with NVT negotiation, forced `vt100` termType for network gear
- **Protocol auto-detect** — `ssh://`, `telnet://`, `user@host` format parsed on input

**Terminal Engine:** `xterm.js` v6 with WebGL rendering (canvas fallback), ligatures, configurable fonts/colors/cursor/scrollback/bell, anti-glare mode.

**Split Pane Architecture:** Recursive binary tree (`PaneNode`). Any leaf can be independently split horizontally or vertically to arbitrary depth. Each pane independently holds a terminal session, a plugin panel, or the Command Center welcome screen.

### SFTP File Manager

- Dual-mode uploader/downloader via Rust `sftp-stream` (Zero-copy, no V8 heap involvement for large files)
- File read limit: **10MB** for in-app preview (prevents OOM). No size limit for pure downloads.
- Real-time local edit sync — double-click to open in your default editor, auto-uploads on save
- Atomic write (`rename()` from UUID-suffixed temp file) prevents partial-write corruption
- Full `path.posix.normalize()` path traversal defense on all remote paths

### Command Center

A Raycast/Spotlight-style launcher: full-text fuzzy search across all saved sessions (alias/host/username), keyboard-driven navigation (↑/↓/Enter/Esc), one-line `user@host` quick connect without saving a profile first. Security warnings from the Watchdog appear as inline banners.

### SafeStorage Credential Vault

- Rust `getssh-vault`: PBKDF2 (100k iterations) + AES-256-GCM, two format versions with auto-migration
- `Electron.safeStorage` protects the master password at rest (macOS Keychain / Windows DPAPI)
- Touch ID biometric unlock on macOS for passwordless app launch
- Sensitive config fields (`initScript`, `proxyHost`, `proxyPort`) encrypted separately via `safeStorage` and stored outside the main localStorage key
- Auto-lock: idle timeout triggers master password screen; Zustand `cryptoStore` is cleared on lock

### Known Hosts & MITM Protection

- SHA256 fingerprint verification on first connect
- Changed fingerprint detection triggers a high-severity MITM warning overlay with old/new comparison
- Full revocation management in Settings → Security → Known Hosts

### Audit Logs

Read-only connection metadata logging (alias, host, connected/disconnected timestamps, duration). No terminal content is ever captured. CSV export available.

---

## 🛠 Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Desktop Shell | Electron | 42.x |
| Frontend | React + TypeScript | 19.x + 6.x |
| Build | Vite + vite-plugin-electron | 8.x |
| Styling | TailwindCSS | v4.x |
| State | Zustand | 5.x |
| SSH/SFTP | ssh2 | 1.x |
| Local Terminal | node-pty | 1.x |
| Terminal Render | xterm.js + WebGL | 6.x |
| Crypto Core | Rust (getssh-vault) | AES-256-GCM + PBKDF2 |
| System Monitor | Rust (getssh-sysprobe) | sysinfo crate |
| SFTP Engine | Rust (sftp-stream) | Zero-copy N-API |
| Plugin Storage | Rust (getssh-kv) | Isolated KV |
| Unarchiver | Rust (getssh-unarchive) | ZipSlip-hardened |
| Watchdog | Rust (standalone binary) | OS-level kill |
| i18n | react-i18next | en-US, zh-CN |
| DOM Security | DOMPurify | 3.x |
| Testing | Vitest + Playwright | Unit + E2E |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 18.x
- **pnpm** ≥ 9.x
- **Rust toolchain** (for building native modules) — `rustup` recommended

### Development

```bash
# Clone
git clone https://github.com/JiangchenShen/GETSSH.git
cd GETSSH

# Install dependencies
pnpm install

# Build the Rust Watchdog binary (required for SecureCenter)
pnpm run build:watchdog

# Start Vite dev server + Electron with HMR
pnpm run dev
```

> **Note:** The five Rust `.node` addons (`getssh-vault`, `getssh-sysprobe`, `sftp-stream`, `getssh-kv`, `getssh-unarchive`) ship pre-compiled for macOS arm64/x64. If you are on Windows or Linux, you need to rebuild them with `napi build --release` inside each `rust-core/*` directory.

### Build Distributable

```bash
# Build all Rust components + Vite bundle + electron-builder package
pnpm run build

# Platform-specific builds
pnpm run build -- --mac      # macOS DMG (ULFO) — x64 + arm64
pnpm run build -- --win      # Windows NSIS — x64 + arm64
pnpm run build -- --linux    # Linux AppImage — x64 + arm64
```

---

## ⚖️ Why GETSSH?

| | **GETSSH** | Termius | Tabby | iTerm2 |
|---|---|---|---|---|
| **Security** | Rust AES-256-GCM + Watchdog daemon + RASP + Zeroize | Closed-source cloud sync | Open source, no hardware security | Open source, no encryption layer |
| **SFTP** | Zero-copy Rust engine, real-time local edit sync | Paid tier only | Basic | Requires plugin |
| **Architecture** | TS + Rust hybrid, 6 native addons | Proprietary | Electron + TS | Objective-C |
| **Plugins** | Dual-mode sandbox (vm.Script + iframe), capability-gated | Limited | Theme-focused | Scripting API |
| **Price** | **Free & Open Source** | Subscription | Free | Free (macOS only) |

---

## 🗺 Roadmap

- [ ] **v2.1** — CSP `unsafe-eval` full removal · Windows code signing · Workspace isolation (multi-vault)
- [ ] **v2.2** — Plugin Marketplace · SSH Jump Host (ProxyJump) · In-terminal search
- [ ] **v2.3** — Cluster broadcast (send command to N sessions simultaneously) · SSH config file import

---

## 🛡 Privacy Statement

Everything stays local. SSH private keys, passwords, session logs, and connection metadata **never leave your machine**. GETSSH has no analytics, no telemetry, no cloud account, and no network calls except the GitHub Releases API for update checks.

---

## 📄 License

Copyright © 2026 Jiangchen Shen. Licensed under the [Apache License 2.0](LICENSE).
