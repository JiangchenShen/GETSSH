# GETSSH — 产品需求文档 (PRD)

**文档版本**：V2.1（正式发布版）
**产品名称**：GETSSH
**当前稳定版本**：v2.0.0（代号 R7K4S）
**文档性质**：本文档基于正式发布代码库进行全量逆向工程推导，完整还原产品功能边界、技术架构决策及设计哲学，并结合 v2.0 里程碑期间所有核心工程改造进行了全面增补。
**最后更新**：2026-06
**文档负责人**：GETSSH 产品技术委员会

---

## 1. 产品概述

### 1.1 产品定位

GETSSH 是一款面向**专业开发者、DevOps 工程师与信息安全研究人员**的跨平台桌面 SSH 终端客户端，以 **Electron + React 19 + Rust Native Addon** 技术栈构建，以「极简极客」美学与「物理级」零信任安全防护作为核心差异化战略。

产品定位于在企业级安全防护标准与极致的开发者用户体验之间，建立一条无需妥协的纵深防御通道。

- **主要竞品**：Terminus, Royal TSX, SecureCRT, MobaXterm, iTerm2
- **核心差异化能力矩阵**：

| 能力维度 | GETSSH 方案 | 行业通行方案 |
|---|---|---|
| 安全架构 | Rust 独立 Watchdog + RASP 主动防御 + 内存即焚（ZeroizeOnDrop）| 依赖 OS 权限隔离，无运行态防御 |
| 布局引擎 | Rust Nexus Core 状态机驱动的递归二叉树分屏 | 传统 CSS Flex/Grid，无底层状态持久化 |
| 加密引擎 | Rust AES-256-GCM + PBKDF2（10 万次迭代），密文不过 V8 堆 | Node.js `crypto`，受 V8 GC 调度影响 |
| 大文件 I/O | Rust 零拷贝（Zero-copy）SFTP 流，绕过 V8 OOM 限制 | Node.js Buffer，受堆内存上限约束 |
| 跨平台字体 | 全离线本地化「双子星」字体栈（Reddit Sans + MiSans）| 依赖 CDN Google Fonts，离线不可用 |
| 插件生态 | 双模架构（VM 上下文主进程插件 + iframe 沙盒渲染器插件）| 单一渲染进程插件模型 |

### 1.2 目标用户画像

| 用户群 | 画像描述 | 核心诉求 |
|---|---|---|
| **核心目标用户** | 高频管理 5 台以上远端 Linux/Unix 服务器的后端、系统及 DevOps 工程师 | 多标签多分屏、SFTP 文件管理、快速切换 |
| **重要目标用户** | 对 SSH 工具有安全敏感需求的 Web3 开发者、安全研究员、渗透测试人员 | 零知识凭证存储、实时安全审计、沙箱隔离 |
| **潜在目标用户** | 寻求替换 iTerm2/系统 Terminal，追求集成化、美学一致性体验的全栈开发者 | 毛玻璃视觉、低门槛上手、可扩展插件 |

### 1.3 平台覆盖目标

| 平台 | 架构 | 分发格式 | 状态 |
|---|---|---|---|
| macOS | arm64 (Apple Silicon) | DMG / ZIP | ✅ 正式支持 |
| macOS | x64 (Intel) | DMG | ✅ 正式支持（进入维护阶段，Intel 架构停服倒计时已启动）|
| Windows | x64 | NSIS 安装包 | ✅ 正式支持 |
| Windows | arm64 | NSIS 安装包 | ✅ 正式支持 |
| Linux | x64 / arm64 | AppImage | ✅ 正式支持 |

> ⚠️ **架构路线声明**：Apple 已确认 macOS 26 (Tahoe) 为最后一个支持 Intel 芯片 Mac 的 macOS 版本，Rosetta 2 转译层预计于 macOS 28 全面移除。GETSSH 将在上游依赖链停止对 x64 macOS 的交叉编译支持后，同步终止 Intel 架构安装包的编译与分发。

---

## 2. 核心功能模块

### 2.1 多协议终端连接管理

**产品目标**：提供统一的多协议终端接入能力，实现从单一入口连接和管理所有类型目标设备。

#### 2.1.1 连接协议矩阵

| 协议 | 优先级 | 底层实现 | 能力描述 |
|---|---|---|---|
| SSH v2 | P0 | `ssh2` Node.js 库 | 密码认证、私钥认证（RSA/ECDSA/Ed25519）|
| 本地 Shell | P0 | `node-pty` | macOS 启动 Zsh/Bash，Windows 启动 PowerShell/CMD |
| Telnet | P1 | `net.Socket` + NVT 协商 | 支持思科/华为等网络设备管理，强制 `termType=vt100` |
| 协议自动识别 | P0 | 前端正则解析引擎 | 解析 `ssh://`、`telnet://`、`user@host` 等格式自动匹配协议 |

#### 2.1.2 连接会话配置模型（`SessionProfile`）

```typescript
interface SessionProfile {
  protocol?: 'ssh' | 'local' | 'telnet';
  host: string;
  username: string;
  password?: string;
  privateKeyPath?: string;
  port?: number;
  autoStart?: boolean;       // 应用启动后自动建立连接
  useKeepAlive?: boolean;    // SSH 保活心跳
  keepaliveInterval?: number;
  alias?: string;
  authType?: 'password' | 'key';
  osType?: OsType;           // 远端 OS 类型，登录后自动推断
  proxyType?: 'none' | 'socks5' | 'http';
  proxyHost?: string;
  proxyPort?: number;
  initScript?: string;       // 连接建立后自动执行的初始化脚本
}
```

