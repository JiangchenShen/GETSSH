# 御三家大模型接口适配规格

> 面向 GETSSH AI Agent 的适配层实现文档
> 覆盖 OpenAI / Anthropic / Google Gemini
> 核实日期：2026-08-31，全部字段取自各家官方文档实抓
> 国内五家（DeepSeek / GLM / Kimi / MiniMax / 千问）另出一册

---

## 0. 先读这一段

三家在过去一年里做了同一件事：**把 chat completions 那种「消息进、消息出」的形状废掉，换成「有类型的步骤序列 + 服务端可存状态」**。

| 厂商 | 新接口 | 旧接口现状 |
|---|---|---|
| OpenAI | **Responses API** `/v1/responses` | Chat Completions 仍支持，但 GPT-5.4 起**推理与工具调用不能并存** |
| Google | **Interactions API** `/v1beta/interactions` | `generateContent` 自 2026-06 起标记为 legacy |
| Anthropic | **Messages API** `/v1/messages` | 本来就是块结构，无需迁移 |

对适配层的含义：**不要再按 chat completions 的形状设计内部数据模型**。以「一次请求返回一个有序的、带类型的 item/step/block 列表」为内部表示，三家都能干净地映射进来；反过来用 `{role, content}` 做内部模型，三家的推理块、工具块、内置工具块都塞不进去。

### 三条会让适配器出错的共性规则

**一、推理态必须原样回传，一个字节都不能改。**

| 厂商 | 载体 | 规则 |
|---|---|---|
| OpenAI | `reasoning` item + `encrypted_content` | 有工具调用时，reasoning item 与 function_call 的**相对顺序**必须保持 |
| Anthropic | `thinking` / `redacted_thinking` 块 + `signature` | 同一个 tool-use turn 内必须完整、原序回传，否则 **400** |
| Gemini | `thought` step + `thought_signature` | 无状态模式下必须整段重发，不能拆分或与无签名的块合并 |

最典型的 bug：过滤时写 `if block.type == "thinking"`，静默丢掉 `redacted_thinking`；或者为了省 token 把历史轮的推理块裁掉。前者直接报错，后者是静默的质量下降。

**二、流式的工具入参一律是字符串碎片，而且聚合键各不相同。**

| 厂商 | 聚合键 | 增量字段 | 何时可以 parse |
|---|---|---|---|
| OpenAI Chat Completions | `tool_calls[].index` | `function.arguments` | `finish_reason == "tool_calls"` |
| OpenAI Responses | `item_id` | `delta`（`response.function_call_arguments.delta`） | 收到 `.done`，用其中的完整 `arguments` 覆盖 |
| Anthropic | content block `index` | `delta.partial_json` | 该 index 的 `content_block_stop` |
| Gemini Interactions | `step.index` | `delta.arguments`（`arguments_delta`） | 该 index 的 `step.stop` |

三家都一样：拼接过程中的中间态是非法 JSON，只能在收尾事件之后整体解析。并行工具调用时碎片会交错到达，必须用 map，不能假设顺序。

**三、采样参数在新模型上正在被收回。**

| 厂商 | `temperature` / `top_p` |
|---|---|
| Anthropic | **Opus 5 / Sonnet 5 / Fable 5 / Mythos 5 / Opus 4.7+ 上传非默认值一律 400**，与是否开思考无关 |
| OpenAI | 推理模型历史上硬拒；GPT-5.6 的文档未列支持表（见未核实清单） |
| Gemini | 仍正常支持 |

适配层的安全默认值：**这三个参数默认不下发**，只在用户显式配置且目标模型确认支持时才带上。

---

## 1. 三家速查对照表

### 1.1 传输层

| 项 | OpenAI | Anthropic | Gemini |
|---|---|---|---|
| Base URL | `https://api.openai.com/v1` | `https://api.anthropic.com` | `https://generativelanguage.googleapis.com/v1beta` |
| 主端点 | `POST /responses` | `POST /v1/messages` | `POST /interactions` |
| 旧端点 | `POST /chat/completions` | — | `POST /models/{model}:generateContent` |
| 鉴权 | `Authorization: Bearer <key>` | `x-api-key: <key>` | `x-goog-api-key: <key>` 或 `?key=` |
| 必需版本头 | 无（响应回传 `openai-version`） | **`anthropic-version: 2023-06-01`** | 无（版本在路径里） |
| Beta 开关 | 无统一机制 | `anthropic-beta: a,b,c` | 模型名带 `-preview` |
| 文档域名 | `developers.openai.com`（已从 platform 迁移） | `platform.claude.com`（已从 docs.anthropic 迁移） | `ai.google.dev` |

### 1.2 报文形状

| 项 | OpenAI Responses | Anthropic Messages | Gemini Interactions |
|---|---|---|---|
| 输入字段 | `input`（string 或 item 数组） | `messages`（数组，必填） | `input`（string / Content / Step 数组） |
| 系统指令 | 顶层 `instructions` | 顶层 `system` | 顶层 `system_instruction` |
| 输出长度 | `max_output_tokens` | **`max_tokens`（必填）** | `generation_config.max_output_tokens` |
| 输出容器 | `output[]`（item 数组） | `content[]`（block 数组） | `steps[]`（step 数组） |
| 会话延续 | `previous_response_id` | 自行回放 `messages` | `previous_interaction_id` |
| 服务端存储 | `store`（**默认 true**） | 无（无状态） | `store` |
| 用量字段 | `usage.input_tokens` / `output_tokens` | `usage.input_tokens` / `output_tokens` / `cache_*` | `usage.total_input_tokens` / `total_output_tokens` |

> ⚠️ **OpenAI 的 `store` 默认为 `true`**。BYOK 场景下用户的对话会留在 OpenAI 服务端，涉及数据留存合规。GETSSH 这种本地终端工具应当**显式下发 `store: false`**。

### 1.3 思考 / 推理

| 项 | OpenAI | Anthropic | Gemini |
|---|---|---|---|
| 开关字段 | `reasoning.effort` | `thinking.type` + `output_config.effort` | `generation_config.thinking_level` |
| 档位 | `none`/`low`/`medium`/`high`/`xhigh`/`max` | `low`/`medium`/`high`/`xhigh`/`max` | `minimal`/`low`/`medium`/`high` |
| 预算 token | 不暴露 | 仅 Opus 4.5 支持 `budget_tokens` | 2.5 系列用 `thinking_budget` |
| 摘要 | `reasoning.summary` | `thinking.display` | `include_thoughts` / `thinking_summaries` |
| 签名 | `encrypted_content` | `signature` | `thought_signature` |
| 可否关闭 | `effort: "none"` | 部分模型不可关 | 部分模型不可关 |

### 1.4 工具调用字段名对照

这张表直接决定适配层的转换函数怎么写。

| 概念 | OpenAI Responses | OpenAI Chat Completions | Anthropic | Gemini Interactions |
|---|---|---|---|---|
| 工具列表 | `tools[]` | `tools[]` | `tools[]` | `tools[]` |
| 工具名 | `name`（**扁平**） | `function.name`（**嵌套**） | `name` | `name` |
| 入参 schema | `parameters` | `function.parameters` | **`input_schema`** | `parameters` |
| 严格模式 | `strict: true` | `function.strict: true` | `strict: true` | `tool_choice: "validated"` |
| 调用出现在 | `output[]` 的 `function_call` item | `choices[].message.tool_calls[]` | `content[]` 的 `tool_use` 块 | `steps[]` 的 `function_call` step |
| 调用 ID | **`call_id`**（不是 `id`） | `id` | `id` | `id` |
| 结果回传 | `function_call_output` item | `role:"tool"` message | `tool_result` 块 | `function_result` step |
| 结果关联键 | `call_id` | `tool_call_id` | `tool_use_id` | `call_id` |
| 强制调用 | `tool_choice: "required"` | 同左 | `tool_choice: {"type":"any"}` | `tool_choice: "any"` |
| 禁并行 | `parallel_tool_calls: false` | 同左 | `tool_choice.disable_parallel_tool_use` | ⚠️ 未核实 |

> **OpenAI Responses 的坑**：`function_call` item 上同时有 `id`（`fc_...`，item 身份）和 `call_id`（`call_...`，配对键）。回传结果**必须用 `call_id`**。用错了不报错，模型只是看不到结果。

### 1.5 流式终止信号

| 厂商 | 终止方式 | 是否发 `[DONE]` |
|---|---|---|
| OpenAI Responses | `response.completed` / `.incomplete` / `.failed` / `error` | ⚠️ 官方说不发，第三方规范说发。**两者都兼容** |
| OpenAI Chat Completions | `finish_reason` + `data: [DONE]` | **发** |
| Anthropic | `message_stop` | **不发**（2023-06-01 版本明确移除） |
| Gemini Interactions | `interaction.completed` 后跟 `event: done` / `data: [DONE]` | **发** |

