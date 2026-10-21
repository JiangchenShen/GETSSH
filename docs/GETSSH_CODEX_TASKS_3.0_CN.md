# 3.0 发布前的界面任务（Codex）

2026-10-11 整理，3.0 定于 10 月 20 日发布。下面每一条都对照过 `v3-next` 的 `0168672`，行号以这个提交为准。

后端都已经做好，这些任务只改 `apps/getssh-client/src/**`。需要新的 IPC 或接口改动时，写下来交给负责人或 Claude，不要改 `electron/main/**`、`electron/preload/**`。

建议的完成时间：P0 在 10-14 前，P1 在 10-16 前，P2 在 10-18 前。10-13 到 10-19 要做真机测试和真实数据的迁移演练，P0 越早交越好。

## 0. 开工前

1. 在 `/Volumes/Developer/GETSSH-codex` 里从 `v3-next` 新开分支：

   ```bash
   git switch -c feat/ui-store v3-next
   ```

   旧分支 `feat/ui-sidebar-hierarchy`（`3d6be57`）已经落后 `v3-next` 45 个提交，大部分改动已经随别的提交进了 `v3-next`。不要合并这个分支，剩下的部分按 U11 手工移植。
2. 开发时用临时 HOME 和假实现：

   ```bash
   HOME=$(mktemp -d) GETSSH_FAKE_STORE=1 pnpm run dev
   ```

   - 10-11 起（`electron/main/devProfile.ts`），这条命令会把 Electron 的 userData 也放进临时 HOME，钥匙串用模拟的。在这之前它只换了 HOME，macOS 上仍会读写真实的 `~/Library/Application Support/getssh` 和系统钥匙串。第 1 步从 `v3-next` 开的分支已经带上这个改动。
   - 不要不加 `GETSSH_FAKE_STORE=1` 启动开发版，也不要用真实 HOME。
   - 初始数据用 `GETSSH_FAKE_STORE_SEED` 等变量准备，用法在 `rust-core/getssh-store/store.fake.js` 的文件头部注释里。
   - 假实现的数据只在内存里，`relaunch()` 重启后就没了。要验证"重启后还在"，写 vitest，用 `__fake.restart()` 模拟重启。用真模块做的完整往返由 Claude 来测。
3. 接口说明：
   - 存储相关的函数：`apps/getssh-client/src/types.d.ts` 第 198–253 行（`window.electronAPI.store`）；
   - 返回值和错误码：`src/types/store.ts`。返回值统一是 `{ ok: true, ... }` 或 `{ ok: false, error }`。
4. 规则照 `docs/GETSSH_TEAM_CN.md`：
   - 改代码用 `apply_patch`；
   - 不削弱、不删除已有测试；
   - 不用 `git reset`、`git push`。
5. 交付前在 `apps/getssh-client` 下跑下面几项，并把原始输出附上：
   - `pnpm exec tsc -b tsconfig.json --force --pretty false`；
   - `pnpm exec vite build`；
   - `pnpm exec vitest run <改到的 spec>`；
   - 改了文案的话，在仓库根目录跑 `node scripts/copy-lint.js --strict <改过的文件>`。
6. 每完成一块，就在分支上提交，并把分支名告诉负责人。Claude 审的是 `git diff v3-next...feat/ui-store` 的实际内容。

## P0：不做会直接影响 3.0 用户

### U1 导出备份

- **现状**：设置页"导出 / 导入"标签里的"数据库备份"还是 Claude 加的临时提示。
  - `exportAll` 点了只显示"已改为加密备份，新的界面马上就到"：`src/components/secure-center/tabs/ExportTab.tsx:32-52`；
  - `exportWorkspace` 调的是已经失效的 `exportDatabaseWorkspace`：`ExportTab.tsx:54-59`；
  - 这一节的界面在 `ExportTab.tsx:129-139`。

  用户现在没有办法备份，也没法把数据搬到另一台电脑。
- **要做**：改用 `store.backup`。
  1. `candidates()` 列出工作区，用户勾选。每项带名称、`is_main`、`state`、`profileCount`、`unlockWith`。
  2. `unlockForExport({ workspaceIds })`：一次 Touch ID / Windows Hello。返回的 `failed` 里列出的工作区，要让用户输入这个工作区的密码，再调 `workspace.unlock`。
  3. 让用户设备份密码：至少 12 个字符，输两次。
  4. `export({ workspaceIds, password })`：保存对话框由主进程弹出。完成后显示 `report.path`。
- **错误处理**：
  - `cancelled`：用户关掉了对话框，不报错；
  - `rate_limited`：按 `retryAfterMs` 提示还要等多久；
  - `must_change_master_password`：提示先更换主密码，见 U3；
  - 其余错误码显示可读的说明，不显示原始错误码。
- **验收**：
  - 假实现里准备两个工作区，其中一个有单独密码；
  - 两个都能导出；
  - 取消 Touch ID 不显示错误。

### U2 导入备份

- **现状**：`ExportTab.tsx:68-80` 调的是失效的 `importDatabase`；`:107-121` 和 `:164-175` 是旧的"合并 / 覆盖"对话框，调的是 `confirmImportDatabase`。
- **要做**：
  1. `chooseImportFile()`：拿到 `fileId` 和 `fileName`。
  2. 用户输入备份密码，调 `inspect({ fileId, password })`。
     - 拿到 `info` 后，显示备份时间（`createdAt`）、应用版本（`appVersion`）和里面的工作区（`workspaces`）；
     - 返回 `wrong_password` 时让用户重输。
  3. 明确提示"会替换现在的全部数据"，用户确认后调 `import({ fileId, password })`。
  4. 显示 `report.backupPath`：旧数据会整份保留在这个目录里。
  5. 调 `relaunch()` 重启应用。重启之前，`store` 这组调用都返回 `unavailable`，界面要提示"需要重启"，不要当成出错。
- **做完 U1、U2 之后**：告诉 Claude，由 Claude 删掉下面这几个失效的旧接口：
  - `electron/preload/index.ts:85-90`；
  - `src/types.d.ts:138-146`；
  - 具体是 `exportDatabaseAll`、`exportDatabaseWorkspace`、`importDatabase`、`confirmImportDatabase`。

  同一个标签里的"导出脱敏主机配置"不受影响，保留。
- **验收**：
  - 开发版里导入后出现"需要重启"的提示，此时 `store` 调用返回 `unavailable`，界面不当成出错；
  - 密码输错时能重输；导入前取消，什么都不变；
  - 恢复后的数据写一个 vitest 检查：导入后调 `__fake.restart()`，服务器配置和工作区都在；
  - 用真模块从导出到导入、重启的完整往返，交给 Claude。

### U3 强制更换主密码

- **现状**：
  - 用 3.0 之前设的、不到 12 个字符的主密码解锁后，`appLock.getState()` 返回的 `masterPasswordMustChange`（`src/types/ipc.ts:131`）为 `true`。用 Touch ID 或恢复码解锁时它是 `false`；
  - 界面里没有地方读它，`src/hooks/useAppLockSync.ts:19` 的开发版兜底值还写死成 `false`；
  - 这类用户导出时会被拒绝（`must_change_master_password`），界面上却没有任何提示。
- **要做**：
  - 解锁后，如果 `masterPasswordMustChange` 为 `true`，弹一个关不掉的对话框；
  - 对话框里让用户输入当前主密码和新主密码（至少 12 个字符，输两次），调 `security.setMasterPassword({ password, currentPassword })`；
  - 返回 `recoveryReset: true` 时，说明旧恢复码已经失效，引导用户生成新的恢复码，可以复用 `SafeStorageTab.tsx` 里的"生成恢复码"流程；
  - 改完后重新读 `getState()`，对话框关闭。
- **验收**：
  - 假实现里设一个 11 个字符的 `masterPassword`，并用 `GETSSH_FAKE_STORE_PRESENCE=unsupported` 关掉 Touch ID，确保是输入密码解锁的；
  - 解锁后对话框出现，关不掉；
  - 改完后不再出现，导出可以正常进行。

### U4 设了主密码后，工作区的"设置密码"按钮要隐藏

- **现状**：
  - `src/components/secure-center/tabs/SafeStorageTab.tsx:224` 的显示条件是 `(!isMainWorkspace || status?.appProtected)`，写反了：设了主密码后，包括主工作区在内的每个工作区都显示这个按钮；
  - 点下去，主进程返回 `master_password_protects_workspaces`；
  - `describe()`（`:55-66`）没有这个错误码的说明，用户看到的是"操作失败（master_password_protects_workspaces）"；
  - `:223` 的"修改"在主密码下同样会失败。
- **要做**：
  - "设置密码"只在没有主密码、并且不是主工作区时显示，条件是 `!status?.appProtected && !isMainWorkspace`；
  - 有主密码时隐藏"修改"，保留"移除"；
  - `describe()` 补上 `master_password_protects_workspaces` 的说明。
- **可以顺手删掉的死代码**：`TidalDashboard.tsx:75-80` 和 `src/hooks/useSessionManager.ts:32-39` 各有一个 `handleSetup`，都调 `workspace.setPassword`，但都不会被执行到：`TidalDashboard` 只用 `mode="locked"` 渲染 `CryptoModal`，`useSessionManager` 的那个也没有人用。
- **验收**：
  - 设主密码前后各看一次设置页（`SafeStorageTab`），以及 `SecurityTab.tsx:197` 跳过去的入口；
  - 主密码下，不会出现点了必然失败的按钮。

### U6 导入 2.0 服务器时的密码提示和默认端口

- **现状**：
  - 能直接读出 2.0 密码的情况，应用在窗口加载服务器列表之前就自动导入了，这种情况已经没问题；
  - 需要用户输入 2.0 主密码，或者要补默认端口时，界面一直没有接上；
  - `store.legacyV2` 的三个函数（`src/types.d.ts:242-252`，preload 在 `electron/preload/index.ts:305-310`）在界面里没有任何调用。
- **要做**：
  1. 应用状态变成 `ready` 后调一次 `legacyV2.status()`，比如放在 `useAppLockSync` 里，或者应用启动的地方。
  2. `imported.portDefaulted > 0` 时，调 `applyDefaultPort({ port: appConfig.defaultPort })`。默认端口是 22 时也要调一次，之后就不会再提示。
  3. `needsPassword` 为 `true` 时，弹框请用户输入 GETSSH 2.0 的主密码，再调 `import({ password, defaultPort: appConfig.defaultPort })`：
     - 返回 `wrong_password` 时让用户重输；
     - 返回 `unreadable`、`failed` 时说明原因，并允许跳过。
  4. `import` 和 `applyDefaultPort` 返回的 `workspaceId` 是当前工作区时，用返回的 `profiles` 替换窗口里的服务器列表。不替换的话，窗口下一次整份保存列表时，会把刚导入的服务器又删掉。
- **验收**：
  - 假实现不读 2.0 数据，也不会自动导入（`electron/main/security/appLock.ts:238`），所以在 vitest 里 mock `window.electronAPI.store.legacyV2`：
    - `status()` 返回 `needsPassword: true` 时弹出输入框，`wrong_password` 时能重输，`imported` 时列表被替换；
    - `status()` 返回 `portDefaulted > 0` 时调 `applyDefaultPort`，列表被替换；
  - 用真模块和真实格式的 2.0 文件做的验证，交给 Claude。

