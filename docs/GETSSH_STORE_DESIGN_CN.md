---
name: getssh-store
description: GETSSH 3.0 加密与数据层（getssh-store）的设计、冻结接口和协作规则。修改 GETSSH 的数据库、凭据、主密码、Touch ID/Windows Hello、导出导入、DatabaseManager、keystore 或相关界面之前必须先读。
---

# GETSSH 3.0 加密与数据层设计（getssh-store）

> 状态：**接口已冻结（2026-10-01）**，唯一的接口定义是 `rust-core/getssh-store/store.d.ts`
> 分支：`feat/master-key-store`，集成分支 `v3-next`（GitHub 上有这两个分支的旧版本；之后不再推送，除非负责人决定）
> 读者：Claude、ChatGPT（Codex）、Gemini，以及项目负责人。分工见 [GETSSH_TEAM_CN.md](GETSSH_TEAM_CN.md)
> 本文件路径：`/Volumes/Developer/GETSSH/docs/GETSSH_STORE_DESIGN_CN.md`

## 0. 已经拍板的决定

1. **主密码就是一切。**
   - 设了主密码：整个 GETSSH 的数据只靠主密码保护，不需要电脑的加密模块参与。
   - 数据加上主密码，在任何一台电脑上都能完整恢复。
2. **跳过主密码时**，才用 TPM / Secure Enclave / 钥匙串保管钥匙，防止别的程序直接读文件。
   - 这时数据绑定在这台电脑上。
   - MAIN 工作区不能单独设密码，其他工作区可以各自设密码。
3. **Touch ID / Windows Hello 只是可选的快捷方式。**
   - 它在本机安全芯片里多存一份钥匙，免得每次都输主密码。
   - 开不开都不影响数据能否带走。
4. **主密码至少 12 个字符**（已在本分支实现，提交 6392556）。工作区密码仍然至少 8 个字符。
5. **服务器密码、私钥、口令都存进加密数据库。** 私钥文件导入库里以后，原文件可以删掉。
6. **一次导出必须带走全部内容。** 导出包在另一台电脑上只凭密码就能整份恢复。
7. **整个数据库层搬进 Rust。**
   - 数据库钥匙不再进入 JS。
   - 渲染进程永远拿不到任何秘密。
   - SSH 暂时还用 JS 的 `ssh2`：连接那一刻，主进程把凭据交给它。改用 Rust 的 russh 放到 3.0 之后。
8. **导出时由用户自己选工作区**。
   - 先列出全部工作区让用户勾选；
   - 选完后一键解锁选中的、还锁着的工作区，优先用 Touch ID / Windows Hello，一次验证解开全部；
   - 没开 Touch ID / Hello 的工作区，再逐个输入密码。
9. **3.0 之前设的 8–11 位主密码必须强制更换**：
   - 解锁后弹出不可跳过的"更换主密码"对话框；
   - 换完之前不能导出。
10. **导入在 3.0 只做"整体替换"**（替换前自动备份），"合并"放到以后。
11. **分工**（10-02 调整）：Rust 模块和主进程接入都由 Claude 负责，存储相关的界面由 ChatGPT（Codex）负责，Gemini 负责测试（见第 8 节）。

## 1. 现状（5a8c533）

- `rust-core/getssh-keystore` 负责以下内容，都存在 `~/.getssh/keyring.json` 里：
  - 钥匙层级：app 作用域，加上每个工作区一个作用域；
  - 解锁途径：设备、Touch ID/Hello、密码、上级钥匙、恢复码；
  - 钥匙版本轮换。
- 数据库仍由 TS 的 `DatabaseManager.ts`（1171 行，约 80 条 SQL）通过 `better-sqlite3-multiple-ciphers` 访问。
  - JS 会从 keystore 拿到 32 字节原始钥匙交给 SQLCipher，用完清零。
  - 另有约 20 条 SQL 直接写在 `systemHandler.ts`、`workspaceHandler.ts` 里。
