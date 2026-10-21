# GETSSH

[English](README.md) | 中文

[![版本](https://img.shields.io/badge/版本-3.0.0--preview-blueviolet?style=flat-square)](https://github.com/JiangchenShen/GETSSH/releases/tag/v3.0.0-preview)
[![Electron](https://img.shields.io/badge/Electron-44-47848F?style=flat-square&logo=electron&logoColor=white)](https://electronjs.org/)
[![Rust](https://img.shields.io/badge/Rust-N--API-CE4A00?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![许可](https://img.shields.io/badge/许可-Apache%202.0-blue?style=flat-square)](LICENSE)

GETSSH 是一个免费、开源的 SSH 客户端，支持 macOS 和 Windows。

- SSH、Telnet 会话、本地终端和 SFTP 都在同一个窗口里。
- 服务器、密码和私钥加密存放在您的电脑上。
- 需要时，可以用自己的模型密钥让 AI 帮忙排查问题。

当前版本是 **3.0 预览版**（`3.0.0-preview`，2026-10-21），提供 macOS 和 Windows 的 FUSION 版本。Linux 用户请继续使用 [2.0](https://github.com/JiangchenShen/GETSSH/releases/tag/v2.0.0_R7K4S)，2.x 在 [`V2`](https://github.com/JiangchenShen/GETSSH/tree/V2) 分支上维护。

- 官网：<https://getssh.realmcloud.net>
- 3.0 预览版的发布说明：[docs/release-notes/v3.0.0-preview.md](docs/release-notes/v3.0.0-preview.md)
- 更新日志：[docs/CHANGELOG_CN.md](docs/CHANGELOG_CN.md)

## 下载

在 [GitHub 发布页](https://github.com/JiangchenShen/GETSSH/releases/tag/v3.0.0-preview)下载：

| 系统 | 处理器 | 文件 |
|---|---|---|
| macOS 13 及以上 | Apple Silicon | `GETSSH-3.0.0-preview-arm64.dmg` |
| macOS 13 及以上 | Intel | `GETSSH-3.0.0-preview.dmg` |
| Windows 10 及以上 | x64 | `GETSSH-Setup-3.0.0-preview-x64.exe` |
| Windows 10 及以上 | ARM64 | `GETSSH-Setup-3.0.0-preview-arm64.exe` |

`SHA256SUMS.txt` 里是这几个文件的 SHA-256。

应用没有 Apple 开发者签名，Windows 安装包也没有签名。第一次打开时：
- macOS 13、14：在"应用程序"里右键点 GETSSH，选"打开"。
- macOS 15 及以上：先打开一次 GETSSH，系统提示无法验证开发者以后，打开"系统设置 → 隐私与安全性"，在下方点"仍要打开"。
- Windows：SmartScreen 提示时，点"更多信息"，再点"仍要运行"。

从 2.0 升级时，第一次启动会自动导入 2.0 的服务器和插件数据，2.0 的文件不改也不删。详见发布说明。

## 功能

- **连接**：
  - SSH：可以用密码、磁盘上的私钥文件，或存进 GETSSH 的私钥；
  - Telnet 和本地终端；
  - 第一次连接一台主机时要确认它的指纹，指纹变了会提醒；
  - 可以经 SOCKS5 或 HTTP 代理连接。
- **工作区**：可以建多个，每个工作区有自己的加密数据库。主工作区以外的工作区可以各自设密码。
- **私钥**：
  - 可以导入 OpenSSH、PEM（PKCS#1、SEC1、PKCS#8）和 PuTTY `.ppk`（第 2、3 版）格式的 Ed25519、RSA、ECDSA 私钥；
  - 可以生成新的 Ed25519 私钥；
  - 服务器原来用的私钥文件可以导入 GETSSH，原文件可以选择移到废纸篓（Windows 上是回收站）。
- **SFTP**：在 SSH 会话旁边浏览和传输文件。
- **潮汐引擎（Tidal Engine）**：分屏、调整窗格比例、聚焦一个窗格，或者把会话移到独立窗口。
- **命令中心**：搜索主机和常用操作。快捷键是 ⌥ + Space 或 ⌘ + K，Windows 上是 Alt + Space 或 Ctrl + Shift + K。
- **加密备份**：把选中的工作区导出成一个 `.getssh-backup` 文件，在另一台电脑上只凭导出密码就能整份恢复。
- **AI 排障**：
  - 可以选 OpenAI、Gemini、Claude、DeepSeek、智谱 GLM、Kimi、MiniMax、通义千问 Qwen、Ollama（本地模型）或自定义端点；
  - 四种模式：只读问答、感知助手、审批执行、自动执行；
  - 每条命令执行前要不要经您同意，由所选模式决定；
  - 审批执行和自动执行模式下，AI 可以联网搜索，默认开启，可以在 AI 设置里关掉。
- **插件和 MCP**：后端插件和本地 MCP 服务器在受系统限制的进程里运行。插件开发见 [SDK 指南](https://getssh.realmcloud.net/zh/sdk)，示例插件在 [`plugins/`](plugins)。

## 数据怎么保护

**防住了什么**：
- **硬盘上的数据**：每个工作区一个数据库，用 SQLCipher 4 格式加密，钥匙各不相同。密码、私钥和口令在库里再用 AES-256-GCM 单独加密一层。
- **界面拿不到秘密**：秘密只在主进程里解开，连接时直接交给 SSH。
- **主密码**：可选，至少 12 个字符，用 Argon2id 处理（64 MiB，3 轮），不会存下来。
  - 设了主密码，加密数据库里的内容（服务器、密码、私钥、AI 会话和 AI 服务的密钥）都由它保护。数据加上主密码，在任何电脑上都能恢复。
  - 设主密码时会生成一个恢复码，只显示一次。
- **不设主密码**：钥匙由这台电脑保管，macOS 用 Secure Enclave 或登录钥匙串，Windows 用 TPM 或 DPAPI。数据库文件复制到别的电脑上打不开，数据也只能在这台电脑上打开。
- **Touch ID / Windows Hello**：可以代替输入密码，开不开都不影响数据能否带走。
- **加密备份**：导出密码至少 12 个字符，经 Argon2id 派生出钥匙，再用 AES-256-GCM 分块加密。
- **AI 请求**：发给模型服务之前，能识别出的敏感信息（如密码、令牌）会换成占位符。AI 发起的联网搜索也只带占位符。
- **插件**：插件安全模式为两种"隔离模式"时，每个后端插件在一个受限进程里运行，macOS 用 Seatbelt，Windows 用 AppContainer。插件访问文件、网络和客户端功能都要先声明。

**没防住的**：
- GETSSH 解锁期间，以您的账号运行的其他程序有可能读取它的内存。
- 不设主密码时，能登录您这个电脑账号的人就能打开 GETSSH。
- 还在用磁盘上私钥文件的服务器，那个文件的安全取决于它所在的磁盘，它也不在加密备份里。
- 敏感信息替换只能处理认得出的内容，不能保证发给模型的文字里没有一点敏感信息。
- 主机指纹、连接记录、最近连接、界面设置（包括您填的 Google 搜索 API 密钥）、插件自己存的数据和终端录像，不在加密数据库里，明文存在磁盘上。
- "开发者模式"下，后端插件直接在主进程里运行，权限和 GETSSH 一样。

## 隐私

GETSSH 没有账号，不做统计，也没有遥测。它只在这些时候联网：
- 您打开的 SSH 和 Telnet 连接；
- 检查新版本：启动时一次，之后每 12 小时一次，在"设置 → 关于"里点检查时也会查。macOS 访问 GitHub 的发布接口，Windows 访问 GitHub 上的发布文件；
- 您用 AI 时，访问您配置的模型服务；
- AI 联网搜索（审批执行和自动执行模式下，默认开启）：搜索词发给公共 SearXNG 服务器（列表取自 searx.space）、DuckDuckGo 或 Bing，或者您设置的 Google、SearXNG 地址；
- 插件和 MCP 服务器，只在您允许的范围内联网。

## 从源码构建

需要：
- Node.js 24；
- pnpm 11.2.2（`corepack enable` 会按 `packageManager` 字段装好）；
- Rust stable（用 `rustup` 安装）；
- macOS 13 及以上：Xcode 命令行工具，存储模块里有一段 Swift 代码要编译；
- Windows 10 及以上：Python 3，以及 Visual Studio 2022 生成工具，选"使用 C++ 的桌面开发"，再加上"MSVC Spectre 缓解库"组件（ARM64 电脑还要装 ARM64 生成工具）。装依赖时 node-gyp 要重新编译 node-pty。

```bash
git clone https://github.com/JiangchenShen/GETSSH.git
cd GETSSH
pnpm install --frozen-lockfile

# Rust 原生模块。按本机填 aarch64-apple-darwin、x86_64-apple-darwin、
# x86_64-pc-windows-msvc 或 aarch64-pc-windows-msvc
RUST_TARGET=aarch64-apple-darwin node scripts/build-native.js
pnpm --filter getssh build:native-tools   # watchdog，Windows 上还有 getssh-sandbox

pnpm dev
```

上面是 bash 的写法。Windows 的 PowerShell 里这样设环境变量：`$env:RUST_TARGET='x86_64-pc-windows-msvc'; node scripts/build-native.js`。

**注意**：开发版用的是您真实的数据目录 `~/.getssh`。只改界面时，可以用 `GETSSH_FAKE_STORE=1 pnpm dev`（PowerShell：`$env:GETSSH_FAKE_STORE='1'; pnpm dev`）：加密存储只放在内存里，但 `~/.getssh` 下的 `app-config.json`、插件数据和 MCP 设置仍会写入。

测试：

```bash
pnpm --filter getssh test                        # 应用的单元测试（vitest）
cargo test --workspace --exclude ocean-sentinel  # Rust 模块
```

在 Windows 上，请在 cargo test 后面加上 `-- --skip made_up_tpm_key_names_are_lost_keys`：这个测试会把改过的数据交给真实的 TPM，`scripts/windows-verify.ps1` 默认也跳过它。

`apps/getssh-client/package.json` 里还有插件隔离、MCP 沙箱、加密存储端到端等专项测试，它们要用编译好的原生模块。

安装包由 [`.github/workflows/release.yml`](.github/workflows/release.yml) 打出：
- 4 种系统和架构，各在对应的机器上打包，原生模块不交叉编译；
- 打包后检查每个原生文件的架构，再启动一次打好的应用；
- 推 `v*` 标签时，生成一个草稿版本。

## 目录

| 位置 | 内容 |
|---|---|
| `apps/getssh-client/electron` | 主进程和 preload：连接、存储接口、插件和 MCP 的进程隔离 |
| `apps/getssh-client/src` | 界面（React） |
| `rust-core/getssh-store` | 数据层：SQLCipher 加密库、服务器和私钥、加密备份 |
| `rust-core/getssh-keystore` | 钥匙层级、主密码、恢复码和设备密钥，编译进 getssh-store |
| `rust-core/ocean-sentinel` | 敏感信息替换、Watchdog，以及 Windows 上的沙箱启动器 |
| `rust-core/` 下的其他模块 | 插件存储（getssh-kv）、系统监控（getssh-sysprobe）、插件解压（getssh-unarchive）、2.x 的加密格式（getssh-vault）、SFTP 传输（sftp-stream）、布局（tidal-engine）、审计日志（audit-stream） |
| `docs` | 设计文档，大多是中文。`GETSSH_STORE_DESIGN_CN.md` 讲数据层，`PLUGIN_SDK_INTERNAL_CN.md` 讲插件接口 |

## 许可

Copyright © 2026 Jiangchen Shen。以 [Apache License 2.0](LICENSE) 授权。

安装包里附带 `THIRD_PARTY_NOTICES.txt`，列出用到的第三方软件和各自的许可，说明见 [docs/legal/THIRD_PARTY_LICENSES.md](docs/legal/THIRD_PARTY_LICENSES.md)。MiSans 字体的许可协议原文在[官网](https://getssh.realmcloud.net/zh/legal/licenses#misans)。