> `osType` 由 SSH 登录成功后对服务器 Banner 和命令提示符进行模式匹配自动推断，支持识别 ubuntu / debian / centos / rhel / fedora / alpine / arch / suse / windows / macos / cisco / huawei / generic 等类型。

#### 2.1.3 代理支持

| 代理类型 | 底层实现 |
|---|---|
| 无代理 | 直连目标主机 |
| SOCKS5 | `SocksClient` 封装，经由代理服务器建立 SSH 隧道 |
| HTTP | `http-proxy-agent` CONNECT 隧道 |

#### 2.1.4 关键安全约束

- **会话 ID 随机性**：所有会话 ID 使用 `crypto.randomUUID()` 生成，防止线性顺序枚举攻击（M-12）
- **PTY 尺寸边界保护**：终端行列数（`rows`/`cols`）强制 Clamp 至 `[1, 500]` 区间，防止越界导致 C++ 层缓冲区崩溃（H-06）
- **本地 Shell 白名单**：通过 `getSafeShell()` 校验允许的 Shell 程序路径，拒绝信任原始 `$SHELL` 环境变量
- **僵尸进程清理**：主窗口销毁时，通过 `app.on('before-quit')` 钩子强制清理所有孤儿 PTY 子进程（M-10）

---

### 2.2 终端体验

**产品目标**：在提供接近原生终端流畅度的同时，融入分屏、主题、字体等专业高级功能，覆盖专业用户的全部工作流场景。

#### 2.2.1 渲染引擎能力

| 功能 | 优先级 | 描述 |
|---|---|---|
| xterm.js 主渲染器 | P0 | `@xterm/xterm` v6，WebGL 硬件加速渲染（优先），自动降级至 Canvas 模式 |
| 字体连字（Ligatures）| P1 | `@xterm/addon-ligatures`，支持 Fira Code 等编程字体的 `->` `=>` 等连字渲染 |
| 字体配置 | P0 | 全局可配置字体族、字号、行高、内边距（0-32px）|
| 光标样式 | P1 | 支持 block / underline / bar，可配置独立闪烁开关 |
| 终端响铃 | P1 | 支持 none / audible / visual 三种响铃模式 |
| 右键行为 | P1 | 可切换为「弹出上下文菜单」或「直接粘贴/复制」两种模式 |
| 终端主题 | P1 | 内置多套配色方案，支持用户导入自定义 JSON 主题文件（含原型污染防御）|
| 回滚行数 | P1 | 可配置（默认 10,000 行）|
| 选中自动复制 | P2 | 可选开启 `copyOnSelect` 模式 |
| 防眩光模式 | P2 | Anti-Glare：高对比度深色模式保护视力 |
| 终端内容搜索 | P2 | 基于 xterm SearchAddon 的全文搜索功能 |

**关键架构决策**：
- **CSS 常驻挂载策略**：Tab 切换时，终端 DOM 节点不执行卸载，而是通过 `display:none` 保持隐藏态，完整保活 xterm.js 实例与 SSH 连接。该策略彻底解决了 React 重渲染触发连接中断的问题。
- **后台节流禁用**：应用启动时主动向 Chromium 注入命令行参数（`disable-renderer-backgrounding` 等），防止应用最小化后 SSH 连接因心跳超时断开。

#### 2.2.2 Nexus 工作区引擎（分屏架构）

v2.0 引入了 **Nexus Core（基于 Rust + NAPI-RS 的工作区状态机）** 作为分屏引擎的唯一状态权威（Single Source of Truth, SSOT），彻底解决了 React 侧状态与底层引擎状态脱节所导致的一系列"幽灵"级 Bug。

##### 架构核心：递归二叉树 Pane 模型

```typescript
type PaneNode = PaneLeaf | PaneSplit;
// PaneLeaf: { type:'leaf', paneType:'welcome'|'terminal'|'plugin', paneId, sessionId, config }
// PaneSplit: { type:'hsplit'|'vsplit', children:[PaneNode, PaneNode], sizes:[number, number] }
```

| 功能 | 描述 |
|---|---|
| 水平分割 (hsplit) | 左右并排分屏，各窗格独立持有 SSH 会话 |
| 垂直分割 (vsplit) | 上下叠加分屏 |
| 任意深度嵌套 | 支持 N 层递归分屏，每个叶节点独立连接不同目标主机 |
| 可拖拽调整比例 | `SplitEngine.tsx` 支持鼠标拖拽分隔线实时调整尺寸百分比，并实时回写 Rust 状态（`nexusUpdateSizes`）|
| 内容类型混合 | 任意窗格可承载：终端 / 插件面板 / Command Center 欢迎页 |
| 分离窗口（Tear-off）| 任意窗格可被「撕出」为独立的原生系统窗口，上下文与 Rust 状态机完整同步 |

##### Nexus Core 状态同步机制

