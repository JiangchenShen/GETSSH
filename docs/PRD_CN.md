# GETSSH — 产品需求文档 (PRD)

**文档版本**：V2.0（代码库反向推导版）
**产品名称**：GETSSH
**当前版本**：v2.0.0-preview
**文档性质**：本文档基于现有代码库进行完整的反向工程推导，忠实还原了产品的全部功能边界、技术决策与设计哲学。
**最后更新**：2026-05

---

## 1. 产品概述

### 1.1 产品定位

GETSSH 是一款面向专业开发者与运维工程师的**跨平台桌面 SSH 终端客户端**，以 Electron + React 19 + Rust Native Addon 构建，主打「极简极客」美学与「物理级」安全防护的双重体验。

- **竞品对标**：Terminus, Royal TSX, SecureCRT, iTerm2
- **核心差异化**：
  - 原生毛玻璃（Glassmorphism）UI + 多协议终端总线（SSH / Telnet / 本地 Shell）
  - Rust 物理级多层安全防护（Watchdog + Vault + Sysprobe + RASP）
  - 类 VSCode 无限深度分屏架构（Pane Tree）
  - 可扩展插件生态（iframe 沙盒 + 主进程 N-API 插件双模）
  - SafeStorage 零知识凭证保险箱（Rust AES-256-GCM + PBKDF2）

### 1.2 目标用户

| 用户画像 | 描述 |
|---|---|
| **主力用户** | 需要频繁管理多台远端 Linux/Unix 服务器的后端工程师、DevOps 工程师 |
| **次要用户** | 对 SSH 工具有安全敏感性要求的 Web3/安全研究人员 |
| **潜在用户** | 对替换 iTerm/Terminal 有意愿但希望集成化体验的全栈开发者 |

### 1.3 平台目标

- **MVP**：macOS (arm64 Apple Silicon + x64 Intel) — DMG/ZIP 双格式
- **已支持**：Windows x64/arm64 (NSIS 安装包)
- **规划中**：Linux (AppImage x64/arm64)

---

## 2. 核心功能模块

### 2.1 多协议终端连接管理

**目标**：提供统一的多协议终端接入能力，一个入口连接所有设备。

#### 2.1.1 连接协议支持

| 协议 | 优先级 | 技术实现 | 描述 |
|---|---|---|---|
| SSH | P0 | `ssh2` Node.js 库 | 标准 SSH v2，支持密码/私钥认证 |
| 本地 Shell | P0 | `node-pty` | macOS 拉起 Zsh/Bash，Windows 拉起 PowerShell |
| Telnet | P1 | `net.Socket` + NVT 协商 | 支持思科/华为等网络设备管理，termType 强制 vt100 |
| 协议自动识别 | P0 | 前端正则解析 | 支持 `ssh://`、`telnet://`、`user@host` 格式自动匹配 |

#### 2.1.2 连接配置项（`SessionProfile`）

```typescript
interface SessionProfile {
  protocol?: 'ssh' | 'local' | 'telnet';
  host: string;
  username: string;
  password?: string;
  privateKeyPath?: string;
  port?: number;
  autoStart?: boolean;     // 应用启动后自动连接
  useKeepAlive?: boolean;
  alias?: string;
  authType?: 'password' | 'key';
  osType?: OsType;         // 远端 OS 类型自动识别
}
```

> `osType` 由 SSH 登录成功后对服务器 banner/提示符进行模式匹配自动推断，支持 ubuntu / debian / centos / rhel / fedora / alpine / arch / suse / windows / macos / cisco / huawei / generic 等类型。

#### 2.1.3 代理支持

| 代理类型 | 实现 |
|---|---|
| 无代理 | 直连 |
| SOCKS5 | `SocksClient` 封装，连接到代理后再发起 SSH |
| HTTP | `http-proxy-agent` CONNECT 隧道 |

