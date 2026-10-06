# 侧栏毛玻璃与不透明度修复验证

日期：2026-10-04。工作目录：`/Volumes/Developer/GETSSH`。

## 根因与修复

外观滑块正常保存 `bgOpacity`，但主工作区导轨和资产侧栏使用固定 .80/.86 的 CSS 材质，中心页侧栏另固定为 .86；设置没有传入这些实际背景。macOS 的 App 根保持透明，使改画布 rgba 无法影响主侧栏。中心页整块 bg-bg 及放大叶面板底色覆盖透射；浅色主题还有强制关闭 blur 的旧规则。

仅修改两个生产文件：

- [appStore.ts](/Volumes/Developer/GETSSH/apps/getssh-client/src/store/appStore.ts:191)：在现有 appearance 同步路径设置 `html[data-glass]` 与 `--sidebar-opacity`，主窗和拆出窗口的只读配置同步使用同一路径。数值限定在滑块范围，非法数值回落默认。
- [index.css](/Volumes/Developer/GETSSH/apps/getssh-client/src/index.css:190)：主侧栏与中心页导航统一读取不透明度；关闭毛玻璃后使用实体背景并关闭 blur。系统减少透明度优先；浅色可使用 blur。中心页与放大容器背景让出导航，正文 main 单独保持不透明；非侧栏插件页与 CommandCenter 背景不受拆分规则影响。

文字和控件本身的 opacity 没有降低；没有修改用户设置、native 窗口后端、终端主题或真实用户数据。

## 实际界面与 GUI 检查

测试使用独立临时 HOME/USERPROFILE，启动 Electron 前显式设置 native home/userData，并使用 mock keychain 与临时存储。通过真实外观页的 range 使用 Home/End 在 100% / 25% 间切换，未注入 DOM 背景、未改系统桌面。测试已退出并清理测试用户目录。

- [深色100%](/Volumes/Developer/GETSSH/docs/screenshots/sidebar-glass-dark-100.png) / [深色25%](/Volumes/Developer/GETSSH/docs/screenshots/sidebar-glass-dark-25.png)
- [浅色100%](/Volumes/Developer/GETSSH/docs/screenshots/sidebar-glass-light-100.png) / [浅色25%](/Volumes/Developer/GETSSH/docs/screenshots/sidebar-glass-light-25.png)

主工作区导轨、资产侧栏与设置导航三处材料均从 alpha=1 切到 .25（8-bit canvas 读回 64/255≈.25098）。设置导航真实空白裁片平均 RGB 差：深色 10.333，浅色 3.531；变化像素均为100%。图片由真实应用捕获，主代理已查看深浅效果。

开关关闭以及通过 CDP 模拟 `prefers-reduced-transparency: reduce` 时，三处 alpha=1、blur=none；重新开启及恢复媒体偏好后，仍保留25%的滑块设置。真实 Zen Mode 下，中心容器及放大叶容器 alpha=0，正文 main alpha=1；退出放大正常。无 renderer 或 IPC 错误。

外侧导航在当前平坦深色原生背景下与背景 tint 接近，因此该空白裁片可见色差较小；像素差验证改取设置导航，不把材料 alpha 当作最终桌面透射比例。初次外侧像素阈值检查的原始输出保留在报告末尾，未降低最终可见色差断言。

## 命令及未经编辑的输出

以下最终验证均退出0。TypeScript、Vite、Vitest和Electron smoke在 `apps/getssh-client` 执行；copy lint在仓库根目录执行。Vite的大 chunk提示保留。

### TypeScript

```sh
HOME=/private/tmp/getssh-sidebar-glass-validation-20261004/home USERPROFILE=/private/tmp/getssh-sidebar-glass-validation-20261004/home pnpm exec tsc -b tsconfig.json --force --pretty false
```

原始 stdout/stderr 为空，退出码0。

### Vite