统一规则：**以语义化的终止事件为准，`[DONE]` 只当作可选的收尾哨兵**。连接在收到终止事件前断开，一律按可重试失败处理，不要当作正常结束。

### 1.6 错误与重试

| HTTP | OpenAI `error.type` | Anthropic `error.type` | Gemini `error.code` | 可重试 |
|---|---|---|---|---|
| 400 | `invalid_request_error` | `invalid_request_error` | `invalid_request` / `failed_precondition` | ❌ |
| 401 | `authentication_error` | `authentication_error` | `authentication` | ❌ |
| 402 | — | **`billing_error`** | — | ❌ |
| 403 | `permission_error` | `permission_error` | `permission_denied` | ❌ |
| 404 | `not_found_error` | `not_found_error` | `not_found` | ❌ |
| 409 | `conflict_error` | `conflict_error` | — | 视情况 |
| 413 | — | `request_too_large` | — | ❌ |
| 416 | — | — | `out_of_range` | ❌ |
| 429 | `rate_limit_error` | `rate_limit_error` | `rate_limit_exceeded` / `quota_exceeded` | ✅ **但要分辨欠费** |
| 500 | `internal_server_error` | `api_error` | — | ✅ |
| 503 | `service_unavailable_error` | — | `service_unavailable` | ✅ |
| 504 | — | `timeout_error` | — | ✅ |
| 529 | — | `overloaded_error` | — | ✅ |

**429 必须二次判别**，否则会陷入无效重试风暴：

- OpenAI：靠 `error.code` 区分限速与 `insufficient_quota`
- Anthropic：`error.details.error_code == "enforced_spend_limit_reached"` 表示花费上限，**不带 `retry-after`，重试无意义**
- Gemini：`rate_limit_exceeded` 可重试，`quota_exceeded` 是日配额耗尽，要等重置

---

## 2. OpenAI

### 2.1 端点与头

```
POST https://api.openai.com/v1/responses
Authorization: Bearer $OPENAI_API_KEY
Content-Type: application/json
OpenAI-Organization: $ORG_ID     # 可选
OpenAI-Project: $PROJECT_ID      # 可选
```

REST 版本固定为 `2020-10-01`，只在响应头 `openai-version` 回传，请求不需要带。除标准 API key 外现在也接受 workload identity federation 签发的短期 token，同样走 Bearer。

### 2.2 模型（2026-08）

GPT-5.6 改用代号分层，不再是 mini / nano 后缀。

| Model ID | 定位 | 推理 | 上下文 | 最大输出 | in / cached / out（$/1M） |
|---|---|---|---|---|---|
| `gpt-5.6-sol`（别名 `gpt-5.6`） | 旗舰 | 是 | 1,050,000 | 128,000 | 4.00 / 0.40 / 20.00 |
| `gpt-5.6-terra` | 均衡 | 是 | 1,050,000 | 128,000 | 2.00 / 0.20 / 12.00 |
| `gpt-5.6-luna` | 低成本 | 是 | 1,050,000 | 128,000 | 0.20 / 0.02 / 1.20 |
| `gpt-5.6-cyber` | 漏洞研究专用 | 是 | ⚠️ 未核实 | ⚠️ 未核实 | ⚠️ 未核实 |

知识截止 2026-02-16。输入 text + image，输出仅 text。

**成本模型里最容易算错的一条**：input 超过 272K token 的请求，**整个请求**按 2× input、1.5× output 计价，不是只对超出部分加价。

`reasoning.effort` 取值：`none` / `low` / `medium`（默认）/ `high` / `xhigh` / `max`。`xhigh` 和 `max` 是新增档位，GPT-5 时代的 `minimal` 已不在此列。

其余在线模型族：`gpt-image-2`、`gpt-realtime-2.1`、`gpt-transcribe`、`gpt-oss-120b/20b`、`text-embedding-3-*`。

### 2.3 请求

```json
{
  "model": "gpt-5.6-terra",
  "instructions": "你是 GETSSH 内置的运维助手。所有写操作必须先请求确认。",
  "input": [
    { "role": "user", "content": "web-01 的 nginx 起不来，看一下" }
  ],
  "max_output_tokens": 32000,
  "reasoning": { "effort": "high", "summary": "auto", "context": "all_turns" },
  "text": { "verbosity": "low" },
  "tools": [
    {
      "type": "function",
      "name": "run_command",
      "description": "在指定主机上执行只读命令并返回 stdout。",
      "parameters": {
        "type": "object",
        "properties": {
          "host":    { "type": "string" },
          "command": { "type": "string" }
        },
        "required": ["host", "command"],
        "additionalProperties": false
      },
      "strict": true
    }
  ],
  "tool_choice": "auto",
  "parallel_tool_calls": true,
  "store": false,
  "include": ["reasoning.encrypted_content"],
  "prompt_cache_key": "getssh_ops_v1:user_42",
  "stream": true
}
```

字段全表：

| 字段 | 说明 |
|---|---|
| `model` | 必填 |
| `input` | string 等价于单条 user 文本；数组则是 item 列表（`message` / `function_call` / `function_call_output` / `reasoning`） |
| `instructions` | 顶层系统指令，取代 CC 的 `role:"system"` |
| `max_output_tokens` | **上限包含不可见的 reasoning token** |
| `reasoning` | `{ effort, summary, context }`，`context` ∈ `auto` / `current_turn` / `all_turns` |
| `text` | `{ format, verbosity }`，`verbosity` ∈ `low`/`medium`/`high` |
| `tools` / `tool_choice` / `parallel_tool_calls` | 见 2.6 |
| `store` | **默认 true** |
| `previous_response_id` | 多轮串联，自动带上前轮 reasoning |
| `include` | 额外返回内容，见下 |
| `prompt_cache_key` | 缓存路由键 |
| `prompt_cache_options` | `{ ttl, mode }`，GPT-5.6+ |
| `conversation` | 绑定 Conversations API 会话（新增） |
| `context_management` | 自动压缩配置（新增） |
| `service_tier` | ⚠️ 枚举值未核实 |
| `background` | 后台异步执行 |
| `safety_identifier` | 终端用户标识 |
| `metadata` | 自定义 KV |

`include` 合法取值：`file_search_call.results`、`web_search_call.results`、`web_search_call.action.sources`、`message.input_image.image_url`、`computer_call_output.output.image_url`、`code_interpreter_call.outputs`、`reasoning.encrypted_content`、`message.output_text.logprobs`。

### 2.4 响应

```json
{
  "id": "resp_6820f382ee1c8191bc096bee70894d04",
  "object": "response",
  "status": "completed",
  "model": "gpt-5.6-terra",
  "incomplete_details": null,
  "error": null,
  "output": [
    { "id": "rs_...", "type": "reasoning",
      "summary": [{ "type": "summary_text", "text": "先看服务状态" }],
      "encrypted_content": "gAAAAAB..." },
    { "id": "fc_...", "type": "function_call",
      "call_id": "call_Mx6pyTjCkSkmASETsVASogoC",
      "name": "run_command",
      "arguments": "{\"host\":\"web-01\",\"command\":\"systemctl status nginx\"}",
      "status": "completed" },
    { "id": "msg_...", "type": "message", "role": "assistant", "status": "completed",
      "content": [{ "type": "output_text", "text": "…", "annotations": [] }] }
  ],
  "usage": {
    "input_tokens": 136,
    "input_tokens_details": { "cached_tokens": 0 },
    "output_tokens": 89,
    "output_tokens_details": { "reasoning_tokens": 64 },
    "total_tokens": 225
  }
}
```

`output` 的 item type：`message` / `reasoning` / `function_call` / `web_search_call` / `file_search_call` / `code_interpreter_call` / `image_generation_call` / `computer_call` / `mcp_call` / `shell_call` / `apply_patch_call`。

`status` ∈ `completed` / `in_progress` / `incomplete` / `failed` / `queued`。

**两个必须处理的边界**：

1. `output_text` 是 **SDK 侧的便利属性**，HTTP 原始响应里没有这个字段。自研适配器必须自己遍历 `output`，收集所有 `message.content[].output_text.text` 再拼接。
2. 推理模型可能在**没产出任何可见文本之前**就 `incomplete`。此时 token 已经计费，`output` 里只有 reasoning item。适配层要有「花了钱但没有输出」这条分支，不能把它当成空响应静默吞掉。

### 2.5 流式

Responses 用语义化事件，`event:` 行带类型名。

生命周期事件，payload 都是 `{ type, response, sequence_number }`：

