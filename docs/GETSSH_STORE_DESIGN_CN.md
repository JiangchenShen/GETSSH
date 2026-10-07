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
- **冻结后的改动**（都只增不减，原来的调用照常可用）：
  - 10-01：`configure(baseDir, appVersion?)` 加了第二个参数；
  - 10-03：`start(legacy?: LegacySecrets)` 加了可选参数，新增 `needsLegacyMigration()`，用于迁移 3.0 开发版的旧数据（第 7 节）。只有主进程调用，界面不受影响。

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

**两种旧数据，不要混淆**（10-03 查清）：

| 来源 | 位置和格式 | 处理 |
|---|---|---|
| 3.0 开发版（从未发布） | `~/.getssh` 下的 `app_key.enc` / `app_key.txt`、用口令加密的 `main.db`、`getssh.db`、`workspaces/<id>/vault.key`、`workspaces/<id>/*.json` | S6 起由 Rust 迁移（`start(legacy)`，见下）。代码和注释里以前叫它"2.x"，是错的 |
| 2.0 正式版 | Electron 的 userData（macOS 是 `~/Library/Application Support/getssh`）下的 `profiles.enc`（getssh-vault 加密）、`profiles.json`（明文）、`profiles.key`（主密码，safeStorage） | 第一次启动时自动导入到主工作区，原文件不动（`services/legacyV2Profiles.ts`） |

- **开发版数据的迁移（S6）**：`app_key.enc` 和 `vault.key` 是 safeStorage 加密的，只有 Electron 能解开。主进程先用 `needsLegacyMigration()` 判断，需要时把解开的钥匙传给 `start(legacy)`，其余步骤都在 Rust 里做：备份、拆分 `getssh.db`、导入 JSON、换钥匙、失败时还原。备份目录名和 TS 版一样，TS 版迁移到一半的数据可以由 Rust 接着做完。
- **2.0 的导入**：macOS 上 2.0 一直用 Chromium 的 mock keychain，`profiles.key` 用一把公开的固定钥匙加密，不访问钥匙串就能解开；Windows 上是 DPAPI，也不弹窗。所以多数用户不用输入任何密码。`profiles.key` 不在时，要用户输入一次 2.0 的主密码（界面待做）。按 (协议, 主机, 端口, 用户名) 跳过已有的配置，只导入一次。
  - 2.0 的服务器大多没存端口，连接时用 2.0 设置里的"默认端口"（`appConfig.defaultPort`，在窗口的 localStorage 里，主进程读不到）。自动导入先填 22，并按导入时所在的工作区记下这些服务器；窗口启动后把自己的默认端口传给 `legacy-v2:apply-default-port`，只改仍是 22 的那几条，只改一次。之后主工作区换了也照样改在原来的工作区；那个工作区锁着时什么都不改，下次再试。
  - 服务器的 id 用它自己的端口算，没有端口时用 `default`，和传进来的默认端口无关。所以先自动导入、后来又带着默认端口手动导入时，已经导入过的服务器会被认出来跳过，不会重复。
