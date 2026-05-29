# 📝 GETSSH Changelog

All notable changes to this project will be documented in this file. The project adheres to Semantic Versioning.

[中文版](CHANGELOG_CN.md) | English

---

## [1.3.2-preview] (Build R7K4S) - 2026-05-28 → 2026-05-29

### 🏗️ Infrastructure Overhaul Phase 1: React 19 Core Engine Hot-Swap
A landmark milestone for GETSSH's technology stack modernization. We have fully migrated the frontend runtime from React 18 to React 19, adopting all new concurrent rendering features and upgrading the UI component library and type system to ensure every future feature ships on the most cutting-edge foundation possible.

### ⚛️ React 19 Core Migration
- **Full React 19.0.0 Upgrade**: `react`, `react-dom`, `@types/react`, and `@types/react-dom` all promoted to `19.0.0+`. The application now runs entirely on the React 19 concurrent rendering model.
- **`forwardRef` Removal Pre-check**: A global codebase scan confirmed zero `React.forwardRef` wrappers remain — the project naturally adapts to React 19's native ref-as-prop paradigm with no migration work required.
- **Entry File Compliance Verified**: Confirmed `main.tsx` uses `ReactDOM.createRoot`, fully compliant with React 19's mandatory API. No legacy `ReactDOM.render` calls remain.
- **React 19 Strict Type Tightening Fix**: Fixed a `useRef<NodeJS.Timeout>()` error in `ConnectForm.tsx` triggered by React 19's stricter generic inference rules. Updated to the canonical `useRef<NodeJS.Timeout | null>(null)` form.
- **Lucide React Latest Upgrade**: Upgraded `lucide-react` to the latest version. All icon import names were validated for compatibility with the new API spec — zero naming conflicts or deprecation warnings.
- **`@testing-library/react` React 19 Alignment**: Simultaneously upgraded the testing library to the latest version, ensuring full API compatibility with React 19.

### 🧹 Physical Dependency Purge & Tree Rebuild
- **Ghost Dependency Extermination**: Completely destroyed the mixed `node_modules` directory and cross-contaminated `package-lock.json`, then executed `npm cache clean --force` to purge OS-level NPM cache — eliminating every last React 18 fragment from the root.
- **Critical `pnpm node-linker=hoisted` Fix**: Diagnosed and resolved a critical runtime crash caused by `pnpm`'s default symlink storage strategy conflicting with Electron's CJS native `require` hook. The `ssh2` internal dependency path resolution was failing (`Cannot find module './constants.js'`). Enforcing `node-linker=hoisted` in `.npmrc` forces `pnpm` to physically hoist packages, perfectly resolving native CJS module path resolution in Electron.
- **Clean Dependency Tree Sealed**: Ran a fresh `pnpm install` from the finalized `package.json`, completing the pure rebuild and sealing the dependency ecosystem.

### 🔒 Plugin SDK v2.0 — Full Security Sandbox Deployment
- **`ctx.net.fetch` Network Bridge**: Safely injected `ctx.net.fetch(url, options)` into the backend plugin Node VM sandbox Context. Plugins must explicitly declare `"net:fetch"` in their `package.json` `capabilities` array — any undeclared call is immediately blocked with a `SecurityError`.
- **Ultimate SSRF Defense Wall**: The underlying fetch interceptor enforces strict DNS/regex dual defense, absolutely blocking any requests to loopback addresses (`127.0.0.1`, `localhost`, `0.0.0.0`) and private IP ranges (`192.168.x.x`, `10.x.x.x`, `172.16.x.x`).
- **`ctx.ui.registerSettings` No-Code Settings Form**: Injected a schema registration API into the controlled `ctx.ui` namespace. Backend plugins can register typed config schemas (`string`, `number`, `boolean`, `password`) during `activate`. The main process syncs schemas to the frontend Zustand Store via `sync-plugin-settings-schema` IPC, dynamically rendering host-styled form components in a dedicated "Plugin Settings" tab in `Settings.tsx` — with live hot-reload on schema updates.
- **`ctx.host.clipboard` Audited Clipboard Access**: Injected `clipboard.writeText` and `clipboard.readText` into the controlled `ctx.host` namespace, bridging directly to Electron's native `clipboard` module. Any `readText` call **forces an OS-native notification** (containing the plugin name) to prevent silent data exfiltration, alongside a full audit log in the main process.
- **`window.GETSSH.registerPanel` / `openPanel` Immersive Panel Views**: Exposed panel registration and open APIs to frontend plugins via the preload script. Added `PluginPanelTab` route type to `sessionStore.ts` and introduced `<webview>` sandboxed full-screen rendering in the `SessionManager.tsx` render tree — enabling plugins to take over the entire main workspace view from the sidebar.