| IPC 信令 | 触发时机 | 作用 |
|---|---|---|
| `nexus:split` | 用户点击分屏按钮 | 通知 Rust 引擎执行分裂操作，获取新树结构 |
| `nexus:replace-pane` | 窗格类型变更（如 Welcome → Terminal）| 在 Rust 状态树中更新叶节点类型与配置 |
| `nexus:register-tab` | 新标签页创建 | 在 Rust 引擎中注册新的 Tab 根节点 |
| `nexus:update-sizes` | 拖拽分隔线结束 | 将新的尺寸比例持久化到 Rust 状态树 |
| `nexus:set-disconnected` | SSH 连接断开检测 | 修改 Rust 中对应叶节点的 `disconnected` 状态标记 |
| `nexus:close-tab` | 用户关闭标签页 | 从 Rust 状态树中删除整个 Tab 根节点，防止幽灵复活 |
| `nexus:tear-off` | 用户点击弹出按钮 | 触发 Rust 执行窗格分离，在新窗口中重建上下文 |

> **工程价值**：通过将布局状态的权威来源下沉至 Rust，从根本上杜绝了过去在 React 侧关闭标签页后、Rust 侧状态未同步而导致的「幽灵标签页」自动复活现象，以及由拖拽调整大小后状态回弹引发的「弹簧 Bug」。

---

### 2.3 SFTP 文件管理器

**产品目标**：内置轻量级图形化 SFTP 操作界面，实现终端与文件管理的无缝集成，消除用户频繁切换工具的认知负担。

#### 2.3.1 功能清单

| 功能 | 优先级 | 描述 |
|---|---|---|
| 目录浏览 | P0 | 带类型图标的文件列表，精确区分目录（`d`）、文件（`-`）、软链接（`l`）|
| 文件上传 | P0 | Rust N-API `SftpUploader`，底层零拷贝（Zero-copy）流式搬运，避免 V8 内存压力 |
| 文件下载 | P0 | Rust N-API `SftpDownloader`，支持原生系统对话框选择下载路径 |
| 快速路径跳转 | P1 | 地址栏直接输入绝对路径一键跳转 |
| 实时同步编辑 | P1 | 双击文件在本地默认编辑器中打开，保存时自动触发 SFTP 上传同步（`sftp-edit-sync`），双向 500ms 防抖 |
| 新建目录 | P1 | 内置模态对话框，不依赖系统原生 `window.prompt` |
| 文件/目录删除 | P1 | 支持文件 `unlink` 和目录 `rmdir` 操作 |
| 下载路径配置 | P2 | 全局可配置默认下载路径 `sftpDownloadPath`，可跳过每次的路径选择对话框 |

#### 2.3.2 安全约束

- **内存溢出（OOM）防护（C-06）**：直接内存读取文件上限为 **10MB**，超限则拒绝并引导用户使用本地编辑器实时同步方案
- **编辑临时文件安全命名（M-13）**：临时文件名包含 `crypto.randomUUID()` 后缀，防止 TOCTOU 符号链接竞争条件
- **文件大小分级限制（L-01）**：`sftp-edit-sync` 编辑模式限制 5MB；纯下载模式由 Rust 流式处理，无文件大小上限
- **路径穿越防御**：所有远端路径经 `path.posix.normalize()` 规范化后方可使用，阻断 `../../` 路径注入

---

### 2.4 Command Center（统一控制台）

**产品目标**：提供高效的统一入口门户，整合连接管理、工具访问与插件调用于一身，对标 Raycast / Spotlight 的键盘驱动操作哲学。

| 功能 | 优先级 | 描述 |
|---|---|---|
| 实时模糊搜索 | P0 | 跨字段匹配所有已保存会话（别名 / 主机 / 用户名）|
| 完整键盘导航 | P0 | ↑/↓ 方向键选择，Enter 一键建立连接，Esc 关闭面板 |
| 快速直连 | P0 | 搜索框直接输入 `user@host` 形式的地址后回车，无需预先保存配置 |
| 插件入口聚合 | P1 | 「本地工具与插件」区域列出所有已激活插件，支持一键唤起 |
| 实时时钟仪表盘 | P2 | 跟随 `i18n.language` 实时格式化的日期和时间展示 |
| 安全污染告警横幅 | P1 | 检测到 RASP 告警时，顶部显示红色（内存级）或黄色（插件级）安全警告横幅，附带 Watchdog 给出的人类可读风险原因 |
| 快捷操作入口 | P2 | 一键直达「新建连接」「偏好设置」功能入口 |

---

### 2.5 凭证安全保险箱（Crypto Vault）

**产品目标**：在本地持久化存储敏感凭证时，提供操作系统级密钥链（Keychain / DPAPI）与 Rust N-API 物理加密引擎的双重保护，实现零知识凭证管理。

#### 2.5.1 主密码加密机制

| 功能 | 优先级 | 技术实现 |
|---|---|---|
| 主密码设置 | P0 | `CryptoModal`，最低有效密码长度 8 位（安全审计 M-08 已修复）|
| PBKDF2 密钥派生 | P0 | Rust `getssh-vault` N-API 扩展：PBKDF2-HMAC-SHA256，100,000 次迭代，32 字节随机盐（符合 NIST SP 800-132）|
| AES-256-GCM 认证加密 | P0 | Rust `aes-gcm` crate：含 MAC 完整性验证，防密文篡改 |
| 格式向下兼容 | P0 | 自动识别并兼容 V1（16B Salt）和 V2（9B Magic Header + 32B Salt）两种历史加密格式 |
| 原子写入保护 | P0 | 先写入 UUID 后缀临时文件，再通过 `rename()` 系统调用原子替换目标文件，防止写入中断导致数据损坏 |
| 主密码零知识存储 | P0 | 主密码经 Electron `safeStorage`（macOS Keychain / Windows DPAPI）加密后才写入 `profiles.key`，明文绝不落盘 |
| 内存即焚（Zeroize）| P0 | 解密后的 `Buffer` 在 `finally` 块中调用 `.fill(0)` 强制清零；Rust 层 `SensitiveBuffer` 实现 `ZeroizeOnDrop`，离开作用域自动擦除密钥材料 |

