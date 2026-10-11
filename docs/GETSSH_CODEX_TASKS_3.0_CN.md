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