```
response.queued
response.created
response.in_progress
response.completed      ← 终止
response.incomplete     ← 终止
response.failed         ← 终止
error                   ← 终止
```

内容与工具事件：

```
response.output_item.added / .done
response.content_part.added / .done
response.output_text.delta / .done
response.refusal.delta / .done
response.function_call_arguments.delta / .done
response.reasoning_text.delta / .done
response.reasoning_summary_part.added / .done
response.reasoning_summary_text.delta / .done
response.web_search_call.in_progress / .searching / .completed
response.code_interpreter_call.in_progress / .interpreting / .completed
response.mcp_call.in_progress / .completed / .failed
response.image_generation_call.partial_image / .completed
```

样例：

```
event: response.output_text.delta
data: {"type":"response.output_text.delta","sequence_number":12,"item_id":"msg_682462","output_index":2,"content_index":0,"delta":"东京","logprobs":[],"obfuscation":"XmK9dQ"}

event: response.function_call_arguments.delta
data: {"type":"response.function_call_arguments.delta","sequence_number":7,"item_id":"fc_6824621b","output_index":1,"delta":"{\"loc"}
```

实现要点：

- `sequence_number` 单调递增，用来做乱序检测和断流补偿，**不要拿它当数组下标**
- `obfuscation` 是随机填充串，用于抵御按 SSE 报文长度做的侧信道分析，**解析时直接忽略**
- 文本按 `(item_id, content_index)` 分桶累积；函数参数按 `item_id` 分桶累积，最后**用 `.done` 事件里的完整 `arguments` 覆盖**自己拼的结果，不要信任累积值

#### Chat Completions 的工具分片（兼容旧端点时必须处理）

```
data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"get_weather","arguments":""}}]}}]}
data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"loc"}}]}}]}
data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ation\":\"Tokyo\"}"}}]}}]}
data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"call_def","type":"function","function":{"name":"get_fx","arguments":""}}]}}]}
data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}
data: [DONE]
```

规则：
1. 聚合键是 `tool_calls[].index`，**不是数组位置，也不是 `id`**
2. `id`、`type`、`function.name` 只在该 index 的**首个分片**出现，存下来之后不要被后续的 null 覆盖
3. `function.arguments` 逐片 `+=`，流结束后整体 parse
4. 多工具并行时分片会交错到达
5. `usage` 需要 `stream_options: {"include_usage": true}`，出现在最后一块（该块 `choices` 可能是空数组）

### 2.6 工具

Responses 是扁平结构，Chat Completions 是嵌套结构，适配层需要双向转换：

```json
// Responses
{ "type": "function", "name": "f", "description": "...", "parameters": {...}, "strict": true }

// Chat Completions
{ "type": "function", "function": { "name": "f", "description": "...", "parameters": {...}, "strict": true } }
```

结构化输出同构：Responses 用扁平的 `text.format = {type, name, strict, schema}`，Chat Completions 多包一层 `response_format.json_schema`。

`strict` 模式的 schema 约束：
- 每个 object 必须 `"additionalProperties": false`
- **所有** property 都要进 `required`，可选字段用 union 模拟（`"type": ["string","null"]`）
- 每个 property 必须有 `type`
- 支持 `enum` 和 `"$ref": "#"` 自引用

结果回传：

```json
{ "type": "function_call_output", "call_id": "call_...", "output": "{\"exit_code\":0}" }
```

内置工具：`web_search`、`file_search`、`mcp`、`code_interpreter`、`image_generation`、`computer_use`、`shell`、`apply_patch`、`skills`、`tool_search`（仅 5.4+）、`custom`（支持 Lark / Regex 语法约束，不支持并行调用）。

### 2.7 推理模型的硬约束

**token 上限参数三态**，适配层必须按 surface 分支：

| 场景 | 字段 |
|---|---|
| Responses API | `max_output_tokens` |
| Chat Completions + 推理模型 | `max_completion_tokens` |
| Chat Completions + 旧非推理模型 | `max_tokens` |

额度**包含不可见的 reasoning token**，官方建议至少预留 25,000。

**跨轮携带推理**三条路径：
1. `previous_response_id`（需 `store: true`）
2. 手动回放完整 `output` 历史，含 reasoning item 与 `encrypted_content`（无状态场景走这条）
3. `reasoning.context`：`auto` / `current_turn` / `all_turns`，GPT-5.6 默认 `all_turns`

GPT-5.6 起，`store: false` 时 reasoning item **默认就带 `encrypted_content`**，旧的 `include: ["reasoning.encrypted_content"]` 仍被接受但不再必需。

`reasoning.summary` ∈ `auto` / `concise` / `detailed`，⚠️ 该功能需要先完成 organization verification。

### 2.8 缓存 / 限流

| 项 | GPT-5.6+ | 更早模型 |
|---|---|---|
| 最小可缓存前缀 | **1,024** token | 2,048 |
| TTL | 30 分钟，`prompt_cache_options.ttl` 可配 | `prompt_cache_retention`：`in_memory` 或 `24h` |
| 缓存写入 | **1.25×** 输入价 | 不额外计费 |
| 缓存读取 | **0.1×** | 0.1× |

缓存是**整段前缀完全一致**才命中。静态内容（instructions、工具定义）放最前，动态内容放后面。OpenAI 没有 `cache_control` 字段，那是 Anthropic 的概念；GPT-5.6+ 提供 `prompt_cache_options.mode` = `implicit` / `explicit` 配合 `prompt_cache_breakpoint`。

限流响应头：

```
Retry-After: 56
x-ratelimit-limit-requests / -remaining-requests / -reset-requests
x-ratelimit-limit-tokens   / -remaining-tokens   / -reset-tokens
x-ratelimit-limit-project-tokens / -remaining-project-tokens / -reset-project-tokens
```

`reset-*` 是**带单位的时长字符串**（`1s`、`6m0s`），不是 Unix 时间戳，要专门解析。project 级和 org 级配额相互独立，两套都得监控。

### 2.9 2026-08 的迁移红线

**🔴 Assistants API 已于 2026-08-26 关停。** 任何还在打 `/v1/assistants`、`/v1/threads` 的代码现在已经在报错。迁移目标是 Responses API + Conversations API。

**🔴 GPT-5.4 起，Chat Completions 上「推理 + 工具调用」不能共存。** 官方原文：Chat Completions *"does not support tool calling with `reasoning_effort` values other than `none`"*。也就是说在 CC 上想用工具，`reasoning_effort` 必须是 `none`。**要两者兼得只能走 Responses API，没有替代方案。** 这条应当写成适配层的硬性路由规则。

弃用日程：

| 日期 | 内容 |
|---|---|
| 2026-08-26 | Assistants API 关停（**已发生**） |
| 2026-10-23 | `gpt-3.5-turbo-0125`、`gpt-4-0613`、`gpt-4-turbo`、`o1-2024-12-17` 等 |
| 2026-12-11 | `gpt-5-2025-08-07`、`gpt-5-mini-2025-08-07`、`o3-2025-04-16` 等快照 |
| 2027-01-06 | 停止创建新的 fine-tuning job |
| 2027-01-20 | `gpt-realtime`、`gpt-audio`、`gpt-4o-audio`、`gpt-4o-realtime` |
| 2027-02-26 | `whisper-1`、`gpt-4o-transcribe` 系 |

---

## 3. Anthropic

### 3.1 端点与头

```
POST https://api.anthropic.com/v1/messages
x-api-key: $ANTHROPIC_API_KEY
anthropic-version: 2023-06-01        ← 必需
content-type: application/json
anthropic-beta: feature-a,feature-b  ← 可选
```

`anthropic-version` 只有两个合法值：`2023-06-01`（当前）和 `2023-01-01`（已弃用）。也可以改用 `Authorization: Bearer <token>` 走 workload identity federation 签发的短期 OIDC 令牌。多 workspace 的 key 需要带 `anthropic-workspace-id`。

其他端点：`/v1/messages/count_tokens`（免费，独立 RPM）、`/v1/messages/batches`、`/v1/models`、`/v1/files`（2026-08-19 出 beta）、`/v1/skills`（同日出 beta）。

请求体上限：Messages 32 MB，Batch 256 MB，Files 单文件 500 MB。

### 3.2 模型（2026-08）

**4.6 代起 model ID 不带日期后缀，且本身就是 pinned snapshot，不是浮动别名。** 新模型没有 `-latest`。