#### 2.5.2 生物识别解锁

| 功能 | 平台 | 实现方式 |
|---|---|---|
| Touch ID 解锁 | macOS | `systemPreferences.promptTouchID()`，支持免密口令启动应用 |
| 敏感操作二次验证 | macOS | 切换「开发者模式 / 安全模式」等高权限操作时，强制要求 Touch ID 或主密码确认，防止越权操作（C-04）|

#### 2.5.3 敏感配置字段加密（Sandbox Config）

`initScript`、`proxyHost`、`proxyPort` 等敏感会话字段，通过独立的 `encrypt-config` / `decrypt-config` IPC 调用，使用 `safeStorage` 加密后存入独立的 `localStorage_secure` 命名空间，与明文配置严格分离（M-06）。

---

### 2.6 插件系统

**产品目标**：构建一个受控、强隔离的插件扩展生态，允许第三方开发者在不突破核心安全边界的前提下，对 GETSSH 进行功能扩展。

#### 2.6.1 双模插件架构

| 插件模式 | 运行位置 | 沙盒隔离机制 | 能力范围 |
|---|---|---|---|
| 主进程插件（Node.js）| Electron 主进程 | `vm.Script` 上下文隔离 + API 能力白名单注入 | 可访问受限的 SSH/SFTP/Storage API，RPC 双向通信 |
| 渲染器插件（iframe）| 渲染进程 iframe | `sandbox="allow-scripts"`（`allow-same-origin` 已禁用，H-02 已修复）| 通过 `PluginBridge` 的 `postMessage` 信道与宿主通信 |

#### 2.6.2 插件生命周期

1. **安装阶段**：用户拖拽 `.zip` 插件包 → `previewPlugin()` 解压至临时目录 → 校验 `manifest.json` → 展示权限声明审查界面 → 用户确认后 `commitPluginInstall()` 复制至正式插件目录
2. **激活阶段**：`PluginManager.activatePlugin()` 加载并运行主进程插件脚本
3. **通信阶段**：渲染器插件通过 `PluginPane.tsx` 封装的 `window.postMessage` 与宿主通信；主进程插件通过 `ipcMain.handle` 调用 RPC 接口
4. **停用/卸载阶段**：`deactivatePlugin()` 触发 → 清理全部 EventEmitter 监听器 → （卸载时）删除插件目录及存储数据

#### 2.6.3 安全约束矩阵

| 安全约束 | 实现机制 |
|---|---|
| ZIP Slip 目录穿越防御 | 解压时所有压缩包条目路径经 `path.relative()` 校验边界 |
| 安装目录边界强制 | `getSecurePluginPath()` 确保解压目标不超出 `pluginsPath` 根目录 |
| 解密 API 封锁 | 插件 API 白名单中不暴露 `safeStorageDecrypt` 等解密接口 |
| 高危终端操作封锁 | `PluginBridge.BLOCKED_ACTIONS` 阻断：`sshWrite`、`sshConnect`、`sshDisconnect`、`saveProfiles`、`unlockProfiles`、`sftpWriteFile`、`sftpDelete` |
| 私有 IP 访问限制 | 主进程插件发起网络请求时，DNS 解析后进行 `isPrivateIP()` 检测，拦截 SSRF 攻击 |
| iframe 来源认证 | `PluginBridge` 校验 `event.source` 是否与 `data-plugin-id` 对应的 iframe 实例一致，防止伪造来源 |
| IPC 子帧请求拦截 | `ipcMain.on/handle` 全局补丁：所有 `event.senderFrame.parent !== null` 的请求一律拒绝（M-11）|
| 剪贴板访问审计 | `ctx.host.clipboard.readText()` 调用时，强制触发系统通知（含插件名称），同时主进程记录完整审计日志 |

#### 2.6.4 安全策略等级

| 等级 | 模式 | 描述 |
|---|---|---|
| 最高限制 | 安全模式（safe）| 完全禁用所有插件；需 Touch ID 或主密码验证后方可进入/退出该模式 |
| 高度限制 | 严格模式（strict）| 最严格沙盒约束，功能受限，适用于生产环境操作 |
| 标准 | 普通模式（normal）| 默认推荐，沙盒全启用，平衡功能与安全 |
| 最低限制 | 开发者模式（developer）| 解除部分沙盒限制，提供 RASP 豁免，仅建议开发调试场景使用；需二次身份验证 |

#### 2.6.5 插件能力扩展点（Extension Points）

| 扩展点 API | 描述 |
|---|---|
| `registerSidebarAction` | 在主侧边栏注入自定义操作按钮（SVG 图标经 DOMPurify 消毒处理）|
| `registerPanel` / `openPanel` | 注册并在工作区 Pane 树中开启全屏自定义面板 |
| `registerUIExtension` | 向终端右键上下文菜单 / SFTP 工具栏注入额外操作项 |
| `registerSettingsSchema` | 在偏好设置中心注入插件自定义配置项（支持 string / number / boolean / password 类型）|
| Plugin RPC | 渲染器插件 ↔ 主进程插件的双向 RPC 调用信道 |
| `pluginStorage` | 基于 `getssh-kv` Rust 模块的隔离 KV 持久化存储 |
| `onSysmonData` | 订阅 Rust Sysprobe 采集的实时系统资源监控数据推送 |
| `ctx.net.fetch` | 受 SSRF 防火墙保护的网络请求能力（需在 `manifest.json` 中显式声明 `net:fetch` 权限）|