**技术约束**：
- 会话 ID 使用 `crypto.randomUUID()` 生成，防止线性顺序猜测 (M-12)
- PTY 终端尺寸 (`rows`/`cols`) 须 Clamp 在 `[1, 500]`，防止 C++ 层缓冲区崩溃 (H-06)
- 本地 Shell 使用安全的 Shell 白名单 (`getSafeShell()`) 而非直接信任 `$SHELL` 环境变量
- PTY 僵尸进程在主窗口销毁时通过 `app.on('before-quit')` 清理钩子处理 (M-10)

---

### 2.2 终端体验

**目标**：提供接近原生终端的流畅体验，同时具备分屏、主题等高级功能。

#### 2.2.1 渲染引擎

| 功能 | 优先级 | 描述 |
|---|---|---|
| xterm.js 渲染 | P0 | `@xterm/xterm` v6，带 WebGL 加速渲染（优先），Canvas 降级回退 |
| Ligatures 支持 | P1 | `@xterm/addon-ligatures`，Fira Code 等编程字体连字渲染 |
| 字体配置 | P0 | 全局可配置字体家族、字体大小、行高、内边距（0-32px）|
| 光标样式 | P1 | block / underline / bar，可配置闪烁开关 |
| 终端响铃 | P1 | 支持 none / audible / visual 三种响铃模式 |
| 右键行为 | P1 | 可切换为「上下文菜单」或「直接粘贴/复制」模式 |
| 终端主题 | P1 | 内置多套配色主题，支持用户导入自定义 JSON 主题文件（含原型污染防御）|
| 回滚行数 | P1 | 可配置（默认 10000 行）|
| 选中自动复制 | P2 | 可选启用 copyOnSelect 模式 |
| 防瞎眼模式 | P2 | Anti-Glare：深色高对比度模式 |
| 搜索功能 | P2 | 终端内容全文搜索（基于 xterm SearchAddon）|

**关键技术决策**：
- 采用**「CSS 常驻挂载」策略**：Tab 切换时，终端 DOM 节点不卸载而是通过 `display:none` 隐藏，保活 xterm.js 实例和 SSH 连接，解决了 React 重渲染导致连接中断的问题。
- 应用启动时追加 Chromium 命令行参数禁用后台节流（`disable-renderer-backgrounding` 等），防止应用最小化后 SSH 连接超时。

#### 2.2.2 分屏架构（Pane Tree）

采用**递归二叉树**数据结构管理分屏布局：

```typescript
type PaneNode = PaneLeaf | PaneSplit;
// PaneLeaf: { type:'leaf', paneType:'welcome'|'terminal'|'plugin', sessionId, config }
// PaneSplit: { type:'hsplit'|'vsplit', children:[PaneNode, PaneNode], sizes:[number, number] }
```

| 功能 | 描述 |
|---|---|
| 水平分割 (hsplit) | 左右分屏，各分屏独立持有 SSH 会话 |
| 垂直分割 (vsplit) | 上下分屏 |
| 任意深度嵌套 | 支持 n 层分屏，每个叶节点独立连接不同主机 |
| 可拖拽调整比例 | `SplitPane` 组件支持拖拽调整分隔线位置（sizes 百分比） |
| 每屏可承载不同内容 | 终端 / 插件面板 / Command Center 欢迎页，任意混合 |

---

### 2.3 SFTP 文件管理器

**目标**：内置轻量级图形化 SFTP 操作界面，免去用户切换额外工具。

#### 2.3.1 功能列表