```sh
HOME=/private/tmp/getssh-sidebar-glass-validation-20261004/home USERPROFILE=/private/tmp/getssh-sidebar-glass-validation-20261004/home pnpm exec vite build
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
dist/assets/index-DCubklH-.css                 161.03 kB │ gzip:  24.54 kB
dist/assets/index-BorL-vXy.js                2,504.23 kB │ gzip: 772.49 kB

[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 2000 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 521ms
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

✓ built in 69ms
vite v8.3.1 building client environment for production...
transforming...
✓ 2 modules transformed.
rendering chunks...
computing gzip size...
dist-electron/preload/index.js  12.95 kB │ gzip: 2.91 kB

✓ built in 4ms
```

### Copy lint

```sh
HOME=/private/tmp/getssh-sidebar-glass-validation-20261004/home USERPROFILE=/private/tmp/getssh-sidebar-glass-validation-20261004/home node scripts/copy-lint.js --strict apps/getssh-client/src/store/appStore.ts apps/getssh-client/src/index.css
```

```text
copy-lint：检查了 2 个文件
  apps/getssh-client/src/store/appStore.ts
  apps/getssh-client/src/index.css

== 夸张：几乎都该删（0 处）

== 机器腔：改成直接陈述（0 处）

== 看语境：是字面的技术描述就保留，并确认有出处（0 处）

== 按词汇总
```

### Regression tests

```sh
HOME=/private/tmp/getssh-sidebar-glass-validation-20261004/home USERPROFILE=/private/tmp/getssh-sidebar-glass-validation-20261004/home pnpm exec vitest run src/hooks/centerButtonRouting.spec.tsx src/hooks/centerRouting.spec.tsx src/components/buttonFeedback.spec.tsx src/components/paneAssetActions.spec.tsx src/components/centerControls.spec.tsx src/store/sessionStore.spec.ts src/utils/paneHelpers.spec.ts electron/main/renameIntegration.test.ts src/components/sentinelStatusControls.spec.tsx electron/main/security/SecureCenter.status.test.ts src/components/securityOverview.spec.tsx --environment node
```

```text

 RUN  v5.0.3 /Volumes/Developer/GETSSH/apps/getssh-client


 Test Files  11 passed (11)
      Tests  93 passed (93)
   Start at  22:38:25
   Duration  1.67s (environment 67%, import 13%, tests 10%, transform 9%, worker 1%)

```

### Electron sidebar smoke

```sh
GETSSH_GLASS_ARTIFACTS=/private/tmp/getssh-sidebar-glass-validation-20261004/final node scripts/sidebar-glass-smoke.cjs
```