- 表的分布：
  - 主库 `main.db`：`workspaces`、`global_settings`、`ai_memory_vectors`。
  - 工作区库 `workspace_<id>.db`：`profiles`、`asset_folders`、`runbooks`、`ai_sessions`、`ai_messages`、`audit_logs`。
- 凭据（`profiles.password` / `passphrase`）在库里是明文列，靠 SQLCipher 整库加密保护。
  - 私钥只存了路径 `privateKeyPath`，连接时由 `sshHandler.ts:430` 从磁盘读取。
- 库外还有几类秘密：
  - AI 服务商的 API Key：`userData/ai_vault_<provider>.enc`，Electron safeStorage；
  - 插件秘密：`PluginManager.ts` 用 safeStorage；
  - `mcp_servers.json` 里可能有 token。
- 导出功能 `export-database-all` 只打包 `*.db`，导入功能 `import-database` 打开外部库时不带钥匙。所以现在的导出包恢复不了。

## 2. 钥匙模型

### 2.1 层级

```
根钥匙 R（app 作用域当前版本的钥匙，随机 32 字节）
 ├─ main.db 的 SQLCipher 钥匙 = HKDF(R, "getssh-keystore/v1|db|app|<label>")
 ├─ app 字段钥匙：随机生成，用 R 封存在版本记录里，换版本时沿用
 └─ 每个工作区的钥匙 W_i（随机 32 字节）
      ├─ workspace_<id>.db 的 SQLCipher 钥匙 = HKDF(W_i, "getssh-keystore/v1|db|ws:<id>|<label>")
      └─ 凭据字段钥匙：随机生成，用 W_i 封存，换版本时沿用
```

这就是 keystore 现有的作用域加版本结构（`database_key` 和 `seal_field`），格式不变。

### 2.2 R 和 W_i 由什么解开

| 状态 | R 的解锁途径 | W_i 的解锁途径 | 能否带走 |
|---|---|---|---|
| 设了主密码 | Argon2id(主密码)；可选 Touch ID/Hello；可选恢复码 | 由 R 包起来（输一次主密码，全部打开） | 能：数据 + 主密码 |
| 没设主密码 | 本机设备钥匙（TPM / Secure Enclave / 钥匙串） | 设备钥匙；或者工作区自己的密码（Argon2id） | 只有设了密码的工作区能；整体要靠导出密码 |

规则：
- 只要设了主密码，**任何一份数据都不允许只能靠设备钥匙解开**，现有策略引擎已经保证这一点。
- 设主密码、去主密码都会轮换钥匙版本（现有实现），把旧的 `keyring.json` 写回来也不能降级。
- 恢复码：没有主密码时，它不覆盖设了独立密码的工作区（现有规则）。
- 密码派生只用 Argon2id（64 MiB，t=3，p=1）。**禁止用 SHA 系列直接处理密码。**

### 2.3 不做"主密码 + TPM 都要才能解开"

两样都要的话，数据就永远绑在这台电脑上：换电脑、主板坏了都找不回来，导出也带不走。TPM 只能作为"二选一"的快捷通道。

## 3. getssh-store 的结构

### 3.1 模块

- 新建 `rust-core/getssh-store`（N-API cdylib），把 `getssh-keystore` 作为 rlib 引入。
- **JS 只加载 `getssh-store` 这一个原生模块**，钥匙在 Rust 内部传递，不会跨模块经过 JS。
- `getssh-keystore` 去掉 N-API 导出，只保留库形式。
- 在 `scripts/build-native.js` 和 `package.json` 的 `extraResources` 里，用 `getssh-store` 替换 `getssh-keystore`。

### 3.2 SQLite 引擎（先做验证，半天）

现有库文件是 SQLite3 Multiple Ciphers 的 `sqlcipher` 方案（SQLCipher v4 格式，原始钥匙 `x'…'`）。两种候选：

