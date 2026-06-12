# GETSSH 满血版工作区 (Workspace 2.0) 智能安全架构提案

为了适应日益复杂的企业混合云环境与未来 AI 智能体（Agent）自动化运维的浪潮，本提案对现有的“高级文件夹分类”设计进行毁灭性的重构升级。

Workspace 2.0 将不再仅仅是静态的资产分类，而是演进为一个**高度集成的智能、网络、审计与自治的四维物理隔离上下文沙箱**。

---

## 1. 核心设计理念：多维隔离上下文

工作区切换将从“仅切换加载路径”跃迁为**“系统状态与运行环境的整体热切换”**：
1. **智能体记忆隔离**：避免 RAG 知识污染，杜绝企业核心机密外泄至非信任域。
2. **动态网络拓扑**：网络链路级绑定，工作区自带专线或代理策略。
3. **运维剧本常驻**：基于上下文的常驻剧本盘，实现指令精细化、原子化。
4. **低噪审计录屏**：无感物理审计，保障合规与安全回溯。
5. **智能体安全自治**：AI 助手获取特定沙箱权限，自动执行任务。

---

## 2. 物理目录结构 (Storage Architecture 2.0)

工作区 2.0 的物理存储结构深度强化了扩展属性，将所有特定上下文资源物理聚拢在独立的工作区目录下：

```text
~/.getssh/
├── app-config.json                  # 全局配置（记录全局设置、工作区列表及当前 active_workspace）
├── global_plugins/                  # 全局插件（可被各工作区按需加载）
└── workspaces/
    └── [workspace_id]/              # 物理隔离的工作区根目录
        ├── profiles.json            # 1. 远程主机资产与 SFTP 标签
        ├── vault.key                # 2. 工作区独立凭证金库密钥 (AES-256-GCM 派生)
        ├── network_proxy.json       # 3. 动态网络拓扑与代理、跳板机绑定配置文件
        ├── runbooks.json            # 4. 工作区专属 Snippets 与运维剧本
        ├── storage.db               # 5. 插件专属隔离本地存储 (SQLite)
        ├── audit_recordings/        # 6. 安全审计记录目录
        │   ├── 20260607_audit.cast  #    Asciinema 格式的低损耗二进制会话审计文件
        │   └── audit_log.db         #    高危命令操作的时间戳与审计摘要日志
        └── ai_context/              # 7. 智能体记忆隔离层
            ├── lancedb/             #    LanceDB 本地向量数据库目录（存储代码结构、运维日志、主机拓扑向量）
            └── session_history.json #    AI 对话历史与长短期记忆缓存文件
```

---

## 3. 五大核心板块架构设计

### 3.1 智能体记忆隔离层 (AI Context Isolate & Local RAG)
每个工作区在初始化时，其对应的向量数据库和 AI 缓存将具有完全隔离的物理路径。
* **隔离引擎选择**：使用 **LanceDB** 作为嵌入式向量数据库（在 macOS/Windows 环境下无外部依赖，零开销拉起），辅以 **DuckDB** 用于结构化运维日志的快速多维分析。
* **知识隔离规则**：
  * 在工作区 A（例如：企业生产环境）检索出的系统拓扑、错误日志、配置文件结构被向量化后写入 `workspaces/workspaces-a/ai_context/lancedb/`。
  * 切换到工作区 B 时，该 LanceDB 连接实例**必须彻底销毁**，彻底卸载相关内存缓存，重新实例化指向 `workspaces/workspaces-b/ai_context/lancedb/` 的只读/读写引擎。
  * 内存中的历史消息上下文（Chat Message Context Window）在切换时执行原子级擦除（Zero-Out）。

### 3.2 动态网络拓扑与代理绑定 (Workspace Network Binding)
在 `network_proxy.json` 中定义该工作区所锚定的网络拓扑策略。

