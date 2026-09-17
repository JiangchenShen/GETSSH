import { BaseAdapter } from './BaseAdapter';
import { LlmRequest, LlmResponse, StreamCallbacks, Block, UnifiedTool, NormalizedUsage, StopReason, LlmError } from './types';
import { ConcurrencyManager } from './ConcurrencyManager';
import { ModelCaps } from './ModelCapabilities';

/**
 * 通义千问 / 阿里云百炼 DashScope 适配器
 *
 * 走 **原生 DashScope 模式**（/api/v1/services/aigc/text-generation/generation），
 * 不走 OpenAI 兼容模式。唯一理由但很硬：兼容模式不返回 search_info，
 * 联网搜索的引用溯源做不了 —— 运维场景里「这结论从哪查到的」是要给用户看的。
 *
 * 三个必须显式处理的 DashScope 特性：
 *   1. 报文是三段式 { model, input, parameters }，不是 messages 平铺；
 *   2. incremental_output 默认 false，返回的是**全量累计文本**而非增量。
 *      按 OpenAI 习惯每片 += 会得到 "II likeI like apple"。本适配器无条件传 true；
 *   3. SSE 的行形态是 `id:1` / `event:result` / `:HTTP_STATUS/200`，
 *      冒号后没有空格，且带 SSE 注释行。BaseAdapter.processSseStream 判 event 时
 *      要求 'event: ' 带空格，会漏掉 `event:result`，所以这里自己解析（见 readDashScopeSse）。
 *
 * 域名：官方已把 dashscope.aliyuncs.com 标为「建议迁移」，生产应走业务空间专属域名
 *   https://{WorkspaceId}.{region}.maas.aliyuncs.com
 * BYOK 场景下用户可能在任何 region / 计费模式，所以 endpoint 必须可配置。
 */

// 文档自相矛盾：deep-thinking 页称 thinking_budget 有效范围 1–32768，
// 各模型页却标最大思维链 262144。取保守值做上限校验。
const THINKING_BUDGET_CAP = 32768;

export class QwenAdapter extends BaseAdapter {
  readonly provider = 'qwen';

  async streamTurn(request: LlmRequest, callbacks: StreamCallbacks): Promise<LlmResponse> {
    const cm = ConcurrencyManager.getInstance();
    await cm.acquire(this.provider, request.signal);
    try {
      return await this.streamNativeApi(request, callbacks);
    } finally {
      cm.release(this.provider);
    }
  }

  private resolveHost(endpoint?: string): string {
    let base = endpoint || 'https://dashscope.aliyuncs.com';
    base = base
      .replace(/\/api\/v1\/services\/aigc\/text-generation\/generation\/?$/, '')
      .replace(/\/compatible-mode\/v1\/chat\/completions\/?$/, '')
      .replace(/\/compatible-mode\/v1\/?$/, '')
      .replace(/\/apps\/anthropic(\/v1\/messages)?\/?$/, '')
      .replace(/\/api\/v1\/?$/, '')
      .replace(/\/$/, '');
    return base;
  }

