# Ocean Sentinel 状态检查与名称验证

日期：2026-10-04。工作区：`/Volumes/Developer/GETSSH`，分支：`v3-next`。

## 修复结果

英文名称统一为 **Ocean Sentinel**，中文为 **海洋守护中心**。设置分类与标题、状态栏、Command Center 告警和安全警报页使用同一名称。内部设置分类 `Security`、兼容翻译键和 IPC 名保持可用。

原「重新检查」按钮读取同一份主进程快照，没有加载/完成反馈，错误仅进入控制台。现在称为「刷新状态」：等待时显示「正在刷新…」并禁用重复点击，成功后显示更新时间，失败时显示可重试的错误，清除陈旧的正常状态。自动轮询与手动刷新共享正在进行的请求。

旧后端只根据 `isPolluted` 决定 secure/warning，守护进程退出或 IPC 断连后仍可能为 secure。现在核对实际子进程及 socket，并区分 running、starting、disabled、unavailable；退出、启动失败、断连或写入失败均不可报告正常。解除告警后不会重新呈现历史告警原因。退役 socket 的关闭、错误和延迟写入回调不会覆盖当前连接。

该状态覆盖本机进程监护的存活、连接和已有安全告警。现有 PING 为单向协议，`lastPing` 记录完成发送的时间，含义不是已确认的守护进程回执；读取状态也不再伪造新的 PING 时间。

## 验证

- 最终 86 项回归通过，其中新增前端状态交互 18 项、后端状态与生命周期 15 项。
- 强制 TypeScript 检查、Vite 构建、严格文案检查退出码为 0。文案输出仍有 locale 的既有机器腔/语境条目，夸张词为 0。
- 真实 macOS Electron：确认测试窗口自己的 supervisor PID 与父 PID 后，仅停止该测试子进程；原生接口和页面均变为 unavailable，页面没有继续显示 Healthy。
- 在隔离测试进程中注入待完成响应与 IPC 错误，验证刷新禁用、完成时间、清除旧正常状态及重试。英文深色、中文浅色模式的名称、详情焦点和反馈通过；中文截图已检查。
- 先前的中心导航、插件取消、快速连接和窗格错误反馈 UI 复测通过。
- 原生钥匙库迁移/重启/回滚检查通过；原生存储对比为 232 steps、0 differences。

Electron 测试显式隔离 native home、userData、HOME 和 USERPROFILE，使用假存储及模拟钥匙串。原生存储检查仅使用临时测试数据与允许的测试设备钥匙，没有操作日常数据或已有钥匙串条目。UI 未连接实际主机。没有运行 Windows UI 或打包验证。

## 测试有效性

仅在临时源码副本中做以下变异，生产源未被变异修改：

| 变异 | 捕获结果 |
|---|---|
| 取状态失败后保留旧 secure | 前端 9 项失败 |
| 去掉刷新按钮的等待禁用 | 前端 2 项失败 |
| 状态忽略 daemon 可用性 | 后端 11 项失败 |
| 读取时以 Date.now 伪造 lastPing | 后端 7 项失败 |
| 退役 socket 清掉当前连接 | 后端 1 项失败 |
| 解除告警后断连又显示历史原因 | 后端 1 项失败 |

前端原始日志：`/private/tmp/getssh-sentinel-stale-state-mutation.log`、`/private/tmp/getssh-sentinel-loading-mutation.log`；后端原始命令及日志：`/private/tmp/getssh-sentinel-status-validation-20261004/mutation-notes.txt` 与该目录的 `*-mutation.txt`。

## 命令与原始输出

以下输出未经改写；TypeScript 没有输出，退出码为 0。构建存在既有 chunk 体积提示。原始日志目录：`/private/tmp/getssh-ocean-status-validation-20261004`。

### TypeScript

目录：`apps/getssh-client`。

```sh
pnpm exec tsc -b tsconfig.json --force --pretty false
```

```text

```

### 回归检查

目录：`apps/getssh-client`。

