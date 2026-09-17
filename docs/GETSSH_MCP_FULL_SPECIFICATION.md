# GETSSH 全功能 Anthropic MCP (Model Context Protocol) 架构与操作指南 📖

> **标准遵循**：Anthropic Model Context Protocol 2024-11-05 Specification  
> **目标**：打造业界首个同时具备 **全功能 MCP 客户端 (Host)** 与 **原生 MCP 基础设施服务端 (Native Server)** 的下一代极客终端。

---

## 🏛️ 整体全景架构图 (Architecture Overview)

```
                                      ┌───────────────────────────────────────────────────────────┐
                                      │            外部开发环境 (External AI Clients)              │
                                      │    - Claude Desktop / Cursor / Antigravity IDE / VSCode   │
                                      └─────────────────────────────┬─────────────────────────────┘
                                                                    │ Stdio / SSE (JSON-RPC 2.0)
                                                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                                 GETSSH 核心系统                                                         │
│                                                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐   │
│   │ [模块 C] GETSSH Native MCP Server (基础设施服务暴露层)                                                            │   │
│   │  ● Resources: `getssh://sessions`, `getssh://terminal/{id}/buffer`, `getssh://audit/logs`                       │   │
│   │  ● Tools: `getssh_exec_command`, `getssh_list_sessions`, `getssh_sftp_transfer`, `getssh_runbook_execute`       │   │
│   │  ● Prompts: `/getssh-harden-ssh`, `/getssh-diagnose-network`                                                   │   │
│   └───────────────────────────────────────────────────────┬─────────────────────────────────────────────────────────┘   │
│                                                           │ 内部总线                                                    │
│                                                           ▼                                                             │
│   ┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐   │
│   │ GETSSH 智能微内核总线 (Microkernel AI & Agent Engine)                                                            │   │
│   │  ● ReAct 调度循环 (AgentEngine)                 ● 零信任安全哨兵 (SecureCenter / RASP)                           │   │
│   │  ● 全局工具注册表 (ToolRegistry)                ● 统一提示词装配器 (MicroContextAssembler)                     │   │
│   └───────────────┬───────────────────────────────────────┬───────────────────────────────────────┬─────────────────┘   │
│                   │                                       │                                       │                     │
│                   ▼                                       ▼                                       ▼                     │
│   ┌───────────────────────────────┐       ┌───────────────────────────────┐       ┌───────────────────────────────┐     │
│   │ [模块 A1] MCP Resources 总线  │       │ [模块 A2] MCP Prompts 引擎    │       │ [模块 B] Sampling 反向推理    │     │
│   │  ● `resources/list & read`    │       │  ● `prompts/list & get`       │       │  ● `sampling/createMessage`   │     │
│   │  ● `@` 前端快速引用选择器     │       │  ● `/` 前端 Slash 工作流选择  │       │  ● 外部插件免 Key 借用宿主算力│     │
│   │  ● 动态长连接订阅 (Subscribe) │       │  ● 带参交互表单动态填充       │       │  ● RASP 安全审计与额度防护    │     │
│   └───────────────┬───────────────┘       └───────────────┬───────────────┘       └───────────────┬───────────────┘     │
│                   │                                       │                                       │                     │
└───────────────────┼───────────────────────────────────────┼───────────────────────────────────────┼─────────────────────┘
                    │                                       │                                       │
                    ▼                                       ▼                                       ▼
        ┌───────────────────────────────────────────────────────────────────────────────────────────────┐
        │                                外部 MCP 服务生态 (External Ecosystem)                         │
        │   - @modelcontextprotocol/server-memory          - @modelcontextprotocol/server-filesystem    │
        │   - @modelcontextprotocol/server-postgres        - @modelcontextprotocol/server-git           │
        │   - Kubernetes / Docker / AWS MCP Servers        - Enterprise Private Knowledge MCP           │
        └───────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 📦 模块 A：Resources（数据资源）与 Prompts（工作流模板）