---

### 2.7 安全中心（SecureCenter / RASP）

**产品目标**：为用户提供可感知、可操作的物理级运行态安全防护，而非隐形黑盒式的被动防御。

#### 2.7.1 六大安全防御纵深屏障

| 序号 | 屏障名称 | 核心组件 | 技术描述 |
|---|---|---|---|
| ① | **Rust 物理看门狗（Watchdog）** | `rust-core/watchdog` 独立二进制 | 独立于 Electron 进程运行，通过 Unix Domain Socket（macOS/Linux）或 Named Pipe（Windows）进行心跳通信。主进程 60 秒内未响应心跳，Watchdog 通过 OS API 对父进程群发出物理级 SIGKILL 强制终止。同时支持 SAFE MODE 自动识别，崩溃恢复时不误杀 |
| ② | **内存即焚引擎（Zeroize）** | `getssh-vault` Rust N-API | `ZeroizeOnDrop` 在 Rust 对象离开作用域时自动以 0x00 覆写 AES 密钥与密文缓冲区；TypeScript 层 `finally` 块调用 `buffer.fill(0)` 执行二次擦除 |
| ③ | **金库级加密引擎（Vault）** | `getssh-vault` Rust N-API | PBKDF2-HMAC-SHA256（100,000 次）+ AES-256-GCM 认证加密，全程在 Rust 密闭空间执行，密钥材料绝不进入 V8 GC 管辖的堆内存 |
| ④ | **零拷贝网络 I/O 引擎** | `sftp-stream` Rust N-API | SFTP 大文件传输由 Rust 直接接管磁盘 I/O，Zero-copy 绕过 V8 堆内存，从根本上杜绝大文件操作的 OOM 风险 |
| ⑤ | **RASP 运行态主动防御** | `SecureCenter.ts` | 动态监控插件执行流与系统调用，通过 `auditPluginCommand()` 检测并拦截 Fork Bomb / `rm -rf` / `mkfs` 等高危命令执行模式 |
| ⑥ | **底层内存完整性校验** | `getssh-sysprobe` Rust N-API | 定期校验关键系统函数的内存首字节，实时检测 Inline Hook 植入企图（部分功能需要提升进程权限）|

#### 2.7.2 安全告警覆层（SecurityOverlay）

当 Watchdog 通过 IPC 上报 `LOCKDOWN_TRIGGER` 事件时，渲染层全屏渲染锁定覆层：

| 告警级别 | 触发条件 | 用户操作选项 |
|---|---|---|
| 🔴 红色警报（内存级）| 检测到内存完整性异常或物理级威胁 | 「立刻重启安全模式」/ 「15 秒抢救性存盘」/ 「忽略」|
| 🟡 黄色警告（插件级）| 插件触发了 RASP 高危行为被阻断 | 「关闭异常插件」/ 「继续执行」/ 「忽略」|

> 覆层附带 `00:XX` 格式倒计时，超时后 Watchdog 自动执行强制关闭操作。

#### 2.7.3 安全中心仪表盘

- Watchdog 实时连接状态与心跳延迟可视化
- 安全等级图形化仪表（绿色/黄色/红色盾牌）
- 六大安全屏障的详情展开说明与工作状态说明
- 子页面导航层级：`dashboard` → `rasp` / `privacy` / `safestorage` / `known_hosts` / `shield_details`

---

### 2.8 主机密钥管理（Known Hosts）

**产品目标**：完整实现 SSH 指纹验证机制，有效防范中间人攻击（MITM）。

| 功能 | 描述 |
|---|---|
| 首次连接指纹验证 | 弹出 `HostKeyVerificationModal`，展示 SHA256 指纹，用户可选「永久信任并保存」/ 「仅本次信任」/ 「拒绝」|
| MITM 变更检测告警 | 已记录主机指纹发生变化时，展示高危 MITM 警告，可视化对比新旧指纹差异，强制用户主动确认覆盖 |
| 受信主机管理 | 偏好设置 → 安全 → Known Hosts 清单，支持逐条吊销信任记录 |
| 历史数据格式迁移 | 自动迁移旧版 `Buffer` 对象格式的指纹记录为标准 `SHA256:base64` 字符串格式 |
| 数据持久化 | 存储于 `userData/known_hosts.json` |

---

### 2.9 连接审计日志

**产品目标**：提供合规可查的只读连接元数据历史记录。

- 记录字段：会话别名、目标主机、接入时间、断开时间、持续时长
- **合规承诺**：严禁捕获任何键盘输入内容与终端输出数据
- 支持导出为 CSV 文件，供外部合规审计工具处理
- 当前版本数据存储于内存中，应用重启后不持久化（v2.1 规划引入本地持久化）

---

### 2.10 全局 UI 视觉系统

**产品目标**：为跨平台用户提供视觉完全一致、离线可用的高品质界面排版体验。

#### 2.10.1 「双子星」全离线本地字体栈

v2.0 引入了完全离线化的本地字体方案，彻底移除对外部 Google Fonts CDN 的网络依赖，消除在弱网或离线环境下的界面字体加载闪烁（Layout Shift）问题。

