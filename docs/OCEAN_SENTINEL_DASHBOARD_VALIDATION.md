# Ocean Sentinel dashboard 验证

日期：2026-10-04。目录：`/Volumes/Developer/GETSSH`。

## 界面结果

海洋守护中心沿用现有 workbench 设计规范、语义色、薄分隔线、设置导航与暗亮主题。页面调整为进程监护摘要、已确认待处理事项、保护配置清单及工作区/日志上下文。刷新在总览即可使用，密码、恢复码、生物识别、主机信任、隐私、插件权限验证与现有详情操作保留。

- 进程状态只描述本机守护进程连接与告警，不推导全部功能安全。
- 密码状态来自 `security.status()`，按当前工作区 scope 的 `protected` 和 `ownPassword` 区分独立密码、继承主密码与未设置。未知状态不显示无密码告警。
- 已知主机是应用级保存记录，仅读取成功后显示记录数量。插件和隐私配置等 `isConfigLoaded` 后显示；失败/未加载显示尚未确认。
- 恢复码摘要仅说明创建状态，覆盖限制保留在详情。界面闲置锁定配置与主密码锁定机制没有合并成一个计时承诺。
- 工作区隔离入口说明规则配置；日志入口说明连接历史、审计记录与新建 SSH 会话录屏配置。
- 配置动作具有含项目名称的 accessible name，详情自动滚动并获得焦点，关闭后恢复原入口焦点。

## 实际截图

以下为真实 Electron 页面，使用临时 HOME、native home、userData 和 mock keychain；临时存储用于数据隔离。截图监护状态来自本次独立进程的真实 IPC，没有注入安全分数、活动计数或监护状态。默认临时工作区自然无密码，不代表负责人的工作区状态。测试退出后已清理临时数据。

- [深色](/Volumes/Developer/GETSSH/docs/screenshots/ocean-sentinel-dashboard-zh-dark.png)
- [浅色](/Volumes/Developer/GETSSH/docs/screenshots/ocean-sentinel-dashboard-zh-light.png)
- [Tidal 分屏](/Volumes/Developer/GETSSH/docs/screenshots/ocean-sentinel-dashboard-zh-split.png)

窗口逻辑尺寸 1360 × 980，截图为 Retina 2720 × 1960。主代理已逐张查看深色、浅色和分屏效果。真实分屏内设置内容视口 246px，无横向溢出；总览刷新、Enter 键操作、监护/隐私详情、焦点返回及日志导航通过，无 renderer/IPC 错误。

## 最终验证命令与原始输出

下列命令均退出 0。TypeScript、Vite、单测、Electron smoke 的工作目录为 `apps/getssh-client`；copy lint 为仓库根目录。Vite 保留大 chunk 提示，构建完成。

### TypeScript

```sh
HOME=/private/tmp/getssh-ocean-dashboard-validation-20261004/home USERPROFILE=/private/tmp/getssh-ocean-dashboard-validation-20261004/home pnpm exec tsc -b tsconfig.json --force --pretty false
```

原始 stdout/stderr 为空，退出码 0。

### Vite

```sh
HOME=/private/tmp/getssh-ocean-dashboard-validation-20261004/home USERPROFILE=/private/tmp/getssh-ocean-dashboard-validation-20261004/home pnpm exec vite build
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
dist/assets/index-Bt6hWGjI.css                 160.45 kB │ gzip:  24.50 kB
dist/assets/index-qtppVq86.js                2,504.00 kB │ gzip: 772.38 kB

[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 2000 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 413ms
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

✓ built in 60ms
vite v8.3.1 building client environment for production...
transforming...
✓ 2 modules transformed.
rendering chunks...
computing gzip size...
dist-electron/preload/index.js  12.95 kB │ gzip: 2.91 kB

✓ built in 4ms
```

### Regression tests

