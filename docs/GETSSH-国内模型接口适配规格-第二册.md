# 国内大模型接口适配规格（第二册）

> 面向 GETSSH AI Agent 的适配层实现文档
> 本册覆盖 **DeepSeek / 智谱 GLM / Moonshot Kimi**
> 核实日期：2026-08-31，全部字段取自各家官方文档实抓
> **MiniMax 与千问（DashScope）未包含在本册**，额度恢复后补第三册
> 御三家（OpenAI / Anthropic / Gemini）见第一册

---

## 0. 一句话先说结论

**这三家的主力 model ID 在过去四个月里全部换过一轮，旧的直接 404。** 如果 IDE 里现在写的是 `deepseek-chat`、`moonshot-v1-128k`、`kimi-latest` 这类名字，那些代码今天已经调不通了。

| 厂商 | 已退役 | 退役时间 | 当前主力 |
|---|---|---|---|
| DeepSeek | `deepseek-chat`、`deepseek-reasoner` | 2026-07-24 15:59 UTC | `deepseek-v4-pro` / `deepseek-v4-flash` |
| Kimi | `moonshot-v1-*` 全系、`kimi-k2.5`、`kimi-k2`、`kimi-latest`、`kimi-thinking-preview` | 2026-08-31 16:00 | `kimi-k3` / `kimi-k2.6` / `kimi-k2.7-code` |
| 智谱 | GLM-4.6 降为中档（未退役） | — | `glm-5.3` |

第二件事：**智谱的 JWT 签名鉴权已经废除了**。历史 SDK 里那套 `{id}.{secret}` 签 HS256 的代码可以整段删掉，现在就是普通的 `Authorization: Bearer <key>`。

---

## 1. 与御三家的三条共性，和三条国内特有

### 共性（第一册已述，这里只标差异点）

**一、采样参数正在被各家收回，但收法不同。**

| 厂商 | `temperature` 现状 |
|---|---|
| Kimi | **完全锁死**。`temperature` / `top_p` / `n` / `presence_penalty` / `frequency_penalty` 传任何值都 **400** |
| DeepSeek | thinking **默认开启**，而 thinking 模式下这四个参数**静默失效** |
| 智谱 GLM | 值域是 **`[0, 1]`** 两位小数，不是 OpenAI 的 `[0, 2]`。超界报 `1214` |
| Anthropic | 新模型非默认值一律 400 |
| OpenAI | 推理模型历史上硬拒 |

DeepSeek 这条最阴险：**不报错，只是不生效**。上游传 `temperature: 0` 期望确定性输出，实际拿到的是采样结果。

**二、推理内容的回传规则，三家各不相同，而且都不是"照抄 Anthropic"能对付的。**

| 厂商 | 字段 | 规则 |
|---|---|---|
| DeepSeek | `reasoning_content` | **不带 tools 时无需回传**（传了也会被忽略）；**带 tools 时必须全部回传，包括那些没实际调用工具的轮次** |
| 智谱 GLM | `reasoning_content` | 由 `thinking.clear_thinking` 控制，`false` = 跨轮保留 |
| Kimi | `reasoning_content` | 由 `thinking.keep` 控制（`null` / `"all"`）；**`kimi-k2.7-code` 无论传什么都按 `all` 处理** |

DeepSeek 的规则是三家里最反直觉的一条，官方原文明确写了"即使该轮模型未实际进行工具调用"也要回传。

**三、流式工具入参仍然是字符串碎片，按 `index` 归并。** 三家都沿用 OpenAI 的 `tool_calls[].index` 语义，这点比御三家统一。

### 国内特有（御三家没有的三个坑）

**一、限流维度是「并发数」，不是 RPM/TPM 速率桶。**

| 厂商 | 限流形式 |
|---|---|
| DeepSeek | 纯并发上限：v4-pro **500**、v4-flash **2500**。超了直接 429 |
| 智谱 GLM | 官方文档只提并发限制，未记载 RPM/TPM |
| Kimi | 四维：并发 + RPM + TPM + TPD，按累计充值分 Tier0–Tier5 |

**适配层要实现的是客户端并发信号量，不是令牌桶。** 而且**三家都不返回 `x-ratelimit-*` 响应头**（⚠️ 均为文档未记载，推定不返回），退避只能靠自适应。

**二、429 的语义比御三家更杂，必须按业务 code 分流。**

| 厂商 | 可重试的 429 | 不可重试的 429 |
|---|---|---|
| DeepSeek | 429 Rate Limit | 402 Insufficient Balance（独立状态码） |
| 智谱 GLM | `1302` 账户限速、`1305` 模型访问量过大 | **`1113` 欠费**、`1308–1321` 配额类 |
| Kimi | `rate_limit_reached_error`、`engine_overloaded_error` | `exceeded_current_quota_error` |

智谱的 `1113` 是最典型的伪 429：欠费返回 429，只看 HTTP 状态码退避重试会陷入死循环。

**三、SSE 流有各自的畸形处，标准解析器会挂。**

| 厂商 | 畸形 |
|---|---|
| DeepSeek | 排队时持续下发 **`: keep-alive` 注释行**（流式）或**空行**（非流式）。解析器必须跳过空行与 `:` 开头的行，读超时要按分钟级设 |
| 智谱 GLM | chunk 里**没有 `object: "chat.completion.chunk"` 字段**。严格按 OpenAI schema 反序列化会失败，`object` 要设为可选 |
| Kimi | **504 返回的是 HTML 页面不是 JSON**。解析前必须先看状态码和 Content-Type，否则 JSON 解析器直接崩 |

---

## 2. 三家速查对照表

### 2.1 传输层

| 项 | DeepSeek | 智谱 GLM | Kimi |
|---|---|---|---|
| 国内 base | `https://api.deepseek.com` | `https://open.bigmodel.cn/api/paas/v4/` | `https://api.moonshot.cn` |
| 国际 base | 同上 | `https://api.z.ai/api/paas/v4/` | `https://api.moonshot.ai` |
| chat 路径 | `/chat/completions` | `/api/paas/v4/chat/completions` | `/v1/chat/completions` |
| 鉴权 | `Authorization: Bearer` | `Authorization: Bearer`（**JWT 已废除**） | `Authorization: Bearer` |
| Anthropic 兼容 | `/anthropic`（`x-api-key`） | `/api/anthropic` → `/v1/messages`（**`x-api-key`**） | `/anthropic/v1/messages`（**仍用 `Bearer`**） |
| Responses 兼容 | 有（无状态） | — | `/v1/responses` |
| Beta base | `/beta`（FIM / prefix / strict） | — | — |
| 账号互通 | — | 两站模型目录不同 | **国内外账号与 key 不通用** |