| 模型 | API ID | 上下文 | 最大输出 | 思考 | 默认 effort | in / out（$/MTok） |
|---|---|---|---|---|---|---|
| Claude Opus 5 | `claude-opus-5` | 1M | 128K | Adaptive | `high` | 5 / 25 |
| Claude Sonnet 5 | `claude-sonnet-5` | 1M | 128K | Adaptive | `high` | 2 / 10 |
| Claude Fable 5 | `claude-fable-5` | 1M | 128K | Adaptive（**不可禁用**） | `high` | 10 / 50 |
| Claude Mythos 5 | `claude-mythos-5` | 1M | 128K | Adaptive（不可禁用） | `high` | 10 / 50 |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 200K | 64K | ❌ | — | 1 / 5 |

Legacy 仍可用：`claude-opus-4-8` / `4-7` / `4-6` / `4-5`、`claude-sonnet-4-6` / `4-5-20250929`。
已退役：Opus 4.1（2026-08-05）、Sonnet 4 / Opus 4（2026-06-15）、Haiku 3（2026-04-20）。

Mythos 5 需要 Project Glasswing 审批；Fable 5 无需审批，能力相同但带安全分类器，会返回 `stop_reason: "refusal"`。两者强制 30 天数据留存，不支持 ZDR。

1M 上下文自 2026-03-13 起对 Opus/Sonnet 4.6 出 beta，无需 header。

> ⚠️ **Tokenizer 从 Opus 4.7 起换过**，同一段文本 token 数约 **+30%**。所有 token 预算和成本预估必须用目标模型重新 `count_tokens` 校准，不能沿用旧系数。

Batch API 全线五折；`inference_geo: "us"` 有 1.1× 乘数。

### 3.3 请求

```json
{
  "model": "claude-opus-5",
  "max_tokens": 65536,
  "system": [
    { "type": "text",
      "text": "你是 GETSSH 内置的运维助手。所有写操作必须先请求确认。",
      "cache_control": { "type": "ephemeral", "ttl": "1h" } }
  ],
  "messages": [
    { "role": "user", "content": [
        { "type": "text", "text": "web-01 的 nginx 起不来，看一下" }
    ]}
  ],
  "tools": [
    { "name": "run_command",
      "description": "在指定主机上执行只读命令并返回 stdout。",
      "input_schema": {
        "type": "object",
        "properties": {
          "host":    { "type": "string" },
          "command": { "type": "string" }
        },
        "required": ["host", "command"]
      },
      "strict": true,
      "cache_control": { "type": "ephemeral" } }
  ],
  "tool_choice": { "type": "auto", "disable_parallel_tool_use": false },
  "thinking": { "type": "adaptive", "display": "summarized" },
  "output_config": { "effort": "xhigh" },
  "stream": true
}
```

顶层字段：

```
model*             string
messages*          MessageParam[]   最多 100,000 条
max_tokens*        int              必填；0 表示只填充缓存不生成
system             string | TextBlockParam[]
stream             boolean
stop_sequences     string[]
tools / tool_choice
thinking           { type, display, budget_tokens? }
output_config      { format?, effort? }
metadata           { user_id }
service_tier       "auto" | "standard_only"
inference_geo      string
container          string | { id, skills: [...] }
context_management { edits: [...] }         beta: context-management-2025-06-27
mcp_servers        [...]                     beta: mcp-client-2025-11-20
temperature / top_p / top_k                  ⚠️ 见下
```

> ⚠️ **采样参数硬约束**：Fable 5 / Mythos 5 / Opus 5 / Opus 4.8 / Opus 4.7 / Sonnet 5 上，`temperature`、`top_p`、`top_k` 只要不是默认值就**一律 400**，跟有没有开思考无关。**适配层默认完全不发这三个字段。**

**`effort` 在 `output_config.effort`，不是顶层字段。** 阶梯 `low` < `medium` < `high`（默认）< `xhigh` < `max`。Haiku 4.5 不支持。Opus 5 上 effort 为 `xhigh`/`max` 时不允许 `thinking: {"type":"disabled"}`，否则 400。effort 是软引导，`max_tokens` 才是硬上限。

输入侧 content block 类型：`text`、`image`、`document`、`tool_use`、`tool_result`、`thinking`、`redacted_thinking`、`search_result`、`container_upload`、`tool_reference`。`image` / `document` 的 `source` 支持 `base64` / `url` / `file`。

### 3.4 响应

```json
{
  "id": "msg_01FqfsLoHwgeFbguDgpz48m7",
  "type": "message",
  "role": "assistant",
  "model": "claude-opus-5",
  "content": [
    { "type": "thinking", "thinking": "", "signature": "EosnCkYICxIMMb3LzNrMu..." },
    { "type": "text", "text": "先看服务状态。" },
    { "type": "tool_use", "id": "toolu_01A09q90qw90lq917835lq9",
      "name": "run_command", "input": { "host": "web-01", "command": "systemctl status nginx" } }
  ],
  "stop_reason": "tool_use",
  "stop_sequence": null,
  "stop_details": null,
  "usage": {
    "input_tokens": 50,
    "output_tokens": 503,
    "cache_creation_input_tokens": 248,
    "cache_read_input_tokens": 100000,
    "cache_creation": {
      "ephemeral_5m_input_tokens": 148,
      "ephemeral_1h_input_tokens": 100
    },
    "output_tokens_details": { "thinking_tokens": 412 }
  }
}
```

`stop_reason` 全集：

| 值 | 处理 |
|---|---|
| `end_turn` | 正常结束 |
| `max_tokens` | 触顶，提高上限或续写 |
| `stop_sequence` | 读 `stop_sequence` 字段 |
| `tool_use` | 执行工具并回传 `tool_result` |
| `pause_turn` | **server tool 循环到达迭代上限**，把 assistant content 原样回传即可继续 |
| `refusal` | 模型拒答，读 `stop_details`，可在 fallback 模型上重试 |
| `model_context_window_exceeded` | 生成中撑满上下文，**HTTP 200，当截断处理，不是错误** |

> ⚠️ 4.5 代及更新的模型上，`input_tokens + max_tokens > context_window` **不再报 400**，请求会被接受，真撑满时才回 `model_context_window_exceeded`。**适配层不能再依赖前置校验来兜底。**

`stop_details` 仅在 `refusal` 时非空，含 `category`（`cyber` / `bio` / `reasoning_extraction`）和 `explanation`。被拒且无输出的请求自 2026-06-02 起不计费。

> ⚠️ **`usage.input_tokens` 不含缓存部分。** 真实输入总量 = `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`。计费和配额建模必须用这个和。

### 3.5 流式

事件序列：

```
message_start
  → { content_block_start → content_block_delta* → content_block_stop }*
  → message_delta+
  → message_stop
```

另有随机插入的 `ping` 和 `error`。**确认不发 `[DONE]`**，`2023-06-01` 版本的变更说明明确写了 "Removed unnecessary `data: [DONE]` event"。流以 `message_stop` 结束。

delta 类型：

| type | 载荷 | 说明 |
|---|---|---|
| `text_delta` | `text` | 文本增量 |
| `input_json_delta` | `partial_json` | **工具入参字符串片段** |
| `thinking_delta` | `thinking` | 思考增量 |
| `signature_delta` | `signature` | 每个 thinking 块在 `content_block_stop` 之前恰好一次 |
| `citations_delta` | `citation` | ⚠️ payload 结构未核实 |

工具入参累积：

```
event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_01T1x1fJ34qAmk2tNTrN7Up6","name":"get_weather","input":{}}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"locat"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"ion\": \"San Francisco\"}"}}

event: content_block_stop
data: {"type":"content_block_stop","index":1}
```

`content_block_start` 里的 `input` 是**空对象 `{}`**，不要当成最终值。

**最终 `usage` 在 `message_delta` 里**（`message_stop` 之前的最后一个），而且**是累计值不是增量**。`message_start` 只带占位的 `output_tokens: 1~3`。

```
event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"input_tokens":10682,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":510}}
```

流内错误：

```
event: error
data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}
```

等价于非流式的 529，但因为 HTTP 已经 200 了，必须在流内处理。

**细粒度工具流式**已出 beta，旧 header `fine-grained-tool-streaming-2025-05-14` 废弃，改为逐工具字段 `eager_input_streaming: true`，仅用于自定义工具。开启后服务端不缓冲不校验，可能收到非法 JSON，约定的回传方式：

```json
{"type":"tool_result","tool_use_id":"toolu_...","is_error":true,
 "content":"{\"INVALID_JSON\": \"<收到的无法解析的内容>\"}"}
```

**断流恢复的代际差异**：4.5 及更早是把已收到的部分响应作为 assistant message 前缀续写；4.6 及更新改为追加一条 user message 说明中断并要求继续。`tool_use` 和 `thinking` 块无法部分恢复。

### 3.6 工具

```json
{
  "name": "get_weather",
  "description": "Get the current weather for a given location.",
  "input_schema": {
    "type": "object",
    "properties": { "location": { "type": "string" } },
    "required": ["location"]
  }
}
```