| 功能 | 优先级 | 描述 |
|---|---|---|
| 目录浏览 | P0 | 带图标的文件列表，区分目录 (`d`)、文件 (`-`)、软链接 (`l`) |
| 文件上传 | P0 | Rust N-API `SftpUploader`，底层 Zero-copy 流式搬运 |
| 文件下载 | P0 | Rust N-API `SftpDownloader`，支持原生「选择下载目录」对话框 |
| 快速路径跳转 | P1 | 地址栏输入绝对路径一键跳转 |
| 文件实时同步编辑 | P1 | 双击文件在本地默认编辑器打开，保存时自动触发 SFTP 上传同步（`sftp-edit-sync`）|
| 新建目录 | P1 | 内置 Modal，不依赖系统 `window.prompt` |
| 文件删除 | P1 | 支持文件和目录（`unlink` / `rmdir`）|
| 默认下载路径 | P2 | 全局可配置 `sftpDownloadPath`，可跳过每次对话框 |

#### 2.3.2 安全约束

- **防 OOM 保护 (C-06)**：直接内存读取文件上限为 **10MB**，超过则拒绝并提示用户使用本地编辑器同步。
- **防 TOCTOU 符号链接竞争 (M-13)**：编辑同步时的临时文件名包含 `crypto.randomUUID()` 后缀。
- **文件大小限制 (L-01)**：`sftp-edit-sync` 编辑模式限制 5MB；纯下载模式由 Rust 流式处理无大小限制。
- **路径穿越防御**：所有远端路径经过 `path.posix.normalize()` 规范化后再使用。

---

### 2.4 Command Center（主控台）

**目标**：提供统一的「入口门户」，整合连接、工具、插件于一身，体验对标 Raycast/Spotlight。

| 功能 | 优先级 | 描述 |
|---|---|---|
| 实时模糊搜索 | P0 | 匹配所有已保存会话（alias / host / username）|
| 键盘全流程导航 | P0 | ↑/↓ 选择，Enter 一键连接，ESC 关闭面板 |
| 快速直连 | P0 | 搜索框直接输入 `user@host` 回车，无需预先保存 |
| 插件入口聚合 | P1 | 「本地工具与插件」区域列出已安装插件，一键打开 |
| 仪表盘时钟 | P2 | 实时日期时间，跟随 i18n 语言本地化 |
| 安全污染告警 | P1 | 检测到 RASP 告警时，Command Center 顶部显示红/黄色安全警告横幅，附带 Watchdog 给出的原因 |
| 快捷操作丸 | P2 | 快速跳转「新建连接」「设置」入口 |

---

### 2.5 凭证安全保险箱（Crypto Vault）

**目标**：在本地持久化存储敏感凭证时，提供 OS 级 + Rust N-API 物理级双重加密保护。

#### 2.5.1 主密码机制

| 功能 | 优先级 | 实现 |
|---|---|---|
| 主密码设置 | P0 | `CryptoModal`，最低字符数限制为 4 位 (M-08 已修复为 8 位) |
| PBKDF2 密钥派生 | P0 | Rust `getssh-vault` N-API 扩展，PBKDF2-HMAC-SHA256，100,000 次迭代，32 字节 Salt (NIST SP 800-132) |
| AES-256-GCM 加密 | P0 | 认证加密，内含 MAC 验证，防篡改 |
| 格式兼容 | P0 | 支持 V1（16B Salt）和 V2（9B Magic + 32B Salt）两种格式自动识别 |
| 原子写入 | P0 | 先写临时文件（UUID 后缀），再 `rename()` 原子替换，防止写入一半损坏文件 |
| 主密码零知识存储 | P0 | 主密码经 `Electron safeStorage`（macOS Keychain / DPAPI）加密后才写入 `profiles.key`，明文从不落盘 |
| 内存即焚 | P0 | 解密后的 `Buffer`/`masterPasswordBuffer` 在 `finally` 块中调用 `.fill(0)` 覆写；Rust 层的 `SensitiveBuffer` 实现 `ZeroizeOnDrop` |

#### 2.5.2 生物识别解锁

| 功能 | 平台 | 实现 |
|---|---|---|
| Touch ID 解锁 | macOS | `systemPreferences.promptTouchID()`，用于无密码启动应用 |
| 生物识别验证 | macOS | 切换「开发者模式 / 安全模式」时需要 Touch ID 或主密码二次确认，防止越权 (C-04) |