### 1. 技术规范与实现机制
* **Resources (数据资源 `resources/*`)**：
  - MCP Client 在握手后拉取所有在线服务的资源清单 (`resources/list`)。
  - 支持通过 URI 模式（如 `postgres://prod_db/schema`、`k8s://cluster/pods`、`file:///var/log/syslog`）执行 `resources/read`。
  - 前端输入框输入 `@` 时触发 **Resource QuickPicker**，用户可一键将远程资源以 Markdown 格式直接挂载至 AI 对话上下文。
* **Prompts (工作流模板 `prompts/*`)**：
  - MCP Client 自动汇聚各服务的提示词模板 (`prompts/list`)。
  - 前端输入框输入 `/` 时触发 **Prompt Slash Command Picker**，若模板包含参数（如 `cluster_name`、`pod_id`），弹出轻量级表单供用户填入，自动执行 `prompts/get` 并注入会话。

### 2. 交互流转时序 (Sequence)
```
用户输入 '@' / '/' ──> 触发 ContextPicker ──> 请求 McpManager.getResources() / getPrompts()
                           │
                           ├── 选中资源 ──> McpClient.readResource(uri) ──> 自动挂载上下文卡片
                           └── 选中指令 ──> 填写参数 ──> McpClient.getPrompt(...) ──> 填入输入框
```

---

## ⚡ 模块 B：Sampling 反向大模型推理引擎

### 1. 为什么需要 Sampling？
在传统架构中，如果第三方 MCP 插件（例如代码重构服务、日志智能聚类服务）需要调用大模型，插件必须要求用户再次输入 OpenAI/Claude API Key，这存在严重的**凭据泄露风险**与**繁琐的重复配置**。

MCP **Sampling (`sampling/createMessage`)** 允许 MCP Server 向 GETSSH 反向发送推理请求，直接复用 GETSSH 已绑定的 AI 算力！

### 2. 安全与零信任防护 (RASP Gating)
```
外部 MCP Server ──[ JSON-RPC: sampling/createMessage ]──> GETSSH McpSamplingBridge
                                                                 │
                                                    ┌────────────┴────────────┐
                                                    │ RASP 安全与反欺诈过滤   │
                                                    │ - 敏感词/凭据泄露检测    │
                                                    │ - Token 速率与额度限制   │
                                                    └────────────┬────────────┘
                                                                 │ 校验通过
                                                                 ▼
                                                    GETSSH LlmService 执行推理
                                                                 │
                                                                 ▼
                                                    返回 Response 给 MCP Server
```

---

## 🚀 模块 C：GETSSH 作为原生 MCP Server (双向暴露)

### 1. 暴露给外部的能力清单

| 类型 | 名称 / URI | 描述 |
|---|---|---|
| **Tool** | `getssh_exec_command` | 在指定已连接会话中执行终端命令，捕获实时输出 |
| **Tool** | `getssh_list_sessions` | 查询当前工作区保存的所有 SSH 服务器与在线状态 |
| **Tool** | `getssh_sftp_read_file` | 通过 SFTP 极速读取远程服务器上的配置文件 |
| **Tool** | `getssh_sftp_write_file`| 通过 SFTP 安全写入/更新远程文件 |
| **Tool** | `getssh_trigger_runbook`| 触发执行预设的自动化运维剧本 |
| **Resource** | `getssh://sessions` | 当前工作区所有服务器的连接元数据 (JSON) |
| **Resource** | `getssh://terminal/{id}/buffer` | 指定终端窗格的最后 500 行实时输出缓冲 |
| **Resource** | `getssh://audit/latest` | 最近触发的安全防护与审计拦截日志 |
| **Prompt** | `/getssh-harden-ssh` | 生产级 Linux SSH 安全基线合规检查与加固工作流 |
| **Prompt** | `/getssh-diagnose-network`| 网络链路、丢包率与端口连通性全方位排障工作流 |

