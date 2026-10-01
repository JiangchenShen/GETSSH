# GETSSH 3.0 依赖升级计划

> 核对日期：2026-10-01
> 依据：`pnpm outdated`、`pnpm audit`、`cargo update --dry-run`、`cargo metadata`、`releases.electronjs.org`、各包官方 changelog，以及仓库代码检索（所有影响都标了代码位置）。
> 本文取代 `dependency-update-report.md` 和 `dependency-licenses.md` 中有误的结论，那两份报告的勘误见文末。

## 一、先说结论

1. **Electron 42 在 2026-10-20 停止维护，正好是 3.0 发布当天**（Electron 45 也定在这一天转正）。
   - 3.0 如果停在 42，发布当天起就收不到 Chromium 安全补丁。
2. **当前的 42.3.0 落后 42 线 32 个补丁版本**，期间有 5 个 Electron 安全公告。
   - 按 GETSSH 现有配置，这 5 个都触发不到（见第三节）。
   - 但 Chromium/V8 的安全回补也一并落下了。
   - 升到 42.11.10 不涉及 ABI 变化、不用改代码，可以马上做。
3. **运行时依赖有真实漏洞**：
   - `adm-zip`、`electron-updater`（`builder-util-runtime`、`js-yaml`）有高危公告；
   - 构建链（`electron-builder`、`tar`、`xmldom`、`undici`）和 `vite` 也有。
   - 都能用补丁版或小版本修掉。
4. **"ABI 割裂"现在只剩一个来源：`better-sqlite3-multiple-ciphers` 12.x。**
   - 它直接链接 V8，每换一次 Electron 大版本都要从源码重编；13.x 已改用 N-API。
   - `node-pty` 1.1.0 和 9 个 Rust 原生模块都走 N-API，换 Electron 版本不用重编。
5. **升到 44 有三个硬约束**：
   - 放弃 macOS 12 Monterey，最低要 macOS 13；
   - 主进程剪贴板 API 改成 Promise；
   - 锁定的 `node-abi` 4.31.0 不认识 44，需要升到 4.33 以上。
6. **打包时删掉了所有许可证文件，这是合规问题。**
   - 打包配置里的 `"!**/LICENSE*"` 和 `"!**/*.txt"` 删掉了全部依赖的许可证文件。
   - mac 安装包里也没有 Electron 的 `LICENSE` 和 `LICENSES.chromium.html`。
   - MIT、BSD、Apache 都要求随分发附上版权和许可声明。

## 二、分阶段计划

### 阶段 0：低风险，3.0 之前完成（约 1 天，加冒烟测试）

先把 keystore 的改动单独提交，再在新分支上做这一阶段，两份 diff 分开。

#### npm 安全修复

| 包 | 当前 → 目标 | 原因 |
|---|---|---|
| `electron` | 42.3.0 → **42.11.10（锁死版本）** | 修掉 5 个公告和 Chromium 回补。不要停在 42.3.1–42.9.x 之间：42.3.1/2 有严重的 Buffer 越界，42.3.3–42.9.x 有预加载代码缓存投毒。 |
| `@types/node` | ^22 → **^24.19** | Electron 42/44 内置的都是 Node 24（42.11.10 是 24.19.0）。不要上 26。 |
| `adm-zip` | 0.5.18 → **0.6.1** | 修掉 10 个公告。导出功能用到的 `new AdmZip()`、`addLocalFile`、`writeZip` 在新版里代码没变，导出行为不受影响。 |
| `electron-updater` | 6.8.3 → **6.8.9** | 修掉跨域跳转泄露 token（GHSA-p2f4-r6v6-j797）。 |
| `js-yaml`（间接依赖） | 4.1.1 → **≥4.3.2**（用 pnpm override） | 修掉 4 个 DoS 公告。升 `electron-updater` 不会自动带上它。 |
| `electron-builder` | 26.8.1 → **26.15.3** | 修掉 `app-builder-lib` 的公告，同时更新构建链里的 `tar`、`xmldom`、`form-data` 等。 |
| `vite` | 8.0.14 → **8.3.1** | 修掉 `server.fs.deny` 的绕过（只影响开发服务器）。 |

#### 补丁和小版本（无破坏性变更）

