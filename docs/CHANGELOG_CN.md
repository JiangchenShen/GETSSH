# 📝 GETSSH 更新日志 (Changelog)

所有对 GETSSH 项目的重大更改都将记录在此文件中。项目遵循语义化版本控制。

[English](CHANGELOG_EN.md) | 中文版

---

## [1.3.2-preview] (Build R7K4S) - 2026-05-28 → 2026-05-29

### 🏗️ 基础设施大换血第一阶段：React 19 核心引擎热替换 (Infrastructure Upgrade Phase 1: React 19)
这是 GETSSH 技术栈现代化的重要里程碑。我们将整个前端核心引擎从 React 18 迁移至 React 19，全面拥抱最新的 React 运行时特性，并同步升级 UI 组件库与类型系统，确保未来的所有功能开发都建立在最前沿的技术地基上。

### ⚛️ React 19 核心迁移 (React 19 Core Migration)
- **React 19.0.0 全量升级**：将 `react`、`react-dom` 及其类型定义 `@types/react`、`@types/react-dom` 全部拉升至 `19.0.0+`，应用全面运行于 React 19 并发渲染模型之上。
- **`forwardRef` 剥离预检**：全局扫描代码库，确认项目无任何 `React.forwardRef` 遗留包装，已天然适配 React 19 原生 ref-as-prop 新范式。
- **入口文件合规验证**：确认 `main.tsx` 入口使用了 `ReactDOM.createRoot`，符合 React 19 的强制规范，无任何旧版 `ReactDOM.render` 残留。
- **React 19 严格类型收束修复**：修复了 `ConnectForm.tsx` 中 `useRef<NodeJS.Timeout>()` 因 React 19 更严格的泛型推断规则报错的问题，将其更新为 `useRef<NodeJS.Timeout | null>(null)` 的规范写法。
- **Lucide React 最新版升级**：将图标库 `lucide-react` 升级至最新版本，全量验证所有图标导入名称在新版规范中的兼容性，确认零命名冲突与废弃告警。
- **`@testing-library/react` React 19 适配**：同步将测试库升级至最新版本，确保测试生态与 React 19 的 API 完全对齐。

### 🧹 环境物理清洗与依赖树重建 (Physical Dependency Purge & Rebuild)
- **幽灵依赖物理消灭**：彻底销毁旧版混杂的 `node_modules` 以及存在交叉污染的 `package-lock.json`，并执行 `npm cache clean --force` 强制清空系统级 NPM 旧版缓存，从根源上消灭任何 React 18 遗留碎片。
- **pnpm `node-linker=hoisted` 关键修复**：深度排查并修复了由于 `pnpm` 默认软链接（Symlink）存储策略与 Electron 原生运行时 CJS `require` 钩子不兼容导致的 `ssh2` 内部依赖路径迷失问题（`Cannot find module './constants.js'`）。通过在 `.npmrc` 中强制启用 `node-linker=hoisted`，让 `pnpm` 采用物理打平策略，完美解决了 Electron 中 CJS Native 模块的路径解析故障。
- **纯净依赖树封印**：基于最终升级完成的 `package.json` 执行了全新的 `pnpm install`，完成了对整个依赖生态树的纯净重组与封印。

### 🔒 V2.0 插件 SDK 安全沙盒全面实装 (Plugin SDK v2.0 — Security Sandbox)
- **`ctx.net.fetch` 网络通信桥实装**：在后台插件的 Node VM 沙盒 Context 中安全注入了 `ctx.net.fetch(url, options)` 方法。插件须在 `package.json` 的 `capabilities` 数组中显式声明 `"net:fetch"` 权限，否则调用将被直接阻断并抛出 `SecurityError`。
- **终极 SSRF 防御墙**：在底层 Fetch 拦截器中内置了严格的 DNS/正则双重防御，绝对禁止向局域网回环地址（`127.0.0.1`, `localhost`, `0.0.0.0`）及私有 IP 网段（`192.168.x.x`, `10.x.x.x`, `172.16.x.x`）发起任何请求。
- **`ctx.ui.registerSettings` 无代码配置表单**：在受控的 `ctx.ui` 命名空间中注入了配置表单注册接口，允许后台插件在 `activate` 阶段注册包含 `string`、`number`、`boolean`、`password` 等类型的配置 Schema；主进程通过 `sync-plugin-settings-schema` IPC 同步给前端 Zustand Store，并在 `Settings.tsx` 的"插件配置"专属 Tab 中动态渲染出风格与宿主完全一致的表单组件，同时实现热重载。
- **`ctx.host.clipboard` 审计可视剪贴板**：在受控的 `ctx.host` 命名空间中注入了 `clipboard.writeText` 和 `clipboard.readText`，底层直接桥接 Electron `clipboard` 原生模块；当插件调用 `readText` 时，系统**强制弹出操作系统原生通知**（通知内容含插件名称）以防止静默数据窃取，同时主进程记录完整审计日志。
- **`window.GETSSH.registerPanel` / `openPanel` 沉浸式面板**：通过 preload 脚本向前端插件暴露了面板注册与开启接口；在 `sessionStore.ts` 中新增 `PluginPanelTab` 路由类型，在 `SessionManager.tsx` 的渲染树中引入 `<webview>` 进行沙箱化全屏渲染，使插件可以从侧边栏控制并接管主工作区的全景视图。