### 🛡️ Full Codebase Security Audit & Bug Fixes
- **IPC Path Traversal Sealed**: Implemented strict file path boundary validation on the `getssh-plugin://` custom protocol handler in `electron/main/index.ts`, intercepting `../../` backtracking attacks and ensuring plugins can only read assets within their authorized directory.
- **Plugin Arbitrary Install Path Vulnerability Fixed**: Added OS-level temp directory legitimacy checks to the plugin install commit path in `PluginManager.ts`, blocking unauthorized directory tampering.
- **SFTP Write Privilege Escalation Defense**: Enforced write path locking in the `sftpHandler.ts` download interface to only allow writes within `Downloads` or `Desktop` directories, preventing malicious plugins from injecting auto-start trojans via the SFTP bridge.
- **TypeScript Zero-Error Seal**: Systematically cleared 70+ legacy TypeScript type errors across `src/types.d.ts` (completing missing `electronAPI` interface definitions), `LeafPane.tsx`, `PluginPane.tsx`, `TerminalPane.tsx`, `SplitPane.tsx`, `App.tsx`, and more core components — achieving a confirmed **zero-error `npx tsc --noEmit`** output.


### 🦀 Four-Zone Rust Native Core Refactoring — 100% Complete
This is a monumental Preview release marking the complete Rust-ification of GETSSH's performance-critical code paths. All four security & performance zones have been fully migrated from Node.js/V8 to Rust N-API native extensions, making GETSSH one of the most security-hardened Electron SSH clients in existence.

### 🦀 Zone 1: Watchdog Process Guardian
- **Rust Standalone Daemon**: `rust-core/watchdog` is a fully independent Rust binary that runs outside the Electron main process, communicating via Unix Domain Sockets (macOS/Linux) and Named Pipes (Windows).
- **60-Second Physical Kill**: If the Watchdog receives no heartbeat within 60 seconds (e.g., the process is frozen or injected), it issues a physical-level `SIGKILL` against the parent process via OS APIs and displays a desktop notification, preventing the app from running in a hijacked state.
- **SAFE MODE Awareness**: If the main process boots in SAFE MODE (post-crash recovery), the Watchdog automatically enters silent mode and will not trigger the kill sequence.
- **Production Path Bridging**: Full `app.isPackaged` dual-path resolution ensures the Watchdog binary is accurately located in both development and packaged production environments.

### 🦀 Zone 2: Vault Local Credential Encryption Engine
- **`getssh-vault` N-API Extension**: Rust encryption logic compiled into a `.node` native extension via `@napi-rs`, loaded directly by the Electron main process.
- **AES-256-GCM Hardware-Grade Encryption**: Uses the Rust `aes-gcm` crate to perform physical-level encryption and decryption of local `profiles.enc`, eliminating potential vulnerabilities in Node.js's `crypto` module.
- **Master Password + Biometric Dual Gate**: `cryptoHandler.ts` integrates full master password validation and `systemPreferences.promptTouchID` biometric authentication.

### 🦀 Zone 3: Sysprobe System Metrics Probe
- **`getssh-sysprobe` N-API Extension**: Uses Rust's `sysinfo` crate to collect CPU, memory, network, and disk metrics directly at the OS level.
- **Eliminated `node:os` Dependency**: Ended `systemHandler.ts`'s reliance on `node:os` polling. System metrics no longer pass through the V8 string serialization layer — throughput efficiency is massively improved with zero UI jank.