- `react` / `react-dom` 19.3.0，`@types/react*` 19.3.0
- `zustand` 5.0.15，`immer` 11.1.18
- `i18next` 26.4.2，`react-i18next` 17.0.15（这两个也是将来升 TS 7 的前提）
- `tailwindcss` 和 `@tailwindcss/vite` 4.3.3（两个都是锁死版本，要一起改）
- `lucide-react` 1.49.0：跨度大，图标改名的话 `tsc` 会报出来
- `react-icons`、`fuse.js`、`socks`、`http-proxy-agent`、`p-limit`、`@vitejs/plugin-react`、`@playwright/test`、`@types/ssh2`

只在开发环境用的大版本，可以直接升：
- `vitest` 5 + `jsdom` 30：没有 vitest 配置，测试都已符合新规则；
- 需要在 `.gitignore` 里加 `.vitest/`。

#### 删除未使用的依赖（同时消掉一批 audit 告警和许可证条目）

| 包 | 证据 |
|---|---|
| `dompurify` | 没有任何代码导入它，构建产物里也没有这个字符串。插件 SVG 实际用的是自写的 `src/plugins/svgSanitizer.ts`，README 和 PRD 里"用 DOMPurify"的说法要改。 |
| `@testing-library/jest-dom` / `react` / `user-event` | 没有任何导入，也没有 setup 文件。 |
| `@types/better-sqlite3` | 给的是上游 `better-sqlite3` 的类型，项目没用到；bsmc 自带类型。 |
| `vite-plugin-electron-renderer` | `vite.config.mts` 里没有用。 |
| `@vitest/coverage-v8` | 没有任何地方开启覆盖率。 |
| 仓库根目录 `package-lock.json` | 7 月 3 日以后再没更新过的 npm 锁文件。项目用 pnpm，它只会让 GitHub 依赖告警误报。 |

#### Rust

- `cargo update`：83 个 crate 有语义版本兼容的更新（例如 `napi` 3.9→3.14、`regex` 1.13、`libc` 0.2.189）。
- 升完跑 `cargo test` 和 `clippy`（macOS 和 Windows 两个目标）。

#### 发布基础设施（和升级一起做）

- **许可证合规**：
  - 去掉 `files` 里的 `!**/LICENSE*` 和 `!**/*.txt`，或者改成生成一份汇总声明。
  - 渲染进程和主进程用 Vite 8 自带的 `build.license`；Rust 用 `cargo-about`。
  - 把 Electron 的 `LICENSE` 和 `LICENSES.chromium.html` 带进安装包。
  - 补上 `libffmpeg` 的 LGPL 说明，以及两个字体的许可：MiSans 是小米的许可协议，Reddit Sans 是 OFL-1.1。
  - 同步更新 `docs/legal/THIRD_PARTY_LICENSES.md`，现在这份是 5 月手写的，已经过时。
- **构建资源没有进 git**：
  - `.gitignore` 第 4 行的 `build/` 把 `apps/getssh-client/build/` 整个忽略了，里面有图标、DMG 背景、`entitlements.mac.plist`、`installer.nsh`。
  - CI 的 release 构建拿不到这些文件，`dmg.background` 指向的文件也不存在。
  - 应该把这些资源纳入 git，只排除里面那份过期的 `better_sqlite3.node`。
- **CI**：
  - 加 `dependabot.yml`，覆盖 npm、cargo、github-actions，按组合并 PR。
  - 加 `pnpm audit --prod` 和 `cargo audit`（或 `cargo-deny`），后者同时检查许可证。

### 阶段 1：Electron 44 + better-sqlite3-multiple-ciphers 13（需要你拍板）

两件事一起做，做完以后所有原生模块都走 N-API，以后换 Electron 大版本不用再重编。

#### 需要改的代码

| 改动 | 位置 |
|---|---|
| 44 的主进程 `clipboard` 改成 Promise，4 处补 `await` | `electron/main/PluginManager.ts:235, 241, 499, 507` |
| 43 起没给 `defaultPath` 的打开/保存对话框默认打开 `~/Downloads`。"选择私钥"应该默认 `~/.ssh` | `windowHandler.ts:10, 24`、`profileHandler.ts:141`、`systemHandler.ts:354` 等 |
| `node-abi` 用 override 升到 ≥4.33，否则 `install-app-deps` 和打包时会报 "Could not detect abi for 44" | `pnpm-lock.yaml`（`@electron/rebuild` 4.0.4 → `node-abi` 4.31.0） |
| bsmc 13.0.3 的 `exports` 缺 `types` 条件，`tsc -b` 会报 TS7016。等 13.0.4（beta 已修）或加一个类型 shim | `DatabaseManager.ts:1`、`startupSmoke.ts:5`、`databaseKeys.ts:2` |
| bsmc 13 把 8 个平台的预编译文件都放进了 npm 包（约 20 MB），打包时只留目标平台那个 | `package.json` 的 `build.files` 和 `asarUnpack` |
| 最低系统要求改为 macOS 13；`getssh-keystore/build.rs` 里的 Swift target 顺手改成 13.0 | `package.json` 的 `build.mac`、`rust-core/getssh-keystore/build.rs:36` |

