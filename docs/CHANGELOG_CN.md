# 📝 GETSSH 更新日志 (Changelog)

所有对 GETSSH 项目的重大更改都将记录在此文件中。项目遵循语义化版本控制。

[English](CHANGELOG_EN.md) | 中文版

---

## [1.3.1] (Build K9V2X) - 2026-05-21

### 🛠️ 原生本地终端与多协议智能分发 (Native PTY & Multi-Protocol Routing)
- **原生本地 Shell (Local PTY) 引擎集成**：彻底摒弃了此前依赖 `ssh2` 强连本地 `::1` 回环地址的“伪本地”方案。我们全新开发了 `ptyHandler.ts` 底层原生进程网关，直接在 Electron Node 进程中拉起操作系统原生的 Bash / Zsh / PowerShell！彻底终结了 `connect ECONNREFUSED ::1:22` 报错，为您提供零延迟、全权限的无缝本地终端体验。
- **配置持久化 Schema 修复**：深入修复了 `profileHandler.ts` 在 Profile 序列化时丢失 `protocol` 选项的严重漏洞。现在，重启应用后所有的协议选择（如 SSH、Local、Telnet）都会被精准记忆，告别配置丢失。
- **新会话智能协议锁死防误触**：全面优化 `ConnectForm.tsx` 的智能解析引擎。协议的自动探测与切换（如输入 `localhost` 自动跳 Local）现仅对“新建且未保存的会话”生效。一旦会话保存，协议类型将永久锁死，完美防止用户在编辑 Host 时发生灾难性的协议覆写。
- **协议状态 100% 对齐绑定**：解决了侧边栏快速切换不同协议的主机时，右侧表单 UI 未能实时回填并同步协议高亮状态的问题。

### 🎨 黑曜石美学微重构与布局提权 (Obsidian Aesthetics & Layout Optimization)
- **单色极客滤镜与动态唤醒 (Monochrome & Active States)**：对侧边栏的所有 OS 图标（如 Ubuntu, Windows, Debian 等）默认强制注入冷高贵的去色滤镜 (`filter saturate-0`)，使其完美潜入黑曜石深色 UI 中；而当主机被选中连接时，系统会瞬间“解除封印”，强制注入高饱原厂品牌色 (`saturate-100 opacity-90`) 作为强烈的视觉奖励。
- **容器骨架强化与防缩水 (Shrink-Proof Framing)**：为 OS 徽章打造了冷灰色的直角专属限定边框 (`bg-black/20 border border-black/30 rounded-none`)，并强制植入 `shrink-0` 基因。即便您的服务器名称长如乱码，系统徽章也依然坚挺、绝不遭受任何挤压变形。
- **命令中心 (WelcomePane) 别名提权**：重构了启动页卡片的渲染逻辑。现在，WelcomePane 将不再冷冰冰地只显示 IP 地址，而是**优先、绝对地显示您精心设置的别名 (Alias)**，让成百上千台服务器的管理更加直观。
- **侧边栏物理提宽**：应广大运维极客要求，我们将左侧主机列表面板的物理宽度直接提升了 25%，为冗长的企业级服务器命名提供了更加宽容的生存空间，大幅降低了文字溢出截断率。

### ⚙️ 后台自动更新机制修复 (Updater Engine Refactoring)
- **硬核正则提取器 (Regex SemVer Extraction)**：彻底废弃了原更新模块中脆弱的 `split('.')` 版本字符串切割方案。全新引入的正则引擎 `v.match(/(\d+)\.(\d+)\.(\d+)/)` 可以无视诸如 `V.` 前缀或 `_K9V2X` 后缀等任何杂音，精准提纯三位核心版本号。
- **IPC 通信载荷对齐**：修复了“设置”页面手动点击“检查更新”时永远提示“已是最新版本”的欺骗性 Bug。现在后端会严格遵循 `{ hasUpdate, version, url }` 数据规范向前端回传侦测报告，精准触发新版发现弹窗。

### 🌐 国际化补全与隐蔽 Bug 修复 (i18n & Hotfixes)
- **设置面板全量汉化**：无死角覆盖了“设置 - 终端”与“设置 - 关于”面板的所有英文残留。
- **Auto-Start 网络代理下发**：修复了在勾选自动启动 (Auto-Start) 时，系统由于漏发 `proxyPort` 参数导致代理配置失效的隐患。
- **防篡改标签注入**：在设置关于面板补充了丢失的 `v1.3.1` 语义化版本号，与构建码 `K9V2X` 一同构筑起版本溯源追踪墙。