```text
OPAQUE MATERIALS (dark): [{"name":"workspace rail","color":"color(srgb 0.0784314 0.0941176 0.105882)","alpha":1,"blur":"blur(28px) saturate(1.25)"},{"name":"asset sidebar","color":"color(srgb 0.0784314 0.0941176 0.105882)","alpha":1,"blur":"blur(28px) saturate(1.25)"},{"name":"settings navigation","color":"color(srgb 0.0941176 0.105882 0.121569)","alpha":1,"blur":"blur(18px)"}]
SCREENSHOT: /private/tmp/getssh-sidebar-glass-validation-20261004/final/sidebar-glass-dark-100.png
SCREENSHOT: /private/tmp/getssh-sidebar-glass-validation-20261004/final/sidebar-glass-dark-25.png
PIXELS (settings navigation, dark): {"meanRgbDifference":10.333333333333334,"changedPixelFraction":1}
MATERIALS: [{"name":"workspace rail","color":"color(srgb 0.0784314 0.0941176 0.105882 / 0.25)","alpha":0.25098039215686274,"blur":"blur(28px) saturate(1.25)"},{"name":"asset sidebar","color":"color(srgb 0.0784314 0.0941176 0.105882 / 0.25)","alpha":0.25098039215686274,"blur":"blur(28px) saturate(1.25)"},{"name":"settings navigation","color":"color(srgb 0.0941176 0.105882 0.121569 / 0.25)","alpha":0.25098039215686274,"blur":"blur(18px)"}]
MATERIALS: [{"name":"workspace rail","color":"rgb(20, 24, 27)","alpha":1,"blur":"none"},{"name":"asset sidebar","color":"rgb(20, 24, 27)","alpha":1,"blur":"none"},{"name":"settings navigation","color":"rgb(24, 27, 31)","alpha":1,"blur":"none"}]
MATERIALS: [{"name":"workspace rail","color":"color(srgb 0.0784314 0.0941176 0.105882 / 0.25)","alpha":0.25098039215686274,"blur":"blur(28px) saturate(1.25)"},{"name":"asset sidebar","color":"color(srgb 0.0784314 0.0941176 0.105882 / 0.25)","alpha":0.25098039215686274,"blur":"blur(28px) saturate(1.25)"},{"name":"settings navigation","color":"color(srgb 0.0941176 0.105882 0.121569 / 0.25)","alpha":0.25098039215686274,"blur":"blur(18px)"}]
MATERIALS: [{"name":"workspace rail","color":"rgb(20, 24, 27)","alpha":1,"blur":"none"},{"name":"asset sidebar","color":"rgb(20, 24, 27)","alpha":1,"blur":"none"},{"name":"settings navigation","color":"rgb(24, 27, 31)","alpha":1,"blur":"none"}]
MATERIALS: [{"name":"workspace rail","color":"color(srgb 0.0784314 0.0941176 0.105882 / 0.25)","alpha":0.25098039215686274,"blur":"blur(28px) saturate(1.25)"},{"name":"asset sidebar","color":"color(srgb 0.0784314 0.0941176 0.105882 / 0.25)","alpha":0.25098039215686274,"blur":"blur(28px) saturate(1.25)"},{"name":"settings navigation","color":"color(srgb 0.0941176 0.105882 0.121569 / 0.25)","alpha":0.25098039215686274,"blur":"blur(18px)"}]
MATERIALS: [{"name":"workspace rail","color":"color(srgb 0.0784314 0.0941176 0.105882 / 0.25)","alpha":0.25098039215686274,"blur":"blur(28px) saturate(1.25)"},{"name":"asset sidebar","color":"color(srgb 0.0784314 0.0941176 0.105882 / 0.25)","alpha":0.25098039215686274,"blur":"blur(28px) saturate(1.25)"},{"name":"settings navigation","color":"color(srgb 0.0941176 0.105882 0.121569 / 0.25)","alpha":0.25098039215686274,"blur":"blur(18px)"}]
ZOOMED CANVASES: [{"name":"center container","color":"rgba(0, 0, 0, 0)","alpha":0,"blur":"none"},{"name":"zoomed pane container","color":"rgba(0, 0, 0, 0)","alpha":0,"blur":"none"},{"name":"reading canvas","color":"rgb(16, 18, 21)","alpha":1,"blur":"none"}]
PASS: dark real range, visible opacity change, glass off/on and reduced transparency.
OPAQUE MATERIALS (light): [{"name":"workspace rail","color":"color(srgb 0.917647 0.933333 0.92549)","alpha":1,"blur":"blur(28px) saturate(1.25)"},{"name":"asset sidebar","color":"color(srgb 0.917647 0.933333 0.92549)","alpha":1,"blur":"blur(28px) saturate(1.25)"},{"name":"settings navigation","color":"color(srgb 0.917647 0.933333 0.92549)","alpha":1,"blur":"blur(18px)"}]
SCREENSHOT: /private/tmp/getssh-sidebar-glass-validation-20261004/final/sidebar-glass-light-100.png
SCREENSHOT: /private/tmp/getssh-sidebar-glass-validation-20261004/final/sidebar-glass-light-25.png
PIXELS (settings navigation, light): {"meanRgbDifference":3.5307899305555557,"changedPixelFraction":1}
MATERIALS: [{"name":"workspace rail","color":"color(srgb 0.917647 0.933333 0.92549 / 0.25)","alpha":0.25098039215686274,"blur":"blur(28px) saturate(1.25)"},{"name":"asset sidebar","color":"color(srgb 0.917647 0.933333 0.92549 / 0.25)","alpha":0.25098039215686274,"blur":"blur(28px) saturate(1.25)"},{"name":"settings navigation","color":"color(srgb 0.917647 0.933333 0.92549 / 0.25)","alpha":0.25098039215686274,"blur":"blur(18px)"}]
MATERIALS: [{"name":"workspace rail","color":"rgb(234, 238, 236)","alpha":1,"blur":"none"},{"name":"asset sidebar","color":"rgb(234, 238, 236)","alpha":1,"blur":"none"},{"name":"settings navigation","color":"rgb(234, 238, 236)","alpha":1,"blur":"none"}]
MATERIALS: [{"name":"workspace rail","color":"color(srgb 0.917647 0.933333 0.92549 / 0.25)","alpha":0.25098039215686274,"blur":"blur(28px) saturate(1.25)"},{"name":"asset sidebar","color":"color(srgb 0.917647 0.933333 0.92549 / 0.25)","alpha":0.25098039215686274,"blur":"blur(28px) saturate(1.25)"},{"name":"settings navigation","color":"color(srgb 0.917647 0.933333 0.92549 / 0.25)","alpha":0.25098039215686274,"blur":"blur(18px)"}]
MATERIALS: [{"name":"workspace rail","color":"rgb(234, 238, 236)","alpha":1,"blur":"none"},{"name":"asset sidebar","color":"rgb(234, 238, 236)","alpha":1,"blur":"none"},{"name":"settings navigation","color":"rgb(234, 238, 236)","alpha":1,"blur":"none"}]
MATERIALS: [{"name":"workspace rail","color":"color(srgb 0.917647 0.933333 0.92549 / 0.25)","alpha":0.25098039215686274,"blur":"blur(28px) saturate(1.25)"},{"name":"asset sidebar","color":"color(srgb 0.917647 0.933333 0.92549 / 0.25)","alpha":0.25098039215686274,"blur":"blur(28px) saturate(1.25)"},{"name":"settings navigation","color":"color(srgb 0.917647 0.933333 0.92549 / 0.25)","alpha":0.25098039215686274,"blur":"blur(18px)"}]
PASS: light real range, visible opacity change, glass off/on and reduced transparency.
Sidebar glass smoke passed: isolated app, actual keyboard range, all three sidebar materials, dark/light screenshots and settings-navigation pixel differences, opaque off/reduced fallbacks, restored preferences, no renderer or IPC errors.
```