#### 已核实不受影响

- `key`/`rekey` 的 Buffer 接口、`cipher = 'sqlcipher'` 参数、`readonly`/`fileMustExist` 选项都没变。
- SQLCipher 默认参数没变（v4、256000 次迭代、SHA512）。
- 原始十六进制密钥照样跳过 KDF。
- 新版允许在 WAL 模式下 rekey，但我们 rekey 前本来就切到 DELETE 模式，不受影响。
- 44 删掉的 login item、Unity、`net.request` 的 Sec-Fetch、`webview` 等 API，项目里都没有用到。

#### 测试

- 两个平台都跑 `test:database-encryption`、`test:keystore-e2e`、`test:packaged-startup`。
- 用 v12 写出的**测试库副本**验证 v13 能打开。
- 在 Intel Mac 和 Windows arm64 上检查 WebGL 终端渲染：44 把 ANGLE 改成了静态链接。

#### 工作量

约 1 天改代码、1 天弄 CI、2–3 天回归测试。

#### 时间上的两种选择

- **A（推荐，前提是同意放弃 macOS 12）**：阶段 0 完成后马上开始，争取 10 月 8 日前合入，留两周观察。3.0 直接发 44，支持到 2027-03-02。
- **B**：3.0 用 42.11.10 发布，3.0.1 在几周内跟进 44（或 45）。代价是 3.0 刚发布就停在一条不再维护的 Electron 线上。
- 如果必须保留 macOS 12，只能用 43：支持 Monterey，不用改剪贴板，2027-01-05 停止维护。不过对话框的变化和 bsmc 12 的源码编译仍然存在。

### 阶段 2：3.0 之后

| 项目 | 说明 |
|---|---|
| TypeScript 7.0 | 项目没有用到编译器 API，tsconfig 里也没有被删掉的选项，风险不高，但对产品没有收益。前提是先升 `i18next`/`react-i18next`（阶段 0 已包含），再用 TS 7 跑一遍 `tsc -b`，和 TS 6 的结果对比。 |
| `vite-plugin-electron` 1.x | 配置不用改，`rollupOptions` 可选改名为 `rolldownOptions`。main 和 preload 默认改成 `platform: 'node'`，要验证打包产物里的 external 有没有变化。 |
| `framer-motion` 13 | **不需要改 import**（Gemini 报告说要改名为 `motion`，这是错的）。13.x 八周内发了 14 个版本，升级时锁死版本号。 |
| Rust `napi` 统一到 3.x | 现在 8 个 crate 用 2.x、1 个用 3.x。 |
| Electron 45（10-20 发布） | 45 起同步版 `safeStorage` 被废弃、46 删除，要改成异步：`secretStore.ts:50–84`、`PluginManager.ts:100–415`。 |

## 三、Electron 42.3.0 现有的安全公告

| 公告 | 修复版本 | 对 GETSSH |
|---|---|---|
| GHSA-hq2x-r82h-9wj4：沙箱 iframe 弹窗丢失沙箱 | 42.5.2 | 触发不到：插件 iframe 只给了 `allow-scripts`，所有窗口的 `setWindowOpenHandler` 都返回 deny |
| GHSA-gr2m-v5gq-v685：沙箱顶层文档打开的窗口不继承沙箱 | 42.9.2 | 触发不到：`will-navigate` 只允许 `dist/index.html` |
| GHSA-j84w-jfhq-vhvj：自定义协议跨域读取 | 42.9.2 | 触发不到：`getssh-plugin` 已设 `corsEnabled: true`，并用 `protocol.handle` 处理 |
| GHSA-9qh4-3jw8-366w：`<webview>` 在 Worker 里开启 Node | 42.9.2 | 触发不到：没有用 webview |
| GHSA-r4w5-6pfg-jxp5：跨分区缓存复用 | 42.5.1 | 触发不到：只用默认 session |

