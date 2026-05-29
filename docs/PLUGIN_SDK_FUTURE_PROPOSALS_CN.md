# GETSSH V2 插件 SDK 未来演进提案 (Future Proposals)

本文档记录了 GETSSH 插件系统下一阶段（V2.x / V3.0）的演进方向与技术落地路线图。这些增强旨在赋予插件媲美 VSCode 扩展生态的终极能力，同时继续保持“零信任”和“防逃逸”的安全红线。

---

## 1. 沉浸式面板视图 (Full Panel Views)

**当前痛点**：目前前端沙盒插件只能隐藏在后台，并通过侧边栏注册一个按钮。无法为用户提供独立、全屏的可视化操作界面。
**核心目标**：允许插件在 GETSSH 主工作区（与 Terminal / SFTP Tab 并列）打开一个完整的交互式 Webview 面板。

### 接口设计
```typescript
// 沙盒端 window.GETSSH 新增
window.GETSSH.registerPanel(panelId: string, title: string, renderUrl: string): void;

// 触发打开面板
window.GETSSH.openPanel(panelId: string): void;
```

### 落地实现路径
1. **主进程状态支持**：
   - 更新前端的状态管理 (`sessionStore.ts`)，为其扩展一种全新的 Tab 类型 `PluginPanelTab`。
2. **沙盒渲染器**：
   - 在 `SessionManager.tsx` 的工作区路由中，当命中 `PluginPanelTab` 时，渲染一个 `<iframe sandbox="allow-scripts" data-plugin-id="...">`，将其铺满整个工作区。
   - 这里的沙盒机制依然与 `PluginBridge` 强绑定，防止插件获取宿主 DOM。
3. **通信联动**：
   - 面板内的 `iframe` 同样注入一套 `window.GETSSH` SDK，允许全屏面板与底层的 Node.js 插件通过 `rpc` 进行双向通信。

---

## 2. 安全受控的网络请求桥 (Strict Mode Fetch API)

**当前痛点**：开启“严格模式 (Strict Mode)”时，后端插件被禁止使用原生的 `http` / `net` 模块。这导致安全型插件无法外发报警（Webhook）或调用 AI 接口。
**核心目标**：提供一套由主进程代理、强制受审计的无阻碍网络通信接口。

### 接口设计
```typescript
// 后端 ctx 注入
ctx.net = {
  /**
   * 发起受控的 HTTP 网络请求。
   * @param url 请求地址
   * @param options 请求参数 (同 fetch API)
   */
  fetch(url: string, options?: RequestInit): Promise<Response>;
}
```

### 落地实现路径
1. **权限清单隔离**：
   - 插件必须在 `package.json` 的 `capabilities` 中声明 `["net:fetch"]`。
2. **底层代理机制**：
   - 在 `PluginManager.ts` 中，使用 Electron 原生自带的 `net.fetch` 对这个接口进行包装注入。
   - **拦截与审计**：在内部封装拦截器，每次调用强制打印 `[Plugin Net API] [plugin-id] Fetching: https://...` 审计日志。主进程甚至可以在这里统一配置 HTTP 代理，并强制切断对本地局域网私有 IP（如 `127.0.0.1`）的扫描行为，实现终极的防 SSRF 安全墙。

---

## 3. 无代码原生配置表单 (Settings Schema UI)

**当前痛点**：后端插件如果需要用户输入 Token、IP 等前置配置，必须自己想办法做交互，体验极差且不安全。
**核心目标**：插件只定义数据结构，GETSSH 负责在系统设置中渲染出统一风格的原生 UI 表单。

### 接口设计
```typescript
// 后端 ctx 注入
ctx.ui.registerSettings(schema: {
  id: string,
  type: 'string' | 'boolean' | 'number' | 'password',
  label: string,
  description?: string,
  default?: any
}[]): void;
```

### 落地实现路径
1. **状态流转**：
   - 后台调用后，触发 IPC 广播 `sync-plugin-settings-schema`。
   - Zustand 接收 Schema 树并在内存中维护。
2. **前端动态渲染**：
   - 在 `PluginSettings.tsx` 中，为每个已安装的插件下方增加一个 "配置" 按钮。
   - 点击后，通过解析该插件的 JSON Schema，动态生成包含 `Input`, `Switch`, `PasswordBox` 的 React 表单组件。
3. **闭环回流**：
   - 用户点击保存时，GETSSH 前端直接调用主进程 API，将表单数据静默写入该插件的 `ctx.storage` 中。
   - 随后触发 `PluginManager.reloadPlugin(pluginId)`，插件重启后即可通过 `await ctx.storage.get()` 拿到用户最新的配置。

---

## 4. 剪贴板调度器 (Host Clipboard Access)

**当前痛点**：无论是基于 iframe 的前端插件，还是被 VM 隔离的后端插件，都失去了对操作系统剪贴板的读写能力（Web API 的 clipboard 在沙盒内被禁用，Node.js VM 里没有该能力）。
**核心目标**：赋予插件合法调度系统剪贴板的能力。

### 接口设计
```typescript
// 后端 ctx.host 扩充
ctx.host.clipboard = {
  writeText(text: string): void;
  readText(): string;
};
```

### 落地实现路径
1. **Electron 桥接**：
   - 在 `PluginManager.ts` 中直接封装 `import { clipboard } from 'electron'`。
2. **安全审计追踪**：
   - 同样在调用时强制写入审计日志 `[Plugin Host API] clipboard.readText called by [...]`。
3. **防护机制**：
   - 为了防止插件在后台疯狂窃取用户的剪贴板密码，可以增加运行时限制，例如：“后端插件读取剪贴板时，自动在屏幕右上角弹出一个半透明 Toast 提示用户：插件 X 读取了剪贴板”。做到安全可视。