---

## [1.3.0] (Build B7X9Q) - 2026-05-19

### 🔌 插件沙盒生态系统正式贯通 (Plugin Sandbox Ecosystem)
这是 GETSSH 迈向高扩展性终端平台的最核心跨越。我们抛弃了硬编码的占位符，彻底打通了从本地文件物理提取到动态沙盒渲染的全链路闭环。
- **动态挂载与解析引擎**：重构 Welcome Pane，系统现已支持动态侦测 `plugins` 目录下的解压资产。智能解析插件内部的 `package.json`（优先读取 `getssh.name` / `displayName` 并优雅降级至 `name` 字段），结合 Zustand 状态树实现插件卡片的动态按需渲染。
- **终结 macOS 物理路径“黑洞”**：精准排查并修复了 macOS 环境下极度隐蔽的 Chromium 底层拦截机制。针对 `app.getPath('userData')` (如 `Application Support`) 因包含系统级空格导致本地 `file://` 协议解析断裂、引发 Iframe“绝对黑屏”的致命缺陷，现已通过标准 `encodeURI` 强制物理路径转码，完美打通本地安全路由。
- **Iframe 进程隔离与权限微调**：对插件渲染层进行精细的安全管控，注入 `sandbox="allow-scripts allow-same-origin"` 指令，在确保插件内 JS 引擎正常运转的同时，阻断对外部敏感环境的越权访问。
- **首个官方高能插件落地**：成功实装“本地系统资源监控 (System Monitor)”插件。以极致的紫黑赛博朋克 UI，实时抓取、可视化渲染本机 CPU 核心调度流水线与内存 (RAM) 的极限负载状态。

### 🎨 UI 视觉重构与灾难级 CSS 污染阻断 (Visual Refactoring & CSS Block)
- **浅色模式终端“失明”紧急抢修**：扑灭了因全局注入高对比度深色文本（如 `text-slate-800`）而引发的级联 CSS 越权污染危机。该污染曾导致 `xterm.js` 实例在浅色模式下变异为“黑底黑字”的瞎眼状态。现已为包裹 xterm 的容器穿上“防化服”，并通过显式配置 `theme: { foreground: '#FFFFFF' }` 强制锁死 Canvas 前景色，彻底捍卫了核心 SSH 交互区的极客体验。
- **极致深色毛玻璃 (Cyberpunk Glassmorphism)**：全面重构深色模式 (Dark Mode) 的混合逻辑，摒弃多余的色值干扰，呈现出纯净、深邃的黑曜石通透质感。
- **材质逻辑降级与剥离**：在浅色模式 (Light Mode) 下果断弃用毛玻璃特效，全面退回高对比度的实体底色 (`bg-slate-50`)，确保强光环境或复杂背景下的绝对可读性。
- **生产环境资源路由修复**：修复了 Vite 在构建生产包时因静态资源路径重定向，导致左上角 Logo SVG 图标丢失的问题。

### 🏭 极致工程化与防篡改体系 (Extreme Engineering & Anti-Tampering)
- **引入 Apple 级构建追踪体系**：从本版本起，正式演进版本号命名规范。在语义化版本号后附加五位字母数字混合的构建码（本次构建：**B7X9Q**），并注入 UI (About 面板/设置页)，大幅增强发布包的防篡改检验、精准溯源与灰度排错能力。
- **开源社区国际化倒置 (i18n Hub)**：为更好地拥抱全球极客社区，优化 GitHub 仓库门面，现已将默认主页挂载为全英文文档 (`README.md`)。原中文版平滑迁移至独立分发页 (`README_CN.md`)，并于双端顶部打通 Markdown 级快速语言路由机制。
- **83MB 极限瘦身与 Apple Silicon 原生优化**：
  - 彻底抛弃臃肿的双架构通用包 (Universal Binary)，针对当前 Mac 平台执行精准的 `arm64` 芯片级编译。
  - 在打包底层逻辑中强制注入 `"format": "ULFO"` (Apple 专用极限只读压缩格式) 与 `"compression": "maximum"` 算法。
  - 引入极其严苛的 `files` 剔除黑名单（无情拦截所有第三方 `node_modules` 中的测试用例、`.md` 说明书及无用 `.d.ts` 声明文件），稳稳将包含复杂 WebGL 渲染引擎的 Electron 桌面应用极限压榨至 80MB 级别。