### 🦀 Zone 4: Hybrid SFTP Engine
- **`sftp-stream` Zero-Copy N-API Engine**: `rust-core/sftp-stream` takes over the heaviest disk I/O during file uploads and downloads.
- **Node-Rust Pipeline Bridge**: Network `Buffer` data from `ssh2` is consumed directly in Rust and streamed to disk, completely bypassing V8 string parsing — a true "Node handles networking, Rust handles heavy I/O" dual-engine architecture.
- **Large File Download Confirmation**: Before initiating a pure-download, the user is shown the file's size and must confirm, preventing accidental downloads of large files.

### 🔥 Exterminating the adm-zip Memory Tumor (getssh-unarchive)
- **New `getssh-unarchive` Rust N-API Extension**: Completely replaces the pure-JS `adm-zip` library in `PluginManager.ts`, whose full in-memory approach was a time-bomb OOM waiting to detonate.
- **Zero-Copy Streaming Extraction**: Uses Rust's `zip` crate and `std::io::copy` to stream files from archives directly to disk, **never touching JavaScript/V8 heap memory**. Memory peak stays under 10MB regardless of archive size.
- **Military-Grade Zip Slip Defense**: Every archive entry path is rigorously validated in Rust. If any path traversal sequence (`../`) or absolute root prefix is detected, the extraction **immediately trips a circuit breaker**, physically destroys all already-extracted debris files, and throws a hard error — completely sealing the Zip Slip attack vector.
- **`tokio` Async Non-Blocking Extraction**: Extraction runs inside `tokio::task::spawn_blocking`, keeping the Electron main process and renderer completely responsive throughout.

### 🔒 Security & Lock UX Improvements
- **CommandCenter One-Tap Lock Button**: Added a "Lock Profile" button to the WelcomePane command center. Users can now manually trigger a lock at any time without waiting for the timeout timer.
- **Smart Disabled State**: When no master password is set, the "Lock Profile" button is automatically grayed out with a tooltip guiding the user to configure their security settings.
- **CryptoModal Full i18n**: The lock and unlock screens in `CryptoModal` now fully integrate `react-i18next`, supporting seamless Chinese/English switching with zero hardcoded English strings remaining.
- **Gaussian Blur Privacy Shield on Lock**: When the lock screen is triggered, the background is immediately overlaid with a 40px-strength Gaussian blur (applied via inline styles to reliably bypass Tailwind JIT thermal behavior), protecting sensitive server information from bystander view.
- **Global Crypto State (Single Source of Truth)**: `cryptoMode`, `masterPassword`, and related state have been migrated from `App.tsx` local state into the `useCryptoStore` Zustand global store, ensuring all UI components (CommandCenter, CryptoModal) share a consistent, real-time view of authentication state.

### 📦 Cross-Platform Production Packaging
- **ASAR Physical Ejection**: Added `"asarUnpack": ["**/*.node"]` to `electron-builder` config, ensuring all Rust N-API native extensions are ejected from the `app.asar` virtual filesystem into the physical `app.asar.unpacked` directory, permanently eliminating dynamic library loading failures in packaged builds.
- **Watchdog Binary Injection**: `extraResources` config ensures the pre-compiled `watchdog` binary is injected verbatim into the final package's `resources` directory.
- **macOS Hardened Runtime & Signing Prep**: Enabled `hardenedRuntime: true` and created `build/entitlements.mac.plist` with `com.apple.security.cs.allow-unsigned-executable-memory` (V8 JIT compatibility) and `com.apple.security.cs.disable-library-validation` (allows loading self-compiled Rust `.node` extensions), perfectly circumventing macOS 10.15+ Gatekeeper crashes.
- **Dependency Cleanup**: Completely removed `adm-zip` and `@types/adm-zip` from the project root, further purifying the dependency tree.

---