注意字段名是 **`input_schema`**，不是 `parameters`。可选属性：`strict`、`cache_control`、`defer_loading`、`allowed_callers`、`input_examples`、`eager_input_streaming`。

`tool_choice`：

```json
{"type": "auto", "disable_parallel_tool_use": false}
{"type": "any",  "disable_parallel_tool_use": true}
{"type": "tool", "name": "run_command"}
{"type": "none"}
```

结果回传：

```json
{ "role": "user", "content": [
  { "type": "tool_result", "tool_use_id": "toolu_...", "content": "...", "is_error": false }
]}
```

服务端工具（无 `input_schema`，只给 type 和 name）：`web_search_20260318`、`web_fetch_20260318`、`code_execution_20260521`、`advisor_20260301`、`tool_search_tool_regex_20251119`、`mcp_toolset`。
客户端工具（需自己执行）：`memory_20250818`、`bash_20250124`、`text_editor_20250728`、`computer_toolset_20260801`、`browser_toolset_20260801`。

**工具系统提示的隐性 token**（成本建模用）：Opus 5 是 286（`auto`/`none`）/ 406（`any`/`tool`）；Sonnet 5 是 354 / 474；Haiku 4.5 是 496 / 588。

### 3.7 Adaptive Thinking

> 这一节相对旧认知变化最大。**经典的 `thinking: {"type":"enabled","budget_tokens":N}` 在当前主力模型上会被拒绝。**

三种模式：

```json
{"thinking": {"type": "adaptive", "display": "summarized" | "omitted"}}
{"thinking": {"type": "enabled", "budget_tokens": 10000}}   // 仅 Opus 4.5
{"thinking": {"type": "disabled"}}
```

| 模型 | 默认 | `adaptive` | `budget_tokens` | 可禁用 |
|---|---|---|---|---|
| Fable 5 / Mythos 5 | 开 | ✅ | ❌ | ❌ |
| Opus 5 / Sonnet 5 | 开 | ✅ | ❌ | Opus 5 仅在 effort ≤ high 时 |
| Opus 4.8 / 4.7 / 4.6 / Sonnet 4.6 | 关 | ✅ | ❌ | ✅ |
| Opus 4.5 | 关 | ❌ | ✅ **唯一支持** | ✅ |
| Haiku 4.5 | 关 | ❌ | ❌ | — |

`display` 字段：`summarized` 返回可读摘要，`omitted` 时 `thinking` 字段为空串只留 `signature`。**Fable 5 / Mythos 5 / Opus 5 / Sonnet 5 / Opus 4.8 / 4.7 的默认是 `omitted`。** `omitted` 只降延迟不降成本，思考 token 照常计费，好处是流式下首个可见 token 更快。

**`signature` 是完整思考的加密副本**，服务端在你回传时解密以重建原始推理并校验来源。不透明，禁止解析、截断、编辑。跨平台通用（Claude API / Bedrock / Vertex 互认）。

**为什么必须逐字回传**：一次工具调用循环算**一个 assistant turn**。回传 `tool_result` 时模型要从原推理处继续构建同一个响应。同一个 tool-use turn 内，`thinking` + `redacted_thinking` 块必须完整、原样、按原序回传，重排或部分丢弃直接 **400**。

跨轮建议**全部回传**，API 会按模型策略自动过滤，只对实际喂给模型的块计 input token，不需要自己裁剪。

**最常见的 bug**：`if block.type == "thinking"` 这种过滤会静默丢掉 `redacted_thinking`，破坏协议。必须写成 `in ("thinking", "redacted_thinking")`。

保留策略按模型分两类：Opus 4.5 及之后的 Opus、Sonnet 4.6 及之后的 Sonnet、Fable 5、Mythos 5 **保留全部历史轮**，长会话里 thinking 会持续累积占上下文并按 input 计费，必要时用 `clear_thinking_20251015` 回收；更早的模型和**所有 Haiku** 只保留最后一轮，回传旧块会被自动剥离。

**切换模型时必须手工剥离 `thinking` / `redacted_thinking`**，其他模型不报错但会静默忽略，白白多计 input token。

其他约束：
1. `tool_choice: "any"` / `"tool"` 与 **manual extended thinking（Opus 4.5）不兼容**；adaptive thinking 支持强制工具调用
2. thinking 开启时不能预填 assistant 响应
3. 中途改 thinking 配置不报错，但会**静默禁用**该请求的 thinking。检测方式是看响应里有没有 thinking 块。请在 turn 边界切换
4. **任何 thinking / effort 配置变更都会让 prompt cache 失效**，因为配置被渲染进 prompt 本身
5. SDK 在 `max_tokens > 21333` 时强制要求 streaming（客户端限制）

### 3.8 Prompt Caching

```json
{"cache_control": {"type": "ephemeral", "ttl": "5m" | "1h"}}
```

限制：**每请求最多 4 个断点**，每个断点向前回看 20 个块。可缓存 tool 定义、`system` 数组里的块、`messages` 里的 text/image/document、`tool_use`、`tool_result`。thinking 块不能直接标缓存，但会随上轮内容被连带缓存。

最小可缓存 token：Opus 5 / Fable 5 / Mythos 5 是 **512**；Opus 4.8 / Sonnet 5 / Sonnet 4.6 是 1,024；Opus 4.7 是 2,048；Opus 4.6 / 4.5 / Haiku 4.5 是 4,096。

价格乘数：5m 写入 **1.25×**，1h 写入 **2×**，读取 **0.1×**。5m 缓存读一次就回本，1h 需要读两次。可与 Batch 五折叠加。

缓存是前缀式的，任一位置变更会让其后全部失效。使缓存失效的操作：改 tool 定义、开关 web search、开关 citations、改 `tool_choice`、增删图片、改 thinking / effort 配置。

混用 TTL 时 **1h 断点必须排在 5m 断点之前**。

排查缓存未命中可以用 beta：`cache-diagnosis-2026-04-07` + `diagnostics.previous_message_id`，返回 `cache_miss_reason`。

### 3.9 限流与错误

```json
{
  "type": "error",
  "error": { "type": "not_found_error", "message": "..." },
  "request_id": "req_011CSHoEeqs5C35K2UUqR7Fy"
}
```

`request_id` 在**信封顶层**，不在 `error` 里面。所有排查都应记录它（响应头 `request-id` 里也有）。

花费上限的特殊 429：

```json
{"type":"error","error":{"type":"rate_limit_error",
 "message":"You have reached your API usage limits...",
 "details":{"error_code":"enforced_spend_limit_reached"}}}
```

⚠️ **这种 429 不带 `retry-after`，重试没有意义。** 必须靠 `error.details.error_code` 与普通限流区分。

限流头：

```
retry-after
anthropic-ratelimit-requests-limit / -remaining / -reset
anthropic-ratelimit-tokens-limit / -remaining / -reset
anthropic-ratelimit-input-tokens-limit / -remaining / -reset
anthropic-ratelimit-output-tokens-limit / -remaining / -reset
```

`*-reset` 是 **RFC 3339 时间戳**（与 OpenAI 的时长字符串不同），token 类的 `-remaining` 四舍五入到千位。

**非流式请求预计超过 10 分钟的必须改用 streaming 或 Batch API。** 大 `max_tokens` 且不流式是最典型的超时来源，网络中间设备会切断空闲连接。

### 3.10 OpenAI 兼容层

存在，base URL `https://api.anthropic.com/v1/`，端点 `/v1/chat/completions`。

**静默丢弃**（不报错，行为与 OpenAI 不同）：`logprobs`、`top_logprobs`、`metadata`、`response_format`、`prediction`、`presence_penalty`、`frequency_penalty`、`seed`、`service_tier`、`audio`、`logit_bias`、`store`、`user`、`modalities`、`reasoning_effort`。

其他限制：`strict` 被忽略（工具入参不保证符合 schema）、不支持 prompt caching、所有 system message 被提升并用 `\n` 拼成单条、`n` 必须为 1、thinking 只能经 `extra_body` 传入且不返回思考内容。

**官方定位是仅供测试与横向对比，不建议用于生产。** GETSSH 既然要做深度适配，就应当直接对接原生 Messages API。

---

## 4. Google Gemini

### 4.1 两套接口，先选对

> **Interactions API 自 2026-06 起成为默认接口，`generateContent` 已被官方标记为 legacy。** 原文："The Interactions API has become our default interface as of June 2026 and is the best way to build with Gemini models and agents going forward." 以及 "While it remains supported, the `generateContent` API is now considered legacy."

