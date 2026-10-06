# 海洋守护中心运行详情验证

日期：2026-10-05。入口为「设置 → 海洋守护中心 → 运行详情」，在原设置工作台内替换总览正文，提供独立返回按钮。没有切换分支、提交、推送、打包或修改数据库结构。

## 页面与统计口径

- 顶部连续摘要显示今天、累计、本次运行的脱敏命中次数；下面分别展示 Watchdog 与 Sentinel 网关。深浅主题与窄分屏复用现有语义颜色、SettingsSection、SettingsRow 和面板容器断点。
- Watchdog 区分已连接、连接中、停用、不可用与未知，PID 来自实际存活子进程；最近监护信号是 PING 完成写入时间，协议没有确认收包的 PONG。
- 网关区分原生可逆脱敏、不可逆 JS 兜底与实际脱敏故障。脱敏故障拒绝原文发送，后续实际成功处理恢复状态；处理时间与失败时间只描述本次运行。
- 计数覆盖本机应用所有工作区的模型出口文本处理，每次实际替换计一次，同值重复出现仍分别计数。本地审计副本不重复计入；传输重试复用已处理文本，不重新累计。计数不等同于独立词条、攻击数量或成功发送的请求数量。
- 沿用已有最终出口处理范围：提示词、上下文、系统文本、历史文本、工具结果文本与工具参数字符串。图片、不透明内容、工具 schema 和模型鉴权配置没有因此增加过滤覆盖。
- 累计数字与本机日期写入现有加密主库的 global_settings。只存数字和日期，不保存原文、占位符、映射或匹配内容。今天按后端本机日期跨午夜重置，累计保留。该功能启用之前的历史不会补算。
- 数据未知显示「—」，确认过的零显示 `0`。数据库锁定、读取失败或写入失败明确标注「暂未保存」；已知的本次运行数字仍可显示。保存失败不会中断脱敏，也不会强行解锁或写明文文件。恢复可写后，后续处理或正常退出会补存；一直无法写到退出时，尚未保存的增量无法保留。
- 打开子页聚焦运行详情标题并回到页面顶部，返回后聚焦重新挂载的入口。页面每三秒读取一次状态，离开时清理定时器，父总览暂停重复轮询。读取状态不制造命中、处理时间或持久化写入。

## 隔离与验证

下面的 Vitest 使用临时 HOME / USERPROFILE，真实 Rust 脱敏模块与模拟数据库，未读取真实用户数据或系统钥匙串。Electron 使用独立 HOME / userData 与 mock keychain，真实原生脱敏及正常 IPC。测试模型服务只监听本机临时端口，无云请求、SSH 连接或真实模型凭据。

以下保留实际命令和未经编辑的输出。

### 界面类型检查

工作目录：`/Volumes/Developer/GETSSH/apps/getssh-client`

```sh
HOME=/private/tmp/getssh-runtime-validation-20261005/home USERPROFILE=/private/tmp/getssh-runtime-validation-20261005/home pnpm exec tsc -b tsconfig.json --force --pretty false
```

Exit 0。

stdout/stderr 为空。

### 界面回归

工作目录：`/Volumes/Developer/GETSSH/apps/getssh-client`

```sh
HOME=/private/tmp/getssh-runtime-validation-20261005/home USERPROFILE=/private/tmp/getssh-runtime-validation-20261005/home pnpm exec vitest run src/components/settings/tabs/OceanSentinelRuntime.spec.tsx src/store/sentinelRuntime.spec.ts src/components/sentinelStatusControls.spec.tsx src/components/securityOverview.spec.tsx src/components/buttonFeedback.spec.tsx src/components/homeDashboard.spec.tsx src/hooks/centerButtonRouting.spec.tsx src/hooks/centerRouting.spec.tsx
```

Exit 0。

```text

 RUN  v5.0.3 /Volumes/Developer/GETSSH/apps/getssh-client


 Test Files  8 passed (8)
      Tests  100 passed (100)
   Start at  18:59:07
   Duration  1.43s (environment 68%, tests 14%, import 9%, transform 9%)

```

### 构建

工作目录：`/Volumes/Developer/GETSSH/apps/getssh-client`

```sh
HOME=/private/tmp/getssh-runtime-validation-20261005/home USERPROFILE=/private/tmp/getssh-runtime-validation-20261005/home pnpm exec vite build
```

Exit 0。

```text
vite v8.3.1 building client environment for production...
transforming...
✓ 3285 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                  1.01 kB │ gzip:   0.53 kB
dist/assets/logo-CeTpd4WV.png                   91.40 kB
dist/assets/RedditSans-Regular-C2hOqIuV.ttf    173.01 kB
dist/assets/RedditSans-Bold-C_hX9DKg.ttf       173.61 kB
dist/assets/MiSans-Normal-COpVQ0ye.woff      5,451.72 kB
dist/assets/MiSans-Bold-DuKJIvpU.woff        5,462.11 kB
dist/assets/index-B-lHjH-G.css                 164.80 kB │ gzip:  25.14 kB
dist/assets/index-oDnNeWDQ.js                2,521.58 kB │ gzip: 777.21 kB

[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 2000 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 514ms
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
dist-electron/main/index.js                          696.97 kB │ gzip: 202.82 kB

✓ built in 69ms
vite v8.3.1 building client environment for production...
transforming...
✓ 2 modules transformed.
rendering chunks...
computing gzip size...
dist-electron/preload/index.js  12.95 kB │ gzip: 2.91 kB

✓ built in 4ms
```

### 文案检查

工作目录：`/Volumes/Developer/GETSSH`

```sh
node scripts/copy-lint.js --strict apps/getssh-client/src/components/settings/tabs/OceanSentinelRuntime.tsx apps/getssh-client/src/components/settings/tabs/SecurityTab.tsx apps/getssh-client/src/components/SettingsView.tsx
```

Exit 0。

```text
copy-lint：检查了 3 个文件
  apps/getssh-client/src/components/settings/tabs/OceanSentinelRuntime.tsx
  apps/getssh-client/src/components/settings/tabs/SecurityTab.tsx
  apps/getssh-client/src/components/SettingsView.tsx

== 夸张：几乎都该删（0 处）

== 机器腔：改成直接陈述（0 处）

== 看语境：是字面的技术描述就保留，并确认有出处（0 处）

== 按词汇总
```

### 真实 Rust 与主进程状态回归

工作目录：`/Volumes/Developer/GETSSH/apps/getssh-client`

```sh
HOME=/private/tmp/getssh-sentinel-runtime-20261005/home USERPROFILE=/private/tmp/getssh-sentinel-runtime-20261005/home pnpm exec vitest run electron/main/services/OceanSentinel.test.ts electron/main/security/SecureCenter.status.test.ts --environment node
```

Exit 0。