## 旧构建失败证明

新 GUI 检查先针对改动前的构建运行，退出1：真实滑块变化后，侧栏仍为固定 .8/.86，外侧截图像素差为0，并因期望 .25 得到 .8 的断言失败。证明测试抓住本次报告的实际故障。以下为原始输出。

```sh
node scripts/sidebar-glass-smoke.cjs
```

```text
SCREENSHOT: /var/folders/x3/6jlqp2j16f9dmm7t6w9dmlfm0000gn/T/getssh-sidebar-glass-validation-20261004/sidebar-glass-dark-100.png
SCREENSHOT: /var/folders/x3/6jlqp2j16f9dmm7t6w9dmlfm0000gn/T/getssh-sidebar-glass-validation-20261004/sidebar-glass-dark-25.png
PIXELS (dark): {"meanRgbDifference":0,"changedPixelFraction":0}
MATERIALS: [{"name":"workspace rail","color":"rgba(20, 24, 27, 0.8)","alpha":0.8,"blur":"blur(28px) saturate(1.25)"},{"name":"asset sidebar","color":"rgba(20, 24, 27, 0.8)","alpha":0.8,"blur":"blur(28px) saturate(1.25)"},{"name":"settings navigation","color":"color(srgb 0.0941176 0.105882 0.121569 / 0.86)","alpha":0.8588235294117647,"blur":"blur(18px)"}]
Sidebar glass smoke failed: ExpectError: workspace rail alpha (rgba(20, 24, 27, 0.8))

expect(received).toBeCloseTo(expected, precision)

Expected: 0.25
Received: 0.8

Expected precision:    2
Expected difference: < 0.005
Received difference:   0.55
    at captureRawStack (/Volumes/Developer/GETSSH/node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core/lib/coreBundle.js:8588:17)
    at callMatcherAsStep (/Volumes/Developer/GETSSH/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/lib/matchers/expect.js:13310:57)
    at Object.toBeCloseTo (/Volumes/Developer/GETSSH/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/lib/matchers/expect.js:13302:23)
    at assertMaterials (/Volumes/Developer/GETSSH/apps/getssh-client/scripts/sidebar-glass-smoke.cjs:87:69)
    at async /Volumes/Developer/GETSSH/apps/getssh-client/scripts/sidebar-glass-smoke.cjs:143:7 {
  matcherResult: {
    message: 'expect(received).toBeCloseTo(expected, precision)\n' +
      '\n' +
      'Expected: 0.25\n' +
      'Received: 0.8\n' +
      '\n' +
      'Expected precision:    2\n' +
      'Expected difference: < 0.005\n' +
      'Received difference:   0.55',
    pass: false,
    name: 'toBeCloseTo'
  }
}
```

