import { BaseAdapter } from './BaseAdapter';
import { LlmRequest, LlmResponse, StreamCallbacks, Block, UnifiedTool, NormalizedUsage, StopReason, LlmError } from './types';
import { ConcurrencyManager } from './ConcurrencyManager';
import { ModelCaps } from './ModelCapabilities';

/**
 * MiniMax 适配器
 *
 * MiniMax 同时提供 OpenAI 兼容、Anthropic 兼容、遗留原生三套端点。
 * 本适配器默认走 **Anthropic 兼容端点**（官方标注 Recommended），原因有三：
 *   1. 该端点没有 `base_resp` 双通道 —— 错误按标准 HTTP 语义返回，不会出现
 *      「HTTP 200 但其实是失败」这种需要额外判定的情况；
 *   2. 思考内容是结构化的 thinking block，有明确的流式事件契约；
 *      OpenAI 兼容端点默认把 <think>…</think> 内联进 content，且标签会跨 chunk 断裂；
 *   3. 内置 web_search 只在 Anthropic 端点与 Responses 端点上可用。
 *
 * 若用户在设置里明确填了 /v1/chat/completions，则退回 OpenAI 兼容模式，
 * 此时会强制注入 reasoning_split 并检查 base_resp（见 streamOpenAiCompatible）。
 *
 * 域名提示：文档域名与 API 域名不同。
 *   国际站 API: https://api.minimax.io    （文档 platform.minimax.io）
 *   国内站 API: https://api.minimax.cn    （文档 platform.minimaxi.com）
 * 两站账号与 Key 不互通。GroupId 已废除，不要再拼。
 */

type MiniMaxBlockState =
  | { kind: 'thinking'; state: { text: string; signature: string } }
  | { kind: 'text'; state: { text: string } }
  | { kind: 'tool_use'; state: { id: string; name: string; args: string } };

// M3 与 M2.x 的输出上限不同，且 M2.x 的思考无法关闭。
const M3_MAX_OUTPUT = 524288;
const M2_MAX_OUTPUT = 204800;

export class MiniMaxAdapter extends BaseAdapter {
  readonly provider = 'minimax';

  async streamTurn(request: LlmRequest, callbacks: StreamCallbacks): Promise<LlmResponse> {
    const cm = ConcurrencyManager.getInstance();
    await cm.acquire(this.provider, request.signal);
    try {
      const ep = request.endpoint || '';
      if (/\/chat\/completions\/?$/.test(ep) || /\/v1\/?$/.test(ep)) {
        return await this.streamOpenAiCompatible(request, callbacks);
      }
      return await this.streamAnthropicCompatible(request, callbacks);
    } finally {
      cm.release(this.provider);
    }
  }

  /** 把用户填的任意形态 endpoint 归一到裸 host（不带协议后缀路径）。 */
  private resolveHost(endpoint?: string): string {
    let base = endpoint || 'https://api.minimax.io';
    base = base
      .replace(/\/anthropic\/v1\/messages\/?$/, '')
      .replace(/\/anthropic\/?$/, '')
      .replace(/\/v1\/chat\/completions\/?$/, '')
      .replace(/\/v1\/text\/chatcompletion_v2\/?$/, '')
      .replace(/\/v1\/?$/, '')
      .replace(/\/$/, '');
    return base;
  }

  private isM3(model: string): boolean {
    return /m3/i.test(model);
  }

  /**
   * M2.x 系列思考不可关闭；只有 M3 接受 thinking.type = disabled。
   * 走能力表而不是写死型号，这样新出的型号命中家族规则即可，
   * 命不中就按最小请求处理（不发 thinking），也不会 400。
   */
  private thinkingCanBeDisabled(model: string): boolean {
    return ModelCaps.resolve(this.provider, model).thinkingCanBeDisabled;
  }

  private defaultMaxTokens(model: string): number {
    return this.isM3(model) ? 131072 : 65536;
  }

  private clampMaxTokens(model: string, want?: number): number {
    const cap = this.isM3(model) ? M3_MAX_OUTPUT : M2_MAX_OUTPUT;
    const v = want || this.defaultMaxTokens(model);
    return Math.max(1, Math.min(v, cap));
  }