```text

 RUN  v5.0.3 /Volumes/Developer/GETSSH/apps/getssh-client


 Test Files  2 passed (2)
      Tests  53 passed (53)
   Start at  18:48:51
   Duration  176ms (tests 43%, transform 40%, import 14%, worker 2%)

```

### 最终出口独立回归

工作目录：`/Volumes/Developer/GETSSH/apps/getssh-client`

```sh
HOME=/private/tmp/getssh-sentinel-metrics-validation-20261005/home USERPROFILE=/private/tmp/getssh-sentinel-metrics-validation-20261005/home pnpm exec vitest run electron/main/services/ai/LlmGateway.metrics.test.ts --environment node
```

Exit 0。

```text

 RUN  v5.0.3 /Volumes/Developer/GETSSH/apps/getssh-client


 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  18:49:43
   Duration  158ms (tests 77%, transform 17%, import 5%, worker 2%)

```

### 原生脱敏单独检查

工作目录：`/Volumes/Developer/GETSSH/apps/getssh-client`

```sh
HOME=/private/tmp/getssh-sentinel-runtime-20261005/home USERPROFILE=/private/tmp/getssh-sentinel-runtime-20261005/home node scripts/security/sentinel-smoke.cjs
```

Exit 0。

```text
sentinel sanitization/rehydration smoke passed
```

## 临时副本的负向证明

所有故意破坏仅发生在临时源码副本，生产源码未突变。捕获了漏启用最终出口计数、本地审计重复计数、错误使用去重数量、将未知数据展示成零、跳过新增统计字段校验五种错误。

### 网关与原生计数变异

精确调用与源码散列：

```text
gateway-copy-control: None -> None
HOME=/private/tmp/getssh-sentinel-metrics-validation-20261005/gateway-source-f8qjacyv/home
USERPROFILE=/private/tmp/getssh-sentinel-metrics-validation-20261005/gateway-source-f8qjacyv/home
Cwd: /Volumes/Developer/GETSSH/apps/getssh-client
Command: ["/Volumes/Developer/GETSSH/apps/getssh-client/node_modules/.bin/vitest", "run", "electron/main/services/ai/LlmGateway.metrics.test.ts", "--config", "/private/tmp/getssh-sentinel-metrics-validation-20261005/gateway-source-f8qjacyv/vitest.config.mjs", "--environment", "node"]
Exit: 0

egress-not-counted: 'OceanSentinel.createSession({ recordMetrics: true })' -> 'OceanSentinel.createSession()'
HOME=/private/tmp/getssh-sentinel-metrics-validation-20261005/gateway-source-f8qjacyv/home
USERPROFILE=/private/tmp/getssh-sentinel-metrics-validation-20261005/gateway-source-f8qjacyv/home
Cwd: /Volumes/Developer/GETSSH/apps/getssh-client
Command: ["/Volumes/Developer/GETSSH/apps/getssh-client/node_modules/.bin/vitest", "run", "electron/main/services/ai/LlmGateway.metrics.test.ts", "--config", "/private/tmp/getssh-sentinel-metrics-validation-20261005/gateway-source-f8qjacyv/vitest.config.mjs", "--environment", "node"]
Exit: 1

Production and test SHA-256 unchanged: {"/Volumes/Developer/GETSSH/apps/getssh-client/electron/main/services/ai/LlmGateway.ts": "c212ab4bf6ef6d9e1abdd1c627e97261b4383fed8796d9792394ee9218f30d42", "/Volumes/Developer/GETSSH/apps/getssh-client/electron/main/services/ai/LlmGateway.metrics.test.ts": "aff3a55ac9d10e2429abc806879612a1ec3df268b790b9de657bb60f3334883e"}
Only a temporary copied LlmGateway source was loaded by Vite under its original module ID. Temporary source/config/HOME removed. No app, database, keychain, network, or production source mutations.
sanitizer-copy-control: None -> None
HOME=/private/tmp/getssh-sentinel-metrics-validation-20261005/sanitizer-source-qi_l8qaf/home
USERPROFILE=/private/tmp/getssh-sentinel-metrics-validation-20261005/sanitizer-source-qi_l8qaf/home
Cwd: /Volumes/Developer/GETSSH/apps/getssh-client
Command: ["/Volumes/Developer/GETSSH/apps/getssh-client/node_modules/.bin/vitest", "run", "electron/main/services/ai/LlmGateway.metrics.test.ts", "--config", "/private/tmp/getssh-sentinel-metrics-validation-20261005/sanitizer-source-qi_l8qaf/vitest.config.mjs", "--environment", "node"]
Exit: 0

audit-double-counted: 'static sanitize(text: string, recordMetrics = false)' -> 'static sanitize(text: string, recordMetrics = true)'
HOME=/private/tmp/getssh-sentinel-metrics-validation-20261005/sanitizer-source-qi_l8qaf/home
USERPROFILE=/private/tmp/getssh-sentinel-metrics-validation-20261005/sanitizer-source-qi_l8qaf/home
Cwd: /Volumes/Developer/GETSSH/apps/getssh-client
Command: ["/Volumes/Developer/GETSSH/apps/getssh-client/node_modules/.bin/vitest", "run", "electron/main/services/ai/LlmGateway.metrics.test.ts", "--config", "/private/tmp/getssh-sentinel-metrics-validation-20261005/sanitizer-source-qi_l8qaf/vitest.config.mjs", "--environment", "node"]
Exit: 1

native-counts-unique-not-occurrences: 'Object.keys(result.mappingDict).length' -> 'new Set(Object.values(result.mappingDict)).size'
HOME=/private/tmp/getssh-sentinel-metrics-validation-20261005/sanitizer-source-qi_l8qaf/home
USERPROFILE=/private/tmp/getssh-sentinel-metrics-validation-20261005/sanitizer-source-qi_l8qaf/home
Cwd: /Volumes/Developer/GETSSH/apps/getssh-client
Command: ["/Volumes/Developer/GETSSH/apps/getssh-client/node_modules/.bin/vitest", "run", "electron/main/services/ai/LlmGateway.metrics.test.ts", "--config", "/private/tmp/getssh-sentinel-metrics-validation-20261005/sanitizer-source-qi_l8qaf/vitest.config.mjs", "--environment", "node"]
Exit: 1

Production and test SHA-256 unchanged: {"/Volumes/Developer/GETSSH/apps/getssh-client/electron/main/services/OceanSentinel.ts": "3a6afbe6db2bb70d9a06e39122a09d468664c03c94450e731cf9dc5dc164dc3e", "/Volumes/Developer/GETSSH/apps/getssh-client/electron/main/services/ai/LlmGateway.metrics.test.ts": "aff3a55ac9d10e2429abc806879612a1ec3df268b790b9de657bb60f3334883e"}
Only a temporary copied OceanSentinel source was loaded by Vite under its original module ID. Temporary source/config/HOME removed. No app, database, keychain, network, or production source mutations.
```