| 方案 | 优点 | 风险 |
|---|---|---|
| A. 用 `cc` 编译 SQLite3MultipleCiphers 源码，自己写一层薄薄的 FFI 封装 | 和写这些库的引擎完全相同，格式零风险；不依赖 OpenSSL；MIT 许可 | 封装要自己写（约 400 行） |
| B. rusqlite 的 `bundled-sqlcipher` | 现成的 API | Windows 要自带编译 OpenSSL（需要 Perl）；和 `getssh-kv` 的 `libsqlite3-sys` 特性会在工作区内合并，要确认不会互相影响 |

**选 A。** 验证要通过三项：
1. 打开一份由 bsmc 12 写出的**测试库副本**，跑 `integrity_check`，行数一致；
2. macOS arm64/x64、Windows x64/arm64 四个 CI 目标都能编译；
3. 打开一个库的耗时不超过 1 ms。

**验证结果（2026-10-01，macOS arm64）**：用 `cc` 编译 bsmc 12.11.1 自带的 SQLite3MC 2.3.5 源码（SQLite 3.53.2），编译选项和 bsmc 的 `deps/defines.gypi` 完全一致，配一层约 100 行的 FFI。

| 测试库（由 bsmc 12 写出） | 结果 |
|---|---|
| 原始钥匙 `x'…'`，WAL 模式，2000 行 | 打开 0.5 ms，`integrity_check` ok，2000 行 |
| 同上，WAL 里还有没写回主文件的修改（模拟崩溃） | 打开 0.1 ms，修改可见 |
| 旧式口令钥匙（含非 ASCII 字符） | 打开 81 ms（PBKDF2 256000 次），ok |
| 钥匙错一位 / 口令错误 | 报 `file is not a database`，不会读出乱码 |

- 第 1、3 项通过。
- 第 2 项要等 `getssh-store` 进 CI 才能验证。bsmc 在 Windows 上本来就用 MSVC 编译同一份源码，风险低。
- 源码直接放进仓库，放在 `rust-core/getssh-store/vendor/sqlite3mc/`，约 13 MB，MIT 许可。版本跟随 bsmc 当前用的版本，以后单独升级。

### 3.3 运行方式

- 每个库一个连接，用 `Mutex` 保护，始终用 WAL 模式。
- **增删改查用同步 N-API**：和现在 better-sqlite3 的同步语义一致，TS 调用方改动最小。
- **Argon2、换钥匙、导出、导入用异步任务**（AsyncTask），不阻塞主线程。
- 错误格式沿用 keystore 的 `[store:<code>] 说明`，code 取值：
  `locked`、`needs_password`、`wrong_password`、`rate_limited`、`not_found`、`invalid_argument`、`corrupt`、`unavailable`、`io`、`busy`、`rotation_pending`。
- 不开放任意 SQL。每个操作都是有类型的函数，参数绑定都在 Rust 里完成。

## 4. 接口（已冻结）

**唯一的定义是 [`rust-core/getssh-store/store.d.ts`](../rust-core/getssh-store/store.d.ts)，以那个文件为准。** 本节只说明约定。

- **分组**：
  - 生命周期与应用锁；
  - 主密码、Touch ID/Hello、恢复码；
  - 工作区；
  - 服务器配置；
  - 秘密：只给主进程；
  - SSH 私钥；
  - 其余各表；
  - 导出与导入。
- **数据行字段名和现有 SQLite 列一致**，`DatabaseManager` 的方法可以一对一转发。
- **服务器配置**：
  - 读取接口不返回秘密，只返回 `hasPassword` / `hasPassphrase` / `keyId`；
  - 保存时秘密字段的约定：`undefined` 保持原值，`null` 清除，字符串表示设新值。
- **秘密**：标了 MAIN PROCESS ONLY 的函数（`connectSecrets`、`revealSecret`、`getAppSecret`），返回值绝不能经 IPC 发给渲染进程。
- **错误**：错误信息以 `[store:<code>] ` 开头，code 的取值见 `StoreErrorCode`。
- **同步与异步**：普通读写是同步的；Argon2、换钥匙、Touch ID/Hello、导出导入返回 Promise。
- **假实现** `rust-core/getssh-store/store.fake.js`：
  - 接口和真模块完全一样，数据只存在内存里；
  - 在 Rust 模块完成前，界面和测试用它开发；
  - 用法、测试开关 `__fake`，以及 `store.d.ts` 没写清楚时它的取舍，都在文件头部注释里；
  - `store.fake.test.mjs` 固定它的行为；
  - `store.conformance.mjs` 用同一套步骤分别跑真模块和假实现，比较错误码和返回值结构。每当一批函数从假实现搬到 Rust，就扩充这个脚本并跑一遍，要求零差异。