  /**
   * MiniMax 的错误可能有两种形状：
   *   Anthropic 端点 → { error: { type, message } }
   *   OpenAI 端点   → { base_resp: { status_code, status_msg } }，且可能挂在 HTTP 200 上
   * 这里统一解析，并按 MiniMax 的数字码判定可重试性。
   */
  private classifyError(status: number, body: any): { message: string; code: string; retryable: boolean } {
    const sc = body?.base_resp?.status_code;
    if (typeof sc === 'number' && sc !== 0) {
      const msg = body?.base_resp?.status_msg || 'unknown';
      // 可重试：1000 unknown / 1001 timeout / 1002 rate limit / 1013,1024,1033 内部错误
      //          1041 conn limit / 2045 请求增速超限 / 2056 Token Plan 额度窗口
      const retryableCodes = new Set([1000, 1001, 1002, 1013, 1024, 1033, 1041, 2045, 2056]);
      return {
        message: `MiniMax base_resp ${sc}: ${msg}`,
        code: String(sc),
        retryable: retryableCodes.has(sc)
      };
    }

    const t = body?.error?.type || body?.type || '';
    const m = body?.error?.message || body?.message || '';
    const retryable = status === 429 || status >= 500;
    return { message: m || `HTTP ${status}`, code: String(t || status), retryable };
  }

  // ────────────────────────────────────────────────────────────────
  // Anthropic 兼容模式（默认）
  // ────────────────────────────────────────────────────────────────
  private async streamAnthropicCompatible(request: LlmRequest, callbacks: StreamCallbacks): Promise<LlmResponse> {
    const url = `${this.resolveHost(request.endpoint)}/anthropic/v1/messages`;
    const modelName = request.model || 'MiniMax-M3';
    const { systemInstruction, turns } = this.normalizeTurns(request);

    // callId -> 工具名，用于回填 tool_result 缺失的 name（Anthropic 形态本身不需要 name，
    // 但保留这张表便于将来切到需要 name 的端点，且成本可忽略）
    const messages: any[] = [];

    for (const turn of turns) {
      if (turn.role === 'user') {
        const contentBlocks: any[] = [];
        const textParts = turn.blocks
          .filter((b): b is { kind: 'text'; text: string } => b.kind === 'text')
          .map(b => b.text)
          .join('\n');
        if (textParts) contentBlocks.push({ type: 'text', text: textParts });

        for (const b of turn.blocks) {
          if (b.kind !== 'tool_result') continue;
          const outText = b.content
            .map(c => (typeof c === 'string' ? c : c.kind === 'text' ? c.text : JSON.stringify(c)))
            .join('\n');
          contentBlocks.push({
            type: 'tool_result',
            tool_use_id: b.callId,
            content: outText,
            is_error: b.isError || false
          });
        }
        if (contentBlocks.length > 0) messages.push({ role: 'user', content: contentBlocks });
      } else if (turn.role === 'assistant') {
        const contentBlocks: any[] = [];

        // interleaved thinking：官方明确要求把完整的 assistant 响应原样回填，
        // 剥掉 thinking 会直接打断 M3 的推理链，而且不报错、只是质量下降。
        for (const b of turn.blocks) {
          if (b.kind !== 'thought') continue;
          if (!b.opaque) continue;
          let signature = b.opaque;
          try {
            const parsed = JSON.parse(b.opaque);
            if (parsed && typeof parsed === 'object' && parsed.signature) signature = parsed.signature;
          } catch { /* opaque 本身就是裸签名 */ }
          contentBlocks.push({ type: 'thinking', thinking: b.text || '', signature });
        }

        const textParts = turn.blocks
          .filter((b): b is { kind: 'text'; text: string } => b.kind === 'text')
          .map(b => b.text)
          .join('\n');
        if (textParts) contentBlocks.push({ type: 'text', text: textParts });

        for (const b of turn.blocks) {
          if (b.kind !== 'tool_call') continue;
          contentBlocks.push({ type: 'tool_use', id: b.callId, name: b.name, input: b.args || {} });
        }

        if (contentBlocks.length > 0) messages.push({ role: 'assistant', content: contentBlocks });
      }
    }

    const requestBody: any = {
      model: modelName,
      max_tokens: this.clampMaxTokens(modelName, request.maxOutputTokens),
      stream: true,
      messages
    };

    if (systemInstruction) {
      requestBody.system = [{ type: 'text', text: systemInstruction }];
    }

    if (request.tools && request.tools.length > 0) {
      requestBody.tools = request.tools.map((tool: UnifiedTool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters
      }));

      if (request.toolChoice === 'none') {
        requestBody.tool_choice = { type: 'none' };
      } else if (request.toolChoice === 'required' || request.toolChoice === 'any') {
        requestBody.tool_choice = { type: 'any' };
      } else if (typeof request.toolChoice === 'object' && request.toolChoice.name) {
        requestBody.tool_choice = { type: 'tool', name: request.toolChoice.name };
      } else {
        requestBody.tool_choice = { type: 'auto' };
      }
    }