- **10-06 / 10-07 审查后改的地方**（五轮审查。第一、三、五轮由另外的 agent 逐条核实；第二、四轮核实的 agent 没跑完，由 Claude 写测试复现后修复）：
  - `main.db` 旁边还有一个没拆分的 `getssh.db` 时，迁移把它和能打开它的 `app_key.*` 一起移到 `~/.getssh/.pre-keystore-kept/`。原来它们留在原处，每次启动都会重新迁移一遍；设了主密码后，每次启动都失败。
  - 设了主密码后，启动时如果还发现迁移剩下的文件，不再迁移，也不再报错，而是把它们移到 `.pre-keystore-kept/`。主密码只能在应用启动成功后设置，所以这时迁移一定已经做完；这时如果还留着备份，那是旧的，恢复它会把新数据盖掉。
  - 备份第一次做完时写一个完成标记，之后不再往里加文件。迁移失败要还原时，失败那次新建的数据库会被删掉，文件回到迁移前的样子。没有完成标记的备份（TS 版做的，或者 Rust 版做到一半）要先补全：缺的文件补进去；备份里已有的，只要原文件还能用旧钥匙打开（说明还没被迁移动过），就重新复制一份。TS 版是直接覆盖复制的，中途崩溃会留下不完整的副本。
  - 还原时先写临时文件再改名，崩溃不会留下只写了一半的数据库。
  - 开发版的工作区设了密码，迁移时 scope 已经建好，但数据库还没换钥匙就失败或中断了：现在这个工作区显示为"等待密码"（设了主密码时也一样），输入原来的密码就能接着迁移完。原来在主密码下它会一直报"数据库损坏"。设主密码时，这样的工作区暂时保留自己的密码，迁移完成后再去掉。
  - 解锁成功后总会删掉已经没用的 `vault.key`；每次启动先清理上次中断留下的 `.keystore-migration-backup.delete`、`.partial`，以及还原（`*.restoring`）和换钥匙（`*.rekey-*`）中断留下的临时文件，其中可能有明文副本。
  - 迁移时没有密码的工作区，先在 `adopting_workspaces` 里记一行再换钥匙。换钥匙失败（磁盘满、文件被别的程序占着）时，以后启动会接着做完。旧 TS 版这种情况会让工作区永远打不开。
  - 接管到一半的工作区碰上设主密码（所有 scope 都要换钥匙）时，直接从明文加密到新钥匙。原来设主密码会报错，工作区也打不开。
  - 没有完成标记的备份：工作区还没有 scope 时，说明它的数据库一定没被动过，副本一律重新复制。被推迟的密码工作区不知道旧密码，原来没法判断，可能用截断的副本把好文件盖掉。
  - `.pre-keystore-kept/` 里已有的文件不会被覆盖，同名的加时间后缀。
  - 移除工作区密码时，如果它迁移到一半，先用这个密码把迁移做完。
  - 只导出部分工作区时，没选的工作区的接管标记不会跟着带出去；新建工作区时清掉同 id 的旧标记。
  - 设置或移除主密码、解锁时，所有 scope 一起换钥匙。某个工作区的数据库坏了或磁盘满了，原来整个操作报错，其实主密码已经生效、旧恢复码也作废了，之后恢复码永远打不开应用。现在只有应用自己的钥匙换不了才算失败；换不了的工作区保持待轮换，打开时再试，启动时记为 `failedWorkspaces`。
  - 解锁时 `main.db` 已经打开、后面的步骤失败，原来钥匙留在内存里而界面显示锁屏，之后的锁定请求都被忽略。现在先重新锁上再报错。
  - `getssh.db` 里只差大小写的工作区 id（如 `Team` 和 `team`）在 macOS、Windows 上是同一个文件，原来拆分每次都失败。现在后出现的那个换成 `ws-` 开头的 id，名字保留。
  - JSON 导入中途崩溃后，原来剩下的工作区不会再导入。现在接着做的那次，如果 `main.db` 还没换钥匙，先从备份还原，再从头导入。
  - 清理临时文件只认这两种程序写出的确切名字（`<库>.rekey-<pid>-<16 位十六进制>`、`<备份里的文件名>.restoring`）。原来名字里含 `.rekey-` 的工作区（如 `certs.rekey-2026`），数据库会在启动时被当成临时文件删掉。
  - `.pre-keystore-kept/` 里重名时，整组文件（数据库和它的 WAL、钥匙）一起放进新的子目录，不再各自加后缀拆散。
  - 设了主密码时，移除迁移到一半的工作区的密码，原来两个密码都不认；现在用它自己的密码，同时把迁移做完。
  - 删除一个从 JSON 时代目录导入、换过 id 的工作区时，原来的目录（里面的 `profiles.json` 存着明文密码）一起删掉。
  - 工作区数据库被换成一个明文 SQLite 文件时，不再自动接管，而是报 `corrupt`。只有 `adopt_workspace` 中断后留下的文件会被接着加密：它开始前在 `main.db` 新表 `adopting_workspaces` 里记一行，挂载成功后删掉。
  - 工作区 id 的规则三处统一（`workspaceId.ts`、Rust、假实现）：任何位置都不能有控制字符（包括 C1，钥匙串库本来就拒绝），首尾空白按 JavaScript 的 `trim` 判断。
  - 旧版本接受、store 不接受的工作区 id（早期直接用输入的名字，可能带 `/`、`:`，或是 `con` 这类保留名）：拆分 `getssh.db` 和导入 JSON 时换成合法的 id（`ws-` 加原 id 的 MD5 前 12 位，重跑结果一样），原来的名字保留，数据照常加密。原来带 `/` 的会让每次启动都失败，带 `:` 的会留下明文数据库。隐藏目录不当作工作区。已经写进 `main.db` 的不合法 id，启动时记为 `failedWorkspaces`，可以删除这一行（文件不动）。
  - `start(legacy)` 里不能用的 `workspacePasswords` 条目（id 不合法、密码为空）直接跳过，不再让启动失败。
  - TS：两个解锁请求排队执行，第二个等第一个结束；2.0 的自动导入只跑一次，所有调用都等它完成，导入保存完之前不会通知 `ready`。
  - TS：解锁还没走完（store 已经打开、导入还在跑）时屏幕锁定或电脑睡眠，原来这个锁定请求会被丢掉，现在先记下来。设了主密码时直接保持锁定，不通知 `ready`；没设主密码时照常打开，再锁上有密码的工作区。store 还没打开（还在验密码、Touch ID 还在等）时的锁定请求不用记，应用本来就锁着；解锁失败时清掉记下的请求，不会带到下一次解锁。启动过程中的锁定请求在进入锁屏时清掉。
  - TS：`app_key.enc` 解不开（钥匙串条目被重置、数据从别的电脑拷来）时不再直接让启动失败，而是不传应用钥匙，由 store 判断：真要迁移时 store 拒绝启动，和原来一样，错误信息写 `app_key_unreadable` 和原因；设了主密码、只需要把剩下的文件移开时，照常启动。
  - TS：2.0 里没存端口的服务器，id 里用 `default` 代替端口，不会和存了端口 22 的同一台服务器混在一起。
  - 保留设备名（`con.<扩展名>` 等）的判断三处统一：扩展名里有 U+2028 / U+2029 时，JavaScript 的正则原来匹配不上。

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

