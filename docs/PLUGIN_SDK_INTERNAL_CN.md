# GETSSH 3.0 插件 SDK 开发指南

中文 | [English](./PLUGIN_SDK_INTERNAL.md)

> 适用版本：GETSSH `3.0.0-F0A0G-PREVIEW` 插件运行时。本文以当前实现为准，替代旧版 VM 沙盒 SDK 文档。

GETSSH 3.0 的插件 SDK 不是一个需要安装的 npm 包。宿主会在插件启动时注入受控 API：后端代码通过 `activate(context)` 获得 `context`，插件页面通过 `window.GETSSH` 与宿主通信。

## 1. 先选择插件形态

| 形态 | Manifest | 运行位置 | 适合场景 |
|---|---|---|---|
| 纯 UI 插件 | `getssh.type: "sandbox"` | `iframe sandbox="allow-scripts"` | 面板、仪表盘、只读工具 |
| 纯后端插件 | 不填写 `getssh.type` | 独立的系统沙盒进程 | 存储、SSH 扩展、网络请求、原生对话框 |
| UI + 后端插件 | 不填写 `getssh.type`，同时提供 `main`、`renderer` 和 HTML | UI iframe + 独立后端进程 | 有界面且需要受控宿主能力的插件 |

不要填写 `"type": "hybrid"`。v3 只识别 `"sandbox"`；带后端的插件应省略 `getssh.type`。

纯 UI 插件在安全模式下仍可使用。带后端的插件是否启动取决于用户选择的后端插件执行策略：

| 模式 | 后端行为 |
|---|---|
| `safe` | 不执行任何插件后端代码 |
| `normal` | 每个插件运行在独立的操作系统隔离进程中 |
| `strict` | 当前与 `normal` 使用同一套操作系统隔离边界；名称保留用于兼容策略演进 |
| `developer` | 插件直接进入 Electron 主进程，视为完全可信代码 |

隔离进程在 macOS 使用 Seatbelt，在 Windows 使用 GETSSH 的 AppContainer 启动器。插件不能直接读取宿主私有文件、写入宿主目录、联网、启动子进程或创建 Worker；需要这些宿主能力时，应调用本文列出的 `context` API。

## 2. Manifest：`package.json`

每个插件根目录必须包含 `package.json`。下面是一个 UI + 后端插件的完整示例：

```json
{
  "name": "hello-getssh",
  "version": "1.0.0",
  "displayName": "Hello GETSSH",
  "description": "GETSSH 3.0 插件示例",
  "author": "Your Name",
  "main": "main.js",
  "renderer": "renderer.js",
  "getssh": {
    "pluginId": "com.example.hello-getssh",
    "capabilities": ["lifecycle", "storage:default"]
  }
}
```

### 字段说明

| 字段 | 必填 | 当前含义 |
|---|---|---|
| `name` | 是 | **v3 运行时唯一身份**、安装目录名、后端 RPC 绑定名和 `getssh-plugin://` URL 主机名 |
| `version` | 是 | 插件版本；建议使用语义化版本 |
| `main` | 是 | 纯 UI 插件填 HTML；带后端插件填 CommonJS JavaScript 入口 |
| `displayName` | 推荐 | 界面显示名称 |
| `description` | 推荐 | 插件简介 |
| `author` | 推荐 | 作者信息 |
| `renderer` | UI 集成时需要 | 在隐藏 UI 沙盒中执行的启动脚本，用来注册侧边栏按钮和面板 |
| `getssh.type` | 纯 UI 必填 | 当前唯一有效值为 `"sandbox"`；出现此值时，GETSSH 完全跳过后端加载 |
| `getssh.capabilities` | 后端必填 | 后端能力声明；必须包含 `"lifecycle"` |
| `getssh.name` | 可选 | 显示名称，优先级高于 `displayName` |
| `getssh.pluginId` | 可选 | 兼容与市场元数据；**当前不参与运行时身份绑定** |

当前运行时以 `name` 为准。不要用 `getssh.pluginId` 拼接面板 URL、调用 RPC 或访问存储。公共插件建议将 `name` 限制为小写英文字母、数字和连字符，例如 `server-health`；这样可避免 Windows、macOS 和 URL 主机名的大小写差异。

### 当前支持的 capabilities