### 🛡️ 代码健壮性与静态检查净化 (Test & Type Safety)
- **TDD (测试驱动开发) 覆盖网**：全面引入 Vitest 单元测试，为核心状态树 (`useAppStore`, `panelStore`, `usePluginStore`, `cryptoStore`) 及核心组件 (`ConnectForm`, `CryptoModal`, `TabBar` 等) 铺设了高密度的自动化测试用例，显著提升了代码抗重构能力。
- **TypeScript `any` 灭绝计划**：开展了极其严格的类型系统重构，彻底消灭了 `SSHConnectConfig`、动态面板注入（`PanelProps`）及 SFTP 核心逻辑中散落的 `any` 动态类型，实现了主渲染进程间 100% 强类型的安全传递。
- **极致的微秒级性能压榨**：
  - 重构配置导入架构，采用 `Promise.all` 实现跨进程配置的并发解析加载。
  - 为插件沙盒增加 Renderer 脚本的内存级缓存，消除重复加载的 V8 编译开销。
  - 优化 `svgSanitizer` (XSS 动态防护网) 和状态树遍历 (`collectSessionIds`) 的数组分配，大幅降低内存与垃圾回收 (GC) 抖动。
- **底层日志降噪与容错修复**：修复了极端断线场景下的空白回调报错以及剪贴板操作中的 Promise 拒接未捕获 (Swallowed Rejections) 隐患；清除了控制台海量的心跳轮询日志噪音与主进程中的冗余依赖。

---
## [1.2.1] - 2026-05-05

### 🚀 架构重构与生产力跃迁 (Refactoring & Productivity Leap)
- **主进程极致模块化**：
  - 彻底拆解了臃肿的 `electron/main/index.ts`（从 ~700 行缩减至 ~250 行）。
  - 抽象出 `ConnectionManager` (会话管理)、`sshHandler` (终端逻辑)、`sftpHandler` (文件逻辑) 和 `cryptoHandler` (加密逻辑) 独立模块。
  - 架构清晰度大幅提升，为后续多进程架构与插件深度集成奠定基础。
- **SFTP 功能全方位补全**：
  - **原生新建支持**：新增“新建文件”与“新建文件夹”功能，采用美观的 React 内置 Modal 替换系统原生 Prompt，交互更丝滑。
  - **快速路径导航**：地址栏现在支持点击直接输入（Address Bar），支持输入绝对路径一键跳转。
  - **健壮性修复**：修复了在特定 Linux 发行版（如 Oracle Cloud）下目录解析失败的 Bug，并完美支持了 SFTP 软链接（Symlink）图标显示与穿透访问。
- **静默更新与实时提醒**：
  - 实现了后台全自动版本检查，发现新版本时在侧边栏“设置”图标显示**红点提示 (Badge)**，并伴随轻量级 **Toast 气泡通知**。
  - 优化了版本对比正则逻辑，完美兼容 GitHub API 的 `V` 前缀 Tag 解析。
- **代码工程化**：
  - 移除了所有硬编码的版本号，统一由 `package.json` 驱动。
  - 解决了 Refactoring 过程中的所有 Typescript 类型告警，全工程静态校验 0 错误。

### 🐛 Bug 修复 (Bug Fixes)
- **SFTP 目录解析修复**：修复了在 Oracle Cloud (Ubuntu) 等环境下因 `ssh2` 属性对象缺失 `isDirectory` 方法导致的文件列表渲染失败。
- **符号链接支持**：解决了 SFTP 无法识别与进入软链接目录的问题，现在支持点击跳转。
- **更新算法修正**：修正了 `compareSemVer` 对 GitHub Tag 前缀大小写的兼容性问题（如 `V1.2.0` vs `1.2.1`）。
- **交互死锁修复**：彻底移除了在 macOS 上可能导致 UI 进程挂起的 `window.prompt` 调用，改用受控的 React Modal。
- **连接稳定性**：优化了 SSH Heartbeat 逻辑，修复了在某些网络波动环境下连接意外断开后状态未同步的问题。