```sh
HOME=/private/tmp/getssh-ocean-dashboard-validation-20261004/home USERPROFILE=/private/tmp/getssh-ocean-dashboard-validation-20261004/home pnpm exec vitest run src/hooks/centerButtonRouting.spec.tsx src/hooks/centerRouting.spec.tsx src/components/buttonFeedback.spec.tsx src/components/paneAssetActions.spec.tsx src/components/centerControls.spec.tsx src/store/sessionStore.spec.ts src/utils/paneHelpers.spec.ts electron/main/renameIntegration.test.ts src/components/sentinelStatusControls.spec.tsx electron/main/security/SecureCenter.status.test.ts src/components/securityOverview.spec.tsx --environment node
```

```text

 RUN  v5.0.3 /Volumes/Developer/GETSSH/apps/getssh-client


 Test Files  11 passed (11)
      Tests  93 passed (93)
   Start at  08:50:07
   Duration  1.75s (environment 61%, import 16%, transform 12%, tests 11%)

```

### Copy lint

```sh
HOME=/private/tmp/getssh-ocean-dashboard-validation-20261004/home USERPROFILE=/private/tmp/getssh-ocean-dashboard-validation-20261004/home node scripts/copy-lint.js --strict apps/getssh-client/src/components/settings/tabs/SecurityTab.tsx apps/getssh-client/src/components/SettingsView.tsx
```

```text
copy-lint：检查了 2 个文件
  apps/getssh-client/src/components/settings/tabs/SecurityTab.tsx
  apps/getssh-client/src/components/SettingsView.tsx

== 夸张：几乎都该删（0 处）

== 机器腔：改成直接陈述（0 处）

== 看语境：是字面的技术描述就保留，并确认有出处（0 处）

== 按词汇总
```

### Electron dashboard smoke

```sh
node scripts/ocean-sentinel-dashboard-smoke.cjs
```

```text
SCREENSHOT: /Volumes/Developer/GETSSH/docs/screenshots/ocean-sentinel-dashboard-zh-dark.png
SCREENSHOT: /Volumes/Developer/GETSSH/docs/screenshots/ocean-sentinel-dashboard-zh-light.png
PASS: narrow settings viewport width 246px without horizontal overflow.
SCREENSHOT: /Volumes/Developer/GETSSH/docs/screenshots/ocean-sentinel-dashboard-zh-split.png
Ocean Sentinel dashboard smoke passed: real supervisor, natural workspace warning, Chinese dark/light, split-pane overflow, keyboard refresh/details/privacy and audit navigation, no renderer or IPC errors.
```

## 新增 metadata 测试的 mutation 验证

新增 `securityOverview.spec.tsx` 的 7 个用例验证主密码继承、当前 scope、IPC 失败/未知、主机记录 pending/失败/空数组以及配置加载边界。通过 Vite pre-load 读取临时复制源码运行 mutation，不改生产文件。原源码对照 7/7；四种错误分别触发 3、1、2、1 个预期断言失败，证明测试能抓住上述回归。

入口命令：

```sh
python3 /private/tmp/getssh-security-overview-validation-20261004/run-mutations.py
```

精确替换、每次执行命令、退出码与原始输出如下。临时源码/config/HOME 已清理。

### mutation-notes.txt