#### 2.5.3 敏感配置加密（Sandbox Config）

除主密码流程外，`initScript`、`proxyHost`、`proxyPort` 等敏感字段也通过独立的 `encrypt-config` / `decrypt-config` IPC 调用，使用 `safeStorage` 加密后存入 `localStorage_secure` 键，与明文设置分离存储 (M-06)。

---

### 2.6 插件系统

**目标**：提供一个受控、隔离的插件扩展生态，允许第三方开发者在不破坏核心安全边界的前提下扩展 GETSSH 功能。

#### 2.6.1 双模插件架构

| 模式 | 运行位置 | 沙盒机制 | 能力 |
|---|---|---|---|
| 主进程插件 (Node.js) | Electron 主进程 | `vm.Script` 上下文隔离 + API 白名单注入 | 可调用受限 SSH/SFTP/Storage API |
| 渲染器插件 (iframe) | 渲染进程 iframe | `sandbox="allow-scripts"`（禁用 `allow-same-origin`，[H-02] 已修复）| 通过 `PluginBridge` 与宿主通信 |

#### 2.6.2 插件生命周期

1. **安装**：用户拖拽 `.zip` 文件 → `previewPlugin()` 解压到临时目录 → 校验 `manifest.json` → 展示权限审查 → `commitPluginInstall()` 复制到正式目录
2. **激活**：`PluginManager.activatePlugin()` 加载主进程插件脚本
3. **通信**：渲染器插件通过 `PluginPane.tsx` 中的 `window.postMessage` 与宿主通信，主进程插件通过 `ipcMain.handle` RPC 调用
4. **卸载**：`deactivatePlugin()` → 清理所有 EventEmitter 监听器 → 删除插件目录

#### 2.6.3 安全约束

| 约束 | 实现 |
|---|---|
| ZIP Slip 防御 | 解压时所有 entry 路径经过 `path.relative()` 校验 |
| 路径穿越防御 | `getSecurePluginPath()` 校验目标路径不超出 pluginsPath 边界 |
| `safeStorageDecrypt` 禁止 | 插件 API 白名单中不暴露解密接口 |
| sshWrite 等高危操作禁止 | `PluginBridge` 的 `BLOCKED_ACTIONS` 集合阻断：`sshWrite`, `sshConnect`, `sshDisconnect`, `saveProfiles`, `unlockProfiles`, `sftpWriteFile`, `sftpDelete` |
| 私有 IP 访问限制 | 主进程插件发起网络请求时，DNS 解析后进行 `isPrivateIP()` 检测 |
| iframe 来源校验 | `PluginBridge` 验证 `event.source` 是否与 `data-plugin-id` 对应的 iframe 一致，防止 spoofing |
| IPC 子帧拦截 | `ipcMain.on/handle` 全局补丁：`event.senderFrame.parent !== null` 的请求一律拒绝 (M-11) |

#### 2.6.4 插件安全模式等级

| 模式 | 描述 |
|---|---|
| 安全模式 (safe) | 禁用所有插件 |
| 严格模式 (strict) | 最高级别沙盒（功能受限）|
| 普通模式 (normal) | 默认推荐 |
| 开发者模式 (developer) | 解除沙盒限制，RASP 豁免 |

> 切换至 `safe` 或 `developer` 模式需要 Touch ID 或主密码双因素验证（macOS 有 Touch ID 时）。

#### 2.6.5 插件扩展点

