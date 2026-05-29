# GETSSH RASP & Secure Center 安全规范 v2.0

> 本文件是 RASP（运行时程序自我保护）与 Secure Center（安全中心）的权威设计规范。
> 所有相关的代码实现、UI 展示、Watchdog 行为必须严格遵循此文档。

---

## 一、安全等级体系 (Threat Level System)

系统采用三级警戒模型，等级由高到低分别为：

```
🔴 RED   → 核心级威胁（最高）
🟡 YELLOW → 高危行为预警（中级）
🟢 GREEN  → 系统健康（正常）
```

---

## 二、等级定义 (Level Definitions)

### 🟢 GREEN — 系统安全 (Secure)

**定义：**  
系统各项安全检查均通过。Watchdog 与主进程的心跳通信正常，内核 API 完整未被篡改，无任何插件越权行为。

**触发条件：**
- Watchdog 持续接收到 `PING` 心跳，通信未中断
- 内核 API Hook 检查（`connect` / `open` 等）未发现异常
- 无任何插件触发 RASP 拦截

**状态标识：**
- `lockdown_mode = false`
- `is_yellow = false`
- `isPolluted = false`

---

### 🟡 YELLOW — 高危行为预警 (Warning)

**定义：**  
某个插件尝试执行了系统级高危操作（指令注入、越权读写、执行危险指令等），但主进程本身仍处于健康状态，核心内存完整性未被破坏。Watchdog 仅作为通知方，**不介入强杀**。

**触发条件（任一）：**
- 插件通过 `ctx.ssh.write` 尝试注入高危指令（如 `rm -rf`、`dd if=`、`mkfs`、`chmod 777 /`、`>/etc/passwd` 等）
- 插件通过 `ctx.storage` 尝试越权写入超出配额的数据（QuotaExceededError）
- 插件尝试调用未申请权限的 API 命名空间
- 插件尝试在沙箱外执行 `require('child_process')` 或访问受限模块

**触发来源：**  
由 Node.js 主进程的 `SecureCenter.triggerLockdown(reason, 'yellow')` 主动发出。

**IPC 消息格式：**
```
Node → Watchdog:  LOCKDOWN_TRIGGER:YELLOW:<reason>
Watchdog → Node:  LOCKDOWN_TRIGGER:YELLOW:<reason>  (转发给前端)
```

**Watchdog 行为：**
- 进入 `lockdown_mode`，开始向前端派送 TICK 倒计时
- 倒计时结束后：**仅等待用户决策，不执行 kill_process**
- 接受 `ACTION:CONTINUE` → 解除 lockdown，恢复正常运行
- 接受 `ACTION:DEACTIVATE-PLUGIN` → 解除 lockdown，恢复正常运行
- 接受 `ACTION:IGNORE` → 进入 sleep_mode（不杀进程，不再监控）

---

### 🔴 RED — 核心级威胁 (Critical)

**定义：**  
系统检测到核心内存被篡改、内核 API 被 Hook 劫持，或主进程心跳完全丢失（疑似进程卡死或被注入）。这是系统被攻陷的最高级别信号。Watchdog 将在用户决策超时后**强制物理终止主进程**。

**触发条件（任一）：**
- Watchdog 内存扫描线程检测到 `connect` 或 `open` 等内核 API 地址对应的字节码已被篡改（`MEMORY_HOOKED_CONNECT` / `MEMORY_HOOKED_OPEN`）
- Watchdog 连续 5 秒未收到任何 `PING` 心跳，判定进程失活（Heartbeat Timeout）
- 日后扩展：Node.js 主进程主动检测到 VM 沙盒逃逸

**触发来源：**
- Watchdog 内部内存扫描线程直接发出（`LOCKDOWN_TRIGGER:RED:...`）
- Node.js 主进程通过 `SecureCenter.triggerLockdown(reason, 'red')` 触发

**IPC 消息格式：**
```
Watchdog 内部 → Watchdog 主线程: LOCKDOWN_TRIGGER:RED:<reason>
Watchdog → Node:                  LOCKDOWN_TRIGGER:RED:<reason>
Node → Watchdog:                  LOCKDOWN_TRIGGER:RED:<reason>  (主进程主动上报时)
```

