# GETSSH 插件开发者 SDK 文档

中文 | [🇺🇸 English Version](./PLUGIN_SDK_INTERNAL.md)

欢迎使用 GETSSH 插件 SDK！本文档是面向第三方开发者的完整参考手册，涵盖插件类型选择、Manifest 规范、API 接口、安全模型以及上架发布流程。

---

## 目录

1. [插件类型速览](#1-插件类型速览)
2. [Manifest 规范 (`package.json`)](#2-manifest-规范-packagejson)
3. [沙盒插件 (Sandbox Plugin)](#3-沙盒插件-sandbox-plugin)
4. [后端插件 (Node.js Plugin)](#4-后端插件-nodejs-plugin)
5. [安全沙盒模型与逃逸防御](#5-安全沙盒模型与逃逸防御)
6. [RASP 生命周期集成（强制）](#6-rasp-生命周期集成强制)
7. [系统监控数据流 (sysmon)](#7-系统监控数据流-sysmon)
8. [UI 扩展点 (原生右键菜单)](#8-ui-扩展点-原生右键菜单)
9. [完整示例：Hello World 沙盒插件](#9-完整示例hello-world-沙盒插件)
10. [完整示例：后端 Node.js 插件](#10-完整示例后端-nodejs-插件)
11. [打包与安装](#11-打包与安装)
12. [常见问题与错误](#12-常见问题与错误)

---

## 1. 插件类型速览

GETSSH 插件系统支持两种截然不同的插件类型，在选择前请仔细阅读它们的权限边界：

| 特性 | 沙盒插件 (`sandbox`) | 后端插件 (Node.js) |
|---|---|---|
| **主入口** | `index.html` (纯前端) | `main.js` (运行于主进程) |
| **Node.js 权限** | ❌ 完全禁止 | ✅ 受 VM 沙盒限制的访问 |
| **访问 `electronAPI`** | ❌ 完全禁止 | ✅ 通过 `ctx` 上下文注入 |
| **文件系统访问 (`fs`)** | ❌ 完全禁止 | ⛔ 严格模式下禁止，普通模式下可用 |
| **网络访问 (`net`)** | ❌ 完全禁止 | ⛔ 严格模式下禁止 |
| **强制生命周期钩子** | ✅ 豁免 | ⛔ **强制必须实现 `deactivate()`** |
| **适用场景** | 数据展示、状态监控、只读 UI 面板 | SSH 审计、自动化脚本、加密存储集成 |

> **强烈推荐优先选择沙盒插件。** 沙盒插件无法被恶意利用，且不受安全沙盒模式切换的影响，用户对其信任度更高。

---

## 2. Manifest 规范 (`package.json`)

每个插件必须在根目录包含一个 `package.json` 文件。

### 完整字段说明

```json
{
  "name": "my-awesome-plugin",
  "version": "1.0.0",
  "displayName": "My Awesome Plugin",
  "description": "一句话描述你的插件功能。",
  "author": "Your Name <email@example.com>",
  "main": "main.js",
  "getssh": {
    "pluginId": "com.example.my-awesome-plugin",
    "type": "sandbox",
    "capabilities": ["lifecycle"]
  }
}
```

### 字段详解

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | `string` | ✅ | 插件唯一标识符（小写+连字符）。将作为插件安装目录名。 |
| `version` | `string` | ✅ | 语义化版本号，如 `1.0.0`。 |
| `displayName` | `string` | ✅ | 在 GETSSH 插件市场和设置界面中显示的友好名称。 |
| `description` | `string` | ✅ | 简短描述，将展示在插件列表中。 |
| `author` | `string` | 推荐 | 作者信息。 |
| `main` | `string` | ✅ | 插件的主入口文件。沙盒插件填 `index.html`，后端插件填 `main.js`。 |
| `getssh.pluginId` | `string` | ✅ | **全球唯一**的反向域名格式 ID，如 `com.example.myplugin`。绝对不允许重复。 |
| `getssh.type` | `"sandbox"` | 沙盒必填 | 声明为沙盒插件。**后端插件不要填写此字段。** |
| `getssh.capabilities` | `string[]` | 后端必填 | 后端插件必须包含 `"lifecycle"`。缺少此声明将被拒绝安装。 |

> **名称解析优先级：** GETSSH 在解析插件名称时，按照 `getssh.name` → `displayName` → `name` 的顺序降级查找。

---

## 3. 沙盒插件 (Sandbox Plugin)

### 工作原理

沙盒插件的 HTML 文件会被加载到一个经过严格限制的 `<iframe>` 中。该 iframe 使用 `sandbox="allow-scripts"` 属性，这意味着：

- **绝对没有** `allow-same-origin`：iframe 的 origin 为 `null`，无法读取宿主应用的任何 DOM、Cookie 或 localStorage。
- **绝对没有** Node.js 环境：`require`、`process`、`window.electronAPI` 均不存在。
- **唯一的通信通道**：通过 `postMessage` 调用 GETSSH 注入的 `window.GETSSH` SDK。

### 注入的 `window.GETSSH` SDK

GETSSH 在加载您的插件代码之前，会自动向沙盒内注入以下 SDK 对象：

```typescript
window.GETSSH = {
  /**
   * 在侧边栏注册一个可点击的图标按钮。
   * @param id      按钮的唯一 ID（在你的插件内唯一即可）
   * @param icon    SVG 字符串（会被自动净化，恶意脚本将被剥离）
   * @param label   鼠标悬停时显示的标签文字
   */
  registerSidebarAction(id: string, icon: string, label: string): void;

  /**
   * 弹出一条系统通知（需要用户已授予通知权限）。
   * @param title 通知标题
   * @param body  通知正文
   */
  showNotification(title: string, body: string): void;

  /**
   * 同步获取宿主应用的当前语言区域字符串（如 'zh-CN'、'en-US'）。
   * 这是一次快照读取，不会自动更新。如需监听变化，请使用 onThemeChange。
   */
  getLocale(): string;

  /**
   * 订阅宿主应用的主题变化事件。
   * 每当用户在设置中切换深色/浅色/跟随系统模式时触发。
   * @param callback 接收新的主题值：'dark' | 'light' | 'system'
   */
  onThemeChange(callback: (theme: 'dark' | 'light' | 'system') => void): void;
}

/**
 * 用于响应侧边栏按钮点击事件的处理器字典。
 * key 必须与 registerSidebarAction 中的 id 一致。
 */
window.__sidebarHandlers: Record<string, () => void>;
```

### 主题与语言感知使用示例

您可以利用这两个 API，让插件 UI 与宿主应用完美同步：

```javascript
// 启动时同步读取一次语言设置
const locale = window.GETSSH.getLocale();
document.getElementById('greeting').textContent =
  locale.startsWith('zh') ? '你好，世界！' : 'Hello, World!';

// 实时响应主题切换
window.GETSSH.onThemeChange((theme) => {
  document.body.setAttribute('data-theme', theme);
  // 例如：更新 CSS 变量、图表配色方案等
});
```

### 接收宿主应用的消息

宿主应用可能会通过 `postMessage` 向您的插件推送数据，您只需监听 `message` 事件：

```javascript
window.addEventListener('message', (event) => {
  // 务必检查消息类型，避免处理无关消息
  if (event.data.type === 'sysmon:data') {
    // 详见第 7 节：系统监控数据流
    const { cpus, mem, net } = event.data.payload;
  }
});
```

### PluginBridge 消息拦截器（白名单机制）

所有从沙盒发往宿主的 `postMessage` 请求，都必须经过 `PluginBridge` 的白名单校验。**只有以下操作被允许通过：**

| 操作 | 说明 |
|---|---|
| `registerSidebarAction` | 在侧边栏注册一个图标按钮 |
| `registerPanel` | 注册一个面板页面 |
| `showNotification` | 触发系统桌面通知 |
| `getActiveSessionId` | 获取当前活跃的 SSH session ID（始终返回 `null`，出于安全考虑插件不可获取真实 ID） |

**以下操作永远会被拦截，并触发安全警告日志：**

| 被拦截的操作 | 原因 |
|---|---|
| `sshWrite` | 禁止插件直接写入 SSH 终端 |
| `sshConnect` / `sshDisconnect` | 禁止插件控制连接生命周期 |
| `saveProfiles` / `unlockProfiles` | 禁止插件访问加密的连接配置 |
| `sftpWriteFile` / `sftpDelete` | 禁止插件通过 SFTP 修改或删除文件 |

> **安全警告**：任何尝试通过声明 `"type": "sandbox"` 来绕过后端生命周期校验的恶意后端插件，将会被彻底剥夺执行权。GETSSH 主进程在看到 `sandbox` 声明时，会直接跳过所有后端 JS 代码的加载，任何隐藏在 `main.js` 里的恶意代码根本没有机会被执行。

---

## 4. 后端插件 (Node.js Plugin)

### 工作原理

后端插件的 `main.js` 会在 Electron **主进程**中，通过 Node.js `vm` 模块创建的隔离沙盒环境内执行。

### `activate(ctx)` 上下文 API

当插件被激活时，`activate` 函数会接收到一个 `ctx` 对象，这是你唯一合法的 API 入口：

```typescript
interface MainContextAPI {
  /**
   * @deprecated 新插件请改用 ctx.host.notify()。
   * 弹出系统原生桌面通知。
   */
  showNotification(title: string, body: string): void;

  /**
   * 使用 Electron 的操作系统级加密功能加密字符串。
   * 密钥由 OS 钥匙串管理，与当前用户账户绑定。
   */
  safeStorageEncrypt(text: string): string;

  /**
   * 监听 SSH 会话连接事件（只读）。
   * 每当用户成功建立一个新的 SSH 连接时回调。
   * @param callback sessionId 为 GETSSH 内部会话 ID，host 为目标主机名
   */
  onSSHSessionConnect?(callback: (sessionId: string, host: string) => void): void;

  /**
   * 持久化的 Key-Value 存储，每个插件拥有独立的命名空间。
   */
  storage: {
    get(key: string): Promise<any>;
    set(key: string, value: any): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
  };

  /**
   * 后端 VM 与前端 iframe 插件之间的双向 RPC 通信桥梁。
   */
  rpc: {
    /** 注册一个可被前端通过 pluginRpcInvoke() 调用的方法。 */
    registerMethod(method: string, handler: (payload: any) => Promise<any>): void;
    /** 主动向前端推送数据，前端通过 onPluginRpcMessage() 监听接收。 */
    sendToFrontend(payload: any): void;
  };

  /**
   * 原生宿主级集成 API。
   * ♥️ 所有 dialog 调用都会在主进程日志中留下 [Plugin Host API] 审计痕迹。
   */
  host: {
    /**
     * 直接从后台插件发送操作系统原生桌面通知。
     * 无论用户正在看什么界面，通知都会弹出。非常适合服务器监控、告警类插件。
     * @param title  通知标题
     * @param body   通知正文
     * @param type   视觉意图：'info'（默认）| 'warning' | 'error'
     */
    notify(title: string, body: string, type?: 'info' | 'warning' | 'error'): void;

    /**
     * 弹出操作系统原生消息/确认对话框。
     * 返回 Promise，包含用户点击的按钮索引。
     * @param options.type        对话框图标类型：'none' | 'info' | 'warning' | 'error' | 'question'
     * @param options.buttons     按钮文字数组，如 ['确定', '取消']
     * @param options.message     对话框主消息文字（加粗展示）
     * @param options.detail      副文字（较小字体，可省略）
     * @param options.defaultId   默认聚焦的按钮索引
     * @param options.cancelId    按 Escape 键时等同点击的按钮索引
     * @param options.checkboxLabel 底部复选框文字（可省略）
     * @returns { response: number (点击的按钮索引), checkboxChecked: boolean }
     */
    showMessageBox(options: {
      type?: 'none' | 'info' | 'warning' | 'error' | 'question';
      buttons?: string[];
      defaultId?: number;
      cancelId?: number;
      title?: string;
      message: string;
      detail?: string;
      checkboxLabel?: string;
    }): Promise<{ response: number; checkboxChecked: boolean }>;

    /**
     * 弹出操作系统原生文件/目录选择器。
     * 安全保证：插件只能获得文件路径字符串，不能直接读取文件内容。
     * @param options.properties  选择模式：'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles'
     * @param options.filters     文件类型过滤器，如 [{ name: 'Images', extensions: ['png', 'jpg'] }]
     * @returns { canceled: boolean, filePaths: string[] }
     */
    showOpenDialog(options: {
      title?: string;
      defaultPath?: string;
      filters?: { name: string; extensions: string[] }[];
      properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles'>;
    }): Promise<{ canceled: boolean; filePaths: string[] }>;

    /**
     * 弹出操作系统原生文件保存路径选择器。
     * @param options.filters 文件类型过滤器
     * @returns { canceled: boolean, filePath?: string }
     */
    showSaveDialog(options: {
      title?: string;
      defaultPath?: string;
      filters?: { name: string; extensions: string[] }[];
    }): Promise<{ canceled: boolean; filePath?: string }>;
  };

  /**
   * SSH I/O 通信桥（需要在 capabilities 中声明 'ssh:read' 和 'ssh:write'）。
   */
  ssh?: {
    onData(sessionId: string, callback: (chunk: string) => void): void;
    write(sessionId: string, command: string): void;
  };

  /**
   * UI 扩展点 — 向原生右键菜单注入自定义菜单项。
   * 详见第 8 节。
   */
  ui: {
    registerTerminalContextMenu(actionId: string, label: string, handler: (context: { sessionId: string, selectionText: string }) => void): void;
    registerSFTPContextMenu(actionId: string, label: string, handler: (context: { sessionId: string, currentPath: string, selectedFiles: string[] }) => void): void;
  };
}
```

### VM 沙盒安全等级

后端插件的运行权限受用户在 GETSSH 设置中选择的安全模式控制：

| 安全模式 | `require()` 权限 | 适用场景 |
|---|---|---|
| **严格模式 (strict)** | 仅允许 `path`、`os` | 最高安全性，限量分发 |
| **普通模式 (normal)** | 阻止 `fs`、`child_process`、`net` 等危险模块 | 标准插件开发 |
| **开发者模式 (developer)** | 完全原生 `require`，无任何限制 | **仅用于开发调试，请勿用于生产分发** |

### `ctx.host` 使用示例

```javascript
// ① 展示确认对话框，等待用户响应
const result = await ctx.host.showMessageBox({
  type: 'warning',
  title: '操作确认',
  message: '确定要删除这个配置文件吗？',
  detail: '此操作无法撤销。',
  buttons: ['删除', '取消'],
  defaultId: 1,    // 默认聚焦"取消"
  cancelId: 1,
});
if (result.response === 0) {
  // 用户点击了"删除"（索引 0）
}

// ② 呼出文件选择器，让用户选一个配置文件
const open = await ctx.host.showOpenDialog({
  title: '选择配置文件',
  filters: [{ name: 'JSON 配置', extensions: ['json'] }],
  properties: ['openFile'],
});
if (!open.canceled) {
  const configPath = open.filePaths[0];
  // 通过 ctx.storage 或其他受控 API 处理路径...
}

// ③ 呼出文件保存对话框，让用户选择导出路径
const save = await ctx.host.showSaveDialog({
  title: '导出审计报告',
  defaultPath: 'audit-report.csv',
  filters: [{ name: 'CSV', extensions: ['csv'] }],
});
if (!save.canceled && save.filePath) {
  // save.filePath 是用户选择的完整本地路径
}
```

> **安全须知**：`showOpenDialog` 只返回**路径字符串**，不会主动读取文件内容。插件需要通过已有的受控通道（如 `ctx.storage` 或专门的流式 API）来进一步访问文件数据，不存在任何隐式文件读取权限提升。

---

## 5. 安全沙盒模型与逃逸防御

### 为什么不能用 `sandbox` 类型来绕过钩子？

这是一个很常见的疑问：既然 `sandbox` 类型的插件豁免了生命周期校验，那我写个恶意 Node.js 插件，在 `package.json` 里谎报 `"type": "sandbox"`，是不是就能绕过检查？

**答案是：绝对不行。** GETSSH 的安全架构专门设计了对抗此类欺骗的多层防御：

```
声明 type: "sandbox"
         │
         ▼
[PluginManager] 看到 sandbox 标志
         │
         ▼
主进程的 Node.js 加载器直接执行 return，
不读取、不执行任何 main.js 代码
         │
         ▼
PluginBridge 把它关进 iframe 牢笼
(sandbox="allow-scripts", 无 allow-same-origin)
         │
         ▼
它只能通过 postMessage 向 GETSSH 发消息
         │
         ▼
PluginBridge 白名单拦截器：
任何超出白名单的操作 → 直接丢弃 + 安全日志告警
```

**结论：** 谎报 `sandbox` 类型的插件，等于主动放弃了所有的 Node.js 后端权限。它的 `main.js` 不会被执行，它在 iframe 里也只能做有限的只读 UI 展示。这是一个死胡同，不是绕过检查的方法。

### SVG 图标净化

当您通过 `registerSidebarAction` 注册带有自定义 SVG 图标的按钮时，GETSSH 会对 SVG 代码进行自动净化：
- **剥离**所有 `<script>`、`<iframe>`、`<foreignObject>` 等危险标签。
- **移除**所有 `javascript:` URI 属性。
- **净化器使用 Set 集合实现 $O(1)$ 极速查找**，不影响 UI 渲染性能。

---

## 6. RASP 生命周期集成（强制）

**这是后端插件最重要的安全契约。**

GETSSH 的底层由一个以 Rust 编写的 Watchdog 守护进程负责实时监控主进程的安全状态。当 Watchdog 检测到异常行为（如 API 被恶意 Hook 注入）时，会触发 RASP（运行时应用自我保护）协议，并有可能**强制终止 Electron 主进程**。

在强杀发生之前，GETSSH 会尝试执行所有插件的 `deactivate()` 钩子，以防止数据损坏或资源泄漏。**因此，这个钩子不是可选的——它是系统安全的一部分。**

### 双重强制校验点

| 校验点 | 触发时机 | 未通过的后果 |
|---|---|---|
| **安装时（静态扫描）** | 用户安装 `.zip` 时 | 安装被立即拒绝，文件不会写入磁盘。错误信息显示在 UI 上。 |
| **加载时（运行时检查）** | 应用启动扫描插件目录时 | 插件被跳过，不会运行。警告写入控制台日志。 |

### `deactivate()` 中必须做的事

```javascript
let pollingInterval = null;
let openFileHandle = null;

module.exports = {
  activate(ctx) {
    openFileHandle = fs.openSync('/tmp/plugin.log', 'w');
    pollingInterval = setInterval(() => {
      // 周期性操作...
    }, 1000);
  },

  deactivate() {
    // ✅ 必须：清除所有定时器
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }

    // ✅ 必须：关闭所有文件句柄
    if (openFileHandle !== null) {
      fs.closeSync(openFileHandle);
      openFileHandle = null;
    }

    // ✅ 必须：断开所有网络连接
    // socket.destroy(); socket = null;

    // ✅ 必须：清理所有事件监听器
    // emitter.removeAllListeners();
  }
};
```

### RASP 触发时的完整卸载流程

```
用户在 RASP 弹窗选择"立刻重启至安全模式"
          │
          ▼
SecureCenter.handleAction('restart-safe')
          │
          ▼
① 调用 pluginTeardownFn()
          │
          ▼
② PluginManager.deactivateAll()
   ─ 遍历所有 runningPlugins
   ─ 对每个插件在 try/catch 中调用 deactivate()
          │
          ▼
③ 向 Watchdog 发送 ACTION:RESTART-SAFE
          │
          ▼
④ app.exit(0)
```

### Manifest 声明要求

缺少以下任何一项，后端插件都**无法通过安装**：

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "displayName": "My Backend Plugin",
  "description": "A backend plugin example.",
  "main": "main.js",
  "getssh": {
    "pluginId": "com.example.my-backend-plugin",
    "capabilities": ["lifecycle"]
  }
}
```

> **注意**：后端插件 **不要** 填写 `"type": "sandbox"`。

---

## 7. 系统监控数据流 (sysmon)

如果您的沙盒插件需要展示实时系统状态（CPU、内存、网络），GETSSH 会自动通过 `postMessage` 向每个活跃的插件 iframe 推送系统数据。

> **数据来源**：由 Rust 编写的 `getssh-sysprobe` N-API 扩展驱动，底层使用 `sysinfo` 库采集。CPU 占用率已在 Rust 侧预计算完毕，您**无需**在 JS 侧进行任何差值计算。

### 数据结构

```typescript
// 在你的沙盒插件 HTML/JS 中监听此消息：
window.addEventListener('message', (event) => {
  if (event.data.type !== 'sysmon:data') return;

  const payload: SysmonPayload = event.data.payload;
});

interface SysmonPayload {
  cpus: {
    overall: number;   // 全局 CPU 占用率，范围 0-100
    cores: number[];   // 各核心独立占用率数组，范围 0-100
  };
  mem: {
    total: number;     // 总内存（字节）
    used: number;      // 已用内存（字节）
    free: number;      // 可用内存（字节）
  };
  net: {
    rx: number;        // 自上次刷新以来接收的字节数
    tx: number;        // 自上次刷新以来发送的字节数
  };
}
```

### 使用示例

```html
<!-- index.html -->
<div id="cpu">--</div>
<div id="mem">--</div>
<script>
window.addEventListener('message', (e) => {
  if (e.data.type !== 'sysmon:data') return;
  const { cpus, mem } = e.data.payload;
  document.getElementById('cpu').textContent =
    'CPU: ' + cpus.overall.toFixed(1) + '%';
  document.getElementById('mem').textContent =
    'MEM: ' + (mem.used / 1024 / 1024 / 1024).toFixed(1) + ' GB';
});
</script>
```

---

## 8. UI 扩展点 (原生右键菜单)

后端 Node.js 插件可以向终端视图和 SFTP 文件管理器的**操作系统原生右键菜单**注入自定义菜单项，无需编写任何前端代码。

### 工作原理

1. 插件在 `activate()` 中调用 `ctx.ui.registerTerminalContextMenu` 或 `ctx.ui.registerSFTPContextMenu`。
2. GETSSH 主进程向 React 前端广播 `sync-plugin-ui-extensions` 事件，前端实时更新状态树。
3. 当用户在终端或 SFTP 视图右键单击时，宿主会动态构建一个包含您注册项目的原生 OS 菜单。
4. 用户点击您的菜单项后，主进程携带上下文数据（选中文本、文件路径等）精准调用您在 VM 沙盒内注册的回调函数。
5. 插件被**卸载或重新加载**时，其所有菜单项会被**立即垃圾回收**，不留任何幽灵菜单。

### API 参考

```typescript
// 在 activate(ctx) 内调用：

// 向终端右键菜单注入一个菜单项
ctx.ui.registerTerminalContextMenu(
  'my-action',       // 在您的插件内唯一的 ID
  '翻译选中文字',     // 展示给用户的菜单文字
  (context) => {
    console.log('会话 ID:', context.sessionId);
    console.log('用户选中的文字:', context.selectionText);
  }
);

// 向 SFTP 文件列表右键菜单注入一个菜单项
ctx.ui.registerSFTPContextMenu(
  'preview-file',
  '预览文件',
  (context) => {
    console.log('当前目录:', context.currentPath);
    console.log('右键点击的文件:', context.selectedFiles); // string[]
  }
);
```

### 上下文数据结构

| 菜单类型 | context 对象结构 |
|---|---|
| `registerTerminalContextMenu` | `{ sessionId: string, selectionText: string }` |
| `registerSFTPContextMenu` | `{ sessionId: string, currentPath: string, selectedFiles: string[] }` |

> **注意**：菜单项在 `activate()` 时注册，在插件生命周期内**持续有效**。无法动态增删单个菜单项——如需变更，需要重新加载插件。

---

## 9. 完整示例：Hello World 沙盒插件

这是最简单的沙盒插件，在侧边栏注册一个按钮，点击后弹出通知。

### 目录结构

```
hello-world/
├── package.json
└── index.html
```

### `package.json`

```json
{
  "name": "hello-world-plugin",
  "version": "1.0.0",
  "displayName": "Hello World",
  "description": "一个极简的 GETSSH 沙盒插件示例。",
  "author": "Your Name",
  "main": "index.html",
  "getssh": {
    "pluginId": "com.example.hello-world",
    "type": "sandbox"
  }
}
```

### `index.html`

```html
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body>
<script>
// 沙盒启动后，window.GETSSH 和 window.__sidebarHandlers 已被 GETSSH 自动注入

const actionId = 'hello-btn';

// 1. 注册按钮点击处理器
window.__sidebarHandlers[actionId] = () => {
  window.GETSSH.showNotification('Hello!', '这是来自沙盒插件的问候。');
};

// 2. 在侧边栏注册按钮（SVG 图标会被自动净化）
window.GETSSH.registerSidebarAction(
  actionId,
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <circle cx="12" cy="12" r="10" fill="currentColor"/>
  </svg>`,
  '说 Hello'
);
</script>
</body>
</html>
```

---

## 10. 完整示例：后端 Node.js 插件

此示例展示了一个监听 SSH 连接事件并写入审计日志的后端插件。

### 目录结构

```
ssh-auditor/
├── package.json
└── main.js
```

### `package.json`

```json
{
  "name": "ssh-auditor",
  "version": "1.0.0",
  "displayName": "SSH 审计日志",
  "description": "记录所有 SSH 连接事件到本地日志文件。",
  "author": "Your Name",
  "main": "main.js",
  "getssh": {
    "pluginId": "com.example.ssh-auditor",
    "capabilities": ["lifecycle"]
  }
}
```

### `main.js`

```javascript
// 注意：在严格模式 (strict) 下，fs 模块不可用。
// 本示例需要用户将安全模式设置为"普通"或"开发者"才能运行。
const fs = require('fs');
const os = require('os');
const path = require('path');

const logPath = path.join(os.tmpdir(), 'getssh-audit.log');
let fileStream = null;

module.exports = {
  activate(ctx) {
    fileStream = fs.createWriteStream(logPath, { flags: 'a' });
    fileStream.write(`[${new Date().toISOString()}] SSH 审计插件已启动\n`);

    ctx.onSSHSessionConnect?.((sessionId, host) => {
      const line = `[${new Date().toISOString()}] 连接至: ${host} (session: ${sessionId})\n`;
      fileStream?.write(line);
    });

    ctx.showNotification('SSH 审计', `审计日志已开始记录至 ${logPath}`);
  },

  // ⛔ 这个钩子是强制必须的，缺少它插件将无法安装
  deactivate() {
    if (fileStream) {
      fileStream.write(`[${new Date().toISOString()}] SSH 审计插件已停止\n`);
      fileStream.end();    // ✅ 必须：关闭文件流
      fileStream = null;
    }
  }
};
```

---

## 11. 打包与安装

### 打包规则

将插件目录打包为 `.zip` 文件。插件文件可以直接位于 `.zip` 根目录，也可以包裹在一个单一的子目录中：

```
# 格式 A（推荐）：直接在根目录
my-plugin.zip
├── package.json
├── main.js
└── index.html

# 格式 B（也支持）：包裹在子目录中
my-plugin.zip
└── my-plugin/
    ├── package.json
    ├── main.js
    └── index.html
```

> **警告**：GETSSH 会对所有解压路径进行 **Zip Slip（目录穿越）** 漏洞检测。任何试图将文件解压到插件目录之外的 `.zip` 包，将会被立即拒绝。

### 安装方式

在 GETSSH 应用内：**设置 → 插件 → 安装插件**，选择您的 `.zip` 文件即可。

---

## 12. 常见问题与错误

### 安装时报错：`[Security] Plugin installation rejected: ...capabilities...`

**原因**：后端插件的 `package.json` 中缺少 `"getssh": { "capabilities": ["lifecycle"] }` 声明。
**解决**：按照第 6 节的要求，在 `package.json` 中添加完整的 `getssh` 字段。

### 安装时报错：`[Security] ... does not export a 'deactivate' lifecycle hook`

**原因**：GETSSH 在对您的 `main.js` 进行静态扫描时，没有找到 `deactivate` 关键字。
**解决**：确保您的 `main.js` 中有 `deactivate` 函数的导出，哪怕是一个空实现：`module.exports.deactivate = () => {};`。

### 安装时报错：`Invalid Architecture: Missing package.json manifest.`

**原因**：`.zip` 包中找不到 `package.json` 文件，或者 `.zip` 内有多个并列的子目录。
**解决**：确保 `package.json` 直接位于 `.zip` 根目录，或者位于 `.zip` 内的单一子目录中。

### 加载时插件无响应，`window.GETSSH` 为 `undefined`

**原因**：您的沙盒插件代码在 GETSSH SDK 注入完成之前就运行了。
**解决**：不需要等待任何 `DOMContentLoaded` 事件，SDK 在脚本执行之前就已注入。请检查您的脚本是否放在 `<body>` 的内联 `<script>` 中，而不是通过 `src` 外链引入（外链脚本在沙盒中无法加载）。

### 通知不弹出

**原因**：操作系统通知权限未被授予。
**解决**：这由用户的操作系统权限控制。`showNotification` 在权限未授予时会静默失败，这是预期行为。
