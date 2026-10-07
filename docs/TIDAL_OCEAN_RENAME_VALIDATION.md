# Tidal Engine / Ocean Sentinel 重命名验证

日期：2026-10-03。

已在现有 `v3-next` 工作区接续完成：`nexus-core` → `tidal-engine`，以及 watchdog、脱敏网关与进程沙箱 Rust 源码合入 `ocean-sentinel`。N-API 库与 `watchdog` / `getssh-sandbox` 两个独立可执行入口保留原有进程边界。TypeScript、IPC、locale、构建脚本、资源配置和当前文档已统一。

修复了上次批量替换产生的非法 TypeScript 标识符、原生模块名称不一致、旧配置引用和当前 macOS 链接器生成库的加载问题。依赖已执行 `pnpm install --offline --frozen-lockfile --config.confirmModulesPurge=false` 并完成原生依赖重建。

真实 Electron 使用独立临时 HOME / USERPROFILE / user-data-dir 与 `--use-mock-keychain`，实际注册标签页、分屏、读取布局、关闭标签页和获取安全状态均成功。生产数据目录与既有钥匙串条目没有用于测试。Windows 仅验证交叉静态检查，本次没有 Windows 实机运行或安装包测试。

存储一致性首次发现现有旧 `.node` 缺少源码已有导出；从未改动的 `getssh-store` 源码重建生成物后，232 步对比为 0 差异。没有修改存储源码。

当前已运行的开发进程需完整停止后重新运行 `pnpm run dev`，以加载新的主进程与原生模块。

以下保留验证命令与原始输出。所有退出码均为 0。

## TypeScript

```text
Directory: /Volumes/Developer/GETSSH/apps/getssh-client
Command: pnpm exec tsc -b tsconfig.json --force --pretty false

Exit code: 0
```

## Renderer / main / preload 构建

```text
Directory: /Volumes/Developer/GETSSH/apps/getssh-client
Command: pnpm exec vite build
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
dist/assets/index-9nfOdIzZ.js                2,489.69 kB │ gzip: 768.73 kB

✓ built in 632ms
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

✓ built in 3ms
[plugin builtin:vite-reporter] 
(!) Some chunks are larger than 2000 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.

Exit code: 0
```

## Ocean Sentinel 独立进程工具

```text
Directory: /Volumes/Developer/GETSSH/apps/getssh-client
Command: pnpm run build:native-tools
Temporary HOME/USERPROFILE with original Cargo/rustup caches.
$ cargo build --release -p ocean-sentinel --no-default-features --bins
warning: profiles for the non root package will be ignored, specify profiles at the workspace root:
package:   /Volumes/Developer/GETSSH/rust-core/getssh-unarchive/Cargo.toml
workspace: /Volumes/Developer/GETSSH/Cargo.toml
   Compiling ocean-sentinel v1.0.0 (/Volumes/Developer/GETSSH/rust-core/ocean-sentinel)
    Finished `release` profile [optimized] target(s) in 0.74s

Exit code: 0
```

## Rust 单元测试（52 项）