```text
control: None -> None
HOME=/private/tmp/getssh-security-overview-mutations-syi780bv/home
USERPROFILE=/private/tmp/getssh-security-overview-mutations-syi780bv/home
Cwd: /Volumes/Developer/GETSSH/apps/getssh-client
Command: ["/Volumes/Developer/GETSSH/apps/getssh-client/node_modules/.bin/vitest", "run", "src/components/securityOverview.spec.tsx", "--config", "/private/tmp/getssh-security-overview-mutations-syi780bv/vitest.config.mjs", "--environment", "node"]
Exit: 0

legacy-protection: 'const workspaceNeedsPassword = workspaceScope?.protected === false;' -> 'const workspaceNeedsPassword = workspaceUnprotected;'
HOME=/private/tmp/getssh-security-overview-mutations-syi780bv/home
USERPROFILE=/private/tmp/getssh-security-overview-mutations-syi780bv/home
Cwd: /Volumes/Developer/GETSSH/apps/getssh-client
Command: ["/Volumes/Developer/GETSSH/apps/getssh-client/node_modules/.bin/vitest", "run", "src/components/securityOverview.spec.tsx", "--config", "/private/tmp/getssh-security-overview-mutations-syi780bv/vitest.config.mjs", "--environment", "node"]
Exit: 1

wrong-workspace-scope: 'protectionStatus?.scopes.find(scope => scope.workspaceId === activeWorkspaceId)' -> "protectionStatus?.scopes.find(scope => scope.workspaceId === 'other')"
HOME=/private/tmp/getssh-security-overview-mutations-syi780bv/home
USERPROFILE=/private/tmp/getssh-security-overview-mutations-syi780bv/home
Cwd: /Volumes/Developer/GETSSH/apps/getssh-client
Command: ["/Volumes/Developer/GETSSH/apps/getssh-client/node_modules/.bin/vitest", "run", "src/components/securityOverview.spec.tsx", "--config", "/private/tmp/getssh-security-overview-mutations-syi780bv/vitest.config.mjs", "--environment", "node"]
Exit: 1

assumed-zero-hosts: 'hostsLoaded ? (zh ? `${knownHosts.length} 条记录` : `${knownHosts.length} records`) : unconfirmed' -> 'true ? (zh ? `${knownHosts.length} 条记录` : `${knownHosts.length} records`) : unconfirmed'
HOME=/private/tmp/getssh-security-overview-mutations-syi780bv/home
USERPROFILE=/private/tmp/getssh-security-overview-mutations-syi780bv/home
Cwd: /Volumes/Developer/GETSSH/apps/getssh-client
Command: ["/Volumes/Developer/GETSSH/apps/getssh-client/node_modules/.bin/vitest", "run", "src/components/securityOverview.spec.tsx", "--config", "/private/tmp/getssh-security-overview-mutations-syi780bv/vitest.config.mjs", "--environment", "node"]
Exit: 1

assumed-plugin-config: 'isConfigLoaded ? pluginModes[appConfig.pluginSecurityMode] : unconfirmed' -> 'pluginModes[appConfig.pluginSecurityMode]'
HOME=/private/tmp/getssh-security-overview-mutations-syi780bv/home
USERPROFILE=/private/tmp/getssh-security-overview-mutations-syi780bv/home
Cwd: /Volumes/Developer/GETSSH/apps/getssh-client
Command: ["/Volumes/Developer/GETSSH/apps/getssh-client/node_modules/.bin/vitest", "run", "src/components/securityOverview.spec.tsx", "--config", "/private/tmp/getssh-security-overview-mutations-syi780bv/vitest.config.mjs", "--environment", "node"]
Exit: 1

Production SecurityTab SHA-256 before and after: 2c377cf2a575370561699181c7178ba0d0a4abd2e49acc6e0540e94d59aa2b1c
Production source was never modified. The Vite pre-load plugin read only a copied source file and kept the original module ID for relative imports/mocks. Temporary source/config/HOME directories were removed after checks.
```

### control-mutation.txt

```text
Both esbuild and oxc options were set. oxc options will be used and esbuild options will be ignored. The following esbuild options were set: `{ jsx: 'automatic' }`

 RUN  v5.0.3 /Volumes/Developer/GETSSH/apps/getssh-client


 Test Files  1 passed (1)
      Tests  7 passed (7)
   Start at  08:47:24
   Duration  667ms (environment 76%, import 9%, tests 8%, transform 6%)

```

### legacy-protection-mutation.txt