| capability | 作用 |
|---|---|
| `lifecycle` | 所有后端插件强制声明，表示实现 `deactivate()` |
| `storage:default` | 显式声明默认存储档位；不声明时同样为 5 MiB |
| `storage:extended` | 将插件 KV 存储配额提高到 500 MiB |
| `storage:unlimited` | 取消插件 KV 存储配额 |
| `ssh:read` | 订阅指定 SSH 会话的终端输出 |
| `ssh:write` | 向指定 SSH 会话写入命令；首次写入需要用户确认 |
| `host:clipboard` | 读写系统剪贴板；读取时 GETSSH 会通知用户 |
| `net:fetch` | 通过 GETSSH 的 SSRF 防护网关访问公网 HTTP/HTTPS |

能力声明只会解锁对应的宿主 API，不会赋予任意 Electron、Node.js 或系统权限。

## 3. 三种可用目录结构

### 3.1 纯 UI 插件

```text
hello-ui/
├── package.json
├── renderer.js
├── index.html
└── ui.js
```

```json
{
  "name": "hello-ui",
  "version": "1.0.0",
  "displayName": "Hello UI",
  "description": "纯 UI 插件",
  "main": "index.html",
  "renderer": "renderer.js",
  "getssh": {
    "type": "sandbox"
  }
}
```

`main` 指向 HTML，但它不会作为 Node.js 文件执行。第三方 UI 插件应提供 `renderer.js`，让 GETSSH 启动时知道如何注册和打开页面。

### 3.2 纯后端插件

```text
hello-backend/
├── package.json
└── main.js
```

```json
{
  "name": "hello-backend",
  "version": "1.0.0",
  "displayName": "Hello Backend",
  "description": "纯后端插件",
  "main": "main.js",
  "getssh": {
    "capabilities": ["lifecycle", "storage:default"]
  }
}
```

### 3.3 UI + 后端插件

```text
hello-getssh/
├── package.json
├── main.js
├── renderer.js
├── index.html
└── ui.js
```

这类插件使用本文第 2 节的完整 Manifest。`renderer.js` 只负责注册 UI；`index.html` 是可见页面；`main.js` 注册后端方法。

## 4. 五分钟完成一个 UI + 后端插件

### `renderer.js`：注册入口

`renderer.js` 运行在隐藏的沙盒 iframe 中，只用来注册宿主 UI。不要在这里调用后端 RPC。

```javascript
const panelId = 'hello-getssh.main';
const actionId = 'open-hello-panel';

window.GETSSH.registerPanel(
  panelId,
  'Hello GETSSH',
  'getssh-plugin://hello-getssh/index.html'
);

window.__sidebarHandlers[actionId] = () => {
  window.GETSSH.openPanel(panelId);
};

window.GETSSH.registerSidebarAction(
  actionId,
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="currentColor"/></svg>',
  '打开 Hello 插件'
);
```

URL 中的 `hello-getssh` 必须与 Manifest 的 `name` 完全一致。插件内的 HTML、JavaScript、CSS、JSON 和常见图片资源都可通过同一协议加载，例如：

```html
<link rel="stylesheet" href="./style.css">
<script src="./ui.js"></script>
```

### `main.js`：注册后端能力

后端入口必须是 CommonJS 模块，并同时导出 `activate` 和 `deactivate`。

```javascript
let unsubscribe = null;

module.exports = {
  async activate(context) {
    // 所有后端插件当前都必须注册 1-256 个配置项。
    context.ui.registerSettings([
      {
        id: 'greeting',
        type: 'string',
        label: '问候语',
        description: '显示在插件面板中的文字',
        default: 'Hello from GETSSH'
      }
    ]);

    context.rpc.registerMethod('greet', async (payload) => {
      const configured = await context.storage.get('greeting');
      const greeting = configured ?? 'Hello from GETSSH';
      return { message: `${greeting}, ${payload?.name || 'developer'}!` };
    });

    context.ui.registerTerminalContextMenu(
      'remember-selection',
      '保存选中文字',
      async ({ selectionText }) => {
        await context.storage.set('lastSelection', selectionText);
        context.host.notify('Hello GETSSH', '已保存终端选中文字');
      }
    );
  },

  async deactivate() {
    unsubscribe?.();
    unsubscribe = null;
  }
};
```

