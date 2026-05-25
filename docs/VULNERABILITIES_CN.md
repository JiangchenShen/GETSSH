# GETSSH 终极安全审计报告 V3.0（全代码库逐行扫描·三刷终稿）

> **版本**：V3.0 — 三刷终稿（Anti-CVE Edition）
> **审查范围**：项目根目录下全部 `.ts`、`.tsx`、`.js`、`.json`、`.html`、`.bat` 文件
> **方法论**：全文件逐行审计 + IPC 数据流追踪 + 攻击链组合分析 + 竞态/TOCTOU/时序分析
> **基调**：仅列出漏洞，供讨论后统一修复

---

## ⚠️ 严重程度定义

| 级别 | 含义 |
|---|---|
| 🔴 CRITICAL | 可被远程利用，直接导致数据泄露、系统接管或应用崩溃 |
| 🟠 HIGH | 在特定条件下可被本地利用，影响安全边界 |
| 🟡 MEDIUM | 需要多步骤组合才能利用，或影响范围有限 |
| 🟢 LOW | 理论漏洞，利用难度极高，或仅影响应用稳定性 |

---

## 预警：第四轮深挖新增两个极其隐蔽的核弹级漏洞 (C-05, C-06)
在您提示后，对代码的深层逻辑（特别是 Windows 平台特性和 Electron 的 `will-navigate` 机制）进行了穿透式审计，发现两个可以直接导致 **凭证秒级被盗** 和 **沙盒与CSP完全失效** 的严重漏洞。

---

## 第一章：协议层漏洞 — 本地文件任意读取

### 🔴 [C-01] `getssh-plugin://` 路径穿越导致本机 LFI