```text
Directory: /Volumes/Developer/GETSSH
Command: cargo test --offline -p ocean-sentinel -p tidal-engine
Temporary HOME/USERPROFILE with original Cargo/rustup caches.

running 12 tests
test redaction::tests::rehydrates_atomic_shell_values_when_shape_is_unchanged ... ok
test redaction::tests::blocks_rehydration_that_adds_shell_syntax ... ok
test redaction::tests::allows_shell_metacharacters_that_remain_quoted_data ... ok
test redaction::tests::restores_safe_tokens_while_leaving_unsafe_ones ... ok
test redaction::tests::line_continuations_only_admit_inert_values ... ok
test redaction::tests::blocks_tool_specific_shell_escapes ... ok
test redaction::tests::blocks_metacharacter_values_under_second_order_evaluators ... ok
test redaction::tests::keeps_inert_values_and_ordinary_commands_working ... ok
test redaction::tests::inserted_values_are_never_rescanned_for_other_tokens ... ok
test redaction::tests::sanitizes_authorization_value_without_losing_scheme ... ok
test redaction::tests::sanitizes_prefixed_environment_token_reversibly ... ok
test redaction::tests::result_does_not_depend_on_map_iteration_order ... ok

test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s


running 1 test
test tests::profile_names_are_strict_and_bounded ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s


running 7 tests
test supervisor::tests::a_missed_heartbeat_shows_the_dialog_and_a_heartbeat_ends_it ... ok
test supervisor::tests::a_real_freeze_is_killed_and_restarted_in_safe_mode_at_the_deadline ... ok
test supervisor::tests::save_15s_moves_the_deadline_at_most_three_times ... ok
test supervisor::tests::the_alert_echoes_its_level_and_ticks_once_a_second ... ok
test supervisor::tests::the_apps_actions_end_a_lockdown ... ok
test supervisor::tests::messages_during_an_alert_do_not_hold_the_countdown_back ... ok
test supervisor::tests::wait_never_overshoots_the_deadline ... ok

test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s


running 32 tests
test state::workspace::tests::register_rejects_duplicate_tab ... ok
test state::workspace::tests::removed_sessions_skip_sessions_still_shown_elsewhere ... ok
test state::workspace::tests::replace_reports_previous_session_and_resets_disconnected ... ok
test state::workspace::tests::sizes_are_clamped_and_validated ... ok
test state::workspace::tests::payload_reflects_real_tab_state ... ok
test state::workspace::tests::close_tab_reports_sessions ... ok
test state::workspace::tests::split_cap_applies_to_target_tab_only ... ok
test state::workspace::tests::a_fallen_back_tab_is_not_redocked_later ... ok
test state::workspace::tests::close_pane_in_second_tab ... ok
test state::workspace::tests::nested_split_ids_are_unique_after_close_and_resplit ... ok
test state::workspace::tests::close_split_node_removes_its_whole_subtree ... ok
test state::workspace::tests::mark_session_disconnected_flags_every_leaf_showing_it ... ok
test state::workspace::tests::split_keeps_disconnected_and_clears_zoom ... ok
test state::workspace::tests::split_refusals ... ok
test state::workspace::tests::tear_in_by_tab_id_or_node_id ... ok
test state::workspace::tests::split_sizes_serialize_as_numbers ... ok
test state::workspace::tests::tear_in_falls_back_when_the_origin_tab_is_gone ... ok
test state::workspace::tests::tear_in_checks_the_direction_of_the_siblings_parent ... ok
test state::workspace::tests::tear_in_falls_back_when_the_origin_tab_is_torn ... ok
test state::workspace::tests::tear_in_falls_back_when_the_sibling_is_a_split_of_the_same_direction ... ok
test state::workspace::tests::tear_in_falls_back_when_the_sibling_is_gone ... ok
test state::workspace::tests::tear_in_redocks_a_leaf_into_its_nested_split ... ok
test state::workspace::tests::tear_in_without_origin_falls_back ... ok
test state::workspace::tests::tear_in_redocks_a_subtree_next_to_the_root ... ok
test state::workspace::tests::tear_in_respects_the_leaf_cap ... ok
test state::workspace::tests::tear_off_root_marks_tab_torn ... ok
test state::workspace::tests::tear_off_requires_terminal_leaves ... ok
test state::workspace::tests::tear_off_records_origin_only_for_a_subtree ... ok
test workspace::tests::accepts_ordinary_names ... ok
test state::workspace::tests::tear_off_subtree_moves_it_to_a_new_tab ... ok
test state::workspace::tests::zoom_is_exclusive_within_a_tab ... ok
test workspace::tests::rejects_traversal_and_unportable_names ... ok

test result: ok. 32 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

warning: profiles for the non root package will be ignored, specify profiles at the workspace root:
package:   /Volumes/Developer/GETSSH/rust-core/getssh-unarchive/Cargo.toml
workspace: /Volumes/Developer/GETSSH/Cargo.toml
   Compiling ocean-sentinel v1.0.0 (/Volumes/Developer/GETSSH/rust-core/ocean-sentinel)
    Finished `test` profile [unoptimized + debuginfo] target(s) in 1.22s
     Running unittests src/lib.rs (target/debug/deps/ocean_sentinel-a13c3d0713821118)
     Running unittests src/sandbox/main.rs (target/debug/deps/getssh_sandbox-6e3cf13bd4e2f79c)
     Running unittests src/watchdog/main.rs (target/debug/deps/watchdog-ecf96a578e31548e)
     Running unittests src/lib.rs (target/debug/deps/tidal_engine-0438013a41ed9918)

Exit code: 0
```