- **导入后必须重启**：`importBundle` 成功后，模块拒绝一切调用（`unavailable`），主进程要 `app.relaunch(); app.exit()`。
- **`configure(baseDir, appVersion?)`**：第二个参数是冻结后加的可选参数，传 `app.getVersion()`，写进导出包。
- **改接口**：必须先改本文档和 `store.d.ts`，由 Claude 提交，并通知负责人和 Codex。

## 5. 加密导出包

### 5.1 导出

- **必须设导出密码**，至少 12 个字符；设了主密码时，默认就用主密码。不提供明文导出。
- 导出流程：
  1. 界面用 `exportCandidates()` 列出全部工作区，用户勾选要导出的；
  2. 选中的工作区里还锁着的，先调用 `unlockWorkspaces(ids, reason)`，一次 Touch ID / Hello 全部解开；
  3. 返回 `failed` 的工作区再逐个输入密码；
  4. 最后调用 `exportBundle(path, password, workspaceIds)`。
- 设了主密码时，所有工作区随应用一起解锁，不需要第 2、3 步。
- 主密码还没强制更换完之前（`masterPasswordMustChange`），拒绝导出。
- 打包内容（白名单）：
  - 选中工作区的 `workspace_<id>.db`，导出前先执行 `wal_checkpoint(TRUNCATE)`，不带 `-wal` / `-shm`；
  - `main.db` 里与选中工作区相关的部分：`workspaces` 行、`ai_memory_vectors`、`global_settings`、应用级秘密；
  - `app-config.json`；
  - `mcp_servers.json`，其中的秘密改为存进 `setAppSecret`；
  - 版本号和工作区列表。
- `keyring.json` 不原样放进去：它里面的设备钥匙、Touch ID 钥匙在别的电脑上没用。

### 5.2 文件格式 `.getssh-backup`

```
magic "GETSSHBK" | 格式版本 u16
明文头部（JSON）：创建时间、应用版本、Argon2 参数和盐、payload 分块大小
密钥区：AES-256-GCM(KEK = Argon2id(导出密码, 盐), AAD = 明文头部)
        内容：每个作用域的钥匙 R / W_i、策略标记（是否有独立密码），以及该作用域原有的密码包装（
        导入后工作区密码照样有效），再加一把随机的 payload 钥匙
payload：分块 AES-256-GCM（每块 64 KiB，nonce = 前缀‖序号‖是否最后一块），里面依次是各个文件
```

库文件本身已经是 SQLCipher 加密的，外面再套一层是为了防篡改，同时隐藏文件结构和大小。

**导出密码能打开包里的全部内容，包括设了独立密码的工作区。** 界面上要明确告诉用户这一点。

### 5.3 导入

1. 校验头部，用导出密码解开密钥区。`inspectBundle` 也要先输入密码，因为工作区名字在加密区里。
2. 解到临时目录，用 Rust 打开每个库跑 `integrity_check`。
3. 3.0 只支持 `replace`：先自动把当前的 `~/.getssh` 备份到旁边一个带时间戳的目录，然后整体替换。`merge` 放到以后。
4. 钥匙交给本机 keystore 重新保管：
   - 有主密码的包，导入后仍然要主密码；
   - 没有主密码的包，按本机设备钥匙保管。

现有的 `import-database` 直接 `ATTACH` 外部库，这条路要删掉。

## 6. 凭据怎么存

- `profiles.password` / `profiles.passphrase` 改成封装字段：`gk1:` 前缀 + AES-256-GCM（字段钥匙）。
  - AAD 绑定 `工作区|profileId|字段名`，所以把密文复制到别的行、别的字段都解不开。