* **JSON Schema 结构设计** (`network_proxy.json`)：
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "workspaceId": "prod-workspace-uuid",
  "defaultProxy": {
    "type": "socks5",
    "host": "10.200.0.1",
    "port": 1080,
    "authenticate": true,
    "credentialRef": "vault:proxy_credential_id"
  },
  "routes": [
    {
      "pattern": "192.168.100.*",
      "strategy": "direct"
    },
    {
      "pattern": "*.internal.corp",
      "strategy": "jump_host",
      "jumpHostRef": "profile_id_of_bastion"
    }
  ]
}
```
* **动态重定向机制**：
  * 主进程在加载工作区时读取该配置文件，动态实例化内部的代理路由表管理器（Proxy Router）。
  * 后续所有的本地终端 Shell 请求、SSH 握手请求、Telnet 套接字以及 SFTP 通道，其底层的 TCP 连接全部先通过该 Router 路由。
  * 切换工作区时，Router 执行断开重连逻辑，清理旧通道缓存，确保网络流量自动无缝漂移到新的安全出口，无需用户手动切 VPN。

### 3.3 工作区级 Runbooks 引擎 (运维剧本引擎)
在侧边栏和快捷键中心（Cmd/Ctrl + K Command Center）动态渲染特定工作区的常驻指令盘。

* **剧本配置定义** (`runbooks.json`)：
```json
{
  "runbooks": [
    {
      "id": "runbook-db-backup",
      "name": "🚀 生产数据库热备份",
      "description": "自动执行备份并将压缩包上传到归档服务器",
      "dangerLevel": "high",
      "requireMfa": true,
      "steps": [
        {
          "stepIndex": 1,
          "targetHostRef": "prod-db-01",
          "command": "pg_dump -U postgres prod_db | gzip > /tmp/db_backup_$(date +%F).sql.gz"
        },
        {
          "stepIndex": 2,
          "targetHostRef": "archive-server",
          "command": "scp prod-db-01:/tmp/db_backup_*.sql.gz /data/backups/"
        }
      ]
    }
  ]
}
```
* **执行安全机制**：
  * **危险分级（dangerLevel）**：对于 `high` 级别命令，UI 将强制弹出二次确认弹窗并执行背景高亮警告（如琥珀色呼吸灯）。
  * **MFA 机制**：若 `requireMfa: true`，将触发一次应用级别的面容 ID/指纹解锁（Biometric Auth）或 Vault 主密码校验，通过后方可下发命令。

### 3.4 物理级会话录制与安全审计日志 (Session Auditing Stream)
为了满足金融、电力等敏感行业的等保合规要求，工作区提供纯原生的二进制会话流审计记录。

* **录制协议与格式**：采用标准开源的 **Asciinema (v2)** 协议规范。数据记录为 Gzipped JSON 行式文件：
  ```json
  [0.0234, "o", "Last login: Sun Jun  7 11:29:15 2026\r\n"]
  [0.4501, "i", "ls -la\r"]
  [0.4510, "o", "total 64\r\ndrwxr-xr-x  14 shenjiangchen  staff    448 Jun  7 11:29 .\r\n"]
  ```
* **低损耗写缓冲机制**：
  * 在主进程为每个活动终端分配一个轻量级的双重循环写缓冲区（Ring Buffer）。
  * 终端输出数据（stdout 帧）在渲染到前端的同时，异步写入缓冲队列。
  * 写入线程以固定频率（例如 200ms）或缓冲区到达临界值（如 4KB）时，利用底层 Rust 执行压缩持久化，对 CPU 的占用损耗小于 1%，保障界面无阻碍、无卡顿。

### 3.5 终极演进：智能体安全自治沙箱 (Agentic Execution Shell)
AI 智能体在工作区内被赋予“受限操作员”的身份，能在指定权限范围内替代人类完成常规或高频的巡检与维护工作。

* **能力授权控制（Capability-Based Authorization）**：
  * AI 智能体只能通过主进程的安全通道发起调用。
  * 工作区通过全局配置授予智能体具体的权限级别（Read-Only, Runbook-Only, Full-Access）。
  * 在安全沙箱（VM）内隔离运行智能体生成的自动化脚本，防止脚本内嵌恶意代码发起逃逸攻击。
* **人在回路中机制 (Human-in-the-loop)**：
  对于非 Runbook 预定义的即时 AI 运维方案（如 AI 检测到 CPU 满载，自动生成的扩容命令），系统触发“挂起确认”流程：
  
  ```mermaid
  sequenceDiagram
      participant AI as AI Agent (LIL-OS)
      participant Core as GETSSH Agent Core
      participant User as User (Human Approve)
      participant Server as Target Servers
      
      AI->>Core: 生成故障自愈指令集 (rm, systemctl, config patch)
      Core->>Core: 安全规则过滤器拦截 (静态代码分析/正则黑名单)
      Core->>User: 弹窗展示拟执行指令，并进行高危步骤高亮
      User->>Core: 确认授权执行
      Core->>Server: 异步批量执行指令
      Server-->>Core: 返回状态与标准输出
      Core-->>AI: 喂回执行结果进行闭环分析
  ```
* **TECTONIUM 跨生态协同**：
  GETSSH 的 Agent 可以与未来 Tectonium 全自动建站生态进行跨系统联动部署。当 Tectonium 生成了新静态资源或需要服务器端配置更新时，通过内部受信任的安全 API 触发 GETSSH 工作区内的 Agent，以工作区绑定的特定凭证和堡垒机通道安全地向目标服务器执行一键热部署。

### 3.6 全域 AI 智能体中心 (GETSSH AI CENTER) 交互与数据流
为了使用户能够以极低心智开销与 AI 交互，同时遵守最严格的运维安全红线，工作区 2.0 深度融合了 **GETSSH AI CENTER** 的悬浮式上下文交互流。

#### 3.6.1 【无中生有】命令生成流（小星星与纸飞机）
用户在当前活动终端输入区处于无输入或需要辅助状态时，可通过双击快速唤起 AI 生成。

```mermaid
graph TD
    Double_Click["1. 终端输入区双击"] -->|触发悬浮| Floating_Star["2. 动态小星星图标 Star Button"]
    Floating_Star -->|点击激活| AI_Window["3. 轻量悬浮窗 [GETSSH AI CENTER / 你好]"]
    AI_Window -->|用户输入 Prompt / 发送| LLM_Stream["4. 流式大模型生成 BYOK API"]
    LLM_Stream -->|流式返回代码块| Output_Block["5. 修复指令代码块"]
    Output_Block -->|附带| Paper_Plane["6. 纸飞机按钮 Airplane Button"]
    Paper_Plane -->|点击执行| Typewriter_Fill["7. 模拟打字机无损回填光标处"]
    Typewriter_Fill -->|绝对不附加 \r \n| Wait_User["8. 等待用户核对并按下回车执行"]