**Watchdog 行为：**
- 进入 `lockdown_mode` + `is_yellow = false`
- 向前端派送 TICK 倒计时（60 秒）
- 接受 `ACTION:RESTART-SAFE` → 解除倒计时，优雅重启
- 接受 `ACTION:SAVE-15S` → 将倒计时重置为 15 秒（最多 3 次）
- 接受 `ACTION:IGNORE` → 进入 sleep_mode（不杀进程，不再监控）
- **倒计时归零** → 调用 `kill_process(pid)`，强制终止主进程，退出 Watchdog

---

## 三、处理流程 (Handling Flow)

### 黄色预警流程

```
插件触发高危操作
      │
      ▼
SecureCenter.triggerLockdown(reason, 'yellow')
      │
      ▼
Node →[LOCKDOWN_TRIGGER:YELLOW:<reason>]→ Watchdog
      │
      ▼
Watchdog 进入 lockdown_mode（is_yellow = true）
      │
      ▼
Watchdog →[LOCKDOWN_TRIGGER:YELLOW:<reason>]→ Node IPC
      │
      ▼
前端接收事件，展示黄色预警面板（倒计时仅作提示，不强制）
      │
      ├──【关闭异常插件】→ pluginTeardownFn() → ACTION:CONTINUE → 正常运行
      ├──【继续执行】→ ACTION:CONTINUE → 正常运行
      └──【忽略警告】→ ACTION:IGNORE → sleep_mode（带污染状态）
```

### 红色警戒流程

```
内核 API 被 Hook / 心跳超时 / 主进程上报
            │
            ▼
  Watchdog 内部 or SecureCenter.triggerLockdown(reason, 'red')
            │
            ▼
  Watchdog 进入 lockdown_mode（is_yellow = false）
            │
            ▼
  前端接收事件，展示红色全屏封锁面板 + 60s 倒计时
            │
            ├──【立刻重启至安全模式】→ pluginTeardownFn() → ACTION:RESTART-SAFE
            ├──【抢救性存盘 (+15s)】→ ACTION:SAVE-15S（上限 3 次）
            └──【忽略风险并继续】→ ACTION:IGNORE → sleep_mode（带污染状态）
            │
            ▼（60s 超时无操作）
      kill_process(pid) → Watchdog exit(1)
```

---

## 四、用户界面规范 (UI Specification)

### 4.1 安全中心主面板（Settings → Security）

| 系统状态 | 盾牌图标颜色 | 盾牌动画 | 标题文字 | 横幅背景色 |
|---------|------------|---------|---------|----------|
| 🟢 GREEN  | 绿色 `#22c55e` | 缓慢脉冲 | 系统安全，所有防御模块正常运行 | 绿色 |
| 🟡 YELLOW | 黄色 `#eab308` | 快速脉冲 | 插件高危操作已阻断，核心状态正常 | 黄色 |
| 🔴 RED    | 红色 `#ef4444` | 弹跳动画 | 系统已被污染，部分安全措施失效 | 红色 |

### 4.2 Command Center 顶部横幅

- 仅在 `isPolluted = true` 时展示
- 🟡 黄色污染：`⚠️ 插件高危操作已阻断 (警告)` + 具体原因
- 🔴 红色污染：`⚠️ 当前系统已被污染 (高危)` + 具体原因

### 4.3 安全覆盖层（SecurityOverlay — 全屏拦截面板）

#### 🟡 黄色预警面板

- **背景：** 深黄底色 (`bg-yellow-950/90`)
- **盾牌：** 黄色 `ShieldAlert`，缓慢脉冲
- **标题：** `GETSSH SECURE CENTER`
- **副标题：** `⚠️ 插件高危操作已阻断，系统运行在警告状态！`
- **原因框：** 显示具体拦截到的操作（如 `Plugin attempted to execute: rm -rf /*`）
- **倒计时：** 黄色数字（仅提示，不执行强杀）
- **操作按钮：**
  1. 🟡 **【关闭异常插件】**（主推，黄色主按钮）
  2. ⬜ **【继续执行】**（次级，透明按钮）
  3. 🔸 **【忽略警告】**（最小化，半透明文字按钮，不推荐）

#### 🔴 红色警戒面板

- **背景：** 深红底色 (`bg-red-950/90`)
- **盾牌：** 红色 `ShieldAlert`，快速弹跳
- **标题：** `GETSSH SECURE CENTER`
- **副标题：** `⚠️ 内存完整性已被破坏，您的安全底线正面临重大风险！`
- **原因框：** 显示内核检测原因（如 `【核心内存异常】检测到内核 API 被劫持 (MEMORY_HOOKED_CONNECT)`）
- **倒计时：** 红色大号数字（真实倒计时，归零执行强杀）
- **操作按钮：**
  1. 🔴 **【立刻重启至安全模式】**（主推，红色主按钮）
  2. ⬜ **【抢救性存盘 (解锁 15 秒)】**（次级，最多 3 次）
  3. 🔸 **【忽略风险并继续】**（最小化，半透明文字按钮，需身份验证）