## P1：3.0 里应该有

### U7 查看已保存的密码

- **现状**：密码已经不再发给界面，但界面里也没有地方能查看。`store.reveal` 在界面里没有任何调用。
- **要做**：
  - 在连接表单（`ConnectForm.tsx` 密码和口令输入框旁，`:289`、`:293`）加"查看密码"，只在 `hasPassword` / `hasPassphrase` 为真时显示。服务器列表现在没有右键菜单，要放那里就得新做一个；
  - 先调 `reveal.open({ workspaceId, method: 'presence' })`，失败或用户选择输入密码时，改用 `{ method: 'password', password }`。要输入的是：设了主密码时（`appProtected`）输主密码，否则输这个工作区的单独密码。两样都没有的工作区只能用 Touch ID / Windows Hello，不要显示输入密码的选项；
  - 再调 `reveal.show({ workspaceId, profileId, field, language })`。密码在主进程弹出的系统对话框里显示，界面拿不到，复制也只能用对话框上的按钮；
  - 离开页面时调 `reveal.close({ workspaceId })`。
- **错误处理**：
  - `cancelled` 不报错；
  - `wrong_password` 让用户重输；
  - `rate_limited` 提示要等多久；
  - `invalid_argument`：这个工作区没有可以输入的密码，只能用 Touch ID；
  - `show` 返回 `locked`：查看窗口已经关了（5 分钟没用，或者调过 `close`），重新 `open` 后再 `show`；
  - `unauthorized`：应用在这期间锁上了，什么都不做。
- **验收**：Touch ID 和输入密码两种方式都能看到密码；输入密码那种，在没有主密码、工作区有单独密码时测。界面的状态和日志里都不出现密码本身。

### U8 清除已保存的服务器密码

- **现状**：
  - `src/components/ConnectForm.tsx:46` 把输入框留空当作"保留"，`:59` 的提示是"已保存，留空则不修改"；
  - 密码和口令的输入框（`:289`、`:293`）都没有清除的办法。
- **要做**：
  - 已保存时，在输入框旁边加"清除已保存的密码"（口令同样）；
  - 点了以后，保存时这个字段传空字符串（或 `null`）。现在的保存通道已经支持：不传表示保留，`null` 或空字符串表示清除（`electron/main/services/DatabaseManager.ts` 的 `secret()`）。`SessionProfile` 的密码字段类型是 `string | undefined`（`src/store/sessionStore.ts:86-88`），传 `null` 要先放宽类型；
  - 保存通道只返回 `true`，不会重新读列表，所以清除后要在本地把这一条的 `hasPassword` / `hasPassphrase` 设成 `false`；
  - `secretInput`（`ConnectForm.tsx:46`）在 `hasPassword` 为真时把空输入当成"保留"。清除以后用户再改动输入框，不能把清除又变回保留。
- **验收**：清除后重新打开表单，不再显示"已保存"；连接时会要求输入密码；重启开发版后仍是清除状态（用 vitest 和 `__fake.restart()` 检查）。

### U9 AI 聊天每个 token 都重新解析全部消息

- **现状**：
  - `src/components/ai-center/ChatView.tsx:21` 订阅了整个 `conversations`；
  - 消息在 `:48-142` 里直接渲染，没有单独的组件，`parseThoughtProcess`（`:94`）每次渲染对每条消息都跑一遍；
  - `src/components/common/MarkdownRenderer.tsx:16` 没有 `memo`，`components`（`:32-164`）和 `remarkPlugins`（`:31`）每次渲染都新建；
  - `handlePaperPlane`（`useAiInteraction.ts:16`）每次渲染都是新函数；
  - `appendChunk`（`src/store/aiChatStore.ts`）每来一个片段就 `set()` 一次。
- **要做**：
  - 单条消息抽成用 `React.memo` 包住的组件，按 id、内容和状态比较；
  - `MarkdownRenderer` 加上 `memo`，`components`、`remarkPlugins` 改用 `useMemo` 或放到组件外面；
  - `ChatView` 只订阅当前对话的消息；
  - `handlePaperPlane` 和重试、选服务器的回调用 `useCallback`；
  - `appendChunk` 每一帧最多合并 `set()` 一次。
- **验收**：一个 200 条消息的对话里流式输出时，只有正在输出的那一条重新渲染。用 React Profiler 看。

### U10 "加载更早的消息"

- **现状**：
  - 10-11 起，对话打开时只读最新的 200 条；
  - 更早的消息由 `useAiChatStore().loadOlderMessages(conversationId)` 读；
  - 当前对话的 `olderMessages` 是非空字符串时，表示还有更早的消息。新建的对话里它是 `undefined`，判断时用真值，不要写 `!== null`；
  - 界面里还没有调用它的地方。
- **要做**：
  - 在 `ChatView` 消息列表的顶部加"加载更早的消息"按钮，或者滚到顶部时自动加载；
  - 加载后保持当前的滚动位置。`ChatView.tsx:28-30` 的 `scrollIntoView` 现在会跳到底部，要避开。
- **验收**：一个 450 条消息的对话，点两次能看到全部消息，滚动位置不会跳。

### U11 侧栏分支里还没进来的改动

`3d6be57` 的大部分改动已经随 `204ede6` 进了 `v3-next`。下面 6 处没有进来，对应 `/Volumes/Developer/GETSSH-ui-review-2026-10-03/QA.md`：第 1–3 处是第 14–16 行，第 4、5 处是第 17 行，第 6 处是第 18 行，第 19 行是下面的回归测试。请对照 `git diff 3d6be57^ 3d6be57` 手工移植到新分支上：

1. 工作区导轨和资产栏合成一个导航面：`src/App.tsx:257-271` 现在还是两个分开的 `sidebar-material`。要加 `index.css` 的 `.workspace-navigation`、`.workspace-rail-surface`。新的导航面自己画右边框，所以同时去掉 `ContextSidebar.tsx:454`、`:473` 两个根元素上的 `border-r border-line-soft`，否则会出现两条分隔线。
2. 侧栏层级：`src/components/ContextSidebar.tsx`
   - `:273` 现在没选中的主机名用 `text-ink-2` 变暗，改成统一用 `text-ink`；
   - `:484` 没有"工作区"标题；
   - `:498` 搜索框；
   - `:650` 虚线的"新建连接"按钮；
   - 补上展开、折叠、搜索的 `aria-label`。
3. 底栏没有工作区入口：`src/components/StatusBar.tsx:59-78`。
   - 补上这个入口；
   - `ContextSidebar.tsx:478-480` 和 `GlobalWorkspaceBar.tsx:44-45` 打开工作区中心时要带 `workspacePage: 'all'`，否则会停在上次的页面上。
4. 设置和工作区中心的分类导航改窄、改轻，去掉重复的可见标题：
   - `src/components/SettingsView.tsx:58-59`；
   - `src/components/WorkspaceCenter.tsx:78-80`；
   - 加 `.center-page-nav`。
5. 中心面板去掉整条强调色顶部线：`src/components/LeafPane.tsx:186`。终端面板保留这条线。
6. 浅色模式下，选中工作区的字母改用高对比的正文色，加 `aria-pressed`：`src/components/GlobalWorkspaceBar.tsx:68-69,89`。

另外，把 `workspaceNavigation.spec.tsx` 一起加进来。分支里的版本 mock 的是 `watchdogStatus`，`v3-next` 的状态栏用的是 `sentinelStatus`（`StatusBar.tsx:49,83,90`），要按它改写。

**验收**：
- QA.md 第 14–18 行的视觉改动逐条对照截图，深色、浅色、窄窗各看一次；
- `workspaceNavigation.spec.tsx` 通过（QA.md 第 19 行）。

## P2：文案、官网和小问题

### U5 工作区的 Touch ID 开关说明不准

（10-11 核实后从 P0 降到 P2：两个开关不会同时出现，只是文字和实际行为对不上。）

- **现状**：
  - 应用的开关（`SafeStorageTab.tsx:202-204`）只在设了主密码时显示；工作区的开关（`:226-228`）只在这个工作区有单独密码时显示。工作区只有在没有主密码时才能有单独密码，所以两个开关不会同时出现；
  - 工作区开关的说明是"用 Touch ID 代替输入这个工作区的密码"，实际上它对当时所有已解锁、有单独密码的工作区一起生效；当时锁着的工作区不受影响；
  - 工作区解锁界面用每个工作区自己的 `biometricEnabled`（`TidalDashboard.tsx:94`、`src/store/workspaceStore.ts:85,140`、`src/hooks/useCryptoBoot.ts:20`），这是对的，不要改成 `appLock.getState().presenceEnabled`：那个值只代表应用级，没有主密码时一直是 `false`。
- **要做**：
  - 改工作区开关的说明，写清楚它对哪些工作区生效；
  - preload 里的 `toggleWorkspaceBiometric` 已经没有人用，告诉 Claude 删掉。它在三处：`src/types.d.ts:153`、`electron/preload/index.ts:97`、`electron/main/handlers/workspaceHandler.ts:111-125`。
- **验收**：用真模块时由 Claude 一起验证；开发版里看说明文字即可。

### U12 官网的交接文档和夸张词

- `GETSSH-WEBSITE/website_handoff.md` 第 4 行写着"六层军事级安全防御体系"，第 105–108 行（第 5.3 节）还在要求写"军工级"；`GETSSH-WEBSITE/docs/website_v2_updates_zh.md:7,24` 有"降维打击""军事级安全隔离"。删掉，或者标明已作废。
- 网站正文：对 `GETSSH-WEBSITE/src` 跑 `node scripts/copy-lint.js`（在应用仓库根目录运行，参数写网站的路径），把"夸张"一类报出来的全部改掉。10-11 时至少有这些：
  - `src/content/changelog/zh.md` 的"军工级"（51）、"终极"（62、87）、"极致"（85、157、161、165、176、186、213）；
  - `src/content/changelog/en.md` 的 "Military-Grade"（51）、"Ultimate"（62、87、107）、"cutting-edge"（68）、"lightning-fast"（84）、"bleeding-edge"（88）、"impenetrable"（146）；
  - `src/content/models/en.md:184` 的 "cutting-edge"；
  - `src/dictionaries/zh.json:22,82,83,174,234` 的"极致"；
  - `src/dictionaries/en.json` 的 "ultimate"（101）、"blazing-fast"（234）。
- "无缝""seamless"不在"夸张"一类，`--strict` 不会因为它们报错，要人工看：`src/content/changelog/zh.md:90,128`、`en.json:234`。
- 都按 `docs/GETSSH_COPY_STYLE_CN.md` 改成陈述事实。
- **验收**：`copy-lint --strict` 通过，并且输出里"无缝""seamless"也没有了。

### U13 和代码对不上的技术说法

- 官网 `src/dictionaries/en.json:48-49,96,161-163` 和 `zh.json:48-49,96,161-163` 写着"零拷贝""绕过 V8 堆""WebGL Zero-Copy"，代码里没有这样的实现：
  - SFTP 读文件走的是 ssh2 的 `createReadStream`；
  - `rust-core/sftp-stream` 每个块都会复制一次。

  删掉，或者改成代码实际做的事。
