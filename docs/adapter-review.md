# GETSSH LLM 适配层代码审查

审查范围：`apps/getssh-client/electron/main/services/ai/*`（7 个适配器 + 网关 + 类型，约 3000 行），外加 `services/AgentEngine.ts` 的工具循环。
对照基准：本次实抓的官方文档（第一册御三家 + 第二册国内三家）。
结论：**骨架是对的，但有 11 处会直接导致线上失败或静默数据损坏的问题，其中 3 处在任何 agent 多轮场景下必然触发。**

先说公道话：Zhipu 和 Kimi 两个适配器写得相当扎实（temperature clamp、do_sample、1113/1302 分流、504 HTML 判定、采样参数 strip、按模型分派思考参数），说明它确实读了规格。问题集中在**御三家的推理块回传**和**agent 循环**这两块。

---

## P0 · 必然触发

### 1. Anthropic 多个 thinking 块被压成一个，签名张冠李戴

`AnthropicAdapter.ts:196-199, 269-281`

```ts
let fullReasoning = '';
let redactedData  = '';
let signature     = '';      // ← 单例
```

`signature_delta` 每来一次就覆盖上一个，`thinking_delta` 全部拼进同一个字符串。最后只 push **一个** thought 块，带**最后一个**签名和**全部**思考文本。

Opus 5 / Sonnet 5 的 adaptive thinking 默认开启且 interleaved，一个 tool-use turn 里出现 `thinking → tool_use → thinking → tool_use` 是常态。回传时签名和内容对不上，Anthropic 直接 **400**。官方要求是「同一个 tool-use turn 内 thinking + redacted_thinking 块必须完整、原样、按原序回传」。

**修法**：按 content block `index` 建 Map，每个 index 一个 `{type, text, signature, data}`，输出时按 index 升序展开成 N 个 thought 块。

### 2. OpenAI reasoning item 同样被压成一个，而且回传缺 `id`

`OpenAiAdapter.ts:193, 226-246, 71-78`

`encryptedContent` 也是单个 `let`，多个 reasoning item 只留最后一个。回传时：

```ts
inputItems.push({ type: 'reasoning', encrypted_content: th.opaque });
```

没有 `id`。OpenAI 的 reasoning item 带 `rs_...` id，靠它和 function_call 配对。缺 id 的 reasoning item 要么被拒要么被忽略，两种都等于推理链断了。

**修法**：同上按 `item_id` 分桶；`Block` 加一个 `providerItemId` 字段带回去。

### 3. `MISSING_ENCRYPTED_CONTENT` 这个哨兵字符串会被当成真签名发回 API

`OpenAiAdapter.ts:275` → `OpenAiAdapter.ts:72`

```ts
opaque: encryptedContent || 'MISSING_ENCRYPTED_CONTENT'
```

下一轮 `if (th.opaque)` 判定为真，于是 `encrypted_content: "MISSING_ENCRYPTED_CONTENT"` 被发给 OpenAI。这不是降级，是往加密字段里塞垃圾。

**修法**：拿不到 encrypted_content 就**不要**建 thought 块的 opaque（留 undefined），回传时跳过。

### 4. Gemini 的工具结果永远叫 `unknown_tool`

`GeminiAdapter.ts:35, 51` 对照 `types.ts:10`

```ts
// GeminiAdapter 读的：
name: tr.name || 'unknown_tool'

// types.ts 里 tool_result 的真实定义：
| { kind: 'tool_result'; callId: string; content: (Block|string)[]; isError?: boolean }
//   ↑ 没有 name 字段
```

第 35 行用了一个自己编的类型谓词 `(b): b is { ... name?: string ... }`，把编译器骗过去了。运行时 `tr.name` 恒为 `undefined`，所以**每一个发给 Gemini 的 `function_result` 都叫 `unknown_tool`**。`AgentEngine.ts:207` 构造 tool_result 时也确实没带 name。

Gemini 的工具循环在这个适配器上是坏的，而且不会报错，只会让模型收到对不上号的结果。

