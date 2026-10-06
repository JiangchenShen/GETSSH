# GETSSH 主页 Dashboard 验证记录

日期：2026-10-05。按用户要求，在已有工作台设计中增加实际概览，采用连接主列与上下文右列。没有切换分支、提交、推送或打包。

## 完成的界面

- 顶部连续摘要显示已保存连接、打开终端面板、工作区数量；取消重复的模块编号，扩大内容宽度、缩短主机行。
- 左列保留快速连接、单一继续入口和最多四条已保存主机；右列增加当前工作区、海洋守护中心与终端概况。
- 守护异常或确认未设置访问密码时显示可操作提示；窄面板下摘要移到主列之后，支持深浅主题、中英文和键盘焦点。

## 数据边界

- 已保存连接复用 savedProfiles 排除草稿与临时快速连接，并排除无地址的非本地配置；未调用读取旧 profiles.json 的统计接口。
- 面板数只包含当前工作区、当前主窗口内的 terminal leaf，包含已断开面板；独立窗口与其他工作区被排除。sessionId 不充当在线证明。
- 密码保护使用 security.status 当前工作区 scope，区分独立密码、主密码继承、明确未设置与尚未确认；元数据失败不推断凭据未加密。切换工作区时丢弃旧请求响应。
- 监护正常要求 running、secure、未停用且没有读取错误；主页每 3 秒读取状态并在离开/锁定时清理定时器。没有把 PING 写入时间当成 PONG 或全应用安全结论。

## 截图

截图来自真实 macOS Electron 应用、隔离工作区。三个标有「UI 测试」的保存主机通过正常 IPC 存储与正常启动加载，仅为配置；未向它们发送 SSH 连接。唯一终端是真实本地 PTY。

- [中文深色，三条配置与本地终端](screenshots/home-dashboard-zh-live-terminal.png)
- [中文浅色，三条配置与本地终端](screenshots/home-dashboard-zh-live-terminal-light.png)
- [中文空工作区深色](screenshots/home-dashboard-zh-empty-dark.png)
- [中文空工作区浅色](screenshots/home-dashboard-zh-empty-light.png)
- [中文窄窗口](screenshots/home-dashboard-zh-narrow.png)
- [仅保存配置](screenshots/home-dashboard-zh-saved-hosts.png)
- [英文已打开终端](screenshots/home-dashboard-en-live-terminal.png)
- [英文窄窗口](screenshots/home-dashboard-en-narrow.png)
- [英文窄窗口下方上下文](screenshots/home-dashboard-en-narrow-context.png)

主 agent 已逐张检查主要深浅色、空状态和窄窗口上下文截图。宽窗口 1360×980、窄窗口 860×980；没有声称额外验证所有操作系统或 320px 极窄分屏。

## 编译与文案检查

以下命令在 apps/getssh-client 执行，除注明的根目录命令。输出未经编辑；空输出直接注明。

```sh
pnpm exec tsc -b tsconfig.json --force --pretty false
```

Exit 0；stdout/stderr 均为空。

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
dist/assets/index-hV2P85_z.css                 164.21 kB │ gzip:  25.05 kB
dist/assets/index-gOGm_pCK.js                2,511.64 kB │ gzip: 774.41 kB