### 2.2 当前模型

| 厂商 | model ID | 上下文 | 最大输出 | 推理 |
|---|---|---|---|---|
| DeepSeek | `deepseek-v4-pro` | 1M | 384K | 混合，`thinking` 开关 |
| | `deepseek-v4-flash` | 1M | 384K | 混合 |
| | `deepseek-v4-flash-vision-exp` | 1M | 384K | 混合 + 视觉 |
| 智谱 | `glm-5.3` | **1M** | 128K | **强制思考，不可关** |
| | `glm-5.2` / `glm-5.1` / `glm-5` | 1M / 200K | 128K | 默认开启 |
| | `glm-4.7` / `glm-4.6` | 200K | 128K | 4.7 默认开启 |
| | `glm-4.7-flash` / `glm-4.5-flash` | 200K / 128K | 128K / 96K | **免费** |
| Kimi | `kimi-k3` | 1M | 默认 128K / 上限 1M | **始终推理** |
| | `kimi-k2.6` | 256K | ⚠️ 未核实 | 可开关 |
| | `kimi-k2.7-code(-highspeed)` | 256K | ⚠️ 未核实 | **强制开启** |

> **DeepSeek 的架构变化值得单独说**：V4 不再区分"对话模型"和"推理模型"，是**单模型混合推理**。适配层**不能再按 model ID 判断是否推理模型**，要按请求里的 `thinking.type` 判断。

### 2.3 思考控制字段

| 厂商 | 开关 | 档位 | 跨轮保留 | 可否关闭 |
|---|---|---|---|---|
| DeepSeek | `thinking: {type}` | `reasoning_effort`: `low`/`high`/`max`（默认 `high`） | 见共性第二条 | 可 |
| 智谱 | `thinking: {type, clear_thinking}` | `reasoning_effort`: 7 档 `max`→`none` | `clear_thinking: false` | **GLM-5.3 不可关** |
| Kimi K3 | 无开关（始终推理） | `reasoning_effort`: `low`/`high`/`max`（默认 `max`） | — | 不可 |
| Kimi K2.x | `thinking: {type, keep}` | — | `keep: "all"` | k2.7-code 不可关 |

⚠️ **DeepSeek 的 `reasoning_effort` 会静默折叠 OpenAI 的档位**：传 `medium` 实际生效 `high`，传 `xhigh` 也是 `high`。只有显式 `max` 才是最高档。

### 2.4 缓存

三家全是**自动前缀缓存**，没有 Anthropic 那种 `cache_control` 断点。

| 厂商 | 命中/未命中价差 | usage 字段 | 命中条件 |
|---|---|---|---|
| DeepSeek | **30×**（v4-pro 空闲 0.15 vs 4.5 元/M） | `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` | 完整匹配前缀单元 |
| Kimi | **10×**（K3：$0.30 vs $3.00） | `usage.cached_tokens`（**扁平，非嵌套**） | 上次请求 prompt > 256 token |
| 智谱 | 约 **5×**（GLM-5.3：$0.26 vs $1.4） | `usage.prompt_tokens_details.cached_tokens` | 隐式识别 |

**共同结论**：system prompt 和工具定义必须放在 messages 最前且逐字节稳定，任何前置的动态内容（时间戳、随机 ID、用户名）都会让整条前缀失效。DeepSeek 30 倍的差价意味着**缓存命中率是成本的主变量，不是优化项**。

### 2.5 `finish_reason` 私有值

| 厂商 | 私有值 | 含义 | 处理 |
|---|---|---|---|
| DeepSeek | `insufficient_system_resource` | 服务端资源不足，输出**截断且不完整** | **按可重试失败处理**，不是正常完成 |
| 智谱 | `sensitive` | 内容安全拦截，**HTTP 仍是 200** | 不可重试，走内容策略分支 |
| 智谱 | `network_error` | 模型推理异常 | 可重试 |
| 智谱 | `model_context_window_exceeded` | 超上下文 | 不可重试，裁剪历史 |
| Kimi | 无（只有 stop / length / tool_calls） | — | — |

> **强类型语言注意**：OpenAI SDK 把 `finish_reason` 定义成字面量联合类型，Go / Rust / Java 反序列化到这些私有值时会 panic 或抛未知枚举异常。**必须用宽松字符串解析。**
>
> 智谱的 `sensitive` 尤其危险：HTTP 200，不走错误分支，得在成功路径里检查。

---

## 3. DeepSeek

### 3.1 端点

| 用途 | Base URL |
|---|---|
| OpenAI 兼容 | `https://api.deepseek.com` |
| Anthropic 兼容 | `https://api.deepseek.com/anthropic`（`x-api-key`，`anthropic-version` 头被忽略） |
| Beta（FIM / prefix / strict） | `https://api.deepseek.com/beta` |

`POST /chat/completions`，`Authorization: Bearer ${DEEPSEEK_API_KEY}`。

**Anthropic 兼容层的模型名映射**（接 Claude Code 一类客户端时会踩）：Claude Opus 系 → `deepseek-v4-pro`，Claude Haiku/Sonnet 系 → `deepseek-v4-flash`，**未匹配的名字一律静默落到 `deepseek-v4-flash`**，不报错。不支持 `container`、`mcp_servers`、`top_k`、`service_tier`、`cache_control`；`thinking.budget_tokens` 被忽略。

原生 Responses API 也有，但**无状态**：`previous_response_id` 不支持，`store` 恒为 `false`。

### 3.2 定价与峰谷

人民币元 / 百万 tokens：

| 模型 | 缓存命中（空闲/高峰） | 缓存未命中（空闲/高峰） | 输出（空闲/高峰） |
|---|---|---|---|
| `deepseek-v4-flash` | 0.05 / 0.10 | 1.5 / 3.0 | 4.5 / 9.0 |
| `deepseek-v4-pro` | 0.15 / 0.30 | 4.5 / 9.0 | 13.5 / 27.0 |