### 🛡️ 全代码库安全加固与 Bug 扫清 (Full Codebase Security Audit & Bug Fixes)
- **IPC 路径穿越漏洞封堵**：在 `electron/main/index.ts` 中对 `getssh-plugin://` 自定义协议处理器实装严格的文件路径边界校验，拦截 `../../` 回溯攻击，确保插件只能读取其授权目录内的资产。
- **插件任意目录安装漏洞修复**：在 `PluginManager.ts` 的安装提交路径中增加对目标解压目录的 OS 级临时目录合法性校验，阻断非授权目录篡改。
- **SFTP 写入越权防护**：在 `sftpHandler.ts` 的文件下载接口中强制锁定写入路径，仅允许写入 `Downloads` 或 `Desktop` 目录，防止恶意插件通过 SFTP 桥在系统后台注入自启动木马。
- **TypeScript 全量 0 错误封印**：对 70+ 个历史遗留 TypeScript 类型错误进行了系统性清除，涉及 `src/types.d.ts`（补全缺失的 `electronAPI` 接口）、`LeafPane.tsx`、`PluginPane.tsx`、`TerminalPane.tsx`、`SplitPane.tsx`、`App.tsx` 等核心组件，最终实现 `npx tsc --noEmit` 输出**零错误**。


### 🦀 四大战区 Rust 底层改造全面竣工 (Rust Native Core — Full Completion)
这是一次对 GETSSH 进行彻底底层改造的里程碑式 Preview 版本。我们正式将 GETSSH 的核心性能敏感型路径从 Node.js / V8 完全剥离，交由 Rust 原生扩展（N-API）接管。此版本标志着四大安全与性能战区的 Rust 改造**百分之百全面竣工**。

### 🦀 战区一：Watchdog 进程卫士 (Process Guardian)
- **Rust 独立守护进程正式落地**：`rust-core/watchdog` 是一个完全独立于 Electron 主进程的 Rust 二进制守护程序，通过 Unix Domain Socket（macOS/Linux）和 Named Pipe（Windows）与主进程进行心跳通信。
- **60 秒物理强杀机制**：若 Watchdog 在 60 秒内未收到心跳应答（如主进程被外部强制冻结或注入），Watchdog 将通过操作系统 API 对父进程发出物理级 SIGKILL，并弹出桌面通知，防止应用在被劫持状态下继续运行。
- **SAFE MODE 防卡死兜底**：当主进程从崩溃恢复并以 SAFE MODE 启动时，Watchdog 会自动识别并进入静默模式，不会对 SAFE MODE 进程执行强杀。
- **生产环境路径桥接**：已全面实现 `app.isPackaged` 双路径判断，确保无论是在开发环境还是打包后的生产环境，Watchdog 二进制文件均能被精准定位和启动。

### 🦀 战区二：Vault 本地凭证加密引擎 (Local Credential Encryption)
- **`getssh-vault` N-API 扩展量产**：通过 `@napi-rs` 将 Rust 加密逻辑编译为 `.node` 原生扩展，由 Electron 主进程直接加载。
- **AES-256-GCM 硬件级加密**：使用 Rust `aes-gcm` crate 在底层实现对本地 `profiles.enc` 的物理级加密与解密，彻底消灭了 Node.js 层面的 `crypto` 模块潜在漏洞。
- **主密码与生物验证双重门禁**：`cryptoHandler.ts` 实现了主密码校验与 `systemPreferences.promptTouchID` 生物识别的完整集成链路。

### 🦀 战区三：Sysprobe 系统探针 (System Metrics Probe)
- **`getssh-sysprobe` N-API 扩展量产**：使用 Rust 的 `sysinfo` crate 直接在操作系统底层采集 CPU、内存、网络、磁盘等系统指标。
- **彻底剥离 `node:os` 模块依赖**：终结了 `systemHandler.ts` 之前依赖 `node:os` 的高频轮询方案，系统资源采集不再经过 V8 字符串序列化层，数据吞吐效率大幅提升，UI 卡顿率归零。

