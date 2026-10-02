# GETSSH 分工与协作

> 更新：2026-10-02。3.0 定于 10 月 20 日发布
> 本文件：`/Volumes/Developer/GETSSH/docs/GETSSH_TEAM_CN.md`
> 谁负责什么，以本文件为准。它取代 `GETSSH_STORE_DESIGN_CN.md` 原来的第 8、11 节。存储层的接口和设计仍以那份文档和 `store.d.ts` 为准。

## 1. 谁负责什么

| 成员 | 负责 | 不碰 |
|---|---|---|
| 负责人 | 产品方向、文案定稿、发版；决定谁做什么；合并到 `main` | — |
| Claude | 全部深层后端：`rust-core/**`、`apps/getssh-client/electron/main/**`、`electron/preload/**`（IPC 边界）、数据迁移、导出导入、原生模块构建和打包；审查别人的后端改动；把后端改动合并到 `v3-next` | 界面的组件和样式，除非负责人指定 |
| ChatGPT（Codex） | 产品界面 `apps/getssh-client/src/**`；官网 `GETSSH-WEBSITE`；存储相关的界面（导出导入、查看密码、强制更换主密码、私钥管理） | `rust-core/**`、`electron/main/**`、`electron/preload/**`，第 4 节的试用任务除外 |
| Gemini | QA：写测试、跑测试、报 bug；配合 Codex 做界面；改文案第二版 | 后端生产代码。发现问题写报告，不直接改 |

- 界面由 Codex 主导，Gemini 配合。两人不同时改同一个文件，具体分到哪个组件由负责人定。
- 写测试用 Gemini 3.8 Flash。Gemini 3.1 Pro 不再用来写代码和测试。
- Gemini 4 Argon 要参与写代码，先走第 4 节同样的试用流程。

## 2. 工作区和分支

1. **每个 AI 用自己的 git worktree**，都放在 `/Volumes/Developer/` 下。不要在同一个目录里两个人同时干活：9 月 30 日就出过一次事，一方切分支、打包，另一方的文件全被换掉了。

   | 目录 | 分支 | 谁用 |
   |---|---|---|
   | `/Volumes/Developer/GETSSH` | `v3-next` | 负责人每天在这里跑 `pnpm run dev`；只有负责人和 Claude 在这里合并 |
   | `/Volumes/Developer/GETSSH-store` | `feat/master-key-store` | Claude 的存储层开发 |
   | `/Volumes/Developer/GETSSH-codex` | `feat/ui-<主题>` | Codex（需要时新建） |
   | `/Volumes/Developer/GETSSH-gemini` | `qa/<主题>` | Gemini（需要时新建） |
   | `/Volumes/Developer/GETSSH-v2` | `V2` | 2.x 维护（需要时新建） |
   | `/Volumes/Developer/GETSSH-WEBSITE` | 官网仓库 | Codex |

   新建的方法：

   ```bash
   cd /Volumes/Developer/GETSSH
   git worktree add ../GETSSH-codex -b feat/ui-<主题> v3-next
   cp -R .agents ../GETSSH-codex/    # 规则文件不进 git，新 worktree 要自己复制一份
   cd ../GETSSH-codex && pnpm install --frozen-lockfile
   ```

2. **代码不要放在 "SAMSUNG PORTABLE SSD" 这个卷上**，也不要给它改名：上面有负责人的剪映工程，按绝对路径引用。代码都放在 `/Volumes/Developer`。
3. **怎么合进 `v3-next`**：
   - 完成一块就在自己的分支上提交，然后把分支名告诉负责人；
   - 只改了 `src/**` 和官网的分支，负责人可以自己合并；
   - 改到其他目录的分支，由 Claude 审查后合并。
4. **2.x 在 `V2` 分支上维护。**
   - `V2` 于 10-03 从 `main` 的 `f5602a4` 切出，包含 `v2.0.0_R7K4S`；
   - 2.1 和以后的 2.x 修复都提交到 `V2`，不提交到 `main`；
   - `main` 暂时还是 2.0。v3 准备好以后，`v3-next` 快进合并到 `main`。在那之前，谁都不要往 `main` 提交，否则就不能快进了。
5. **不推送 GitHub，不开 PR，不手动触发 CI。** 只有负责人决定推送时才推送。

## 3. 交付前要做的

**通用规则：说"测试通过"时，要贴上命令和原始输出。没有输出的结论不算数。**

| 谁 | 至少跑这些 |
|---|---|
| Codex、Gemini（界面） | 在 `apps/getssh-client` 下跑 `pnpm exec tsc -b tsconfig.json --force --pretty false` 和 `pnpm exec vite build`；改了文案，再在仓库根目录跑 `node scripts/copy-lint.js --strict <改过的文件>` |
| Gemini（测试） | 新测试先对当前代码跑一遍，失败的要说明是测试写错了还是发现了 bug；再故意改坏被测的那行代码，确认测试会失败 |
| Claude（后端） | `cargo test` 跑改到的 crate；`apps/getssh-client` 下的 `npm run test:keystore-e2e`；仓库根目录下的 `GETSSH_STORE_CONFORMANCE=1 node rust-core/getssh-store/store.conformance.mjs`；改到哪部分，就跑对应的 `test:*` 脚本。发版前在 macOS 和 Windows 上跑 `npm run test:packaged-startup` |

## 4. Codex 参与后端：先试用一次

Codex 先把前端的问题修完，然后参与后端。第一次只给一个范围清楚、有现成判定标准的任务，做完由 Claude 审查。