| 字体 | 作用域 | 授权协议 | 技术覆盖 |
|---|---|---|---|
| **Reddit Sans** | UI 界面英文字母、数字、标点 | SIL Open Font License (OFL) | 现代几何无衬线字体，提供科技感、高辨识度的英文排版 |
| **MiSans** | UI 界面中文字符及后备渲染 | 小米公司提供，**免费商用**，Copyright © Xiaomi | 平滑几何字体，为中英混排界面提供视觉均衡 |

**全局字体优先级回退栈（font-sans）：**

```css
font-family: 'Reddit Sans', 'MiSans', '-apple-system', 'BlinkMacSystemFont',
             'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif;
```

> ⚠️ **版权声明**：MiSans 为小米公司（Xiaomi）拥有并提供的字体资产，GETSSH 仅在其许可范围内（免费商用）进行本地捆绑使用，不拥有该字体的知识产权，亦不以任何形式对该字体进行二次分发或售卖。

#### 2.10.2 终端字体独立隔离

代码终端区域（xterm.js WebGL 画布渲染层）通过 CSS `font-mono` 声明与 UI 字体栈实现严格隔离，独占 **Fira Code / 等宽流**编程字体，保障代码对齐不受 UI 字体切换的任何干扰。

#### 2.10.3 「黑曜石（Obsidian）」视觉设计语言

- **全局 Glassmorphism 毛玻璃材质**：基于 `backdrop-filter: blur()` 的亚克力分层界面，允许 macOS 系统光影透过渗染
- **四边形零圆角美学**：所有 UI 元件统一采用 `border-radius: 0px`（圆形徽章除外），构建工业感的棱角视觉秩序
- **品牌色动态注入**：主题色通过 CSS 变量 `--primary-color` 进行全局动态注入，支持实时切换而无需刷新页面

---

### 2.11 隐私保护与自动锁屏

| 功能 | 描述 |
|---|---|
| 界面隐私模式 | 应用失去焦点（`onAppBlur`）时，窗口内容执行模糊化处理 |
| 空闲自动锁屏 | 可配置无操作超时时长（分钟），超时后触发主密码解锁屏幕（M-07）|
| 主密码自动清除 | 锁屏触发后，主密码从 Zustand `cryptoStore` 内存中立即清除，防止内存残留泄露 |

---

### 2.12 国际化（i18n）

| 功能 | 描述 |
|---|---|
| 简体中文（zh-CN）| 全量翻译覆盖：所有 UI 文本、安全告警、错误提示均有中文版本 |
| 英语（en-US）| 全量翻译，系统默认语言 |
| 实时语言切换 | 偏好设置 → 外观 → 语言，切换即时生效，无需重启应用，`react-i18next` 驱动 |
| 时间格式本地化 | 所有时间戳跟随 `i18n.language` 进行本地化格式化 |
| 安全告警本地化 | 全部 RASP 告警与 Watchdog 风险描述均提供中英双语版本 |

---

### 2.13 自动更新

| 功能 | 描述 |
|---|---|
| macOS（未代码签名）| 通过 `electron.net.request` 调用 GitHub Releases API 进行手动版本检查 |
| Windows / Linux | 通过 `electron-updater` 进行全自动更新检查与下载 |
| 更新提示横幅 | 检测到新版本后，侧边栏设置图标显示红色提醒角标，全局顶部横幅提示 |
| 后台静默检查 | 应用启动时检查一次，此后每 12 小时后台检查一次 |
| 手动触发检查 | 偏好设置 → 关于 → 检查更新 |

---

### 2.14 偏好设置中心

**产品目标**：提供统一、集中的全局配置入口，支持面包屑历史导航。

#### 2.14.1 设置模块索引

| 模块 | 核心配置项 |
|---|---|
| 外观 | 主题（深色 / 浅色 / 跟随系统）、品牌主题色、毛玻璃效果开关、背景透明度、界面语言 |
| 终端 | 字体族、字号、行高、内边距、光标样式与闪烁、滚动行数、响铃模式、右键行为模式、终端配色主题 |
| 网络与连接 | 默认 SSH 端口、保活心跳间隔、全局代理类型 / 地址 / 端口 |
| 系统与行为 | 退出前确认对话框、全局唤起快捷键（默认 `Option+Space`）、全局初始化脚本 |
| 安全中心 | RASP 配置 / 隐私保护 / SafeStorage 管理 / 配置导出 / Known Hosts 管理 / 六大安全屏障详情 |
| 插件管理 | 已安装插件列表、安装 / 卸载操作、沙盒安全策略等级切换、插件自定义配置 Schema 渲染 |
| 关于 | 版本号、构建哈希、运行环境（Electron / Node.js / Chrome / 平台 / 架构）、自动更新触发 |
| 审计日志 | 连接历史只读视图、CSV 格式导出 |

#### 2.14.2 设置页导航体验

- 设置页面内部维护面包屑历史栈（`history` + `historyIndex`），支持「返回上一页」/「前进」的浏览器式双向导航
- 安全中心子页面导航层级：`dashboard` → `rasp` / `privacy` / `safestorage` / `export` / `known_hosts` / `shield_details`

---

## 3. 非功能性需求

### 3.1 性能指标

| 指标 | 目标值 |
|---|---|
| 应用冷启动时间 | < 3 秒 |
| 分屏标签页切换延迟 | 无可感知重连或卡顿（CSS 常驻挂载保活策略）|
| 插件加载影响 | 全异步 I/O，对主进程 UI 渲染零阻塞 |
| 大流量终端（如 `tail -f` 压测）| 维持稳定 60fps 渲染（Rust 多线程 PTY 二进制直通）|
| 系统监控采集延迟 | 毫秒级（Rust Sysprobe 近零开销采集，相比 `child_process` 方案显著降低）|