- 应用的 `security.shieldDetails*` 一组文字有同样的说法，还写着 PBKDF2（`en-US.json:163`、`zh-CN.json:193`），3.0 实际用的是 Argon2id。这一组现在没有界面在用，整组删掉：`src/locales/en-US.json:156-169`、`zh-CN.json:186-199`。
- `README_CN.md:26,42,91,135,190` 和 `README.md:26,48,97,141,196` 也有"零拷贝"的说法。这两个文件由负责人决定怎么改。

### U14 官网 SDK 文档同步插件秘密

- `GETSSH-WEBSITE/src/content/sdk/zh.md:316` 还写着没有解密接口，`:397` 写着"password 只控制输入框遮罩"，两处都已经过时。
- 按应用仓库 `docs/PLUGIN_SDK_INTERNAL_CN.md` 的 6.1、6.3、6.5 节和第 8 节更新：
  - 新增 `context.secrets`；
  - `password` 类型的设置项改为加密存放；
  - `safeStorageEncrypt` 已弃用。

  英文版 `en.md` 对照 `docs/PLUGIN_SDK_INTERNAL.md` 更新。

### U15 应用里剩下的两处文案

- `src/locales/zh-CN.json:161` 的"无缝安全体验"；
- `src/components/ai-center/InputArea.tsx:73` 的"极致高并发低延迟模型"。

改完后在仓库根目录跑 `node scripts/copy-lint.js apps/getssh-client/src/locales apps/getssh-client/src/components/ai-center/InputArea.tsx`，确认输出里这两处都没有了。只看退出码不够：`--strict` 只对"夸张"一类报错，"无缝"不在里面。

### U16 关掉防眩光后终端的显示

- `@xterm/addon-canvas` 0.7 是为 xterm 5 写的，应用用的是 xterm 6（`package.json:50,55`）；
- 关掉防眩光时会加载它；开着防眩光、但 WebGL 加载失败或丢失上下文时，也会退回到它（`Terminal.tsx:194-220`、`:436-454`，其中 `:211`、`:217`、`:436`、`:443` 是退回的地方）。没人看过这些情况下的显示效果。
- **要做**：在开发版里关掉防眩光，看终端显示是否正常。不正常就改用 xterm 6 自带的渲染方式，几处退回的地方要一起改；正常的话，在这里记一句。

### U17 插件设置里"清除已保存的值"按钮

- 这个按钮是 Claude 10-11 加的，在 `src/components/PluginSettings.tsx:154`，样式很简单。
- **要做**：
  - 补上 `focus-visible` 的样式，照 `buttonClass`（`PluginSettings.tsx:7`）的写法；
  - 点了以后显示"保存后清除"，并允许撤销；
  - 位置和措辞按表单的整体风格调整。

## 不在这次范围

- **私钥管理界面（`store.sshKeys`），以及"导入私钥后删除原文件"的提示**：Rust 里还没有私钥函数，真模块返回 `unavailable`。要等负责人决定阶段 B 进不进 3.0。
- **迁移后提醒用户重新开启 Touch ID、创建恢复码**：`getState()` 的 `migration` 字段已经有了。这件事也跟阶段 B 一起定。
- **用"您"还是"你"**：等负责人定，定了以后再统一应用和官网的文案。
- **服务器配置仍然走旧的保存通道**：旧通道背后已经是 store，能正常用，3.0 不用改成 `store.profiles`。

## 10-12 审查结果（`feat/ui-store`，`a486014`）

U1–U17 都做了，测试从 623 个增加到 770 个，类型检查、构建、文案检查都通过；没有改 `src/**` 以外的文件，也没有削弱已有测试。审查发现下面这些问题，行号以 `a486014` 为准。

开工前先 `git merge v3-next`：Claude 10-12 的提交里有 R3 的后端修复和 R7 要用的新接口。

### 合并前要修

#### R1 加载服务器列表时丢弃结果，可能删掉所有已保存的服务器（高）

- **位置**：`src/lib/workspaceUnlock.ts:19-29`。
- **问题**：`stillCurrent()` 比较的是 `sessions` 数组本身。只要加载期间列表被别处改过，就把读到的列表丢掉，并直接返回 `true`。
  - 例子：开机或解锁后，加载还没完成时用户点了"+"，`useCoreAppEvents.ts:56` 加进一个草稿，于是读到的列表被丢掉，窗口里只剩这个草稿；
  - 用户接着连接或保存，`syncProfiles` 整份保存 `[草稿]`，工作区里其他服务器就都被删掉了。
  - 丢弃时也没有调 `opened()`，锁定状态不会被清掉。
- **要做**：
  - 只有工作区变了，或者 2.0 导入已经换过列表时，才保留现在的列表。可以在 `sessionStore` 里加一个版本号，只在整份替换（2.0 导入、切换工作区）时加一，比较版本号而不是比较数组；
  - 其他情况一律用读到的列表，再把现在列表里的草稿和快速连接合进去，参考 `AssetBridgeTab.tsx:85` 的做法；
  - 不管走哪条路，都要清掉锁定状态。
- **验收**：vitest。加载等待期间加一个草稿，加载完成后，列表里既有读到的服务器，也有这个草稿；之后保存，提交的整份列表里包含读到的服务器。

#### R2 "查看密码"不管电脑支不支持，都先用 Touch ID（中）

- **位置**：`src/components/SavedSecretControl.tsx:139`、`:117`、`:58-60`。
- **问题**：
  - 没有 Touch ID 的 Mac、没有 Windows Hello 的电脑，点"查看密码"会先走 Touch ID，然后显示"此功能暂时不可用，请重启应用后重试"。重启并不能解决；
  - 查看窗口过期后（`show` 返回 `locked`），重新打开时只走 Touch ID，即使用户刚才是输密码验证的。
- **要做**：
  - 从 `security.status()` 判断能不能用 Touch ID：`presenceSupported`，再加上对应范围的 `presence`。设了主密码时看 `id: 'app'` 那一项，否则看这个工作区那一项；
  - 不能用时，点"查看密码"直接展开输入密码；两样都没有时，说明无法查看；
  - 查看窗口过期后，用户上次怎么验证的就怎么重新验证。用的是密码就重新让用户输入，不要保存密码；
  - 修 spec：`unavailable` 之后不应该再提示 Touch ID。
- **验收**：spec 覆盖三种情况：不支持 Touch ID、支持但没开、开了。前两种不出现"重启应用"的提示。

#### R3 导出时取消 Touch ID，会要求给没有密码的工作区输入密码（中）

- **位置**：`src/components/secure-center/tabs/EncryptedBackupSection.tsx:123-126`。
- **问题**：真模块原来在用户取消后，把剩下所有工作区都标成 `cancelled`，界面就为每一个都要密码，包括根本没有密码的。
- **后端已修**（Claude，10-12）：取消后，不需要验证的工作区照常打开，没开 Touch ID 的仍然返回 `needs_password`，只有还没打开、开了 Touch ID 的才标 `cancelled`。
- **要做**：`git merge v3-next` 后补一个 spec 覆盖这种情况；界面只为 `unlockWith` 里有 `password` 的工作区要密码，作为保险。

#### R4 点过"加载更早的消息"以后，新消息不再自动滚到底（中）

- **位置**：`src/components/ai-center/ChatView.tsx:171`。
- **问题**：`followLatest` 被设成 `false` 以后，只有滚回底部或者切换对话才会恢复。用户发出新问题后，自己的消息和回复都在视野外面。
- **要做**：用户发出新消息时（最后一条变成 `role: 'user'`），把 `followLatest` 设回 `true`。
- **验收**：spec 覆盖先加载更早的消息、再发新消息，结果滚到底部。

#### R5 锁屏打断生成后点重试，旧请求的输出会混进新回复（中）

- **位置**：`src/components/ai-center/useAiInteraction.ts:92`（`requestId: aiMsgId`）。`CommandCenterAiChat.tsx` 也一样。
- **问题**：
  - 锁屏或切换工作区时，界面把回复标成结束，但主进程的请求还在跑，没有办法中止；
  - 重试用的还是同一个 `requestId`，旧请求后面的片段、结束信号和命令确认请求，都会发到重试的这条回复上。
- **要做**：每次生成都用一个新的 `requestId`，比如 `${aiMsgId}:${次数}` 或者 `crypto.randomUUID()`。消息 id 不变。
- **验收**：spec 模拟这个过程：生成到一半锁屏，解锁后重试，再往旧的 `requestId` 发片段，结果片段不会出现在回复里。

### 可以合并以后再修

| 编号 | 位置 | 问题 | 要做 |
|---|---|---|---|
| R6 | `SafeStorageTab.tsx:227` | 新说明写"此次更改不影响已锁定的工作区"，但关闭时会影响 | 照真模块的行为写（Claude 已用测试确认，假实现 10-12 起也一样）：开启时，只对当前已解锁、有单独密码的工作区生效；之后才设密码的工作区不会自动开启，要再开一次；关闭时对所有工作区生效 |
| R7 | `LegacyV2Import.tsx:107,143-148` | 选"暂时跳过"只在这次启动内有效，每次解锁都会再弹；读不出来的 2.0 文件每次都会报错 | Claude 已加 `store.legacyV2.dismiss()`（见 `src/types.d.ts`）。弹框加"不再提示"，调用它。`status().imported?.dismissed` 为真时不弹框、不报错，`kind` 是 `unreadable` 时也一样；文件换过以后后端不再报告 `dismissed`，界面照常询问。`portDefaulted > 0` 仍要处理，判断放在 `dismissed` 之前 |
| R8 | `LegacyV2Import.tsx:130` | 默认端口没设上时，提示写"服务器未能导入"，可实际上已经导入了，而且只有"跳过"按钮 | 单独写一句提示：服务器已导入，默认端口没设上；加"重试" |
| R9 | `LegacyV2Import.tsx:94,225` | 当前工作区锁着时弹框，输入框和按钮都不能用，也没有说明，还盖住了工作区的解锁界面 | 导入写的是主工作区，不需要当前工作区已解锁：输入框照常可用，只是返回的列表等当前工作区解锁后再用；或者等解锁后再弹 |
| R10 | `ConnectForm.tsx:298` | "清除已保存的密码"点了立刻删除，没有确认，也不能撤销 | 和插件设置一样：点了以后先显示"保存后清除"，可以撤销，保存时才真正清除 |
| R11 | `storeFeedback.ts:16`、`EncryptedBackupSection.tsx:195` | 导入后"需要重启"只在导出页显示；在其他地方，`unavailable` 仍然显示成"此功能暂时不可用" | `useBackupRestartStore` 为真时全局显示一条"需要重启"的提示，`storeFailureMessage('unavailable')` 也说要重启 |
| R12 | `EncryptedBackupSection.tsx:145,43-47` | 导出失败后，备份密码和确认密码还留在状态里；没有主密码时自动锁定，也不会清掉 | 失败时清空两个密码；`isVaultLocked` 变化或工作区锁定时也清空 |
| R13 | `PluginSettings.tsx:145` | 点"清除已保存的值"后，之前输入的值保存在 `draftsBeforeClear` 里，关掉面板也不清 | 关面板时清空 `draftsBeforeClear` |
| R14 | `EncryptedBackupSection.spec.tsx:90,166` | 测的是主进程不会返回的结果：`relaunch` 不会返回 `unavailable`，`unlockForExport` 不会整体返回 `cancelled` | 换成真实可能出现的：`relaunch` 的 `unauthorized`、`invalid_argument`；`unlockForExport` 的 `failed` 里有 `cancelled` |
| R15 | `useAiConversation.ts:61,77` | `onRetry`、`onServerSelect` 依赖 `isGenerating`，开始和结束生成时所有消息都会重新渲染 | 用 ref 读 `isGenerating`，回调保持不变 |
| R16 | `ChatView.spec.tsx:75` | "不订阅别的对话"这个测试，就算 `ChatView` 改回订阅全部对话也会通过 | 统计 `ChatView` 自己的渲染次数 |
| R17 | `ChatView.tsx:155-156` | 加载更早的消息时，滚动位置在后一次渲染才恢复，可能闪一下；加载期间底部有新内容，位置会偏 | 在同一次提交里恢复：用插入前第一条可见消息做锚点 |
| R18 | 官网 | 改动在 `codex/ui-store-copy` 分支上，工作目录在 `/private/tmp/getssh-ui-store-mepcx951/website`，系统清理临时文件时可能被删；`en.json`、`zh.json` 第 96、117 行写着"xterm.js + WebGL 渲染"，但默认设置用的是 xterm 自带的渲染，开了防眩光才用 WebGL | 工作目录挪到 `/Volumes/Developer` 下；改这两处说法；合并进 `main` 前问负责人，官网合并后会直接上线 |

