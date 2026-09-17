import { BaseAdapter } from './BaseAdapter';
import { LlmRequest, LlmResponse, StreamCallbacks, Block, Turn, UnifiedTool, NormalizedUsage, StopReason, LlmError } from './types';
import { ConcurrencyManager } from './ConcurrencyManager';
import { ModelCaps } from './ModelCapabilities';

export class ZhipuAdapter extends BaseAdapter {
  readonly provider = 'zhipu';

  async streamTurn(request: LlmRequest, callbacks: StreamCallbacks): Promise<LlmResponse> {
    const cm = ConcurrencyManager.getInstance();
    await cm.acquire(this.provider, request.signal);
    try {
      return await this.streamChatCompletionsApi(request, callbacks);
    } finally {
      cm.release(this.provider);
    }
  }

  private async streamChatCompletionsApi(request: LlmRequest, callbacks: StreamCallbacks): Promise<LlmResponse> {
    let baseUrl = request.endpoint || 'https://open.bigmodel.cn/api/paas/v4';
    baseUrl = baseUrl.replace(/\/chat\/completions\/?$/, '').replace(/\/$/, '');
    const url = `${baseUrl}/chat/completions`;

    const { systemInstruction, turns } = this.normalizeTurns(request);
    const messages: any[] = [];

    if (systemInstruction) {
      messages.push({ role: 'system', content: systemInstruction });
    }

    const hasTools = request.tools && request.tools.length > 0;

    for (const turn of turns) {
      if (turn.role === 'user') {
        const textParts = turn.blocks
          .filter((b): b is { kind: 'text'; text: string } => b.kind === 'text')
          .map(b => b.text)
          .join('\n');
        
        const toolResultParts = turn.blocks.filter((b): b is { kind: 'tool_result'; callId: string; name?: string; content: any[]; isError?: boolean } => b.kind === 'tool_result');

        if (textParts) {
          messages.push({ role: 'user', content: textParts });
        }

        for (const tr of toolResultParts) {
          const outText = tr.content
            .map(c => (typeof c === 'string' ? c : c.kind === 'text' ? c.text : JSON.stringify(c)))
            .join('\n');
          messages.push({
            role: 'tool',
            tool_call_id: tr.callId,
            content: outText
          });
        }
      } else if (turn.role === 'assistant') {
        const textParts = turn.blocks
          .filter((b): b is { kind: 'text'; text: string } => b.kind === 'text')
          .map(b => b.text)
          .join('\n');
        
        const thoughtParts = turn.blocks
          .filter((b): b is { kind: 'thought'; text?: string; opaque?: string; providerItemId?: string } => b.kind === 'thought');
        
        const reasoningContent = thoughtParts.map(b => b.text || '').join('\n').trim();

        const toolCalls = turn.blocks
          .filter((b): b is { kind: 'tool_call'; callId: string; name: string; args: any; raw: string; providerItemId?: string } => b.kind === 'tool_call')
          .map(tc => ({
            id: tc.callId,
            type: 'function',
            function: {
              name: tc.name,
              arguments: tc.raw || JSON.stringify(tc.args || {})
            }
          }));

        const assistantMsg: any = { role: 'assistant' };
        if (textParts) assistantMsg.content = textParts;
        if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
        
        // Spec: clear_thinking: false means we retain cross-turn thinking
        if (reasoningContent) {
          assistantMsg.reasoning_content = reasoningContent;
        }

        messages.push(assistantMsg);
      }
    }

    const requestBody: any = {
      model: request.model || 'glm-5.3',
      messages,
      stream: true,
      tool_stream: true,
      request_id: `req-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`
    };

    if (request.sessionId) {
      const sanitized = request.sessionId.replace(/[^a-zA-Z0-9\-_]/g, '');
      requestBody.user_id = `user-${sanitized}`.substring(0, 128);
    }

    if (hasTools) {
      requestBody.tools = request.tools!.map((tool: UnifiedTool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters
        }
      }));
      // Zhipu ONLY supports 'auto'
      requestBody.tool_choice = 'auto';
    }

    if (request.maxOutputTokens) {
      requestBody.max_tokens = request.maxOutputTokens;
    }

    // Thinking mode（GLM-5.3 强制思考，传 disabled 无效）
    const caps = ModelCaps.resolve(this.provider, requestBody.model || '');
    if (request.thinkingEffort === 'none' && caps.thinkingCanBeDisabled) {
      requestBody.thinking = { type: 'disabled' };
    } else if (!caps.supportsThinking) {
      // 未知型号：thinking 整块不发
    } else {
      requestBody.thinking = { type: 'enabled', clear_thinking: false };
      if (request.thinkingEffort === 'max' || request.thinkingEffort === 'xhigh') {
        requestBody.reasoning_effort = 'max';
      } else if (request.thinkingEffort === 'low') {
        requestBody.reasoning_effort = 'low';
      } else {
        requestBody.reasoning_effort = 'high';
      }
    }

    // Temperature (Clamp to [0.0, 1.0], 2 decimal places). Omit if undefined.
    if (request.temperature !== undefined) {
      if (request.temperature <= 0) {
        requestBody.do_sample = false;
      } else {
        requestBody.do_sample = true;
        requestBody.temperature = Number(Math.min(request.temperature, 1.0).toFixed(2));
      }
    }

    if (!request.apiKey) {
      throw new LlmError('未检测到有效的 API Key。请先在 AI 设置中保存您的 Zhipu GLM API Key。', {
        retryable: false,
        provider: this.provider,
        code: 'MISSING_API_KEY'
      });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${request.apiKey}`
    };

    const timeoutSignal = AbortSignal.timeout(600000); // 10 minutes for GLM-5.3 1M context
    const combinedSignal = request.signal 
      ? ((AbortSignal as any).any ? (AbortSignal as any).any([request.signal, timeoutSignal]) : request.signal)
      : timeoutSignal;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: combinedSignal
    });

    if (!response.ok) {
      let isQuotaExhausted = false;
      let message = response.statusText;
      let code = '';
      
      const errJson = await response.json().catch(() => null);
      if (errJson) {
        if (errJson.error && errJson.error.code) {
          code = String(errJson.error.code);
          message = errJson.error.message || message;
        } else if (errJson.code) {
          code = String(errJson.code);
          message = errJson.message || message;
        }
      }

      if (code === '1113') {
        isQuotaExhausted = true;
        message = '账户欠费或无可用资源包 (1113) - 请充值。';
      } else if (code === '1302' || code === '1305') {
        message = `Rate Limit Reached (${code}) - 速率限制，请稍后重试。`;
      } else if (code === '1301') {
        message = '内容安全审核不通过 (1301)。';
      }

      const isRetryable = !isQuotaExhausted && (response.status === 429 || response.status >= 500);

      throw new LlmError(`Zhipu API Error (${response.status} Code:${code}): ${message}`, {
        retryable: isRetryable,
        provider: this.provider,
        code,
        status: response.status
      });
    }

    let fullText = '';
    let fullReasoning = '';
    const toolCallsMap: Map<number, { id: string; name: string; args: string }> = new Map();
    let stopReason: StopReason = 'end_turn';
    let usage: NormalizedUsage | undefined;
    let isSensitive = false;
    let isNetworkError = false;
    let sawTerminal = false;

    await this.processSseStream(response, (event, dataStr) => {
      if (dataStr === '[DONE]') {
        sawTerminal = true;
        return;
      }

      let chunk: any;
      try {
        chunk = JSON.parse(dataStr);
      } catch (e) {
        return;
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
      if (choice) {
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
            const current = toolCallsMap.get(idx)!;
            if (tc.id) current.id = tc.id;
            if (tc.function?.name) current.name = tc.function.name;
            if (tc.function?.arguments) {
              current.args += tc.function.arguments;
            }
          }
        }

        if (choice.finish_reason) {
          sawTerminal = true;
          const rawReason = String(choice.finish_reason);
          if (rawReason === 'tool_calls') stopReason = 'tool_use';
          else if (rawReason === 'length') stopReason = 'max_tokens';
          else if (rawReason === 'sensitive') {
            isSensitive = true;
          } else if (rawReason === 'network_error') {
            isNetworkError = true;
          } else {
            stopReason = 'end_turn';
          }
        }
      }
    });

    if (isSensitive) {
      throw new LlmError(`Zhipu API Error: The response was intercepted by content filters (sensitive).`, {
        retryable: false,
        provider: this.provider,
        code: 'sensitive'
      });
    }

    if (isNetworkError) {
      throw new LlmError(`Zhipu API Error: Server inference aborted with network_error.`, {
        retryable: true,
        provider: this.provider,
        code: 'network_error'
      });
    }

    if (!sawTerminal) {
      throw new LlmError(`Zhipu Stream Error: stream disconnected prematurely without completion event.`, {
        retryable: true,
        provider: this.provider
      });
    }

    const outputBlocks: Block[] = [];
    if (fullReasoning) {
      outputBlocks.push({ kind: 'thought', text: fullReasoning });
    }
    if (fullText) {
      outputBlocks.push({ kind: 'text', text: fullText });
    }
    
    const toolCallsArray = Array.from(toolCallsMap.values());
    for (const tc of toolCallsArray) {
      let parsedArgs = {};
      try { parsedArgs = JSON.parse(tc.args); } catch { parsedArgs = { _raw: tc.args }; }
      outputBlocks.push({
        kind: 'tool_call',
        callId: tc.id || `call_${Math.random().toString(36).substring(7)}`,
        name: tc.name,
        args: parsedArgs,
        raw: tc.args
      });
    }

    const toolCalls = outputBlocks
      .filter((b): b is { kind: 'tool_call'; callId: string; name: string; args: any; raw: string } => b.kind === 'tool_call')
      .map(b => ({ callId: b.callId, name: b.name, args: b.args, raw: b.raw }));

    const finalResponse: LlmResponse = {
      blocks: outputBlocks,
      text: fullText,
      toolCalls,
      stopReason: toolCalls.length > 0 ? 'tool_use' : stopReason,
      usage,
      model: request.model
    };

    callbacks.onDone?.(finalResponse);
    return finalResponse;
  }

  async fetchModels(apiKey: string, endpoint?: string): Promise<string[]> {
    let baseUrl = endpoint || 'https://open.bigmodel.cn/api/paas/v4';
    baseUrl = baseUrl.replace(/\/chat\/completions\/?$/, '').replace(/\/$/, '');
    const url = `${baseUrl}/models`;

    try {
      if (apiKey) {
        const res = await fetch(url, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000)
        });
        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json.data)) {
            return json.data.map((m: any) => m.id);
          }
        }
      }
    } catch (e) {
      console.warn('[ZhipuAdapter] Failed to fetch live models from API, using fallback roster', e);
    }

    return [
      'glm-5.3', 'glm-5.2', 'glm-5.1', 'glm-5', 'glm-4.7', 'glm-4.6', 
      'glm-4.7-flash', 'glm-4.5-flash'
    ];
  }
}
