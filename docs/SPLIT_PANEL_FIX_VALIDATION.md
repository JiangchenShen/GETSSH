# GETSSH 分屏修复验证

日期：2026-10-03。工作区：`/Volumes/Developer/GETSSH`，分支：`v3-next`。

顶部「分屏」原先固定请求左右拆分。第一次拆分后，新窗格的父节点已经是左右布局，Tidal Engine 拒绝同方向继续拆分，返回 `direction_not_allowed`。已改为按当前叶节点的父布局选择允许的方向；没有有效活动窗格或已达到四窗格时禁用按钮。

窗格工具栏原先要求宽度和高度同时达到 200px，导致较窄但足够高的窗格无法上下拆分。已按拆分轴分别检查宽度或高度。

真实 Electron UI 测试覆盖空状态、连续 1→2→3→4 分屏、四窗格上限、鼠标拖动分隔线及原生布局比例同步、关闭后重新启用，以及宽度不足 200px 时上下拆分。测试使用临时 HOME、USERPROFILE、user-data-dir 和模拟钥匙串，以设置页和欢迎页验证布局；没有连接日常 SSH 主机。已验证 macOS，未运行 Windows UI 测试。

新增回归用例：

- `apps/getssh-client/src/utils/paneHelpers.spec.ts`
- `apps/getssh-client/scripts/split-pane-smoke.cjs`

重新启动开发进程后加载当前代码：在仓库根目录运行 `pnpm run dev`。

## 命令与原始输出

以下命令除文案检查外均在 `apps/getssh-client` 执行，输出原样保留。TypeScript 命令没有输出，退出码为 0。Vite 的已有大块体积提示不影响构建成功。

### 1

```sh
pnpm exec tsc -b
```

```text
```

### 2

```sh
env HOME=/private/tmp/getssh-split-validation-20261003/home USERPROFILE=/private/tmp/getssh-split-validation-20261003/home pnpm exec vitest run src/utils/paneHelpers.spec.ts src/store/sessionStore.spec.ts src/components/SplitPane.spec.ts --environment node
```

```text

 RUN  v5.0.3 /Volumes/Developer/GETSSH/apps/getssh-client


 Test Files  3 passed (3)
      Tests  8 passed (8)
   Start at  17:48:45
   Duration  665ms (environment 91%, transform 4%, tests 3%, import 2%)

```

### 3

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
dist/assets/index-CIswzbJp.js                2,489.97 kB │ gzip: 768.83 kB

[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 2000 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 477ms
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
dist-electron/main/index.js                          693.65 kB │ gzip: 201.67 kB

✓ built in 64ms
vite v8.3.1 building client environment for production...
transforming...
✓ 2 modules transformed.
rendering chunks...
computing gzip size...
dist-electron/preload/index.js  12.95 kB │ gzip: 2.91 kB

✓ built in 4ms
```

### 4

```sh
node scripts/copy-lint.js --strict apps/getssh-client/src/App.tsx apps/getssh-client/src/components/LeafPane.tsx
```

```text
copy-lint：检查了 2 个文件
  apps/getssh-client/src/App.tsx
  apps/getssh-client/src/components/LeafPane.tsx

== 夸张：几乎都该删（0 处）

== 机器腔：改成直接陈述（0 处）

== 看语境：是字面的技术描述就保留，并确认有出处（0 处）

== 按词汇总
```

### 5

```sh
node scripts/split-pane-smoke.cjs
```

```text
Split pane UI smoke passed: empty state, 1→2→3→4 panes, cap, native divider resize, close/re-enable, narrow-pane vertical split.
```

## 回归测试有效性

在临时构建副本中把上下拆分恢复为宽、高同时达到 200px 的旧限制，其余修复保留。相同真实 UI 测试在窄窗格按钮检查处按预期失败（退出码 1），证明用例能捕获原故障。生产源码及构建产物未修改，临时副本已清理。

```sh
node /private/tmp/getssh-split-gate-mutation-t7ut7j16/smoke.cjs > /private/tmp/getssh-split-validation-20261003/narrow-gate-mutation.txt 2>&1
```

```text
Split pane UI smoke failed: ExpectError: expect(locator).toBeEnabled() failed

Locator:  locator('button[title="Close Pane"]:visible').first().locator('../../..').locator('button[title="Split Down"]')
Expected: enabled
Received: disabled
Timeout:  5000ms

Call log:
  - Expect "toBeEnabled" locator('button[title="Close Pane"]:visible').first().locator('../../..').locator('button[title="Split Down"]') with timeout 5000ms
  - waiting for locator('button[title="Close Pane"]:visible').first().locator('../../..').locator('button[title="Split Down"]')
    14 × locator resolved to <button disabled title="Split Down" class="w-[18px] h-[18px] rounded grid place-items-center transition-colors opacity-25 cursor-not-allowed text-ink-3">…</button>
       - unexpected value "disabled"

    at captureRawStack (/Volumes/Developer/GETSSH/node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core/lib/coreBundle.js:8588:17)
    at callMatcherAsStep (/Volumes/Developer/GETSSH/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/lib/matchers/expect.js:13310:57)
    at Object.toBeEnabled (/Volumes/Developer/GETSSH/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/lib/matchers/expect.js:13302:23)
    at /private/tmp/getssh-split-gate-mutation-t7ut7j16/smoke.cjs:88:29 {
  matcherResult: {
    message: 'expect(locator).toBeEnabled() failed\n' +
      '\n' +
      `Locator:  locator('button[title="Close Pane"]:visible').first().locator('../../..').locator('button[title="Split Down"]')\n` +
      'Expected: enabled\n' +
      'Received: disabled\n' +
      'Timeout:  5000ms\n' +
      '\n' +
      'Call log:\n' +
      `  - Expect "toBeEnabled" locator('button[title="Close Pane"]:visible').first().locator('../../..').locator('button[title="Split Down"]') with timeout 5000ms\n` +
      `  - waiting for locator('button[title="Close Pane"]:visible').first().locator('../../..').locator('button[title="Split Down"]')\n` +
      '    14 × locator resolved to <button disabled title="Split Down" class="w-[18px] h-[18px] rounded grid place-items-center transition-colors opacity-25 cursor-not-allowed text-ink-3">…</button>\n' +
      '       - unexpected value "disabled"\n',
    pass: false,
    actual: 'disabled',
    name: 'toBeEnabled',
    expected: 'enabled',
    log: [
      `  - Expect "toBeEnabled" locator('button[title="Close Pane"]:visible').first().locator('../../..').locator('button[title="Split Down"]') with timeout 5000ms`,
      `  - waiting for locator('button[title="Close Pane"]:visible').first().locator('../../..').locator('button[title="Split Down"]')`,
      '    14 × locator resolved to <button disabled title="Split Down" class="w-[18px] h-[18px] rounded grid place-items-center transition-colors opacity-25 cursor-not-allowed text-ink-3">…</button>',
      '       - unexpected value "disabled"'
    ],
    timeout: 5000,
    ariaSnapshot: '- button "Split Down" [disabled]'
  }
}
```