---

## 五、IPC 消息协议总览

| 方向 | 消息格式 | 含义 |
|-----|---------|-----|
| Node → Watchdog | `PING\n` | 心跳保活 |
| Node → Watchdog | `LOCKDOWN_TRIGGER:YELLOW:<reason>\n` | 黄色预警上报 |
| Node → Watchdog | `LOCKDOWN_TRIGGER:RED:<reason>\n` | 红色警戒上报 |
| Node → Watchdog | `ACTION:RESTART-SAFE\n` | 用户选择重启 |
| Node → Watchdog | `ACTION:SAVE-15S\n` | 用户请求 +15 秒 |
| Node → Watchdog | `ACTION:IGNORE\n` | 用户忽略风险 |
| Node → Watchdog | `ACTION:CONTINUE\n` | 黄色：继续执行 |
| Node → Watchdog | `ACTION:DEACTIVATE-PLUGIN\n` | 黄色：吊销插件 |
| Watchdog → Node | `LOCKDOWN_TRIGGER:YELLOW:<reason>\n` | 转发 or 内部触发黄色 |
| Watchdog → Node | `LOCKDOWN_TRIGGER:RED:<reason>\n` | 转发 or 内部触发红色 |
| Watchdog → Node | `TICK:<seconds>\n` | 倒计时刷新 |
| Watchdog → Node | `RESOLVED\n` | 威胁已解除，恢复正常 |

---

## 六、代码模块职责分工

| 模块 | 文件 | 职责 |
|-----|-----|-----|
| RASP 拦截层 | `electron/main/services/PluginManager.ts` | 拦截高危 API 调用，调用 `SecureCenter.triggerLockdown` |
| 安全总线 | `electron/main/security/SecureCenter.ts` | 管理 Watchdog 生命周期，转发 RASP 事件，处理用户决策 |
| 物理看门狗 | `rust-core/watchdog/src/main.rs` | 心跳监控，内存完整性检查，进程强杀 |
| 安全覆盖层 | `src/components/SecurityOverlay.tsx` | 全屏拦截 UI，展示预警并接受用户操作 |
| 安全中心面板 | `src/components/SettingsView.tsx` | 安全状态摘要，历史日志 |
| 指挥中心横幅 | `src/components/CommandCenter.tsx` | 污染状态横幅提示 |
| 状态存储 | `src/store/appStore.ts` | `isPolluted`, `watchdogStatus` 全局状态 |

---

## 七、插件安全运行模式 (Plugin Security Modes)

插件安全运行模式是 RASP 的**前置控制层**，决定了插件加载时所处的沙箱等级。它与 RASP 威胁等级体系紧密耦合：**模式越宽松，被触发 RASP 拦截的概率越高；模式越严格，越多的操作在尝试之前就已被封锁。**

当前共有四种模式，通过后台配置 `pluginSecurityMode` 字段控制，可在 Settings → Security 中由用户切换。

---

### 🔒 Safe Mode（安全模式）

**适用场景：** 安全事件发生后的应急状态，或用户不信任任何第三方插件时。

**行为：**
- **所有** Node.js 后端插件一律跳过加载，不执行任何 `activate()`。
- UI Sandbox（纯渲染层）插件仍正常运行。
- RASP 拦截层处于启用状态但几乎不会被触发（因为没有后端代码在运行）。

**RASP 联动：**
- 发生 RED 级别威胁，用户点击【立刻重启至安全模式】时，系统自动将 `pluginSecurityMode` 写入 `safe`，并重启主进程。
- 重启后，所有插件后端被冻结，确保无任何插件代码运行。

**Secure Center 显示：** 盾牌绿色，附加徽章 `SAFE MODE`，安全状态文字更新为「插件运行已冻结，系统处于安全模式」。

---

### ⚠️ Strict Mode（严格模式）

**适用场景：** 运行高度不可信的第三方插件，或生产环境中对插件有零信任策略的场景。