**高峰时段是北京时间周一至周五 09:00–12:00 与 14:00–18:00**，其余全部为空闲。换成 UTC 就是**周一至周五 01:00–04:00 与 06:00–10:00**。注意这是**峰时加倍**的表述，基准价是空闲价。批量任务排到 UTC 10:00 之后或周末，直接省一半。

⚠️ 美元定价未核实（EN 版价格页是 SPA，抓不到）。CoT token 上限未核实。

### 3.3 请求

```json
{
  "model": "deepseek-v4-pro",
  "messages": [
    {"role": "system", "content": "你是 GETSSH 内置的运维助手。"},
    {"role": "user", "content": "web-01 的 nginx 起不来"}
  ],
  "thinking": {"type": "enabled"},
  "reasoning_effort": "high",
  "stream": true,
  "stream_options": {"include_usage": true}
}
```

字段要点：

| 字段 | 说明 |
|---|---|
| `thinking` | `{"type": "enabled"\|"disabled"}`，**默认开启**，DeepSeek 私有字段 |
| `reasoning_effort` | `low` / `high` / `max`，默认 `high` |
| `temperature` / `top_p` | 0–2 / 0–1，但 **thinking 开启时不生效** |
| `frequency_penalty` / `presence_penalty` | **已废弃，传了无效果** |
| `tools` | 最多 **128** 个 function |
| `stop` | 最多 16 条 |
| `user_id` | 注意是 `user_id` 不是 OpenAI 的 `user`，`[a-zA-Z0-9\-_]`，≤512 |
| `response_format` | `text` / `json_object`。⚠️ 是否支持 `json_schema` 未核实 |

### 3.4 `reasoning_content` 的回传规则

官方原文（思考模式文档）：

- **不带 `tools` 时**："reasoning_content 无需回传；即使传入 API，也会被忽略，不会拼接进上下文"
- **带 `tools` 时**："历史轮次的 reasoning_content 均应回传给 API，并会被拼接进上下文"，并且特别强调"**必须完整回传 reasoning_content 给 API——即使该轮模型未实际进行工具调用**"

历史拼接形态：

```json
{
  "role": "assistant",
  "reasoning_content": "需要先看服务状态，调用 run_command……",
  "content": null,
  "tool_calls": [{"id":"call_0","type":"function",
    "function":{"name":"run_command","arguments":"{\"host\":\"web-01\"}"}}]
}
```

**工程含义**：适配层不能用一条固定策略。纯对话可以丢 CoT 省 token，一进 agent 循环就必须全留。

### 3.5 usage 与 finish_reason

```json
"usage": {
  "prompt_tokens": 18,
  "completion_tokens": 42,
  "total_tokens": 60,
  "prompt_cache_hit_tokens": 0,
  "prompt_cache_miss_tokens": 18,
  "completion_tokens_details": {"reasoning_tokens": 31}
}
```

`finish_reason` 五个值：`stop` / `length` / `content_filter` / `tool_calls` / **`insufficient_system_resource`**。

### 3.6 流式的两个差异

**一、usage chunk 的位置和 OpenAI 不同。** OpenAI 是在 `finish_reason` chunk 之后再发一个 `choices: []` 的独立 usage chunk；DeepSeek 把 usage **搭在最后一个内容 chunk 上**，那个 chunk 的 `choices` 恰好一个元素、`finish_reason` 非 null。按 OpenAI 语义写的解析器（假定 usage chunk 的 choices 为空）在这里会漏读。

```
data: {"choices":[{"index":0,"delta":{"reasoning_content":"用户"},"finish_reason":null}],"usage":null}
data: {"choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}],"usage":null}
data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":18,...}}
data: [DONE]
```

**二、有 keep-alive。** 排队等推理时服务端持续下发 `: keep-alive` SSE 注释行（流式）或空行（非流式）。解析器必须跳过空行和 `:` 开头的行。服务端硬限是 **10 分钟内未开始推理则关闭连接**，客户端读超时要显著大于此值。

⚠️ `reasoning_content` 与 `content` 的**先后顺序官方没有明文承诺**。稳健做法是按 delta 里出现的 key 分流到两个缓冲区，不要假定"一旦出现 content 就不再有 reasoning_content"。
⚠️ 流式 `tool_calls` 分片规则文档未记载，建议按 OpenAI 惯例实现后抓包验证。

### 3.7 工具调用

格式与 OpenAI 一致，上限 128 个 function。**思考模式下支持工具调用**（V3.2 起，R1 时代不支持，这点变过）。

`strict` 严格模式需走 beta base URL，所有 function 都要 `strict: true`，object 必须 `additionalProperties: false`。支持 object / string / number / integer / boolean / array / enum / anyOf / `$ref`。

⚠️ 并行工具调用未核实。响应 schema 里 `tool_calls` 是数组，结构上允许多个，但无官方承诺。

### 3.8 特色能力

| 能力 | base URL | 端点 | 限制 |
|---|---|---|---|
| FIM 补全 | `/beta` | `POST /completions` | **仅 `deepseek-v4-pro`**，`prompt` 是前缀、`suffix` 是后缀，`max_tokens` 疑似 4K 上限（两处文档口径不一致） |
| Chat Prefix | `/beta` | `/chat/completions` | 末条 assistant 消息加 `prefix: true`，**必须是最后一条** |
| JSON Output | 主 URL | `/chat/completions` | 三条硬性条件见下 |
| 工具 strict | `/beta` | `/chat/completions` | 见上 |

JSON Output 的三个条件：`response_format={"type":"json_object"}`；**prompt 里必须出现 "json" 字样并给出目标格式示例**；`max_tokens` 要给足。官方承认"the API may occasionally return empty content"，**适配层必须处理 content 为空的情况并重试**，不能直接 `json.loads`。

### 3.9 错误与限流

| Code | 含义 | 可重试 |
|---|---|---|
| 400 | Invalid Format | ❌ |
| 401 | Authentication Fails | ❌ |
| **402** | **Insufficient Balance** | ❌ 告警充值 |
| 422 | Invalid Parameters | ❌ |
| 429 | Rate Limit Reached | ✅ |
| 500 | Server Error | ✅ |
| 503 | Server Overloaded | ✅ |