[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 2000 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 416ms
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

✓ built in 59ms
vite v8.3.1 building client environment for production...
transforming...
✓ 2 modules transformed.
rendering chunks...
computing gzip size...
dist-electron/preload/index.js  12.95 kB │ gzip: 2.91 kB

✓ built in 4ms
```

Exit 0。构建仍提示主 renderer chunk 超过 2000 kB，本轮未改变分包策略。

根目录命令：
```sh
node scripts/copy-lint.js --strict apps/getssh-client/src/components/TidalDashboard.tsx apps/getssh-client/src/locales/en-US.json apps/getssh-client/src/locales/zh-CN.json
```

```text
copy-lint：检查了 3 个文件
  apps/getssh-client/src/components/TidalDashboard.tsx
  apps/getssh-client/src/locales/en-US.json
  apps/getssh-client/src/locales/zh-CN.json

== 夸张：几乎都该删（0 处）

== 机器腔：改成直接陈述（4 处）
apps/getssh-client/src/locales/en-US.json:163:90  …mbined with 【robust】 PBKDF2 key…
apps/getssh-client/src/locales/en-US.json:510:47  …built upon 【robust】 open-source…
apps/getssh-client/src/locales/zh-CN.json:161:82  …解锁应用，提供开箱即用的【无缝】安全体验。",
apps/getssh-client/src/locales/zh-CN.json:694:41  …AI 将获得最高权限！它【不仅能读取屏幕内容，还】具有自我规划和在服务器后…

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

Exit 0。四处机器腔提示及六处语境提示属于这次未改动的既有文案；新增主页文案没有这些命中。

## 单元与回归检查

所有测试使用临时 HOME/USERPROFILE。17 个主页断言覆盖临时配置过滤、工作区/窗口边界、断开面板、继续入口、保护继承/未知/异步切换、真实监护状态与快速连接事件。

```sh
env HOME=/private/tmp/getssh-home-dashboard-validation-20261005/home USERPROFILE=/private/tmp/getssh-home-dashboard-validation-20261005/home ./node_modules/.bin/vitest run src/components/homeDashboard.spec.tsx --environment node
```

```text

 RUN  v5.0.3 /Volumes/Developer/GETSSH/apps/getssh-client


 Test Files  1 passed (1)
      Tests  17 passed (17)
   Start at  13:47:34
   Duration  801ms (environment 61%, tests 20%, import 11%, transform 7%)

```

Exit 0。

```sh
HOME=/private/tmp/getssh-home-dashboard-validation-20261005/home USERPROFILE=/private/tmp/getssh-home-dashboard-validation-20261005/home pnpm exec vitest run src/hooks/centerButtonRouting.spec.tsx src/hooks/centerRouting.spec.tsx src/components/buttonFeedback.spec.tsx src/components/paneAssetActions.spec.tsx src/components/centerControls.spec.tsx src/store/sessionStore.spec.ts src/utils/paneHelpers.spec.ts electron/main/renameIntegration.test.ts src/components/sentinelStatusControls.spec.tsx electron/main/security/SecureCenter.status.test.ts src/components/securityOverview.spec.tsx src/components/homeDashboard.spec.tsx --environment node
```

```text

 RUN  v5.0.3 /Volumes/Developer/GETSSH/apps/getssh-client


 Test Files  12 passed (12)
      Tests  110 passed (110)
   Start at  13:49:26
   Duration  1.22s (environment 51%, tests 20%, import 18%, transform 11%)

```

Exit 0；12 个文件、110 个测试通过。

## 临时副本变异验证

在复制的源码上逐一退化八项数据 guard，确认断言能捕获对应错误；没有改写生产源码。基准副本 17 个断言通过，各变体均产生预期 AssertionError，而非编译或导入错误。执行脚本与日志保存在本次临时验证目录。

```sh
python3 /private/tmp/getssh-home-dashboard-validation-20261005/run-mutations.py
```

```text
control: None -> None
HOME=/private/tmp/getssh-home-dashboard-mutations-lzeg3d3v/home
USERPROFILE=/private/tmp/getssh-home-dashboard-mutations-lzeg3d3v/home
Cwd: /Volumes/Developer/GETSSH/apps/getssh-client
Command: ["/Volumes/Developer/GETSSH/apps/getssh-client/node_modules/.bin/vitest", "run", "src/components/homeDashboard.spec.tsx", "--config", "/private/tmp/getssh-home-dashboard-mutations-lzeg3d3v/vitest.config.mjs", "--environment", "node"]
Exit: 0

temporary-profiles: 'savedProfiles(sessions).filter(' -> 'sessions.filter('
HOME=/private/tmp/getssh-home-dashboard-mutations-lzeg3d3v/home
USERPROFILE=/private/tmp/getssh-home-dashboard-mutations-lzeg3d3v/home
Cwd: /Volumes/Developer/GETSSH/apps/getssh-client
Command: ["/Volumes/Developer/GETSSH/apps/getssh-client/node_modules/.bin/vitest", "run", "src/components/homeDashboard.spec.tsx", "--config", "/private/tmp/getssh-home-dashboard-mutations-lzeg3d3v/vitest.config.mjs", "--environment", "node"]
Exit: 1

foreign-workspace: 'const workspaceTabs = tabs.filter(tab => !tab.isTornOff && (tab.workspaceId ?? activeWorkspaceId) === activeWorkspaceId);' -> 'const workspaceTabs = tabs.filter(tab => !tab.isTornOff);'
HOME=/private/tmp/getssh-home-dashboard-mutations-lzeg3d3v/home
USERPROFILE=/private/tmp/getssh-home-dashboard-mutations-lzeg3d3v/home
Cwd: /Volumes/Developer/GETSSH/apps/getssh-client
Command: ["/Volumes/Developer/GETSSH/apps/getssh-client/node_modules/.bin/vitest", "run", "src/components/homeDashboard.spec.tsx", "--config", "/private/tmp/getssh-home-dashboard-mutations-lzeg3d3v/vitest.config.mjs", "--environment", "node"]
Exit: 1

torn-off-window: 'const workspaceTabs = tabs.filter(tab => !tab.isTornOff && (tab.workspaceId ?? activeWorkspaceId) === activeWorkspaceId);' -> 'const workspaceTabs = tabs.filter(tab => (tab.workspaceId ?? activeWorkspaceId) === activeWorkspaceId);'
HOME=/private/tmp/getssh-home-dashboard-mutations-lzeg3d3v/home
USERPROFILE=/private/tmp/getssh-home-dashboard-mutations-lzeg3d3v/home
Cwd: /Volumes/Developer/GETSSH/apps/getssh-client
Command: ["/Volumes/Developer/GETSSH/apps/getssh-client/node_modules/.bin/vitest", "run", "src/components/homeDashboard.spec.tsx", "--config", "/private/tmp/getssh-home-dashboard-mutations-lzeg3d3v/vitest.config.mjs", "--environment", "node"]
Exit: 1

session-id-as-online: 'const panes = workspaceTabs.flatMap(tab => tab.paneTree ? terminalPanes(tab.paneTree) : []);' -> 'const panes = workspaceTabs.flatMap(tab => tab.paneTree ? terminalPanes(tab.paneTree) : []).filter(pane => !!pane.sessionId && !pane.isDisconnected);'
HOME=/private/tmp/getssh-home-dashboard-mutations-lzeg3d3v/home
USERPROFILE=/private/tmp/getssh-home-dashboard-mutations-lzeg3d3v/home
Cwd: /Volumes/Developer/GETSSH/apps/getssh-client
Command: ["/Volumes/Developer/GETSSH/apps/getssh-client/node_modules/.bin/vitest", "run", "src/components/homeDashboard.spec.tsx", "--config", "/private/tmp/getssh-home-dashboard-mutations-lzeg3d3v/vitest.config.mjs", "--environment", "node"]
Exit: 1

legacy-protection: "const protectionLabel = !scope ? 'unconfirmed' : !scope.protected ? 'passwordNotSet'" -> "const protectionLabel = workspaceUnprotected ? 'passwordNotSet' : !scope ? 'unconfirmed' : !scope.protected ? 'passwordNotSet'"
HOME=/private/tmp/getssh-home-dashboard-mutations-lzeg3d3v/home
USERPROFILE=/private/tmp/getssh-home-dashboard-mutations-lzeg3d3v/home
Cwd: /Volumes/Developer/GETSSH/apps/getssh-client
Command: ["/Volumes/Developer/GETSSH/apps/getssh-client/node_modules/.bin/vitest", "run", "src/components/homeDashboard.spec.tsx", "--config", "/private/tmp/getssh-home-dashboard-mutations-lzeg3d3v/vitest.config.mjs", "--environment", "node"]
Exit: 1

late-workspace-response: 'if (!disposed) setProtectionMetadata({ workspaceId: activeWorkspaceId, status });' -> 'setProtectionMetadata({ workspaceId: activeWorkspaceId, status });'
HOME=/private/tmp/getssh-home-dashboard-mutations-lzeg3d3v/home
USERPROFILE=/private/tmp/getssh-home-dashboard-mutations-lzeg3d3v/home
Cwd: /Volumes/Developer/GETSSH/apps/getssh-client
Command: ["/Volumes/Developer/GETSSH/apps/getssh-client/node_modules/.bin/vitest", "run", "src/components/homeDashboard.spec.tsx", "--config", "/private/tmp/getssh-home-dashboard-mutations-lzeg3d3v/vitest.config.mjs", "--environment", "node"]
Exit: 1

assumed-supervisor-healthy: "const supervisorHealthy = sentinelStatus?.daemonState === 'running' && sentinelStatus.status === 'secure'\n    && !sentinelStatus.sentinelDisabled && !sentinelStatusError;" -> "const supervisorHealthy = sentinelStatus?.status === 'secure' && !sentinelStatusError;"
HOME=/private/tmp/getssh-home-dashboard-mutations-lzeg3d3v/home
USERPROFILE=/private/tmp/getssh-home-dashboard-mutations-lzeg3d3v/home
Cwd: /Volumes/Developer/GETSSH/apps/getssh-client
Command: ["/Volumes/Developer/GETSSH/apps/getssh-client/node_modules/.bin/vitest", "run", "src/components/homeDashboard.spec.tsx", "--config", "/private/tmp/getssh-home-dashboard-mutations-lzeg3d3v/vitest.config.mjs", "--environment", "node"]
Exit: 1

stale-supervisor-error: '&& !sentinelStatus.sentinelDisabled && !sentinelStatusError;' -> '&& !sentinelStatus.sentinelDisabled;'
HOME=/private/tmp/getssh-home-dashboard-mutations-lzeg3d3v/home
USERPROFILE=/private/tmp/getssh-home-dashboard-mutations-lzeg3d3v/home
Cwd: /Volumes/Developer/GETSSH/apps/getssh-client
Command: ["/Volumes/Developer/GETSSH/apps/getssh-client/node_modules/.bin/vitest", "run", "src/components/homeDashboard.spec.tsx", "--config", "/private/tmp/getssh-home-dashboard-mutations-lzeg3d3v/vitest.config.mjs", "--environment", "node"]
Exit: 1

Production TidalDashboard SHA-256 before and after: 1e15923dc7da172f46f7864e26a04e991401cfa73c396938c2c8f9004b6eb366
Production source was never modified. The Vite pre-load plugin read only a copied source file while preserving original module IDs and real component imports/mocks. Temporary source/config/HOME directories were removed after checks.
```

基准副本原始测试输出：
```text

 RUN  v5.0.3 /Volumes/Developer/GETSSH/apps/getssh-client


 Test Files  1 passed (1)
      Tests  17 passed (17)
   Start at  13:49:09
   Duration  455ms (environment 45%, tests 31%, import 14%, transform 9%)

```


## 真实 Electron 操作检查

脚本在加载 main 之前设置 native home 和 userData，使用 --use-mock-keychain；真实本地 shell 使用临时 HOME 且不读取用户启动脚本。进程退出后清理隔离目录。

检查快速连接解析/取消、真实配置计数、真实本地 PTY、Home→Continue 保留相同 sessionId 并执行第二条标记命令、工作区/海洋守护中心跳转、实际设置控件切换主题/语言、英文窄窗口下方入口可见，以及 renderer/IPC 错误。

```sh
node scripts/home-dashboard-smoke.cjs
```

```text
SCREENSHOT: /Volumes/Developer/GETSSH/docs/screenshots/home-dashboard-zh-empty-dark.png
SCREENSHOT: /Volumes/Developer/GETSSH/docs/screenshots/home-dashboard-zh-empty-light.png
SCREENSHOT: /Volumes/Developer/GETSSH/docs/screenshots/home-dashboard-zh-narrow.png
PASS: empty workspace truthful zero counts, Chinese dark/light and narrow window without horizontal overflow.
PASS: real Quick Connect opens parsed host/user/port configuration; Cancel leaves no saved profile or network session.
SCREENSHOT: /Volumes/Developer/GETSSH/docs/screenshots/home-dashboard-zh-saved-hosts.png
PASS: three clearly marked test profiles loaded by real IPC and normal app boot; no SSH connection is attempted.
SCREENSHOT: /Volumes/Developer/GETSSH/docs/screenshots/home-dashboard-zh-live-terminal.png
PASS: one real local PTY counted, Home preserves its backend session, Continue returns to the same session and executes a second marker.
SCREENSHOT: /Volumes/Developer/GETSSH/docs/screenshots/home-dashboard-zh-live-terminal-light.png
PASS: Home workspace and security actions reach their actual pages without closing the local session; no SSH hosts were contacted.
SCREENSHOT: /Volumes/Developer/GETSSH/docs/screenshots/home-dashboard-en-live-terminal.png
SCREENSHOT: /Volumes/Developer/GETSSH/docs/screenshots/home-dashboard-en-narrow.png
SCREENSHOT: /Volumes/Developer/GETSSH/docs/screenshots/home-dashboard-en-narrow-context.png
PASS: actual settings theme/language controls preserve the live PTY; filled Chinese light and English wide/narrow layouts remain readable without horizontal overflow.
Home dashboard smoke passed: isolated data, real counts and test profile IPC, Chinese empty/filled dark/light/narrow screenshots, Quick Connect, live local terminal Home/Continue preservation, workspace/security routing, no renderer or IPC errors.
```

Exit 0。

## 改动文件

- apps/getssh-client/src/components/TidalDashboard.tsx
- apps/getssh-client/src/index.css（主页样式区域）
- apps/getssh-client/src/locales/en-US.json、zh-CN.json（主页文案）
- apps/getssh-client/src/components/homeDashboard.spec.tsx
- apps/getssh-client/scripts/home-dashboard-smoke.cjs
- docs/GETSSH_UI_DESIGN_SYSTEM.md（同步主页内容约定）
- 本验证记录与上列截图。

git diff --check：Exit 0，输出为空。此前重命名、分屏、按钮修复、海洋守护中心与侧栏材质的改动均保留。

## 2026-10-05 补充：恢复全部时段问候语

用户反馈主页只显示少量固定问候。中英文原文均完整保留：七个时段、每段四条；重命名前当前分支的 NexusDashboard 已固定取每组第一句，上一轮 Dashboard 保留了这一逻辑。

本次只把选择逻辑改为组件挂载时生成一个固定随机值，按当前时段数组长度选句。每次重新打开主页可重新选择；停留期间不会因为时钟或监护状态刷新而重抽；跨时段、切换语言会使用对应数组。未修改任何问候语原文。

本地时间分段为 00–04 午夜、05–08 早晨、09–11 上午、12–13 中午、14–17 下午、18–21 傍晚、22–23 深夜。

新增三个行为检查覆盖中英文四条问候都可被选中、七时段的十四个边界、时钟更新、普通重新渲染、语言切换和离开后重新打开。原主页数据边界测试一起通过，共 20 项。

```sh
HOME=/private/tmp/getssh-greeting-validation-20261005/home USERPROFILE=/private/tmp/getssh-greeting-validation-20261005/home pnpm exec vitest run src/components/homeDashboard.spec.tsx --environment node
```
```text

 RUN  v5.0.3 /Volumes/Developer/GETSSH/apps/getssh-client


 Test Files  1 passed (1)
      Tests  20 passed (20)
   Start at  18:18:13
   Duration  1.00s (environment 62%, tests 24%, import 8%, transform 5%)

```
Exit 0。

```sh
pnpm exec tsc -b tsconfig.json --force --pretty false
```
Exit 0；stdout/stderr 均为空。

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
dist/assets/index-hV2P85_z.css                 164.21 kB │ gzip:  25.05 kB
dist/assets/index-CjTnCx0F.js                2,511.70 kB │ gzip: 774.43 kB

[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 2000 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 511ms
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

✓ built in 67ms
vite v8.3.1 building client environment for production...
transforming...
✓ 2 modules transformed.
rendering chunks...
computing gzip size...
dist-electron/preload/index.js  12.95 kB │ gzip: 2.91 kB

✓ built in 5ms
```
Exit 0；保留原有 renderer chunk 大小提示。

根目录文案检查：
```sh
node scripts/copy-lint.js --strict apps/getssh-client/src/components/TidalDashboard.tsx
```
```text
copy-lint：检查了 1 个文件
  apps/getssh-client/src/components/TidalDashboard.tsx

== 夸张：几乎都该删（0 处）

== 机器腔：改成直接陈述（0 处）

== 看语境：是字面的技术描述就保留，并确认有出处（0 处）

== 按词汇总
```
Exit 0；三类命中均为 0。git diff --check 同样 Exit 0，输出为空。

### 问候语回归的临时副本验证

对照副本 20/20 通过；恢复固定第一句使三个问候行为检查失败；改成每次 render 重新抽句使稳定性检查失败。全部为预期断言失败，不是导入或构建失败。以下保存执行入口、精确内部命令与三个原始输出，生产及测试源码未突变。

```sh
python3 /private/tmp/getssh-greeting-validation-20261005/run-mutations.py
```

mutation-notes.txt：

```text
control: None -> None
HOME=/private/tmp/getssh-greeting-validation-20261005/source-fyeuoj0z/home
USERPROFILE=/private/tmp/getssh-greeting-validation-20261005/source-fyeuoj0z/home
Cwd: /Volumes/Developer/GETSSH/apps/getssh-client
Command: ["/Volumes/Developer/GETSSH/apps/getssh-client/node_modules/.bin/vitest", "run", "src/components/homeDashboard.spec.tsx", "--config", "/private/tmp/getssh-greeting-validation-20261005/source-fyeuoj0z/vitest.config.mjs", "--environment", "node"]
Exit: 0

always-first: 'greetingValue[Math.floor(greetingChoice * greetingValue.length)]' -> 'greetingValue[0]'
HOME=/private/tmp/getssh-greeting-validation-20261005/source-fyeuoj0z/home
USERPROFILE=/private/tmp/getssh-greeting-validation-20261005/source-fyeuoj0z/home
Cwd: /Volumes/Developer/GETSSH/apps/getssh-client
Command: ["/Volumes/Developer/GETSSH/apps/getssh-client/node_modules/.bin/vitest", "run", "src/components/homeDashboard.spec.tsx", "--config", "/private/tmp/getssh-greeting-validation-20261005/source-fyeuoj0z/vitest.config.mjs", "--environment", "node"]
Exit: 1

random-every-render: 'greetingValue[Math.floor(greetingChoice * greetingValue.length)]' -> 'greetingValue[Math.floor(Math.random() * greetingValue.length)]'
HOME=/private/tmp/getssh-greeting-validation-20261005/source-fyeuoj0z/home
USERPROFILE=/private/tmp/getssh-greeting-validation-20261005/source-fyeuoj0z/home
Cwd: /Volumes/Developer/GETSSH/apps/getssh-client
Command: ["/Volumes/Developer/GETSSH/apps/getssh-client/node_modules/.bin/vitest", "run", "src/components/homeDashboard.spec.tsx", "--config", "/private/tmp/getssh-greeting-validation-20261005/source-fyeuoj0z/vitest.config.mjs", "--environment", "node"]
Exit: 1

Production and test SHA-256 unchanged: {"/Volumes/Developer/GETSSH/apps/getssh-client/src/components/TidalDashboard.tsx": "d05c9d444a6e8dd54eacc0eadad2721a6c30ebe9af81a93b7dcb840ad7018fa9", "/Volumes/Developer/GETSSH/apps/getssh-client/src/components/homeDashboard.spec.tsx": "f128e1668ab01801c2fbaad3b8feece14d4d43e431b7321fde5ead4e39c49d66"}
Production/test files were never modified. Only a temporary copied TidalDashboard source was loaded by the Vite pre-load plugin using the original module ID. Temporary copied source/config/HOME were removed. No other guards or GUI were run.
```

control.txt：

```text

 RUN  v5.0.3 /Volumes/Developer/GETSSH/apps/getssh-client


 Test Files  1 passed (1)
      Tests  20 passed (20)
   Start at  18:19:09
   Duration  552ms (environment 39%, tests 39%, import 12%, transform 9%)

```

always-first.txt：

```text

 RUN  v5.0.3 /Volumes/Developer/GETSSH/apps/getssh-client

 ❯ src/components/homeDashboard.spec.tsx (20 tests | 3 failed) 166ms
   ❯ time-based home greetings (3)
     × keeps all four existing phrases available in both languages 42ms
     × uses the correct local-time group across every period boundary 8ms
     × keeps the selection through refreshes and language changes, and chooses again on a new visit 6ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/components/homeDashboard.spec.tsx > time-based home greetings > keeps all four existing phrases available in both languages
AssertionError: expected 'Good morning! Stay focused.' to be 'The day is young and full of possibil…' // Object.is equality

Expected: "The day is young and full of possibilities. Code on!"
Received: "Good morning! Stay focused."

 ❯ src/components/homeDashboard.spec.tsx:122:72
    120|         random.mockReturnValue((index + 0.5) / greetings.length);
    121|         await render();
    122|         expect(container.querySelector('.home-greeting')?.textContent)…
       |                                                                        ^
    123|         await act(async () => root.unmount());
    124|         root = createRoot(container);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯

 FAIL  src/components/homeDashboard.spec.tsx > time-based home greetings > uses the correct local-time group across every period boundary
AssertionError: expected '夜已深，早点休息。' to be '醉后不知天在水，满船清梦压星河。还在修 Bug 吗？' // Object.is equality

Expected: "醉后不知天在水，满船清梦压星河。还在修 Bug 吗？"
Received: "夜已深，早点休息。"

 ❯ src/components/homeDashboard.spec.tsx:144:70
    142|       vi.setSystemTime(new Date(2026, 9, 5, hour));
    143|       await act(async () => vi.advanceTimersByTime(30_000));
    144|       expect(container.querySelector('.home-greeting')?.textContent).t…
       |                                                                      ^
    145|     }
    146|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/3]⎯

 FAIL  src/components/homeDashboard.spec.tsx > time-based home greetings > keeps the selection through refreshes and language changes, and chooses again on a new visit
