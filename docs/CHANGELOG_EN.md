# 📝 GETSSH Changelog

All notable changes to this project will be documented in this file. The project adheres to Semantic Versioning.

[中文版](CHANGELOG_CN.md) | English

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
