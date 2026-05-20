# GETSSH 插件 SDK 内部文档

中文 | [🇺🇸 English Version](./PLUGIN_SDK_INTERNAL.md)

本文档定义了 GETSSH 插件系统的内部架构、安全边界和数据结构。它主要面向核心代码维护者以及需要集成或调试插件的 AI 代理。

## 1. 核心数据结构与接口

插件系统依赖于严格的 TypeScript 接口，以连接主进程和沙盒渲染器。

### 描述文件 (Manifest)

插件的 `package.json` 必须符合 `PluginManifest` 接口定义：

```typescript
export interface PluginManifest {
  name: string;
  version: string;
  displayName: string;
  icon?: string;
  description: string;
  main: string;
  renderer?: string;
  localPath?: string;
  _rendererContentCache?: string;
}
```

> **关于名称解析的注意事项：**
> 在解析 `package.json` 时，`PluginManager` 实现了一种优雅的降级机制：它会优先尝试读取 `getssh.name`，如果不存在则退而求其次读取 `displayName`，最后降级至标准的 `name` 字段。

### 主进程 API

如果插件暴露了主进程入口（main entry point），其 `activate` 函数在被调用时将接收到以下上下文 API：

```typescript
export interface MainContextAPI {
  showNotification: (title: string, body: string) => void;
  safeStorageEncrypt: (text: string) => string;
  safeStorageDecrypt: (encryptedData: string) => string;
  onSSHSessionConnect?: (callback: (sessionId: string, host: string) => void) => void;
}
```

### 渲染进程 API

一个精简版的 SDK 会被注入到隔离的插件 iframe 中，将以下方法代理回宿主环境：

```typescript
export interface RendererContextAPI {
  registerSidebarAction: (
    id: string,
    icon: string,
    label: string,
    onClick: () => void
  ) => void;
}
```

### IPC 消息路由 (PluginBridge)

插件 iframe 与宿主应用之间的通信通过 `postMessage` 进行。`PluginBridge` 会对这些消息进行严格的过滤。

**允许的操作 (Allowed Actions):**
- `registerSidebarAction`
- `registerPanel`
- `showNotification`
- `getActiveSessionId`

**拦截的操作 (Blocked Actions - 安全强制执行):**
- `sshWrite`
- `sshConnect`
- `sshDisconnect`
- `saveProfiles`
- `unlockProfiles`
- `sftpWriteFile`
- `sftpDelete`

## 2. 生命周期与沙盒架构

本地 `.zip` 插件的生命周期确保了从解压到执行全过程的绝对隔离。

1.  **解压与验证 (Extraction & Validation):**
    *   `PluginManager` 会将 `.zip` 压缩包解压到一个临时目录中。
    *   **安全：** 在解压过程中，所有的路径都会针对临时根目录进行严格的边界验证，以防止 **Zip Slip（目录穿越）** 漏洞。
    *   管理器会定位并验证 `package.json`（已自动处理插件被包裹在单一根目录下的情况）。
    *   验证通过的有效插件会被安全地移动到 `userData/plugins` 目录。

2.  **挂载与启动 (Mounting & Booting):**
    *   `bootSandboxedPlugins` 例程负责拉取所有的渲染器脚本。
    *   对于每个插件，它会生成一个隔离的 `<iframe>`，并设置 `sandbox="allow-scripts"` 以及 `display: none`。
    *   **macOS 路径解析修复：** 为了防止 macOS 系统路径（例如 `Application Support`）中存在的空格导致 `file://` 协议解析断裂，iframe 的源 URL 绝对路径必须经过 `encodeURI` 严格编码净化。
    *   在追加插件的渲染器脚本之前，文档内会被提前注入前文提到的精简 JavaScript SDK。

3.  **安全架构 (Security Architecture):**
    *   **DOM 隔离：** 由于 iframe 启用了 sandbox 属性且未授予 `allow-same-origin`，它对宿主的 DOM 是绝对零权限的。
    *   **Node/Electron 隔离：** iframe 无法访问任何 Node.js 模块或 `window.electronAPI`。
    *   **SVG 净化过滤 ($O(1)$ 性能优化)：** 当插件试图注入自定义的 SVG 图标时（例如通过 `registerSidebarAction`），该 SVG 会被 `svgSanitizer` 进行全方位解析与净化。该过滤器使用了模块级作用域的 Set 集合（`SAFE_URL_ATTRS` 和 `DANGEROUS_TAGS`）来实现 $O(1)$ 级别的极速查找，高效且无情地剥离恶意 `script` 标签或 `javascript:` URI。
    *   **强制操作拦截：** `PluginBridge` 会拦截所有的 `postMessage` 调用，并根据 `BLOCKED_ACTIONS` 列表进行交叉比对。任何危险的越权操作都会被立即丢弃，并显式触发控制台安全警告。

## 3. 最佳实践 "Hello World" 示例

这是一个极其微型的插件实现，演示了符合规范的 `package.json` 以及如何通过前端脚本利用注入的 SDK 注册一个侧边栏操作。

### `package.json`

```json
{
  "name": "hello-world-plugin",
  "version": "1.0.0",
  "displayName": "Hello World",
  "description": "A minimal example plugin.",
  "main": "main.js",
  "renderer": "renderer.js"
}
```

### `renderer.js`

```javascript
// SDK 会被 PluginBridge 自动注入。
// window.GETSSH 和 window.__sidebarHandlers 将在全局作用域中可用。

const actionId = "hello-btn";

// 1. 注册点击事件处理器
window.__sidebarHandlers[actionId] = () => {
  window.GETSSH.showNotification("Hello", "World from sandboxed plugin!");
};

// 2. 将 UI 元素注册到宿主应用
window.GETSSH.registerSidebarAction(
  actionId,
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='12' cy='12' r='10' fill='currentColor'/></svg>",
  "Say Hello"
);
```