AssertionError: expected 'Good morning! Stay focused.' to be 'The day is young and full of possibil…' // Object.is equality

Expected: "The day is young and full of possibilities. Code on!"
Received: "Good morning! Stay focused."

 ❯ src/components/homeDashboard.spec.tsx:153:68
    151|     const random = vi.spyOn(Math, 'random').mockReturnValue(0.3);
    152|     await render();
    153|     expect(container.querySelector('.home-greeting')?.textContent).toB…
       |                                                                    ^
    154|     random.mockReturnValue(0.99);
    155|     mocks.supervisorError = 'IPC unavailable';

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/3]⎯


 Test Files  1 failed (1)
      Tests  3 failed | 17 passed (20)
   Start at  18:19:10
   Duration  518ms (environment 42%, tests 35%, import 14%, transform 9%)

```

random-every-render.txt：

```text

 RUN  v5.0.3 /Volumes/Developer/GETSSH/apps/getssh-client

 ❯ src/components/homeDashboard.spec.tsx (20 tests | 1 failed) 202ms
   ❯ time-based home greetings (3)
     × keeps the selection through refreshes and language changes, and chooses again on a new visit 12ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/components/homeDashboard.spec.tsx > time-based home greetings > keeps the selection through refreshes and language changes, and chooses again on a new visit
AssertionError: expected 'Keep the momentum going, you\'re doin…' to be 'The day is young and full of possibil…' // Object.is equality

Expected: "The day is young and full of possibilities. Code on!"
Received: "Keep the momentum going, you're doing great!"

 ❯ src/components/homeDashboard.spec.tsx:158:68
    156|     await render();
    157|     await act(async () => vi.advanceTimersByTime(30_000));
    158|     expect(container.querySelector('.home-greeting')?.textContent).toB…
       |                                                                    ^
    159|     mocks.language = 'zh-CN';
    160|     await render();

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 19 passed (20)
   Start at  18:19:10
   Duration  553ms (tests 40%, environment 38%, import 13%, transform 9%)

```