`generateContent` 目前**没有公布退役日期**，但新代码不应该再从它起步。GETSSH 的 Gemini 适配器建议直接对 Interactions API 写，把 `generateContent` 留作兼容旧 endpoint 的备用分支。

```
# 推荐
POST https://generativelanguage.googleapis.com/v1beta/interactions

# Legacy
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent
```

鉴权用 `x-goog-api-key: <key>` 头，或 `?key=<key>` 查询参数。**优先用头**，query 参数会进日志和 Referer。

Vertex AI 是另一套：走 OAuth，project / location 在路径里，端点形状不同。⚠️ 本次未逐项核实，如果 GETSSH 要支持企业客户的 Vertex 接入，需要单独做一轮。

### 4.2 模型（2026-08）

稳定版：

| Model ID | 类型 |
|---|---|
| `gemini-3.7-flash` | 文本 / 多模态 |
| `gemini-3.6-flash` | 文本 / 多模态 |
| `gemini-3.5-flash` | 文本 / 多模态 |
| `gemini-3.5-flash-lite` | 文本 / 多模态 |
| `gemini-3.1-flash-lite` | 文本 / 多模态 |
| `gemini-2.5-pro` / `gemini-2.5-flash` / `gemini-2.5-flash-lite` | 上一代，仍在线 |
| `gemini-3.1-flash-image` / `gemini-3-pro-image` | 图像生成 |
| `gemini-3.5-transcribe` / `-live` | 语音转写 |
| `gemini-embedding-001` | 向量 |

预览版（GETSSH 不建议默认启用）：`gemini-3.1-pro-preview`、`gemini-3-flash-preview`、`gemini-3.1-flash-live-preview`、`gemini-omni-1.1-flash`、`deep-research-preview-04-2026`、`gemini-embedding-2-preview` 等。

⚠️ **模型页没有列上下文窗口、最大输出和知识截止**，这些在各模型的详情页。适配层的模型元数据表需要单独抓一次，或者直接调 `GET /v1beta/models` 拿运行时值，后者更稳。

### 4.3 Interactions 请求

```json
{
  "model": "gemini-3.7-flash",
  "system_instruction": "你是 GETSSH 内置的运维助手。所有写操作必须先请求确认。",
  "input": "web-01 的 nginx 起不来，看一下",
  "tools": [
    {
      "type": "function",
      "name": "run_command",
      "description": "在指定主机上执行只读命令并返回 stdout。",
      "parameters": {
        "type": "object",
        "properties": {
          "host":    { "type": "string", "description": "目标主机别名" },
          "command": { "type": "string", "description": "要执行的命令" }
        },
        "required": ["host", "command"]
      }
    }
  ],
  "tool_choice": "auto",
  "generation_config": {
    "max_output_tokens": 32000,
    "thinking_level": "high",
    "stop_sequences": [],
    "seed": 42
  },
  "store": false,
  "stream": true
}
```

顶层字段：

| 字段 | 说明 |
|---|---|
| `model` | 与 `agent` 二选一必填 |
| `agent` | 用 Agent 而非裸模型时填 |
| `input` | string / Content / Content[] / Step[] |
| `system_instruction` | 系统指令 |
| `tools` | 工具声明数组 |
| `tool_choice` | `auto` / `any` / `none` / `validated`，或对象形式 |
| `generation_config` | `max_output_tokens`、`seed`、`stop_sequences`、`thinking_level` 等 |
| `previous_interaction_id` | 服务端会话延续 |
| `store` | 是否留存请求与响应 |
| `stream` | 是否流式 |
| `safety_settings` | 内容安全阈值 |
| `labels` | 自定义元数据 |

`tools[].type` 可取：`function`、`code_execution`、`retrieval`、`google_search`、`google_maps`、`file_search`、`url_context`、`mcp_server`、`computer_use`。

内容类型：`text`、`image`、`audio`、`video`、`document`。

### 4.4 Interactions 响应

```json
{
  "id": "...",
  "object": "interaction",
  "status": "completed",
  "model": "gemini-3.7-flash",
  "created": "2026-08-31T10:00:00Z",
  "updated": "2026-08-31T10:00:04Z",
  "steps": [
    { "type": "model_output", "content": [ ... ] },
    { "type": "function_call", "id": "un6k8t18", "name": "run_command", "arguments": { ... } }
  ],
  "usage": {
    "total_input_tokens": 0,
    "total_output_tokens": 0,
    "total_cached_tokens": 0,
    "total_thought_tokens": 0,
    "total_tokens": 0,
    "input_tokens_by_modality":  [{ "modality": "text", "tokens": 0 }],
    "output_tokens_by_modality": [],
    "cached_tokens_by_modality": []
  }
}
```

`status` 全集：`completed` / `in_progress` / `requires_action` / `failed` / `cancelled` / `incomplete` / `budget_exceeded` / `queued`。

> **`requires_action` 就是「等你执行工具」的状态**，对应 OpenAI 的 `stop_reason: tool_use`。`budget_exceeded` 是三家里独有的一个状态，适配层要有单独分支。

step 类型：`model_output` / `function_call` / `user_input` / `thought` / 各类内置工具 step（如 `google_search_call`、`google_search_result`）。

`usage` 是**按模态拆分的**，跟另外两家的扁平结构不一样。适配层的统一用量模型需要能容纳这层拆分，否则多模态请求的成本会算不准。

### 4.5 流式

`stream: true` 走 SSE，事件名在 `event:` 行。

```
event: interaction.created
data: {"interaction":{"id":"...","model":"gemini-3.7-flash","status":"in_progress","object":"interaction"},"event_type":"interaction.created"}

event: step.start
data: {"index":0,"step":{"type":"model_output"},"event_type":"step.start"}

event: step.delta
data: {"index":0,"delta":{"type":"text","text":"先看服务状态"},"event_type":"step.delta"}

event: step.stop
data: {"index":0,"event_type":"step.stop"}

event: interaction.completed
data: {"interaction":{"id":"...","status":"completed","usage":{...}},"event_type":"interaction.completed"}

event: done
data: [DONE]
```

事件清单：`interaction.created`、`interaction.status_update`、`step.start`、`step.delta`、`step.stop`、`interaction.completed`、`done`。

工具入参也是字符串碎片，delta type 是 `arguments_delta`：

```
event: step.start
data: {"index":1,"step":{"type":"function_call","id":"un6k8t18","name":"run_command","arguments":{}},"event_type":"step.start"}

event: step.delta
data: {"index":1,"delta":{"type":"arguments_delta","arguments":"{\"host\": \"web-01\""},"event_type":"step.delta"}
```

按 `index` 累积，到该 index 的 `step.stop` 之后再 parse。跟 Anthropic 一样，`step.start` 里的 `arguments` 是空对象，不是最终值。

思考流有两种 delta：

```
event: step.delta
data: {"index":0,"delta":{"type":"thought_summary","content":{"type":"text","text":"我需要先确认服务状态"}},"event_type":"step.delta"}

event: step.delta
data: {"index":0,"delta":{"signature":"...","type":"thought_signature"},"event_type":"step.delta"}
```

**`thought_signature` 是该 step 在 `step.stop` 之前的最后一个 delta。**

#### legacy `streamGenerateContent` 的解析陷阱

如果要兼容旧端点，注意一件事：**不带 `?alt=sse` 时，它返回的是一个增量下发的 JSON 数组**，不是 SSE。响应体开头是 `[`，然后一个个 JSON 对象逗号分隔，最后 `]`。用按行读 SSE 的解析器去读它会得到一堆垃圾。要么加 `?alt=sse`，要么上流式 JSON 解析器。

### 4.6 函数调用

声明形状（Interactions API）：

```json
{
  "type": "function",
  "name": "run_command",
  "description": "在指定主机上执行只读命令并返回 stdout。",
  "parameters": {
    "type": "object",
    "properties": {
      "host":    { "type": "string", "description": "目标主机别名" },
      "command": { "type": "string", "description": "要执行的命令" }
    },
    "required": ["host", "command"]
  }
}
```

**Gemini 只支持 OpenAPI 3.0 schema 的一个子集**。确认支持的关键字：`type`、`properties`、`required`、`description`、`enum`、`items`。官方没有给出完整的不支持清单，复杂嵌套 schema 在 `any` 模式下可能被拒。

适配层的实际做法：**内部维护一份「最小公分母」JSON Schema**，只用上面这些关键字，需要更强约束时在应用层自己校验，不要指望各家 schema 引擎行为一致。

结果回传：

```json
{
  "type": "function_result",
  "name": "run_command",
  "call_id": "un6k8t18",
  "result": [
    { "type": "text", "text": "● nginx.service - failed" }
  ]
}
```