```text
Both esbuild and oxc options were set. oxc options will be used and esbuild options will be ignored. The following esbuild options were set: `{ jsx: 'automatic' }`

 RUN  v5.0.3 /Volumes/Developer/GETSSH/apps/getssh-client

 ❯ src/components/securityOverview.spec.tsx (7 tests | 3 failed) 63ms
   ❯ security dashboard metadata (7)
     × uses the current scope protection even when it has no own password and the legacy store says unprotected 24ms
     × keeps protection unconfirmed after null metadata instead of treating it as disabled 10ms
     × keeps protection unconfirmed after rejected metadata instead of treating it as disabled 6ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/components/securityOverview.spec.tsx > security dashboard metadata > uses the current scope protection even when it has no own password and the legacy store says unprotected
AssertionError: expected 'Local process supervisionHealthyThe l…' not to contain 'This workspace has no password'

Expected: "This workspace has no password"
Received: "Local process supervisionHealthyThe local supervisor is connected.Refresh statusViewNeeds attentionThis workspace has no passwordIts data is encrypted on disk, but anyone using this computer can open it.Set a passwordProtection overviewProtection settings for the app and current workspace.Master password & recoveryRecovery code not configured. Create one after setting a master password.EnabledManageWorkspace passwordThis workspace inherits the app master password.Master passwordSet upPlugin permissionsBackend plugins are not executed.Safe modeManagePrivacyManage sensitive content masking and UI auto-lock settings.Privacy offConfigureKnown hostsHost keys saved on this computer for fingerprint verification.0 recordsManageCurrent workspaceCurrentWorkspace隔离规则Review configuration for file transfer, host keys and export rules.Open workspaceSecurity & session logsReview connection history, audit records and terminal recordings.New SSH session recording · OffView logs"

 ❯ expectNoPasswordWarning src/components/securityOverview.spec.tsx:83:73
     81|   return state!.textContent!.trim();
     82| };
     83| const expectNoPasswordWarning = () => expect(container.textContent).no…
       |                                                                         ^
     84|
     85| describe('security dashboard metadata', () => {
 ❯ src/components/securityOverview.spec.tsx:90:5

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯

 FAIL  src/components/securityOverview.spec.tsx > security dashboard metadata > keeps protection unconfirmed after null metadata instead of treating it as disabled
 FAIL  src/components/securityOverview.spec.tsx > security dashboard metadata > keeps protection unconfirmed after rejected metadata instead of treating it as disabled
AssertionError: expected 'Local process supervisionHealthyThe l…' not to contain 'This workspace has no password'

Expected: "This workspace has no password"
Received: "Local process supervisionHealthyThe local supervisor is connected.Refresh statusViewNeeds attentionThis workspace has no passwordIts data is encrypted on disk, but anyone using this computer can open it.Set a passwordProtection overviewProtection settings for the app and current workspace.Master password & recoveryLaunch verification, locking and recovery.Not confirmedManageWorkspace passwordPassword protection for the current workspace.Not confirmedSet upPlugin permissionsBackend plugins are not executed.Safe modeManagePrivacyManage sensitive content masking and UI auto-lock settings.Privacy offConfigureKnown hostsHost keys saved on this computer for fingerprint verification.0 recordsManageCurrent workspaceCurrentWorkspace隔离规则Review configuration for file transfer, host keys and export rules.Open workspaceSecurity & session logsReview connection history, audit records and terminal recordings.New SSH session recording · OffView logs"

 ❯ expectNoPasswordWarning src/components/securityOverview.spec.tsx:83:73
     81|   return state!.textContent!.trim();
     82| };
     83| const expectNoPasswordWarning = () => expect(container.textContent).no…
       |                                                                         ^
     84|
     85| describe('security dashboard metadata', () => {
 ❯ src/components/securityOverview.spec.tsx:109:5

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/3]⎯


 Test Files  1 failed (1)
      Tests  3 failed | 4 passed (7)
   Start at  08:47:25
   Duration  385ms (environment 56%, tests 19%, import 16%, transform 9%)

```

### wrong-workspace-scope-mutation.txt