10-03 进度：
- S1、S5 已完成；S2、S3 的 Rust 部分已完成；S4 的应用秘密（`setAppSecret` 等 3 个函数）已完成。真模块和假实现的对照检查 232 步，零差异。
- **主进程已接入 store（10-03）**。`DatabaseManager` 改成转发到 store 的薄包装，应用锁、主密码、恢复码、Touch ID、工作区密码、工作区切换、资产桥、资产文件夹都走 store。具体做法：
  - 启动时，3.0 开发版写的旧数据仍由 `keystoreMigration.ts`（`getssh-keystore` + bsmc）迁移；迁移跑完、文件全部关闭后才加载 store。只在需要迁移时才加载这两个旧模块（S6 改由 Rust 迁移）；
  - 迁移用到的旧代码挪进 `electron/main/security/legacyDatabase.ts`，S6 时删除；
  - 资产文件夹在 TS 那层再按 `localeCompare` 排一次；资产桥用 `copyProfiles` 复制服务器配置（凭据在 Rust 里重新封装），Runbook 只复制勾选的；
  - 过渡做法：`DatabaseManager.getProfiles()` 仍然把密码和口令交给界面（主进程用 `connectSecrets` 解开），界面现在还要靠它们连接。S4 改成按 id 连接后删掉；
  - 保存服务器配置时，密码字段 `undefined` 表示保留、空字符串或 `null` 表示清除；
  - 登录后执行的脚本（`postConnectScript`）上限从 4 KiB 放宽到 64 KiB，其他文本字段仍是 4 KiB。
- 行为变化：
  - 设了主密码后不能再给工作区单独设密码（`master_password_protects_workspaces`）；第一次设主密码前，有单独密码的工作区必须先解锁，设完后它们改由主密码保护；
  - 修改或移除主密码、修改或移除工作区密码、设了主密码时生成恢复码，都要输入当前密码，不再接受 Touch ID 代替；
  - Touch ID / Windows Hello 只有一个总开关，同时管应用和所有设了单独密码的工作区。
- 手写 SQL 只剩开发版数据的迁移（`keystoreMigration.ts`、`legacyDatabase.ts`、`databaseKeys.ts`）、旧的导出导入（`systemHandler.ts`，S5 接入时删）和打包自检。
- 测试：`npm run test:keystore-e2e` 共 17 个阶段，新增服务器配置、资产桥、IPC 三个阶段；IPC 阶段在隐藏窗口里调用设置页、工作区切换、资产桥用到的通道。
- **磁盘上的变化**：store 第一次打开工作区时，会把明文密码封装成 `gk1:` 字段，并加上新表和新列。之后再用接入前的版本打开，密码会显示成 `gk1:…`，连接失败。合进 `v3-next` 前负责人先备份。
- **S4 的主进程部分（10-03）**：
  - AI Key（`ai/<服务商>`）、界面配置里的敏感项（`config/renderer`：启动脚本、代理、AI 地址和模型）、MCP 服务器的 `env` 和 `headers`（`mcp/<id>`）都存进 `setAppSecret`。旧的 `safeStorage` 文件和 localStorage 里的密文在第一次用到时搬进来，然后删除。启动时不再访问钥匙串；
  - 界面配置的敏感项和 MCP 服务器要等应用解锁后才读取、启动。设了主密码时，它们也受主密码保护；
  - 按 id 连接：连接请求里带了已保存配置的 id、又没有带密码时，主进程从 store 取主机、端口、用户名和凭据，不用请求里的地址。界面临时输入的密码照旧使用；
  - 界面不再拿到已保存的密码：`unlock-profiles`、`workspace:switch` 的配置只带 `hasPassword` / `hasPassphrase`；
  - 测试：`keystore-e2e` 18 个阶段，新增的 `connect` 阶段在本机起一个 SSH 服务器真连；`appSecrets`、MCP 秘密各有单元测试。