并发上限：`deepseek-v4-pro` **500**，`deepseek-v4-flash` **2500**。超了直接 429，可通过官方表单免费申请扩容。

⚠️ 不返回任何限流头，`error` 信封的精确形状文档也没给示例（按 OpenAI 惯例应为 `{"error":{...}}`，但无背书，解析要对缺失字段容错）。

---

## 4. 智谱 GLM

### 4.1 端点与鉴权

```
国内  https://open.bigmodel.cn/api/paas/v4/chat/completions
国际  https://api.z.ai/api/paas/v4/chat/completions
Authorization: Bearer YOUR_API_KEY
```

**JWT 签名已废除。** 官方 quick-start 的 curl 示例里完全没有密钥对、签名、`exp`/`timestamp` payload 这些东西。如果你的 key 形如 `xxx.yyy`，整串原样作 Bearer。历史 SDK（zhipuai < 2.x）里的 `generate_token()` 可以删掉。

三套端点并存：原生/OpenAI 兼容（`Bearer`）、Anthropic 兼容（`/api/anthropic` → `/v1/messages`，**`x-api-key`**）、Agent API（国际站 `POST /v1/agents`）。

⚠️ **两站模型目录不一致**：`glm-5-turbo`、`glm-5v-turbo` 只在国内站；`glm-4.5-x`、`glm-4-32b-0414-128k` 只在国际站。**适配层要按站点维护两张白名单，不能共用。**

### 4.2 请求

```json
{
  "model": "glm-5.3",
  "messages": [
    {"role": "system", "content": "你是 GETSSH 内置的运维助手。"},
    {"role": "user", "content": "web-01 的 nginx 起不来"}
  ],
  "thinking": {"type": "enabled", "clear_thinking": false},
  "reasoning_effort": "high",
  "do_sample": true,
  "temperature": 0.8,
  "max_tokens": 4096,
  "stream": true,
  "tool_stream": true,
  "tool_choice": "auto",
  "request_id": "req-8f3c1a90-2b7e-4d55-9a01-cc1d0e77aa31",
  "user_id": "tenant-000123-user-4471"
}
```

智谱私有字段与值域约束：

| 字段 | 约束 |
|---|---|
| `do_sample` | 默认 `true`。**`false` 时 `temperature` / `top_p` 失效，走确定性输出** |
| `temperature` | **`[0.0, 1.0]` 两位小数**，非 OpenAI 的 `[0,2]`。默认值随模型系列变：GLM-5.x/4.7/4.6 = 1.0，GLM-4.5 = 0.6 |
| `top_p` | `[0.01, 1.0]` 两位小数 |
| `max_tokens` | `[1, 131072]`，实际上限按模型 |
| `stop` | **最多 4 个** |
| `tools` | 最多 128 个 |
| `tool_choice` | **仅支持 `"auto"`**，没有 `none` / `required` / 指定函数 |
| `tool_stream` | 工具参数流式，仅 GLM-5.3/5.2/5.1/5/4.7/4.6 |
| `request_id` | 6–64 字符，需自行保证唯一 |
| `user_id` | 6–128 字符（**不是 OpenAI 的 `user`**） |
| `response_format` | `text` / `json_object`，**无 `json_schema`** |

> **`tool_choice` 只有 `auto` 是个实打实的能力缺口。** 上层要 `none` 就别传 `tools`；要 `required` 或指定函数，**在智谱这边没有等价实现**，只能客户端侧兜底（比如把提示词写死，或者拿到回答后校验重试）。

多模态 content：`image_url`（<5MB，≤6000×6000）、`video_url`（**仅 URL 不支持 Base64**，<200MB，GLM-5/4.6V 最多 2 个视频）、`file`（<50MB，pdf/word/xlsx/pptx 等）。

### 4.3 响应

```json
{
  "id": "20260828153012a1b2c3d4",
  "request_id": "req-8f3c...",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "…",
      "reasoning_content": "…",
      "tool_calls": [...]
    },
    "finish_reason": "tool_calls"
  }],
  "usage": {
    "prompt_tokens": 132,
    "completion_tokens": 415,
    "total_tokens": 547,
    "prompt_tokens_details": {"cached_tokens": 96}
  },
  "web_search": [...],
  "content_filter": []
}
```

`finish_reason` 私有值见 §2.5。`reasoning_content` 与 `content` 并列，GLM-4.5+ 支持。

### 4.4 流式

```
data: {"id":"1","created":1677652288,"model":"glm-5.2","choices":[{"index":0,"delta":{"content":"春"},"finish_reason":null}]}
data: {"id":"1","created":1677652288,"model":"glm-5.2","choices":[{"index":0,"finish_reason":"stop","delta":{"role":"assistant","content":""}}],"usage":{"prompt_tokens":8,"completion_tokens":262,"total_tokens":270}}
data: [DONE]
```

- 发 `[DONE]`
- **`usage` 默认就在最后一个 chunk 返回，不需要 `stream_options.include_usage`**（⚠️ 传了会被忽略还是报 1214 未核实）
- **chunk 里没有 `object` 字段**，反序列化时设为可选
- 最终 chunk 的 delta 会重新出现 `role:"assistant"` + `content:""`，不要当成新消息
- 思考内容走 `delta.reasoning_content`

工具分片需要 `stream=true` + `tool_stream=true`，官方明说分片"without buffering or JSON validation"，**不保证是合法 JSON 前缀，别边收边 parse**。按 `delta.tool_calls[].index` 拼接。

### 4.5 工具

`tools[].type` 四种并列：**`function` / `web_search` / `retrieval` / `mcp`**（`mcp` 为新增，国际站文档未列）。

```json
{"type": "web_search", "web_search": {
  "enable": true, "search_engine": "search_pro_jina", "count": 10,
  "search_recency_filter": "oneWeek", "content_size": "medium",
  "result_sequence": "after", "search_result": true, "require_search": false
}}
```

```json
{"type": "retrieval", "retrieval": {"knowledge_id": "kb_123", "prompt_template": "{{knowledge}} {{question}}"}}
```

内置工具的调用也会出现在 `tool_calls` 里，`type` 可为 `function` / `web_search` / `retrieval`。

⚠️ 并行工具调用未核实，文档未提 `parallel_tool_calls`。

### 4.6 思考