### Claude 这边（10-12）

- 已做：
  - 批量解锁在取消后的处理（R3 的后端部分），Rust 测试 2 个；
  - 删掉没人用的 `toggleWorkspaceBiometric`（`types.d.ts`、preload、`workspace:toggleBiometric`）；
  - 新增 `store.legacyV2.dismiss()`（R7 用）：只是选过"不再提示"、没有导入过时，之后出现的新 2.0 文件照常自动导入；已经导入过一次的，自动导入仍然只有那一次。单元测试 8 个，端到端测试 2 个阶段；
  - 批量解锁还改了三处：同一个工作区只报告一次；不存在的工作区返回 `not_found`，不会被新建；打开工作区出错时返回真实的错误码，不再一律报 `needs_password`；
  - 假实现的 Touch ID 行为改成和真模块一致：开关只影响当时已解锁的工作区；新设密码的工作区不会自动开启；导出时每个工作区各问一次，取消后不再问；没有主密码时，`appState().presenceEnabled` 为 `false`。原来假实现是"一次验证解开全部、自动沿用、下次解锁时补开"，那是设计里想要的，真模块还没做到，放到 3.x；
  - 端到端测试用真模块验证了：加密备份从导出、导入到重启的完整往返（密码和有单独密码的工作区都恢复了）；输入 2.0 密码导入（输错能重输）；默认端口只补一次。端到端测试从 22 个阶段增加到 31 个。
- 等 `feat/ui-store` 合并时做：
  - 删掉 4 个旧的数据库导出导入通道（`exportDatabaseAll` 等）；
  - 删掉 `@xterm/addon-canvas`（`package.json`、`vite.config.mts`、lockfile）。
- Touch ID 的真机行为要负责人在场时测。

## 10-13 复查（`feat/ui-store`，`2a3551c`）

R1–R18 都处理了，大多数撤掉修复后测试会失败；整套测试 75 个文件、860 个测试全部通过（交付时报的 377 个只是其中一部分，下次请跑整套 `pnpm exec vitest run`）。合并提交 `2cd6c5d` 和自动合并的结果一致，改动都在 `src/**` 里。官网工作目录已挪到 `/Volumes/Developer/GETSSH-WEBSITE-codex`，没有合进 `main`。

复查又发现下面这些问题，行号以 `2a3551c` 为准。R19–R23 修完才能合并进 `v3-next`：负责人每天用 `v3-next` 处理真实数据，其中三条会丢数据或改错数据。

先 `git merge v3-next`：Claude 10-13 在主进程加了一道保护，工作区切换期间拒绝整份保存（R19 的兜底）。

### 合并前要修

#### R19 系统识别后的保存没有保护，切换工作区时可能删光所有服务器（高）

- **位置**：`src/components/IpcManager.tsx:104-110`。这段代码原来就有，但 R1 的保护没覆盖到它。
- **问题**：
  - 连接后大约 1.2 秒收到系统识别结果，50 毫秒后整份保存列表；
  - 如果这 50 毫秒里用户切换了工作区，`switchWorkspace` 会先清空列表（`workspaceStore.ts:110`），而 `activeWorkspaceId` 要等主进程回复才变，所以检查能通过，结果把空列表存进原来的工作区。
  - 主进程 10-13 起在切换期间会拒绝这类保存，但界面这边也要补上。
- **要做**：保存前和其他整份保存一样检查：`profilesWorkspaceId === workspaceId`，并且不在切换中（`!isSwitching`）、工作区没锁、应用没锁。
- **验收**：spec 模拟收到系统识别结果、50 毫秒内开始切换工作区，结果没有调用 `saveProfiles`。

#### R20 默认设置下无法查看已保存的密码（高）

- **位置**：`src/components/SavedSecretControl.tsx:68`。
- **问题**：
  - 现在只有 `presenceSupported` 为真，**并且**对应范围的 `presence` 也为真时，才允许用 Touch ID。可是没有单独密码的工作区，`presence` 永远是 `false`；
  - 默认设置（没有主密码、工作区也没有单独密码）下，两种验证方式都不能用，已保存的密码一个都看不了。
  - 这是 R2 写错了，不怪实现：查看密码时用 Touch ID，只是让系统确认一下"本人在场"（`open_reveal_with_presence` 只调用 `verify_presence`），和这个范围有没有开启 Touch ID 解锁无关。
- **要做**：
  - 只要 `presenceSupported` 为真，就可以用 Touch ID / Windows Hello 查看；不再看 `scope.presence`；
  - 输入密码那条路照旧：设了主密码时输主密码，工作区有单独密码时输工作区密码，两样都没有就不显示；
  - 两样都不能用（不支持 Touch ID，也没有密码）时，说明无法查看。
- **验收**：spec 覆盖默认设置、支持 Touch ID 的情况，点"查看密码"会调用 `open({ method: 'presence' })`。

#### R21 应用还没解锁时，开机检查把只剩草稿的列表当成了完整列表（中，可能丢数据）

- **位置**：`src/hooks/useCryptoBoot.ts:34-35`。
- **问题**：`check-profiles` 在应用没解锁时返回 `status: 'none'`（`electron/main/handlers/cryptoHandler.ts:38`）。这里却调了 `replaceSessions(只有草稿的列表, workspaceId)`，等于宣布"这个工作区的完整列表已经在内存里了"。解锁后的下一次保存，会把只有草稿的列表整份存进去，其他服务器都会被删掉。
- **要做**：`status` 是 `none` 时什么都不改，等应用解锁后由 `useAppLockSync` 重新加载。
- **验收**：spec 模拟 `checkProfiles` 返回 `none` 时，`profilesWorkspaceId` 仍是 `null`，之后的保存被拒绝。

#### R22 2.0 导入替换列表时丢掉草稿，可能把输入存进别的服务器（中）

- **位置**：`src/components/app-overlays/LegacyV2Import.tsx:94-98`（`adoptProfiles`）。
- **问题**：
  - 这里直接用导入返回的列表替换，没有合并草稿和快速连接，也没有调整 `selectedSessionIndex`；
  - 如果用户正在编辑一个草稿（第 n 项），替换后第 n 项变成了某个已保存的服务器，连接表单会切到它；用户接着输入，自动保存就写进了这个服务器。
- **要做**：照 `loadProfiles`（`workspaceUnlock.ts:39-43`）和 `AssetBridgeTab.tsx:84-89` 的做法，合并草稿和快速连接，并把选中项移到同一个服务器上。
- **验收**：spec 中编辑草稿时完成导入，草稿还在，选中项不变。

#### R23 "先跳过"在切换工作区后失效，提示框又弹出来（中）

- **位置**：`src/components/app-overlays/LegacyV2Import.tsx:64-75`。
- **问题**：每次切换工作区、锁定或解锁工作区，都会清掉 `checkedReady`，然后重新调 `status()` 并弹出提示框。R7 原本就是为了解决反复弹框，现在弹得比以前更频繁；每次重新检查还会再解密一遍 2.0 文件。
- **要做**：用户选了"先跳过"，就在这次运行里记住，直到应用锁定或重启。工作区变化时仍然清掉密码，但不重新弹框。
- **验收**：spec 中先跳过，再切换工作区，结果没有再调用 `status()`，也没有弹框。

### 可以合并以后再修

| 编号 | 位置 | 问题 | 要做 |
|---|---|---|---|
| R24 | `useCryptoBoot.ts:20-23` | 开机检查期间如果列表被别处替换过，直接返回，不再自动弹 Touch ID，用户只看到输入密码的界面 | 列表被替换时也照常判断要不要自动弹 Touch ID |
| R25 | `EncryptedBackupSection.tsx:24,125-128` | ① 用户选完工作区后，有工作区被锁上，它不在可以输密码的名单里，就被悄悄过滤掉，流程停住，也没有提示；② 当前工作区锁着时，导出和导入按钮都变灰，也不说明原因，可主进程并不要求当前工作区已解锁 | ① 被过滤掉的工作区要提示，并重新读取候选列表；② 只在应用锁定时禁用（和 `ExportTab.tsx:20` 一样） |
| R26 | `SavedSecretControl.tsx:95-101` | 导入备份后、重启前点"查看密码"，`unavailable` 被当成"系统验证不可用"，要用户输密码，可输了也没用，而且没提要重启 | 导入后（`useBackupRestartStore` 为真）显示"需要重启"，不再要密码 |
| R27 | `LegacyV2Import.tsx:133` | 默认端口没设上时，提示"请解锁主工作区后重试"。可主工作区在应用解锁后不会单独锁着；锁着的是导入时的那个工作区，它后来可能已经不是主工作区了 | 改成"请解锁导入这些服务器的工作区后重试"，或者不指明是哪个工作区 |
| R28 | `aiChatStore.ts:365-367` | 锁屏时把回复标成结束，但命令确认卡片还是"待确认"，解锁后仍能点"允许"。命令会在服务器上执行，可输出已经不显示了（原来就有的问题） | 锁屏时把待确认的卡片标成过期，并回复主进程拒绝 |
| R29 | 官网 `en.json`、`zh.json` 第 96、117 行；官网仓库的 `README.md`、`README_CN.md` | ① 官网写"防眩光模式"，应用里这个设置叫"终端防瞎眼"/"High-Contrast Terminal"，用户找不到；② 官网仓库的两个 README 还写着零拷贝、绕过 V8 堆、"xterm.js + WebGL" | ① 用应用里的设置名称；② 一起改掉 |

### Claude 这边（10-13）