`result` 支持多模态（Gemini 3 系列），可以塞 `{"type":"image","mime_type":"image/jpeg","data":"..."}`。这是三家里唯一原生支持图片型工具结果的（Anthropic 的 `tool_result.content` 也可以放 image 块）。

`tool_choice`：`auto`（默认）/ `any`（必须调用）/ `none` / `validated`（保证符合 schema）。可以用 `allowed_tools` 限定到具体几个函数。

自定义函数可以和内置工具（Google Search、Code Execution）混用。

### 4.7 Thinking 与 thought signature

`generation_config.thinking_level`：`minimal` / `low` / `medium` / `high`。

| 模型 | 默认 |
|---|---|
| `gemini-3.7-flash` | `medium` |
| `gemini-3.1-pro` | `high` |
| `gemini-3.5-flash` | `medium` |
| `gemini-3.5/3.1-flash-lite` | `minimal` |

**Gemini 2.5 系列不支持 `thinking_level`**，用 `thinking_budget`（token 数）：

| 模型 | 范围 | 可关（0） | 动态（-1） |
|---|---|---|---|
| 2.5 Pro | 128 – 32,768 | ❌ | ✅（默认） |
| 2.5 Flash | 0 – 24,576 | ✅ | ✅（默认） |
| 2.5 Flash Lite | 512 – 24,576 | ✅ | ✅ |

`include_thoughts: true` 返回思考摘要，在响应 part 上带 `thought: true` 标记。

#### thought signature 的硬规则

签名是「模型内部推理状态的加密表示」，用来在无状态调用之间维持推理连续性。官方描述：**每个 thought step 都有签名，即使模型只做了很少的推理，签名也始终存在。**

在 Interactions API 里，**签名只出现在两个地方**：`thought` step，以及内置工具 step（`google_search_call` / `google_search_result` 这类）。

规则：

- **无状态模式（自己管历史）**：必须把收到的所有 `thought` 块**原样重发**，不能删改。官方原文用了大写的 MUST 和 NOT。
- **有状态模式（`store: true` + `previous_interaction_id`）**：服务端自动管理，包括所有 thought 块和签名，你什么都不用做。
- **不要把带签名的 part 和不带签名的 part 合并**，也不要把多个带签名的 part 拼接在一起。
- Gemini 2.5：只在「开了思考 + 用了函数声明」时返回签名。Gemini 3：所有类型的 part 都可能带签名。
- 流式下 `thought_signature` delta 是 `step.stop` 之前的最后一个。

> **对 GETSSH 的直接影响**：BYOK 场景下我们大概率会用 `store: false`（用户的服务器数据不该留在 Google），那就落在无状态分支，thought 块的原样回传是**必须自己实现的**，不能靠 SDK 兜底。

### 4.8 错误

```json
{ "error": { "code": "string", "message": "string" } }
```

⚠️ 注意这个信封形状比经典的 `google.rpc.Status`（带 `status` 字符串和 `details` 数组）要简化。适配层解析时两种都要兼容。

| `code` | HTTP | 可重试 |
|---|---|---|
| `invalid_request` | 400 | ❌ |
| `failed_precondition` | 400 | ❌（多为未开通计费） |
| `out_of_range` | 416 | ❌ |
| `authentication` | 401 | ❌ |
| `permission_denied` | 403 | ❌ |
| `not_found` | 404 | ❌ |
| `rate_limit_exceeded` | 429 | ✅ 指数退避 |
| `quota_exceeded` | 429 | ❌ 日配额耗尽，要等重置或提配额 |
| `service_unavailable` | 503 | ✅ 指数退避 |

生成被拦截的代码：`safety`、`recitation`、`language`、`prohibited_content`、`spii`、`blocklist`、`image_safety`、`image_prohibited_content`、`image_recitation`、`image_other`、`content_blocked`。

> **两种 429 必须分开处理**：`rate_limit_exceeded` 退避重试有用，`quota_exceeded` 重试多少次都没用。这是 Gemini 特有的一组，OpenAI 和 Anthropic 都是靠 `code` / `details` 二次判别。

### 4.9 OpenAI 兼容层

Gemini 提供 `https://generativelanguage.googleapis.com/v1beta/openai/` 兼容端点。⚠️ **本次未核实其当前支持范围与丢弃字段清单。** 结论与 Anthropic 相同：兼容层适合快速联调，深度适配应当走原生接口，否则 thought signature、thinking_level、多模态工具结果这些都拿不到。

---

## 5. 统一适配层设计

### 5.1 内部数据模型

不要用 `{role, content}`。用「有序的、带类型的块序列」，三家都能无损映射：

```ts
type Block =
  | { kind: 'text';      text: string }
  | { kind: 'thought';   text?: string; opaque: string }   // opaque = 签名/加密体，原样保存
  | { kind: 'tool_call'; callId: string; name: string; args: unknown; raw: string }
  | { kind: 'tool_result'; callId: string; content: Block[]; isError?: boolean }
  | { kind: 'image';     mime: string; data: string }
  | { kind: 'server_tool'; toolType: string; payload: unknown; opaque?: string }

interface Turn { role: 'user' | 'assistant'; blocks: Block[] }
```

关键设计点：

1. **`opaque` 字段是不可协商的。** OpenAI 的 `encrypted_content`、Anthropic 的 `signature`、Gemini 的 `thought_signature` 全部存进这里，原样保存、原样回传、永不解析。
2. **`raw` 保存工具入参的原始字符串**。流式装配拿到的是字符串，parse 成对象是给上层用的；回传给模型时用哪个取决于厂商，留着原文最安全。
3. **块的顺序就是回传的顺序。** 三家都对 thought 与 tool_call 的相对顺序有要求，任何"整理"都会出问题。
4. **服务端内置工具的 step / item 也要建模。** Gemini 的 `google_search_call` step 带签名，Anthropic 的 server tool 有 `pause_turn` 语义，丢掉它们会导致多轮断裂。

### 5.2 流式装配的统一状态机

```
状态：Map<聚合键, { kind, name?, callId?, buf: string }>

事件 → 归一化：
  OpenAI Responses   : 聚合键 = item_id       ; 收尾 = *.done       ; 用 .done 的完整值覆盖
  OpenAI ChatCompl.  : 聚合键 = tool_calls[].index ; 收尾 = finish_reason ; 首片存 id/name
  Anthropic          : 聚合键 = block index    ; 收尾 = content_block_stop
  Gemini Interactions: 聚合键 = step index     ; 收尾 = step.stop

终止判定（按优先级）：
  1. 收到语义化终止事件 → 正常结束
  2. 收到 [DONE] 且已有终止事件 → 忽略
  3. 收到 [DONE] 但没有终止事件 → 按 OpenAI CC 处理，标记正常结束
  4. 连接断开且无终止事件 → 可重试失败，不要当成正常结束
```

### 5.3 工具调用循环

```
loop:
  resp = call(model, history)
  history.append(assistant_turn(resp.blocks))        ← 含 thought 块，原样

  calls = resp.blocks.filter(kind == 'tool_call')
  if calls.isEmpty: break

  # 三家的"需要执行工具"信号不同
  #   OpenAI     : output 里有 function_call item
  #   Anthropic  : stop_reason == "tool_use"
  #   Gemini     : status == "requires_action"

  results = await Promise.all(calls.map(execute))    ← 并行执行
  history.append(user_turn(results.map(toolResultBlock)))
```

三个必须处理的额外分支：

- **Anthropic `pause_turn`**：server tool 循环到迭代上限，把 assistant content 原样回传即可继续，不是错误。
- **Anthropic `model_context_window_exceeded`**：HTTP 200，当截断处理。
- **Gemini `budget_exceeded`**：单独的终止状态，要给用户明确提示而不是当成失败重试。

### 5.4 能力探测表

适配层需要一张按 `(vendor, model)` 索引的能力表，至少包含：

| 能力位 | 用途 |
|---|---|
| `supportsTemperature` | 决定是否下发采样参数，避免 Anthropic 新模型 400 |
| `supportsThinking` / `thinkingCanBeDisabled` | 决定思考配置怎么发 |
| `thinkingParamStyle` | `effort` / `level` / `budget` 三种形状 |
| `reasoningAndToolsCanCoexist` | OpenAI CC 上为 false，用来强制路由到 Responses |
| `maxOutputTokens` / `contextWindow` | 预算校验 |
| `toolSchemaDialect` | 决定 schema 降级到什么程度 |
| `cacheMinTokens` / `cacheBreakpointLimit` | 缓存策略 |

这张表建议**运行时可更新**（配一份远端 JSON），因为三家的模型 roster 三个月就会变一轮。硬编码进二进制意味着每次模型更新都要发版。

### 5.5 成本与 token 会计

三家的 `usage` 口径都不一样，统一层要做归一化：