| 扩展点 | 描述 |
|---|---|
| `registerSidebarAction` | 在侧边栏注入自定义操作按钮（图标使用 SVG 消毒处理）|
| `registerPanel` / `openPanel` | 注册并打开自定义面板（作为 Pane 节点展示）|
| `registerUIExtension` | 为终端右键菜单 / SFTP 工具栏注入额外操作项 |
| `registerSettingsSchema` | 在设置中心注入插件自定义配置项 |
| Plugin RPC | 双向 RPC 调用：渲染器 ↔ 主进程插件 |
| `pluginStorage` | 隔离的 KV 存储（`getssh-kv` 模块，基于 `userData/plugin-storage/` 目录）|
| `onSysmonData` | 订阅 Rust Sysprobe 实时系统监控数据推送 |

---

### 2.7 安全中心（SecureCenter / RASP）

**目标**：为用户提供可感知的、物理级的实时运行时安全防护，而非隐形黑盒。

#### 2.7.1 六大安全屏障

| 屏障 | 组件 | 描述 |
|---|---|---|
| **Rust 物理级看门狗** | `rust-core/watchdog` 独立二进制 | 独立于 Electron 进程运行，通过 Unix Socket/Named Pipe IPC 心跳监控主进程。心跳超过 5 秒未响应则调用 OS kill API 强制终止整个 Node.js 进程群。 |
| **内存即焚（Zeroize）** | `getssh-vault` Rust N-API | `ZeroizeOnDrop` 在离开作用域时用 0x00 覆写 AES 密钥、密文缓冲区；TS 层 `finally` 块调用 `buffer.fill(0)` 二次擦除。 |
| **金库级加密引擎** | `getssh-vault` Rust N-API | PBKDF2-HMAC-SHA256 (100,000 次) + AES-256-GCM，完全在 Rust 密闭空间完成，绕过 V8 GC。 |
| **Zero-Copy 网络引擎** | `sftp-stream` Rust N-API | SFTP 大文件由 Rust 直接接管磁盘 I/O，零拷贝绕过 V8 堆，防 OOM。 |
| **RASP 运行态主动防御** | `SecureCenter.ts` | 动态监控系统调用和插件执行流，拦截针对 Node.js 引擎的恶意代码注入（`auditPluginCommand()` 检测 fork bomb / rm -rf / mkfs 等高危模式）。 |
| **底层内存完整性校验** | `getssh-sysprobe` Rust N-API + 原生 Scanner | 定期校验关键系统函数内存首字节，检测 Inline Hook 企图（需 root 权限）。 |

#### 2.7.2 安全告警 Overlay（SecurityOverlay）

当 Watchdog 通过 IPC 上报 `LOCKDOWN_TRIGGER` 时，渲染层渲染全屏锁定覆层：

- **红色警报（Red Level）**：内存级别威胁，提供「立刻重启安全模式」/「抢救性存盘 15 秒」/「忽略」三个选项
- **黄色警告（Yellow Level）**：插件高危操作被阻断，提供「关闭异常插件」/「继续执行」/「忽略」
- **倒计时炸弹**：显示 00:XX 倒计时，超时后 Watchdog 自动强杀

#### 2.7.3 安全中心设置仪表盘

- 实时展示 Watchdog 连接状态（Rust Watchdog IPC Ping 延迟）
- 安全等级可视化（绿色/黄色/红色盾牌图标）
- 六大安全屏障详情展开说明（点击盾牌进入详情页）
- 可导航子页面：概览 → RASP / 隐私 / SafeStorage / 配置管理 / Known Hosts

---

### 2.8 主机密钥管理（Known Hosts）

**目标**：完整实现 SSH 指纹验证机制，防范中间人攻击（MITM）。

| 功能 | 描述 |
|---|---|
| 首次连接验证 | 弹出 `HostKeyVerificationModal`，展示 SHA256 指纹，用户选择「信任并保存 / 仅本次信任 / 拒绝」|
| MITM 变更检测 | 已记录主机的指纹发生变化时，展示高危 MITM 警告，对比新旧指纹，需用户主动确认覆盖 |
| 已知主机管理 | 设置中心 → 安全 → Known Hosts 列表，可逐条撤销信任 |
| 历史格式迁移 | 自动迁移旧版 `Buffer` 对象格式的指纹为 `SHA256:base64` 字符串 |
| 持久化 | 存储于 `userData/known_hosts.json` |