- 已做：主进程在工作区切换期间拒绝整份保存（`workspaceHandler.ts` 的 `isWorkspaceSwitching`，`cryptoHandler.ts` 的 `save-profiles`），端到端测试覆盖了这种情况。这道保护在现在的 `v3-next` 上也有用：R19 那段代码在 `v3-next` 里本来就有。
- 等 R19–R23 修完：复查一次，删掉 4 个旧的数据库导出导入通道和 `@xterm/addon-canvas`，再合并进 `v3-next`。
- 之后可以考虑：整份保存带上"列表版本"，主进程发现版本对不上就拒绝。这样不管界面哪里出错，都不会因为整份保存删掉服务器。要改主进程和界面两边，3.0 之后再定。

## 10-14 复查（`feat/ui-store`，`c7efb37`；官网 `codex/ui-store-copy`，`246e61e`）

R19–R29 都处理了。

- **测试**：编译好原生模块后，整套测试 78 个文件、899 个测试全部通过。在 Codex 的工作目录里会有 14 个失败（`OceanSentinel.test.ts`、`LlmGateway.metrics.test.ts`），原因是那里没有编译 `rust-core/ocean-sentinel`（报 "Cannot find native binding"），和这次改动无关。以后交付时请注明这类失败，或者先编译再跑。
- **撤掉修复**：R19–R28 每撤一条，对应的测试都会失败。R19 里的 `isSwitching` 和 R23 工作区订阅里的那道检查是双重保护，单独撤掉不报错，因为另一道还在。
- **合并**：`f65fe5d` 和自动合并的结果一致，改动都在 `src/**` 里。
- **Claude 10-14**：删掉了 4 个旧的数据库导出导入通道和 `@xterm/addon-canvas`，跑完整套检查后合并进 `v3-next`。

### 还剩的小问题（不挡合并）

| 编号 | 位置 | 问题 | 要做 |
|---|---|---|---|
| R30 | `useCryptoBoot.ts` 的 `encrypted` 分支 | 开机检查期间，如果这个工作区的列表已经加载好了（`sessionsRevision` 变了，且 `profilesWorkspaceId === workspaceId`），现在还是会把界面锁上，开了 Touch ID 的还会再弹一次。原来的代码遇到这种情况直接当作已解锁。实际很难碰到 | `encrypted` 分支里先做和 `plain` 分支一样的判断：列表已经加载就设 `isVaultLocked: false` 后返回，否则照常锁上并按设置弹 Touch ID。补一个 spec |
| R31 | 官网 `en.json:24`、`en.json:33`、`zh.json:33`；官网仓库 `README.md`、`README_CN.md` | ① copy-lint 还报 3 处机器腔：peace of mind、not just … but …、不仅……更……；② 两个 README 还是按 2.0 写的，例如插件沙箱写成 "vm.Script + iframe"（3.0 的后端插件跑在受系统限制的独立进程里）、Electron 42 | ① 改成直接陈述；② 3.0 发布前把 README 按 3.0 的实际情况更新，可以只留官网仓库本身的说明，产品介绍链到官网 |

官网分支合进 `main` 会直接上线，要等负责人同意。

### 10-14 晚：R30、R31

- R30（`ae5fc1f`）：改对了。撤掉修复后 3 个 spec 失败；整套测试 78 个文件、902 个测试全部通过。已合进 `v3-next`。
- R31（官网 `d8ac971`）：三处文案改好了，copy-lint 不再报机器腔。两个 README 改成了官网仓库本身的说明，版本号、脚本、Dockerfile 和链接都和仓库一致。
- 新发现一处，合进官网 `main` 之前要改：

| 编号 | 位置 | 问题 | 要做 |
|---|---|---|---|
| R32 | 官网 `zh.json:24`（`aiAnnouncement`） | 英文这句改成了"3.0 预览版已包含 AI 排障"，中文还是旧的"下一代原生 AI 引擎即将接入"，两种语言说法相反。中文里"AI 运行在独立沙箱中，通过受控中间件安全通信"也不准确：AI 请求经客户端的网关发给模型服务，发出前做脱敏；放进系统沙箱的是 MCP 服务器和后端插件 | 中文按英文的意思重写，只写实际有的：3.0 预览版可以用 AI 排障，代理模式下操作终端和执行命令要经过确认 |

## 阶段 B：私钥存进 GETSSH，恢复码和 Touch ID 的提醒（10-15）

负责人 10-15 决定阶段 B 进 3.0。分工：
- **Claude**：存储模块（Rust 和假实现）、主进程、preload、类型定义；
- **Codex**：下面 B1–B5 的界面和文案，只改 `src/**`。

Claude 先改主进程接口、preload、`src/types` 和假实现（10-15 当天），之后再写 Rust 正式模块，接口保持不变。所以界面可以先在 `GETSSH_FAKE_STORE=1` 的开发模式里做，测试照常 mock `window.electronAPI`。接口有缺的或者不顺手的，写在本节最后，不要改 `electron/**`。

### 接口（Claude 提供）

都在 `window.electronAPI.store.sshKeys` 下，返回 `StoreResult`：

| 方法 | 做什么 | 返回 | 要处理的错误 |
|---|---|---|---|
| `list({ workspaceId })` | 这个工作区里保存的私钥，按创建时间排序 | `{ keys: SshKey[] }` | `locked` |
| `chooseFile()` | 主进程弹出文件对话框（从 `~/.ssh` 开始），读取并检查格式 | `{ fileId, fileName, encrypted }`；`fileId` 只在 10 分钟内、只在主窗口有效 | `cancelled`（安静处理）、`file_too_large`、`unsupported_key` |
| `import({ workspaceId, fileId, name?, passphrase? })` | 导入选好的文件；`name` 不填时用文件名 | `{ key: SshKey }` | `needs_password`、`wrong_password`（`fileId` 还能用，让用户重输口令）、`not_found`（`fileId` 过期，请重新选择）、`locked` |
| `generate({ workspaceId, name })` | 生成新的 ed25519 私钥 | `{ key: SshKey }` | `locked` |
| `delete({ workspaceId, id })` | 删除私钥；用到它的服务器 `keyId` 变成 `null` | `{ workspaceId, profiles }`：主进程已保存的完整列表 | `not_found`、`locked` |
| `importProfileFile({ workspaceId, profileId, passphrase?, trashOriginal, language? })` | 把一台服务器正在用的私钥文件（`privateKeyPath`）导入；这个工作区里所有用同一个文件的服务器都改用导入的私钥 | `{ workspaceId, key, profiles, trashed, kept? }` | `needs_password`、`wrong_password`、`unsupported_key`、`io`（文件不在了）、`not_found` |

- `SshKey`：`{ id, name, algorithm, fingerprint, publicKey, hasPassphrase, created_at }`。
  - `algorithm` 是 `ed25519`、`rsa-3072`、`ecdsa-p256` 这类写法；
  - `fingerprint` 是 `SHA256:...`；
  - `publicKey` 就是要放进服务器 `~/.ssh/authorized_keys` 的那一行。
- 私钥本身和口令永远不会传到界面。
- 支持的格式：
  - OpenSSH（可以带口令）；
  - PEM：PKCS#1、SEC1、PKCS#8（都可以加密）；
  - PuTTY `.ppk` 第 2 版和第 3 版。
  - 只收 Ed25519、RSA、ECDSA 私钥。DSA 返回 `unsupported_key`，因为 Electron 不能用它签名；可以提示用户换一个 Ed25519 私钥。
  - 文件里只能有一段私钥。
  - 别的格式返回 `unsupported_key`，提示用户先转成 OpenSSH 格式。
  - 口令保护的计算量超过上限的私钥也返回 `unsupported_key`：bcrypt 超过 256 轮、PBKDF2 超过一百万次、Argon2 超出预算。ssh-keygen、OpenSSL、PuTTY 默认写的都远低于上限。遇到这种情况，可以提示用户用 `ssh-keygen -p` 重新设置口令。
- `trashOriginal` 为真时，原文件**移到废纸篓**，不是直接删除。
  - 主进程会先用自己的对话框问一次，对话框里写出文件路径，语言按 `language`（`zh-CN` / `en-US`，默认英文）。界面里那个勾选项就是用户的意思，界面不用再加一层确认。
  - 下面几种情况会保留原文件，原因放在 `kept` 里：
    - `used_elsewhere`：GETSSH 里还有服务器在用它（按文件本身比较，链接、大小写不同的路径也算），或者 2.0 的服务器列表还在；
    - `workspaces_locked`：有工作区锁着，没法确认有没有在用；
    - `declined`：用户在主进程的对话框里选了保留；
    - `trash_failed`：移不动。
- **返回 `profiles` 的两个方法（`delete`、`importProfileFile`）**：
  - 主进程已经把整份列表存好了。界面要像 R22 的 `adoptProfiles` 那样采用它：保留草稿和快速连接，选中项留在同一台服务器上，**不要再保存一次**。
  - 返回的 `workspaceId` 不是当前工作区时（等待期间切换了工作区或锁定了），丢掉这个结果。
  - 界面手里还留着已删除私钥的 `keyId` 时，主进程保存时会把它当作没有，不会让整份保存失败；但界面照样应该采用返回的列表。
- 服务器配置：
  - 用保存的私钥时，设 `authType: 'key'`、`keyId: <id>`、`privateKeyPath: null`；
  - 连接时主进程从库里取私钥和它的口令，界面什么都不用传。

### B1 私钥管理（新）

- **位置**：设置 → SSH（`SSHTab.tsx`）里加一节"私钥"。私钥按工作区存，标题写明"当前工作区"。
- **列表**：每个私钥显示名称、算法、指纹（等宽字体，太长可以截断，悬停显示全文）、创建时间，以及有几台服务器在用（从当前工作区服务器的 `keyId` 统计）。
- **导入**：
  - 先 `chooseFile()`；`encrypted` 为真时显示口令输入框，再 `import()`；
  - `wrong_password` 时保留对话框，提示"口令不对"；`not_found` 时提示重新选择文件；`unsupported_key` 时说明支持哪些格式。
- **生成**：
  - 输入名称后调用 `generate()`；
  - 成功后显示公钥那一行和"复制"按钮，并说明"把这一行加到服务器的 `~/.ssh/authorized_keys` 里"。
- **每个私钥都能复制公钥**。
- **删除**：
  - 确认框里列出正在用它的服务器名称，说明删除后这些服务器要重新选择私钥；
  - 删除后采用返回的 `profiles`。
- **状态保护**：工作区锁定、切换工作区、应用锁定时清空状态、作废进行中的请求，和 `SavedSecretControl` 的 generation 做法一样；工作区锁着时按钮不可用。
- **验收**：spec 覆盖导入（含 `needs_password` 后补口令成功）、生成后复制公钥、删除后采用列表、切换工作区时丢弃迟到的结果。

### B2 连接表单用保存的私钥（改）

- 认证方式选"私钥"时，可以从"已保存的私钥"里选，也可以选"使用文件"（原来的路径输入）。
  - 选已保存的：`keyId` 设为它，`privateKeyPath` 清空，同时传 `passphrase: null`，清掉原来文件的口令；口令框隐藏，因为口令跟着私钥一起存了（连接时私钥自己的口令优先）。
  - 选文件：`keyId` 设为 `null`。