### 🦀 战区四：SFTP 极限混合网络引擎 (Hybrid SFTP Engine)
- **`sftp-stream` N-API 零拷贝引擎量产**：`rust-core/sftp-stream` 接管了文件上传和下载过程中最重的磁盘 I/O 部分。
- **Node-Rust 流水线桥接落地**：`ssh2` 吐出的网络 `Buffer` 直接在 Rust 层被消费并流式落盘，彻底跳过 V8 字符串解析环节，形成"Node.js 负责网络协商、Rust 负责重 I/O"的混合双擎架构。
- **大文件下载确认防误触**：在执行纯下载模式时，用户将看到当前文件的大小提示，确认后方可开始下载，有效防止对大文件的误触。

### 🔥 绝灭 adm-zip 内存毒瘤 (getssh-unarchive)
- **新建 `getssh-unarchive` Rust N-API 扩展**：彻底废弃 `PluginManager.ts` 中使用的纯 JS 库 `adm-zip`（其全量内存读取策略是一颗随时引爆的 OOM 炸弹）。
- **零拷贝流式解压**：使用 Rust 的 `zip` crate 与 `std::io::copy`，文件从压缩包直接流式落盘，**全程不经过任何 JavaScript/V8 内存**。无论插件包体积多大，内存峰值波动恒定压制在 10MB 以内。
- **军工级 Zip Slip 漏洞物理封杀**：在 Rust 层对压缩包内的每一条路径进行严格检查，一旦发现包含目录穿越符 (`../`) 或绝对根路径的恶意条目，立即触发**熔断机制**，并物理销毁当前已解压的所有残骸文件，彻底封杀 Zip Slip 攻击向量。
- **`tokio` 异步非阻塞解压**：解压操作在 Rust 的 `tokio::task::spawn_blocking` 线程池中执行，Electron 主进程与渲染进程在解压过程中**全程无感**。

### 🔒 安全与锁定体验强化 (Security & Lock UX)
- **CommandCenter 一键锁定档案按钮**：在 WelcomePane 命令中心新增"锁定档案"按钮，用户无需等待超时计时器，随时可手动触发锁定。
- **未设密码时按钮智能禁用**：若用户未设置主密码，"锁定档案"按钮自动灰化并展示工具提示说明，引导用户正确配置安全设置。
- **锁定界面 i18n 国际化**：`CryptoModal` 锁定与解锁界面已全量接入 `react-i18next`，完整支持中英文双语切换，彻底消灭英文残留。
- **锁定时高斯模糊隐私防护**：触发锁定后，背景内容将被施加 40px 级别的强力高斯模糊滤镜（使用内联样式强制应用以规避 Tailwind JIT 潜在问题），有效保护隐私，防止无关人员从锁屏界面窥探用户的服务器信息。
- **全局加密状态单一数据源**：将 `cryptoMode`、`masterPassword` 等加密相关状态从 `App.tsx` 本地状态迁移至 `useCryptoStore` (Zustand) 全局状态树，确保所有 UI 组件（包括 CommandCenter、CryptoModal）读取到一致且实时的状态。

### 📦 跨平台生产环境打包 (Cross-Platform Production Packaging)
- **ASAR 物理剥离配置**：在 `electron-builder` 配置中加入 `"asarUnpack": ["**/*.node"]`，确保所有 Rust N-API 原生扩展被从 `app.asar` 虚拟文件系统中剥离，放入 `app.asar.unpacked` 真实物理目录，彻底消灭动态链接库在打包环境中加载失败的隐患。
- **Watchdog 二进制注入**：通过 `extraResources` 配置，将预编译好的 `watchdog` 可执行文件原封不动地注入最终安装包的 `resources` 目录。
- **macOS 硬化运行时与签名准备**：开启 `hardenedRuntime: true`，并创建 `build/entitlements.mac.plist` 授权文件，注入 `com.apple.security.cs.allow-unsigned-executable-memory`（兼容 V8 JIT）和 `com.apple.security.cs.disable-library-validation`（允许加载自编译 Rust `.node` 扩展），完美规避 macOS 10.15+ 系统的闪退与拦截。
- **依赖清理**：彻底从根目录移除 `adm-zip` 与 `@types/adm-zip`，项目依赖树进一步纯净化。

---

## [1.3.1] (Build K9V2X) - 2026-05-21


### 🎉 首个多协议终端版本 (The First Multi-Protocol Era)
此版本具有里程碑式的跨时代意义，标志着 GETSSH 正式从单一的 SSH 工具进化为**全域多协议终端平台**。我们开创性地引入了底层协议智能嗅探引擎 (Smart Protocol Detection)，极大降低了小白用户的上手门槛。您只需凭借直觉输入（如直接打出 `localhost`），系统便能像魔法一样瞬间读懂您的意图，自动分发并桥接对应的底层协议！

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