- 私钥存进新表 `ssh_keys`（工作区库）：
  - 私钥本体是封装字段；
  - 公钥、指纹、算法是明文列；
  - `profiles.keyId` 引用它。
  - 现有 `privateKeyPath` 作为过渡保留：连接时如果找到文件，就提示"导入到 GETSSH 并删除原文件"。
- 一次性迁移：第一次以新版本打开工作区时，把明文列封装起来。旧值清空后执行 `VACUUM`，不在空闲页里留下明文。
- 连接改为"按 profile id 连接"：
  - `sshHandler` 调 `connectSecrets()`，拿到 Buffer 交给 `ssh2`，握手后清零；
  - 渲染进程只传 id；
  - 快速连接里临时输入的密码不受影响，仍可以直接传。
- 查看密码：先用 Touch ID/Hello（没有时用密码）打开 5 分钟滑动窗口；复制到剪贴板的内容 30 秒后清空。
- 查看和复制都由主进程做：密码显示在系统对话框里，只有对话框的"复制"按钮能复制（10-02 实现，见第 11 节）。
  - 剩余风险：用户点了复制以后的 30 秒内，界面和带 `host:clipboard` 权限的后端插件仍然能读到剪贴板；
  - S4 时把终端粘贴改成走主进程，并拒绝读回刚复制过的密码。

## 7. 迁移步骤

**磁盘上的数据不需要重写：** Rust 用同样的钥匙、同样的 SQLCipher 格式打开现有文件。改的是代码，不是数据。

| 步骤 | 内容 | 完成标准 |
|---|---|---|
| S0 | SQLite 引擎验证（3.2 节） | 三项都通过 |
| S1 | 建 `getssh-store`，keystore 改成 rlib，N-API 统一从 store 导出 | keystore-e2e 14 个阶段全部通过 |
| S2 | 实现第 4 节的工作区、服务器配置、全局设置；TS 的 `DatabaseManager` 改成薄包装，方法签名不变 | `tsc`、e2e、`test:local-memory` 通过 |
| S3 | 剩下的表（素材夹、剧本、AI 会话和消息、记忆向量、审计），删掉 `getDb()` / `getWorkspaceDb()` 和所有手写 SQL | `git grep "\.prepare("` 在 `electron/` 下没有结果 |
| S4 | 凭据封装、按 id 连接、查看窗口；AI Key、插件秘密、MCP token 迁进来 | 渲染进程的 IPC 返回值里没有秘密，有专门测试 |
| S5 | 导出包和导入，以及界面 | e2e 新增阶段：导出，换一个 HOME 导入，数据逐项一致 |
| S6 | 删掉 `databaseKey` 导出、bsmc 依赖和旧的导入导出代码；整理打包配置 | 安装包里不再有 `better_sqlite3.node`，启动自检通过 |
| B | 私钥导入和生成、恢复码引导、重新开启迁移来的 Touch ID | 按产能决定是否进 3.0 |

旧的 2.x 数据（`app_key` / `vault.key`）迁移继续由 keystore 迁移代码处理。到 S6 时改由 Rust 用 SQLCipher 直接打开旧库，彻底去掉 bsmc。

## 8. 协作规则（10-02 调整）

全项目的分工、worktree 和禁止事项见 [GETSSH_TEAM_CN.md](GETSSH_TEAM_CN.md)。原计划由 Gemini 做的主进程接入，改由 Claude 负责。存储层的安排如下：

| 负责方 | 范围 |
|---|---|
| Claude | `rust-core/getssh-store/**`、`rust-core/getssh-keystore/**`；主进程接入：`DatabaseManager` 薄包装、各个 handler、按 id 连接、AI Key / 插件秘密 / MCP token 迁到 `setAppSecret`；preload 和 IPC 接口；数据迁移、导出包；集成和合并 |
| ChatGPT（Codex） | 界面：配置编辑器（不碰秘密）、查看密码窗口、导出界面（勾选列表 + 一键解锁）、导入界面、强制更换主密码的对话框、私钥管理界面 |
| Gemini | 测试：按第 7 节各步骤的完成标准写测试、跑测试、报问题 |

