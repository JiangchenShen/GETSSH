# 🚀 GETSSH | Next-Generation SSH Client

中文 | [English](README_EN.md)

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![Electron](https://img.shields.io/badge/Electron-47848F?style=flat-square&logo=electron&logoColor=white)](https://electronjs.org/)
[![Zustand](https://img.shields.io/badge/State-Zustand-orange?style=flat-square)](https://github.com/pmndrs/zustand)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg?style=flat-square)](LICENSE)
[![Changelog](https://img.shields.io/badge/Changelog-V1.2.1--Updates-brightgreen?style=flat-square&logo=gitbook)](UPDATE.md)

**GETSSH** 是一款专为追求极致效率、极致安全与现代美学的开发者打造的**下一代跨平台 SSH / SFTP 客户端**。

📢 **[查看最新更新日志 (Update Log)](UPDATE.md)**

我们打破了传统终端工具沉闷、死板的固有印象，将深度打磨的**毛玻璃拟态美学 (Glassmorphism)** 与工业级**零知识安全机密保护**完美融合，并在底层重构为高性能、低延迟的微组件架构，为您提供史无前例的远程开发与运维体验。

---

## ✨ 核心功能特性

### 💎 1. 毛玻璃拟态视觉美学 (Aesthetic Design)
- **沉浸式玻璃质感**：基于现代毛玻璃（Frosted Glass）和亚克力物理质感进行深度打磨，呈现高级、优雅的视觉层次。
- **自定义透明度**：支持背景透明度与毛玻璃模糊度进行实时无缝调节，完美融入您的桌面壁纸。
- **动态微交互**：每一个按钮、卡片、侧边栏都集成了丝滑的过渡动画与悬浮微交互，让每次点击都充满乐趣。

### 📁 2. 全能 SFTP 文件管理系统 (Advanced SFTP Toolkit)
*GETSSH 集成了工业级、高性能的 SFTP 管理套件，摆脱繁琐的命令行文件操作：*
- **🫳 拖拽即传 (Drag-and-Drop)**：支持将本地文件/文件夹直接拖入远程 SFTP 窗口进行无缝上传，以及反向拖拽下载。
- **✏️ 实时本地编辑与同步 (Local Edit & Sync)**：支持一键本地打开远程文件（如配置文件或代码），保存时自动静默上传，关闭编辑时自动进行安全的临时文件清理。
- **🔍 智能双模地址栏 (Breadcrumbs & Address Bar)**：
  - *面包屑模式*：直观的可视化路径导航，支持一键向上跳转。
  - *可编辑模式*：点击空白处秒变文本输入框，支持输入绝对路径（如 `/home/ubuntu/project`）回车直达。
- **📁 新建与软链接穿透 (Creation & Symlink)**：内置精美受控的 React Modal，支持在 SFTP 中直接新建文件/文件夹，且完美支持符号链接（Symlink）的标识显示与双击穿透。

### 🖥️ 3. GPU 加速的极速终端内核 (High-Performance Terminal)
- **秒速响应**：基于 `xterm.js` 原生内核驱动，支持 GPU 渲染加速，在超大并发文本流输出时依然丝滑无阻。
- **多标签并发管理 (Multi-Tab)**：提供现代浏览器般的多标签切换体验，多会话并行，拒绝频繁重连。
- **智能防断联 (Keep-Alive)**：内置心跳保活检测机制与主进程后台保活支持，切换窗口时终端绝对不断连。

### 🔒 4. 零知识本地加密防御 (Zero-Knowledge Security)
- **AES-256 全量加密**：您的服务器连接配置（Profiles）使用主密码（Master Password）在本地通过 AES-256 算法全量加密。
- **绝对的控制权**：没有云端服务器，没有任何密码找回后门。**请务必牢记您的主密码**，除非输入正确密码，否则即便是开发者也绝对无法破解您的本地配置文件。
- **安全沙盒隔离 (Sandbox)**：任何插件都运行在严格隔离的沙盒（Iframe Sandboxing）环境中，通过 IPC 白名单网关进行通信，彻底杜绝服务器私钥等高敏感凭证的外泄。

### 🧩 5. 动态分屏与弹性插件系统 (Flexible Split-Grid Engine)
- **动态分屏引擎**：集成高性能的分屏拖拽网格，支持终端、SFTP、监控面板在同一个工作区内任意比例拼合与拖拽调整。
- **热插拔插件**：允许第三方插件一键挂载至底部或右侧侧边栏，为您的远程服务器生态提供无限可能。

### ⚡ 6. 极致轻量：为什么我们的 Electron 占用极低？
很多开发者对 Electron 的固有印象是“内存黑洞”和“启动缓慢”。在 GETSSH 中，我们应用了一系列最前沿的技术和极简设计原则，彻底打破了这一魔咒：
- **原子化微组件设计**：将前端视图层深度拆解，避免任何多余的全局组件重绘。结合 **Zustand 极简状态拓扑** 的 Selective Selectors（精准重绘选择器）机制，数据高频更新时仅重绘目标原子节点，内存和 CPU 开销降低达 70%。
- **全异步无阻塞 I/O 内核**：底层的插件加载、本地 AES 零知识加解密全面重构为异步流（`fs.promises` 和非阻塞 `crypto.pbkdf2`），完全解放了 Node.js 主线程，绝不卡死渲染。
- **构建零冗余打包**：摒弃复杂的重度依赖，所有打包资源经过 Vite + esbuild 的多重摇树优化（Tree Shaking），剔除所有未引用代码，生成的包体极度轻量，启动秒开。

---

## 💡 我们为什么打造 GETSSH？（开源初心）

作为长期奋斗在开发和运维一线的工程师，我们每天都要和各种远程服务器打交道。然而，市面上的工具总是让我们面临无奈的妥协：
- *要么功能强大，但界面极其丑陋，像上个世纪的产物*；
- *要么颜值不错，但体积臃肿、卡顿，甚至沦为“订阅制”高昂收费的商业工具*；
- *要么是闭源软件，存在远程连接凭证或私钥被暗中上传泄露的安全隐患*。

我们认为，**好用的工具应该拿出来大家一起享用，不应该给开发者的生产力设卡收费！** 
因此我们决定打造 **GETSSH**，坚持**完全开源**、**零知识本地加密**、且在设计美学和极速体验上绝不妥协，将数字资产与连接凭据的主权交还给开发者自己。

---

## ⚖️ 竞品对比：为什么选择 GETSSH？

| 对比维度 | **GETSSH** (本项目) | **Termius** | **Tabby** | **PuTTY** |
| :--- | :--- | :--- | :--- | :--- |
| **界面美学** | **极致毛玻璃拟态 (Glassmorphism)** | 扁平现代但中规中矩 | 支持自定义但较重 | 极其古老 (上世纪 UI) |
| **启动与内存** | **微秒级启动，极低内存** | 启动较快，内存中等 | 启动缓慢，内存占用高 | 极速启动，内存极低 |
| **SFTP 体验** | **全功能 (拖拽上传/本地实时编辑)** | 付费订阅 (Premium) 专享 | 体验较基础 | 无内置图形化 SFTP |
| **隐私安全** | **完全开源，本地零知识 AES 加密** | 闭源，配置上传云端有隐患 | 开源但相对繁重 | 开源但无现代加密加密 |
| **性价比** | **100% 完全免费且开源** | 昂贵的月度/年度订阅制 | 完全免费 | 完全免费 |

---

## 🗺️ 2.0 路线图：我们的前行方向

GETSSH 目前正处于蓬勃发展的上升期，以下是我们接下来全力探索的方向：
- 🌐 **WebSSH 支持**：支持在无感客户端下通过浏览器快速进行连接管理与轻量操作。
- 🔌 **Plugin SDK 2.0 深度开放**：我们将开放完整的动态 UI 挂载 API、高权限 API 桥接和独立的沙盒上下文运行机制，让所有人都能为 GETSSH 轻松开发丰富的主题、协议和辅助运维插件。
- ⚡ **集群自动化脚本 (Cluster Automation)**：支持在分屏模式下一键向多台服务器同步分发命令并执行自动化脚本。

---
---

## 🛠 开发技术栈

| 领域 | 选型技术 | 核心价值 |
| :--- | :--- | :--- |
| **底层核心** | **Electron** | 跨平台原生级能力与主进程极致性能 |
| **状态驱动** | **Zustand** | 响应式多维状态拓扑，组件级精准高频重绘 |
| **前端视图** | **React 18 + TS** | 严苛的静态类型保障与可复用微组件设计 |
| **样式方案** | **Vanilla CSS & Tailwind** | 兼顾系统级原子样式与极高自由度主题定制 |
| **构建引擎** | **Vite + esbuild** | 秒级的热重载开发体验与超轻量打包体积 |
| **终端渲染** | **xterm.js** | GPU 硬件加速的卓越文本吞吐性能 |

---

## 🚀 快速开始

### 1. 开发环境准备
确保您的计算机上已安装 **Node.js (>= 18.x)**。

### 2. 启动开发
```bash
# 1. 克隆代码仓库
git clone https://github.com/JiangchenShen/GETSSH.git
cd GETSSH

# 2. 安装依赖包
npm install

# 3. 启动本地开发环境 (支持 Vite 热重载)
npm run dev
```

### 3. 生成安装包
由于我们支持了高度自治的独立架构打包，您可以在本地一键为对应系统编译出体积最小化的安装包：
```bash
# 打包 macOS 苹果芯片与 Intel 芯片版
npm run build -- --mac

# 打包 Windows 64位与 ARM64版
npm run build -- --win

# 打包 Linux 通用版
npm run build -- --linux
```

---

## 🛡 安全与隐私声明

GETSSH 坚信，生产力工具不应侵犯用户的数字资产主权。您的所有 SSH 私钥、连接凭证和会话记录**仅会存储在您本地的主机中**。我们绝不会、也无法收集您的任何敏感数据。

---

Copyright © 2026 Jiangchen Shen. Licensed under [Apache License 2.0](LICENSE).