---

### 2.9 连接审计日志

**目标**：提供只读的连接元数据历史记录，供合规审计使用。

- 记录每次连接的：会话别名、目标主机、接入时间、断开时间、持续时长
- 完全只读：严禁捕获任何键盘输入与终端输出内容
- 支持导出为 CSV 文件
- 存储于内存中，应用重启后不持久化（当前版本）

---

### 2.10 隐私与自动锁屏

| 功能 | 描述 |
|---|---|
| 隐私模式 | 应用失去焦点（`onAppBlur`）时，窗口内容模糊处理 |
| 空闲自动锁屏 | 配置无操作超时（分钟），超时后触发主密码解锁屏幕 (M-07) |
| 主密码自动清除 | 锁屏后主密码从 Zustand `cryptoStore` 中清除，防止内存残留 |

---

### 2.11 国际化（i18n）

| 功能 | 描述 |
|---|---|
| 简体中文 (zh-CN) | 全量翻译，包含所有 UI、安全告警、错误提示 |
| 英文 (en-US) | 全量翻译，默认语言 |
| 实时语言切换 | 设置 → 外观 → 语言，无需重启，`react-i18next` 驱动 |
| 时间本地化 | 所有时间戳跟随 `i18n.language` 格式化 |
| 安全告警本地化 | 所有 RASP 告警、Watchdog 原因描述均有中英双语版本 |

---

### 2.12 自动更新

| 功能 | 描述 |
|---|---|
| macOS（未签名）| 使用 `electron.net.request` 调用 GitHub Releases API 手动检查最新版本 |
| Windows/Linux | 使用 `electron-updater` 自动检查 |
| 更新横幅 | 检测到新版本时，侧边栏设置图标显示红点，全局横幅提示 |
| 后台静默检查 | 应用启动时检查一次，之后每 12 小时检查一次 |
| 手动检查 | 设置 → 关于 → 检查更新按钮 |

---

### 2.13 设置中心

**目标**：提供统一、集中的全局配置入口，支持面包屑导航历史。

#### 2.13.1 设置模块

| 模块 | 主要配置项 |
|---|---|
| 外观 | 主题（暗/浅/跟随系统）、主题颜色、毛玻璃效果、背景透明度、语言 |
| 终端 | 字体、字号、行高、内边距、光标样式、回滚行数、响铃模式、右键行为、终端配色主题 |
| 网络与连接 | 默认端口、心跳保活间隔、代理类型/地址/端口 |
| 系统与行为 | 退出前确认、全局呼出快捷键（`Option+Space` 默认）、全局初始化脚本 |
| 安全中心 | RASP / 隐私 / SafeStorage / 配置管理 / Known Hosts / 安全六大屏障详情 |
| 插件 | 插件列表、安装/卸载、沙盒安全策略切换、插件设置 Schema 渲染 |
| 关于 | 版本信息、构建号、系统环境信息（Electron/Node/Chrome/平台/架构）、自动更新 |
| 审计日志 | 连接历史只读视图、CSV 导出 |

#### 2.13.2 导航体验

- 设置页面维护面包屑历史栈（`history` + `historyIndex`），支持「返回上一页」/「前进」浏览器式导航
- 安全中心子页面：`dashboard` → `rasp` / `privacy` / `safestorage` / `export` / `known_hosts` / `shield_details`

---

## 3. 非功能性需求

### 3.1 性能

- 应用冷启动 < 3 秒
- 分屏状态切换无明显重连或卡顿（CSS 常驻挂载保活）
- 插件加载全异步 I/O，不阻塞主进程
- Rust Sysprobe 以近乎零开销（相比 `child_process` 方案）毫秒级采集系统状态

### 3.2 安全