### `index.html` 与 `ui.js`：调用后端

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Hello GETSSH</title>
</head>
<body>
  <input id="name" value="GETSSH">
  <button id="run">调用后端</button>
  <pre id="output"></pre>
  <script src="./ui.js"></script>
</body>
</html>
```

```javascript
const output = document.querySelector('#output');

document.querySelector('#run').addEventListener('click', async () => {
  try {
    const result = await window.GETSSH.invokeBackend('greet', {
      name: document.querySelector('#name').value
    });
    output.textContent = result.message;
  } catch (error) {
    output.textContent = error instanceof Error ? error.message : String(error);
  }
});

window.GETSSH.onBackendMessage((payload) => {
  console.log('backend event:', payload);
});

window.GETSSH.onThemeChange((theme) => {
  document.documentElement.dataset.theme = theme;
});
```

后端处于 `safe` 模式、加载失败或没有注册该方法时，`invokeBackend()` 会 reject。前端应始终处理异常。

## 5. 后端生命周期规则

```typescript
interface PluginModule {
  activate(context: MainContextAPI): void | Promise<void>;
  deactivate(): void | Promise<void>;
}
```

- `activate()` 最长 8 秒。
- 后端必须在 `activate()` 完成前注册 RPC、终端菜单、SFTP 菜单和设置 Schema。隔离运行时会在激活完成时生成一次注册快照，之后新增的注册项不会同步给宿主。
- 后端当前必须调用 `context.ui.registerSettings()`，并提供至少一个有效字段。即使插件没有可调参数，也需要提供一个有实际意义的布尔开关，例如 `enabled`。
- `deactivate()` 应关闭定时器、流、监听器和订阅。宿主通常只给关闭流程约 2 秒，超时后会终止插件进程。
- 安全中心强制处置插件时可能直接结束进程，不能把数据完整性只依赖于 `deactivate()`。
- 使用 `console.log/info/warn/error` 记录日志。隔离进程的标准输出是 GETSSH 内部协议通道，请勿自行改写 `process.stdout` 或向 stdout 输出协议数据。

后端入口由 `require()` 加载。请输出 CommonJS；如果项目使用 TypeScript、ESM 或打包器，应把最终产物编译为 CommonJS。

## 6. 后端 API 参考：`context`

本文签名中的跨边界数据类型为：

```typescript
type StructuredData =
  | null
  | string
  | boolean
  | number
  | StructuredData[]
  | { [key: string]: StructuredData };
```

### 6.1 通知与系统加密

```typescript
interface MainContextAPI {
  showNotification(title: string, body: string): void;
  safeStorageEncrypt(text: string): Promise<string>;
  host: {
    notify(
      title: string,
      body: string,
      type?: 'info' | 'warning' | 'error'
    ): void;
  };
}
```

`showNotification()` 是兼容别名，新插件建议使用 `host.notify()`。`type` 当前用于表达调用意图，桌面通知的最终外观由操作系统决定。

`safeStorageEncrypt()` 使用 Electron 的操作系统安全存储加密字符串，返回 base64 密文。它是异步函数，必须 `await`。当前 SDK 没有向插件开放对应的解密函数，因此不要把它误当成完整的插件密码仓库。

### 6.2 插件 KV 存储

```typescript
interface PluginStorageAPI {
  get(key: string): Promise<StructuredData | undefined>;
  set(key: string, value: StructuredData): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}
```

存储命名空间与 Manifest 的 `name` 绑定。键最长 256 个字符。默认配额 5 MiB，`storage:extended` 为 500 MiB，`storage:unlimited` 不限额。

建议只存储 JSON 风格数据：`null`、字符串、布尔值、有限数字、数组和普通对象。不要传递函数、Symbol、BigInt、Date、Map、Set、Buffer、类实例、循环引用或 `undefined`。

```javascript
await context.storage.set('cache', { updatedAt: Date.now(), hosts: 3 });
const cache = await context.storage.get('cache');
await context.storage.delete('cache');
```

### 6.3 前后端 RPC

```typescript
interface PluginRpcAPI {
  registerMethod(
    method: string,
    handler: (payload: StructuredData | undefined) =>
      StructuredData | undefined | Promise<StructuredData | undefined>
  ): void;
  sendToFrontend(payload: StructuredData): void;
}
```

RPC 方法名只能包含英文字母、数字、`.`、`_`、`:`、`-`，长度 1-128，且不能是 `__proto__`、`prototype` 或 `constructor`。

```javascript
context.rpc.registerMethod('server:list', async ({ group }) => {
  return { group, items: await context.storage.get(`group:${group}`) ?? [] };
});

