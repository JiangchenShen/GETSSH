# 🚀 GETSSH | Next-Generation SSH Client

[中文版](README.md) | English

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![Electron](https://img.shields.io/badge/Electron-47848F?style=flat-square&logo=electron&logoColor=white)](https://electronjs.org/)
[![Zustand](https://img.shields.io/badge/State-Zustand-orange?style=flat-square)](https://github.com/pmndrs/zustand)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg?style=flat-square)](LICENSE)
[![Changelog](https://img.shields.io/badge/Changelog-V1.2--Updates-brightgreen?style=flat-square&logo=gitbook)](UPDATE.md)

**GETSSH** is more than just an SSH client; it is a modern remote management platform built for developers who demand peak efficiency and ultimate security. In V1.2, we have completed a comprehensive evolution of our core architecture, moving from a monolithic structure to a micro-component architecture and introducing industrial-grade security isolation.

📢 **[View Latest Updates (Changelog)](UPDATE.md)**

---

## 💎 V1.2 Architecture Highlights (The Epic Refactor)

### 🏗️ Micro-component Architecture (Monolith to Micro-components)
We have completely decoupled the legacy 900+ lines of `App.tsx` logic. GETSSH is now built like LEGO from highly autonomous micro-components:
- **Logic Decoupling**: View layers and business logic are fully separated, communicating through atomic Stores.
- **Dynamic Orchestration**: The main App body has evolved into a lightweight orchestrator, significantly improving maintainability and development speed.

### 🧠 Modern State Management (Global State with Zustand)
Introduced **Zustand** as the global state driving engine, building a responsive data flow topology:
- **Multi-dimensional Storage**: `appStore`, `sessionStore`, `cryptoStore`, and `panelStore` each manage specific domains.
- **Extreme Performance**: Leverages Zustand's selector mechanism for precise component-level re-renders, eliminating lag from full-tree updates.

### 🛡️ Plugin Sandbox Isolation (Iframe Sandboxing & IPC Bridge)
Security of the plugin ecosystem is our bottom line. We have implemented strict **Context Isolation** and **Webview/Iframe Sandboxing**:
- **Zero-Privilege Execution**: Plugins run in a fully isolated sandbox without direct access to Node.js APIs or system resources.
- **Whitelisted Communication**: A custom `PluginBridge` handles cross-origin message passing, allowing only safe API calls and preventing SSH credential leaks.

### 🪟 Dynamic Split-Grid Layout Engine
Inspired by mechanisms like **GoldenLayout**, we've integrated a flexible `SplitPane` engine:
- **Real-time Control**: Supports dynamic registration of bottom and right side panels, with drag-to-resize functionality.
- **Plugin Friendly**: Plugins can easily register and mount custom panels, allowing Terminals, SFTP, and Monitors to coexist harmoniously.

---

## ✨ Core Features

*   **Glassmorphism Aesthetics**: Polished frosted glass visual effects with real-time background opacity adjustment.
*   **Zero-Knowledge Encryption**: AES-256 full encryption based on a Master Password, ensuring local config files remain absolutely secure.
*   **Full SFTP Management**: High-performance SFTP module with drag-and-drop uploads, file editing, and permission control.
*   **High-Speed Core**: Powered by xterm.js for native-grade terminal rendering with GPU acceleration and smooth tab switching.
*   **Extreme Robustness**: 98% of the core logic is written in TypeScript for strict type safety.

---

## 🛠 Tech Stack

| Domain | Solution |
| :--- | :--- |
| **Core Engine** | Node.js, Electron |
| **State Management** | Zustand |
| **Frontend Framework** | React 18 (Hooks) |
| **Styling** | Vanilla CSS, Tailwind CSS |
| **Bundler** | Vite, esbuild |
| **Terminal Engine** | xterm.js + AttachAddon |

---

## 🚀 Quick Start

### 1. Prerequisites
Ensure you have Node.js (>= 18.x) and npm installed.

### 2. Steps
```bash
# Clone the repository
git clone https://github.com/JiangchenShen/GETSSH.git
cd GETSSH

# Install dependencies
npm install

# Start development mode
npm run dev

# Build production package
npm run build -- --mac  # or --win
```

---

## 🛡 Security Declaration

We firmly believe that developers must have absolute control over their underlying private keys. To implement ultimate security defense, GETSSH does not provide any form of password recovery. **Please keep your Master Password safe.** Our `SafeStorage` zero-knowledge encryption ensures that no one (including the developer) can decrypt your configuration files without your password.

---

Copyright © 2026 Jiangchen Shen. Licensed under [Apache License 2.0](LICENSE).