原始负向输出：`egress-not-counted.txt`

```text

 RUN  v5.0.3 /Volumes/Developer/GETSSH/apps/getssh-client

 ❯ electron/main/services/ai/LlmGateway.metrics.test.ts (4 tests | 3 failed) 63ms
   ❯ LlmGateway redaction metrics at the real egress boundary (4)
     × counts repeated replacements across all supported segments, excluding the local audit pass 58ms
     × reuses the prepared request on transport retry without recounting its replacements 2ms
     × keeps redaction active when numeric counter persistence fails 1ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  electron/main/services/ai/LlmGateway.metrics.test.ts > LlmGateway redaction metrics at the real egress boundary > counts repeated replacements across all supported segments, excluding the local audit pass
AssertionError: expected { Object (runtimeHits, todayHits, ...) } to match object { Object (runtimeHits, todayHits, ...) }
(5 matching properties omitted from actual)

- Expected
+ Received

  {
-   "runtimeHits": 10,
-   "todayHits": 10,
-   "totalHits": 10,
+   "runtimeHits": 0,
+   "todayHits": 0,
+   "totalHits": 0,
  }

 ❯ electron/main/services/ai/LlmGateway.metrics.test.ts:86:52
     84|     expect(content).toContain('[IP_999]');
     85|     expect(sent.apiKey).toBe(request.apiKey);
     86|     expect(OceanSentinel.getRuntimeStatus().stats).toMatchObject({ run…
       |                                                    ^
     87|     const persisted = [...storage.rows.values()].join('');
     88|     expect(persisted).not.toMatch(/10\.2\.3\.|verysecret123|fixture-pr…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯

 FAIL  electron/main/services/ai/LlmGateway.metrics.test.ts > LlmGateway redaction metrics at the real egress boundary > reuses the prepared request on transport retry without recounting its replacements
AssertionError: expected { Object (runtimeHits, todayHits, ...) } to match object { runtimeHits: 2, todayHits: 2, …(1) }
(5 matching properties omitted from actual)

- Expected
+ Received

  {
-   "runtimeHits": 2,
-   "todayHits": 2,
-   "totalHits": 2,
+   "runtimeHits": 0,
+   "todayHits": 0,
+   "totalHits": 0,
  }

 ❯ electron/main/services/ai/LlmGateway.metrics.test.ts:101:52
     99|     expect(streamTurn).toHaveBeenCalledTimes(2);
    100|     expect(streamTurn.mock.calls[1][0]).toBe(streamTurn.mock.calls[0][…
    101|     expect(OceanSentinel.getRuntimeStatus().stats).toMatchObject({ run…
       |                                                    ^
    102|   });
    103|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/3]⎯

 FAIL  electron/main/services/ai/LlmGateway.metrics.test.ts > LlmGateway redaction metrics at the real egress boundary > keeps redaction active when numeric counter persistence fails
AssertionError: expected { …(2) } to match object { …(2) }
(6 matching properties omitted from actual)

- Expected
+ Received

@@ -2,9 +2,9 @@
    "gateway": {
      "mode": "native",
      "state": "ready",
    },
    "stats": {
-     "persistence": "unavailable",
-     "runtimeHits": 1,
+     "persistence": "available",
+     "runtimeHits": 0,
    },
  }

 ❯ electron/main/services/ai/LlmGateway.metrics.test.ts:119:46
    117|     expect(streamTurn).toHaveBeenCalledTimes(1);
    118|     expect(streamTurn.mock.calls[0][0].prompt).not.toContain('10.8.7.6…
    119|     expect(OceanSentinel.getRuntimeStatus()).toMatchObject({
       |                                              ^
    120|       gateway: { mode: 'native', state: 'ready' }, stats: { runtimeHit…
    121|     });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/3]⎯


 Test Files  1 failed (1)
      Tests  3 failed | 1 passed (4)
   Start at  18:47:53
   Duration  134ms (tests 77%, transform 16%, import 5%, worker 1%)

```

原始负向输出：`audit-double-counted.txt`

```text

 RUN  v5.0.3 /Volumes/Developer/GETSSH/apps/getssh-client

 ❯ electron/main/services/ai/LlmGateway.metrics.test.ts (4 tests | 1 failed) 64ms
   ❯ LlmGateway redaction metrics at the real egress boundary (4)
     × counts repeated replacements across all supported segments, excluding the local audit pass 59ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  electron/main/services/ai/LlmGateway.metrics.test.ts > LlmGateway redaction metrics at the real egress boundary > counts repeated replacements across all supported segments, excluding the local audit pass
AssertionError: expected 3 to be +0 // Object.is equality

- Expected
+ Received

- 0
+ 3

 ❯ electron/main/services/ai/LlmGateway.metrics.test.ts:77:64
     75|     OceanSentinel.sanitize(request.prompt!);
     76|     OceanSentinel.sanitize(request.context!);
     77|     expect(OceanSentinel.getRuntimeStatus().stats.runtimeHits).toBe(0);
       |                                                                ^
     78|
     79|     await gateway.streamTurn('fixture', request, {});

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 3 passed (4)
   Start at  18:48:52
   Duration  129ms (tests 77%, transform 16%, import 6%, worker 2%)

```

原始负向输出：`native-counts-unique-not-occurrences.txt`

```text

 RUN  v5.0.3 /Volumes/Developer/GETSSH/apps/getssh-client

 ❯ electron/main/services/ai/LlmGateway.metrics.test.ts (4 tests | 2 failed) 62ms
   ❯ LlmGateway redaction metrics at the real egress boundary (4)
     × counts repeated replacements across all supported segments, excluding the local audit pass 58ms
     × reuses the prepared request on transport retry without recounting its replacements 2ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  electron/main/services/ai/LlmGateway.metrics.test.ts > LlmGateway redaction metrics at the real egress boundary > counts repeated replacements across all supported segments, excluding the local audit pass
AssertionError: expected { runtimeHits: 9, todayHits: 9, …(6) } to match object { Object (runtimeHits, todayHits, ...) }
(5 matching properties omitted from actual)

- Expected
+ Received

  {
-   "runtimeHits": 10,
-   "todayHits": 10,
-   "totalHits": 10,
+   "runtimeHits": 9,
+   "todayHits": 9,
+   "totalHits": 9,
  }

 ❯ electron/main/services/ai/LlmGateway.metrics.test.ts:86:52
     84|     expect(content).toContain('[IP_999]');
     85|     expect(sent.apiKey).toBe(request.apiKey);
     86|     expect(OceanSentinel.getRuntimeStatus().stats).toMatchObject({ run…
       |                                                    ^
     87|     const persisted = [...storage.rows.values()].join('');
     88|     expect(persisted).not.toMatch(/10\.2\.3\.|verysecret123|fixture-pr…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  electron/main/services/ai/LlmGateway.metrics.test.ts > LlmGateway redaction metrics at the real egress boundary > reuses the prepared request on transport retry without recounting its replacements
AssertionError: expected { runtimeHits: 1, todayHits: 1, …(6) } to match object { runtimeHits: 2, todayHits: 2, …(1) }
(5 matching properties omitted from actual)

- Expected
+ Received

  {
-   "runtimeHits": 2,
-   "todayHits": 2,
-   "totalHits": 2,
+   "runtimeHits": 1,
+   "todayHits": 1,
+   "totalHits": 1,
  }

 ❯ electron/main/services/ai/LlmGateway.metrics.test.ts:101:52
     99|     expect(streamTurn).toHaveBeenCalledTimes(2);
    100|     expect(streamTurn.mock.calls[1][0]).toBe(streamTurn.mock.calls[0][…
    101|     expect(OceanSentinel.getRuntimeStatus().stats).toMatchObject({ run…
       |                                                    ^
    102|   });
    103|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯


 Test Files  1 failed (1)
      Tests  2 failed | 2 passed (4)
   Start at  18:48:52
   Duration  129ms (tests 77%, transform 16%, import 6%, worker 1%)

```