**修法**：`Block` 的 `tool_result` 加 `name: string`，AgentEngine 填 `call.name`。

### 5. Gemini 的 thought_signature 也是单例

`GeminiAdapter.ts:177, 215-217, 248-254`

同 1 和 2。官方明确说「不要把带签名的 part 和不带签名的 part 合并，也不要把多个带签名的 part 拼在一起」。这里两条都犯了。而且因为 `store: false`（第 92 行，隐私上是对的），落在无状态分支，签名必须自己管——正好是做错的那条路。

### 6. 工具链 break 之后只回传部分 tool_result → 下一轮必然 400

`AgentEngine.ts:200-240`

```ts
for (const call of response.toolCalls) {
  ...
  if (toolInst?.isCritical !== false) { hasToolError = true; break; }   // ← 跳出
  ...
}
history.push({ role: 'user', blocks: toolResultBlocks });               // ← 只有部分结果
```

模型并行请求了 3 个工具，第 1 个失败就 break，历史里只有 1 个 tool_result。Anthropic 对「有 tool_use 但没有配对 tool_result」是**硬 400**，OpenAI 同理。

**修法**：不要 break。剩余调用一律补一条 `isError: true` 的 tool_result（内容写「因前序工具失败已跳过」），保证一一配对。

### 7. 只有 `shouldContinue` 为真才继续循环，工具结果经常发不出去

`AgentEngine.ts:227-251`

```ts
if (result.shouldContinue) shouldContinueLoop = true;
...
if (shouldContinueLoop && !hasToolError) { await runTurn(); return; }
onDone();   // ← 否则直接结束
```

模型请求了工具、工具跑完了、结果塞进了 history，然后**不发出去就结束了**。用户看到工具执行，然后没有下文。

继续与否应该由模型的意图决定（有 tool_call 就该回一轮），不是由某个工具的 `shouldContinue` 标志决定。而且 `hasToolError` 时不继续，等于模型永远看不到错误、没有机会自愈——那段错误文案还专门格式化给模型看了。

### 8. Anthropic 的 `tool_choice: 'none'` 被静默丢弃

`AnthropicAdapter.ts:132-134`

```ts
if (request.toolChoice === 'none') {
  // Can't pass 'none' directly in Anthropic, usually omitted. 
  // Wait, 'none' isn't supported, we just omit tools? We pass tool_choice explicitly.
}
```

空分支，注释里还留着模型自己的「Wait,」。结果是：调用方明确说了不要用工具，适配器什么都不发，Anthropic 默认 `auto`，**模型照样能调工具**。

Anthropic 是支持 `{"type":"none"}` 的。对一个 SSH 客户端来说，「不要调工具」很可能意味着「只读模式，别碰服务器」,这是安全语义。

### 9. DeepSeek 的 toolChoice 直接透传

`DeepSeekAdapter.ts:111`

```ts
requestBody.tool_choice = request.toolChoice || 'auto';
```

统一层的类型允许 `'any'`（Anthropic 的说法）和 `{type:'tool', name}`。DeepSeek 认的是 `none`/`auto`/`required`/`{type:'function',function:{name}}`。传 `'any'` 或对象形式一律 400。别的适配器都做了映射，唯独这个漏了。

### 10. 没有任何重试层，而且 `checkRateLimitError` 是死代码

`BaseAdapter.ts:115-136` — 全仓库无人调用（每个适配器各自内联实现了一遍）。

全仓库 grep `retry|backoff` 只有三处，全是注释和错误文案。所有「哪个 429 可以重试」的判断最后变成了一句字符串：

```ts
throw new Error(`OpenAI API Error (429): ... (QuotaExhausted=false)`);
```

上层要重试只能去 **字符串匹配** `QuotaExhausted=false`。

**修法**：定义 `LlmError extends Error { retryable: boolean; provider: string; code?: string; retryAfterMs?: number }`，在 `LlmGateway.streamTurn` 外面包一层指数退避。这是所有分流逻辑的落点，现在缺了它，前面那些细致的判断全是白做。

### 11. `stopReason` 全链路无人消费