**文件**：[index.ts:112-118](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/index.ts#L112-L118)

```typescript
protocol.handle('getssh-plugin', (request) => {
  const url = request.url.substring('getssh-plugin://'.length);
  const decodedUrl = decodeURIComponent(url);
  const pluginPath = join(app.getPath('userData'), 'plugins', decodedUrl);
  return net.fetch(pathToFileURL(pluginPath).toString());
});
```

`join()` 不阻止 `../` 遍历。攻击者通过 XSS 执行 `fetch('getssh-plugin://../../../../../../Users/xxx/.ssh/id_rsa')` 即可窃取 SSH 私钥、浏览器凭证数据库等**任意本地文件**。

---

## 第二章：插件系统 — 全面沦陷

### 🔴 [C-02] 主进程插件以 Node.js 最高权限运行（无沙盒）

**文件**：[PluginManager.ts:65](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/PluginManager.ts#L65)

```typescript
const pluginModule = require(mainEntryPath);
pluginModule.activate(this.createMainContext());
```

第三方插件通过 `require()` 直接加载到 Electron 主进程。插件可访问 `fs`、`child_process`、`net` 等所有 Node.js API，等同于拥有**当前用户的全部系统权限**。这是整个项目最根本的架构缺陷。

---

### 🔴 [C-03] `safeStorageDecrypt` 暴露给插件 = 全部凭证明文泄露

**文件**：[PluginManager.ts:29-34](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/PluginManager.ts#L29-L34)

```typescript
safeStorageDecrypt: (hash) => {
  return safeStorage.decryptString(Buffer.from(hash, 'base64'));
}
```

任何插件均可调用此 API。恶意插件只需读取磁盘上的 `profiles.key`（存储了 OS 级加密的主密码），传入此函数即可获得明文主密码，进而解密 `profiles.enc` 中的**全部 SSH 密码和私钥路径**。

---

### 🔴 [C-04] Windows 平台生物解锁验证绕过 = 主密码被"提款机"式窃取

**文件**：[cryptoHandler.ts:21-30](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/handlers/cryptoHandler.ts#L21-L30)

```typescript
} else if (process.platform === 'win32') {
  // Windows DPAPI is implicit via user login, so proceed
}
// ...
const masterPassword = safeStorage.decryptString(encryptedKey);
return { success: true, masterPassword };
```

在 Windows 系统中，Electron 的 `safeStorage` 底层使用 DPAPI，这意味着解密是隐式的，**不会像 macOS 一样弹出指纹或密码输入确认框**！代码中直接因为是 `win32` 就绿灯放行并返回了**明文主密码**。
任何 XSS 脚本只要在 Windows 电脑上执行 `await window.electronAPI.promptBiometricUnlock()`，GETSSH 就会像没有任何防御的提款机一样，立刻把最核心的主密码明文吐给攻击者。

---

### 🔴 [C-05] `will-navigate` 协议校验逻辑漏洞导致全局 CSP 绕过 + RCE

**文件**：[windowHandler.ts:87-89](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/handlers/windowHandler.ts#L87-L89)

```typescript
if (parsedUrl.protocol === 'file:') {
  return; // Allow local file navigation (dist/index.html)
}
```

为了允许本地加载 `dist/index.html`，代码简单粗暴地放行了**所有** `file://` 协议导航。
如果攻击者通过 XSS 执行 `window.location.href = 'file:///tmp/malicious.html'`（恶意 HTML 可通过 SFTP 的 `edit-sync` 功能或任何方式诱导存入本地），GETSSH 的主窗口就会直接跳转加载这个恶意网页。
**致命点**：跳转后的恶意本地网页不仅**脱离了原本 `index.html` 的 CSP 限制**（可以随意加载外部脚本或外发数据），而且因为它是在主窗口中渲染，**它依然继承了全局注入的 `window.electronAPI`！** 这使得低危的本地文件掉落直接升级为无限制的 RCE 和系统接管。

---

### 🟠 [H-01] XSS → RCE 闭环：`installPlugin` 暴露给渲染进程

**文件**：[preload/index.ts:50](file:///Users/shenjiangchen/Documents/GETSSH/electron/preload/index.ts#L50)

```typescript
installPlugin: (zipPath: string) => ipcRenderer.invoke('install-plugin', zipPath),
```

任何在渲染进程中执行的 JS（XSS、恶意翻译包、被篡改的 localStorage）都可调用此接口，安装预先放置在 `~/Downloads` 的恶意 ZIP，形成 **XSS → 插件安装 → 主进程 RCE** 的完整攻击链。

---

### 🟠 [H-02] `PluginPane` 的 `allow-same-origin` 沙盒逃逸

**文件**：[PluginPane.tsx:82](file:///Users/shenjiangchen/Documents/GETSSH/src/components/PluginPane.tsx#L82)

```html
sandbox="allow-scripts allow-same-origin"
```

`allow-same-origin` 使得使用 `file://` 协议运行的生产版 Electron 中，iframe 内的插件脚本可以**直接访问父窗口的 localStorage**（包含 `appConfig` 和 `initScript`）及 DOM，完全绕过沙盒隔离。

---

### 🟡 [M-01] `LeafPane` 直接构造 `file://` URL 加载插件

**文件**：[LeafPane.tsx:269](file:///Users/shenjiangchen/Documents/GETSSH/src/components/LeafPane.tsx#L269)

```typescript
const pluginUrl = `file://${plugin.localPath}/${plugin.main}`;
```

此处将插件的 `localPath` 和 `main`（来自 `package.json`）直接拼接为 `file://` URL，无路径校验。恶意 `package.json` 中的 `main` 字段如果设为 `../../../../../../etc/passwd`，这个 URL 将指向系统文件。

---

### 🟡 [M-02] PluginBridge `postMessage` 来源无校验

**文件**：[PluginBridge.ts:26-41](file:///Users/shenjiangchen/Documents/GETSSH/src/plugins/PluginBridge.ts#L26-L41)

```typescript
function handlePluginMessage(event: MessageEvent) {
  const data = event.data;
  if (!data || !data.__getssh_plugin) return;
  // ❌ 没有校验 event.origin 或 event.source
```

任何 iframe（包括广告 iframe）均可伪造带 `__getssh_plugin: true` 的消息，触发侧边栏注册、弹出通知等。对比 `PluginPane.tsx:34` 正确校验了 `event.source`。

---

### 🟡 [M-03] `require.cache` 无限累积导致内存膨胀

**文件**：[PluginManager.ts:65](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/PluginManager.ts#L65)

Node.js `require()` 永久缓存模块。频繁安装/卸载插件时，旧版本代码永远无法被 GC 回收。

---

## 第三章：XSS 与注入

### 🟠 [H-03] CSP 宽松：`unsafe-inline` + `unsafe-eval`

**文件**：[index.html:5](file:///Users/shenjiangchen/Documents/GETSSH/index.html#L5)

```html
script-src 'self' 'unsafe-inline' 'unsafe-eval'
```

这两个指令完全废止了 CSP 对内联脚本的防护。在 Electron 应用中，这意味着任何注入到 DOM 的内联脚本都不会被拦截。

---

### 🟠 [H-04] `dangerouslySetInnerHTML` 未消毒的 i18n 注入

**文件**：[SettingsView.tsx:968](file:///Users/shenjiangchen/Documents/GETSSH/src/components/SettingsView.tsx#L968)

```tsx
<p dangerouslySetInnerHTML={{ __html: t('about.openSourceDesc') as string }} />
```

此处**没有 DOMPurify 消毒**。对比 `Sidebar.tsx:152` 使用了 `DOMPurify.sanitize()`。如果开放社区翻译贡献，恶意翻译文件可直接触发 XSS。

---

### 🟡 [M-04] 自定义主题导入的原型污染风险

**文件**：[SettingsView.tsx:48-69](file:///Users/shenjiangchen/Documents/GETSSH/src/components/SettingsView.tsx#L48-L69) + [themes.ts:parseCustomTheme](file:///Users/shenjiangchen/Documents/GETSSH/src/utils/themes.ts)

用户可导入任意 JSON 文件作为终端主题。`parseCustomTheme` 使用 `JSON.parse` 后通过 `Object.entries` 遍历，如果恶意 JSON 包含 `__proto__` 键，可导致原型污染。解析后的对象被存入 `localStorage` 并传给 Xterm.js，潜在影响终端渲染逻辑。

---

### 🟡 [M-05] `connect-src` CSP 过于宽泛

**文件**：[index.html:5](file:///Users/shenjiangchen/Documents/GETSSH/index.html#L5)

```
connect-src 'self' ws: http: https:
```

允许渲染进程向**任意域名**发起 HTTP/WebSocket 请求。如果攻击者通过 XSS 获得执行权，可将窃取的密码/密钥直接 `fetch()` 外传到外部服务器，CSP 不会拦截。

---

## 第四章：凭证与密码安全

### 🟠 [H-05] `initScript` 命令注入远端服务器

**文件**：[App.tsx:242-246](file:///Users/shenjiangchen/Documents/GETSSH/src/App.tsx#L242-L246)

```typescript
window.electronAPI.sshWrite(sessionId, config.initScript + '\n');
```

`initScript` 是明文存储在 `localStorage` 中的任意 Shell 命令。攻击者通过 XSS 或插件篡改此字段后，下次 SSH 连接时，恶意命令将在**远端服务器**上自动执行。这构成了"本地漏洞 → 远端服务器沦陷"的**跨域攻击升级**。

---

### 🟡 [M-06] `localStorage` 明文存储敏感配置

**文件**：[appStore.ts:148](file:///Users/shenjiangchen/Documents/GETSSH/src/store/appStore.ts#L148)

```typescript
localStorage.setItem('appConfig', JSON.stringify(appConfig));
```

`appConfig` 包含 `initScript`（远端命令）、`proxyHost/proxyPort`（代理配置）、`globalHotkey` 等。全部以明文 JSON 存储，任何渲染进程内的代码均可读取和篡改。

---

### 🟡 [M-07] Zustand/React State 中主密码无限期驻留

**文件**：[App.tsx:85](file:///Users/shenjiangchen/Documents/GETSSH/src/App.tsx#L85), [cryptoStore.ts](file:///Users/shenjiangchen/Documents/GETSSH/src/store/cryptoStore.ts)

主密码在解锁后作为 React state 驻留在 V8 堆内存中，直到 GC 才可能被回收。通过 Electron 调试接口或进程内存转储可提取。

---

### 🟡 [M-08] `CryptoModal` 密码强度过低：最小 4 字符

**文件**：[CryptoModal.tsx:30-31](file:///Users/shenjiangchen/Documents/GETSSH/src/components/CryptoModal.tsx#L30-L31)

```typescript
if (password.length < 4) {
  setError('Password too short (min 4 chars)');
```

4 字符密码可在秒级被暴力破解，即使使用了 PBKDF2-100000 轮。行业标准最低 8 字符。

---

## 第五章：内存安全与 DoS

### 🔴 [C-06] SFTP 大文件"一口吞"导致 OOM 崩溃

**文件**：[sftpHandler.ts:78-89](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/handlers/sftpHandler.ts#L78-L89)

```typescript
session.sftp.readFile(remotePath, 'utf8', (err, data) => {
  resolve({ success: true, data }); // data 可能是数 GB
});
```

无大小限制。双击服务器上 2GB 的 `.log` 文件 → Node.js V8 瞬间 OOM → 应用崩溃。

---

### 🟠 [H-06] PTY 终端维度无上限校验

**文件**：[ptyHandler.ts:82-83](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/handlers/ptyHandler.ts#L82-L83)

```typescript
const cols = config.cols || 80;
const rows = config.rows || 24;
```

未 Clamp。伪造 IPC 发送 `{ cols: 99999999, rows: 99999999 }` → `node-pty` C++ 层尝试分配超大缓冲 → 进程崩溃或系统卡死。

---

### 🟡 [M-09] `sysmon setInterval` 永久泄漏

**文件**：[systemHandler.ts:91-99](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/handlers/systemHandler.ts#L91-L99)

```typescript
setInterval(() => {
  win.webContents.send('sysmon:data', { cpus: os.cpus(), ... });
}, 1000);
```

intervalId 未存储，无清理机制。即使窗口销毁，主进程每秒仍执行 `os.cpus()` 系统调用。

---

### 🟡 [M-10] PTY 僵尸进程（渲染进程崩溃后）

**文件**：[ptyHandler.ts](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/handlers/ptyHandler.ts)

PTY 清理完全依赖前端发送 `ssh-disconnect`。若渲染进程崩溃，本地 `bash/zsh` 子进程成为系统孤儿进程。应在 `BrowserWindow.closed` 事件中强制清理。

---

## 第六章：IPC 安全边界

### 🟡 [M-11] 所有 `ipcMain.on` 均缺少 `event.senderFrame` 校验

**文件**：[sshHandler.ts:391](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/handlers/sshHandler.ts#L391), [systemHandler.ts:102](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/handlers/systemHandler.ts#L102)

```typescript
ipcMain.on('ssh-write', (event, { sessionId, data }) => { ... });
ipcMain.on('update-backend-config', (event, config) => { ... });
```

Electron 官方建议在每个 IPC handler 中校验 `event.senderFrame.url` 是否为应用自身页面，以防止被注入的 webview/iframe 通过 IPC 直接操控主进程。当前所有 `ipcMain.on` 和 `ipcMain.handle` 均**完全没有校验发送者身份**。

---

### 🟡 [M-12] `SessionId` 可预测（线性递增）

**文件**：[ConnectionManager.ts:17-19](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/services/ConnectionManager.ts#L17-L19)

```typescript
generateSessionId() {
  return `req-${++this.sessionCounter}`;
}
```

SessionId 是简单的自增计数器 `req-1, req-2, req-3...`。如果攻击者可通过 XSS 执行 `electronAPI.sshWrite('req-1', '恶意命令\n')`，就能向**别人正在使用的 SSH 会话**注入命令。应使用 `crypto.randomUUID()`。

---

## 第七章：SFTP 特定漏洞

### 🟡 [M-13] SFTP 临时文件符号链接竞争 (Symlink Race / TOCTOU)

**文件**：[sftpHandler.ts:104-140](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/handlers/sftpHandler.ts#L104-L140)

```typescript
const tempPath = join(os.tmpdir(), `getssh_sync_${Date.now()}_${fileName}`);
// ... fastGet 下载到 tempPath ...
const watcher = fs.watch(tempPath, (eventType) => {
  session.sftp!.fastPut(tempPath, remoteFilePath, ...);
});
```

`tempPath` 基于 `Date.now()` 的可预测名称位于 `/tmp`。攻击者可预判文件名，在 `fastGet` 完成和 `fs.watch` 启动之间的窗口期创建同名符号链接，使 `fastPut` 将攻击者控制的文件上传到远端服务器的目标路径。

---

### 🟢 [L-01] `sftp-edit-sync` 未校验文件扩展名/大小

双击任何文件（包括二进制文件）都会触发全量下载到本地 + `fs.watch` 监控。无黑名单/白名单/大小限制。

---

## 第八章：网络与更新安全

### 🟢 [L-02] HTTP 更新检查无证书 Pinning

**文件**：[systemHandler.ts:41-78](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/handlers/systemHandler.ts#L41-L78)

原生 `https.get` 查询 GitHub API，无证书 pinning。恶意 Wi-Fi 下可伪造 API 响应诱导用户访问钓鱼站点。

---

### 🟢 [L-03] `.npmrc` 启用 `ignore-scripts=false`

**文件**：[.npmrc](file:///Users/shenjiangchen/Documents/GETSSH/.npmrc)

```
ignore-scripts=false
```

允许所有 npm 包的 `postinstall` 脚本执行。供应链攻击者若成功投毒某个依赖包，其恶意 `postinstall` 脚本将在 `pnpm install` 时自动执行。

---

## 第九章：系统级与杂项

### 🟠 [H-07] Windows 卸载脚本环境变量劫持

**文件**：[GETSSH_Force_Uninstaller.bat:19-27](file:///Users/shenjiangchen/Documents/GETSSH/GETSSH_Force_Uninstaller.bat#L19-L27)

```batch
rmdir /s /q "%LocalAppData%\Programs\getssh"
```

若 `%LocalAppData%` 被恶意软件劫持为 `C:\Windows`，此命令将递归删除系统目录。

---

### 🟡 [M-14] PTY 进程继承完整 `process.env`

**文件**：[ptyHandler.ts:90](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/handlers/ptyHandler.ts#L90)

```typescript
env: process.env as Record<string, string>,
```

本地终端继承了 Electron 主进程的**完整环境变量**，包括可能包含的 API tokens、密钥等。应使用过滤后的 env 子集。

---

### 🟡 [M-15] `connection_history.json` 无 Schema 校验

**文件**：[sshHandler.ts:121-123](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/handlers/sshHandler.ts#L121-L123)

```typescript
history = JSON.parse(data);
```

外部篡改此文件可注入畸形数据，影响渲染进程中的日志展示。

---

### 🟢 [L-04] 生产环境 DevTools 菜单未禁用

**文件**：[index.ts:82](file:///Users/shenjiangchen/Documents/GETSSH/electron/main/index.ts#L82)

```typescript
{ role: 'toggleDevTools' },
```

macOS 菜单在生产打包后仍包含 `toggleDevTools`。用户可通过菜单打开 DevTools，直接在 Console 中执行任意 JS（访问 `electronAPI`、`localStorage` 等）。

---

## 统计汇总

| 严重级别 | 数量 | 漏洞编号 |
|---|---|---|
| 🔴 CRITICAL | 6 | C-01 ~ C-06 |
| 🟠 HIGH | 7 | H-01 ~ H-07 |
| 🟡 MEDIUM | 15 | M-01 ~ M-15 |
| 🟢 LOW | 4 | L-01 ~ L-04 |
| **合计** | **32** | |

---

## 修复优先级矩阵

| 优先级 | 漏洞 | 修复成本 | 原因 |
|---|---|---|---|
| **P0 (立即)** | C-01 (LFI) | ⬇️ 2 行 | 添加 `startsWith()` 校验 |
| **P0** | C-03 (safeStorageDecrypt 暴露) | ⬇️ 3 行 | 从 Plugin SDK 删除 |
| **P0** | C-04 (Windows 生物解锁绕过) | ⬇️ 5 行 | 增加 Windows 平台下的系统密码验证弹窗 |
| **P0** | C-05 (文件协议任意导航/CSP绕过) | ⬇️ 2 行 | 收紧 `will-navigate` 仅允许精确匹配的 `index.html` |
| **P0** | H-01 (XSS→RCE) | ⬇️ 5 行 | 从 preload 移除 `installPlugin` |
| **P1** | C-02 (插件无沙盒) | ⬆️ 架构级 | 迁移至 `vm` 沙盒或独立 Worker |
| **P1** | C-06 (SFTP OOM) | ⬆️ 中等 | 改为流式读写 |
| **P1** | H-03+H-04 (CSP+XSS) | ⬆️ 中等 | 收紧 CSP，移除 `unsafe-eval` |
| **P1** | H-05 (initScript 注入) | ⬇️ 5 行 | 加确认弹窗或用 safeStorage 加密 |
| **P1** | M-12 (SessionId 可预测) | ⬇️ 1 行 | 改用 `crypto.randomUUID()` |
| **P2** | H-02, H-06, H-07 | ⬇️~⬆️ | 条件性利用 |
| **P3** | 其余 MEDIUM/LOW | — | 时机合适时统一处理 |

> **P0 漏洞总计修复量不到 20 行代码，可立即消除最致命的攻击路径。**