- 已保存的服务器如果还在用私钥文件：
  - 显示一行说明："这个私钥还是磁盘上的文件，加密备份里不包含它。"另加一个按钮"导入到 GETSSH"；
  - 点了以后弹确认框，里面有一个默认不勾的选项："导入后把原文件移到废纸篓"，并说明同一工作区里用这个文件的服务器会一起改用导入的私钥；
  - 调 `importProfileFile`。`needs_password` 时请用户输入口令再试；完成后采用 `profiles`，并告诉用户原文件移走了没有、没移走的原因。
  - 草稿和快速连接不显示这个按钮（它们还没有 `profileId`）。
- **验收**：spec 覆盖选择保存的私钥后保存的 `keyId`、`privateKeyPath` 和 `authType`；导入文件私钥后采用列表，正在编辑的草稿还在。

### B3 恢复码提醒（改）

- 设主密码时已经会生成恢复码（`SafeStorageTab.tsx:119-120`）。要补的是：设了主密码（`appProtected`）但没有恢复码（`recoveryConfigured` 为 false）时，在设置 → 安全的"待处理事项"里加一行，例如："还没有恢复码。忘了主密码时，只有恢复码能打开数据。"再给一个跳到生成恢复码的按钮。
- 顺便检查：设主密码后，生成恢复码那一步失败了、或者用户没看就关掉了，最终状态是否正确，提醒会不会出现。
- **验收**：spec 覆盖 `appProtected && !recoveryConfigured` 时出现提醒；有恢复码后提醒消失。

### B4 迁移后重新开启 Touch ID 的提示（新，做最简单的）

- `appState().migration?.presenceToReenable` 不为空时，解锁后显示一条提示，列出这些工作区的名称，再给一个按钮调用 `security.setPresence`。用户关掉提示后，这次运行内不再显示。
- **10-19 更正**：原来这里写的"逐个调用 `setPresence({ workspaceId })`"是错的。`setPresence` 是一个总开关，主进程不看 `workspaceId`：
  - 它给所有**已解锁**的范围打开 Touch ID，设了主密码时也包括主密码解锁；
  - 锁着的工作区原样跳过，不报错，照样返回 `ok`。
  - 名单里的工作区都有自己的密码，迁移后都是锁着的；切换到别的工作区时又会锁上。所以一次只能开当前这一个。见下面 10-19 复查的 R37。
- 这个名单只在迁移 3.0 开发版旧数据的那一次启动时出现。2.0 用户升级不会遇到，所以不用做持久化。
- **验收**：一个 spec，有名单时出现提示、点按钮会调用 `setPresence`。

### B5 文案和更新日志

- 应用里：设置页的私钥说明、连接表单的提示，都按 `docs/GETSSH_COPY_STYLE_CN.md` 写，跑 `scripts/copy-lint.js`。
- 官网的 3.0 更新日志加一条：私钥可以导入 GETSSH，导入后随加密备份带走；还在用磁盘文件的私钥不在备份里。官网照旧先别合进 `main`。

### 顺序和交付

- 先做 B1、B2（今天就能用假实现开发），再做 B3、B4、B5。
- 交付前合并 `v3-next`，跑整套 `pnpm exec vitest run` 并附上原始输出。原生模块没编译导致的失败请注明。
- Claude 的正式模块合进 `v3-next` 以后，再在真实存储上点一遍 B1、B2。

### Claude 这边

- **10-15 已完成**，接口和上面的表一致：
  - 主进程接口、preload、类型和假实现；
  - Rust 正式模块：导入、列出、删除，口令随私钥加密保存，连接时取用，跨工作区复制和备份都带上私钥；
  - 主进程里的格式处理：`.ppk` 第 2、3 版和 PKCS#8 转成 ssh2 能用的格式；生成 ed25519 私钥。
  - 详见 `GETSSH_STORE_DESIGN_CN.md` 第 9 节"阶段 B"。
- 正式模块和假实现的行为一致（逐项对照零差异），所以在假实现上做好的界面，换到正式模块上不用改。
- 界面里的 `SessionProfile` 还没有 `keyId` 字段，B2 需要加上：`keyId?: string | null`。选"使用文件"时要明确传 `keyId: null`。不传这个字段时，主进程会保留原来的值。
- 之后复查 B1–B5。

## 10-19 复查阶段 B（`feat/ui-store`，`1be590e`；官网 `codex/ui-store-copy`，`1cf64ea`）

B1–B5 都做了，界面和接口对得上。

**测试和检查**：
- 在 Claude 的工作目录里，合上 `v3-next` 的后端一起跑：整套测试 84 个文件、1004 个测试全部通过；
- 类型检查、构建、完整的 21 项检查（含打包后启动）都通过；
- 新文案过了 copy-lint，官网报的几处都在旧版本的更新日志里，不是这次加的；
- 阶段 B 的后端 10-19 在 Windows CI 上也通过了，包括用导入的私钥真的登录。

**审查**：3 个只读审查分头看，再由第 4 个逐条对着代码核实。下面是核实成立的。

R33–R37 要在合进 `v3-next` 之前改，其余的可以一起改，不挡合并。每条请补一个 spec，撤掉修复时它要失败。

**10-19 晚更新**：负责人决定 R33–R37 由 Claude 改，已经改完（`eaea435`，见本节最后）。R38–R45 和官网的 R32 交给 Codex。表里的行号以 `1be590e` 为准；`MigrationPresenceNotice.tsx` 已被 Claude 重写，R43 请在新版本上改。

**另外，spec 里的服务器要和真实数据一样带 `keyId: null`。** 主进程读出来的服务器都有这个字段，没用库里私钥的是 `null`，不会没有。现在的 spec 不带它，所以 R35、R39 都没测出来。

| 编号 | 位置 | 问题 | 要做 |
|---|---|---|---|
| R33 | `ConnectForm.tsx:410`（"密码"按钮）、`SshKeysSection.tsx:57` | 已经改用库里私钥的服务器，切回"密码"后 `keyId` 还留着，连接时主进程只试私钥，密码永远试不到。设置页也还把它算成"在用"这个私钥，删除确认里会列出它 | 主进程这一半 Claude 已改（`febb076`）：`authType` 是 `password` 时不带库里的私钥。界面：切到"密码"时同时传 `keyId: null`；统计"几台服务器在用"只算 `authType === 'key'` |
| R34 | `ConnectForm.tsx:421-424`（`onSelectKey`） | 先在"密码"下点了"清除已保存的密码"，再换成库里的私钥，然后保存：界面显示密码已清除，库里其实还留着，还会随备份导出。原因是 `onSelectKey` 把 `password` 改成了 `undefined`，而 `undefined` 的意思是"保留" | `onSelectKey` 不要动 `password`。spec：先清除密码，再选私钥，保存后发出去的 `password` 是 `''` 或 `null` |
| R35 | `ConnectionPrivateKey.tsx:110` | 导入服务器的私钥文件时，主进程已经保存好列表（必要时把原文件移进了废纸篓），这时连接表单如果关了、或者列表版本变了，界面就丢掉返回的列表。界面手里还是旧的 `keyId: null` 和文件路径，下一次整份保存会把服务器改回去，指向已经在废纸篓里的文件，登录失败 | 只要 `adoptWorkspaceProfiles` 自己的检查通过（同一个工作区，没在切换，没锁），就采用返回的列表，不管组件还在不在。对话框、提示这些界面状态再看 `alive` 和 generation。spec 的服务器加上 `keyId: null`；"卸载后丢弃"那个 spec 改成"卸载后仍然采用" |
| R36 | `SafeStorageTab.tsx:79`、`SecurityTab.tsx:142` | 恢复码只显示一次。没勾"我已保存"，就关掉详情、切到别的设置页、或者应用自动锁定，恢复码就没了。库里已经算"有恢复码"，所以 B3 的提醒不会出现，总览还写着"已创建恢复码"。B3 要检查的正是这种情况 | 记一个"这次运行里显示过、还没确认保存"的标记，不含恢复码本身，放在 store 里，只有点"完成"才清掉。标记在的时候，"待处理事项"里显示："新的恢复码还没确认保存过，请重新生成一个"，按钮和现在一样。改掉 `SafeStorageTab.spec.tsx:115-123` 的预期 |
| R37 | `MigrationPresenceNotice.tsx:60-64` | 按我写错的接口做的（见上面 B4 的更正）。名单里的工作区迁移后都锁着，点"开启"后每次调用都返回 `ok`，界面就把它们都标成已开启、提示消失，其实一个都没开。设了主密码时，还会顺带打开主密码的 Touch ID，提示里没说 | 只调一次 `setPresence({ workspaceId: null, enabled: true })`，再读 `security.status()`，只把 `presence` 已经为真的工作区标成完成。其余的留在列表里，写"切换到这个工作区并解锁后再开启"；当前工作区不在名单里、或者锁着时，按钮不可用。文案里说一句：设了主密码时，主密码解锁也会改用 Touch ID。spec 的 mock 照假实现的规则写：一个总开关，锁着的不变 |
| R38 | `SecurityTab.tsx:39, 223, 266` | `recoveryRequest` 只加不减。点过一次"生成恢复码"以后，再打开"主密码和恢复码"详情，生成恢复码的表单会自己弹出来；删掉主密码以后，它还会要求输入已经不存在的主密码 | 做成一次性的：`SafeStorageTab` 打开表单后回调一次，`SecurityTab` 把它清零 |
| R39 | `ConnectForm.tsx:298` | 从库里读出的服务器都带 `keyId: null`，所以每次连接已保存的服务器，都要先等一次整份保存。保存被拒（比如列表版本刚变）时，连接直接不发起，而且没有提示 | 只在私钥选择改过时先保存：`readySession.keyId !== (session.keyId ?? null)`，或者有待清除的密码时。spec：`keyId: null` 的服务器直接连接，不调用 `saveProfiles` |
| R40 | `ConnectionPrivateKey.tsx:149, 168-169` | "导入到 GETSSH"在两种情况下一直不可用，旁边写着"等待连接更改保存"，可这些更改永远不会自动保存：点过"清除"的口令，以及连接失败后留下的口令 | 判断"有没有未保存的更改"时，不比较 `password`、`passphrase`、`hasPassword`、`hasPassphrase`；待清除的另外处理，提示"先点保存"。最好直接用 `ConnectForm` 自己的状态（还在等防抖、有待清除的项） |
| R41 | `SshKeysSection.tsx:96-104, 189-195` | 设置页的私钥对话框，提交失败后（口令不对、格式不支持、生成失败）焦点落到页面上：Esc 关不掉，Tab 会跳到对话框后面的设置页 | 照 `ConnectionPrivateKey` 的做法，在 document 上监听 keydown 和 focusin；或者 `finish()` 时把焦点放回口令框或第一个控件，对话框加 `tabIndex={-1}` 兜底 |
| R42 | `SshKeysSection.tsx:167-173` | 导入时除了口令问题以外的失败（比如 DSA 的 `.ppk`、PKCS#8 DSA、口令计算量超限、`io`），主进程会忘掉这个文件，界面却还留着它：再点"导入"会提示"文件已过期" | 除了 `needs_password`、`wrong_password` 以外的失败，都把 `panel.file` 设成 `null`，显示"重新选择文件"。补一个 spec：`import` 返回 `unsupported_key`（不是 `chooseFile`）之后重试 |
| R43 | `MigrationPresenceNotice.tsx:79` | 层级 `z-[80]`，盖在主机指纹确认等 `z-50` 的对话框上面，窄窗口里会挡住按钮；在隐私模式的模糊范围之外，窗口失焦时工作区名称照样看得见；出现时读屏软件不会读 | 放到对话框下面一层；隐私模式模糊时隐藏；标题或说明加 `role="status"` |
| R44 | `SafeStorageTab.tsx:83` | 设置页开着时，在 B4 的提示里开了 Touch ID，设置页那一行还显示"开启" | `appLockStore` 的 `presenceEnabled` 变了也刷新状态 |
| R45 | `ConnectionPrivateKey.tsx:93, 98, 178`；`SshKeysSection.tsx:215`；`ConnectionPrivateKey.tsx:95` | 文案：① Windows 上应该叫"回收站 / Recycle Bin"，主进程的对话框已经这么写，界面的勾选项和结果还写"废纸篓 / Trash"；② 英文"Used by 1 servers"；③ `used_elsewhere` 写的是"仍被其他连接或 2.0 数据使用"，可主进程只要 2.0 的服务器列表还在就保留原文件，不检查里面有没有用到它 | ① 按平台用词，`useAppStore` 有 `isMac`；② 区分单复数；③ 改成"GETSSH 里还有服务器在用这个文件，或者 GETSSH 2.0 的服务器列表还在，原文件已保留。" |