### 3.2 安全基线要求

- **零容忍原则**：所有 CRITICAL 级安全漏洞在正式版本发布前必须 100% 修复
- **IPC 来源强制校验**：所有 `ipcMain.on` / `ipcMain.handle` 处理器须校验 `event.senderFrame.parent === null`，拒绝来自任何 iframe 子帧的 IPC 请求
- **导航白名单**：`will-navigate` 事件精确校验目标路径，仅允许导航至 `dist/index.html` 或 Vite Dev Server 地址
- **弹窗全局封锁**：`setWindowOpenHandler` 全局返回 `{ action: 'deny' }`，阻止任意 `window.open` 弹出行为
- **外链协议白名单**：`shell.openExternal` 仅允许 `http://` 和 `https://` 协议的外部链接
- **CSP 合规路线**：当前保留 `unsafe-inline` 作为过渡（v2.1 计划完全移除），已移除 `unsafe-eval`（规划中）

### 3.3 打包与分发规格

| 规格项 | 要求 |
|---|---|
| macOS DMG 格式 | ULFO 高效压缩，arm64 / x64 独立安装包 |
| Windows NSIS 格式 | x64 / arm64 独立安装包 |
| Linux AppImage 格式 | x64 / arm64 便携式安装包 |
| Rust 原生模块（`.node`）| 通过 `asarUnpack: ["**/*.node"]` 从 ASAR 包中解出，在文件系统中直接 `require()`；加载器严格按平台 + 架构 + ABI 后缀（Windows 的 `-msvc`，Linux 的 `-gnu` / `-musl`）精确映射文件名 |
| Watchdog 守护进程 | 通过 `extraResources` 打包至 `resources/watchdog`（macOS/Linux）和 `resources/watchdog.exe`（Windows）|

---

## 4. 技术架构

### 4.1 技术栈全景

| 层级 | 技术组件 | 版本 / 备注 |
|---|---|---|
| 桌面运行时 | Electron | ^42.x，`vite-plugin-electron` 构建驱动 |
| 前端框架 | React + TypeScript | ^19.x + ^6.x，并发渲染模型 |
| 构建工具链 | Vite | ^8.x |
| 状态管理 | Zustand + Immer | ^5.x，多 Store 拆分（app / session / plugin / crypto / panel）|
| SSH / SFTP 协议 | ssh2 | ^1.x，支持 SOCKS5 / HTTP 代理 |
| 本地终端 PTY | node-pty-prebuilt-multiarch | ^1.x |
| 终端渲染引擎 | xterm.js | @xterm/xterm ^6.x，WebGL 渲染 + Canvas 降级 |
| 样式系统 | TailwindCSS | v4.x（JIT，`@tailwindcss/vite` 插件）|
| UI 字体 | Reddit Sans + MiSans | 全离线本地化加载，`@font-face` 注册 |
| 国际化 | react-i18next | ^17.x |
| Rust 加密核心 | `getssh-vault` N-API | aes-gcm + pbkdf2 + zeroize |
| Rust 系统监控 | `getssh-sysprobe` N-API | sysinfo crate 系统指标采集 |
| Rust SFTP 流 | `sftp-stream` N-API | Zero-copy 上传 / 下载 |
| Rust 工作区引擎 | `nexus-core` N-API | 分屏布局状态机，SSOT 架构 |
| Rust 看门狗 | `watchdog` 独立二进制 | 无 V8 依赖，物理强杀机制 |
| Rust 插件存储 | `getssh-kv` N-API | 插件隔离 KV 持久化存储 |
| Rust 归档处理 | `getssh-unarchive` N-API | ZIP 解压，ZipSlip 防御 |
| 自动化测试 | Vitest + Playwright | 单元测试 + E2E 集成测试 |
| DOM 安全 | DOMPurify | ^3.x，i18n HTML 注入防护及插件 SVG 消毒 |

### 4.2 Rust Native Modules 全景

| 模块 | 路径 | 类型 | 核心职责 |
|---|---|---|---|
| `nexus-core` | `rust-core/nexus-core` | N-API `.node` | 工作区分屏布局状态机（SSOT），递归二叉树管理 |
| `getssh-vault` | `rust-core/getssh-vault` | N-API `.node` | AES-256-GCM 加解密，PBKDF2 密钥派生，ZeroizeOnDrop |
| `getssh-sysprobe` | `rust-core/getssh-sysprobe` | N-API `.node` | 系统 CPU / 内存 / 网络 / 磁盘实时采集 |
| `sftp-stream` | `rust-core/sftp-stream` | N-API `.node` | SFTP 零拷贝上传 / 下载，全平台 ABI 精确映射 |
| `getssh-kv` | `rust-core/getssh-kv` | N-API `.node` | 插件隔离 KV 持久化存储 |
| `getssh-unarchive` | `rust-core/getssh-unarchive` | N-API `.node` | ZIP 插件包解压（含 ZipSlip 目录穿越防御）|
| `watchdog` | `rust-core/watchdog` | 独立二进制 | 主进程心跳监控，跨平台物理强杀，SAFE MODE 识别 |

### 4.3 主进程模块结构

