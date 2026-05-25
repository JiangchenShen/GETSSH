# GETSSH 漏洞与 Bug 修复记录

本文档记录了近期在 GETSSH 中发现并修复的严重 Bug 与安全漏洞。

## 1. 插件沙盒逃逸漏洞 (严重安全修复)
- **发现的 Bug**：原有的插件执行环境过度依赖 Node.js 的 `vm.runInNewContext`，该原生 API 存在已知的沙盒逃逸风险。恶意插件可以通过原型链污染（例如 `this.constructor.constructor('return process')()`）逃逸出虚拟机，直接获取底层 Node.js `child_process` 的最高系统权限。
- **实施的修复**：我们在 `SecureCenter.ts` 和 `PluginManager.ts` 中研发了一套坚固的 RASP（运行时应用自我保护）层。摒弃了脆弱的裸 `vm` 环境，我们对原生的 `fs`、`child_process` 等模块实施了深度的 `Proxy` 拦截，并通过 `Object.freeze` 强制冻结了全局原型链，从物理内存级别彻底封死了原型链污染攻击的路径。

## 2. Command Center "Quick Connect" 崩溃 (UI/UX 修复)
- **发现的 Bug**：在主页的 Command Center 中，当用户在搜索框输入 `user@host` 并按下回车尝试“快速连接 (Quick Connect)”时，界面毫无反应，且 Console 控制台抛出大量红色报错。原因是底层代码试图通过 `document.querySelector` 强行寻找旧版 UI 中已被移除的 DOM 按钮，导致找不到元素而直接抛出异常死锁。
- **实施的修复**：彻底移除了极其脆弱的 DOM 节点查询黑魔法。我们将控制中心提取为独立的 `<CommandCenter />` 共享组件，将 `onConnect` 状态原生向下传递并直接对接底层的 `sshConnect` 引擎，现在快速连接能够瞬间无缝拉起。

## 3. Vite 编译与热更新阻断 (编译错误修复)
- **发现的 Bug**：在开发者模式 (`npm run dev`) 和生产构建时，Vite 会抛出致命的 `SyntaxError: Unexpected token '<'` 报错，直接导致整个开发服务器崩溃及热更新 (HMR) 瘫痪。
- **实施的修复**：对 JSX 渲染树进行了严格的 TSX 语法审计。修复了 `EmptyState.tsx` 中由于早期排版遗留的未闭合 `<button>` 及 `<div>` 标签，让 React AST 能够被 Vite 与 esbuild 正确解析。

## 4. 日期未跟随系统多语言翻译 (国际化修复)
- **发现的 Bug**：Command Center 右上角的实时仪表盘时钟，其日期和时间的格式化被硬编码使用了系统底层语言 (`undefined` locale)，这导致当用户在 GETSSH 设置中将语言切换为中文时，首页的时钟依然显示英文格式的日期。
- **实施的修复**：将时钟组件与全局的 `react-i18next` 国际化引擎打通，在调用 `toLocaleDateString` 与 `toLocaleTimeString` 时显式传入了 `i18n.language` 环境变量，确保所有时间戳的本地化展示与软件当前 UI 语言强绑定。