`thinking: {type: "enabled"|"disabled", clear_thinking: bool}` + `reasoning_effort`（7 档：`max`/`xhigh`/`high`/`medium`/`low`/`minimal`/`none`，默认 `max`）。

默认开启思考的模型：GLM-5.3、GLM-5.3-Flash、GLM-5.2、GLM-5.1、GLM-5、GLM-4.7。

⚠️ **GLM-5.3 与 GLM-5.3-Flash 强制思考，传 `disabled` 无效。** 低延迟场景只能降级到 GLM-4.7 / 4.6。

`clear_thinking: false` = 跨轮保留推理（Preserved Thinking），`true`（默认）= 轮间清除。

### 4.7 错误

**信封有两种形状，文档自相矛盾，两种都要兼容**：

```json
{"error": {"code": "1214", "message": "..."}}      // 错误码页
{"code": 1214, "message": "..."}                   // 接口参考页
```

先探 `body.error.code`，回落到 `body.code`，统一 `str()` 后比较。

主要错误码：

| code | HTTP | 含义 | 可重试 |
|---|---|---|---|
| 1000/1001/1003 | 401 | 鉴权失败 | ❌ |
| **1113** | **429** | **账户欠费 / 无资源包** | ❌ 伪 429 |
| 1210–1215 | 400 | 参数类（1214 参数非法、1215 参数互斥） | ❌ |
| 1261 | 400 | Prompt 超长 | ❌ |
| **1301** | 400 | **内容安全审核不通过**（请求级） | ❌ |
| **1302** | 429 | **账户触发速率限制** | ✅ |
| **1305** | 429 | **模型访问量过大** | ✅ |
| 1308–1321 | 429 | 用量 / 订阅额度违规 | ❌ |
| 1200/1230/1234 | 500 | 服务端 | ✅ |

注意 `1301` 是**请求级**内容拦截（HTTP 400），`finish_reason: "sensitive"` 是**生成级**拦截（HTTP 200）。两条路径都要接。

⚠️ 限流数值不在文档里，要登控制台看；是否返回限流头未核实。

### 4.8 Batch

`POST /api/paas/v4/batches`，JSONL 每行的 `url` 是 **`/v4/chat/completions`**（不含 `/api/paas` 前缀，和同步端点写法不同）。单文件 50,000 条 / 100MB，价格是标准价 50%，无并发限制。

⚠️ Batch 文档的支持模型列表仍停留在 GLM-4 时代，未列 GLM-5.x / 4.7。上生产前要实测。

### 4.9 OpenAI 兼容度

用 OpenAI SDK 直连时的差异清单：

| 项 | 行为 |
|---|---|
| `temperature` | 值域 `[0,1]`，超界报 1214 |
| `temperature=0` | 官方明示**在智谱的 OpenAI 实现中不适用**，确定性输出必须用原生 `do_sample:false`，而 OpenAI SDK 没这个字段 |
| `tool_choice` | `none` / `required` / 指定函数全不支持 |
| `response_format` | 无 `json_schema` |
| `user` | 智谱叫 `user_id`，且有 6–128 字符校验 |
| `presence_penalty` / `frequency_penalty` / `logit_bias` / `logprobs` / `seed` | ⚠️ 均不在支持列表，大概率静默忽略 |
| 私有字段 | `do_sample` / `thinking` / `reasoning_effort` / `tool_stream` / `request_id` / `user_id` 要走 `extra_body` 透传 |
| 响应额外字段 | `reasoning_content` / `request_id` / `web_search` / `content_filter` 会被 OpenAI SDK 的 Pydantic 模型丢弃，需从 `model_extra` 取 |

### 4.10 缓存

隐式，无需配置，无 `cache_control` 断点。命中回报 `usage.prompt_tokens_details.cached_tokens`。

官方文档说折扣"通常为标准价格的 50%"，但定价表实际约为输入价的 **15–20%**（GLM-5.3：$1.4 vs $0.26）。**以定价表为准。**

⚠️ 最小 token 阈值与 TTL 未核实。**缓存存储促销 2026-09-09 24:00 (UTC+8) 到期**，之后可能开始计费，成本模型里要留位。

---

## 5. Moonshot Kimi

### 5.1 端点

| 区域 | 文档站 | API Base |
|---|---|---|
| 国际 | `platform.kimi.ai` | `https://api.moonshot.ai` |
| 国内 | `platform.kimi.com`（`platform.moonshot.cn` 302 至此） | `https://api.moonshot.cn` |

**国内外账号与 key 不通用**，是两套独立体系。

三套协议兼容层并存：OpenAI Chat Completions（`/v1/chat/completions`）、OpenAI Responses（`/v1/responses`）、**Anthropic Messages（`/anthropic/v1/messages`）**。

⚠️ **Anthropic 兼容端点用的是 `Authorization: Bearer`，不是 Anthropic 原生的 `x-api-key`**。是否需要 `anthropic-version` 头文档没写，建议兼容性地带上。

`/v1/caching`（旧的显式 Context Caching 端点）**已经不在端点表里了**。

### 5.2 模型与定价

USD / 1M tokens：

| model ID | 上下文 | 最大输出 | 推理 | 视觉 | 缓存命中 | 未命中 | 输出 |
|---|---|---|---|---|---|---|---|
| `kimi-k3` | 1,048,576 | 默认 131,072 / 上限 1,048,576 | 始终 | ✅ 图+视频 | $0.30 | $3.00 | $15.00 |
| `kimi-k2.6` | 262,144 | ⚠️ 未核实 | 可开关 | ✅ | $0.16 | $0.95 | $4.00 |
| `kimi-k2.7-code` | 262,144 | ⚠️ 未核实 | 强制 | ✅ | $0.19 | $0.95 | $4.00 |
| `kimi-k2.7-code-highspeed` | 262,144 | ⚠️ 未核实 | 强制 | ✅ | $0.38 | $1.90 | $8.00 |

`highspeed` 吞吐约 180–260 tokens/s，价格是标准版两倍。`kimi-k3` 标称 28T 参数。

⚠️ `models.md` 的概览表把 k2.7-code 标为无视觉，但 vision 专页说四个模型全支持视觉。两处冲突，建议实测。

### 5.3 被锁死的采样参数