| 概念 | OpenAI | Anthropic | Gemini |
|---|---|---|---|
| 非缓存输入 | `input_tokens`（含缓存，用 details 拆） | `input_tokens`（**不含**缓存） | `total_input_tokens` |
| 缓存读 | `input_tokens_details.cached_tokens` | `cache_read_input_tokens` | `total_cached_tokens` |
| 缓存写 | 不单列 | `cache_creation_input_tokens` | 不单列 |
| 推理 token | `output_tokens_details.reasoning_tokens` | `output_tokens_details.thinking_tokens` | `total_thought_tokens` |
| 输出 | `output_tokens`（含推理） | `output_tokens`（含思考） | `total_output_tokens` |

**最容易算错的三处**：

1. **Anthropic 的 `input_tokens` 不含缓存部分**，真实输入 = 三项相加。OpenAI 的 `input_tokens` 是含缓存的总数，`cached_tokens` 是其中的子集。这两家方向相反。
2. **OpenAI 长上下文加价按整个请求算**，input 超 272K 时全量 2× / 1.5×，不是只对超出部分。
3. **Anthropic 从 Opus 4.7 起换了 tokenizer，同文本 +30%**。任何沿用旧系数的预算和计费预估都会偏低。

### 5.6 BYOK 场景的数据留存开关

GETSSH 是本地终端，用户的服务器输出会进 prompt。三家的默认留存行为不一样，**必须显式关掉**：

| 厂商 | 字段 | 默认 | 应设 |
|---|---|---|---|
| OpenAI | `store` | **`true`** | `false` |
| Gemini | `store` | ⚠️ 未核实 | 显式 `false` |
| Anthropic | 无（Messages API 本身无状态） | — | — |

⚠️ Anthropic 的 Fable 5 / Mythos 5 **强制 30 天数据留存，不支持 ZDR**。如果 GETSSH 要对外承诺"数据不留第三方"，这两个模型要么不上，要么在 UI 上单独标注。

关掉 `store` 的副作用：OpenAI 不能再用 `previous_response_id`，必须自己回放完整历史（含 reasoning item 和 `encrypted_content`）；Gemini 不能用 `previous_interaction_id`，同样落到无状态分支，thought 块要自己管。**这正是"深度适配"和"套个通用适配器"的分界线。**

---

## 6. 实施清单

按上线风险排序，每条都是可以直接开工单的粒度。

### P0 · 不做会直接报错或静默出错

1. **推理块原样回传**：三家统一走 `opaque` 字段。Anthropic 的过滤条件必须是 `in ("thinking","redacted_thinking")`。
2. **默认不下发 `temperature` / `top_p` / `top_k`**：Anthropic 新模型会 400。
3. **OpenAI 路由规则**：需要「推理 + 工具」时强制走 Responses API，Chat Completions 分支只在 `reasoning_effort: none` 时可用。
4. **流式工具入参按各自的聚合键累积**，收尾事件之后再 parse。
5. **`store: false`**（OpenAI 默认是 true）。
6. **OpenAI 用 `call_id` 而不是 `id` 回传工具结果。**
7. **Anthropic 字段名是 `input_schema` 不是 `parameters`。**

### P1 · 会导致体验或成本问题

8. **429 二次判别**：OpenAI 的 `insufficient_quota`、Anthropic 的 `enforced_spend_limit_reached`、Gemini 的 `quota_exceeded` 都不该重试。
9. **限流头解析**：OpenAI 是时长字符串（`6m0s`），Anthropic 是 RFC 3339 时间戳。
10. **新增终止分支**：Anthropic `pause_turn` / `refusal` / `model_context_window_exceeded`，Gemini `requires_action` / `budget_exceeded`。
11. **token 会计归一化**，特别是 Anthropic 三项相加和 OpenAI 长上下文全量加价。
12. **`output_text` 不存在于 HTTP 响应**，自己遍历 `output` 拼接。
13. **推理模型可能零可见输出但已计费**，要有这条分支。
14. **非流式 10 分钟硬限**（Anthropic），长任务走流式。

### P2 · 长期维护性

15. **能力表做成运行时可更新的远端配置**，别硬编码。
16. **工具 schema 降级到最小公分母**（`type` / `properties` / `required` / `description` / `enum` / `items`），复杂约束在应用层自己校验。
17. **文档域名已迁移**：OpenAI 到 `developers.openai.com`，Anthropic 到 `platform.claude.com`。代码注释和内部 wiki 里的旧链接要换。
18. **Gemini legacy `streamGenerateContent` 不带 `?alt=sse` 时返回流式 JSON 数组**，别用 SSE 解析器读。
19. **模型元数据（上下文窗口、最大输出）优先走运行时查询**（Anthropic `GET /v1/models`、Gemini `GET /v1beta/models`），不要写死。

---

## 7. 未核实清单

上线前建议实测打点确认，不要凭这份文档下结论。

**OpenAI**
- Responses API 是否发送 `data: [DONE]`（官方指南说不发，第三方规范说发，建议两者都兼容）
- GPT-5.6 是否接受 `temperature` / `top_p`（文档未列参数支持表）
- `service_tier` 的合法枚举值
- `gpt-5.6-cyber` 的上下文 / 最大输出 / 定价
- 429 中区分限速与欠费的具体 `code` 字符串
- `response.reasoning_text.delta` 的逐字段 payload

**Anthropic**
- `citations_delta` 的 payload 结构
- 顶层 `cache_control` 请求参数的确切行为
- 最小可缓存 token 表的逐行数值
- OpenAI 兼容层"静默丢弃"清单的逐字段行为

**Gemini**
- 各模型的上下文窗口 / 最大输出 / 知识截止（模型总览页未列）
- `store` 的默认值
- 禁用并行函数调用的字段名
- OpenAI 兼容层的支持范围与丢弃清单
- Vertex AI 路径下的全部差异
- `generateContent` 的退役日期（目前未公布）

---

## 附：来源

**OpenAI**
- [Models](https://developers.openai.com/api/docs/models) · [All models](https://developers.openai.com/api/docs/models/all)
- [Create a model response](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events)
- [Chat Completions streaming events](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events)
- [Function calling](https://developers.openai.com/api/docs/guides/function-calling) · [Structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) · [Tools](https://developers.openai.com/api/docs/guides/tools)
- [Reasoning models](https://developers.openai.com/api/docs/guides/reasoning) · [Reasoning items cookbook](https://developers.openai.com/cookbook/examples/responses_api/reasoning_items)
- [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) · [Rate limits](https://developers.openai.com/api/docs/guides/rate-limits) · [Error codes](https://developers.openai.com/api/docs/guides/error-codes)
- [Deprecations](https://developers.openai.com/api/docs/deprecations) · [Migrate to Responses](https://developers.openai.com/api/docs/guides/migrate-to-responses)

**Anthropic**
- [Models overview](https://platform.claude.com/docs/en/models/overview) · [Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [Messages API reference](https://platform.claude.com/docs/en/api/messages/create) · [API overview](https://platform.claude.com/docs/en/api/overview) · [Versioning](https://platform.claude.com/docs/en/api/versioning)
- [Streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)
- [Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking) · [Effort](https://platform.claude.com/docs/en/build-with-claude/effort)
- [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Tool use overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview) · [Tool reference](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference) · [Fine-grained tool streaming](https://platform.claude.com/docs/en/agents-and-tools/tool-use/fine-grained-tool-streaming)
- [Handling stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons)
- [Errors](https://platform.claude.com/docs/en/api/errors) · [Rate limits](https://platform.claude.com/docs/en/api/rate-limits)
- [OpenAI SDK compatibility](https://platform.claude.com/docs/en/api/openai-sdk) · [Batch processing](https://platform.claude.com/docs/en/build-with-claude/batch-processing)

**Gemini**
- [Gemini API docs](https://ai.google.dev/gemini-api/docs) · [Models](https://ai.google.dev/gemini-api/docs/models)
- [Interactions API reference](https://ai.google.dev/api/interactions-api) · [Streaming interactions](https://ai.google.dev/gemini-api/docs/interactions/streaming)
- [Migrating to the Interactions API](https://ai.google.dev/gemini-api/docs/migrate-to-interactions)
- [Generating content (legacy)](https://ai.google.dev/api/generate-content)
- [Thinking](https://ai.google.dev/gemini-api/docs/thinking) · [Thinking (generateContent)](https://ai.google.dev/gemini-api/docs/generate-content/thinking)
- [Function calling](https://ai.google.dev/gemini-api/docs/function-calling)
- [API errors](https://ai.google.dev/gemini-api/docs/api-errors) · [Troubleshooting](https://ai.google.dev/gemini-api/docs/troubleshooting)