- **CRITICAL 级漏洞 Zero Tolerance**：发布前必须修复所有 CRITICAL 级漏洞
- IPC 通信须校验 `event.senderFrame.parent === null`，拒绝来自 iframe 子帧的所有 IPC 请求
- `will-navigate` 事件精确路径校验，仅允许导航至 `dist/index.html` 或 Vite Dev Server
- CSP 须移除 `unsafe-eval`（`unsafe-inline` 作为过渡期保留）
- `setWindowOpenHandler` 全局返回 `{ action: 'deny' }`，禁止任意弹出新窗口
- 仅允许 `http://` 和 `https://` 协议的外部链接通过 `shell.openExternal` 打开

### 3.3 打包与分发

| 指标 | 目标 |
|---|---|
| macOS DMG | ULFO 格式压缩，支持 x64/arm64 |
| Windows NSIS | 支持 x64/arm64 |
| Linux AppImage | 支持 x64/arm64 |
| `.node` 原生模块 | ASAR 解包（`asarUnpack: ["**/*.node"]`），直接从文件系统 `require()` |
| Watchdog 二进制 | 通过 `extraResources` 打包至 `resources/watchdog` |

---

## 4. 技术架构

### 4.1 技术栈总览

| 层次 | 技术 | 版本/说明 |
|---|---|---|
| 桌面框架 | Electron | ^42.x，`vite-plugin-electron` 驱动 |
| 前端框架 | React + TypeScript | ^19.x + ^6.x |
| 构建工具 | Vite | ^8.x |
| 状态管理 | Zustand | ^5.x，多 store 拆分（app / session / plugin / crypto / panel）|
| SSH/SFTP | ssh2 | ^1.x，支持 SOCKS5/HTTP 代理 |
| 本地终端 | node-pty | ^1.x，node-pty-prebuilt-multiarch |
| 终端渲染 | xterm.js | @xterm/xterm ^6.x + WebGL/Canvas Addon |
| 样式 | TailwindCSS | v4.x (JIT，@tailwindcss/vite 插件) |
| 国际化 | react-i18next | ^17.x |
| Rust 加密核心 | getssh-vault | N-API 扩展，aes-gcm + pbkdf2 + zeroize |
| Rust 系统监控 | getssh-sysprobe | N-API 扩展，sysinfo crate |
| Rust SFTP 流 | sftp-stream | N-API 扩展，Zero-copy 上传/下载 |
| Rust 看门狗 | watchdog | 独立二进制，无 V8 依赖 |
| 测试 | Vitest + Playwright | 单元测试 + E2E 测试 |
| DOM 安全 | DOMPurify | ^3.x，用于 i18n HTML 注入防护和插件 SVG 消毒 |

### 4.2 Rust Native Modules 全景

| 模块 | 路径 | 类型 | 职责 |
|---|---|---|---|
| `getssh-vault` | `rust-core/getssh-vault` | N-API `.node` | AES-256-GCM 加解密，Zeroize |
| `getssh-sysprobe` | `rust-core/getssh-sysprobe` | N-API `.node` | 系统 CPU/内存/网络监控 |
| `sftp-stream` | `rust-core/sftp-stream` | N-API `.node` | SFTP 零拷贝上传/下载 |
| `getssh-kv` | `rust-core/getssh-kv` | N-API `.node` | 插件隔离 KV 存储 |
| `getssh-unarchive` | `rust-core/getssh-unarchive` | N-API `.node` | ZIP 解压（含 ZipSlip 防御）|
| `watchdog` | `rust-core/watchdog` | 独立二进制 | 主进程心跳监控，OS Kill |

### 4.3 主进程模块结构

