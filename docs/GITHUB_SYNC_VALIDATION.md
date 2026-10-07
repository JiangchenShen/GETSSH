# Tidal Engine / Ocean Sentinel GitHub 同步

日期：2026-10-06。目标分支：`v3-next`。

本次同步完成改名、Ocean Sentinel crate 合并，以及本聊天中的分屏、按钮反馈、主页与安全仪表盘、侧栏透明度、持久化过滤统计和 FUSION RC 关于信息。旧 crate 和旧 TypeScript 路径删除与新路径一起提交。

`.gitignore` 将原本只在本机生效的 `.node` / `.local` 规则共享到仓库，忽略安装包、原生二进制、工具缓存、环境凭证和本地编辑器设置。安装图标、背景、NSIS 模板和 Mac entitlements 是构建源码，明确保留。源码、正式类型声明、Cargo/pnpm lockfile、回归测试和最终合成数据 UI 截图保留在仓库。既有研究报告、未审 chaos/stress 脚本、依赖报告、失败截图仍在本地；没有删除这些文件。`.vscode/settings.json` 只取消 Git 跟踪，磁盘内容 SHA256 前后相同。

忽略检查实际覆盖 14 个应忽略路径和 14 个应共享路径。暂存树没有安装包、原生二进制、依赖缓存或私有工具目录；新增 Ocean Sentinel、Tidal Engine、bridge、网关和安装资源均存在。源码 whitespace 检查通过；验证文档中的原始输出保留原本的行尾空格。

验证以 `git write-tree` 固定实际暂存树，并用 `git archive` 导出到临时目录，未切换工作区或分支。依赖指向此前隔离复制的构建依赖；真实 Ocean Sentinel Mac addon 使用本次已编译模块。HOME / USERPROFILE 指向新的临时测试目录。此检查不是从零下载依赖的安装验证。

以下记录三项检查的实际命令与未经编辑的原始输出。其他真实原生、IPC、UI 与安装包验证见各功能 `*_VALIDATION.md`，包括 Windows 仍待实机启动验证的限制。

## TypeScript

```text
COMMAND: /private/tmp/getssh-fusion-rc-build-nd6xy6ns/apps/getssh-client/node_modules/.bin/tsc -b tsconfig.json --force --pretty false

EXIT: 0
```

## Vite

```text
COMMAND: /private/tmp/getssh-fusion-rc-build-nd6xy6ns/apps/getssh-client/node_modules/.bin/vite build
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
dist/assets/index-rx_bd1JM.js                2,524.97 kB │ gzip: 778.37 kB

[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 2000 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 444ms
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
dist-electron/main/PluginProcessSandbox-CHJSkg2O.js    8.71 kB │ gzip:   3.24 kB
dist-electron/main/index.js                          698.16 kB │ gzip: 203.35 kB

✓ built in 62ms
vite v8.3.1 building client environment for production...
transforming...
✓ 2 modules transformed.
rendering chunks...
computing gzip size...
dist-electron/preload/index.js  12.95 kB │ gzip: 2.91 kB

✓ built in 4ms

EXIT: 0
```

## 改名、网关与界面回归

```text
COMMAND: /private/tmp/getssh-fusion-rc-build-nd6xy6ns/apps/getssh-client/node_modules/.bin/vitest run src electron/main/renameIntegration.test.ts electron/main/security/SecureCenter.status.test.ts electron/main/services/OceanSentinel.test.ts electron/main/services/ai/LlmGateway.metrics.test.ts

 RUN  v5.0.3 /private/tmp/getssh-github-upload-20261006/staged-source/apps/getssh-client


 Test Files  20 passed (20)
      Tests  192 passed (192)
   Start at  19:53:01
   Duration  1.78s (environment 52%, tests 25%, import 13%, transform 9%, worker 1%)

    Isolate  20 workers spawned · ~385ms startup each (spawn + environment, per file)
             at least ~471ms faster with isolate: false — reuses workers across files instead of one per file


EXIT: 0
```
