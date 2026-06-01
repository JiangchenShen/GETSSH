# GETSSH

中文 | [English](README.md)

[![Version](https://img.shields.io/badge/版本-2.0.0--preview-blueviolet?style=flat-square)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-007ACC?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![Electron](https://img.shields.io/badge/Electron-42-47848F?style=flat-square&logo=electron&logoColor=white)](https://electronjs.org/)
[![Rust](https://img.shields.io/badge/Rust-N--API-CE4A00?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue?style=flat-square)](LICENSE)
[![Changelog](https://img.shields.io/badge/更新日志-v2.0-brightgreen?style=flat-square&logo=gitbook)](docs/CHANGELOG_CN.md)

**GETSSH** 是一款为开发者与运维工程师打造的下一代跨平台 SSH 终端客户端，围绕三个不妥协的核心原则构建：**物理级安全防御**、**GPU 加速终端体验**，以及**令人真正想打开终端的毛玻璃界面**。

在底层架构上，GETSSH v2.0 是一个完整的 **TypeScript + Rust 混合体**。五个 Rust 原生扩展（N-API）负责您的 CPU 和内存最在意的一切——密码学、文件 I/O、系统监控和物理级看门狗守护进程——而 React 19 与 Electron 42 则以严格的架构纪律处理其余工作，保持极低的启动时间和流畅如丝的渲染体验。

📢 **[查看完整更新日志 (v2.0)](docs/CHANGELOG_CN.md)**

---

## ✨ v2.0 带来了什么

v2.0 是一次从根基开始的架构重塑，而不只是一次功能发布：

- 🦀 **全套 Rust 原生核心** — 五个生产级 Rust N-API 扩展，彻底替换了 JS 层的加密、SFTP I/O 和系统监控整个技术栈
- 🛡 **六层物理级安全架构** — 看门狗守护进程、AES-256-GCM 金库、Zeroize 内存即焚、零拷贝网络引擎、RASP 运行时防御、原生内存完整性校验
- 🔒 **32 个安全漏洞全部修复** — 完整内部安全审计，覆盖 Critical、High、Medium、Low 四个级别，全部已修复归零
- ⚛️ **React 19 + Electron 42** — 在最新稳定版基础上重建
- 🎨 **Tailwind CSS v4** — 样式系统全面升级

---

## 🔒 安全架构

GETSSH v2.0 实现了一套**从操作系统内核到应用层的六道纵深防御体系**：

| 防御层 | 组件 | 职责 |
|---|---|---|
| **1. Rust 物理级看门狗** | `rust-core/watchdog` — 独立二进制 | 独立于 Electron 进程运行。通过 IPC 心跳监控主进程。若心跳超过 5 秒未响应，将调用操作系统级 API 强制杀死整个 Node.js 进程——完全绕过 JavaScript 层。 |
| **2. 内存即焚 (Zeroize)** | `getssh-vault` Rust N-API | 所有 AES 密钥和解密后的凭证缓冲区均被 `ZeroizeOnDrop` 包裹。TypeScript 层的 `finally` 块调用 `buffer.fill(0)` 进行二次覆写。明文绝不在堆内存中残留。 |
| **3. 金库级加密引擎** | `getssh-vault` Rust N-API | AES-256-GCM 认证加密。密钥通过 PBKDF2-HMAC-SHA256 派生，100,000 次迭代，32 字节 Salt（符合 NIST SP 800-132）。V2 格式含魔数头，支持安全版本迁移。 |
| **4. 零拷贝网络引擎** | `sftp-stream` Rust N-API | SFTP 大文件传输完全绕过 V8 堆内存，由 Rust 直接掌管磁盘 I/O。从根本上杜绝大文件传输时的 OOM 崩溃。 |
| **5. RASP 运行态防御** | `SecureCenter.ts` | 运行时应用自我保护。审计插件的 Shell 命令，检测 Fork Bomb、`rm -rf /`、`mkfs`、`dd` 等毁灭性操作。检测到威胁时触发 Watchdog 锁定协议。 |
| **6. 底层内存完整性校验** | `getssh-sysprobe` Rust N-API | 定期校验关键系统函数内存首字节，检测 Inline Hook 植入企图。需要提权运行。 |

### IPC 安全加固

所有 `ipcMain.on` 和 `ipcMain.handle` 调用均被全局补丁拦截，任何来自子帧（`event.senderFrame.parent !== null`）的请求一律拒绝。插件 iframe 无法突破沙盒边界调用高权限的 IPC 通道。

### 插件沙盒

插件 UI 运行在 `<iframe sandbox="allow-scripts">` 内——`allow-same-origin` 被明确移除。`PluginBridge` 对每条 `postMessage` 进行来源校验，与发送方 iframe 的 `contentWindow` 严格比对。危险操作（`sshWrite`、`saveProfiles`、`sftpDelete` 等）均被列入永久黑名单。

---

## 🧩 插件系统

GETSSH 采用**双模插件架构**：

- **主进程插件** — 以沙盒化的 `vm.Script` 上下文在 Electron 主进程中运行。通过能力声明机制（Capabilities）获得受限 API 访问权限：`ssh:read`、`ssh:write`、`storage`、`clipboard`、`notification` 等。每项能力须在 `package.json` 中声明，并经用户在安装时审批确认。
- **渲染器插件** — 以沙盒化 iframe 运行。通过带有 `BLOCKED_ACTIONS` 强制拦截的 RPC 桥与宿主通信。

**扩展点全览：**
- `registerSidebarAction` — 向侧边栏注入自定义操作按钮（图标经 DOMPurify 消毒）
- `registerPanel` / `openPanel` — 注册并打开自定义面板（作为分屏树叶节点展示）
- `registerUIExtension` — 为终端右键菜单和 SFTP 工具栏添加操作项
- `registerSettingsSchema` — 在设置页面注入插件自定义配置 UI
- `pluginStorage` — 每个插件独立的 KV 存储（`getssh-kv` Rust 模块）
- `onSysmonData` — 订阅来自 Rust sysprobe 的实时 CPU/内存/网络数据推送

---

## ⚡ 核心功能

### 多协议终端连接

- **SSH** — `ssh2` 库，支持密码/私钥认证，支持 SOCKS5/HTTP 代理转发
- **本地 Shell** — `node-pty`，macOS（Zsh/Bash），Windows（PowerShell），基于安全白名单的 Shell 路径验证
- **Telnet** — 原生 `net.Socket` 加 NVT 协议协商，强制 `vt100` 终端类型，适配思科/华为等网络设备
- **协议自动识别** — 输入时自动解析 `ssh://`、`telnet://`、`user@host` 等多种格式

**终端引擎：** `xterm.js` v6，WebGL 加速渲染（Canvas 降级兜底），Ligatures 字体连字支持，字体/颜色/光标/回滚行数/响铃全可配置，防瞎眼（Anti-Glare）高对比模式。

**分屏架构：** 递归二叉树数据结构（`PaneNode`）。任意叶节点可进行水平或垂直分割，支持任意深度嵌套。每个分屏独立持有终端会话、插件面板或 Command Center 欢迎页，任意混搭。

### SFTP 文件管理器

- 通过 Rust `sftp-stream` 实现双模上传/下载引擎（零拷贝，大文件传输完全绕过 V8 堆）
- 文件读取上限：应用内直接预览 **10MB**（防止 OOM 崩溃）；纯下载模式无大小限制
- 实时本地同步编辑——双击文件在本地默认编辑器中打开，保存时自动上传
- 原子写入（先写 UUID 后缀临时文件，再 `rename()` 原子替换），防止写入中断损坏文件
- 对所有远端路径执行 `path.posix.normalize()` 路径穿越防御

### 主控台 (Command Center)

Raycast/Spotlight 风格的统一入口：对所有已保存会话（别名/主机/用户名）进行全文模糊搜索，键盘全程导航（↑/↓/Enter/Esc），支持直接输入 `user@host` 回车闪电直连，无需预先保存配置。Watchdog 安全告警会在此处以内联横幅形式呈现。

### SafeStorage 凭证保险箱

- Rust `getssh-vault`：PBKDF2（10 万次迭代）+ AES-256-GCM，V1/V2 双格式自动识别与迁移
- `Electron.safeStorage` 保护主密码落盘安全（macOS Keychain / Windows DPAPI）
- macOS Touch ID 生物识别解锁，实现无密码快速启动
- 敏感配置字段（`initScript`、`proxyHost`、`proxyPort`）单独通过 `safeStorage` 加密，与主 localStorage 键完全隔离存储
- 自动锁屏：空闲超时后触发主密码解锁界面，Zustand `cryptoStore` 在锁定时同步清空内存

### 已知主机与 MITM 防护

- 首次连接时弹出 SHA256 指纹验证弹窗
- 主机指纹发生变化时触发高危 MITM 警告覆层，对比展示新旧指纹
- 设置 → 安全 → 已知主机，支持逐条撤销信任记录

### 连接审计日志

只读的连接元数据记录（别名、主机、接入/断开时间戳、持续时长）。终端内容从不捕获。支持导出 CSV。

---

## 🛠 开发技术栈

| 层次 | 技术 | 版本 |
|---|---|---|
| 桌面底座 | Electron | 42.x |
| 前端框架 | React + TypeScript | 19.x + 6.x |
| 构建工具 | Vite + vite-plugin-electron | 8.x |
| 样式方案 | TailwindCSS | v4.x |
| 状态管理 | Zustand | 5.x |
| SSH/SFTP | ssh2 | 1.x |
| 本地终端 | node-pty | 1.x |
| 终端渲染 | xterm.js + WebGL | 6.x |
| 加密核心 | Rust (getssh-vault) | AES-256-GCM + PBKDF2 |
| 系统监控 | Rust (getssh-sysprobe) | sysinfo crate |
| SFTP 引擎 | Rust (sftp-stream) | 零拷贝 N-API |
| 插件存储 | Rust (getssh-kv) | 隔离 KV |
| 解压引擎 | Rust (getssh-unarchive) | ZipSlip 防御加固 |
| 看门狗 | Rust（独立二进制） | 操作系统级强杀 |
| 国际化 | react-i18next | en-US, zh-CN |
| DOM 安全 | DOMPurify | 3.x |
| 测试 | Vitest + Playwright | 单元测试 + E2E |

---

## 🚀 快速开始

### 环境准备

- **Node.js** ≥ 18.x
- **pnpm** ≥ 9.x
- **Rust 工具链**（用于编译原生模块）— 推荐使用 `rustup` 安装

### 启动开发

```bash
# 克隆仓库
git clone https://github.com/JiangchenShen/GETSSH.git
cd GETSSH

# 安装依赖
pnpm install

# 编译 Rust 看门狗二进制文件（SecureCenter 所需）
pnpm run build:watchdog

# 启动 Vite Dev Server + Electron（支持 HMR 热重载）
pnpm run dev
```

> **注意：** 五个 Rust `.node` 扩展（`getssh-vault`、`getssh-sysprobe`、`sftp-stream`、`getssh-kv`、`getssh-unarchive`）已为 macOS arm64/x64 预编译。如在 Windows 或 Linux 上开发，需在各 `rust-core/*` 目录内执行 `napi build --release` 手动重新编译。

### 打包安装包

```bash
# 编译所有 Rust 组件 + Vite 构建 + electron-builder 打包（一键）
pnpm run build

# 指定平台打包
pnpm run build -- --mac      # macOS DMG (ULFO 格式) — x64 + arm64 双架构
pnpm run build -- --win      # Windows NSIS 安装包 — x64 + arm64
pnpm run build -- --linux    # Linux AppImage — x64 + arm64
```

---

## ⚖️ 为什么选择 GETSSH？

| | **GETSSH** | Termius | Tabby | iTerm2 |
|---|---|---|---|---|
| **安全性** | Rust AES-256-GCM + 看门狗守护进程 + RASP + Zeroize 内存即焚 | 闭源，云端同步存在隐患 | 开源，无硬件安全层 | 开源，无加密层 |
| **SFTP** | 零拷贝 Rust 引擎，实时本地编辑同步 | 付费订阅专享 | 功能较基础 | 需安装插件 |
| **架构** | TypeScript + Rust 混合，6 个原生扩展 | 闭源专有 | Electron + TS | Objective-C |
| **插件** | 双模沙盒（vm.Script + iframe），能力声明门控 | 功能有限 | 主题向 | 脚本 API |
| **价格** | **完全免费开源** | 月度/年度订阅制 | 免费 | 免费（仅 macOS）|

---

## 🗺 路线图

- [ ] **v2.1** — CSP 全面移除 `unsafe-eval` · Windows 代码签名 · Workspace 工作区隔离（多金库）
- [ ] **v2.2** — 插件市场 · SSH 跳板机（ProxyJump）· 终端内容搜索
- [ ] **v2.3** — 集群广播（一键向 N 个会话同步发送命令）· SSH 配置文件（`~/.ssh/config`）导入

---

## 🛡 隐私声明

一切都留在本地。SSH 私钥、密码、会话日志与连接元数据**从不离开您的设备**。GETSSH 没有任何埋点统计、遥测上报、云端账户，也不会发起任何网络请求（仅 GitHub Releases API 用于检查更新）。

---

## 📄 开源协议

Copyright © 2026 Jiangchen Shen. Licensed under the [Apache License 2.0](LICENSE).