### 界面未知计数变异与组件独立验证

以下为子 agent 的完整命令及原输出记录：

```text
# Ocean Sentinel runtime UI validation

Production files: apps/getssh-client/src/components/settings/tabs/OceanSentinelRuntime.tsx and OceanSentinelRuntime.spec.tsx

All commands executed in the current dirty checkout; no Git commit or checkout changes. HOME and USERPROFILE were temporary for tests. The negative proof used only a private temporary mirror and never mutated production.

## Positive component regression run

cwd: /Volumes/Developer/GETSSH/apps/getssh-client

Command:
runtime_test_home=$(mktemp -d /private/tmp/getssh-runtime-ui-home.XXXXXX)
env HOME="$runtime_test_home" USERPROFILE="$runtime_test_home" pnpm exec vitest run src/components/settings/tabs/OceanSentinelRuntime.spec.tsx --reporter=verbose

Exit code: 0

Raw output:

 RUN  v5.0.3 /Volumes/Developer/GETSSH/apps/getssh-client

 ✓ src/components/settings/tabs/OceanSentinelRuntime.spec.tsx > Ocean Sentinel runtime details > shows native supervision, actual zeroes, PIDs and count scope without inventing heartbeats 32ms
 ✓ src/components/settings/tabs/OceanSentinelRuntime.spec.tsx > Ocean Sentinel runtime details > distinguishes irreversible fallback from a fault that refused unsanitized text 5ms
 ✓ src/components/settings/tabs/OceanSentinelRuntime.spec.tsx > Ocean Sentinel runtime details > keeps unknown optional details distinct from zero and treats a zero PING timestamp as no record 4ms
 ✓ src/components/settings/tabs/OceanSentinelRuntime.spec.tsx > Ocean Sentinel runtime details > does not turn a persistence failure into saved zeroes while retaining runtime counts 4ms
 ✓ src/components/settings/tabs/OceanSentinelRuntime.spec.tsx > Ocean Sentinel runtime details > retains known pending counts with an unsaved notice when persistence is unavailable 3ms
 ✓ src/components/settings/tabs/OceanSentinelRuntime.spec.tsx > Ocean Sentinel runtime details > reveals the page header when opened from a scrolled security overview 3ms
 ✓ src/components/settings/tabs/OceanSentinelRuntime.spec.tsx > Ocean Sentinel runtime details > shows busy and completed feedback for a manual refresh, without moving focus 7ms
 ✓ src/components/settings/tabs/OceanSentinelRuntime.spec.tsx > Ocean Sentinel runtime details > reports failed reads and never renders previous status as fresh data 6ms
 ✓ src/components/settings/tabs/OceanSentinelRuntime.spec.tsx > Ocean Sentinel runtime details > polls every three seconds and releases the timer on leaving the detail page 3ms
 ✓ src/components/settings/tabs/OceanSentinelRuntime.spec.tsx > Ocean Sentinel runtime details > keeps the same status distinctions and actions in Chinese 4ms

 Test Files  1 passed (1)
      Tests  10 passed (10)
   Start at  18:58:18
   Duration  737ms (environment 72%, import 11%, tests 11%, transform 6%)



## Final TypeScript build

cwd: /Volumes/Developer/GETSSH/apps/getssh-client

Command:
pnpm exec tsc -b tsconfig.json --force --pretty false

Exit code: 0

Raw output:
(no output)


## Copy check

cwd: /Volumes/Developer/GETSSH

Command:
node scripts/copy-lint.js --strict apps/getssh-client/src/components/settings/tabs/OceanSentinelRuntime.tsx

Exit code: 0

Raw output:
copy-lint：检查了 1 个文件
  apps/getssh-client/src/components/settings/tabs/OceanSentinelRuntime.tsx

== 夸张：几乎都该删（0 处）

== 机器腔：改成直接陈述（0 处）

== 看语境：是字面的技术描述就保留，并确认有出处（0 处）

== 按词汇总


## Whitespace check

cwd: /Volumes/Developer/GETSSH

Command:
git diff --check -- apps/getssh-client/src/components/settings/tabs/OceanSentinelRuntime.tsx apps/getssh-client/src/components/settings/tabs/OceanSentinelRuntime.spec.tsx

Exit code: 0

Raw output:
(no output)


## Negative proof on temporary mirror

cwd: /Volumes/Developer/GETSSH/apps/getssh-client

Command:
Temporary mirror: /private/tmp/getssh-runtime-mutant.1S1OVQ
Copied only the component and its test, preserving imports with symlinks to actual dependencies/store/types/SettingsControls. Changed only the count helper fallback in the temporary component:
? value.toLocaleString(i18n.language) : '—';
->
? value.toLocaleString(i18n.language) : '0';

runtime_mutant_dir=/private/tmp/getssh-runtime-mutant.1S1OVQ
env HOME="$runtime_mutant_dir/home" USERPROFILE="$runtime_mutant_dir/home" pnpm exec vitest run "$runtime_mutant_dir/src/components/settings/tabs/OceanSentinelRuntime.spec.tsx" --root "$runtime_mutant_dir" --reporter=verbose -t 'keeps unknown optional details distinct from zero'

Exit code: 1 (expected non-zero: assertion proved sensitive to unknown-count regression)

Raw output:
Temporary mirror: /private/tmp/getssh-runtime-mutant.1S1OVQ
Mutation: unknown/null count displays 0 instead of —; production unchanged.

 RUN  v5.0.3 /private/tmp/getssh-runtime-mutant.1S1OVQ

 ↓ src/components/settings/tabs/OceanSentinelRuntime.spec.tsx > Ocean Sentinel runtime details > shows native supervision, actual zeroes, PIDs and count scope without inventing heartbeats
 ↓ src/components/settings/tabs/OceanSentinelRuntime.spec.tsx > Ocean Sentinel runtime details > distinguishes irreversible fallback from a fault that refused unsanitized text
 × src/components/settings/tabs/OceanSentinelRuntime.spec.tsx > Ocean Sentinel runtime details > keeps unknown optional details distinct from zero and treats a zero PING timestamp as no record 22ms
   → expected '0' to be '—' // Object.is equality
 ↓ src/components/settings/tabs/OceanSentinelRuntime.spec.tsx > Ocean Sentinel runtime details > does not turn a persistence failure into saved zeroes while retaining runtime counts
 ↓ src/components/settings/tabs/OceanSentinelRuntime.spec.tsx > Ocean Sentinel runtime details > retains known pending counts with an unsaved notice when persistence is unavailable
 ↓ src/components/settings/tabs/OceanSentinelRuntime.spec.tsx > Ocean Sentinel runtime details > reveals the page header when opened from a scrolled security overview
 ↓ src/components/settings/tabs/OceanSentinelRuntime.spec.tsx > Ocean Sentinel runtime details > shows busy and completed feedback for a manual refresh, without moving focus
 ↓ src/components/settings/tabs/OceanSentinelRuntime.spec.tsx > Ocean Sentinel runtime details > reports failed reads and never renders previous status as fresh data
 ↓ src/components/settings/tabs/OceanSentinelRuntime.spec.tsx > Ocean Sentinel runtime details > polls every three seconds and releases the timer on leaving the detail page
 ↓ src/components/settings/tabs/OceanSentinelRuntime.spec.tsx > Ocean Sentinel runtime details > keeps the same status distinctions and actions in Chinese

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/components/settings/tabs/OceanSentinelRuntime.spec.tsx > Ocean Sentinel runtime details > keeps unknown optional details distinct from zero and treats a zero PING timestamp as no record
AssertionError: expected '0' to be '—' // Object.is equality

Expected: "—"
Received: "0"

 ❯ src/components/settings/tabs/OceanSentinelRuntime.spec.tsx:95:41
     93|     expect(text('runtime-supervisor-pid')).toBe('—');
     94|     expect(text('runtime-last-ping')).toBe('No record yet');
     95|     expect(text('sentinel-today-hits')).toBe('—');
       |                                         ^
     96|     expect(text('sentinel-total-hits')).toBe('—');
     97|     expect(text('sentinel-runtime-hits')).toBe('—');

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 9 skipped (10)
   Start at  18:59:14
   Duration  423ms (environment 66%, import 18%, transform 10%, tests 6%)



```