**官网**：B5 的更新日志写得对。R32（中文 AI 公告）还没改，合进官网 `main` 之前要改。

### Claude 10-19

- `febb076`：R33 的主进程一半。`authType` 是 `password` 时，连接不带库里的私钥；Rust、假实现、逐项对照（293 步，0 处不一致）都覆盖了。
- `7014d0d`：Rust `zip` 升到 9.0.5，修 RUSTSEC-2026-0367、-0368、-0369。这三个问题都在 `zip` 自带的 `extract()` 里，GETSSH 没用它：插件解压是自己逐项写的，拒收链接，也不应用压缩包里的权限。升级是为了让依赖审计不再报红。
- `eaea435`：R33–R37 的界面部分，每条都有 spec，撤掉修复时对应的 spec 会失败（12 处逐一试过）。做法和表里写的一致，有几处细节：
  - R33：点"密码"时，有 `keyId` 才传 `keyId: null`；设置页只把 `authType === 'key'` 的服务器算作在用。
  - R34：`onSelectKey` 仍然丢掉输入框里没保存的密码，但有待清除的密码时传 `''`（清除），不再传 `undefined`（保留）。
  - R35：`current()` 要在采用列表之前判断，因为采用列表会让 `sessionsRevision` 变化。工作区切走再切回、应用锁定再解锁、列表被重新载入之后，返回的列表照样采用，只是不再显示提示。返回的是别的工作区、应用还锁着、正在切换工作区时，照旧丢掉。
  - R36：新加 `src/store/recoveryReminderStore.ts`，里面有两个标记：`unconfirmed` 表示生成过、还没确认保存；`visible` 表示恢复码正显示在屏幕上，这时不提醒。恢复码一生成，主进程返回成功就记下 `unconfirmed`，界面那时有没有显示出来都算。"待处理事项"里新加一行"恢复码还没确认保存"，只在设了主密码时出现。
  - R37：只开当前工作区。完成与否以 `security.status()` 为准：Touch ID 已开、工作区已经没有自己的密码、或者工作区已被删除，都算完成。提示出现时先查一次，主进程每次通知状态变化时再查，在设置里已经开好的工作区不再列出。
- 复核这次改动时又发现 3 处，已一起改好：
  - 强制更换主密码的对话框里生成的恢复码，也接上 R36 的提醒。
  - 把服务器的私钥文件导入 GETSSH 时，主进程在用户回答"移到废纸篓"之后，再检查一遍有没有服务器在用这个文件。问题出在这里：对话框开着时，窗口还在跑，可能存一次旧列表，又把服务器改回这个文件。返回给窗口的列表也改成对话框之后读的。
  - B4 的提示开着时，在设置里开了 Touch ID，提示里的那个工作区会马上消失。

### 交给 Codex：R38–R45 和官网 R32

- 先合并 `feat/master-key-store`（含 `eaea435`），在它上面改。
- 做法见上表。和 Claude 这次改动有关的两条：
  - R38：Claude 在"待处理事项"里新加的"重新生成恢复码"按钮，也会让 `recoveryRequest` 加一，一次性的处理要把它一起覆盖。
  - R39：判断"私钥选择改过"时，用保存时的 `session.keyId ?? null` 来比。R33 以后，点"密码"会把 `keyId` 设成 `null`。
  - R38 改完后：`SafeStorageTab` 里 `recoveryRequest` 打开的表单，`needsCurrent` 改成 `!!status?.appProtected`，和 `open()` 一致。然后去掉 `SecurityTab` 里"恢复码还没确认保存"那一行的 `appProtected` 条件，没设主密码时也提醒，`securityOverview.spec.tsx` 里对应的预期一起改。
- spec 里的服务器按真实数据带上 `keyId: null`，至少 R39、R40 的 spec 要这样写。
- 每条补一个 spec，撤掉修复时它要失败。交付时附上整套 `pnpm exec vitest run` 的原始输出。

## 10-20 负责人的决定和要做的事

**负责人定了**：
1. 删掉插件接口 `safeStorageEncrypt`：替代它的 `context.secrets` 10-11 就做好了。
2. 中文称呼用"您"。
3. MiSans 的许可协议原文放在官网，应用的设置里留一个入口，点击后打开官网上对应的那一节。
4. 开 dependabot。

**Claude 10-20 已做**：
- 删掉 `safeStorageEncrypt`：直接调用的插件和沙箱里的插件都删了（`PluginManager.ts`、`plugin-host.ts`、`pluginProtocol.ts`），类型定义也删了。旧插件调用它会报 `context.safeStorageEncrypt is not a function`。`docs/PLUGIN_SDK_INTERNAL_CN.md`、`docs/PLUGIN_SDK_INTERNAL.md` 已改成"3.0 删除了"。
- `docs/GETSSH_COPY_STYLE_CN.md` 第 6 节写了称呼的规则。`scripts/copy-lint.js` 加了一类"称呼"，会把"你"列出来。
- 打包附带的 `THIRD_PARTY_NOTICES.txt` 里，MiSans 两条后面写上了原文的地址：`https://getssh.realmcloud.net/en/legal/licenses#misans`。
- `.github/dependabot.yml`：每周一检查 Rust crate 和 GitHub Actions，PR 开到 `v3-next`。这个文件合进 `main` 以后才生效。

**交给 Codex**（和 R38–R45、R32 一起做）：

| 编号 | 位置 | 要做 |
|---|---|---|
| R46 | 应用 `src/**`，现在 19 处"你" | 改成"您"。写给 AI 模型的提示词不改：`utils/persona.ts` 的角色预设、`zh-CN.json` 的 `personaSystemPromptPlaceholder`。`ChatView.tsx:51` 用户消息的标签，改成"您"或者别的说法都行。spec 里对应的文字一起改。跑 `node scripts/copy-lint.js`，"称呼"一类里只能剩提示词那几处 |
| R47 | 官网，现在 68 处"你" | 同上，全部改成"您"。`copy-lint` 的"称呼"一类要清零 |
| R48 | 官网 `src/content/legal/licenses/zh.md`、`en.md` 的 MiSans 一节 | 补上小米 MiSans 字体许可协议的原文，从小米官方页面（<https://hyperos.mi.com/font/zh>）原样照抄，注明来源和版本或日期。英文页放原文（中文），前面用一句英文说明。这一节的锚点要是 `#misans`：打包附带的第三方声明里已经写了 `…/legal/licenses#misans`，请打开页面确认能跳到这里 |
| R49 | 应用 `src/components/settings/tabs/AboutTab.tsx` 的"合规"一节 | 在"开源许可"下面加一行"字体许可（MiSans）"，点击打开 `https://getssh.realmcloud.net/${languagePath}/legal/licenses#misans`，写法和上面那几行一样 |
| R50 | 官网 `src/content/sdk/zh.md`、`en.md` 的 6.1 节和第 8 节 | `safeStorageEncrypt` 改成"3.0 删除了"，照着应用仓库 `docs/PLUGIN_SDK_INTERNAL_CN.md` 和 `docs/PLUGIN_SDK_INTERNAL.md` 现在的写法；接口定义里那一行删掉 |

## 10-20 复查 R38–R50（应用 `706cc09`；官网 `19025cd`）和发布前最后一轮

**结果**：
- R38、R41、R42、R45、R46、R47、R48、R49、R50 做对了；
- 完整的 21 项检查都通过，整套测试 1056 个；
- 官网能构建，lint 通过，中英文许可页都有 `#misans`；
- MiSans 许可原文和小米官方 PDF 逐字对得上；
- "称呼"一类：应用只剩写给 AI 的 6 处提示词，官网 0 处。

**负责人希望这一轮改完就发布。** 下面每一条都写了具体做法。每条请补一个撤掉修复就会失败的 spec。

### 应用（只改 `src/**`）