    // M2.x 思考不可关闭：传 disabled 会被拒，这里直接不下发该字段。
    if (request.thinkingEffort === 'none' && this.thinkingCanBeDisabled(modelName)) {
      requestBody.thinking = { type: 'disabled' };
    } else {
      requestBody.thinking = { type: 'adaptive' };
    }

    // MiniMax 不像 Anthropic 那样对采样参数硬拒，但仍然只在调用方显式给了值时才下发。
    if (request.temperature !== undefined) {
      requestBody.temperature = Math.max(0, Math.min(request.temperature, 2));
    }

    if (!request.apiKey) {
      throw new LlmError('未检测到有效的 API Key。请先在 AI 设置中保存您的 MiniMax API Key。', {
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
        // 注意：MiniMax 的 Anthropic 兼容端点用 Bearer，不是 Anthropic 原生的 x-api-key。
        'Authorization': `Bearer ${request.apiKey}`
      },
      body: JSON.stringify(requestBody),
      signal
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => null);
      const { message, code, retryable } = this.classifyError(response.status, errJson);
      throw new LlmError(`MiniMax API Error (${response.status}): ${message}`, {
        retryable, provider: this.provider, code, status: response.status
      });
    }

    const blockStates: Map<number, MiniMaxBlockState> = new Map();
    let stopReason = 'end_turn' as StopReason;
    let usage: NormalizedUsage | undefined;
    let hasStreamError = false;
    let streamErrorMsg = '';
    let sawTerminal = false;

    await this.processSseStream(response, (event, dataStr) => {
      let chunk: any;
      try { chunk = JSON.parse(dataStr); } catch { return; }

      if (chunk.type === 'content_block_start') {
        const idx = chunk.index;
        const cb = chunk.content_block;
        if (cb?.type === 'thinking') {
          blockStates.set(idx, { kind: 'thinking', state: { text: '', signature: '' } });
        } else if (cb?.type === 'text') {
          blockStates.set(idx, { kind: 'text', state: { text: cb.text || '' } });
        } else if (cb?.type === 'tool_use') {
          blockStates.set(idx, { kind: 'tool_use', state: { id: cb.id, name: cb.name, args: '' } });
        }
      } else if (chunk.type === 'content_block_delta') {
        const cur = blockStates.get(chunk.index);
        const d = chunk.delta;
        if (d?.type === 'text_delta') {
          if (cur && cur.kind === 'text') cur.state.text += d.text;
          callbacks.onChunk?.(d.text);
        } else if (d?.type === 'thinking_delta') {
          if (cur && cur.kind === 'thinking') cur.state.text += d.thinking;
          callbacks.onThoughtChunk?.(d.thinking);
        } else if (d?.type === 'signature_delta') {
          if (cur && cur.kind === 'thinking') cur.state.signature = d.signature;
        } else if (d?.type === 'input_json_delta') {
          if (cur && cur.kind === 'tool_use') cur.state.args += d.partial_json;
        }
      } else if (chunk.type === 'message_delta') {
        const raw = chunk.delta?.stop_reason;
        if (raw) {
          sawTerminal = true;
          if (raw === 'tool_use') stopReason = 'tool_use';
          else if (raw === 'max_tokens') stopReason = 'max_tokens';
          else if (raw === 'pause_turn') stopReason = 'pause_turn';
          else if (raw === 'refusal') stopReason = 'refusal';
          else stopReason = 'end_turn';
        }
        if (chunk.usage) {
          const u = chunk.usage;
          const cacheRead = u.cache_read_input_tokens || 0;
          const cacheCreate = u.cache_creation_input_tokens || 0;
          const input = (u.input_tokens || 0) + cacheRead + cacheCreate;
          usage = {
            inputTokens: input,
            outputTokens: u.output_tokens || 0,
            reasoningTokens: u.output_tokens_details?.thinking_tokens || 0,
            cachedTokens: cacheRead,
            totalTokens: input + (u.output_tokens || 0)
          };
        }
      } else if (chunk.type === 'message_stop') {
        sawTerminal = true;
      } else if (chunk.type === 'error') {
        hasStreamError = true;
        streamErrorMsg = chunk.error?.message || 'stream error';
      }
    });