context.rpc.sendToFrontend({ type: 'sync-complete', count: 12 });
```

前端对应调用：

```javascript
const result = await window.GETSSH.invokeBackend('server:list', { group: 'prod' });

window.GETSSH.onBackendMessage((event) => {
  if (event.type === 'sync-complete') console.log(event.count);
});
```

一次调用的 payload 和返回值都必须是结构化数据，编码后不超过 2 MiB，嵌套深度不超过 24 层。调用超时为 15 秒。大量数据应分页传输，不要把文件内容塞进一次 RPC。

### 6.4 设置 Schema

```typescript
interface PluginSettingsField {
  id: string;
  type: 'string' | 'number' | 'boolean' | 'password';
  label: string;
  description?: string;
  default?: StructuredData;
}

interface PluginSettingsAPI {
  registerSettings(fields: PluginSettingsField[]): void;
}
```

规则：

- 每个后端插件必须注册 1-256 个字段。
- `id` 使用与 RPC 方法名相同的安全字符规则，并且不能重复。
- `label` 长度为 1-256；`description` 最长 4096 个字符。
- 用户保存设置后，GETSSH 以字段 `id` 为键写入插件 KV 存储，然后重新加载插件。
- 插件通过 `context.storage.get(field.id)` 读取设置。
- `password` 只控制输入框遮罩。不要把它理解为一项额外的加密保证。

```javascript
context.ui.registerSettings([
  { id: 'enabled', type: 'boolean', label: '启用插件', default: true },
  { id: 'endpoint', type: 'string', label: 'API 地址', default: 'https://api.example.com' },
  { id: 'interval', type: 'number', label: '刷新秒数', default: 30 },
  { id: 'token', type: 'password', label: '访问令牌' }
]);

const enabled = (await context.storage.get('enabled')) ?? true;
```

### 6.5 终端与 SFTP 右键菜单

```typescript
interface PluginContextMenuAPI {
  registerTerminalContextMenu(
    actionId: string,
    label: string,
    handler: (data: {
      sessionId: string;
      selectionText: string;
    }) => unknown | Promise<unknown>
  ): void;

  registerSFTPContextMenu(
    actionId: string,
    label: string,
    handler: (data: {
      sessionId: string;
      currentPath: string;
      selectedFiles: string[];
    }) => unknown | Promise<unknown>
  ): void;
}
```

`actionId` 使用安全标识符规则，标签长度为 1-256。每类最多注册 128 项。

```javascript
context.ui.registerSFTPContextMenu(
  'copy-remote-path',
  '复制远程路径',
  async ({ currentPath }) => {
    await context.host.clipboard.writeText(currentPath);
  }
);
```

上例还需要声明 `host:clipboard`。

### 6.6 SSH 数据与写入

```typescript
interface PluginSshAPI {
  onData(
    sessionId: string,
    callback: (chunk: string) => void
  ): () => void;
  write(sessionId: string, command: string): Promise<void>;
}
```

- `ssh:read` 解锁 `onData()`。
- `ssh:write` 解锁 `write()`。
- UI 页面拿不到真实 session ID。后端通常从终端或 SFTP 右键菜单的上下文获得 session ID。
- `onData()` 返回取消订阅函数，应在不再需要时调用，并在 `deactivate()` 中兜底清理。
- `write()` 每次最多接受约 1 MiB 文本。首次写入时用户可拒绝、仅允许本次，或允许本次运行。

```javascript
let stopReading = null;

