# GETSSH 3.0 RC · FUSION · 预览版计划

日期：2026-10-06。客户端构建版本：`3.0.0-rc.1`。

本次从当前未提交工作区复制源码、依赖和构建缓存到 `/private/tmp/getssh-fusion-rc-build-nd6xy6ns`，在该快照中构建。没有切换分支、覆盖旧安装包、安装到 Applications、推送或发布。测试在加载后端前设置临时 Electron home/userData/sessionData，并使用 mock keychain；设备密钥检查只创建临时测试 scope。

## 交付文件

- `dist/FUSION-RC-2026-10-06/GETSSH-FUSION-3.0.0-rc.1-arm64.dmg`：135,383,647 bytes。
- SHA256：`82a6b2712af8e74689efb747018bc799e68b4186a9a4c34a8221f874c50c7218`。
- `dist/FUSION-RC-2026-10-06/GETSSH-FUSION-Setup-3.0.0-rc.1-x64.exe`：124,798,007 bytes。
- SHA256：`3200055c77ba0bd38bd0062cc84dfb434cc758706f6fa41a78c2d7d9c336af54`。
- `dist/FUSION-RC-2026-10-06/SHA256SUMS.txt`：安装包、blockmap 和 Windows 源码快照校验值。
- `dist/FUSION-RC-2026-10-06/verification-logs/`：下述命令的原始输出，包括失败尝试。

Mac 应用使用 ad-hoc 签名和仓库现有运行时 entitlement；签名通过 deep/strict 检查。没有 Developer ID 签名或 Apple 公证。Windows 包没有 Authenticode 签名，已完成安装包内容静态验证，尚未在 Windows 系统执行安装与启动测试。本次安装包定位为预览测试包。

## 版本与界面

`apps/getssh-client/package.json` 是版本和发行信息来源：`3.0.0-rc.1`、RC、FUSION、preview。关于页显示 `GETSSH 3.0 RC`，次行中文 `FUSION · 预览版计划` / 英文 `FUSION · Preview Program`，版本行保留完整 semver。更新检查、法律链接、内核和平台信息均保留。

关于页 3 项回归通过；用临时副本把标题版本写死为 3.0，测试准确失败。完整命令和原始输出在 `verification-logs/about-ui-checks.txt`。中英文设置导航验证见 `verification-logs/about-preview-checks.txt`；早期开发预览截图 `about-fusion-rc-{zh,en}-dark.png` 仅保留本地，不代表安装包完整交互验证。GitHub 中保留下方两张最终应用资源集成截图。

额外 UI 集成使用开发 Electron 加载实际包的 app.asar，并显式覆盖 packaged/resource 路径分支，在临时 home/userData 下加载真实原生模块和守护进程。状态为 secure，守护进程 running，网关 native/ready，三项统计为真实 0，持久化 available；中文/英文关于信息正确。截图为 `docs/screenshots/about-fusion-rc-bundle-{zh,en}-dark.png`。这是应用资源集成验证；真正应用可执行文件的启动验证见下方 DMG 记录。

首次额外 UI 测试设置了过长 TMPDIR，产生 117 字节 Unix socket 路径，超过本机 SDK `sockaddr_un.sun_path[104]`，因此守护进程未启动。仅调整测试为独立短临时目录，路径变为 70 字节后验证成功。未为此修改生产代码。失败和成功原始输出见 `about-bundle-preview-first-failure.log` 与 `about-bundle-preview-smoke.log`；临时主进程、其所属守护进程及两个临时目录均已清理。

## 构建与安装包检查

最终命令与原始输出分别保存于对应日志：

| 检查 | 命令 | 日志 |
|---|---|---|
| TypeScript | `pnpm exec tsc -b tsconfig.json --force --pretty false` | `tsc.txt` |
| 编译客户端/主进程/preload | `pnpm exec vite build` | `vite.txt` |
| 十个 Rust 模块 | `RUST_TARGET=aarch64-apple-darwin node scripts/build-native.js` | `native.txt` |
| 独立守护进程 | `cargo build --release -p ocean-sentinel --no-default-features --bins` | `tools.txt` |
| 应用目录打包 | `pnpm exec electron-builder --mac --arm64 --dir --publish never --config.npmRebuild=false --config.electronDist=<cached Electron 44.5.1 zip>` | `mac-unpacked.txt` |
| ad-hoc 签名 | `node sign-preview.cjs <GETSSH.app>` | `sign.txt` |
| 签名与包内容 | `codesign --verify --deep --strict --verbose=2 <GETSSH.app>`；`node scripts/check-package.cjs <app.asar> darwin arm64` | `package-checks.txt`，最终 DMG 签名另见下行 |
| 真实应用启动 | `pnpm run test:packaged-startup` | `packaged-startup.txt` |
| DMG | `pnpm exec electron-builder --prepackaged <GETSSH.app> --mac dmg --arm64 --publish never --config.dmg.artifactName=GETSSH-FUSION-${version}-${arch}.${ext}` | `dmg.txt` |
| 最终 DMG | `hdiutil verify`；只读挂载；deep/strict 签名；包内容；挂载包实际启动；卸载 | `dmg-verification.txt` |