```

* **交互实现细节**：
  * **小星星悬浮唤醒**：在 React 主容器层监听鼠标事件。当检测到在终端空白输入区域的双击，且当前无文本选区时，在事件坐标 `(clientX, clientY)` 就近渲染绝对定位的“小星星” SVG 按钮。
  * **悬浮窗状态机**：小星星点击后切换 `activePane` 状态，弹出一个 `Modal-less` 浮动框，抬头显示 `[GETSSH AI CENTER / 你好，有什么可以帮到你的]`，自动聚焦输入框。
  * **纸飞机安全防线（Command Injection Prevention）**：大模型生成 Shell 代码块时，UI 渲染“小纸飞机”图标按钮。点击纸飞机时，前端调用 `xterm.write(command)` 或通过 IPC 仅填充至终端的 input buffer，**绝对禁止在命令末尾自动附加 `\r` 或 `\n` 执行符**。必须将最终的回车（Enter）执行权严格交由用户在核对指令无误后手动触发。

#### 3.6.2 【现场缉凶】划选报错流（双击捕获与上下文注入）
当终端执行出现异常（如 Python Traceback、编译报错、缺失依赖等）时，用户可以直接划选报错并快速寻求 AI 解决方案。

* **划选报错交互机制**：
  * **鼠标双击唤醒**：基于 `xterm.js` 的 `Selection` 事件，当监听到鼠标在有文字选区的情况下双击时，立即捕获当前的划选文本（Selected Text）。
  * **上下文一键注入**：在捕获选区的就近位置唤醒 AI CENTER 输入框，并在输入框的正上方动态渲染一个 `[ 📋 粘贴所选文本 ]` 的胶囊按钮（Capsule Button）。点击该胶囊按钮后，前端一键将划选的报错内容作为 Markdown 引用块（如 ` ```stderr ... ``` `）无损注入至 prompt 输入框末尾。
  * **输出修复与回填**：AI 针对注入的错误上下文进行分析，诊断出错误原因，并在输出的修复命令旁同样提供“小纸飞机”回填按钮，供用户将修复命令快速填入当前终端。

#### 3.6.3 数据隔离与安全闭环的融合
* **BYOK 凭证隔离**：工作区的 AI 大模型请求使用 **BYOK (Bring Your Own Key)** 机制。API Key 和接口 Endpoint 全部加密存储于对应工作区的 `vault.key` 所守护的主机凭证库中。AI 会话请求通过主进程中绑定了当前工作区密钥上下文的 Proxy 进行请求发送，实现全链路零信任，隔离不同工作区的密钥暴露范围。
* **状态联动原子销毁**：在 Zustand 的 `switchWorkspace` 生命周期内，前端将自动发送 `clear-ai-history` 信号至主进程和 React Store，对当前内存中的大模型会话历史（Chat Context Window）进行一键零物理残留擦除，并随工作区重载，重新连接指向目标工作区专属 `ai_context/lancedb/` 和历史记忆数据库，防止公司敏感项目日志在 AI 联想历史中泄漏给个人环境。

### 3.7 AI 中间人安全网关 (AI CENTER Proxy Gateway)
为了保证开放插件生态下的系统高安全性，工作区 2.0 增设了 **AI 中间人安全网关 (AI CENTER Proxy Gateway)** 机制，构建了由核心内嵌层集中控盘的安全屏障。

#### 3.7.1 主进程特权通道唯一性限制
主进程中所有涉及终端交互读取（PTY Stream 监控）、凭据解密（`vault.key` 派生）以及直连大模型 API 发送的特权 IPC 接口（如 `ai-privileged-invoke`）被施加了强硬的来源校验策略：
* **发送端身份校验 (Origin Verification)**：主进程在处理特权 AI 接口时，通过 `event.sender` 校验其 WebContents 来源，只允许 GETSSH 内置的 AI CENTER 主渲染容器发起请求。
* **插件 FFI 与 IPC 物理阻断**：运行在受限沙箱（VM）或 iframe 隔离环境下的第三方插件，无法通过普通的 IPC 通信绕过安全网关。第三方插件没有任何可能直接获取主进程中解密出的 API 凭证或原始 PTY 流。

#### 3.7.2 四级联动数据传导链条 (The Sentinel Pipeline)
当任何第三方 AI 插件需要实现智能化辅助功能时，必须严格经过 AI CENTER 的 Sentinel 数据流水线进行多级清洗和转发：

```mermaid
graph LR
    Plugin["1. 第三方插件 [pluginId]"] -->|ctx.ai.chat| SDK["2. AI CENTER SDK [ctx.ai]"]
    SDK -->|过滤与脱敏校验| Gateway["3. AI CENTER 安全网关代理层"]
    Gateway -->|加密 IPC 请求| MainLLM["4. 主进程大模型 SDK / BYOK 直连"]
