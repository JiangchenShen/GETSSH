# GETSSH v1.3 - Project Context & Current State

## 1. 架构与技术栈
* **Core:** Electron + React + Vite + TypeScript.
* **UI/CSS:** Tailwind CSS. 
* **Terminal Engine:** xterm.js.
* **Plugin System:** 通过 Iframe 沙盒加载本地解压的 `.zip` 插件 (基于 `package.json` 解析)。

## 2. 刚刚确立的 UI 规范 (绝对不可违背)
* **毛玻璃 (Glassmorphism):** 已彻底放弃浅色模式的毛玻璃。浅色模式强制使用实体底色（`bg-slate-50` 等）。毛玻璃仅在深色模式下可用，且由 `enableGlassmorphism` 开关控制。
* **侧边栏 (Sidebar):** 浅色模式下，文字已强制设定为高对比度的深色 (`text-slate-800` 等)。

## 3. 当前面临的紧急 Bug（你的首要任务）
**Bug 描述：** 由于之前为了修复浅色模式侧边栏，全局注入了 `text-slate-800`，导致严重的 **CSS 全局污染**。右侧核心的 SSH 终端 (xterm.js 容器) 受到污染，在浅色模式下变成了“黑底黑字”，完全无法阅读。

**修复方案指令：**
1. 立即进入 `Terminal.tsx` (或包裹 xterm 实例的组件)。
2. 给包裹 xterm 的父 `<div>` 加上 CSS 隔离（例如 `text-white dark:text-white` 或内联 style 重置）。
3. 在初始化 `new Terminal(...)` 时，**强制显式声明 theme**，将 `foreground` 锁死为纯白色 (`#FFFFFF`)，确保终端内部字体绝对不受外部浅色模式污染。