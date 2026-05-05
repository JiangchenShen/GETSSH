# 🚀 GETSSH | Next-Generation SSH Client

中文 | [English](README_EN.md)

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![Electron](https://img.shields.io/badge/Electron-47848F?style=flat-square&logo=electron&logoColor=white)](https://electronjs.org/)
[![Zustand](https://img.shields.io/badge/State-Zustand-orange?style=flat-square)](https://github.com/pmndrs/zustand)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg?style=flat-square)](LICENSE)
[![Changelog](https://img.shields.io/badge/Changelog-V1.2.1--Updates-brightgreen?style=flat-square&logo=gitbook)](UPDATE.md)

**GETSSH** 不仅仅是一个 SSH 客户端，它是为追求极致效率与极致安全的开发者打造的现代化远程管理平台。在 V1.2.1 版本中，我们完成了核心架构的全面进化，从单一巨石转向微组件架构，并引入了工业级的安全隔离机制与稳定性修复。

📢 **[查看最近更新日志 (Changelog)](UPDATE.md)**

---

## 💎 V1.2.1 架构重构亮点 (The Epic Refactor)

### 🏗️ 微组件化架构 (Monolith to Micro-components)
我们将超过 900 行的 `App.tsx` 巨石逻辑彻底解耦。现在的 GETSSH 像乐高一样由高度自治的微组件构成：
- **逻辑剥离**：视图层与业务逻辑完全分离，组件间通过原子化的 Store 进行通信。
- **动态协调**：App 主体演变为轻量级的协调器，极大地提升了系统的可维护性与扩展速度。

### 🧠 现代化状态管理 (Global State with Zustand)
引入 **Zustand** 作为全局状态驱动引擎，构建了响应式的数据流拓扑：
- **多维存储**：`appStore`, `sessionStore`, `cryptoStore` 以及 `panelStore` 各司其职。
- **极致性能**：利用 Zustand 的选择器（Selectors）机制，实现组件级的精准重绘，拒绝全量更新带来的卡顿。

### 🛡️ 插件沙盒隔离 (Iframe Sandboxing & IPC Bridge)
插件生态的安全性是我们的底线。我们实现了严苛的 **上下文隔离 (Context Isolation)** 与 **Webview/Iframe 沙盒机制**：
- **零特权执行**：插件在完全隔离的沙盒环境中运行，无法直接访问 Node.js API 或系统资源。
- **白名单通信**：通过自定义的 `PluginBridge` 实现跨域消息传递，仅允许白名单内的安全 API 调用，彻底杜绝 SSH 私钥等敏感信息外泄。

### 🪟 动态分屏布局引擎 (Dynamic Split-Grid Layout)
借鉴了类似 **GoldenLayout** 的高自由度窗口分屏机制集成了 `SplitPane` 引擎：
- **实时控制**：支持动态注册底部、右侧等多个侧边面板，用户可通过拖拽实时调整空间占比。
- **插件友好**：插件可一键注册并挂载自定义面板，让终端、SFTP、监控台在一个界面内和谐共存。

---

## ✨ 核心特性

*   **玻璃拟态美学:** 深度打磨的毛玻璃视觉效果，支持背景透明度实时调节。
*   **零知识加密:** 基于主密码的 AES-256 全量加密方案，确保本地配置文件绝对安全。
*   **全能文件管理:** 集成高性能 SFTP 模块，支持拖拽上传、地址栏直接跳转、新建文件/夹及软链接穿透。
*   **静默更新机制:** 零依赖的 GitHub OTA 更新检查，支持后台红点提示与一键升级引导。
*   **极速内核:** 搭载原生级 xterm.js 渲染引擎，支持 GPU 加速与多标签平滑切换。
*   **极致鲁棒性:** 核心逻辑 98% 由 TypeScript 覆盖，提供严苛的类型检查。

---

## 🛠 技术栈

| 领域 | 技术方案 |
| :--- | :--- |
| **核心驱动** | Node.js, Electron |
| **状态管理** | Zustand |
| **前端框架** | React 18 (Hooks) |
| **样式方案** | Vanilla CSS, Tailwind CSS |
| **渲染构建** | Vite, esbuild |
| **终端引擎** | xterm.js + AttachAddon |

---

## 🚀 快速开始

### 1. 环境准备
确保您的开发机已安装 Node.js (>= 18.x) 和 npm。

### 2. 启动步骤
```bash
# 克隆仓库
git clone https://github.com/JiangchenShen/GETSSH.git
cd GETSSH

# 安装依赖
npm install

# 启动开发环境
npm run dev

# 构建 macOS/Windows 安装包
npm run build -- --mac  # 或者 --win
```

---

## 🛡 安全宣言

我们坚信，开发者必须拥有对底层私钥的绝对控制权。为了贯彻极致的安全防御，GETSSH 不提供任何形式的密码找回功能。**请务必妥善保管您的主密码。** 我们实现了 `SafeStorage` 零知识加密架构，除非获得您的主密码，否则任何人（包括开发者）都无法解密您的配置文件。

---

Copyright © 2026 Jiangchen Shen. Licensed under [Apache License 2.0](LICENSE).
