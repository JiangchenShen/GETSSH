# GETSSH 3.0 加密与数据层设计（getssh-store）

> 状态：草案，待确认后冻结接口
> 分支：`feat/master-key-store`（基于 `v3-next` 5a8c533）
> 日期：2026-10-01
> 读者：参与开发的三个 AI，以及项目负责人

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

**倾向 A。** 验证要通过三项：
1. 打开一份由 bsmc 12 写出的**测试库副本**，跑 `integrity_check`，行数一致；
2. macOS arm64/x64、Windows x64/arm64 四个 CI 目标都能编译；
3. 打开一个库的耗时不超过 1 ms。

### 3.3 运行方式

- 每个库一个连接，用 `Mutex` 保护，始终用 WAL 模式。
- **增删改查用同步 N-API**：和现在 better-sqlite3 的同步语义一致，TS 调用方改动最小。
- **Argon2、换钥匙、导出、导入用异步任务**（AsyncTask），不阻塞主线程。
- 错误格式沿用 keystore 的 `[store:<code>] 说明`，code 取值：
  `locked`、`needs_password`、`wrong_password`、`rate_limited`、`not_found`、`invalid_argument`、`corrupt`、`unavailable`、`io`、`busy`、`rotation_pending`。
- 不开放任意 SQL。每个操作都是有类型的函数，参数绑定都在 Rust 里完成。

## 4. 接口草案（冻结后写成 `rust-core/getssh-store/store.d.ts`）

```ts
// ── 生命周期与应用锁 ──
export function configure(baseDir: string): void;                 // ~/.getssh
export function start(): Promise<StartReport>;                    // 迁移旧数据，打开不需要密码的库
export function appState(): AppState;                             // phase / masterPassword / presence / recovery / deviceBackend
export function unlockApp(route: UnlockRoute): Promise<void>;     // { password } | { presence: reason } | { recoveryCode }
export function lockApp(): void;                                  // 丢弃所有钥匙，关闭所有受保护的库

// ── 主密码、Touch ID、恢复码 ──
export function setMasterPassword(password: string, current?: string): Promise<{ recoveryReset: boolean }>;
export function removeMasterPassword(current: string): Promise<void>;
export function setPresence(enabled: boolean, reason: string): Promise<void>;
export function createRecoveryCode(current?: string): Promise<string>;   // 只显示一次
export function removeRecoveryCode(): Promise<void>;

// ── 工作区 ──
export interface Workspace { id: string; name: string; isMain: boolean; hasPassword: boolean; state: 'open' | 'locked'; preferences: string | null; createdAt: number }
export function listWorkspaces(): Workspace[];
export function createWorkspace(input: { name: string; password?: string }): Promise<Workspace>;
export function renameWorkspace(id: string, name: string): void;
export function setWorkspacePreferences(id: string, json: string): void;
export function setMainWorkspace(id: string): void;
export function deleteWorkspace(id: string): Promise<void>;
export function openWorkspace(id: string): Promise<'open' | 'locked'>;
export function unlockWorkspace(id: string, route: { password: string } | { presence: string }): Promise<void>;
export function lockWorkspace(id: string): void;
export function setWorkspacePassword(id: string, password: string, current?: string): Promise<void>;
export function removeWorkspacePassword(id: string, current: string): Promise<void>;
export function workspaceStats(id: string): WorkspaceStats;

// ── 服务器配置：任何读取接口都不返回秘密 ──
export interface Profile {
  id: string; host: string; port: number; username: string; alias: string | null; protocol: string;
  groupName: string | null; folder: string | null; osType: string | null; authType: 'password' | 'key' | 'agent';
  keyId: string | null;                 // 引用库里的私钥（见第 6 节）
  hasPassword: boolean; hasPassphrase: boolean;
  /* 其余非秘密字段与现有 ProfileRow 一致：autoStart、useKeepAlive、proxyJump、strictHostKeyChecking、
     initialDirectory、postConnectScript、themeOverride …… */
}
/** 秘密字段的约定：undefined 表示保持原值，null 表示清除，string 表示设置新值。 */
export interface ProfileInput extends Omit<Profile, 'hasPassword' | 'hasPassphrase'> { password?: string | null; passphrase?: string | null }
export function listProfiles(workspaceId: string): Profile[];
export function saveProfiles(workspaceId: string, inputs: ProfileInput[]): Profile[];   // 和现有的整表保存语义一致
export function deleteProfiles(workspaceId: string, ids: string[]): void;
export function copyProfiles(from: string, to: string, ids: string[]): void;            // 资产桥接；秘密在 Rust 内重新封装

// ── 连接用凭据：只给主进程，绝不经 IPC 转发 ──
export interface ConnectSecrets { password?: Buffer; privateKey?: Buffer; passphrase?: Buffer }
export function connectSecrets(workspaceId: string, profileId: string): ConnectSecrets; // 握手完成后由调用方 fill(0)

// ── 查看密码：5 分钟滑动窗口 ──
export function openReveal(workspaceId: string, route: { presence: string } | { password: string }): Promise<void>;
export function revealSecret(workspaceId: string, profileId: string, field: 'password' | 'passphrase'): string;
export function closeReveal(workspaceId: string): void;

// ── 私钥（阶段 B） ──
export interface SshKey { id: string; name: string; algorithm: string; fingerprint: string; publicKey: string; hasPassphrase: boolean; createdAt: number }
export function importSshKey(workspaceId: string, input: { name: string; data: Buffer; passphrase?: string }): SshKey;  // OpenSSH / PEM / PPK
export function generateSshKey(workspaceId: string, input: { name: string; algorithm: 'ed25519' }): SshKey;
export function listSshKeys(workspaceId: string): SshKey[];
export function deleteSshKey(workspaceId: string, id: string): void;

// ── 应用级秘密：AI Key、插件秘密、MCP token，取代 safeStorage 文件 ──
export function setAppSecret(name: string, value: string | null): void;
export function getAppSecret(name: string): Buffer | null;        // 只给主进程

// ── 其余表：一一对应现有 DatabaseManager 方法，名字不变 ──
// globalSettings: getGlobalSetting / setGlobalSetting
// assetFolders: getAssetFolders / createAssetFolder / renameAssetFolder / removeAssetFolder / moveProfilesToAssetFolder
// runbooks: getRunbooks / saveRunbooks
// ai: getAiSessions / createAiSession / saveAiMessage / updateAiSessionTitle / deleteAiSession
// memory: upsertAiMemoryVector / getAiMemoryVectors / deleteAiMemoryMessage / deleteAiMemorySession /
//         getRecentAiMessagesForMemory / getAiMessagesByIds
// audit: logAudit / getAuditLogs

// ── 导出与导入（第 5 节） ──
export function exportBundle(path: string, password: string): Promise<ExportReport>;
export function inspectBundle(path: string): Promise<BundleInfo>;   // 只读头部，不需要密码
export function importBundle(path: string, password: string, mode: 'replace' | 'merge'): Promise<ImportReport>;
```