```

1. **【第三方插件】**：调用受限沙盒上下文提供的 `ctx.ai.chat(prompt, context)`。
2. **【AI CENTER SDK】**：插件 SDK 接口，对输入数据包进行标准化，注入插件唯一的 `pluginId` 标识。
3. **【AI CENTER 核心安全代理层】**：前端统一大模型代理，触发本地算法库执行参数安全性验证，检测输入输出，过滤敏感数据（敏感词打码、上下文脱敏），确保不发生缓冲区溢出和命令注入。
4. **【主进程 AI SDK / 用户 BYOK 密钥直连】**：由主网关将请求加密发至主进程，由主进程解密工作区专属的 BYOK 密钥直接与云端大模型安全通信，回传流式响应。

#### 3.7.3 统一安全洗涤机制 (Centralized Sanitization)
所有经由插件发起的 AI 请求，在进入 AI CENTER 代理层时，将强制执行本地的启发式过滤检测（Centralized Sanitization Check）：
* **高危敏感词/凭据打码 (Credentials Redaction)**：
  对常见敏感格式（如 `-----BEGIN OPENSSH PRIVATE KEY-----`、S3 密钥、Kubernetes Tokens、数据库明文密码连接串等）进行正则及启发式熵值分析。一旦发现匹配项，AI CENTER 将在向云端 LLM 发送前强制将其替换为占位符（如 `[REDACTED_SSH_KEY]`），洗涤过程在沙盒外侧代理层强制完成，插件层无权修改或绕过。
* **终端上下文脱敏 (Context Desensitization)**：
  如果插件请求读取终端 buffer 作为上下文（如进行故障排查），网关层会自动剔除包含敏感主机名、IP 地址及数据库用户名等机密信息，进行掩码化（Masking）处理，保障全域数据零信任闭环。

### 3.8 RASP 机制与安全护盾优化 (RASP & Security Shield Optimization)
为了防止过度激进的安全拦截机制误杀用户自写的本地调试插件，工作区 2.0 舍弃了复杂的硬性启发式匹配，建立了一套**分级信任、内省放行、控制权归还**的扁平 RASP 判定模型：

#### 3.8.1 插件信任源分级与 UUID 授权 (Trust-Level & UUID Authorization)
RASP 监控机制严格执行基于 UUID 的信任白名单分级，彻底摒弃基于文件路径或作者签名的模糊验证模型：
* **`[LOCAL_BYOK_TRUST]` 信任级**：
  - **判定条件**：必须在全局配置 `app-config.json` 中引入 `trusted_plugin_uuids: string[]` 数组。只有当插件的专属 UUID 被物理操作员（用户）在 UI 界面中显式勾选、确认风险并成功加入该白名单数组，且调用用户专属的 **BYOK (Bring Your Own Key)** 大模型密钥时，该插件才被标记为 `[LOCAL_BYOK_TRUST]`。
  - **安全原则**：系统认定此类插件已获得用户显式物理授权，对其终端层的自动化运维操作给予最大程度的自由，不进行强行拦截。**系统严禁使用文件存储路径或作者元数据作为信任判断依据**，以防路径伪造或包名劫持攻击。
* **`[SANDBOX_SANDBOXED]` 普通级**：
  - 判定条件：从第三方市场下载、保存在应用共享插件目录下的受限插件。
  - 安全原则：受到最严密的安全网关和隔离容器监管。

#### 3.8.2 RASP 黄色警报行为重构 (Yellow Alert Refinement)
彻底废除了传统 RASP 针对高危 shell 指令（如 `rm -rf`、`chmod 777`、`mkfs` 等）的硬性静默熔断拦截，改用**内省放行模式 (Self-Inspection Pass-through Mode)**，防止造成糟糕的“误伤正规调试脚本”体验：
* **放行规则**：当带有 `[LOCAL_BYOK_TRUST]` 标记的插件通过 AI CENTER 发起请求并产生包含高危运维命令的代码块时，AI CENTER 网关层在技术链路上允许该指令全量通过。
* **前端内省警示**：前端界面会接管该响应，并以温和且高保真的毛玻璃卡片（UI Alert Card）向用户展示拟执行的高危命令详情与危害说明，提供给用户安全知情与二次确认权，而不是直接抛出主进程崩溃报错。

#### 3.8.3 最终控制权交回终端 (Airplane Filling Principle)
所有高危指令在经由用户确认通过后，均**绝对遵守“小纸飞机”填充原则**进行安全下发：
* 网关与前端会将指令像打字机一样打印进当前的活动终端光标输入区。
* 在回填数据的末尾，**严格静止附加任何 `\r`（回车）或 `\n`（换行）字符**。
* 指令仅被作为输入缓冲挂起在终端光标后，**最终的执行生杀大权（Enter 确认键）100% 留给物理操作员（用户本人）**。用户可在此阶段进行最后的肉眼核对、修改或撤销。

#### 3.8.4 RASP 红色预警死守 (Red Alert Lockdown)
对于威胁到宿主核心和敏感机密数据的操作（主进程与内存空间），系统设立不可逾越的红色熔断防线，即使插件具备 `LOCAL_BYOK_TRUST` 标记也绝不通融：
1. 尝试越权读取、提取或猜测其他工作区物理目录下的凭据密钥 `vault.key` 文件。
2. 尝试篡改 Electron 运行时内存，或拦截/劫持核心主进程 IPC 消息路由。
3. 尝试发起系统级沙箱逃逸（如绕过 `safeRequire` 探测主进程 node 原生模块）。
一旦监测到红色警戒事件，系统在 FFI 侧直接执行强硬熔断，瞬间（$<$ 1ms）吊销该插件的 API 调用令牌，关闭对应的沙箱运行时，并强行将其进程踢出，保障宿主系统的底层安全底线。

#### 3.8.5 安装期唯一标识注入机制 (Installation-Time UUID Injection)
为从源头上阻断恶意插件通过重名欺骗（Name Spoofing）绕过 RASP 安全检查，工作区 2.0 强制引入了安装期唯一标识注入机制：
* **动态 UUID 绑定**：在用户首次导入本地开发插件或未来从应用市场下载安装插件时，`PluginManager` 主进程会强制拦截安装流，为其动态生成一个加密安全的唯一标识符（Plugin UUID）。
* **双向注册锁定**：
  1. **主配置锁定**：将该 UUID 永久写入全局配置 `app-config.json` 中的 `installed_plugins` 总表，作为 RASP 信任区（Trust Zone）的映射源。
  2. **运行时上下文注入**：在插件启动并装载沙盒（VM）时，主进程将此专属 UUID 强制注入该插件在运行时的 Context 上下文中（如绑定在全局变量 `__GETSSH_PLUGIN_UUID__`），使插件内的任何数据请求均强制携带此标识。
* **杜绝欺骗攻击**：RASP 探针在进行白名单拦截或权限提升（如黄色预警豁免）核对时，一律忽略插件自带的 `package.json` 中的名称（`name`）、作者名（`author`）等声明，只认主进程在安装期物理绑定的专属 UUID，从而彻底杜绝第三方插件通过伪造系统级插件名称来越权获取信任豁免的风险。

---

## 4. Zustand 状态机切换生命周期 (switchWorkspace)

在渲染进程 `sessionStore` 与主进程之间，工作区的切换是一个**强一致性、阻塞式**的原子事务：

```typescript
// src/store/sessionStore.ts 扩充方法
async function switchWorkspace(targetWorkspaceId: string): Promise<boolean> {
  // 1. 设置 UI 挂起状态，激活屏幕磨砂毛玻璃毛玻璃遮罩 (Loading Overlay)
  setConnecting(true);
  setError(null);
  
  try {
    // 2. 批量中断当前工作区所有活动 SSH 信道、本地终端以及 SFTP 传输
    const currentTabs = get().tabs;
    const disconnectPromises = currentTabs.map(async (tab) => {
      if (tab.paneTree) {
        const sessionIds = collectSessionIds(tab.paneTree);
        return Promise.all(sessionIds.map(id => window.electronAPI.sshDisconnect(id)));
      }
    });
    await Promise.all(disconnectPromises);
    
    // 3. 通知主进程执行底层硬件、网络、数据库与安全凭据的物理重定向
    const mainSwitchResult = await window.electronAPI.performMainWorkspaceSwitch(targetWorkspaceId);
    if (!mainSwitchResult.success) {
      throw new Error(mainSwitchResult.error || '主进程工作区重定向失败');
    }
    
    // 4. 重置/清空内存中所有的会话与 AI 历史上下文记录
    // 物理隔离关键：强行调用主进程 IPC 接口，在底层彻底阻断并抹除上一个工作区的 RAG 记忆库与对话上下文内存残留
    await window.electronAPI.clearAiContext(targetWorkspaceId);
    set({
      tabs: [],
      activeTabId: null,
      activePaneId: null,
      selectedSessionIndex: null,
      connecting: false,
    });
    
    // 5. 重新拉取新工作区的资产列表
    const newSessions = await window.electronAPI.getSessionsForWorkspace(targetWorkspaceId);
    setSessions(newSessions);
    
    // 6. 重新拉取新工作区专属的主题配色与 UI 标识
    const workspaceMeta = await window.electronAPI.getWorkspaceMetadata(targetWorkspaceId);
    applyWorkspaceTheme(workspaceMeta.themeColor || '#0ea5e9');
    
    // 7. 同步并挂载新工作区的专属命令面板与 Runbooks 剧本
    await usePluginStore.getState().reloadWorkspaceRunbooks(targetWorkspaceId);
    
    return true;
  } catch (err: any) {
    setError(err.message || '切换工作区时发生未知错误');
    return false;
  } finally {
    setConnecting(false);
  }
}
```

---

## 5. 团队协作（Team Workspace）商业化演进

当工作区 2.0 接入云端或企业协同控制台时，将转化为多租户企业级工作流中心：

1. **零知识证明凭证分发 (Zero-Knowledge Credential Sharing)**：
   - 企业版中，私钥和敏感密码不通过云端明文同步。
   - 使用 ZKP 机制或企业本地 KMS（密钥管理系统），GETSSH 在与堡垒机握手时，通过工作区绑定的本地客户端安全生成会话临时密钥，避免管理员凭据在任何环节触网泄露。
2. **只读资产与动态下发 (Read-Only Policy Pull)**：
   - 团队工作区的配置文件（如 `profiles.json` 与 `network_proxy.json`）属于企业托管资产。
   - 客户端只能通过 SSE（Server-Sent Events）或 Webhook 在每次启动时从企业云端拉取更新并载入内存，本地禁止编辑、导出或解密密钥。
3. **安全审计云同步 (Compliance S3 Sync)**：
   - 本地 `audit_recordings/*.cast` 审计流文件生成后，在后台被强制、实时且只写（Write-Only）地推送到企业合规 S3 存储桶中，提供篡改防范检测，杜绝开发或运维人员删除本地审计日志规避追责的情况。