## 四、许可证的真实情况

- **npm 运行时依赖闭包**：153 个包。
  - 133 个 MIT、7 个 ISC、3 个 Apache-2.0、3 个 BSD-3-Clause。
  - 另外各 1 个：0BSD、Unlicense、Python-2.0（`argparse`）、BlueOak-1.0.0（`sax`）、CC0、MIT/WTFPL、BSD/MIT/Apache。
  - 注意：渲染进程打包进去的 react、xterm、i18next 等写在 devDependencies 里，也会随产品分发，所以要用 Vite 的 `build.license` 按实际打包内容生成清单。
- **Rust 运行时 crate**：214 个，全部是宽松许可证。
  - 例如 `subtle` 是 BSD-3-Clause（不是 MIT），`unicode-ident` 带 Unicode-3.0，`foldhash` 是 Zlib，`r-efi` 可选 LGPL/MIT/Apache（我们按 MIT/Apache 使用）。
- **安装包里的其他组件**：
  - Electron/Chromium：随 `LICENSES.chromium.html` 一起提供；
  - `libffmpeg.dylib`：LGPL-2.1，动态链接；
  - MiSans 字体：小米字体许可协议，具体条款要再确认；
  - Reddit Sans 字体：OFL-1.1，要求附上许可文本。
- **GETSSH 本身用 Apache-2.0 开源。** 许可证报告里"可以闭源商用"那段结论和项目无关。

## 五、顺带发现的既有问题（和升级无关）

1. **导出功能的备份恢复不了（需要你决定）**：
   - `export-database-all` 只打包 `*.db`，不带 `-wal`，也不带 `keyring.json`；
   - 换成 keystore 以后，单独的 `.db` 文件离开 `keyring.json`、主密码或恢复码就打不开；
   - `import-database` 打开外部库时也不带密钥；
   - 你之前说过导出功能不要动，所以我没有改。
2. `tsconfig.node.json:14` 写的是 `vite.config.ts`，实际文件是 `vite.config.mts`，所以 Vite 配置一直没有做类型检查。
3. mac 构建的签名身份是 `identity: null`。42 起 macOS 通知要求应用已签名，所以未签名版本上插件读剪贴板的提醒永远不会显示。
4. CI 矩阵里有 `macos-15-intel`，但 `build.mac.target` 只有 arm64。

## 附：Gemini 两份报告的勘误

`dependency-update-report.md`：

| 原文 | 实际情况 |
|---|---|
| Electron 42 = Node 22.x、ABI 127；44 = ABI 137 | 42.3.0 = Node 24.15.0、ABI 146；44.5.1 = Node 24.21.0、ABI 149 |
| 所有原生模块（包括 Rust N-API 模块）都要重编 | 只有 bsmc 12 要重编；`node-pty` 和 Rust 模块都是 N-API |
| 建议先升 43，3–6 个月后再升 44 | 42 在 10-20 就停止维护；漏掉了 macOS 13 最低要求、剪贴板 API 变化和 `node-abi` 的阻断问题 |
| framer-motion 13 改名为 `motion`，要改 import | 两个包同步发布，不需要改 import |
| jest-dom 7 删除了已废弃的 matcher | release notes 里没有这条；而且项目里根本没用到这个包 |
| `@types/node` 暂缓 | 应该现在就升到 ^24 |
| 没有提到任何漏洞 | `pnpm audit` 显示运行时依赖有 13 个公告（9 个高危），全部依赖合计 120 个 |
| bsmc 13 只需回归测试 | 13.0.3 有 TS7016 的类型导出问题，还会多打包约 20 MB 预编译文件 |

`dependency-licenses.md`：

| 原文 | 实际情况 |
|---|---|
| 覆盖了包括间接依赖在内的全部包 | 只列了 52 个直接依赖。实际运行时 npm 依赖有 153 个，Rust crate 有 214 个 |
| bsmc 内置的是 SQLCipher（BSD） | 实际是 SQLite3 Multiple Ciphers（MIT），只是兼容 SQLCipher 格式 |
| 没有 LGPL | 安装包里有 `libffmpeg`（LGPL-2.1） |
| 建议新建 `THIRD_PARTY_LICENSES` | 仓库里已经有 `docs/legal/THIRD_PARTY_LICENSES.md`，但它过时了，也没有打进安装包 |
| 没有提到 | 打包配置删掉了所有许可证文件；字体许可也没有处理 |