## IPC、布局、插件、MCP、本地记忆（245 项）

```text
Command: pnpm exec vitest run electron/main/renameIntegration.test.ts electron/main/services/plugin/PluginNetworkGateway.test.ts electron/main/services/plugin/PluginProcessSandbox.test.ts electron/main/services/LocalMemoryService.test.ts electron/main/services/mcp/McpProcessSandbox.test.ts src/store/sessionStore.spec.ts src/utils/connectionProfile.spec.ts src/hooks/centerRouting.spec.tsx --environment node
Temporary HOME/USERPROFILE: /var/folders/x3/6jlqp2j16f9dmm7t6w9dmlfm0000gn/T/getssh-rename-tests-Lq7EaV

 RUN  v5.0.3 /Volumes/Developer/GETSSH/apps/getssh-client


 Test Files  8 passed (8)
      Tests  245 passed (245)
   Start at  09:43:05
   Duration  573ms (environment 58%, transform 23%, tests 12%, import 6%, worker 1%)


Exit code: 0
```

## 原生 Ocean Sentinel 与 TS 网关（23 项）

```text
Directory: /Volumes/Developer/GETSSH/apps/getssh-client
Command: npm run test:sentinel

> getssh@3.0.0-F0A0G-PREVIEW test:sentinel
> vitest run electron/main/services/OceanSentinel.test.ts --environment node && node scripts/security/sentinel-smoke.cjs


 RUN  v5.0.3 /Volumes/Developer/GETSSH/apps/getssh-client


 Test Files  1 passed (1)
      Tests  23 passed (23)
   Start at  16:30:54
   Duration  132ms (tests 52%, transform 29%, import 16%, worker 2%)

sentinel sanitization/rehydration smoke passed

Exit code: 0
```

## 真实 Electron IPC / Tidal Engine / Ocean Sentinel

```text
Command: Playwright Electron launch of apps/getssh-client with temporary HOME/USERPROFILE/user-data-dir and --use-mock-keychain, then real renderer IPC calls.
{
  "registered": {
    "success": true
  },
  "split": {
    "success": true,
    "newPaneId": "pane-1b9b88cc-9a63-4681-bc08-19f2ba11c3e8",
    "tabId": "rename-validation-tab"
  },
  "hasSnapshot": true,
  "closed": {
    "success": true
  },
  "status": {
    "status": "secure",
    "lastPing": 1791038026572,
    "sentinelDisabled": false
  }
}
Real Electron IPC + native Tidal layout + Ocean Sentinel watchdog passed.
Exit code: 0
```

## Windows 目标静态检查

```text
Directory: /Volumes/Developer/GETSSH
Command: cargo clippy --offline -p ocean-sentinel --no-default-features --bins --target x86_64-pc-windows-msvc -- -D warnings
Temporary HOME/USERPROFILE with original Cargo/rustup caches.
warning: profiles for the non root package will be ignored, specify profiles at the workspace root:
package:   /Volumes/Developer/GETSSH/rust-core/getssh-unarchive/Cargo.toml
workspace: /Volumes/Developer/GETSSH/Cargo.toml
   Compiling ocean-sentinel v1.0.0 (/Volumes/Developer/GETSSH/rust-core/ocean-sentinel)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.70s

Exit code: 0
```

## 真实插件进程隔离

```text
Directory: /Volumes/Developer/GETSSH/apps/getssh-client
Command: pnpm exec electron --use-mock-keychain scripts/security/plugin-host-smoke.cjs
Temporary HOME/USERPROFILE; GETSSH_STORE_CONFORMANCE=1.
plugin isolation smoke passed

Exit code: 0
```