    if (hasStreamError) {
      throw new LlmError(`MiniMax Stream Error: ${streamErrorMsg}`, {
        retryable: true, provider: this.provider
      });
    }
    if (!sawTerminal) {
      throw new LlmError('MiniMax Stream Error: stream disconnected prematurely without message_stop.', {
        retryable: true, provider: this.provider
      });
    }

    const outputBlocks: Block[] = [];
    let fullText = '';
    const toolCallsList: LlmResponse['toolCalls'] = [];

    for (const idx of Array.from(blockStates.keys()).sort((a, b) => a - b)) {
      const item = blockStates.get(idx)!;
      if (item.kind === 'thinking') {
        outputBlocks.push({
          kind: 'thought',
          text: item.state.text,
          opaque: item.state.signature ? JSON.stringify({ signature: item.state.signature }) : undefined
        });
      } else if (item.kind === 'text') {
        fullText += item.state.text;
        outputBlocks.push({ kind: 'text', text: item.state.text });
      } else {
        let parsedArgs: any = {};
        try { parsedArgs = JSON.parse(item.state.args); } catch { parsedArgs = { _raw: item.state.args }; }
        outputBlocks.push({
          kind: 'tool_call',
          callId: item.state.id,
          name: item.state.name,
          args: parsedArgs,
          raw: item.state.args
        });
        toolCallsList.push({ callId: item.state.id, name: item.state.name, args: parsedArgs, raw: item.state.args });
      }
    }

    if (toolCallsList.length > 0 && stopReason !== 'max_tokens') stopReason = 'tool_use';