### Renderer 统计元数据校验变异

临时副本将 `stats !== undefined` 的校验条件改为 `false && stats !== undefined`。移除该临时变异后与生产源码逐字一致。测试捕获九个 AssertionError，不是导入或编译失败。

```text
HOME=/private/tmp/getssh-runtime-validation-20261005/home USERPROFILE=/private/tmp/getssh-runtime-validation-20261005/home pnpm exec vitest run src/store/sentinelRuntime.spec.ts --root /private/tmp/getssh-runtime-validation-20261005/store-mutation
Expected exit: 1
Only temporary appStore.ts changed stats validation to false. Production SHA256: 75b6f908b2795a7a893c8680d2a9e3da84a0d7b7b26f9ccf5888634dbc522715
```

```text

 RUN  v5.0.3 /private/tmp/getssh-runtime-validation-20261005/store-mutation

 ❯ src/store/sentinelRuntime.spec.ts (18 tests | 9 failed) 7ms
   ❯ Ocean Sentinel runtime metadata validation (18)
     × rejects malformed metadata and clears a stale healthy snapshot ({"stats":null}) 2ms
     × rejects malformed metadata and clears a stale healthy snapshot ({"stats":{"runtimeHits":-1,"todayHits":5,"totalHits":19,"persistence":"available","startedAt":1760000000000,"day":"2026-10-05","recordedSince":1750000000000,"lastFilteredAt":1760000000000}}) 0ms
     × rejects malformed metadata and clears a stale healthy snapshot ({"stats":{"runtimeHits":1.5,"todayHits":5,"totalHits":19,"persistence":"available","startedAt":1760000000000,"day":"2026-10-05","recordedSince":1750000000000,"lastFilteredAt":1760000000000}}) 0ms
     × rejects malformed metadata and clears a stale healthy snapshot ({"stats":{"runtimeHits":2,"todayHits":null,"totalHits":19,"persistence":"available","startedAt":1760000000000,"day":"2026-10-05","recordedSince":1750000000000,"lastFilteredAt":1760000000000}}) 0ms
     × rejects malformed metadata and clears a stale healthy snapshot ({"stats":{"runtimeHits":2,"todayHits":5,"totalHits":"19","persistence":"available","startedAt":1760000000000,"day":"2026-10-05","recordedSince":1750000000000,"lastFilteredAt":1760000000000}}) 0ms
     × rejects malformed metadata and clears a stale healthy snapshot ({"stats":{"runtimeHits":2,"todayHits":5,"totalHits":4,"persistence":"available","startedAt":1760000000000,"day":"2026-10-05","recordedSince":1750000000000,"lastFilteredAt":1760000000000}}) 0ms
     × rejects malformed metadata and clears a stale healthy snapshot ({"stats":{"runtimeHits":2,"todayHits":5,"totalHits":19,"persistence":"saved","startedAt":1760000000000,"day":"2026-10-05","recordedSince":1750000000000,"lastFilteredAt":1760000000000}}) 0ms
     × rejects malformed metadata and clears a stale healthy snapshot ({"stats":{"runtimeHits":2,"todayHits":5,"totalHits":19,"persistence":"available","startedAt":1760000000000,"day":"today","recordedSince":1750000000000,"lastFilteredAt":1760000000000}}) 0ms
     × rejects malformed metadata and clears a stale healthy snapshot ({"stats":{"runtimeHits":2,"todayHits":5,"totalHits":19,"persistence":"available","startedAt":1760000000000,"day":"2026-10-05","recordedSince":1750000000000,"lastFilteredAt":-1}}) 0ms

 Test Files  1 failed (1)
      Tests  9 failed | 9 passed (18)
   Start at  18:56:47
   Duration  599ms (environment 89%, transform 7%, import 2%, tests 1%)


⎯⎯⎯⎯⎯⎯⎯ Failed Tests 9 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/store/sentinelRuntime.spec.ts > Ocean Sentinel runtime metadata validation > rejects malformed metadata and clears a stale healthy snapshot ({"stats":null})
AssertionError: expected { status: 'secure', …(6) } to be null

- Expected:
null

+ Received:
{
  "daemonState": "running",
  "gateway": {
    "lastFailureAt": null,
    "lastSanitizedAt": 1760000000000,
    "mode": "native",
    "state": "ready",
  },
  "lastPing": 1760000000000,
  "stats": null,
  "status": "secure",
  "supervisedPid": 900,
  "supervisorPid": 901,
}

 ❯ src/store/sentinelRuntime.spec.ts:56:53
     54|   ])('rejects malformed metadata and clears a stale healthy snapshot (…
     55|     useAppStore.setState({ sentinelStatus: runtime });
     56|     expect(await receive({ ...runtime, ...patch })).toBeNull();
       |                                                     ^
     57|     expect(useAppStore.getState().sentinelStatus).toBeNull();
     58|     expect(useAppStore.getState().sentinelStatusError).toBe('Invalid O…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/9]⎯

 FAIL  src/store/sentinelRuntime.spec.ts > Ocean Sentinel runtime metadata validation > rejects malformed metadata and clears a stale healthy snapshot ({"stats":{"runtimeHits":-1,"todayHits":5,"totalHits":19,"persistence":"available","startedAt":1760000000000,"day":"2026-10-05","recordedSince":1750000000000,"lastFilteredAt":1760000000000}})
AssertionError: expected { status: 'secure', …(6) } to be null

- Expected:
null

+ Received:
{
  "daemonState": "running",
  "gateway": {
    "lastFailureAt": null,
    "lastSanitizedAt": 1760000000000,
    "mode": "native",
    "state": "ready",
  },
  "lastPing": 1760000000000,
  "stats": {
    "day": "2026-10-05",
    "lastFilteredAt": 1760000000000,
    "persistence": "available",
    "recordedSince": 1750000000000,
    "runtimeHits": -1,
    "startedAt": 1760000000000,
    "todayHits": 5,
    "totalHits": 19,
  },
  "status": "secure",
  "supervisedPid": 900,
  "supervisorPid": 901,
}

 ❯ src/store/sentinelRuntime.spec.ts:56:53
     54|   ])('rejects malformed metadata and clears a stale healthy snapshot (…
     55|     useAppStore.setState({ sentinelStatus: runtime });
     56|     expect(await receive({ ...runtime, ...patch })).toBeNull();
       |                                                     ^
     57|     expect(useAppStore.getState().sentinelStatus).toBeNull();
     58|     expect(useAppStore.getState().sentinelStatusError).toBe('Invalid O…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/9]⎯

 FAIL  src/store/sentinelRuntime.spec.ts > Ocean Sentinel runtime metadata validation > rejects malformed metadata and clears a stale healthy snapshot ({"stats":{"runtimeHits":1.5,"todayHits":5,"totalHits":19,"persistence":"available","startedAt":1760000000000,"day":"2026-10-05","recordedSince":1750000000000,"lastFilteredAt":1760000000000}})
AssertionError: expected { status: 'secure', …(6) } to be null

- Expected:
null

+ Received:
{
  "daemonState": "running",
  "gateway": {
    "lastFailureAt": null,
    "lastSanitizedAt": 1760000000000,
    "mode": "native",
    "state": "ready",
  },
  "lastPing": 1760000000000,
  "stats": {
    "day": "2026-10-05",
    "lastFilteredAt": 1760000000000,
    "persistence": "available",
    "recordedSince": 1750000000000,
    "runtimeHits": 1.5,
    "startedAt": 1760000000000,
    "todayHits": 5,
    "totalHits": 19,
  },
  "status": "secure",
  "supervisedPid": 900,
  "supervisorPid": 901,
}

 ❯ src/store/sentinelRuntime.spec.ts:56:53
     54|   ])('rejects malformed metadata and clears a stale healthy snapshot (…
     55|     useAppStore.setState({ sentinelStatus: runtime });
     56|     expect(await receive({ ...runtime, ...patch })).toBeNull();
       |                                                     ^
     57|     expect(useAppStore.getState().sentinelStatus).toBeNull();
     58|     expect(useAppStore.getState().sentinelStatusError).toBe('Invalid O…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/9]⎯

 FAIL  src/store/sentinelRuntime.spec.ts > Ocean Sentinel runtime metadata validation > rejects malformed metadata and clears a stale healthy snapshot ({"stats":{"runtimeHits":2,"todayHits":null,"totalHits":19,"persistence":"available","startedAt":1760000000000,"day":"2026-10-05","recordedSince":1750000000000,"lastFilteredAt":1760000000000}})
AssertionError: expected { status: 'secure', …(6) } to be null

- Expected:
null

+ Received:
{
  "daemonState": "running",
  "gateway": {
    "lastFailureAt": null,
    "lastSanitizedAt": 1760000000000,
    "mode": "native",
    "state": "ready",
  },
  "lastPing": 1760000000000,
  "stats": {
    "day": "2026-10-05",
    "lastFilteredAt": 1760000000000,
    "persistence": "available",
    "recordedSince": 1750000000000,
    "runtimeHits": 2,
    "startedAt": 1760000000000,
    "todayHits": NaN,
    "totalHits": 19,
  },
  "status": "secure",
  "supervisedPid": 900,
  "supervisorPid": 901,
}

 ❯ src/store/sentinelRuntime.spec.ts:56:53
     54|   ])('rejects malformed metadata and clears a stale healthy snapshot (…
     55|     useAppStore.setState({ sentinelStatus: runtime });
     56|     expect(await receive({ ...runtime, ...patch })).toBeNull();
       |                                                     ^
     57|     expect(useAppStore.getState().sentinelStatus).toBeNull();
     58|     expect(useAppStore.getState().sentinelStatusError).toBe('Invalid O…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/9]⎯

 FAIL  src/store/sentinelRuntime.spec.ts > Ocean Sentinel runtime metadata validation > rejects malformed metadata and clears a stale healthy snapshot ({"stats":{"runtimeHits":2,"todayHits":5,"totalHits":"19","persistence":"available","startedAt":1760000000000,"day":"2026-10-05","recordedSince":1750000000000,"lastFilteredAt":1760000000000}})
AssertionError: expected { status: 'secure', …(6) } to be null

- Expected:
null

+ Received:
{
  "daemonState": "running",
  "gateway": {
    "lastFailureAt": null,
    "lastSanitizedAt": 1760000000000,
    "mode": "native",
    "state": "ready",
  },
  "lastPing": 1760000000000,
  "stats": {
    "day": "2026-10-05",
    "lastFilteredAt": 1760000000000,
    "persistence": "available",
    "recordedSince": 1750000000000,
    "runtimeHits": 2,
    "startedAt": 1760000000000,
    "todayHits": 5,
    "totalHits": "19",
  },
  "status": "secure",
  "supervisedPid": 900,
  "supervisorPid": 901,
}

 ❯ src/store/sentinelRuntime.spec.ts:56:53
     54|   ])('rejects malformed metadata and clears a stale healthy snapshot (…
     55|     useAppStore.setState({ sentinelStatus: runtime });
     56|     expect(await receive({ ...runtime, ...patch })).toBeNull();
       |                                                     ^
     57|     expect(useAppStore.getState().sentinelStatus).toBeNull();
     58|     expect(useAppStore.getState().sentinelStatusError).toBe('Invalid O…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/9]⎯

 FAIL  src/store/sentinelRuntime.spec.ts > Ocean Sentinel runtime metadata validation > rejects malformed metadata and clears a stale healthy snapshot ({"stats":{"runtimeHits":2,"todayHits":5,"totalHits":4,"persistence":"available","startedAt":1760000000000,"day":"2026-10-05","recordedSince":1750000000000,"lastFilteredAt":1760000000000}})
AssertionError: expected { status: 'secure', …(6) } to be null

- Expected:
null

+ Received:
{
  "daemonState": "running",
  "gateway": {
    "lastFailureAt": null,
    "lastSanitizedAt": 1760000000000,
    "mode": "native",
    "state": "ready",
  },
  "lastPing": 1760000000000,
  "stats": {
    "day": "2026-10-05",
    "lastFilteredAt": 1760000000000,
    "persistence": "available",
    "recordedSince": 1750000000000,
    "runtimeHits": 2,
    "startedAt": 1760000000000,
    "todayHits": 5,
    "totalHits": 4,
  },
  "status": "secure",
  "supervisedPid": 900,
  "supervisorPid": 901,
}

 ❯ src/store/sentinelRuntime.spec.ts:56:53
     54|   ])('rejects malformed metadata and clears a stale healthy snapshot (…
     55|     useAppStore.setState({ sentinelStatus: runtime });
     56|     expect(await receive({ ...runtime, ...patch })).toBeNull();
       |                                                     ^
     57|     expect(useAppStore.getState().sentinelStatus).toBeNull();
     58|     expect(useAppStore.getState().sentinelStatusError).toBe('Invalid O…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/9]⎯

 FAIL  src/store/sentinelRuntime.spec.ts > Ocean Sentinel runtime metadata validation > rejects malformed metadata and clears a stale healthy snapshot ({"stats":{"runtimeHits":2,"todayHits":5,"totalHits":19,"persistence":"saved","startedAt":1760000000000,"day":"2026-10-05","recordedSince":1750000000000,"lastFilteredAt":1760000000000}})
AssertionError: expected { status: 'secure', …(6) } to be null

- Expected:
null

+ Received:
{
  "daemonState": "running",
  "gateway": {
    "lastFailureAt": null,
    "lastSanitizedAt": 1760000000000,
    "mode": "native",
    "state": "ready",
  },
  "lastPing": 1760000000000,
  "stats": {
    "day": "2026-10-05",
    "lastFilteredAt": 1760000000000,
    "persistence": "saved",
    "recordedSince": 1750000000000,
    "runtimeHits": 2,
    "startedAt": 1760000000000,
    "todayHits": 5,
    "totalHits": 19,
  },
  "status": "secure",
  "supervisedPid": 900,
  "supervisorPid": 901,
}

 ❯ src/store/sentinelRuntime.spec.ts:56:53
     54|   ])('rejects malformed metadata and clears a stale healthy snapshot (…
     55|     useAppStore.setState({ sentinelStatus: runtime });
     56|     expect(await receive({ ...runtime, ...patch })).toBeNull();
       |                                                     ^
     57|     expect(useAppStore.getState().sentinelStatus).toBeNull();
     58|     expect(useAppStore.getState().sentinelStatusError).toBe('Invalid O…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[7/9]⎯

 FAIL  src/store/sentinelRuntime.spec.ts > Ocean Sentinel runtime metadata validation > rejects malformed metadata and clears a stale healthy snapshot ({"stats":{"runtimeHits":2,"todayHits":5,"totalHits":19,"persistence":"available","startedAt":1760000000000,"day":"today","recordedSince":1750000000000,"lastFilteredAt":1760000000000}})
AssertionError: expected { status: 'secure', …(6) } to be null

- Expected:
null

+ Received:
{
  "daemonState": "running",
  "gateway": {
    "lastFailureAt": null,
    "lastSanitizedAt": 1760000000000,
    "mode": "native",
    "state": "ready",
  },
  "lastPing": 1760000000000,
  "stats": {
    "day": "today",
    "lastFilteredAt": 1760000000000,
    "persistence": "available",
    "recordedSince": 1750000000000,
    "runtimeHits": 2,
    "startedAt": 1760000000000,
    "todayHits": 5,
    "totalHits": 19,
  },
  "status": "secure",
  "supervisedPid": 900,
  "supervisorPid": 901,
}

 ❯ src/store/sentinelRuntime.spec.ts:56:53
     54|   ])('rejects malformed metadata and clears a stale healthy snapshot (…
     55|     useAppStore.setState({ sentinelStatus: runtime });
     56|     expect(await receive({ ...runtime, ...patch })).toBeNull();
       |                                                     ^
     57|     expect(useAppStore.getState().sentinelStatus).toBeNull();
     58|     expect(useAppStore.getState().sentinelStatusError).toBe('Invalid O…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[8/9]⎯

 FAIL  src/store/sentinelRuntime.spec.ts > Ocean Sentinel runtime metadata validation > rejects malformed metadata and clears a stale healthy snapshot ({"stats":{"runtimeHits":2,"todayHits":5,"totalHits":19,"persistence":"available","startedAt":1760000000000,"day":"2026-10-05","recordedSince":1750000000000,"lastFilteredAt":-1}})
AssertionError: expected { status: 'secure', …(6) } to be null

- Expected:
null

+ Received:
{
  "daemonState": "running",
  "gateway": {
    "lastFailureAt": null,
    "lastSanitizedAt": 1760000000000,
    "mode": "native",
    "state": "ready",
  },
  "lastPing": 1760000000000,
  "stats": {
    "day": "2026-10-05",
    "lastFilteredAt": -1,
    "persistence": "available",
    "recordedSince": 1750000000000,
    "runtimeHits": 2,
    "startedAt": 1760000000000,
    "todayHits": 5,
    "totalHits": 19,
  },
  "status": "secure",
  "supervisedPid": 900,
  "supervisorPid": 901,
}

 ❯ src/store/sentinelRuntime.spec.ts:56:53
     54|   ])('rejects malformed metadata and clears a stale healthy snapshot (…
     55|     useAppStore.setState({ sentinelStatus: runtime });
     56|     expect(await receive({ ...runtime, ...patch })).toBeNull();
       |                                                     ^
     57|     expect(useAppStore.getState().sentinelStatus).toBeNull();
     58|     expect(useAppStore.getState().sentinelStatusError).toBe('Invalid O…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[9/9]⎯

```