```sh
env HOME=/private/tmp/getssh-ocean-status-validation-20261004/home USERPROFILE=/private/tmp/getssh-ocean-status-validation-20261004/home pnpm exec vitest run src/hooks/centerButtonRouting.spec.tsx src/hooks/centerRouting.spec.tsx src/components/buttonFeedback.spec.tsx src/components/paneAssetActions.spec.tsx src/components/centerControls.spec.tsx src/store/sessionStore.spec.ts src/utils/paneHelpers.spec.ts electron/main/renameIntegration.test.ts src/components/sentinelStatusControls.spec.tsx electron/main/security/SecureCenter.status.test.ts --environment node
```

```text

 RUN  v5.0.3 /Volumes/Developer/GETSSH/apps/getssh-client


 Test Files  10 passed (10)
      Tests  86 passed (86)
   Start at  02:10:02
   Duration  1.45s (environment 69%, import 13%, tests 10%, transform 8%)
```

### Vite 构建

目录：`apps/getssh-client`。

```sh
pnpm exec vite build
```

```text
vite v8.3.1 building client environment for production...
transforming...
✓ 3284 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                  1.01 kB │ gzip:   0.53 kB
dist/assets/logo-CeTpd4WV.png                   91.40 kB
dist/assets/RedditSans-Regular-C2hOqIuV.ttf    173.01 kB
dist/assets/RedditSans-Bold-C_hX9DKg.ttf       173.61 kB
dist/assets/MiSans-Normal-COpVQ0ye.woff      5,451.72 kB
dist/assets/MiSans-Bold-DuKJIvpU.woff        5,462.11 kB
dist/assets/index-Cjlv05L0.css                 158.73 kB │ gzip:  24.23 kB
dist/assets/index-Dji64D-i.js                2,496.50 kB │ gzip: 770.77 kB

[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 2000 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 1.07s
vite v8.3.1 building client environment for production...
transforming...
✓ 274 modules transformed.
rendering chunks...
computing gzip size...
dist-electron/main/package.json                        0.02 kB │ gzip:   0.04 kB
dist-electron/main/plugin-sandbox.js                   0.23 kB │ gzip:   0.20 kB
dist-electron/main/rolldown-runtime-CPUxUITh.js        1.23 kB │ gzip:   0.54 kB
dist-electron/main/pluginProtocol-De6cIvB7.js          2.93 kB │ gzip:   1.10 kB
dist-electron/main/plugin-host.js                      6.56 kB │ gzip:   2.53 kB
dist-electron/main/PluginProcessSandbox-BDNxY9ae.js    8.71 kB │ gzip:   3.27 kB
dist-electron/main/index.js                          694.82 kB │ gzip: 201.90 kB

✓ built in 82ms
vite v8.3.1 building client environment for production...
transforming...
✓ 2 modules transformed.
rendering chunks...
computing gzip size...
dist-electron/preload/index.js  12.95 kB │ gzip: 2.91 kB

✓ built in 16ms
```

### 文案检查

目录：`仓库根目录`。

```sh
node scripts/copy-lint.js --strict apps/getssh-client/src/components/settings/tabs/SecurityTab.tsx apps/getssh-client/src/components/SettingsView.tsx apps/getssh-client/src/components/StatusBar.tsx apps/getssh-client/src/components/CommandCenter.tsx apps/getssh-client/src/components/SecurityOverlay.tsx apps/getssh-client/src/locales/en-US.json apps/getssh-client/src/locales/zh-CN.json
```