**这是接 Kimi 时对工程影响最大的一条。** 官方原文：*"Fixed" means the parameter cannot be modified: **passing any other value returns an error, so do not pass it explicitly.***

| 参数 | 固定值 |
|---|---|
| `temperature` | k3 / k2.7-code = **1.0**；k2.6 = 1.0（thinking）/ 0.6（non-thinking） |
| `top_p` | **0.95** |
| `n` | **1** |
| `presence_penalty` | **0** |
| `frequency_penalty` | **0** |

**适配层必须在出站前把这五个字段 strip 掉。** 几乎所有 OpenAI 风格客户端都会默认带 `temperature`，不处理就是全量 400。

历史上传闻的"temperature 内部折半"已经没有意义，这个参数现在根本不能传。

### 5.4 请求

```json
{
  "model": "kimi-k3",
  "messages": [
    {"role": "system", "content": "You are Kimi, an AI assistant provided by Moonshot AI."},
    {"role": "user", "content": "web-01 的 nginx 起不来"}
  ],
  "max_completion_tokens": 32768,
  "reasoning_effort": "high",
  "stream": true,
  "stream_options": {"include_usage": true},
  "tool_choice": "auto",
  "tools": [...]
}
```

字段要点：

| 字段 | 说明 |
|---|---|
| `max_completion_tokens` | **主字段，不是 `max_tokens`** |
| `reasoning_effort` | **仅 K3**：`low` / `high` / `max`（默认 `max`） |
| `thinking` | **仅 K2.6 / K2.7-code**：`{type: "enabled"\|"disabled", keep: null\|"all"}`。**k2.7-code 只接受 `enabled`，且无论传什么 `keep` 都按 `all` 处理** |
| `tool_choice` | K3 支持 `auto`/`none`/`required`/指定函数；**K2.6 与 K2.7-code 只支持 `auto`/`none`** |
| `stop` | 最多 5 条，每条 ≤32 bytes |
| `partial` | 放在**最后一条 assistant 消息内**，开启 Partial Mode |
| `response_format` | `text` / `json_object` / **`json_schema`**（三家里唯一支持严格结构化输出的） |
| `prompt_cache_key` | 相似请求路由到同一缓存 |
| `prediction` | 预测输出，缓存优化 |

**推理参数按模型分派**：K3 用 `reasoning_effort`，K2.x 用 `thinking`。两者不能混。

多模态：`image_url`（Base64 或 `ms://<file-id>`）、`video_url`。请求体 ≤100MB，图片 ≤4K，视频 ≤FHD，**图片数量无上限**。

### 5.5 响应

```json
{
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "...",
      "reasoning_content": "...",
      "tool_calls": [...]
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 19,
    "completion_tokens": 21,
    "total_tokens": 40,
    "cached_tokens": 10
  }
}
```

- `reasoning_content` 与 `content` 同级
- **`usage.cached_tokens` 是扁平字段**，不是 OpenAI 的 `prompt_tokens_details.cached_tokens` 嵌套形式。归一化时注意
- `finish_reason` 只有 `stop` / `length` / `tool_calls`
- ⚠️ `content_filter` 在 Kimi 这边是 **HTTP 400 的 error type**，不是 finish_reason。内容风控要当请求失败处理

### 5.6 流式

标准 SSE，发 `[DONE]`。`stream_options.include_usage: true` 时在 `[DONE]` **之前**追加一个带 usage 的 chunk。

**思考内容的顺序是有明文承诺的**，官方原文：*"In streaming output (`stream=True`), the `reasoning_content` field will always appear before the `content` field."*

也就是说 `delta.reasoning_content` 分片**全部先于** `delta.content` 分片。适配层可以据此做状态机：**见到第一个 `delta.content` 就认为思考阶段结束**，不需要显式分隔事件。这是三家里唯一给了顺序保证的。

工具分片：首个 chunk 带 `id` + `function.name`，之后只有 `function.arguments` 增量，按 `index` 归并。

⚠️ **无 keep-alive 机制**。官方文档（含 auto-reconnect 页）没有任何心跳、空 chunk 或注释保活的说明，给的只是客户端重试循环（最多 100 次、间隔 1s），**无断点续传、无 stream ID 恢复**。读超时要自己设。

**网关硬超时 900 秒**，这是流式长任务的上限。

### 5.7 工具调用

标准 function calling 与 OpenAI 完全一致，**支持并行调用**。

消息序列必须严格成对：

```
system → user → assistant(tool_calls[]) → tool(tool_call_id=A) → tool(tool_call_id=B) → assistant(final)
```

官方强调：**必须把 assistant 那条带 `tool_calls` 的原始消息原样回填**再追加 `role:"tool"` 结果，否则报 `tool_call_id not found`。

#### `$web_search` builtin_function（Moonshot 特有，仍在）

```json
{"type": "builtin_function", "function": {"name": "$web_search"}}
```

**回传语义和普通工具完全不同**：客户端**不执行搜索**，只把模型给的 `arguments` **原样 stringify 后回传**，服务端在下一轮内部完成检索。

```json
{
  "role": "tool",
  "tool_call_id": "<call_id>",
  "name": "$web_search",
  "content": "<tool_call.function.arguments 原样 JSON.stringify>"
}
```

循环到 `finish_reason == "stop"` 为止。计费 **$0.005 / 次**（以 `finish_reason = tool_calls` 计），搜索结果 token 计入 `prompt_tokens`。

另有一套新的 `/v1/formulas` 官方工具体系（`web-search`、`code-runner`、`fetch`、`excel`、`memory` 等 12 个），用语义 URI 而非 `$` 函数名，四步流程，除 web-search 外当前免费。⚠️ 两套体系的取舍与弃用计划文档没说。建议先实现 `$web_search`（更简单、无额外往返）。

### 5.8 缓存

**已从显式 cache 对象改为全自动前缀缓存。** 官方原文：*"Context Caching is automatically enabled for all model requests"*。

| 维度 | 现状 |
|---|---|
| `/v1/caching` 端点 | **已不存在** |
| `X-Msh-Context-Cache` 等请求头 | **文档中已无任何提及** |
| cache ID / tag 引用 | 不再需要 |
| 最小可缓存前缀 | 前一次请求的 prompt tokens > **256** 才可能命中 |
| TTL | 系统自动管理，开发者不可干预 |
| usage 字段 | `usage.cached_tokens` |