## 真实 Electron、模型出口与进程重启

真实主库持久化通过：同一隔离 HOME / userData 内，实际进程重启后本次运行次数为 0，今天与累计为 2，记录起始时间不变。计数来自真实权限 IPC → LlmGateway → Rust 脱敏 → 本机模型测试服务，两个相同地址按两次替换计数，服务收到的文本没有原地址。

测试工具在 `app.quit()` 后等待调试器断开超过 10 秒，随后对自己的隔离进程调用 `app.exit(0)`。因此本次 GUI 证明实际重启后的持久数据恢复，未宣称 GUI 证明正常退出补存；正常退出补存与不修改处理时间已经由独立后端回归验证。

命令记录（原文）：

```text
# Ocean Sentinel real Electron runtime validation

Working directory: `/Volumes/Developer/GETSSH/apps/getssh-client`.

Final run (outside filesystem/network sandbox because localhost binding returned EPERM inside it):

```sh
node scripts/ocean-sentinel-runtime-smoke.cjs > /private/tmp/getssh-runtime-validation-20261005/electron-runtime-complete.txt 2>&1
```

Exit code: 0. The log is unedited.

The script creates its own `HOME`, `USERPROFILE`, Electron `home` and `userData` before loading GETSSH and uses `--use-mock-keychain`, `--user-data-dir`, and `GETSSH_FAKE_STORE=1`. App-wide numeric statistics use the real native keystore and SQLCipher main database in that temporary home. No real owner home, credentials, SSH connections or remote model calls were used.

The ephemeral model server binds IPv4 `127.0.0.1` only. The actual Ollama adapter uses its OpenAI-compatible SSE `/v1/chat/completions` endpoint. The real privileged AI IPC sends synthetic text `UI test 10.8.7.6 10.8.7.6`, with stream listener installed before invocation. Exactly one model request was received. Wire content contains two native session placeholders and no original IP. Two actual replacement occurrences are counted; local audit and refresh do not increment counters.

UI checks use actual Settings UI preference controls, native Tidal split/drag, real status IPC, and keyboard entry/return activation. Four screenshots under `/Volumes/Developer/GETSSH/docs/screenshots/` contain real counts from that synthetic test:

- `ocean-sentinel-runtime-zh-dark.png`
- `ocean-sentinel-runtime-zh-light.png`
- `ocean-sentinel-runtime-zh-split.png` (246px security main content)
- `ocean-sentinel-runtime-en-dark.png`

Limitation: deferred `app.quit()` did not finish within 10 seconds under the Playwright inspector. The second process emitted `Waiting for the debugger to disconnect...`. The script explicitly logs this limitation, uses `app.exit(0)` only on its disposable application, and verifies a real same-home process restart with run=0, today=2 and total=2. This runtime check does not establish graceful-shutdown pending-counter flush. Existing isolated backend unit tests cover that hook.

Earlier raw attempts remain preserved: `electron-runtime.txt` (sandbox EPERM before launch), `electron-runtime-escalated.txt` (first Playwright close waiting), and `electron-runtime-final.txt` (direct app.quit waiting). Production exit mechanisms were not modified. Final script has bounded normal-exit waiting and explicit fallback cleanup.

Cleanup checks:

```sh
/bin/ps -p 97877,97882,97898,97903 -o pid=,ppid=,stat=,comm=
```

Exit 1 with no rows: both disposable Electron processes and their supervisors were gone. `cleanup.txt` separately records that the temporary home and sockets did not remain. Only this script, its uniquely named screenshots, and temporary logs were written during this runtime task.
```

