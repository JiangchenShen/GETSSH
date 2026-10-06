# GETSSH 按钮修复验证

日期：2026-10-04。工作区：`/Volumes/Developer/GETSSH`，分支：`v3-next`。

## 已修复的问题

| 入口 | 原因 | 现在的行为 |
|---|---|---|
| 分屏放大后首次打开 AI、插件、工作区等中心页 | 新中心填入欢迎窗格，但被另一个放大窗格遮住 | 打开时解除遮挡它的放大状态并聚焦目标窗格；保留终端会话 |
| 中心页复用 | 已分离或其他工作区的标签被选中，主窗口无法显示 | 只复用当前工作区、主窗口可见的标签 |
| 首页快速连接 | 普通草稿截获新地址；复用快速草稿 id 时表单没有重置 | 区分普通与快速草稿，新地址重置快速表单；普通草稿保留 |
| 安全设置的管理、配置、设置等按钮 | 详情生成在可视区域之外 | 自动滚动并聚焦详情；关闭后焦点返回入口按钮 |
| 插件权限需要密码验证 | Electron 不支持原来的 window.prompt 密码输入 | 在详情中显示密码验证表单；后端验证成功后才更改权限，失败可重试 |
| 插件安装失败、取消安装 | 错误显示在弹窗后面；取消清理失败阻止关闭 | 安装错误显示在权限弹窗内部；取消即使清理失败也能关闭并报告原因 |
| 工作区资产导入 | 导入完成后仅更新工作区元数据，没有刷新连接与剧本列表 | 立即加载目标工作区的连接与剧本，保留草稿和选中项；切换或锁定时丢弃过期结果 |
| 窗格关闭、放大 | IPC 返回 success:false 没有呈现给用户 | 显示错误提示；仅忽略终端自动退出时已被移除的窗格 |
| 打开录屏目录 | shell.openPath 返回错误字符串时被忽略；前端缺少失败反馈 | 后端错误传到前端，显示提示并恢复按钮；无连接记录时禁用导出并说明原因 |

## 验证结果

53 项回归用例通过；强制 TypeScript 检查及 Vite 构建退出码为 0。真实 macOS Electron 窗口验证中心导航、安全详情、插件失败与取消、快速连接草稿、窗格错误反馈，以及连续 1→2→3→4 分屏、分隔线拖动、关闭后再拆分和窄窗格上下拆分。

原生存储对比为 232 steps、0 differences；钥匙库端到端验证迁移、延期工作区、主密码设置与移除、重启、资产文件夹锁、损坏工作区及迁移回滚，退出码为 0。

文案严格检查退出码为 0，夸张词为 0；输出中仍报告 locale 文件的存量机器腔及技术描述。本轮新增提示未产生这些命中。构建仍有已有的大块体积提示。

测试隔离 HOME、USERPROFILE、Electron 原生 home 与 userData，使用模拟钥匙串。macOS 的 app.getPath('home') 不随 HOME 环境变量变化，因此 UI smoke 和 keystore runner 现在在加载应用前显式设置路径。UI 使用假存储；文件夹及插件错误只在隔离测试进程注入，没有连接实际主机或安装后端插件。原生存储测试使用允许的临时设备钥匙；没有操作日常应用数据或已有钥匙串条目。未运行 Windows UI 测试。

## 回归有效性

同一真实 UI 用例在修复前的临时构建中按预期失败：首次打开 AI 后仍存在一个可见 Exit Zen Mode 按钮，表示中心页继续被遮挡。修复后同一断言通过。详见原始日志 `/private/tmp/getssh-button-validation-20261004/before-fix-ui.txt`。

在临时源码副本中去掉安全详情滚动/聚焦，7 项用例中 2 项失败；去掉插件弹窗内错误提示，1 项失败。生产源码未被这些变异修改。

```text
security-detail: replace 'useEffect(() => { if (detail) revealDetail(); }, [detail]);' with 'useEffect(() => {}, [detail]);'; command ['/Volumes/Developer/GETSSH/apps/getssh-client/node_modules/.bin/vitest', 'run', 'src/components/buttonFeedback.spec.tsx', '--config', '/private/tmp/getssh-button-mutations-8ds_bnro/vitest.config.mjs']; exit 1
plugin-dialog: replace '{error && <p role="alert" className="mt-4 border-l-2 border-down bg-down/10 px-3 py-2 text-sm text-down">{error}</p>}' with ''; command ['/Volumes/Developer/GETSSH/apps/getssh-client/node_modules/.bin/vitest', 'run', 'src/components/buttonFeedback.spec.tsx', '--config', '/private/tmp/getssh-button-mutations-8ds_bnro/vitest.config.mjs']; exit 1
Production files were not changed. Source copies and temporary HOME directories removed after checks.
```