```text
copy-lint：检查了 7 个文件
  apps/getssh-client/src/components/settings/tabs/SecurityTab.tsx
  apps/getssh-client/src/components/SettingsView.tsx
  apps/getssh-client/src/components/StatusBar.tsx
  apps/getssh-client/src/components/CommandCenter.tsx
  apps/getssh-client/src/components/SecurityOverlay.tsx
  apps/getssh-client/src/locales/en-US.json
  apps/getssh-client/src/locales/zh-CN.json

== 夸张：几乎都该删（0 处）

== 机器腔：改成直接陈述（4 处）
apps/getssh-client/src/locales/en-US.json:163:90  …mbined with 【robust】 PBKDF2 key…
apps/getssh-client/src/locales/en-US.json:479:47  …built upon 【robust】 open-source…
apps/getssh-client/src/locales/zh-CN.json:161:82  …解锁应用，提供开箱即用的【无缝】安全体验。",
apps/getssh-client/src/locales/zh-CN.json:663:41  …AI 将获得最高权限！它【不仅能读取屏幕内容，还】具有自我规划和在服务器后…

== 看语境：是字面的技术描述就保留，并确认有出处（6 处）
apps/getssh-client/src/locales/en-US.json:164:32  …sNetwork": "【Zero-copy】 Network",
apps/getssh-client/src/locales/en-US.json:165:80  …Rust N-API. 【Zero-copy】 buffering b…
apps/getssh-client/src/locales/en-US.json:308:95  …connection 【instantly】.",
apps/getssh-client/src/locales/zh-CN.json:194:32  …sNetwork": "【Zero-copy】 网络引擎",
apps/getssh-client/src/locales/zh-CN.json:195:67  …接管 I/O。通过本地【零拷贝】（Zero-copy）绕…
apps/getssh-client/src/locales/zh-CN.json:195:71  …I/O。通过本地零拷贝（【Zero-copy】）绕过 V8 堆内存，杜…

== 按词汇总
机器腔：改成直接陈述
  2 × robust：use a plain word, or drop it
  1 × 无缝：说清楚怎么衔接，例如断线后自动重连
  1 × 不仅……更……：只留后半句，或拆成两句
看语境：是字面的技术描述就保留，并确认有出处
  4 × zero-copy：only if the implementation really avoids copies
  1 × instantly：give a measured number, or drop it
  1 × 零拷贝：确认实现里真的没有拷贝
```

### 真实状态与按钮 UI

目录：`apps/getssh-client`。

```sh
env GETSSH_SMOKE_ARTIFACT_DIR=/private/tmp/getssh-ocean-status-validation-20261004 node scripts/ocean-sentinel-smoke.cjs
```

```text
PASS: real isolated supervisor exit is unavailable, never healthy.
PASS: pending refresh, visible IPC failure, stale healthy cleared and retry succeeds.
PASS: Chinese Ocean Sentinel navigation, detail focus and refresh feedback.
Ocean Sentinel UI smoke passed.
```

### 先前按钮修复复测

目录：`apps/getssh-client`。

```sh
node scripts/button-controls-smoke.cjs
```

```text
PASS: split/zoom → first AI center revealed → AI settings destination.
PASS: security detail visibility/focus, close, and View logs navigation.
PASS: OS folder failure reaches visible toast and button recovers.
PASS: plugin install error visible inside review, failed cleanup cannot trap Cancel.
PASS: new quick addresses applied, repeated quick draft reset, ordinary draft preserved.
PASS: resolved pane-action refusal produces visible feedback.
Button controls UI smoke passed.
```

### 原生钥匙库

目录：`apps/getssh-client`。

```sh
env HOME=/private/tmp/getssh-ocean-status-validation-20261004/home USERPROFILE=/private/tmp/getssh-ocean-status-validation-20261004/home node scripts/security/keystore-e2e/run.mjs
```

```text
[legacy] OK legacy layout written
[migrate] OK migrated {"migratedWorkspaces":["default","secret"],"deferredWorkspaces":["lost"],"presenceToReenable":["secret"],"failedWorkspaces":[]}
[restart-plain] OK restart without master password ok
[set-master] OK master password set
[restart-master] OK master password lock/unlock ok
[remove-master] OK master password removed
[restart-after-removal] OK restart after removing the master password ok
[fresh] OK fresh install ok
[asset-folders] OK asset folders respect workspace locks
[rollback-setup] OK legacy layout with a damaged workspace written
[damaged] OK a damaged workspace does not block the rest
[legacy] OK legacy layout written
[rollback-main] OK damaged main.db written
[rollback] OK a failed migration restored every file
```

### 原生存储

目录：`仓库根目录`。

```sh
env HOME=/private/tmp/getssh-ocean-status-validation-20261004/store-home USERPROFILE=/private/tmp/getssh-ocean-status-validation-20261004/store-home GETSSH_STORE_CONFORMANCE=1 node rust-core/getssh-store/store.conformance.mjs
```

```text
232 steps, 0 differences
```

## 加载修改

在仓库根目录重新启动开发进程：`pnpm run dev`。主进程需要重启才能加载新的状态判断。本次未提交、推送或打包。