完整原输出：

```text
ISOLATION: HOME=/var/folders/x3/6jlqp2j16f9dmm7t6w9dmlfm0000gn/T/getssh-ocean-runtime-hpdLzv; userData=/var/folders/x3/6jlqp2j16f9dmm7t6w9dmlfm0000gn/T/getssh-ocean-runtime-hpdLzv/userData; main PID=97877; own watchdog PID=97882
PASS: real supervisor/native gateway, initial zero counts, keyboard entry heading focus and return entry focus.
PASS: real privileged AI IPC/local Ollama SSE, redacted wire body, two repeated replacements counted twice; audit/status refresh add zero.
REAL STATUS: {"status":"secure","lastPing":1791219960715,"sentinelDisabled":false,"daemonState":"running","supervisorPid":97882,"supervisedPid":97877,"gateway":{"mode":"native","state":"ready","lastSanitizedAt":1791219961332,"lastFailureAt":null},"stats":{"runtimeHits":2,"todayHits":2,"totalHits":2,"persistence":"available","startedAt":1791219959375,"day":"2026-10-05","lastFilteredAt":1791219961332,"recordedSince":1791219959375}}
SCREENSHOT: /Volumes/Developer/GETSSH/docs/screenshots/ocean-sentinel-runtime-zh-dark.png (real counts from a synthetic localhost UI test)
SCREENSHOT: /Volumes/Developer/GETSSH/docs/screenshots/ocean-sentinel-runtime-zh-light.png (real counts from a synthetic localhost UI test)
PASS: actual narrow split settings content 246px.
SCREENSHOT: /Volumes/Developer/GETSSH/docs/screenshots/ocean-sentinel-runtime-zh-split.png (real counts from a synthetic localhost UI test)
SCREENSHOT: /Volumes/Developer/GETSSH/docs/screenshots/ocean-sentinel-runtime-en-dark.png (real counts from a synthetic localhost UI test)
LIMITATION: isolated Electron PID 97877 did not exit within 10s after app.quit(); using app.exit(0) for restart. This does not prove graceful-shutdown flush. []
ISOLATION: HOME=/var/folders/x3/6jlqp2j16f9dmm7t6w9dmlfm0000gn/T/getssh-ocean-runtime-hpdLzv; userData=/var/folders/x3/6jlqp2j16f9dmm7t6w9dmlfm0000gn/T/getssh-ocean-runtime-hpdLzv/userData; main PID=97898; own watchdog PID=97903
PASS: real process restart after app.exit using the same isolated HOME/userData resets run count to zero and retains stored totals ({"run":0,"today":2,"total":2}).
Ocean Sentinel runtime smoke passed: real native metrics, durable counters, watchdog PID, themes/languages, narrow split and keyboard focus; no renderer/IPC errors.
LIMITATION: isolated Electron PID 97898 did not exit within 10s after app.quit(); using app.exit(0) for restart. This does not prove graceful-shutdown flush. ["Waiting for the debugger to disconnect..."]
```

## 截图

截图是隔离 Electron 的实际页面，`2` 为合成测试文本的真实脱敏次数。主 agent 已检查宽窗深浅主题、中英文及真实 246px 窄分屏；没有编造运行状态或统计值。

- [中文深色](screenshots/ocean-sentinel-runtime-zh-dark.png)
- [中文浅色](screenshots/ocean-sentinel-runtime-zh-light.png)
- [中文窄分屏](screenshots/ocean-sentinel-runtime-zh-split.png)
- [英文深色](screenshots/ocean-sentinel-runtime-en-dark.png)