`types.ts:64-72` 定义了 8 个 StopReason。`AgentExecutor` / `AgentEngine` / `aiHandler` / `llmService` 里 grep `stopReason`、`pause_turn`、`budget_exceeded`、`refusal`、`model_context_window_exceeded` —— **零命中**。

后果具体到两个：
- **Anthropic `pause_turn`**：server tool 循环到迭代上限，语义是「把 assistant content 原样回传即可继续」。现在直接当正常结束，任务半途而废。
- **Gemini `budget_exceeded`**：适配器算出来了（`GeminiAdapter.ts:242-244`），上层丢掉，用户看到的是一次没有解释的空回答。

---

## P1 · 会出问题，只是不一定每次

### 12. Gemini 把 API key 放进 URL query

`GeminiAdapter.ts:294`

```ts
const url = `${baseUrl}/models?key=${apiKey}`;
```

同一个请求里**还带了** `x-goog-api-key` 头（第 299 行），所以 query 那份纯属多余。key 进 URL 会落到代理日志、Referer、崩溃报告里。BYOK 产品上这是实打实的凭证泄漏路径。而且没有 `encodeURIComponent`。

**修法**：删掉 query 部分，只留头。

### 13. OpenAI 的 `strict` 默认开

`OpenAiAdapter.ts:123` — `strict: tool.strict ?? true`

strict 模式要求每个 object 都 `additionalProperties: false`、**所有** property 都进 `required`。手写的工具 schema 基本都不满足，结果是**只要带工具就 400**。默认应该是 `false`，只对专门为 strict 写过的 schema 打开。

### 14. OpenAI 的截断状态被 tool_use 覆盖

`OpenAiAdapter.ts:258-260` 设 `stopReason = 'max_tokens'`，`284-286` 无条件覆盖成 `'tool_use'`。一个**被截断的工具调用**（参数 JSON 残缺）会被当成有效的 tool_use 报上去，然后 `JSON.parse` 失败落进 `{_raw: ...}`，工具拿着垃圾参数执行。

另外 `incompleteDetails`（第 260 行）算出来之后**从没被用过**。

### 15. Gemini 的 thinking_level 映射把 `high` 压成 `medium`

`GeminiAdapter.ts:130-132`

```ts
xhigh|max → 'high'
low       → 'low'
其余      → 'medium'      // ← 'high' 落这里
```

用户选 high，实际发 medium。`minimal` 也被吞成 medium。

### 16. Zhipu 90 秒超时

`ZhipuAdapter.ts:163` — `AbortSignal.timeout(90000)`

GLM-5.3 强制思考、1M 上下文，90 秒远远不够。同一份代码里 DeepSeek 给了 15 分钟、Anthropic 10 分钟、OpenAI/Gemini 5 分钟。这个数明显是漏改的。

### 17. Zhipu 把 `network_error` 当成正常结束

`ZhipuAdapter.ts:254` — `else if (rawReason === 'network_error') stopReason = 'end_turn';`

`network_error` 是服务端推理异常，输出是**不完整的**。当成 `end_turn` 意味着把半截答案交给用户，还不告诉他。应该抛可重试错误。（相邻的 `sensitive` 处理得对，抛了。）

### 18. Zhipu 在调用方没指定时硬塞 temperature 0.6

`ZhipuAdapter.ts:146-147`

GLM-5.x 自己的默认是 1.0。不指定就该不发，让服务端用默认值。

### 19. DeepSeek 流式 tool_call 的 id/name 只在创建时取一次

`DeepSeekAdapter.ts:215-221`

```ts
if (!toolCallsMap.has(idx)) {
  toolCallsMap.set(idx, { id: tc.id || '', name: tc.function?.name || '', args: '' });
}
// 之后只累加 args，不再补 id / name
```

如果某个 index 的首个分片没带 id/name（各家在这点上不完全一致），后面永远补不上，`callId` 恒为 `''`，工具结果配不上号。

**修法**：每片都做 `if (tc.id) cur.id = tc.id; if (tc.function?.name) cur.name = tc.function.name;`