- **建议的试用任务**（负责人定）：存储层 S3 里的"资产文件夹"一组函数。
  - 接口在 `store.d.ts` 里；
  - 预期行为由假实现 `store.fake.js` 给出；
  - `store.conformance.mjs` 可以逐项对比真模块和假实现。
- **写进任务说明的规则**：
  - 只改任务说明里列出的文件；
  - 不改、不删、不跳过已有的测试，新测试单独加；
  - 不用 `git reset`、`git checkout -- .`、`git push`，不改 git 配置；
  - 改代码用 `apply_patch`，不要用脚本批量改文件（Codex 界面里的 diff 看不到脚本做的改动，社区已经报告过）；
  - 交付时附上测试命令的原始输出。
- **Claude 怎么审**：
  - 看 `git diff v3-next...<分支>` 的真实内容，不看 Codex 界面里显示的 diff；
  - 重点查：测试有没有被削弱，有没有桩代码或写死的返回值，有没有改出任务范围，错误处理全不全。
- **怎么判断**：
  - 返工少，Codex 就继续分担后端；
  - 返工多，后端仍由 Claude 负责，Codex 回到界面。
- **反过来也可以**：Claude 的大改动，负责人可以请 Codex 只读复审。Codex 只提问题，不改代码。

## 5. QA 和测试（Gemini）

1. **测试必须和真实数据隔离。** 负责人每天用 v3 开发版处理真实数据，碰坏了就是真的丢数据。
   - `HOME` 和 `USERPROFILE` 指向临时目录；启动 Electron 时加 `--use-mock-keychain`；
   - 不读写真实的 `~/.getssh`、`~/Library/Application Support/getssh`，也不动系统钥匙串里已有的条目；
   - 无人值守的测试不弹 Touch ID、Windows Hello；
   - 不把篡改过的钥匙材料交给 Secure Enclave 或 TPM。以前这样做导致过一次内核崩溃，电脑直接重启；
   - 例外：存储层自己的测试（`test:keystore-e2e`、`store.conformance.mjs`）在临时 HOME 里会新建设备钥匙。有 Secure Enclave 的 Mac 上不会留下东西；Windows 或没有 Secure Enclave 的 Mac 上，会在 TPM 或钥匙串里留下名为 `GETSSH-Keystore-*` 的条目。这些测试是允许的。
2. **`apps/getssh-client/scripts/security/` 下没提交的 `*chaos*` 和 `*stress*` 脚本，先别跑。**
   - 其中 `rust-core-chaos-suite.mjs`（第 78 行）和 `rust-core-exhaustive-stress.mjs`（第 195 行）用的是真实 HOME：会在真实主目录下检查并递归删除测试目录（`~/getssh_test_escaped_ws_*`、`~/nexus_escape_*`）；
   - 改成临时 HOME 并经过 Claude 看过以后才能跑；
   - 这些脚本都不要提交。
3. **测试要能抓到真 bug。** 第 3 节"故意改坏"那一步不能省。Claude 会挑模块做变异测试（Rust 用 cargo-mutants，TS 用 Stryker），检查测试是否真的有效。
4. **报 bug 写清四样东西**：复现命令、实际输出、预期结果、所在文件和行号。

## 6. 文案

- 流程：Claude 或 Codex 写第一版，Gemini 改第二版，负责人和 Claude 或 Codex 定稿。
- 规则见 [GETSSH_COPY_STYLE_CN.md](GETSSH_COPY_STYLE_CN.md)，检查用 `node scripts/copy-lint.js`。

## 7. 会改动用户数据的合并

负责人每天在 `/Volumes/Developer/GETSSH` 跑的开发版，用的就是自己的真实数据。下面这类改动，Claude 在合进 `v3-next` 之前要先告诉负责人，等负责人备份完再合并：

- 存储层接进主进程（`DatabaseManager` 改用 getssh-store）；
- S3、S4 的秘密迁移；
- S6 删掉 bsmc；
- 其他会改动磁盘上数据格式的改动。

备份命令（负责人自己跑）：

```bash
ditto ~/.getssh /Volumes/Developer/getssh-backup-<日期>/dot-getssh
```

```bash
ditto ~/Library/Application\ Support/getssh /Volumes/Developer/getssh-backup-<日期>/app-support
```

## 8. 所有人都不能做的事

- 读写真实的 `~/.getssh`、`~/Library/Application Support/getssh`，或者动系统钥匙串里已有的条目。
- 在别人的 worktree 里切分支、打包、改文件。`/Volumes/Developer/GETSSH` 是负责人日常用的目录，只用来合并（第 2 节）。
- 提交不属于自己的文件或别人还没提交的改动。不要用 `git commit -a`、`git add -A`，只 add 自己改的文件。目前这些不属于任何一方：
  - 仓库根目录的 `GETSSH_v3.0_*.md`；
  - `apps/getssh-client/scripts/security/` 下的 `*chaos*` 和 `*stress*` 脚本；
  - `docs/dependency-licenses.md`、`docs/dependency-update-report.md`；
  - 别人改了还没提交的 `.vscode/settings.json`。
- 未经负责人同意就推送 GitHub、开 PR、触发 CI。
- 在 Windows 测试笔记本上要管理员权限。那台机器的设置脚本只由负责人运行，AI 只用标准账户 `getssh-test`。
- 自己改 `store.d.ts`。接口要改，先改 `GETSSH_STORE_DESIGN_CN.md`，由 Claude 提交，再通知负责人和 Codex。
