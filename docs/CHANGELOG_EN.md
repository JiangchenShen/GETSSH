# 📝 GETSSH Changelog

All notable changes to this project will be documented in this file. The project adheres to Semantic Versioning.

[中文版](CHANGELOG_CN.md) | English

---

## [1.3.1] (Build K9V2X) - 2026-05-21

### 🛠️ Multi-Protocol Routing & Decoupling
- **Smart Protocol Lock for New Sessions**: Optimized `ConnectForm.tsx` to execute auto-detection logic exclusively on unsaved (new) sessions. This prevents users' stored protocols from being overwritten when editing or toggling saved hosts.
- **Protocol State Binding**: Solved the issue where the `protocol` state failed to synchronize when switching saved sessions in the sidebar, achieving 100% state alignment.
- **Schema Persistence Hotfix**: Fixed a vulnerability in `profileHandler.ts` where `protocol` options were not serialized. This resolves a critical bug where protocol configurations were lost after restarting, reverting to default SSH.
- **Native Local PTY Support**: Completely refactored the connection mechanism for local terminals. The previous approach of connecting via localhost SSH (which caused `connect ECONNREFUSED ::1:22` errors) has been replaced. GETSSH now directly spawns native PTY pseudo-terminal processes (`ptyHandler.ts`) in the Electron backend, providing a flawless local shell experience for power users.

### 🎨 OS Logo Visual Refactoring & Layout Optimization
- **Monochrome Geek Filter**: Forced a desaturation filter (`filter saturate-0`) on all OS icons by default, perfectly blending them into the Obsidian UI theme. When a session is selected/active, the high-saturation original brand colors (`saturate-100 opacity-90`) are injected as visual feedback.
- **Framing & Sizing Adjustments**: Added a cool-grey right-angled border container (`bg-black/20 border border-black/30 rounded-none`), magnifying the icon to 20px. By enforcing `shrink-0`, system icons remain rigid and distortion-free even when long server names are truncated.
- **Sidebar Width Enhancement**: Increased the left host list panel width by 25%, providing a broader display area for long hostnames and significantly reducing overflow truncation rates.

### 🌐 i18n Additions & About Panel Updates
- **Terminal Settings Localization**: Completed full Chinese/English i18n translation for the "Settings - Terminal" configuration page.
- **About Panel Version Injection**: Restored the missing semantic version `v1.3.1` in the About panel, which now pairs with the build code `K9V2X` as a complete anti-tampering tracking tag.

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
