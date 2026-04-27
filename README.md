# ⚡️ GETSSH 

<div align="center">
  <p>A Modern, Secure, and Local-First SSH Terminal.</p>
  <p>
    <a href="#english">English</a> | <a href="#中文说明">中文说明</a>
  </p>
  <img src="https://img.shields.io/badge/TypeScript-96.9%25-blue?logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/Electron-V1.0%20(Stable)-47848F?logo=electron" alt="Electron">
  <img src="https://img.shields.io/badge/License-Apache%202.0-green.svg" alt="License">
  <img src="https://img.shields.io/badge/Status-V1.0-orange.svg" alt="Status">
</div>

---

<h2 id="english">📖 English</h2>

### What is GETSSH?

GETSSH is a next-generation SSH client built for developers who prioritize **Privacy, Security, and Aesthetics**. Unlike cloud-syncing terminal applications, GETSSH operates strictly on a **Local-First** architecture. Your server credentials, private keys, and connection histories never leave your device.

### ✨ Key Features (V1.0)

* **Zero-Knowledge Encryption (SafeStorage):** All sensitive data (credentials, IPs, ports) are encrypted locally using AES-256-GCM (`profiles.enc`). Without your Master Password, the data remains cryptographically inaccessible. You can dynamically change the password or safely disable encryption with atomic fallbacks directly via inline React forms.
* **Local-First Architecture:** Absolute privacy. No telemetry, no cloud synchronization, and no third-party data tracking.
* **Modern UI/UX:** Crafted with Glassmorphism, Dark Mode support, and a robust CSS Theme Variable system allowing you to hot-swap primary colors (Cyber Purple, Geek Green, etc.) across the entire app.
* **Unwavering Stability:** Dropped experimental WebGL rendering in favor of an ultra-stable Canvas DOM engine, preventing window-blur crashes entirely. Electron background throttling has been explicitly disabled for 24/7 SSH keepalive persistence.
* **High Performance:** Built heavily on TypeScript (96.9%) ensuring robust type safety and minimal runtime errors.

### 🛠 Tech Stack

* **Core:** Node.js, Electron
* **Language:** TypeScript
* **UI & Styling:** React, Tailwind CSS, Vite
* **Terminal Engine:** xterm.js (Canvas renderer)

### 🚀 Getting Started

**1. Clone the repository**
```bash
git clone https://github.com/JiangchenShen/GETSSH.git
cd GETSSH
```

**2. Install dependencies**
```bash
npm install
```

**3. Run in development mode**
```bash
npm run dev
```

**4. Build for production**
```bash
npm run build
```

### 🛡 Security Philosophy
We believe that developers should have ultimate control over their own keys. **"Not your keys, not your server."** Please remember your Master Password; there is no cloud recovery mechanism if it is lost.

---

<h2 id="中文说明">📖 中文说明</h2>

### 关于 GETSSH

GETSSH 是一款专为重视**隐私、安全与美学**的开发者打造的下一代 SSH 客户端。与市面上主打云端同步的终端不同，GETSSH 严格遵循**本地优先 (Local-First)** 架构。您的服务器凭证、私钥和连接历史记录永远不会离开您的物理设备。

### ✨ V1.0 核心特性

* **零知识加密 (SafeStorage):** 所有敏感数据均使用 AES-256-GCM 算法在本地加密存储为 `profiles.enc`。提供完善的内联交互表单，支持随时无缝更改主密码，或经过安全确认后原子级退回明文模式。没有主密码，任何人无法解密您的服务器数据。
* **物理级隐私隔离:** 绝对的隐私保护。无数据埋点，无云端同步，无第三方行为追踪。
* **原生级体验与中文支持:** 完美契合原生 macOS 的中文开发语境。界面采用全站 CSS 动态主题色渲染（告别硬编码色系），毛玻璃、极简留白、动态发光边框一应俱全。
* **永不掉线的稳定性:** 剔除极易崩溃的 WebGL 实验性引擎，采用纯 Canvas 高可用渲染器，并在 Electron 底层彻底解除了后台休眠限制 (Throttling)，确保无论窗口是否失去焦点，SSH 心跳包永远不断。
* **极致鲁棒性:** 项目核心代码 96.9% 采用 TypeScript 编写，提供极其严苛的类型安全检查与运行稳定性。

### 🛠 技术栈

* **底层驱动:** Node.js, Electron
* **开发语言:** TypeScript
* **构建与渲染:** React, Tailwind CSS, Vite
* **终端引擎:** xterm.js

### 🚀 快速开始

**1. 克隆仓库到本地**
```bash
git clone https://github.com/JiangchenShen/GETSSH.git
cd GETSSH
```

**2. 安装依赖包**
```bash
npm install
```

**3. 启动开发环境**
```bash
npm run dev
```

**4. 打包构建原生安装包**
```bash
npm run build
```

### 🛡 安全宣言
我们坚信，开发者必须拥有对底层私钥的绝对控制权。为了贯彻极致的安全防御，GETSSH 不提供任何形式的密码找回功能。**请务必妥善保管您的主密码。**

---

<div align="center">
  <p>Built with ⚡️ by Jiangchen Shen | Under Apache 2.0 License</p>
</div>