## 首次修后原生外侧空白裁片检查

材料 alpha 正确变化，但平坦同色底图使该裁片平均 RGB 差只有0.333，未达到测试的>.5阈值；这项原始输出保留，最终选择设置导航空白裁片，仍使用同一色差阈值并检查三处材料。没有模拟背景或改变生产颜色。

```text
OPAQUE MATERIALS (dark): [{"name":"workspace rail","color":"color(srgb 0.0784314 0.0941176 0.105882)","alpha":1,"blur":"blur(28px) saturate(1.25)"},{"name":"asset sidebar","color":"color(srgb 0.0784314 0.0941176 0.105882)","alpha":1,"blur":"blur(28px) saturate(1.25)"},{"name":"settings navigation","color":"color(srgb 0.0941176 0.105882 0.121569)","alpha":1,"blur":"blur(18px)"}]
SCREENSHOT: /private/tmp/getssh-sidebar-glass-validation-20261004/final/sidebar-glass-dark-100.png
SCREENSHOT: /private/tmp/getssh-sidebar-glass-validation-20261004/final/sidebar-glass-dark-25.png
PIXELS (dark): {"meanRgbDifference":0.3333333333333333,"changedPixelFraction":0}
MATERIALS: [{"name":"workspace rail","color":"color(srgb 0.0784314 0.0941176 0.105882 / 0.25)","alpha":0.25098039215686274,"blur":"blur(28px) saturate(1.25)"},{"name":"asset sidebar","color":"color(srgb 0.0784314 0.0941176 0.105882 / 0.25)","alpha":0.25098039215686274,"blur":"blur(28px) saturate(1.25)"},{"name":"settings navigation","color":"color(srgb 0.0941176 0.105882 0.121569 / 0.25)","alpha":0.25098039215686274,"blur":"blur(18px)"}]
Sidebar glass smoke failed: ExpectError: dark actual sidebar pixels change

expect(received).toBeGreaterThan(expected)

Expected: > 0.5
Received:   0.3333333333333333
    at captureRawStack (/Volumes/Developer/GETSSH/node_modules/.pnpm/playwright-core@1.63.0/node_modules/playwright-core/lib/coreBundle.js:8588:17)
    at callMatcherAsStep (/Volumes/Developer/GETSSH/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/lib/matchers/expect.js:13310:57)
    at Object.toBeGreaterThan (/Volumes/Developer/GETSSH/node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/lib/matchers/expect.js:13302:23)
    at /Volumes/Developer/GETSSH/apps/getssh-client/scripts/sidebar-glass-smoke.cjs:147:85 {
  matcherResult: {
    message: 'expect(received).toBeGreaterThan(expected)\n' +
      '\n' +
      'Expected: > 0.5\n' +
      'Received:   0.3333333333333333',
    pass: false,
    name: 'toBeGreaterThan'
  }
}
```