  /**
   * DashScope 专用 SSE 读取。
   * 与 BaseAdapter.processSseStream 的差别：
   *   - 按第一个 ':' 切分，容忍冒号后无空格（DashScope 发的是 `event:result`）
   *   - 显式跳过纯注释行（`:HTTP_STATUS/200`）
   *   - 按 bytes 增量解码，避免多字节字符被切在 chunk 边界
   */
  private async readDashScopeSse(
    response: Response,
    onEvent: (eventName: string, data: string) => void
  ): Promise<void> {
    if (!response.body) throw new Error('Response body is null');
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let currentEvent = 'message';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const rawLine of lines) {
          const line = rawLine.replace(/\r$/, '');
          if (!line) { currentEvent = 'message'; continue; }

          const colon = line.indexOf(':');
          // 冒号在第 0 位 = SSE 注释行，例如 `:HTTP_STATUS/200`，直接丢弃
          if (colon === 0) continue;
          if (colon === -1) continue;

          const field = line.slice(0, colon);
          let val = line.slice(colon + 1);
          if (val.startsWith(' ')) val = val.slice(1);

          if (field === 'event') currentEvent = val.trim();
          else if (field === 'data') onEvent(currentEvent, val);
          // id: / retry: 忽略
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private classifyError(status: number, body: any): { message: string; code: string; retryable: boolean } {
    // DashScope 原生：{ code, message, request_id }
    // 兼容模式包成 OpenAI 风格：{ error: { code, message, type } }
    const code = String(body?.code || body?.error?.code || status);
    const message = body?.message || body?.error?.message || `HTTP ${status}`;
    const reqId = body?.request_id ? ` [request_id=${body.request_id}]` : '';

    // 403 是额度耗尽 / 无权限，重试没有意义；429 才是限流。
    const retryable = status === 429 || status >= 500 || /^Throttling/i.test(code);
    return { message: message + reqId, code, retryable };
  }

  private async streamNativeApi(request: LlmRequest, callbacks: StreamCallbacks): Promise<LlmResponse> {
    const url = `${this.resolveHost(request.endpoint)}/api/v1/services/aigc/text-generation/generation`;
    const modelName = request.model || 'qwen3.8-max';
    const { systemInstruction, turns } = this.normalizeTurns(request);

    // callId -> 工具名，用于回填 tool_result 缺失的 name
    const toolNameByCallId = new Map<string, string>();
    for (const turn of turns) {
      for (const b of turn.blocks) {
        if (b.kind === 'tool_call' && b.callId && b.name) toolNameByCallId.set(b.callId, b.name);
      }
    }

    const messages: any[] = [];
    if (systemInstruction) {
      messages.push({ role: 'system', content: [{ text: systemInstruction }] });
    }

    for (const turn of turns) {
      if (turn.role === 'user') {
        const parts: any[] = [];
        for (const b of turn.blocks) {
          if (b.kind === 'text') parts.push({ text: b.text });
          else if (b.kind === 'image') parts.push({ image: `data:${b.mime};base64,${b.data}` });
        }
        if (parts.length > 0) messages.push({ role: 'user', content: parts });

        for (const b of turn.blocks) {
          if (b.kind !== 'tool_result') continue;
          const outText = b.content
            .map(c => (typeof c === 'string' ? c : c.kind === 'text' ? c.text : JSON.stringify(c)))
            .join('\n');
          messages.push({
            role: 'tool',
            name: b.name || toolNameByCallId.get(b.callId) || undefined,
            tool_call_id: b.callId,
            content: outText
          });
        }
      } else if (turn.role === 'assistant') {
        const textParts = turn.blocks
          .filter((b): b is { kind: 'text'; text: string } => b.kind === 'text')
          .map(b => b.text).join('\n');
        const reasoning = turn.blocks
          .filter((b): b is { kind: 'thought'; text?: string } => b.kind === 'thought')
          .map(b => b.text || '').join('\n').trim();
        const toolCalls = turn.blocks
          .filter((b): b is { kind: 'tool_call'; callId: string; name: string; args: any; raw: string } => b.kind === 'tool_call')
          .map(tc => ({
            id: tc.callId, type: 'function',
            function: { name: tc.name, arguments: tc.raw || JSON.stringify(tc.args || {}) }
          }));

        const msg: any = { role: 'assistant', content: textParts || '' };
        if (toolCalls.length > 0) msg.tool_calls = toolCalls;
        if (reasoning) msg.reasoning_content = reasoning;
        messages.push(msg);
      }
    }

    const parameters: any = {
      // 不显式传的话默认是 "text"，返回扁平 output.text 而不是 output.choices[]
      result_format: 'message',
      // 默认 false 会返回全量累计文本，且默认值本身随模型而变。无条件传 true。
      incremental_output: true
    };

    const caps = ModelCaps.resolve(this.provider, modelName);

    if (request.maxOutputTokens) parameters.max_completion_tokens = request.maxOutputTokens;
    if (caps.supportsSampling && request.temperature !== undefined) {
      parameters.temperature = Math.max(0, Math.min(request.temperature, 1.999));
    }

    if (!caps.supportsThinking) {
      // 未知型号：enable_thinking / thinking_budget 都不发
    } else if (request.thinkingEffort === 'none' && caps.thinkingCanBeDisabled) {
      parameters.enable_thinking = false;
    } else if (request.thinkingEffort || request.thinkingLevel || request.thinkingBudget) {
      parameters.enable_thinking = true;
      if (request.thinkingBudget) {
        parameters.thinking_budget = Math.max(1, Math.min(request.thinkingBudget, THINKING_BUDGET_CAP));
      }
    }

    if (request.tools && request.tools.length > 0) {
      // 注意：tools / tool_choice 在 parameters 里，不是请求体顶层。
      parameters.tools = request.tools.map((tool: UnifiedTool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters }
      }));

      if (request.toolChoice === 'none') {
        parameters.tool_choice = 'none';
      } else if (typeof request.toolChoice === 'object' && request.toolChoice.name) {
        parameters.tool_choice = { type: 'function', function: { name: request.toolChoice.name } };
      } else {
        // DashScope 的思考模式不支持强制指定工具，'required'/'any' 一律降级为 auto。
        parameters.tool_choice = 'auto';
      }
      parameters.parallel_tool_calls = true;
    }