## [1.3.1] (Build K9V2X) - 2026-05-21


### 🎉 The First Multi-Protocol Era
This release marks a historic milestone for GETSSH, evolving from a standard SSH client into a **full-spectrum multi-protocol terminal platform**. We have pioneered a Smart Protocol Detection engine that drastically lowers the learning curve for beginners. Simply type intuitively (like entering `localhost`), and the system magically sniffs your intent, automatically routing and binding the correct underlying protocol instantly!

### 🛠️ Native PTY & Multi-Protocol Routing
- **Native Local Shell (PTY) Integration**: We completely abandoned the pseudo-local approach of forcing SSH loops over `::1`. A brand new `ptyHandler.ts` native process gateway has been developed, directly spawning OS-native Bash / Zsh / PowerShell within the Electron Node process. This permanently eliminates the notorious `connect ECONNREFUSED ::1:22` errors, granting you zero-latency, full-privileged local terminal access.
- **Schema Persistence Hotfix**: Deeply patched a critical vulnerability in `profileHandler.ts` where the `protocol` parameter was lost during profile serialization. All protocol preferences (SSH, Local, Telnet) are now meticulously preserved across application restarts.
- **Smart Protocol Lock for New Sessions**: Completely overhauled the auto-detection engine in `ConnectForm.tsx`. Protocol auto-switching (e.g., typing `localhost` to switch to Local) now exclusively triggers for "unsaved new sessions". Once saved, the protocol is permanently locked, preventing catastrophic protocol overwrites when editing hostnames.
- **100% Protocol State Binding**: Fixed an issue where rapidly switching between hosts with different protocols in the sidebar failed to visually update the form UI and highlight states.

### 🎨 Obsidian Aesthetics & Layout Optimization
- **Monochrome Geek Filter & Active Awakening**: Forced a cool, desaturated filter (`filter saturate-0`) on all OS icons (Ubuntu, Windows, Debian, etc.) in the sidebar by default, allowing them to perfectly stealth into the deep Obsidian UI. When a host is connected, the system immediately "breaks the seal", injecting the high-saturation original brand colors (`saturate-100 opacity-90`) as a striking visual reward.
- **Shrink-Proof Framework Reinforcement**: Forged a cool-grey, right-angled exclusive border (`bg-black/20 border border-black/30 rounded-none`) for the OS badges, strictly injecting the `shrink-0` gene. Even with ridiculously long server names, the system badges remain rigid and immune to any distortion.
- **Command Center (WelcomePane) Alias Escalation**: Refactored the rendering logic for startup cards. The WelcomePane no longer displays cold IP addresses; instead, it **strictly prioritizes displaying your carefully crafted Aliases**, making the management of hundreds of servers vastly more intuitive.
- **Physical Sidebar Expansion**: Heeding the calls of our DevOps power users, we physically widened the left host list panel by 25%. This grants enterprise-grade server naming conventions much more breathing room, drastically reducing text overflow truncation.

### ⚙️ Background Updater Engine Refactoring
- **Hardcore Regex SemVer Extraction**: Completely scrapped the fragile `split('.')` string slicing approach in the updater module. The newly introduced regex engine `v.match(/(\d+)\.(\d+)\.(\d+)/)` easily bypasses noise like `V.` prefixes or `_K9V2X` suffixes, surgically extracting the core semantic version.
- **IPC Payload Alignment**: Fixed a deceptive bug where clicking "Check for Updates" in Settings always claimed "Already the latest version". The backend now strictly adheres to the `{ hasUpdate, version, url }` data schema when transmitting detection reports via IPC, accurately triggering new version discovery modals.

### 🌐 i18n Completion & Hidden Hotfixes
- **Complete Settings Panel Localization**: Eliminated all remaining hardcoded English fragments across the "Settings - Terminal" and "Settings - About" panels.
- **Auto-Start Proxy Dispatch**: Patched a hidden flaw where enabling Auto-Start dropped the `proxyPort` parameter, causing proxy configurations to fail during silent boot.
- **Anti-Tampering Tag Injection**: Restored the missing semantic version `v1.3.1` in the About panel, pairing it with the build code `K9V2X` to construct an impenetrable version tracking wall.