### 20. 三个御三家适配器都不校验流是否正常终止

OpenAI 只在 `response.failed` / `error` 时设 `hasStreamError`；Anthropic 只看 `error` 事件；Gemini 同理。**连接在终止事件之前断掉，代码会安静地返回一个 `stopReason: 'end_turn'` 的半截响应。**

规格里写得很明确：没收到终止事件就断开，一律按可重试失败处理。

**修法**：各自加一个 `sawTerminal` 布尔，流结束后为 false 就抛可重试错误。

### 21. Anthropic 缺模型能力门控

`AnthropicAdapter.ts:145-151` 无条件发 `output_config.effort` 和 `thinking`。但：
- **Haiku 4.5 不支持 effort** → 400
- **Fable 5 / Mythos 5 不能关思考**，收到 `{type:'disabled'}` → 400
- **Opus 5 在 effort 为 xhigh/max 时不允许 disabled** → 400

`max_tokens` 默认 65536（第 115 行）对老模型也会超限。

### 22. `request.signal` 会把超时保护顶掉

六个适配器统一写法：`signal: request.signal || AbortSignal.timeout(N)`。调用方一旦传了取消信号，**超时保护就没了**，请求可以永久挂着。

**修法**：`AbortSignal.any([request.signal, AbortSignal.timeout(N)].filter(Boolean))`

### 23. Sentinel 脱敏有三个漏点

`LlmGateway.ts:99-124`
- `tool_result.content` 里只有 **string 元素**过脱敏，`Block` 型元素（`{kind:'text'}`）直接放行。类型是 `(Block|string)[]`，两种都可能。
- `tool_call.args` **完全不脱敏**。这里面装的是主机名、路径、命令。
- `onThoughtChunk` **不做回填**（第 142-144 行），用户在思考区看到的是 `__HOST_1__` 这种占位符。

### 24. ConcurrencyManager 排队中的请求被取消后永久挂起

`ConcurrencyManager.ts:42-47`

```ts
return new Promise((resolve) => { queue.push(resolve); });
```

没有 reject 通道，不理会 AbortSignal。用户取消一个排队中的请求，这个 Promise 永远不 resolve，调用栈卡死，槽位也不会释放。Kimi 的限额设成了 2（第 12 行，注释还写着「set 5」），很容易排到队。

---

## P2

25. `DeepSeekAdapter.fetchModels`（278-293）没有 try/catch、没有 timeout、没有兜底列表——其余五个都有。设置页拉模型会卡住。
26. Zhipu / Kimi 把 `required` 静默降级成 `auto`，不给调用方任何信号。至少该在返回里带个 flag。
27. **根因**：`types.ts` 的 `Block` 缺两个字段——`tool_result.name`（Gemini 要）和 thought/tool_call 的 `providerItemId`（OpenAI 要）。前面 4 个 P0 里有 3 个是这里漏出去的。
28. 测试只覆盖单块 happy path。没有一条测多 thinking 块、多工具并行、断流、`tool_choice: none`、工具失败后的配对。这也是为什么上面这些能过。（顺带：这台机器上 vitest 跑不起来，`rolldown` 装的是 macOS 二进制。）

---

## 建议的修复顺序

1. **先改 `types.ts`**：`tool_result` 加 `name`，thought / tool_call 加 `providerItemId`。这是 4 个 P0 的地基。
2. **三个御三家适配器的推理块按 index/item_id 分桶**（问题 1、2、5），顺手删掉 `MISSING_ENCRYPTED_CONTENT`（问题 3）。
3. **AgentEngine 的工具循环**（问题 6、7）：补齐 tool_result 配对，改成有 tool_call 就继续。
4. **加 `LlmError` 和退避重试层**（问题 10），把 `checkRateLimitError` 接上或者删掉。
5. **消费 stopReason**（问题 11），至少接 `pause_turn` 和 `budget_exceeded`。
6. 剩下的 P1 按顺序清。

前三步不做，任何一个稍微复杂点的 agent 任务都跑不完；第 4、5 步不做，线上一遇到限流就是一串没人管的报错。