    if (!request.apiKey) {
      throw new LlmError('未检测到有效的 API Key。请先在 AI 设置中保存您的阿里云百炼 API Key。', {
        retryable: false, provider: this.provider, code: 'no_api_key'
      });
    }

    const timeoutSignal = AbortSignal.timeout(600000);
    const signal = request.signal
      ? ((AbortSignal as any).any ? (AbortSignal as any).any([request.signal, timeoutSignal]) : request.signal)
      : timeoutSignal;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${request.apiKey}`,
        // 原生模式的流式开关是这个头，不是 body 里的 stream 字段
        'X-DashScope-SSE': 'enable'
      },
      body: JSON.stringify({ model: modelName, input: { messages }, parameters }),
      signal
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => null);
      const { message, code, retryable } = this.classifyError(response.status, errJson);
      throw new LlmError(`Qwen API Error (${response.status} ${code}): ${message}`, {
        retryable, provider: this.provider, code, status: response.status
      });
    }

    let fullText = '';
    let fullReasoning = '';
    const toolCallsMap: Map<number, { id: string; name: string; args: string }> = new Map();
    let stopReason = 'end_turn' as StopReason;
    let usage: NormalizedUsage | undefined;
    let searchResults: any[] | undefined;
    let sawTerminal = false;
    let inStreamError: { code: string; message: string; retryable: boolean } | null = null;

    await this.readDashScopeSse(response, (_event, dataStr) => {
      let chunk: any;
      try { chunk = JSON.parse(dataStr); } catch { return; }

      // 流内错误：DashScope 会在 data 帧里直接给 code/message
      if (chunk.code && !chunk.output) {
        inStreamError = this.classifyError(200, chunk);
        return;
      }

      if (chunk.usage) {
        const u = chunk.usage;
        usage = {
          inputTokens: u.input_tokens || 0,
          outputTokens: u.output_tokens || 0,
          totalTokens: u.total_tokens || ((u.input_tokens || 0) + (u.output_tokens || 0)),
          cachedTokens: u.prompt_tokens_details?.cached_tokens || 0,
          reasoningTokens: 0
        };
      }

      const out = chunk.output;
      if (!out) return;

      if (out.search_info?.search_results) searchResults = out.search_info.search_results;

      const choice = out.choices?.[0];
      if (!choice) return;

      const msg = choice.message || {};
      if (msg.reasoning_content) {
        fullReasoning += msg.reasoning_content;
        callbacks.onThoughtChunk?.(msg.reasoning_content);
      }
      if (msg.content) {
        // content 可能是字符串，也可能是 [{text}] 数组
        const text = typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content.map((c: any) => c?.text || '').join('')
            : '';
        if (text) {
          fullText += text;
          callbacks.onChunk?.(text);
        }
      }
      if (Array.isArray(msg.tool_calls)) {
        for (let i = 0; i < msg.tool_calls.length; i++) {
          const tc = msg.tool_calls[i];
          const idx = tc.index ?? i;
          if (!toolCallsMap.has(idx)) {
            toolCallsMap.set(idx, { id: '', name: '', args: '' });
          }
          const cur = toolCallsMap.get(idx)!;
          // 文档里 id 与 tool_call_id 两种键名都出现过，两个都读。
          if (tc.id) cur.id = tc.id;
          if (tc.tool_call_id) cur.id = tc.tool_call_id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
        }
      }

      const fr = choice.finish_reason;
      // DashScope 流式中途会给字符串 "null" 而不是 JSON null，两者都要当作「还没结束」。
      if (fr && fr !== 'null') {
        sawTerminal = true;
        const raw = String(fr);
        if (raw === 'tool_calls') stopReason = 'tool_use';
        else if (raw === 'length') stopReason = 'max_tokens';
        else stopReason = 'end_turn';
      }
    });

    if (inStreamError) {
      const e = inStreamError as { code: string; message: string; retryable: boolean };
      throw new LlmError(`Qwen API Error (${e.code}): ${e.message}`, {
        retryable: e.retryable, provider: this.provider, code: e.code
      });
    }
    if (!sawTerminal) {
      // 原生模式不发 [DONE]，终止只能靠 finish_reason。
      throw new LlmError('Qwen Stream Error: stream disconnected prematurely without a terminal finish_reason.', {
        retryable: true, provider: this.provider
      });
    }

    const outputBlocks: Block[] = [];
    if (fullReasoning) outputBlocks.push({ kind: 'thought', text: fullReasoning });
    if (fullText) outputBlocks.push({ kind: 'text', text: fullText });

    // 联网搜索的引用信息按 server_tool 块带回上层，供 UI 做溯源展示。
    if (searchResults && searchResults.length > 0) {
      outputBlocks.push({ kind: 'server_tool', toolType: 'web_search', payload: { results: searchResults } });
    }

    const toolCallsList: LlmResponse['toolCalls'] = [];
    for (const key of Array.from(toolCallsMap.keys()).sort((a, b) => a - b)) {
      const tc = toolCallsMap.get(key)!;
      let parsedArgs: any = {};
      try { parsedArgs = JSON.parse(tc.args); } catch { parsedArgs = { _raw: tc.args }; }
      outputBlocks.push({ kind: 'tool_call', callId: tc.id, name: tc.name, args: parsedArgs, raw: tc.args });
      toolCallsList.push({ callId: tc.id, name: tc.name, args: parsedArgs, raw: tc.args });
    }
    if (toolCallsList.length > 0 && stopReason !== 'max_tokens') stopReason = 'tool_use';

    const finalResponse: LlmResponse = {
      blocks: outputBlocks, text: fullText, toolCalls: toolCallsList, stopReason, usage, model: modelName
    };
    callbacks.onDone?.(finalResponse);
    return finalResponse;
  }

  async fetchModels(apiKey: string, endpoint?: string): Promise<string[]> {
    // 模型列表只在 OpenAI 兼容模式下暴露。
    const url = `${this.resolveHost(endpoint)}/compatible-mode/v1/models`;
    try {
      if (apiKey) {
        const res = await fetch(url, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000)
        });
        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json.data)) return json.data.map((m: any) => m.id);
        }
      }
    } catch (e) {
      console.warn('[QwenAdapter] Failed to fetch live models from API, using fallback roster', e);
    }
    // 注意模型名带点号，任何做模型名校验的地方正则都要允许 '.'
    return [
      'qwen3.8-max',
      'qwen3.7-plus',
      'qwen3.8-flash',
      'qwen3.7-max',
      'qwen3.8-2.4t-a95b',
      'qwen3.8-27b',
      'qwen3-max',
      'qwen-flash',
      'qwq-plus'
    ];
  }
}