K3 的命中/未命中价差是 **10 倍**（$0.30 vs $3.00），前缀稳定性直接决定成本。

### 5.9 特色能力

**文件**：`POST /v1/files`，purpose 取值 `file-extract` / `batch` / `batch_output` / `lambda` / `image` / `video`。单文件 ≤100MB，用户总量 ≤10GB，文件数 ≤1000。`GET /v1/files/{id}/content` 取解析结果。视觉场景用 `ms://<file_id>` 在 content block 里引用。

**Partial Mode**：末尾追加 `{"partial": true, "role": "assistant", "content": "前缀"}`，模型从该前缀续写。要点：`name` 字段会被当作输出前缀的一部分；**思考模型下必须把上一轮的 `reasoning_content` 一并回传**；`max_tokens` 要设够，确保截断发生在 content 阶段而非 thinking 阶段。

**Token 估算**：`POST /v1/tokenizers/estimate-token-count`，返回 `{"data": {"total_tokens": 80}}`。官方说法是**先判有无 `error` 字段，再取 `data.total_tokens`**。

**Batch**：`/v1/batches` 全套。**余额**：`GET /v1/users/me/balance`。

### 5.10 错误与限流

信封是**扁平两字段**，没有 `code` 也没有 `param`：

```json
{"error": {"type": "content_filter", "message": "The request was rejected because it was considered high risk"}}
```

429 有**三类语义完全不同**的 type，绝不能统一退避：

| `error.type` | 含义 | 处理 |
|---|---|---|
| `rate_limit_reached_error` | 并发 / RPM / TPM / TPD 超限，靠 message 文本区分 | ✅ 退避。**TPD 超限当天不可恢复，应熔断到次日** |
| `engine_overloaded_error` | 服务端容量压力 | ✅ 退避 |
| `exceeded_current_quota_error` | 余额不足或账号禁用 | ❌ 直接告警 |

其他关键错误：`404 resource_not_found_error` 是**下线模型走的路径**；`400 invalid_request_error` 有一条 "prompt tokens + max_tokens exceeds the model specification"，说明**输入与输出预算之和**受限，发送前要用估算接口预检；`499 client_closed_request`；**`504` 返回 HTML 页面不是 JSON**。

限流分级（组织级，按累计充值自动升档）：

| Tier | 累计充值 | 并发 | RPM | TPM | TPD |
|---|---|---|---|---|---|
| Tier0 | $1 | 1 | 3 | 500,000 | 1,500,000 |
| Tier1 | $10 | 50 | 200 | 2,000,000 | 无限 |
| Tier2 | $20 | 100 | 500 | 3,000,000 | 无限 |
| Tier3 | $100 | 200 | 5,000 | 3,000,000 | 无限 |
| Tier4 | $1,000 | 400 | 5,000 | 4,000,000 | 无限 |
| Tier5 | $3,000 | 1,000 | 10,000 | 5,000,000 | 无限 |

**Tier0 是并发 1、RPM 3**，联调阶段特别注意。

⚠️ 不返回 `x-ratelimit-*` 头（文档完全未提及）。适配层要自己按 tier 维护并发信号量 + 令牌桶，用 429 的 `error.type` 做反馈信号。

---

## 6. 实施清单

### P0 · 不做会直接报错

1. **换掉所有旧 model ID**：`deepseek-chat` / `deepseek-reasoner` / `moonshot-v1-*` / `kimi-k2.5` / `kimi-latest` 全部 404。
2. **Kimi 出站 strip 五个采样参数**：`temperature` / `top_p` / `n` / `presence_penalty` / `frequency_penalty`。
3. **Kimi 字段改名**：`max_tokens` → `max_completion_tokens`。
4. **智谱 `temperature` clamp 到 `[0,1]`**，两位小数。确定性输出走 `do_sample: false` 而非 `temperature: 0`。
5. **删掉智谱的 JWT 签名代码。**
6. **`finish_reason` 用宽松字符串解析**，显式处理智谱的 `sensitive` / `network_error` / `model_context_window_exceeded` 和 DeepSeek 的 `insufficient_system_resource`。
7. **DeepSeek 带 tools 的多轮必须回传全部历史 `reasoning_content`**，包括没调工具的轮次。
8. **Kimi 工具循环必须回填 assistant 原消息**，否则 `tool_call_id not found`。

### P1 · 会导致体验或成本问题

9. **429 按业务 code 分流**：智谱只有 `1302`/`1305` 值得重试，`1113` 是欠费；Kimi 只有 `rate_limit_reached_error`/`engine_overloaded_error` 值得重试；DeepSeek 的欠费是独立的 402。
10. **限流用并发信号量而非令牌桶**，三家都不返回限流头。
11. **SSE 解析器加固**：跳过 DeepSeek 的 `: keep-alive` 与空行；智谱的 `object` 字段设为可选；Kimi 的 504 先判 Content-Type 再解析。
12. **DeepSeek 的 usage 搭在最后一个内容 chunk 上**，不是独立空 choices chunk。
13. **缓存前缀字节级稳定**：system prompt + 工具定义置顶且不变。DeepSeek 30 倍、Kimi 10 倍、智谱 5 倍的价差都靠这个。
14. **智谱 `tool_choice` 只有 `auto`**，`required` 与指定函数在客户端侧兜底。
15. **Kimi K2.6 / K2.7-code 的 `tool_choice` 不支持 `required`**，要降级。
16. **DeepSeek 排到 UTC 10:00 之后或周末，省 50%。**

### P2 · 长期维护

17. **智谱国内站与国际站维护两张独立模型白名单。**
18. **Kimi 国内外账号与 key 不通用**，配置里要分开。
19. **DeepSeek JSON Output 可能返回空 content**，必须重试而不是直接 parse。
20. **三家的 `user` 字段名都不是 `user`**：DeepSeek 和智谱都叫 `user_id`（智谱还有 6–128 字符校验），Kimi 叫 `safety_identifier`。

---

## 7. 未核实清单

**DeepSeek**
- 美元定价（EN 价格页是 SPA，抓不到）
- CoT token 上限
- 流式 `reasoning_content` 与 `content` 的先后顺序（无官方承诺）
- 流式 `tool_calls` 的分片规则（文档未记载）
- 并行工具调用支持情况
- `response_format` 是否支持 `json_schema`
- 缓存的最小 token 粒度
- `error` 信封的精确形状、是否返回限流头