```
electron/main/
├── index.ts              # 入口，IPC 全局补丁，协议注册，窗口创建
├── PluginManager.ts      # 插件完整生命周期管理（36KB）
├── handlers/
│   ├── index.ts          # 所有 handler 统一注册点
│   ├── sshHandler.ts     # SSH 连接、Known Hosts、审计日志、代理
│   ├── ptyHandler.ts     # 本地 Shell（node-pty）、Telnet（net.Socket）
│   ├── sftpHandler.ts    # SFTP 操作，调用 Rust sftp-stream
│   ├── cryptoHandler.ts  # 主密码 Vault，Touch ID，safeStorage
│   ├── systemHandler.ts  # 系统监控（Rust sysprobe）、更新检查、配置加密
│   ├── profileHandler.ts # 配置导入/导出
│   ├── windowHandler.ts  # 窗口安全策略，CSP，导航拦截
│   └── themeHandler.ts   # 系统主题检测
├── security/
│   └── SecureCenter.ts   # RASP，Watchdog IPC，安全锁定
└── services/
    ├── SSHBridge.ts      # SSH 数据跨进程事件总线
    ├── ConnectionManager.ts  # 活跃 SSH 连接 Map 管理
    └── PluginStorageManager.ts  # 插件 KV 存储访问封装
```

### 4.4 架构核心战略（绞杀藤模式）

> **坚守 Electron 底座，Node.js 退化为消息转发器，核心算力下沉至 Rust**

- **不迁移 Tauri**：规避 WebKit/WebView2 版本碎片化导致的跨设备渲染差异
- **Rust 负责**：加密运算、内存擦除、文件 I/O、系统监控、看门狗守护
- **Node.js 负责**：IPC 路由、业务逻辑编排、SSH 协议栈
- **React/TS 负责**：UI 渲染、状态管理、用户交互

---

## 5. 版本路线图

| 版本 | 里程碑 | 状态 |
|---|---|---|
| v1.0.0 | MVP：核心 SSH + SafeStorage + 暗色 UI | ✅ 已发布 |
| v1.1.0 | 多语言 + 增强 SFTP + 自动连接 | ✅ 已发布 |
| v1.2.0 | Zustand 全量迁移 + 插件系统 MVP + 极限包体积优化 | ✅ 已发布 |
| v1.2.1 | 主进程模块化重构 + SFTP 健壮性修复 + 静默更新 | ✅ 已发布 |
| v1.3.0 | 安全审计 V3.0 + RASP 沙盒 + 5 个 CRITICAL 漏洞修复 + 设置 UI 重设计 | ✅ 已发布 |
| v1.3.x | Command Center 键盘导航 + 插件 UI 优化 + Telnet 支持 | ✅ 已发布 |
| **v2.0.0-preview** | **Rust 全栈整合（Vault + Sysprobe + SFTP-Stream + Watchdog）+ React 19 + Tailwind v4 + 32 漏洞全量修复 + 六大安全屏障** | 🚀 当前版本 |
| v2.1.0（规划）| CSP 全面收紧（移除 unsafe-eval）+ Windows 正式签名发布 + Workspace 工作区隔离 | 📋 规划中 |
| v2.2.0（规划）| Plugin Marketplace + SSH Jump Host 跳板机 + 终端内容搜索 | 📋 规划中 |

---

## 6. 产品设计哲学

> **「机制即防御，而非单靠加密」**
> 安全性通过架构机制保障：IPC 帧校验、Watchdog 物理强杀、Rust 内存即焚，而非单纯依赖通信加密。

> **「开发者工具首先应该是工具，其次才是视觉体验」**
> UI 以极简为基调，在不破坏信息密度的前提下融入精致动效和毛玻璃质感。

> **「RASP 的告警应让人读懂，而非吓到人」**
> 安全告警附带人类可读的风险描述，用母语告知用户潜在威胁，并给出明确的行动选项。

> **「Rust 不是选配，而是核心骨骼」**
> 任何涉及密码学、文件 I/O、系统监控、进程守护的关键路径，必须由 Rust 承担，TypeScript 只做调度和展示。