    const finalResponse: LlmResponse = {
      blocks: outputBlocks, text: fullText, toolCalls: toolCallsList, stopReason, usage, model: modelName
    };
    callbacks.onDone?.(finalResponse);
    return finalResponse;
  }

  // ────────────────────────────────────────────────────────────────
  // OpenAI 兼容模式（仅当用户显式指向 /v1/chat/completions 时）
  // ────────────────────────────────────────────────────────────────
  private async streamOpenAiCompatible(request: LlmRequest, callbacks: StreamCallbacks): Promise<LlmResponse> {
    const url = `${this.resolveHost(request.endpoint)}/v1/chat/completions`;
    const modelName = request.model || 'MiniMax-M3';
    const { systemInstruction, turns } = this.normalizeTurns(request);

    const messages: any[] = [];
    if (systemInstruction) messages.push({ role: 'system', content: systemInstruction });

    for (const turn of turns) {
      if (turn.role === 'user') {
        const textParts = turn.blocks
          .filter((b): b is { kind: 'text'; text: string } => b.kind === 'text')
          .map(b => b.text).join('\n');
        if (textParts) messages.push({ role: 'user', content: textParts });

        for (const b of turn.blocks) {
          if (b.kind !== 'tool_result') continue;
          const outText = b.content
            .map(c => (typeof c === 'string' ? c : c.kind === 'text' ? c.text : JSON.stringify(c)))
            .join('\n');
          messages.push({ role: 'tool', tool_call_id: b.callId, content: outText });
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

        const msg: any = { role: 'assistant' };
        if (textParts) msg.content = textParts;
        if (toolCalls.length > 0) msg.tool_calls = toolCalls;
        // 多轮工具调用必须把推理内容原样回填，否则打断 interleaved thinking。
        if (reasoning) msg.reasoning_content = reasoning;
        messages.push(msg);
      }
    }

    const requestBody: any = {
      model: modelName,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      // 不传这个字段的话，思考内容会以 <think>…</think> 内联进 content，
      // 且标签会跨 chunk 断裂，几乎不可能在流式下正确剥离。
      reasoning_split: true,
      max_completion_tokens: this.clampMaxTokens(modelName, request.maxOutputTokens)
    };

    if (request.thinkingEffort === 'none' && this.thinkingCanBeDisabled(modelName)) {
      requestBody.thinking = { type: 'disabled' };
    } else {
      requestBody.thinking = { type: 'adaptive' };
    }

    if (request.temperature !== undefined) {
      requestBody.temperature = Math.max(0, Math.min(request.temperature, 2));
    }

    if (request.tools && request.tools.length > 0) {
      // parameters 是 JSON Schema 对象，不是字符串化 JSON（历史要求已废除）。
      requestBody.tools = request.tools.map((tool: UnifiedTool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters }
      }));
    }

    if (!request.apiKey) {
      throw new LlmError('未检测到有效的 API Key。请先在 AI 设置中保存您的 MiniMax API Key。', {
        retryable: false, provider: this.provider, code: 'no_api_key'
      });
    }

    const timeoutSignal = AbortSignal.timeout(600000);
    const signal = request.signal
      ? ((AbortSignal as any).any ? (AbortSignal as any).any([request.signal, timeoutSignal]) : request.signal)
      : timeoutSignal;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${request.apiKey}` },
      body: JSON.stringify(requestBody),
      signal
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => null);
      const { message, code, retryable } = this.classifyError(response.status, errJson);
      throw new LlmError(`MiniMax API Error (${response.status}): ${message}`, {
        retryable, provider: this.provider, code, status: response.status
      });
    }

    let fullText = '';
    let fullReasoning = '';
    const toolCallsMap: Map<number, { id: string; name: string; args: string }> = new Map();
    let stopReason = 'end_turn' as StopReason;
    let usage: NormalizedUsage | undefined;
    let sawTerminal = false;
    let baseRespError: { code: string; message: string; retryable: boolean } | null = null;

    await this.processSseStream(response, (event, dataStr) => {
      if (dataStr === '[DONE]') { sawTerminal = true; return; }

      let chunk: any;
      try { chunk = JSON.parse(dataStr); } catch { return; }

      // OpenAI 兼容端点会把失败塞进 HTTP 200 的 base_resp 里。
      if (chunk.base_resp && chunk.base_resp.status_code) {
        const c = this.classifyError(200, chunk);
        baseRespError = { code: c.code, message: c.message, retryable: c.retryable };
      }

      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens || 0,
          outputTokens: chunk.usage.completion_tokens || 0,
          totalTokens: chunk.usage.total_tokens || 0,
          cachedTokens: chunk.usage.prompt_tokens_details?.cached_tokens || 0,
          reasoningTokens: 0
        };
      }

      const choice = chunk.choices?.[0];
      if (!choice) return;

      if (choice.delta?.reasoning_content) {
        fullReasoning += choice.delta.reasoning_content;
        callbacks.onThoughtChunk?.(choice.delta.reasoning_content);
      }
      if (choice.delta?.content) {
        fullText += choice.delta.content;
        callbacks.onChunk?.(choice.delta.content);
      }
      if (choice.delta?.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCallsMap.has(idx)) {
            toolCallsMap.set(idx, { id: tc.id || '', name: tc.function?.name || '', args: '' });
          }
          const cur = toolCallsMap.get(idx)!;
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
        }
      }
      if (choice.finish_reason) {
        // MiniMax 的官方流式示例里没有 [DONE]，终止以 finish_reason 非 null 为准。
        sawTerminal = true;
        const raw = String(choice.finish_reason);
        if (raw === 'tool_calls') stopReason = 'tool_use';
        else if (raw === 'length') stopReason = 'max_tokens';
        else if (raw === 'content_filter') stopReason = 'refusal';
        else stopReason = 'end_turn';
      }
    });

    if (baseRespError) {
      const e = baseRespError as { code: string; message: string; retryable: boolean };
      throw new LlmError(`MiniMax API Error: ${e.message}`, {
        retryable: e.retryable, provider: this.provider, code: e.code
      });
    }
    if (!sawTerminal) {
      throw new LlmError('MiniMax Stream Error: stream disconnected prematurely without finish_reason.', {
        retryable: true, provider: this.provider
      });
    }

    const outputBlocks: Block[] = [];
    if (fullReasoning) outputBlocks.push({ kind: 'thought', text: fullReasoning });
    if (fullText) outputBlocks.push({ kind: 'text', text: fullText });

    const toolCallsList: LlmResponse['toolCalls'] = [];
    for (const tc of Array.from(toolCallsMap.keys()).sort((a, b) => a - b).map(k => toolCallsMap.get(k)!)) {
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
    const url = `${this.resolveHost(endpoint)}/v1/models`;
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
      console.warn('[MiniMaxAdapter] Failed to fetch live models from API, using fallback roster', e);
    }
    return [
      'MiniMax-M3',
      'MiniMax-M2.7',
      'MiniMax-M2.7-highspeed',
      'MiniMax-M2.5',
      'MiniMax-M2.5-highspeed',
      'MiniMax-M2.1',
      'MiniMax-M2.1-highspeed',
      'MiniMax-M2'
    ];
  }
}