### 2. 外部 AI 宿主一键接入配置示例

#### 接入 Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "getssh": {
      "command": "/Applications/GETSSH.app/Contents/MacOS/GETSSH",
      "args": ["--mcp-server"]
    }
  }
}
```

#### 接入 Cursor / Antigravity IDE (`mcp_config.json`)
```json
{
  "mcpServers": {
    "getssh-daemon": {
      "type": "stdio",
      "command": "node",
      "args": ["/Users/username/.getssh/bin/mcp-server.js"]
    }
  }
}
```

---

## 🛠️ 分阶段落地实施路线图 (Implementation Roadmap)

```
   【阶段一：模块 A】──────────>【阶段二：模块 B】──────────>【阶段三：模块 C】──────────>【阶段四：全链路验收】
   Resources & Prompts          Sampling 逆向推理引擎        GETSSH Native Server         端到端实测与发布
   - 协议解析与清单聚合          - JSON-RPC 逆向路由          - Stdio/CLI 启动器           - Claude/Cursor 联动
   - 前端 @ / / 快捷弹出层       - RASP 凭据剥离与防护        - 核心运维 Tools 暴露        - 自动化回归测试
```

---

## 📋 详细代码与改造文件对照表

| 阶段 | 改造/新建文件 | 职责与变更说明 |
|---|---|---|
| **阶段 A** | [McpClient.ts](file:///Users/shenjiangchen/Documents/GETSSH/apps/getssh-client/electron/main/services/mcp/McpClient.ts) | 增加 `fetchResources()`, `readResource()`, `fetchPrompts()`, `getPrompt()` 协议方法 |
| **阶段 A** | [McpManager.ts](file:///Users/shenjiangchen/Documents/GETSSH/apps/getssh-client/electron/main/services/mcp/McpManager.ts) | 统一聚合管理全量 Resources 与 Prompts，提供增删改查通道 |
| **阶段 A** | [mcpHandler.ts](file:///Users/shenjiangchen/Documents/GETSSH/apps/getssh-client/electron/main/handlers/mcpHandler.ts) | 增加 `mcp:get-resources`, `mcp:read-resource`, `mcp:get-prompts`, `mcp:get-prompt` IPC 接口 |
| **阶段 A** | [CommandCenterAiChat.tsx](file:///Users/shenjiangchen/Documents/GETSSH/apps/getssh-client/src/components/command-center/CommandCenterAiChat.tsx) | 实现 `@` (资源挂载) 和 `/` (Prompt 工作流执行) 的沉浸式弹出选择框 |
| **阶段 B** | [McpSamplingBridge.ts](file:///Users/shenjiangchen/Documents/GETSSH/apps/getssh-client/electron/main/services/mcp/McpSamplingBridge.ts) *(NEW)* | 拦截 `sampling/createMessage` 请求，经 RASP 审计后接入 `LlmService` 推理并回传 |
| **阶段 C** | [GetSshMcpServer.ts](file:///Users/shenjiangchen/Documents/GETSSH/apps/getssh-client/electron/main/services/mcp/server/GetSshMcpServer.ts) *(NEW)* | 实现标准的 MCP Server 端，对外暴露 GETSSH 终端、SFTP、会话与剧本工具 |
| **阶段 C** | [mcpCliEntry.ts](file:///Users/shenjiangchen/Documents/GETSSH/apps/getssh-client/electron/main/services/mcp/server/mcpCliEntry.ts) *(NEW)* | 独立 CLI / IPC 入口，供外部（Cursor/Claude）通过命令行启动标准 Stdio Server |
| **阶段 C** | [McpTab.tsx](file:///Users/shenjiangchen/Documents/GETSSH/apps/getssh-client/src/components/ai-center/McpTab.tsx) | 增加“导出至 Cursor / Claude Desktop 一键配置”及 Resources / Prompts 在线查看器 |