**智谱 GLM**
- 国内站人民币定价（页面 JS 渲染）
- `stream_options.include_usage` 传了会怎样
- 并行工具调用
- `web_search.search_engine` 的全部取值
- `reasoning_effort: "none"` 与 `thinking.type: "disabled"` 同传是否触发 1215
- 缓存最小 token 阈值与 TTL
- 是否返回限流头
- Batch 是否支持 GLM-5.x（文档列表停留在 GLM-4 时代）

**Kimi**
- K2.6 / K2.7-code 的 max output tokens
- 是否返回 `x-ratelimit-*` 头
- `finish_reason` 是否可能取 `content_filter`
- 流式是否有心跳机制
- Anthropic 端点是否需要 `anthropic-version` 头
- `kimi-k2.7-code` 的视觉支持（两处文档冲突）
- `$web_search` 与 `/v1/formulas` 的取舍与弃用计划
- 缓存存储费

---

## 8. 待补：第三册

本册未覆盖，额度恢复后补：

- **MiniMax** — 端点路径（`/v1/text/chatcompletion_v2` 是否已改）、`base_resp` 包装是否还在（错误包在 200 响应里）、`tools[].function.parameters` 是对象还是字符串化 JSON、UTF-8 多字节字符在 chunk 边界被切断的历史问题现状
- **千问 / DashScope** — 原生 `input`/`parameters` 嵌套形状与 OpenAI 兼容模式的取舍、`incremental_output`、`enable_thinking`、Qwen3 系列现状
- **通用适配器** — OpenAI 兼容层的可移植子集、Ollama / vLLM / LM Studio 本地端点的差异

---

## 附：来源

**DeepSeek**
- [首页 / 首次调用](https://api-docs.deepseek.com/) · [Change Log](https://api-docs.deepseek.com/updates/) · [V4 发布](https://api-docs.deepseek.com/news/news260424/) · [V4-Pro GA](https://api-docs.deepseek.com/news/news260813/) · [Vision-Exp](https://api-docs.deepseek.com/news/news260821/)
- [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/) · [FIM Completion](https://api-docs.deepseek.com/api/create-completion/) · [List Models](https://api-docs.deepseek.com/api/list-models)
- [模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) · [思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode) · [工具调用](https://api-docs.deepseek.com/guides/tool_calls)
- [上下文缓存](https://api-docs.deepseek.com/guides/kv_cache) · [JSON 输出](https://api-docs.deepseek.com/guides/json_mode) · [FIM](https://api-docs.deepseek.com/guides/fim_completion) · [Prefix 补全](https://api-docs.deepseek.com/guides/chat_prefix_completion)
- [错误码](https://api-docs.deepseek.com/quick_start/error_codes) · [限流](https://api-docs.deepseek.com/quick_start/rate_limit) · [Anthropic 兼容](https://api-docs.deepseek.com/guides/anthropic_api) · [Responses API](https://api-docs.deepseek.com/guides/responses_api/)

**智谱 GLM**
- [对话补全 API](https://docs.bigmodel.cn/api-reference/%E6%A8%A1%E5%9E%8B-api/%E5%AF%B9%E8%AF%9D%E8%A1%A5%E5%85%A8.md) · [模型总览](https://docs.bigmodel.cn/cn/guide/start/model-overview.md) · [快速开始](https://docs.bigmodel.cn/cn/guide/start/quick-start.md)
- [思考模式](https://docs.bigmodel.cn/cn/guide/capabilities/thinking-mode.md) · [流式输出](https://docs.bigmodel.cn/cn/guide/capabilities/streaming.md) · [Function Calling](https://docs.bigmodel.cn/cn/guide/capabilities/function-calling.md) · [上下文缓存](https://docs.bigmodel.cn/cn/guide/capabilities/cache.md)
- [错误码](https://docs.bigmodel.cn/cn/api/api-code.md) · [速率限制](https://docs.bigmodel.cn/cn/api/rate-limit.md) · [Batch](https://docs.bigmodel.cn/cn/guide/tools/batch.md)
- [Claude 兼容](https://docs.bigmodel.cn/cn/guide/develop/claude/introduction.md) · [OpenAI 兼容](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction.md)
- [Z.ai Chat Completion](https://docs.z.ai/api-reference/llm/chat-completion.md) · [Z.ai Pricing](https://docs.z.ai/guides/overview/pricing.md) · [Z.ai Tool Streaming](https://docs.z.ai/guides/capabilities/stream-tool.md) · [Z.ai Agent](https://docs.z.ai/api-reference/agents/agent.md)

**Kimi**
- [API 总览](https://platform.kimi.ai/docs/api/overview.md) · [Chat](https://platform.kimi.ai/docs/api/chat.md) · [模型总览](https://platform.kimi.ai/docs/api/models-overview.md) · [模型](https://platform.kimi.ai/docs/models.md) · [Changelog](https://platform.kimi.ai/docs/platform-changelog.md)
- [错误](https://platform.kimi.ai/docs/api/errors.md) · [限流与定价](https://platform.kimi.ai/docs/pricing/limits.md) · [K3 定价](https://platform.kimi.ai/docs/pricing/chat-k3.md) · [工具定价](https://platform.kimi.ai/docs/pricing/tools.md)
- [上下文缓存](https://platform.kimi.ai/docs/guide/use-context-caching-feature-of-kimi-api.md) · [Web Search](https://platform.kimi.ai/docs/guide/use-web-search.md) · [官方工具](https://platform.kimi.ai/docs/guide/use-official-tools.md) · [工具调用](https://platform.kimi.ai/docs/guide/use-kimi-api-to-complete-tool-calls.md)
- [思考模型](https://platform.kimi.ai/docs/guide/use-thinking-models.md) · [Partial Mode](https://platform.kimi.ai/docs/guide/use-partial-mode-feature-of-kimi-api.md) · [视觉模型](https://platform.kimi.ai/docs/guide/use-kimi-vision-model.md) · [文件上传](https://platform.kimi.ai/docs/api/files-upload.md) · [Token 估算](https://platform.kimi.ai/docs/api/estimate.md)