- S4 还没做的：
  - 终端粘贴改走主进程，并拒绝读回刚复制的密码（第 6 节的剩余风险）。要改 `TerminalPane.tsx`，等 Codex / Gemini 的改名提交后再做；
  - 插件的 `safeStorage.encrypt` 只能加密、不能解密，没有动；换成插件秘密接口要先定插件 API；
  - `mcp:*` 通道仍把 `env` / `headers` 返回给界面（MCP 设置页要显示它们），也没有检查发送方。

10-06 进度：
- S6 的核心部分已完成（在 `feat/master-key-store`，还没合进 `v3-next`）：开发版数据由 Rust 迁移，`keystoreMigration.ts`、`legacyDatabase.ts`、`databaseKeys.ts` 已删除，主进程启动时不再加载 bsmc；2.0 的服务器配置自动导入。两轮审查发现的问题都已修复，见第 7 节。
- 测试：Rust 113 个，clippy 无警告；对照检查 240 步，零差异；假实现 48 个；主进程单元测试 361 个；`keystore-e2e` 21 个阶段。每个修复都故意改坏一次，测试都报了错（Rust 36 处，TS 18 处）。
- S6 还没做的：`package.json` 去掉 bsmc、`build-native.js`、启动自检和打包配置。Codex 的改名也改了这几个文件，等它提交后再做。

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
   - **10-03 起主进程已接入 store**，开了 `GETSSH_FAKE_STORE=1` 时整个应用（侧栏、应用锁、`workspace.unlock`、`security.*`）都走假实现：
     - 初始数据里可以设 `masterPassword`，启动后在锁屏输入它；设一个短于 12 个字符的，`masterPasswordMustChange` 就是 `true`；
     - 工作区 id 不必用 `default`，`is_main: true` 的那个就是主工作区。
   - 不开假实现时走真模块，数据在 `~/.getssh`，所以开发时一定要用临时 HOME。导入完成、重启之前，`store` 这组通道返回 `unavailable`；SSH 私钥那 4 个函数真模块还没有，也返回 `unavailable`。界面要能处理这个错误码。
   - 已有界面要跟着改的地方（10-03）：
     - 设了主密码时，设置页仍然显示工作区的"设置密码"按钮，点了会返回 `master_password_protects_workspaces`，按钮要隐藏；
     - 强制更换主密码的对话框还没有，`masterPasswordMustChange` 现在是真实值；
     - Touch ID 开关不再区分工作区，工作区那一栏的开关和应用那一栏是同一个；
     - Claude 已改了 `SafeStorageTab.tsx` 的两处：设主密码后生成恢复码时传入新主密码；有主密码但还没有恢复码时，"创建"按钮先打开输入当前密码的表单；
     - 已保存的密码和口令不再发给界面，配置里改成 `hasPassword` / `hasPassphrase`。Claude 已在 `ConnectForm.tsx` 里加了占位提示"已保存，留空则不修改"，留空表示保留。查看已保存的密码用 `store.reveal`，清除已保存密码的入口还没有。
   - 2.0 服务器的导入（10-06，`window.electronAPI.store.legacyV2`，类型在 `src/types.d.ts`）：
     - 应用变成 `ready` 后调一次 `status()`；
     - `imported.portDefaulted > 0` 时，用 `appConfig.defaultPort` 调 `applyDefaultPort({ port })`，然后用返回的 `profiles` 替换窗口里的列表。默认端口是 22 时也要调一次，之后就不会再提示；
     - `needsPassword` 为 `true` 时，提示用户输入 2.0 的主密码，调 `import({ password, defaultPort })`。返回 `wrong_password` 时让用户重输，`imported` 时同样用返回的 `profiles` 替换列表；
     - 不替换列表的话，窗口下一次保存（整个列表一起保存）会把刚导入的服务器删掉。
   - 假实现不会被打包（`extraResources` 只收 `*.node`、`index.js`、`package.json`）。
   - 截至 10-03，`store.d.ts` 共 67 个函数，真模块已实现 63 个。其余 4 个是 SSH 私钥的导入、生成、列出、删除（阶段 B），暂时只有假实现。
4. **需要新的 IPC 或者接口改动**：写下来交给负责人或 Claude，不要自己改 `electron/main/**`、`electron/preload/**`。
5. **拿到最新进度**：`git merge v3-next`。
6. **完成一块就在自己的分支上提交**，然后把分支名告诉负责人。
7. **测试一律用临时 HOME**：`HOME` / `USERPROFILE` 指向临时目录，绝不读写真实的 `~/.getssh`，也不动系统钥匙串里已有的条目。
8. **以下文件不属于任何一方，不要提交**：仓库根目录的 `GETSSH_v3.0_*.md`、`apps/getssh-client/scripts/security/` 下的 `*chaos*` 和 `*stress*` 脚本、`docs/dependency-licenses.md`、`docs/dependency-update-report.md`。