1. **接口已冻结**：唯一的定义是 `store.d.ts`，配有纯 JS 的假实现 `store.fake.js`。接口要改，先改本文档和 `store.d.ts`，由 Claude 提交，再通知负责人和 Codex。
2. **分支**：Claude 在 `/Volumes/Developer/GETSSH-store` 的 `feat/master-key-store` 上开发，再合进 `v3-next`。Codex 的界面分支从 `v3-next` 拉出（见第 11 节）。不推送 GitHub，不开 PR，不手动触发 CI。
3. **合进 `v3-next` 之前必须通过**：
   - `tsc -b`；
   - `cargo test -p getssh-store -p getssh-keystore`；
   - `npm run test:keystore-e2e`；
   - `GETSSH_STORE_CONFORMANCE=1 node rust-core/getssh-store/store.conformance.mjs`，零差异；
   - 改到的那部分对应的测试脚本。
4. **会改动磁盘数据的步骤**（主进程接入、S3、S4、S6）合进 `v3-next` 之前，先告诉负责人，等负责人备份完。负责人每天用 v3 开发版处理真实数据。
5. **禁止的操作**：
   - 碰真实的 `~/.getssh` 和系统钥匙串里已有的条目（测试一律用临时 HOME）；
   - 把篡改过的钥匙材料喂给 Secure Enclave 或 TPM；
   - 提交不属于自己的文件或别人还没提交的改动。

## 9. 时间线（3.0 定于 10 月 20 日）

| 日期 | 里程碑 |
|---|---|
| 10-02 | 本文档确认，接口冻结（S0 已于 10-01 在 macOS 上完成） |
| 10-06 | S1、S2 完成；配置编辑器接上新接口 |
| 10-09 | S3、S4 完成 |
| 10-12 | S5 完成，导出导入跑通 |
| 10-13 ~ 10-19 | 两个平台的 CI、打包、真机测试（Touch ID、Windows Hello、迁移你的真实数据备份）、修 bug；依赖升级阶段 0 和 Electron 的决定也在这段时间落地 |

10-02 进度：S1、S2 的 Rust 部分、S5 已完成，并已合进本地 `v3-next`。真模块和假实现的对照检查零差异。主进程还没接入，仍在加载 `getssh-keystore`。下一步是 S3 和主进程接入，都由 Claude 负责。

阶段 B 视进度决定是否进入 3.0。

## 10. 已解决的问题（2026-10-01）

1. 导入只做 `replace`，`merge` 以后再做。
2. 导出时由用户勾选工作区，选完后用 Touch ID / Hello 一键解锁（第 0 节第 8 条）。
3. 8–11 位的旧主密码强制更换（第 0 节第 9 条）。
4. 分工见第 8 节（10-02 调整：主进程接入改由 Claude 负责）。

## 11. 做存储界面时怎么开工（Codex）

1. **先读**：本文档第 0、4、5、6 节，以及 `rust-core/getssh-store/store.d.ts`。
2. **在自己的 worktree 里开分支**，不要在 `/Volumes/Developer/GETSSH` 里直接改。`GETSSH-codex` 已经存在时，在里面运行：

   ```bash
   git switch -c feat/ui-store v3-next
   ```

   还没有时，按 [GETSSH_TEAM_CN.md](GETSSH_TEAM_CN.md) 第 2 节新建，分支名用 `feat/ui-store`。