```text
Both esbuild and oxc options were set. oxc options will be used and esbuild options will be ignored. The following esbuild options were set: `{ jsx: 'automatic' }`

 RUN  v5.0.3 /Volumes/Developer/GETSSH/apps/getssh-client

 ❯ src/components/securityOverview.spec.tsx (7 tests | 1 failed) 61ms
   ❯ security dashboard metadata (7)
     × uses the current scope protection even when it has no own password and the legacy store says unprotected 20ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/components/securityOverview.spec.tsx > security dashboard metadata > uses the current scope protection even when it has no own password and the legacy store says unprotected
AssertionError: expected 'Not set' to be 'Master password' // Object.is equality

Expected: "Master password"
Received: "Not set"

 ❯ src/components/securityOverview.spec.tsx:89:48
     87|     await render();
     88|     expect(status).toHaveBeenCalledTimes(1);
     89|     expect(summaryState('Workspace password')).toBe('Master password');
       |                                                ^
     90|     expectNoPasswordWarning();
     91|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)
   Start at  08:47:25
   Duration  384ms (environment 56%, tests 18%, import 16%, transform 9%)

```

### assumed-zero-hosts-mutation.txt

```text
Both esbuild and oxc options were set. oxc options will be used and esbuild options will be ignored. The following esbuild options were set: `{ jsx: 'automatic' }`

 RUN  v5.0.3 /Volumes/Developer/GETSSH/apps/getssh-client

 ❯ src/components/securityOverview.spec.tsx (7 tests | 2 failed) 59ms
   ❯ security dashboard metadata (7)
     × does not fabricate a zero host count while loading, but shows the confirmed empty result 7ms
     × keeps a failed host lookup unconfirmed instead of displaying zero records 5ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/components/securityOverview.spec.tsx > security dashboard metadata > does not fabricate a zero host count while loading, but shows the confirmed empty result
AssertionError: expected '0 records' to be 'Not confirmed' // Object.is equality

Expected: "Not confirmed"
Received: "0 records"

 ❯ src/components/securityOverview.spec.tsx:116:41
    114|     getKnownHosts.mockImplementation(() => new Promise(resolve => { re…
    115|     await render();
    116|     expect(summaryState('Known hosts')).toBe('Not confirmed');
       |                                         ^
    117|     await act(async () => resolveHosts([]));
    118|     expect(summaryState('Known hosts')).toBe('0 records');

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  src/components/securityOverview.spec.tsx > security dashboard metadata > keeps a failed host lookup unconfirmed instead of displaying zero records
AssertionError: expected '0 records' to be 'Not confirmed' // Object.is equality

Expected: "Not confirmed"
Received: "0 records"

 ❯ src/components/securityOverview.spec.tsx:124:41
    122|     getKnownHosts.mockRejectedValue(new Error('Hosts unavailable'));
    123|     await render();
    124|     expect(summaryState('Known hosts')).toBe('Not confirmed');
       |                                         ^
    125|   });
    126|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯


 Test Files  1 failed (1)
      Tests  2 failed | 5 passed (7)
   Start at  08:47:26
   Duration  381ms (environment 56%, tests 18%, import 16%, transform 10%)

```

### assumed-plugin-config-mutation.txt

```text
Both esbuild and oxc options were set. oxc options will be used and esbuild options will be ignored. The following esbuild options were set: `{ jsx: 'automatic' }`

 RUN  v5.0.3 /Volumes/Developer/GETSSH/apps/getssh-client

 ❯ src/components/securityOverview.spec.tsx (7 tests | 1 failed) 58ms
   ❯ security dashboard metadata (7)
     × does not present the default plugin mode as loaded configuration 7ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/components/securityOverview.spec.tsx > security dashboard metadata > does not present the default plugin mode as loaded configuration
AssertionError: expected 'Safe mode' to be 'Not confirmed' // Object.is equality

Expected: "Not confirmed"
Received: "Safe mode"

 ❯ src/components/securityOverview.spec.tsx:130:48
    128|     mocks.isConfigLoaded = false;
    129|     await render();
    130|     expect(summaryState('Plugin permissions')).toBe('Not confirmed');
       |                                                ^
    131|     mocks.isConfigLoaded = true;
    132|     await render();

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)
   Start at  08:47:26
   Duration  379ms (environment 57%, tests 17%, import 16%, transform 9%)

```