## SQLCipher key / rekey

```text
Directory: /Volumes/Developer/GETSSH/apps/getssh-client
Command: pnpm exec electron --use-mock-keychain scripts/security/database-key-smoke.cjs
Temporary HOME/USERPROFILE; GETSSH_STORE_CONFORMANCE=1.
database key/rekey smoke passed

Exit code: 0
```

## 密钥迁移端到端

```text
Directory: /Volumes/Developer/GETSSH/apps/getssh-client
Command: npm run test:keystore-e2e
Temporary HOME/USERPROFILE; GETSSH_STORE_CONFORMANCE=1.

> getssh@3.0.0-F0A0G-PREVIEW test:keystore-e2e
> node scripts/security/keystore-e2e/run.mjs

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
npm notice
npm notice New major version of npm available! 11.12.1 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice

Exit code: 0
```

## 存储真模块 / fake 一致性

```text
Command: GETSSH_STORE_CONFORMANCE=1 node rust-core/getssh-store/store.conformance.mjs
Temporary HOME/USERPROFILE. Existing native store artifact rebuilt from unchanged source.
232 steps, 0 differences

Exit code: 0
```

## 文案检查

```text
Directory: /Volumes/Developer/GETSSH
Command: node scripts/copy-lint.js --strict apps/getssh-client/src/locales/en-US.json apps/getssh-client/src/locales/zh-CN.json apps/getssh-client/src/components/StatusBar.tsx apps/getssh-client/src/components/TidalDashboard.tsx apps/getssh-client/src/components/settings/tabs/SecurityTab.tsx apps/getssh-client/src/services/aiBridge.ts
copy-lint：检查了 6 个文件
  apps/getssh-client/src/locales/en-US.json
  apps/getssh-client/src/locales/zh-CN.json
  apps/getssh-client/src/components/StatusBar.tsx
  apps/getssh-client/src/components/TidalDashboard.tsx
  apps/getssh-client/src/components/settings/tabs/SecurityTab.tsx
  apps/getssh-client/src/services/aiBridge.ts

== 夸张：几乎都该删（0 处）

== 机器腔：改成直接陈述（4 处）
apps/getssh-client/src/locales/en-US.json:159:90  …mbined with 【robust】 PBKDF2 key…
apps/getssh-client/src/locales/en-US.json:475:47  …built upon 【robust】 open-source…
apps/getssh-client/src/locales/zh-CN.json:157:82  …解锁应用，提供开箱即用的【无缝】安全体验。",
apps/getssh-client/src/locales/zh-CN.json:659:41  …AI 将获得最高权限！它【不仅能读取屏幕内容，还】具有自我规划和在服务器后…

== 看语境：是字面的技术描述就保留，并确认有出处（6 处）
apps/getssh-client/src/locales/en-US.json:160:32  …sNetwork": "【Zero-copy】 Network",
apps/getssh-client/src/locales/en-US.json:161:80  …Rust N-API. 【Zero-copy】 buffering b…
apps/getssh-client/src/locales/en-US.json:304:95  …connection 【instantly】.",
apps/getssh-client/src/locales/zh-CN.json:190:32  …sNetwork": "【Zero-copy】 网络引擎",
apps/getssh-client/src/locales/zh-CN.json:191:67  …接管 I/O。通过本地【零拷贝】（Zero-copy）绕…
apps/getssh-client/src/locales/zh-CN.json:191:71  …I/O。通过本地零拷贝（【Zero-copy】）绕过 V8 堆内存，杜…

== 按词汇总
机器腔：改成直接陈述
  2 × robust：use a plain word, or drop it
  1 × 无缝：说清楚怎么衔接，例如断线后自动重连
  1 × 不仅……更……：只留后半句，或拆成两句
看语境：是字面的技术描述就保留，并确认有出处
  4 × zero-copy：only if the implementation really avoids copies
  1 × instantly：give a measured number, or drop it
  1 × 零拷贝：确认实现里真的没有拷贝

Exit code: 0
```

## Whitespace

```text
Directory: /Volumes/Developer/GETSSH
Command: git diff --check

Exit code: 0
```