渲染进程看到的 IPC 接口不变：仍然经过 `keystoreHandler` / `workspaceHandler` / `profileHandler`。只是这些处理器改成调用 `getssh-store`，而且任何返回给渲染进程的数据里都没有秘密字段。

## 5. 加密导出包

### 5.1 导出

- **必须设导出密码**，至少 12 个字符；设了主密码时，默认就用主密码。不提供明文导出。
- 导出前要求所有工作区都处于解锁状态。锁着的工作区，界面先逐个请你解锁。
- 打包内容（白名单）：
  - `main.db` 和所有 `workspace_<id>.db`，导出前先执行 `wal_checkpoint(TRUNCATE)`，不带 `-wal` / `-shm`；
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

1. 校验头部，用导出密码解开密钥区。
2. 解到临时目录，用 Rust 打开每个库跑 `integrity_check`。
3. 按模式处理：
   - `replace`（3.0 默认）：先自动备份当前的 `~/.getssh`，然后整体替换；
   - `merge`：把导入的工作区作为新工作区并入，ID 冲突时重新生成。
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

## 8. 三个 AI 的协作规则

1. **每个 AI 用自己的 git worktree**，例如 `git worktree add ../GETSSH-<名字> <分支>`。三个 AI 不能共用 `~/Documents/GETSSH` 这一个工作区，否则一方切分支或打包，另外两方的文件就被换掉了。9 月 30 日就发生过一次。
2. **按目录分工，互不越界**：

   | 负责方 | 范围 |
   |---|---|
   | AI-1（建议 Claude） | `rust-core/getssh-store/**`、`rust-core/getssh-keystore/**`、数据迁移、导出包核心、集成和合并 |
   | AI-2 | `apps/getssh-client/electron/main/**`（`security/keystore*` 除外）：`DatabaseManager` 薄包装、各个 handler、按 id 连接 |
   | AI-3 | `apps/getssh-client/src/**`、`electron/preload/**`、`src/types/**`：配置编辑器（不碰秘密）、查看窗口、导出导入界面、私钥管理界面 |

3. **先冻结接口**：第 4 节确认以后，由 AI-1 提交 `store.d.ts`，再加一个纯 JS 的假实现 `store.fake.js` 供 AI-2/AI-3 先开发和测试。之后接口要改，必须先在本文档里改，再通知另外两方。
4. 各自的分支从 `feat/master-key-store` 拉出，通过 PR 合回这个分支，由 AI-1 合并并跑完整测试，最后整体合进 `v3-next`。
5. 推送前必须通过：
   - `tsc -b`；
   - `cargo test -p getssh-store -p getssh-keystore`；
   - `npm run test:keystore-e2e`；
   - 改到的那部分对应的测试脚本。
6. **禁止的操作**：
   - 在别人的分支或工作区上打包；
   - 提交不属于自己的未跟踪文件；
   - 碰真实的 `~/.getssh` 和系统钥匙串（测试一律用临时 HOME）；
   - 把篡改过的钥匙材料喂给 Secure Enclave 或 TPM。

## 9. 时间线（3.0 定于 10 月 20 日）

| 日期 | 里程碑 |
|---|---|
| 10-02 | 本文档确认，接口冻结；完成 S0 |
| 10-06 | S1、S2 完成；配置编辑器接上新接口 |
| 10-09 | S3、S4 完成 |
| 10-12 | S5 完成，导出导入跑通 |
| 10-13 ~ 10-19 | 两个平台的 CI、打包、真机测试（Touch ID、Windows Hello、迁移你的真实数据备份）、修 bug；依赖升级阶段 0 和 Electron 的决定也在这段时间落地 |

阶段 B 视进度决定是否进入 3.0。

## 10. 待定问题

1. 导入时 `merge` 模式要不要进 3.0，还是只做 `replace`？
2. 导出时如果有工作区锁着、用户不想逐个解锁，是不导出这些工作区，还是必须全部解锁？我建议必须全部解锁，保证"一次带走全部"。
3. 已经设过的 8–11 位主密码要不要提示用户更换？我建议在设置页显示一条提示，但不强制。
4. AI-2、AI-3 具体由哪两个 AI 负责？