3. **渲染进程永远不直接加载 store**，真模块和假实现都一样。界面只通过 preload 暴露的 IPC 调用。
   - **接口**：`window.electronAPI.store`，类型在 `apps/getssh-client/src/types/store.ts`，每个函数的说明在 `src/types.d.ts`。分四组：
     - `profiles`：服务器配置的列表、保存、删除。返回值里没有密码，只有 `hasPassword` / `hasPassphrase` / `keyId`；保存时秘密字段不传表示保留，传 `null` 表示清除，传字符串表示改成新值；
     - `reveal`：查看已保存的密码。先 `open`（Touch ID / Hello 或工作区密码），再 `show`。**密码不会回到界面**：`show` 由主进程弹系统对话框显示，对话框上的"复制"按钮是复制密码的唯一途径，30 秒后清空剪贴板（退出应用时也会清）。对话框的文字固定在主进程里，界面只能用 `language` 选中文或英文。应用锁定时对话框会自动关闭；
       - 为什么不让界面直接复制：插件代码跑在主窗口里，界面能读剪贴板。如果界面能让主进程复制任意一条密码，就能在用户毫无察觉的情况下把所有密码逐条读走；
     - `sshKeys`：列出、从文件导入（主进程弹选择文件的对话框）、生成 ed25519、删除；
     - `backup`：导出候选列表、一次 Touch ID / Hello 解锁、导出（主进程弹保存对话框）、选择导入文件、检查密码、导入、导入后重启。
   - 已有的通道继续用，不另起新的：工作区密码解锁用 `workspace.unlock`，改主密码用 `security.setMasterPassword`，强制更换主密码看 `appLock.getState()` 里新加的 `masterPasswordMustChange`。
   - 返回值统一是 `{ ok: true, ... }` 或 `{ ok: false, error }`，`error` 的取值写在 `StoreResult` 的注释里。
   - **开发时**用临时 HOME 和假实现启动：`HOME=$(mktemp -d) GETSSH_FAKE_STORE=1 pnpm run dev`。用 `GETSSH_FAKE_STORE_SEED` 等变量准备初始数据，用法写在 `store.fake.js` 的文件头部注释里。
   - **10-02 的限制**：主进程还没接入 store，所以假实现模式下只有 `store` 这组通道走假实现，侧栏、应用锁、`workspace.unlock`、`security.*` 仍然走旧的钥匙库和数据库。因此：
     - 导出时给带密码的工作区输入密码、强制更换主密码这两条流程，暂时没法对着假实现走通；`masterPasswordMustChange` 现在总是 `false`；
     - 准备初始数据时不要设 `masterPassword`：没有地方替假实现解锁，`store` 的所有通道都会返回 `locked`；
     - 要和侧栏显示的工作区对上，初始数据里的工作区 id 用 `default`（旧代码默认选中它）。
     Claude 下一步就是让整个应用在假实现模式下都走 store，做完后这些限制都会去掉。
   - 不开假实现时，`store` 这组通道一律返回 `unavailable`：真模块要等主进程接入以后才加载（和旧的钥匙库、数据库同时打开同一批文件会损坏数据）。界面要能处理 `unavailable`，导入完成、重启之前也会返回它。
   - 假实现不会被打包（`extraResources` 只收 `*.node`、`index.js`、`package.json`）。
   - 截至 10-02，`store.d.ts` 共 67 个函数，真模块已实现 38 个：生命周期、主密码、Touch ID / Hello、恢复码、工作区、服务器配置、查看窗口、全局设置、导出导入。其余 29 个暂时只有假实现：
     - S3：资产文件夹（5 个）、Runbook（2 个）、AI 会话与记忆（12 个）、审计（2 个）、`copyProfiles`；
     - S4：应用秘密（3 个）；
     - S4 和阶段 B：SSH 私钥（4 个）。
4. **需要新的 IPC 或者接口改动**：写下来交给负责人或 Claude，不要自己改 `electron/main/**`、`electron/preload/**`。
5. **拿到最新进度**：`git merge v3-next`。
6. **完成一块就在自己的分支上提交**，然后把分支名告诉负责人。
7. **测试一律用临时 HOME**：`HOME` / `USERPROFILE` 指向临时目录，绝不读写真实的 `~/.getssh`，也不动系统钥匙串里已有的条目。
8. **以下文件不属于任何一方，不要提交**：仓库根目录的 `GETSSH_v3.0_*.md`、`apps/getssh-client/scripts/security/` 下的 `*chaos*` 和 `*stress*` 脚本、`docs/dependency-licenses.md`、`docs/dependency-update-report.md`。
