# 🚀 GETSSH | Next-Generation SSH Client

[中文版](README.md) | English

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![Electron](https://img.shields.io/badge/Electron-47848F?style=flat-square&logo=electron&logoColor=white)](https://electronjs.org/)
[![Zustand](https://img.shields.io/badge/State-Zustand-orange?style=flat-square)](https://github.com/pmndrs/zustand)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg?style=flat-square)](LICENSE)

**GETSSH** is a next-generation, cross-platform **SSH / SFTP client** built for developers who demand peak efficiency, industrial-grade security, and state-of-the-art modern aesthetics.

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