```
electron/main/
├── index.ts                 # 入口：IPC 全局补丁、getssh-plugin:// 协议注册、窗口创建
├── PluginManager.ts         # 插件完整生命周期管理（激活/停用/安装/卸载）
├── nexus/
│   └── nexusBridge.ts       # Nexus Core NAPI 封装：IPC 信令路由、PTY 流绑定
├── handlers/
│   ├── index.ts             # 所有 handler 统一注册入口
│   ├── sshHandler.ts        # SSH 连接、Known Hosts 管理、审计日志、代理
│   ├── ptyHandler.ts        # 本地 Shell（node-pty）、Telnet（net.Socket）
│   ├── sftpHandler.ts       # SFTP 操作，调用 Rust sftp-stream N-API
│   ├── cryptoHandler.ts     # 主密码 Vault、Touch ID 生物识别、safeStorage
│   ├── systemHandler.ts     # 系统监控（Rust sysprobe）、更新检查、配置加密
│   ├── profileHandler.ts    # 配置文件导入 / 导出
│   ├── windowHandler.ts     # 窗口安全策略、CSP 头注入、导航拦截
│   └── themeHandler.ts      # 操作系统主题检测（深色 / 浅色模式）
├── security/
│   └── SecureCenter.ts      # RASP 主动防御、Watchdog IPC 通信、安全锁定覆层触发
└── services/
    ├── SSHBridge.ts         # SSH 数据跨进程事件总线
    ├── ConnectionManager.ts # 活跃 SSH 会话 Map 管理及生命周期
    └── PluginStorageManager.ts  # 插件 KV 存储访问封装层
```

### 4.4 架构核心战略：绞杀藤（Strangler Fig）模式

> **战略核心：坚守 Electron 底座，Node.js 退化为消息路由层，核心算力持续下沉至 Rust**

- **拒绝迁移 Tauri**：规避 WebKit / WebView2 跨系统版本碎片化导致的渲染一致性差异，确保 UI 在全平台像素级一致
- **Rust 负责**：加密运算、内存擦除、文件 I/O、系统监控、布局状态机、进程守护
- **Node.js 负责**：IPC 信令路由、业务逻辑编排、SSH 协议栈管理
- **React / TypeScript 负责**：UI 渲染、状态订阅、用户交互响应

---

## 5. 产品版本路线图

| 版本 | 里程碑名称 | 核心交付内容 | 状态 |
|---|---|---|---|
| v1.0.0 | MVP 奠基 | 核心 SSH 连接 + SafeStorage 凭证存储 + 暗色 Glassmorphism UI | ✅ 已发布 |
| v1.1.0 | 国际化与 SFTP 增强 | 中英双语全量 i18n + 增强型 SFTP 文件管理器 + 自动连接配置 | ✅ 已发布 |
| v1.2.0 | 状态现代化与插件 MVP | Zustand 全量状态迁移 + 插件系统 MVP + 极限安装包体积优化（101MB DMG）| ✅ 已发布 |
| v1.2.1 | 主进程模块化重构 | 主进程按领域模块化重构 + SFTP 健壮性修复 + 静默后台更新 | ✅ 已发布 |
| v1.3.0 | 安全审计 V3.0 | 安全审计全量修复（5 个 CRITICAL 漏洞）+ RASP 沙盒实装 + 设置中心 UI 全面重设计 | ✅ 已发布 |
| v1.3.x | 键盘体验与协议扩展 | Command Center 完整键盘导航 + 插件 UI 优化 + Telnet 协议支持 | ✅ 已发布 |
| **v2.0.0（R7K4S）** | **Rust 全栈整合与双子星视觉** | **Nexus Core 工作区引擎（Rust SSOT 分屏状态机）+ 全离线双子星字体栈（Reddit Sans + MiSans）+ Rust Vault + Sysprobe + SFTP-Stream + Watchdog 全面量产 + React 19 + Tailwind v4 + 32 个历史漏洞全量修复 + 六大安全防御纵深屏障 + 全平台 NAPI 精确 ABI 映射修复** | 🚀 **当前正式版本** |
| v2.1.0（规划中）| 安全加固与工作区 | CSP 全面收紧（移除 `unsafe-eval`）+ Windows 正式代码签名发布 + Workspace 工作区上下文隔离 | 📋 规划中 |
| v2.2.0（规划中）| 生态与跳板机 | Plugin Marketplace 插件市场 + SSH Jump Host 多级跳板机 + 终端内容实时搜索 | 📋 规划中 |

---

## 6. 产品设计哲学

> **「机制即防御，而非单靠加密」**
> 安全性通过架构机制保障：IPC 帧来源校验、Watchdog 物理强杀、Rust 内存即焚，而非单纯依赖通信加密层。

> **「开发者工具首先应该是工具，其次才是视觉体验」**
> UI 以极简为基调，在不损失信息密度的前提下，融入精致的过渡动效与毛玻璃材质美学。

> **「RASP 的告警应让人读懂，而非只是吓到人」**
> 所有安全告警均附带人类可读的风险描述，以用户的母语告知潜在威胁，并提供明确可操作的响应选项。

> **「Rust 不是选配，而是核心骨骼」**
> 任何涉及密码学、文件 I/O、系统监控、布局状态、进程守护的关键路径，必须由 Rust 原生扩展承担。TypeScript 只做信令调度与用户界面展示。

> **「跨平台一致性是承诺，而非口号」**
> 从字体渲染到 UI 像素、从 ABI 文件名精确映射到安全覆层的行为一致性，GETSSH 在所有受支持平台上提供同等质量的体验保障。