窗格反馈和资产刷新变异分别造成 3 项失败；相应原始日志位于 `/private/tmp/getssh-pane-toast-mutation.log`、`/private/tmp/getssh-asset-refresh-mutation.log`。变异后生产代码已恢复，并完成最终 53 项回归与真实 UI 检查。

## 命令与原始输出

以下输出未经改写。TypeScript 检查没有输出，退出码为 0。日志目录：`/private/tmp/getssh-button-validation-20261004`。

### TypeScript

目录：`apps/getssh-client`。

```sh
pnpm exec tsc -b tsconfig.json --force --pretty false
```

```text

```

### 回归用例

目录：`apps/getssh-client`。

```sh
env HOME=/private/tmp/getssh-button-validation-20261004/home USERPROFILE=/private/tmp/getssh-button-validation-20261004/home pnpm exec vitest run src/hooks/centerButtonRouting.spec.tsx src/hooks/centerRouting.spec.tsx src/components/buttonFeedback.spec.tsx src/components/paneAssetActions.spec.tsx src/components/centerControls.spec.tsx src/store/sessionStore.spec.ts src/utils/paneHelpers.spec.ts electron/main/renameIntegration.test.ts --environment node
```

```text

 RUN  v5.0.3 /Volumes/Developer/GETSSH/apps/getssh-client


 Test Files  8 passed (8)
      Tests  53 passed (53)
   Start at  01:33:09
   Duration  1.43s (environment 67%, import 16%, tests 9%, transform 8%)
```

### 生产构建

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
dist/assets/index-FqOcl8qe.js                2,494.46 kB │ gzip: 770.03 kB

[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 2000 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 432ms
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
dist-electron/main/index.js                          693.67 kB │ gzip: 201.67 kB

✓ built in 62ms
vite v8.3.1 building client environment for production...
transforming...
✓ 2 modules transformed.
rendering chunks...
computing gzip size...
dist-electron/preload/index.js  12.95 kB │ gzip: 2.91 kB

✓ built in 4ms
```

### 文案检查

目录：`仓库根目录`。

```sh
node scripts/copy-lint.js --strict apps/getssh-client/src/hooks/useCoreAppEvents.ts apps/getssh-client/src/components/LeafPane.tsx apps/getssh-client/src/components/PluginSettings.tsx apps/getssh-client/src/components/settings/tabs/SecurityTab.tsx apps/getssh-client/src/components/settings/tabs/AuditTab.tsx apps/getssh-client/src/components/workspace-center/AssetBridgeTab.tsx apps/getssh-client/src/locales/en-US.json apps/getssh-client/src/locales/zh-CN.json
```

```text
copy-lint：检查了 8 个文件
  apps/getssh-client/src/hooks/useCoreAppEvents.ts
  apps/getssh-client/src/components/LeafPane.tsx
  apps/getssh-client/src/components/PluginSettings.tsx
  apps/getssh-client/src/components/settings/tabs/SecurityTab.tsx
  apps/getssh-client/src/components/settings/tabs/AuditTab.tsx
  apps/getssh-client/src/components/workspace-center/AssetBridgeTab.tsx
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

### 真实按钮 UI

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

### 真实分屏 UI

目录：`apps/getssh-client`。

```sh
node scripts/split-pane-smoke.cjs
```

```text
Split pane UI smoke passed: empty state, 1→2→3→4 panes, cap, native divider resize, close/re-enable, narrow-pane vertical split.
```

### 原生钥匙库端到端

目录：`apps/getssh-client`。

```sh
env HOME=/private/tmp/getssh-button-validation-20261004/home USERPROFILE=/private/tmp/getssh-button-validation-20261004/home node scripts/security/keystore-e2e/run.mjs
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

### 原生存储对比

目录：`仓库根目录`。

```sh
env HOME=/private/tmp/getssh-button-validation-20261004/store-home USERPROFILE=/private/tmp/getssh-button-validation-20261004/store-home GETSSH_STORE_CONFORMANCE=1 node rust-core/getssh-store/store.conformance.mjs
```

```text
232 steps, 0 differences
```

## 加载修复

关闭旧开发进程，在仓库根目录重新运行 `pnpm run dev`，以加载当前主进程和前端代码。本次未提交、推送或打包。