---

## [1.2.0] - 2026-05-03

### 🚀 正式生产版 (Production Ready)
这是 GETSSH 历史上最重要的一次里程碑更新。我们不仅在视觉美学上达到了极致，更在内核架构、安全性、以及生产打包体积上实现了质的飞跃。

### ⚡ 核心性能与 I/O 革命 (New!)
- **全异步文件系统重构**：
  - 彻底完成了 `PluginManager` 从同步阻塞 `fs` 到异步 `fs.promises` 的底层重构。
  - **安装/卸载性能提升**：在大规模插件环境下，安装和卸载操作不再阻塞 Electron 主进程，消除了 UI 的“假死”感。
  - **异常安全防护**：所有异步 I/O 均配备了完善的 `try/catch` 逻辑，确保不会因未捕获的 Promise Rejection 导致主进程崩溃。
- **Auto-Start 智能逻辑修复**：
  - 修复了自动启动时忽略会话特定端口的 Bug。现在系统能够精准识别并使用每个连接定义的独立端口，而非强制回退到全局默认设置。

### ⚠️ 架构现代代与状态驱动 (State Deduplication)
- **Zustand 全量迁移 (Single Source of Truth)**：
  - 完成了 `App.tsx` 从传统的 `useState` 本地状态向 Zustand 全局状态树（`useAppStore` & `useSessionStore`）的彻底迁移。
  - **效果**：消除了“状态孤岛”，确保了 Tabs, Sessions, Config 之间的实时一致性，极大地提升了应用的可维护性。
- **终端状态零损耗持久化**：
  - 采用 **“CSS 常驻挂载”策略** 结合状态驱动，确保在切换视图时终端进程和 DOM 实例保持活跃。彻底解决了切换页面导致的连接中断问题。

### 🔒 铁壁安全加固 (Security Hardening)
- **性能与安全的完美融合**：
  - 在异步 I/O 重构中，完整保留并加固了 **Zip Slip 漏洞防御** 和 **路径穿越 (Path Traversal) 修复** 逻辑。
  - **getSecurePluginPath**：即使在异步模式下，系统依然会对所有插件路径进行严格的边界校验，确保插件无法越权访问 `.ssh/id_rsa` 等敏感系统文件。
- **SVG XSS 动态过滤**：采用 `DOMParser` 对插件图标进行深度扫描，强制拦截所有潜在的 XSS 攻击向量。
- **Iframe Sandbox 隔离**：插件运行环境彻底剥离 `allow-same-origin` 权限，实现物理级别的 API 隔离。

### 📦 打包与体积优化
- **包体积“魔术”级瘦身**：从 ~450MB 降低至 **~83MB (macOS)**。
- **构建精简化**：彻底剔除了源码、测试用例、.map 文件及非生产环境依赖。
- **极限压缩**：启用了 `maximum` 级别的 ASAR 压缩算法。

### 🛠️ 质量保证体系 (QA)
- **Vitest 全量覆盖**：全仓库 61 项单元测试 100% 通过。
- **TypeScript 静态检查**：实现了零错误编译，确保了生产环境的类型安全。

---

## [1.1.0] - 2026-04-20

### ✨ 新特性 (Features)
- **多语言系统 (i18n)**：引入全量国际化方案，支持中英文实时切换。
- **增强型 SFTP**：支持拖拽上传、文件实时重命名与权限修改。
- **自动连接 (Auto-Start)**：允许用户标记特定主机，在应用启动时自动建立 SSH 隧道。

### 🎨 UI/UX 优化
- **毛玻璃美学 (Glassmorphism)**：进一步打磨背景模糊与透明度混合逻辑。

---

## [1.0.0] - 2026-04-10

### ✨ 初始发布
- **核心 SSH 引擎**：基于 xterm.js 与 ssh2 实现的基础终端连接功能。
- **保险箱加密 (SafeStorage)**：引入主密码概念，对本地存储的敏感凭证进行 AES-256 加密。
- **响应式界面**：支持暗色模式/浅色模式的动态切换。

---

> "从巨石架构到安全沙盒，GETSSH 始终致力于打造最硬核的生产力工具。"