context.ui.registerTerminalContextMenu(
  'watch-output',
  '开始监听本会话',
  ({ sessionId }) => {
    stopReading?.();
    stopReading = context.ssh.onData(sessionId, (chunk) => {
      console.log('SSH output:', chunk);
    });
  }
);
```

只有在 Manifest 声明了对应能力时才调用这些方法。

### 6.7 剪贴板与原生对话框

```typescript
interface PluginHostAPI {
  clipboard: {
    writeText(text: string): Promise<void>;
    readText(): Promise<string>;
  };
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
  showOpenDialog(options: {
    title?: string;
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
    properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles'>;
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
  showSaveDialog(options: {
    title?: string;
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<{ canceled: boolean; filePath?: string }>;
}
```

剪贴板方法需要 `host:clipboard`。对话框无需额外 capability。

文件对话框只返回用户选择的路径。普通/严格模式下，这个路径不会自动获得文件读取或写入授权；隔离插件仍不能用 `fs` 打开宿主文件。需要文件内容时，应等待 GETSSH 提供专门的受控文件 API。

### 6.8 公网请求：`context.net.fetch`

Manifest 必须声明 `net:fetch`：

```javascript
const response = await context.net.fetch('https://api.example.com/v1/status', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ source: 'getssh' }),
  redirect: 'follow'
});

if (!response.ok) throw new Error(`HTTP ${response.status}`);
const data = await response.json();
```

网关规则：

- 只允许 `http:` 和 `https:`，URL 最长 8192 个字符。
- 禁止 URL 内嵌用户名或密码。
- DNS 解析结果中的任意地址属于 loopback、内网、链路本地、保留网段或组播网段时，请求被拒绝。
- 最多跟随 5 次重定向；跨源重定向会移除 `authorization` 和 `cookie`。
- 请求超时 30 秒；响应正文最多 1 MiB。
- 最多 128 个请求头；`host`、`content-length`、`connection`、`transfer-encoding` 等连接级请求头由宿主管理。
- 支持的选项是 `method`、`headers`、`body` 和 `redirect`。隔离模式支持字符串、`URLSearchParams`、`ArrayBuffer` 和 TypedArray 请求体；为了兼容开发者模式，建议统一发送字符串。
- 不支持 `AbortSignal`、`FormData`、`Blob`、流式请求体或直接 Socket。

违反网络安全边界会抛出 `SecurityError`，触发安全中心并终止该插件。普通网络错误以 `NetworkError` reject。

## 7. 前端 API 参考：`window.GETSSH`

插件页面必须由 GETSSH 通过 `getssh-plugin://<name>/<file>` 打开。直接在浏览器或磁盘上打开 HTML 时，不会存在 `window.GETSSH`。

### API 可用范围

| API | `renderer.js` 启动沙盒 | 可见 HTML 面板 |
|---|---:|---:|
| `registerSidebarAction` | 是 | 是 |
| `registerPanel` / `openPanel` | 是 | 是 |
| `showNotification` | 是 | 是 |
| `getLocale` / `onThemeChange` | 是 | 是 |
| `invokeBackend` / `onBackendMessage` | 否 | 是 |

### `registerSidebarAction`

```typescript
interface RendererContextAPI {
  registerSidebarAction(id: string, svgIcon: string, label: string): void;
}
```

SVG 会经过净化。点击回调不作为参数传入；请把同名处理器放入 `window.__sidebarHandlers`：

```javascript
window.__sidebarHandlers.open = () => window.GETSSH.openPanel('server-dashboard.main');
window.GETSSH.registerSidebarAction('open', svg, '打开仪表盘');
```

### `registerPanel` 与 `openPanel`

```typescript
interface RendererContextAPI {
  registerPanel(panelId: string, title: string, renderUrl: string): void;
  openPanel(panelId: string): void;
}
```

推荐始终使用插件包内 URL：

```javascript
window.GETSSH.registerPanel(
  'server-dashboard.main',
  'Server Dashboard',
  'getssh-plugin://server-dashboard/index.html'
);
```

先注册，再打开。当前面板注册表以 `panelId` 为全局键，因此应使用 `<插件 name>.<面板名>` 形式保持全局唯一和稳定。

### `showNotification`

```typescript
interface RendererContextAPI {
  showNotification(title: string, body: string): void;
}
```

前端通知使用浏览器 Notification API；系统没有授予通知权限时可能不显示。

### `getLocale` 与 `onThemeChange`

```typescript
interface RendererContextAPI {
  getLocale(): string;
  onThemeChange(
    callback: (theme: 'dark' | 'light' | 'system') => void
  ): void;
}
```

`getLocale()` 返回当前语言快照。宿主语言变化时会更新后续读取结果。`onThemeChange()` 当前不返回取消订阅函数，因此同一页面不要重复注册同一个回调。

### `invokeBackend` 与 `onBackendMessage`

```typescript
interface RendererContextAPI {
  invokeBackend(
    method: string,
    payload?: StructuredData
  ): Promise<StructuredData | undefined>;
  onBackendMessage(callback: (payload: StructuredData) => void): void;
}
```

`invokeBackend()` 只会调用与当前面板 URL 中 `name` 相同的后端插件。插件页面传入的其他 plugin ID 会被忽略，不能跨插件调用。

`onBackendMessage()` 接收后端 `context.rpc.sendToFrontend()` 推送的数据。它当前不返回取消订阅函数；监听器随 iframe 销毁而释放。

### 宿主系统监控事件

当前插件面板还会收到每秒一次的兼容事件：

```javascript
window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  if (event.data?.type !== 'sysmon:data') return;

  const { cpus, mem, net } = event.data.payload;
  // cpus.overall: number; cpus.cores: number[]
  // mem.total / mem.used / mem.free: bytes
  // net.rx / net.tx: bytes since the latest refresh
});
```

这是宿主事件，不是 `window.GETSSH` 函数。插件应先检查消息来源和 `type`。

## 8. 数据、速率和注册限制

| 项目 | 当前限制 |
|---|---:|
| 单条进程协议消息 | 2 MiB |
| 结构化数据嵌套 | 24 层 |
| RPC/宿主调用超时 | 15 秒 |
| 激活超时 | 8 秒 |
| RPC 方法 | 128 个 |
| 终端菜单项 | 128 个 |
| SFTP 菜单项 | 128 个 |
| 设置字段 | 1-256 个 |
| 隔离插件发往宿主的调用 | 250 次/秒 |
| 隔离进程协议消息 | 500 条/秒、16 MiB/秒 |
| 后端日志采集 | 每次运行最多 64 KiB |

这些限制用于保护宿主。轮询、日志和事件推送应进行节流与合并。

## 9. 隔离模式下的 Node.js 规则

带后端插件仍是 JavaScript 进程，可以加载插件包内的 CommonJS 模块，但操作系统沙盒才是权限边界：

- 插件目录只读。
- 运行时会分配一个随机、私有的临时 HOME，可在其中写临时文件；进程结束后 GETSSH 会清理它。
- 宿主用户目录、GETSSH userData、系统临时目录、外接卷等不可直接读取或写入。
- 直接网络被关闭；必须使用 `context.net.fetch()`。
- 子进程、Worker、进程间信号、调试器和原生 addon 不属于可移植的插件能力。
- 环境变量只继承少量安全白名单值，不应依赖宿主密钥或用户环境变量。

因此，建议把业务逻辑打包成纯 JavaScript，并把所有宿主交互集中到 `context`。不要用开发者模式下可用的 `require('fs')`、`child_process`、Electron API 或任意网络模块作为正式插件接口。

普通和严格模式要求平台隔离后端可用：macOS 使用 Seatbelt，Windows 使用随应用提供的 AppContainer 启动器。如果隔离后端不可用，GETSSH 会拒绝启动后端插件；纯 UI 插件不受影响。

## 10. 依赖、打包与安装

GETSSH 安装插件时不会运行 `npm install`。发布包必须包含运行所需的全部 JavaScript、CSS、图片和依赖。推荐把后端依赖打成单个 CommonJS 文件，把前端依赖打成静态浏览器资源。

ZIP 支持两种布局：

```text
hello-getssh.zip
├── package.json
├── main.js
├── renderer.js
├── index.html
└── ui.js
```

或只有一个顶层目录：

```text
hello-getssh.zip
└── hello-getssh/
    ├── package.json
    └── ...
```

macOS：

```bash
cd hello-getssh
zip -r ../hello-getssh.zip . -x '*.DS_Store'
```

Windows PowerShell：

```powershell
Compress-Archive -Path .\hello-getssh\* -DestinationPath .\hello-getssh.zip -Force
```

在 GETSSH 中打开“设置 → 插件”，把 ZIP 拖入安装区，检查权限列表后安装。相同 `name` 的新包会替换旧目录。

当前实现的内部类型声明位于 [`apps/getssh-client/src/types/plugin.d.ts`](../apps/getssh-client/src/types/plugin.d.ts)；第三方插件应以本文档中的签名为准。

## 11. 从旧 SDK 迁移

| 旧写法或旧认知 | v3 写法 |
|---|---|
| 后端运行在主进程 `vm.Script` | 普通/严格模式运行在独立的操作系统沙盒进程 |
| `getssh.type: "hybrid"` | 省略 `getssh.type`，用 `renderer` + 后端 `main` 组成 UI + 后端插件 |
| `getssh.pluginId` 是运行时身份 | `name` 是运行时身份；`pluginId` 当前只是元数据 |
| `safeStorageEncrypt()` 同步返回 | `await context.safeStorageEncrypt()` |
| `ssh.onData()` 不需要清理 | 保存并调用它返回的取消订阅函数 |
| `ssh.write()` 同步调用 | `await context.ssh.write()` |
| `pluginRpcInvoke()` | 页面调用 `window.GETSSH.invokeBackend()` |
| `onPluginRpcMessage()` | 页面调用 `window.GETSSH.onBackendMessage()` |
| `registerSettingsSchema()` | 后端调用 `context.ui.registerSettings()` |
| `registerUIExtension()` | 使用 `registerTerminalContextMenu()` 或 `registerSFTPContextMenu()` |
| `onSSHSessionConnect` | 当前 SDK 未提供；从右键菜单上下文取得 session ID |
| 普通模式可以直接访问宿主文件或网络 | 通过 `context.storage`、`context.net`、`context.ssh` 和 `context.host` 访问受控能力 |

## 12. 常见错误

### `Node.js plugins must declare ... lifecycle`

后端 Manifest 缺少 `"lifecycle"`。添加 capability，并确保模块导出有效的 `deactivate()`。

### `Backend plugins must export activate() and deactivate()`

后端不是 CommonJS，导出名称不对，或 `main` 指向了错误文件。检查最终打包产物，而不是源码入口。

### `Backend plugins must call context.ui.registerSettings()`

在 `activate()` 完成前调用一次 `registerSettings()`，并传入至少一个有效字段。

### `Plugin '<name>' is not running`

常见原因是安全模式禁用了后端、插件激活失败、当前系统缺少隔离运行环境，或前端 URL 的主机名与 Manifest `name` 不一致。

### `Method '<method>' not found`

确认后端在 `activate()` 完成前调用了 `context.rpc.registerMethod()`，且方法名完全一致。

### `window.GETSSH` 是 `undefined`

页面必须从 `getssh-plugin://<name>/...` 进入 GETSSH 的插件 iframe。直接双击 HTML 或在普通浏览器中打开不会注入 SDK。

### `SecurityError` 后插件被终止

插件触碰了安全边界，最常见的是 `net.fetch` 请求解析到私网或保留地址。修正目标地址和能力声明后重新加载插件。

### 数据无法通过 RPC 或存储

把值转换成 JSON 风格的普通数据，去掉类实例、函数、BigInt、循环引用和大型二进制内容，并检查 2 MiB 单消息上限。

## 13. 发布前检查表

- `name` 使用稳定的小写标识，并与所有 `getssh-plugin://<name>/...` URL 一致。
- 纯 UI 插件声明 `getssh.type: "sandbox"`；带后端插件不声明 `type`。
- 后端产物是 CommonJS，同时导出 `activate` 和 `deactivate`。
- 后端 capabilities 包含 `lifecycle`，其他能力按实际需要最小化声明。
- `activate()` 在 8 秒内完成，并在完成前注册全部方法、菜单和设置。
- `deactivate()` 清理定时器、订阅、流和其他资源。
- 前端处理 `invokeBackend()` reject，能在后端未启动时正常显示。
- 所有跨边界数据可 JSON 序列化，并低于大小和速率限制。
- 插件不依赖开发者模式中的直接文件、网络、子进程或 Electron 权限。
- ZIP 内包含全部依赖，且 `package.json` 位于根目录或唯一的顶层目录中。
- 至少分别在 macOS 和 Windows 上验证一次普通/严格模式。