---

## [1.2.1] - 2026-05-05

### 🚀 Architecture Refactoring & Productivity Leap
- **Extreme Main Process Modularization**:
  - Dismantled the bloated `electron/main/index.ts` (reduced from ~700 to ~250 lines).
  - Abstracted `ConnectionManager`, `sshHandler`, `sftpHandler`, and `cryptoHandler` into independent modules.
- **Comprehensive SFTP Completion**:
  - **Native Creation Support**: Added "New File" and "New Folder" functions using native React Modals instead of system Prompts.
  - **Address Bar Navigation**: Address bar now supports click-to-edit absolute path jumps.
  - **Symlink Support**: Fixed SFTP symbolic link icon rendering and traversal.
- **Silent Updates & Notifications**:
  - Implemented a fully automated background version checker. New updates trigger a red badge in the sidebar and a lightweight Toast notification.
  - Optimized regex for seamless GitHub API `V`-prefix parsing.

### 🐛 Bug Fixes
- **SFTP Directory Parsing**: Fixed file list rendering failures on Oracle Cloud Ubuntu instances.
- **Symlink Support**: Fixed navigation into symbolic link directories.
- **Update Algorithm Correction**: Fixed `compareSemVer` logic handling GitHub tag case-sensitivity.
- **Interaction Deadlocks**: Replaced macOS-hanging `window.prompt` calls with controlled React Modals.
- **Connection Stability**: Improved SSH heartbeat mechanics for shaky network environments.

---

## [1.2.0] - 2026-05-03

### 🚀 Production Ready
This is the most critical milestone in GETSSH history. We have reached the pinnacle of aesthetic design, while significantly upgrading the kernel architecture, security, and production bundle size.

### ⚡ Core Performance & I/O Revolution
- **Fully Asynchronous File System**:
  - Completed `PluginManager` refactoring from synchronous blocking `fs` to asynchronous `fs.promises`.
  - **Install/Uninstall Boost**: Eliminated UI freezing during massive plugin operations.
- **Auto-Start Logic Fix**:
  - Fixed ignoring session-specific ports on startup.

### ⚠️ State Modernization
- **Zustand Full Migration (Single Source of Truth)**:
  - Migrated `App.tsx` from `useState` to a global Zustand state tree.
  - Eliminated "State Islands", guaranteeing real-time consistency across Tabs, Sessions, and Configs.
- **Zero-Loss Terminal Persistence**:
  - Adopted a "CSS Persistent Mount" strategy, keeping terminal DOM instances alive across page routing.

### 🔒 Ironclad Security Hardening
- **Zip Slip & Path Traversal Prevention**: Retained strict boundary checks in asynchronous I/O modes.
- **SVG XSS Filtering**: Deep-scanned plugin icons using `DOMParser` to intercept XSS vectors.
- **Iframe Sandbox Isolation**: Stripped `allow-same-origin` from plugin runtimes for physical API isolation.

### 📦 Bundling & Size Optimization
- **Magic Bundle Shrink**: Reduced macOS size from ~450MB to **~83MB**.
- **Extreme Compression**: Applied `maximum` level ASAR compression.

---

## [1.1.0] - 2026-04-20
### ✨ Features
- **Multilingual System (i18n)**: Introduced full i18n support.
- **Enhanced SFTP**: Added drag-and-drop uploads, real-time renaming, and chmod support.
- **Auto-Start**: Start specific SSH tunnels automatically on app launch.

---

## [1.0.0] - 2026-04-10
### ✨ Initial Release
- **Core SSH Engine**: Based on xterm.js and ssh2.
- **SafeStorage**: AES-256 local credential encryption using Master Password.
- **Responsive UI**: Dynamic Dark/Light mode switching.

---

> "From monoliths to secure sandboxes, GETSSH is dedicated to building the most hardcore productivity tools."