| 编号 | 位置 | 问题 | 要做 |
|---|---|---|---|
| R51 | `ConnectForm.tsx` 的 `submit`（约 292–305 行） | **必须改。** R39 改出了三个问题：① 新建服务器时，选了私钥文件或库里的私钥，过了 400 毫秒再点"连接"，这台服务器不会被保存，重启就没了；用库里私钥的那种还会直接连不上，因为主进程按 id 找不到这台服务器。② 已保存的服务器，改完用户名、地址或私钥文件立刻连接，改动还在 400 毫秒的防抖里，`onUpdateSession` 只是发出保存，不等它完成，主进程按 id 读到的还是旧值。③ `keyId` 只在一边做了 `?? null`，这次运行里新建的服务器，以后每次连接都会先保存 | 改成下面这样，其余不动：<br>`const keyChanged = (readySession.keyId ?? null) !== (session.keyId ?? null);`<br>`const saveFirst = !readySession.isQuickConnect && (Boolean(session.isDraft) \|\| hasPendingUpdate \|\| keyChanged);`<br>`if (Object.keys(pendingClearsRef.current).length \|\| saveFirst) { 和现在一样 await savePending }`<br>`else if (readySession.isQuickConnect && hasPendingUpdate) onUpdateSession(identity.current.index, readySession);`<br>新建的、有未保存改动的、私钥选择改过的，都先保存，等保存完成再连接；什么都没改的已保存服务器直接连接，不保存。<br>spec：① 新建服务器，选私钥文件，过 400 毫秒点连接：`saveProfiles` 收到这条（`isDraft: false`），在它返回之前 `sshConnect` 不能被调用；② 同上，换成库里的私钥；③ 已保存的服务器，改用户名后 400 毫秒内点连接：同样要等保存完成；④ `keyId` 为 `undefined` 的已保存服务器，什么都没改直接连接：不调用 `saveProfiles`；⑤ 快速连接：不调用 `saveProfiles`。R33、R34、R35 的 spec 要照样通过 |
| R52 | `ConnectForm.tsx`（防抖）、`ConnectionPrivateKey.tsx:159` | 连接表单里刚输入口令、还在 400 毫秒防抖期间，"导入到 GETSSH"就能点。防抖到时会把导入前的旧列表存一遍，可能把服务器改回原文件 | `ConnectForm` 加一个状态 `autosavePending`：防抖开始时设为真，防抖执行、被 `submit`、`clearSecret`、`savePending` 取消时设为假。把它传给 `ConnectionPrivateKey`，和 `pendingSecretClear` 一样，为真时导入按钮不可用。spec：输入口令后立刻按钮不可用，400 毫秒后可用 |
| R53 | `SafeStorageTab.tsx:88` | R44 只在 `presenceEnabled` 变化时刷新，可 `presenceEnabled` 只表示主密码的 Touch ID。没有主密码时，工作区开了 Touch ID，这个值不变，设置页那一行还写"开启"。迁移提示最常见的就是这种情况 | 应用状态每次广播都刷新（`next.state !== previous.state`，并且 `phase` 还是 `ready`），**只调 `refresh()`，不要调 `invalidate()`**：`invalidate` 会清掉屏幕上的恢复码。spec：① 没有主密码，工作区有自己的密码，状态里它的 `presence` 从假变真、`presenceEnabled` 一直为假，那一行变成"关闭"；② 恢复码显示着的时候来一次广播，恢复码还在 |
| R54 | `MigrationPresenceNotice.tsx`；`App.tsx` 里的主网格（`zIndex: var(--z-app-chrome)`） | R43 只改了 z-index，可主网格自己是一个层级为 20 的层叠上下文，设置页、连接表单里的对话框（`SshKeysSection` 的 `z-[1000]`、`EncryptedBackupSection`、`ExportTab`、`ConnectForm.tsx:491`）都被限制在 20 以内，提示的 `z-40` 照样盖在它们上面 | 有模态对话框打开时隐藏提示：在 `document.body` 上用 `MutationObserver` 监听 `childList`、`subtree`，以及属性 `aria-modal`，看有没有 `[aria-modal="true"]`。同时检查所有全屏的对话框都带 `role="dialog" aria-modal="true"`。`rg 'fixed inset-0' src` 找出来的这些现在附近没有 `aria-modal`：`App.tsx:221`（高风险剧本）、`CommandCenter.tsx`、`ConnectForm.tsx:491`、`CreateWorkspaceModal.tsx`、`HostKeyVerificationModal.tsx`、`SecurityOverlay.tsx`、`UnlockVaultModal.tsx`；`SplitEngine.tsx:143` 先看是不是对话框。spec：页面里加一个 `aria-modal="true"` 的元素，提示消失；去掉以后提示回来，之前的状态不丢 |
| R55 | `MigrationPresenceNotice.tsx:47, 66-68` | 开了隐私模式时，系统弹出 Touch ID 或 Windows Hello 会让窗口失焦、触发模糊，进行中的"开启"请求被作废，失败的结果不会显示 | 隐私模糊时只隐藏，不作废：`hidden.current` 和 `invalidate()` 只看 `suppressed`；`privacyBlurred` 只影响渲染。spec：开始开启，进入模糊，请求返回失败，退出模糊后能看到错误提示 |

### 官网

| 编号 | 位置 | 要做 |
|---|---|---|
| R56 | 官网仓库 `docs/PLUGIN_SDK_3.0_ZH.md`、`docs/PLUGIN_SDK_3.0_EN.md`，`README.md:43`、`README_CN.md:43` | 这两份旧指南还把 `safeStorageEncrypt` 写成能用的接口，也没有 `context.secrets`，README 链到的就是它们。删掉这两个文件，README 的链接改到线上的 `/zh/sdk`、`/en/sdk`，这样只有一份 SDK 文档 |
| R57 | 官网 `zh.json:24`（`aiAnnouncement`）和 `announcements.spec.mjs:11` | 我写的 R32 那句不对："完整接管"模式不会逐条确认命令。改成：`GETSSH 3.0 预览版已支持通过客户端网关进行 AI 排障。代理模式下，AI 能否操作终端、执行命令前是否逐条确认，由您选择的模式决定。` spec 的正则一起改 |
| R58 | 官网 `package.json` | 加 `"test": "node --test src/dictionaries/*.spec.mjs src/content/**/*.spec.mjs"`，或者直接列出这 4 个文件。交付时附上 `npm test` 的原始输出 |
| R59 | 官网 `src/app/[lang]/(inner)/download/page.tsx`、更新日志 | 下载页现在全是 2.0 的文件。macOS 和 Windows 改成 3.0 预览版，Linux 还是 2.0：<br>- 版本号和标签按负责人定的写，暂定 `3.0.0-preview`，标签 `v3.0.0-preview`，见下面"发布"；<br>- 文件名和 2.0 的规则一样：`GETSSH-3.0.0-preview-arm64.dmg`、`GETSSH-3.0.0-preview.dmg`（Intel）、`GETSSH-Setup-3.0.0-preview-x64.exe`、`GETSSH-Setup-3.0.0-preview-arm64.exe`；<br>- 版本号和标签各只写一处，方便改；<br>- 安装包没有签名，页面上要写首次打开的办法：macOS 在应用上点右键选"打开"，Windows 在 SmartScreen 里点"更多信息"再点"仍要运行"；<br>- 更新日志的标题从"预计 2026-10-20 开放体验"改成实际日期 |

### 发布（Claude 和负责人）

- **版本号**：官网写的是 `3.0.0-preview`，应用现在是 `3.0.0-rc.1`。负责人定一个，Claude 改 `package.json`，标签用同一个。
- **顺序**：
  1. Codex 交付后，Claude 复查，跑完整检查，合进 `v3-next`，跑 CI；
  2. 负责人同意后，Claude 改版本号，合进 `main`；
  3. 负责人打标签，发布流程在 4 个平台上打包，生成一个草稿版本；
  4. 负责人检查草稿，下载页上的 4 个文件名都要在里面，然后发布。要不要标成 pre-release 由负责人定：标了以后，GitHub 的"最新版本"仍是 2.0；
  5. 官网合进 `main` 上线，要和发布同时，最晚紧跟着发布。应用"关于"页和第三方声明都链到官网的 `#misans`，下载页也要指向新文件。

## 10-21 发布前（Claude）

**R51–R59 复查**：做对了，完整检查和官网的测试、lint、构建都通过。

**发布当天 Claude 直接改了官网分支**（`codex/ui-store-copy`），Codex 合并时请留意：
- `a3c3ee2`：下载页"第一次打开"的说明。macOS 15 起，右键选"打开"已经不能放行没公证的应用，要去"系统设置 → 隐私与安全性"点"仍要打开"。之前那句是照我的 R59 写的，错在我。
- `7d484a7`：首页主按钮从"下载 v2.0.0"改成"下载 3.0 预览版"，3.0 的几节去掉"即将上线"，路线图改成已提供，SDK 页的标记改用 `common.previewBadge`，JSON-LD 的 `softwareVersion` 改成 `3.0.0-preview`。另加了一个 spec 守住这些说法。

**发布配置**（Claude）：
- 每台机器只打自己那种架构；
- macOS 应用改为临时签名（ad-hoc）；
- `check-package` 检查每个原生文件的架构；
- 4 个平台都跑打包后启动检查；
- Intel 版补上了 Swift 运行库的 rpath；
- 发布流程手动运行时只打包检查，打标签才生成草稿版本。

详见 `release.yml` 和 10-20、10-21 的提交。

**MiniMax 和通义千问 Qwen 接进界面**（Claude，负责人要求这次就带上）：
- 设置里可以选这两家，各有默认模型；两家都显示"服务地址"，切换服务商时清空地址；
- 两个适配器各加了一份按官方文档写的测试（`MiniMaxAdapter.test.ts`、`QwenAdapter.test.ts`），查出的问题已经修掉：
  - MiniMax：M3.1-Flash 不能关思考；无参数的工具调用；输入 token 从 `message_start` 读；流里的请求错误不再重试；文档写"请稍后重试"的 1039、2064、2066 会重试；200 但返回 JSON 错误时报出真正的原因；模型列表加上 M3.1-Flash，去掉已下线的 M2.1、M2；
  - Qwen：能输入图片的模型和带图片的请求走 multimodal-generation 接口，其余走 text-generation 并且纯文本发字符串（规则见下）；Qwen3.8 按所选强度发 `reasoning_effort`，思考预算上限 262144；思考模式下不强制指定工具；流里错误按 `:HTTP_STATUS` 行的状态码判断能否重试；SSE 格式的 HTTP 错误能读出错误码；统计思考 token。
- 复查后又修了：
  - Qwen 接口：文档写明"输入模态包含图片或视频的模型使用多模态接口，即使只传入文本也需要使用多模态接口"，走错接口每轮返回 400。按各型号详情页的输入模态：Qwen3.5 起的型号（含 qwen3.8-flash、qwen3.8-27b、qwen3.7-flash）都走多模态，只有 qwen3.7-max（含 -preview、-2026-05-17、-2026-05-20）和 qwen3.8-2.4t-a95b 是纯文本；VL、QVQ、audio 系列也走多模态。模型总览页把 qwen3.8-flash 只列在"文本生成"下，但它的详情页写的是 Image/Text/Video；
  - Qwen 的输出上限：文档只给 Qwen3.7-Max、Qwen3.5-Plus、Qwen3.5-Flash 及以后的型号，以及 kimi-k2.5、glm-5、MiniMax-M2.5、deepseek-v4 及以后的第三方型号写了 `max_completion_tokens`（不含带厂商前缀的"三方直供"型号），其余用 `max_tokens`；都不超过已知的最大输出；
  - MiniMax M3.1-Flash 按所选强度发 `output_config.effort` / `reasoning_effort`（原来一律按最深的 max 跑）；缓存命中的 token 从 `message_start` 读；
  - **所有服务商**：只读问答和感知助手两种模式会把"上下文上限"（默认 200K，最大 2M）当成输出上限发给模型，超过多数模型的最大输出。现在不再发，和两种执行模式一样由适配器自己决定；没选模型时由适配器用自己的默认模型，不再发 gpt-3.5-turbo；
  - 服务地址在离开输入框或按回车时才保存，原来每按一个键保存一次，模型列表会带着保存的 API 密钥去请求打到一半的地址；地址不是完整网址时不拉模型列表；
  - 没选模型时，聊天发出的模型和界面上显示的默认模型一致（`defaultModelFor`）。
- 没修、留在测试里标 `it.fails` 的：MiniMax 不认识的模型仍会带 `thinking` 字段；没有签名的思考块在下一轮不回放。
- 两家都没用真实密钥测过。负责人可以在开发版里填自己的密钥试一次。

**发布以后再做**：
- R51 还剩一个几毫秒的窗口：防抖刚触发、自动保存还在路上时点"连接"，主进程可能读到旧值。修法：`onUpdateSession` 返回保存的 Promise，`submit` 等它完成。
- ~~Windows 后台的自动更新检查用的是 electron-updater，发布里没有 `latest.yml`，所以不会提示新版本；"设置 → 关于"里的手动检查没问题。以后改成和 macOS 一样查 GitHub 的发布列表。~~ 已改（Claude，10-21）：两个平台的后台检查和手动检查都走 `services/updateCheck.ts`，启动时查一次，之后每 12 小时一次；去掉了 electron-updater。手动检查失败时显示原因，原来会说"已经是最新版本"。