**行为：**
- 插件在 **Node.js VM 沙箱**中运行（`vm.runInContext`）。
- `require()` 白名单仅允许：`path`、`os`。任何其他模块均被禁止。
- 插件尝试加载白名单外的模块时，**立即触发 YELLOW RASP**，并抛出 `SandboxViolation` 错误。
- 存储配额：默认 5MB（除非 manifest 声明 `storage:extended`/`storage:unlimited`）。

**RASP 联动：**
- 模块越权 → `LOCKDOWN_TRIGGER:YELLOW:Sandbox violation: Plugin '...' attempted to require restricted module '...' in Strict Mode.`
- 存储超发 → `LOCKDOWN_TRIGGER:YELLOW:Plugin '...' attempted to exceed its storage quota.`

---

### 🔧 Normal Mode（正常模式）⬅ 默认

**适用场景：** 日常使用的默认状态，兼顾安全与插件生态的可用性。

**行为：**
- 插件在 **Node.js VM 沙箱**中运行。
- `require()` 黑名单阻断危险模块：`fs`、`fs/promises`、`child_process`、`net`。其他 Node.js 内置模块（如 `crypto`、`path`、`os`、`url`）均允许。
- 插件尝试加载黑名单模块时，**立即触发 YELLOW RASP**。
- SSH 指令注入（如 `rm -rf /`）等高危操作同样触发 YELLOW RASP。
- 存储配额：默认 5MB。

**RASP 联动：**
- 模块越权 → `LOCKDOWN_TRIGGER:YELLOW:Sandbox violation: Plugin '...' attempted to require dangerous module '...' in Normal Mode.`
- 高危指令 → `LOCKDOWN_TRIGGER:YELLOW:Plugin attempted to execute high-risk command: ...`

---

### 🧪 Developer Mode（开发者模式）

**适用场景：** 插件开发者本地调试阶段，需要完整的 Node.js 运行时环境。

> [!CAUTION]
> **此模式会绕过 VM 沙箱，直接使用原生 `require()`。务必仅在信任本地代码时使用。**

**行为：**
- 插件**不在 VM 沙箱中运行**，而是通过原生 `require()` 直接加载。
- `fs`、`child_process`、`net` 等所有 Node.js 内置模块均可访问。
- **RASP 拦截层仍然运行**，SSH 指令过滤（`auditPluginCommand`）依然有效。
- 存储配额机制照常工作。
- 模块层面的沙箱违规检测**不会触发**（因为根本没有沙箱）。

**RASP 联动：**
- SSH 高危指令（如 `rm -rf /`）仍然触发 YELLOW RASP。
- 存储超发仍然触发 YELLOW RASP。
- **模块加载越权不触发 RASP**（开发者模式下视为信任）。

---

### 模式对比速查表

| 能力 | 🔒 Safe | ⚠️ Strict | 🔧 Normal | 🧪 Developer |
|-----|:-------:|:---------:|:---------:|:------------:|
| 加载后端插件 | ❌ | ✅ | ✅ | ✅ |
| VM 沙箱隔离 | N/A | ✅ | ✅ | ❌ |
| `require('path')` | N/A | ✅ | ✅ | ✅ |
| `require('crypto')` | N/A | ❌ → 🟡RASP | ✅ | ✅ |
| `require('fs')` | N/A | ❌ → 🟡RASP | ❌ → 🟡RASP | ✅ |
| `require('child_process')` | N/A | ❌ → 🟡RASP | ❌ → 🟡RASP | ✅ |
| SSH 高危指令过滤 | N/A | ✅ → 🟡RASP | ✅ → 🟡RASP | ✅ → 🟡RASP |
| 存储配额执行 | N/A | ✅ → 🟡RASP | ✅ → 🟡RASP | ✅ → 🟡RASP |
| 内存扫描 / 心跳监控 | ✅ → 🔴RASP | ✅ → 🔴RASP | ✅ → 🔴RASP | ✅ → 🔴RASP |

---

### 模式切换规则

1. **用户可在 Settings → Security 面板中随时切换模式**，修改立即写入配置，需**重启后生效**。
2. **RED 级别威胁发生后**，用户选择【立刻重启至安全模式】时，系统将强制覆写为 `safe` 并重启，绕过用户上次设定。
3. **Developer Mode 切换时**，需在 UI 中展示高危警告弹窗，要求用户二次确认。

---

> **版本：** 2.1  
> **最后更新：** 2026-05-28  
> **状态：** ✅ 权威规范，请按照此文档进行实现