依赖复制到快照后，不在原工作区重装或重建。使用 `pnpm_config_verify_deps_before_run=false` 和快照内 pnpm store；Electron builder 使用本地 Electron zip。第三方原生依赖的版本匹配由实际启动检查验证。

最终实际启动输出：

```text
COMMAND: pnpm run test:packaged-startup
$ node scripts/security/packaged-startup-smoke.cjs
Packaged GETSSH startup smoke passed on darwin/arm64 (Electron 44.5.1; 13 native/runtime modules).

EXIT: 0
```

挂载 DMG 中的应用也输出同一成功结果，且其 app.asar SHA256 与已验证应用完全一致。检查覆盖临时 SQLCipher 查询、本地 PTY、回环 SSH 握手、十个 Rust 模块加载和导出、设备 keystore 临时 scope 的加密往返、getssh-store SQLite 引擎以及守护进程文件。此检查不等同于完整终端会话、所有安全功能或日常数据迁移验收。

## 构建中修复的问题

- 旧打包启动探针仅设置环境变量 HOME，Electron 在 macOS 上仍解析真实 home。现在探针是 main 的第一个导入，只在 packaged + CI + 有效随机 token 时独占创建临时 home，设置 Electron 路径，并断言隔离生效。正常启动不改变路径。runner 仅清理本次独占创建的临时目录。
- 针对性隔离检查覆盖正常/开发/无效 token、临时路径、mock keychain、目录独占创建、symlink 拒绝；在临时内存副本删除 setPath(home) 后断言失败。命令和原始输出见 `startup-isolation-check.txt`。
- 实际启动发现新编译的 sysprobe 和 store 的 Mach-O LINKEDIT 字符串池未按 8 字节对齐；签名前已有问题，签名未改变偏移。该症状与 [Rust 上游 issue #157750](https://github.com/rust-lang/rust/issues/157750) 描述一致。Apple target 构建追加 `-C strip=none`，重新编译全部十个模块后，对齐、实际加载均通过。Windows 参数保持原样。签前/签后原始偏移和 arm64 文件检查见 `linkedit-check.txt`。
- 初次包收集遇到复制后的 pnpm store 路径与权限问题，改为快照内的 store；DMG 磁盘映像服务需要沙盒外运行。失败输出保留，未将失败包交付。
- Vite 仍报告主渲染 bundle 大于 2000 kB；Rust 构建仍有现有 workspace profile/N-API metadata 弃用提示，构建 exit 0。

## Windows x64 本地构建与验证

Windows x64 安装包已在这台 macOS arm64 上交叉构建完成。此前仅凭 PATH 中缺少工具就判断本地不能构建，这个结论已纠正。工具、SDK 和缓存均位于隔离临时目录，没有安装系统工具链或改动原工作区的原生二进制。

使用 [cargo-xwin](https://github.com/rust-cross/cargo-xwin) 0.23.1、Apple clang 21、与 Rust 1.95 匹配的 LLVM/LLD 22、Windows SDK 10.0.26100 和 MSVC CRT 14.44。SDK 由 cargo-xwin 下载到 `/private/tmp/getssh-windows-cross-tools-lGo7zT/xwin`。`RUSTFLAGS=-C target-feature=+crt-static` 同时用于 Rust 与 SQLite C 编译。

十个 N-API 模块均以 `pnpm exec napi build --release --target x86_64-pc-windows-msvc --no-js --cross-compile` 构建；带 napi 元数据的模块加 `--platform`，keystore 加 `--features napi`。守护进程与沙箱使用：

```sh
cargo xwin build --release --target x86_64-pc-windows-msvc -p ocean-sentinel --no-default-features --bins
```

复现环境与逐模块命令保存在 `verification-logs/windows/env.sh` 和 `build-rust.sh`。Windows 两个 EXE 从目标输出复制到快照 `target/release/`；旧 Mac addon 和 Mac watchdog 暂存在快照输入之外，已完成的 Mac App 与 DMG 保持原文件。

| 检查 | 结果 | 原始输出（`verification-logs/windows/`） |
|---|---|---|
| 原生构建 | 10 个 Rust `.node` 与两个进程 EXE release 编译成功 | `cross-build-all.log`，`cross-build-*.log` |
| PE 与依赖 | 20 个目标文件均为 x64 PE32+；Rust、SQLite 与 PTY 无额外 VC 动态运行库依赖 | `native-dependency-audit.txt`，`rust-native-dependency-audit.txt`，`packaged-native-dependency-audit.txt` |
| Node/N-API 兼容静态检查 | Rust 最高 N-API feature 为 4，SQLite 为 10，PTY 为 8；第三方 addon 所需 Node 符号均存在于实际 Windows Electron 宿主 | `rust-napi-feature-audit.txt`，`node-symbol-audit.txt` |
| 应用目录 | `electron-builder --win --x64 --dir --publish never`，使用校验通过的官方 Electron 44.5.1 Windows zip，保留现有第三方 N-API prebuild | `win-unpacked.txt` |
| 包内容 | 增强的 `check-package.cjs` 验证真实 PE 架构、N-API addon、PTY helpers 解包位置、两个 EXE | `win-package-checks.txt`，`pe-check-output.txt`，`pe-check-mutant-output.txt` |
| NSIS | 官方 NSIS 1.2.1 工具集在 Mac ARM 本地运行，明确限定目标 x64 | `nsis.txt`，`windows-x64-builder.cjs` |
| 最终安装包 | 从 EXE 提取 `app-64.7z`，完整性检查与解压后 244 个文件逐一 SHA256 匹配已验证应用目录，包内容检查再次通过 | `installer-list.txt`，`installer-payload-verification.txt` |
| 版本资源 | app.asar 元数据与应用/安装程序的 PE 版本资源均为 `3.0.0-rc.1`；发行信息为 RC/FUSION/preview，应用图标存在 | `version-resources.txt` |

最终命令与原始输出摘录（完整记录在上述日志）：

```text
COMMAND: pnpm exec electron-builder --config /private/tmp/getssh-fusion-rc-build-nd6xy6ns/windows-x64-builder.cjs --prepackaged /private/tmp/getssh-fusion-rc-build-nd6xy6ns/dist/win-unpacked --win --x64 --publish never
  • building        target=nsis file=/private/tmp/getssh-fusion-rc-build-nd6xy6ns/dist/GETSSH-FUSION-Setup-3.0.0-rc.1-x64.exe archs=x64 oneClick=false perMachine=true
EXIT: 0

Installer payload matches verified win-unpacked byte for byte: 244 files.
COMMAND: node scripts/check-package.cjs /private/tmp/getssh-fusion-rc-build-nd6xy6ns/windows-installer-verify/app/resources/app.asar win32 x64
Package checks passed: /private/tmp/getssh-fusion-rc-build-nd6xy6ns/windows-installer-verify/app/resources/app.asar (win32/x64; 589 entries)
EXIT: 0
```

初次 `--prepackaged --x64` 构建仍采用 package.json 中的 x64/arm64 目标列表，双架构检查失败。已保存失败日志 `nsis-first-target-selection-failure.txt`，用仅含 x64 的临时配置重建成功；失败产物未交付。NSIS 安装引导程序自身为 32 位，实际嵌入的是已验证的 x64 应用。

`scripts/build-native.js` 现在在非 Windows 主机编译 Windows MSVC target 时自动加 `--cross-compile`，Windows 原生构建与 Mac strip 修复保持各自原有行为。临时选项检查和 PE 架构检查都能拒绝错误配置/架构；PE 检查删除架构断言后的 mutant 按预期失败。日志为 `native-build-options.txt` 与 `pe-check-mutant-output.txt`。

另保留源码快照 ZIP、SHA256 manifest、仅限 x64 的 builder 配置及 `build-windows-x64.ps1` 供 Windows 标准账户复现。PowerShell 脚本尚未在 Windows 执行。本次交付不代表 Windows 实机安装、启动或完整功能验收通过；Windows 的 `test:packaged-startup` 仍待实机运行。
