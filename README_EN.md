# 🚀 GETSSH | Next-Generation SSH Client

[中文版](README.md) | English

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![Electron](https://img.shields.io/badge/Electron-47848F?style=flat-square&logo=electron&logoColor=white)](https://electronjs.org/)
[![Zustand](https://img.shields.io/badge/State-Zustand-orange?style=flat-square)](https://github.com/pmndrs/zustand)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg?style=flat-square)](LICENSE)
[![Changelog](https://img.shields.io/badge/Changelog-V1.2.1--Updates-brightgreen?style=flat-square&logo=gitbook)](UPDATE.md)

**GETSSH** is a next-generation, cross-platform **SSH / SFTP client** built for developers who demand peak efficiency, industrial-grade security, and state-of-the-art modern aesthetics.

📢 **[View Latest Changelog (Update Log)](UPDATE.md)**

We break away from the dull, rigid constraints of traditional terminal tools by pairing a meticulously crafted **Glassmorphism design** with zero-knowledge cryptographic credential protection. Under the hood, GETSSH features a highly optimized, low-latency micro-component architecture to provide an unprecedented remote development and server management experience.

---

## ✨ Core Features

### 💎 1. Glassmorphism Visual Aesthetics
- **Immersive Frosted Glass**: Meticulously designed with modern frosted glass and physical acrylic textures to present a premium, elegant visual hierarchy.
- **Dynamic Custom Opacity**: Real-time, seamless adjustments for background transparency and blur, blending beautifully with any desktop wallpaper.
- **Fluid Micro-interactions**: Every button, card, and sidebar is packed with buttery-smooth transition animations and hover effects, making every click highly responsive and satisfying.

### 📁 2. Full-Featured SFTP File Management System
*GETSSH integrates a high-performance, developer-focused SFTP management suite, liberating you from tedious CLI file manipulation:*
- **🫳 Native Drag-and-Drop**: Effortlessly upload files and folders by dragging them directly into the remote SFTP file panel, and download them by dragging them back.
- **✏️ Interactive Local Editing & Sync**: Open and edit remote configuration files or code locally with your favorite editor; GETSSH automatically uploads changes silently on save and performs secure temporary file cleanup on close.
- **🔍 Dual-Mode Address Bar Navigation**:
  - *Breadcrumbs Mode*: Visual path navigation with one-click upward folder jumping.
  - *Editable Mode*: Click the empty space to toggle an absolute path input box (e.g., `/home/ubuntu/project`), type, and press `Enter` to navigate instantly.
- **📁 Creation & Symbolic Link Support**: Create new files and directories directly within SFTP using a gorgeous, fully-controlled React Modal, with built-in indicators and seamless double-click traversal for Symbolic Links (Symlinks).

### 🖥️ 3. GPU-Accelerated Terminal Kernel
- **Ultra-Fast Performance**: Driven by the native `xterm.js` core with hardware-accelerated GPU rendering, maintaining flawless performance even during intense text-heavy outputs.
- **Modern Tabbed Sessions**: Switch between terminal tabs just like a modern web browser—maintain parallel sessions without having to reconnect constantly.
- **Intelligent Keep-Alive**: Built-in heartbeat detection and main-process keeping, ensuring that your background terminal sessions never drop when switching windows.

### 🔒 4. Zero-Knowledge Local Cryptographic Defense
- **Full AES-256 Encryption**: Your server connection profiles are fully encrypted locally using the robust AES-256 algorithm, driven entirely by your Master Password.
- **Absolute Ownership**: There are no cloud servers and no password-recovery backdoors. **Keep your Master Password safe**; without it, even the developers cannot access or decrypt your credentials.
- **Context-Isolated Plugin Sandbox**: All plugins run in a strictly-isolated context sandbox (Iframe Sandboxing) communicating via an IPC whitelist gateway, keeping high-privilege credentials like private keys completely safe from leaks.

### 🧩 5. Dynamic Grid Splitting & Extensible Plugin Ecosystem
- **Responsive Split Layout**: Built on a flexible grid splitter, allowing you to display Terminals, SFTP view, and monitor panels side-by-side at any custom sizing.
- **Hot-Pluggable Plugins**: Third-party plugins can easily mount onto the bottom or right sidebar, offering limitless possibilities for your remote server workflows.

### ⚡ 6. Ultra-Lightweight: Why is our Electron footprint so small?
Many developers associate Electron with "memory bloating" and "slow startup." In GETSSH, we completely break this stereotype through cutting-edge technology and minimalist design patterns:
- **Atomized Micro-Component Design**: The frontend view layer is deeply modularized, eliminating unnecessary global component re-renders. Combined with **Zustand's minimal state topology** and Selective Selectors, high-frequency data updates only re-render target atomic nodes, slashing memory and CPU overhead by up to 70%.
- **Fully Asynchronous, Non-Blocking I/O**: Core functions like plugin loaders and AES decryption have been entirely refactored into asynchronous streams (`fs.promises` and non-blocking `crypto.pbkdf2`), completely freeing up Node's main thread and avoiding any renderer lag.
- **Zero-Redundancy Bundling**: Rejecting bloated dependencies, all resources undergo rigorous Tree Shaking by Vite and esbuild, stripping away unused code for sub-second startup speeds and a featherweight bundle size.

---

## 💡 Why We Built GETSSH? (Our Open-Source Philosophy)

As developers and DevOps engineers working daily with remote servers, we found ourselves constantly forced to make frustrating compromises with existing tools:
- *Either they are fully featured but painfully ugly, looking like software from the 90s*;
- *Or they look nice but are bloated, laggy, or locked behind expensive monthly/annual subscription models*;
- *Or they are closed-source, raising serious security questions about whether private keys are secretly uploaded to external servers*.

We firmly believe that **great tools should be shared freely among developers, not held hostage behind paywalls.** 
That's why we created **GETSSH**—delivering a tool that is **100% open-source**, protected by **zero-knowledge local encryption**, and uncompromised in both aesthetic design and lightning-fast performance, returning sovereignty over credentials and digital assets back to the developers.

---

## ⚖️ Comparison: Why Choose GETSSH?

| Dimension | **GETSSH** (This Project) | **Termius** | **Tabby** | **PuTTY** |
| :--- | :--- | :--- | :--- | :--- |
| **Aesthetics** | **Exquisite Glassmorphism** | Modern flat but conventional | Customizable but heavy | Extremely outdated (classic UI) |
| **Startup & RAM** | **Microsecond-level startup, ultra-low RAM** | Fast startup, medium RAM | Slow startup, high RAM usage | Instant startup, ultra-low RAM |
| **SFTP Experience** | **Full (Drag-and-Drop + Local Live Edit)** | Locked behind paid Premium | Very basic features | No built-in graphical SFTP |
| **Privacy Security**| **Open Source, Zero-Knowledge Local AES** | Closed source, cloud syncing risks | Open source but heavy | Open source, no modern encryption |
| **Value** | **100% Free and Open Source** | Expensive monthly/annual plans | Free | Free |

---

## 🗺️ 2.0 Roadmap: Where We Are Headed

GETSSH is expanding rapidly, and we are working hard on several major milestones:
- 🌐 **WebSSH Support**: Access light remote connection management directly inside any standard web browser.
- 🔌 **Plugin SDK 2.0**: Exposing comprehensive dynamic UI mounting APIs, high-privilege bridging, and fully isolated sandbox runtimes, allowing anyone to build custom themes, protocols, and automation tools.
- ⚡ **Cluster Command Automation**: Broadcast commands to multiple servers simultaneously in split-screen mode for rapid, synchronized multi-host management.

---
---

## 🛠 Tech Stack

| Category | Solution | Purpose & Value |
| :--- | :--- | :--- |
| **App Shell** | **Electron** | Cross-platform desktop integration and main process performance |
| **State Engine** | **Zustand** | Multi-dimensional state topology with precise, selective component re-renders |
| **Front-End View** | **React 18 + TS** | Type-safe, reusable micro-components for maximum maintainability |
| **Styling** | **Vanilla CSS & Tailwind** | Atomic CSS utility meets absolute design system freedom |
| **Bundling** | **Vite + esbuild** | Near-instant hot reloading in development and ultra-compact production sizes |
| **Terminal Core** | **xterm.js** | Native-grade terminal rendering with high-throughput text capabilities |

---

## 🚀 Quick Start

### 1. Prerequisites
Ensure you have **Node.js (>= 18.x)** and npm installed.

### 2. Run Locally
```bash
# 1. Clone the repository
git clone https://github.com/JiangchenShen/GETSSH.git
cd GETSSH

# 2. Install dependencies
npm install

# 3. Spin up development mode (Vite HMR)
npm run dev
```

### 3. Build Desktop App
Due to our architecture-specific build configuration, you can compile highly optimized, minimal installers for your specific machine:
```bash
# Build macOS DMG (both Apple Silicon & Intel)
npm run build -- --mac

# Build Windows Setup EXE (both x64 & ARM64)
npm run build -- --win

# Build Linux AppImage & Debian package
npm run build -- --linux
```

---

## 🛡 Security & Privacy

We strongly believe that productivity tools should respect your digital sovereignty. All of your SSH private keys, credentials, and session logs **never leave your local machine**. We do not, and will never, collect or harvest any of your sensitive information.

---

Copyright © 2026 Jiangchen Shen. Licensed under [Apache License 2.0](LICENSE).
