import { BaseAdapter } from './BaseAdapter';
import { LlmRequest, LlmResponse, StreamCallbacks, Block, Turn, UnifiedTool, NormalizedUsage, StopReason, LlmError } from './types';
import { ConcurrencyManager } from './ConcurrencyManager';

export class KimiAdapter extends BaseAdapter {
  readonly provider = 'kimi';

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
    let baseUrl = request.endpoint || 'https://api.moonshot.cn/v1';
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
              arguments: tc.raw
            }
          }));

        const assistantMsg: any = { role: 'assistant' };
        if (textParts) assistantMsg.content = textParts;
        if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
        
        if (reasoningContent) {
          assistantMsg.reasoning_content = reasoningContent;
        }

        messages.push(assistantMsg);
      }
    }

    const modelName = request.model || 'kimi-k3';
    
    const requestBody: any = {
      model: modelName,
      messages,
      stream: true,
      stream_options: { include_usage: true }
    };

    if (hasTools) {
      requestBody.tools = request.tools!.map((tool: UnifiedTool) => {
        if (tool.name === '$web_search') {
          return {
            type: 'builtin_function',
            function: { name: '$web_search' }
          };
        }
        return {
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters
          }
        };
      });
      requestBody.tool_choice = request.toolChoice === 'none' ? 'none' : 'auto';
    }

    if (request.maxOutputTokens) {
      requestBody.max_completion_tokens = request.maxOutputTokens;
    }

    if (modelName.includes('kimi-k3')) {
      if (request.thinkingEffort === 'max' || request.thinkingEffort === 'xhigh') {
        requestBody.reasoning_effort = 'max';
      } else if (request.thinkingEffort === 'low') {
        requestBody.reasoning_effort = 'low';
      } else {
        requestBody.reasoning_effort = 'high';
      }
    } else {
      if (modelName.includes('k2.7-code')) {
        requestBody.thinking = { type: 'enabled', keep: 'all' };
      } else {
        if (request.thinkingEffort === 'none') {
          requestBody.thinking = { type: 'disabled' };
        } else {
          requestBody.thinking = { type: 'enabled', keep: 'all' };
        }
      }
    }

    if (!request.apiKey) {
      throw new LlmError('未检测到有效的 API Key。请先在 AI 设置中保存您的 Kimi API Key。', {
        retryable: false,
        provider: this.provider,
        code: 'MISSING_API_KEY'
      });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${request.apiKey}`
    };

    const timeoutSignal = AbortSignal.timeout(900000);
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
      let errType = '';
      
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html') || response.status === 504) {
        message = 'Gateway Timeout (504) - 请求超时或网关错误。';
        throw new LlmError(`Kimi API Error (${response.status}): ${message}`, {
          retryable: true,
          provider: this.provider,
          status: response.status
        });
      }

      const errJson = await response.json().catch(() => null);
      if (errJson && errJson.error) {
        errType = errJson.error.type || '';
        const errMsg = errJson.error.message;
        
        if (errType === 'exceeded_current_quota_error') {
          isQuotaExhausted = true;
          message = 'Insufficient Balance (exceeded_current_quota_error) - 余额不足。';
        } else if (errType === 'rate_limit_reached_error') {
          message = 'Rate Limit Reached - 并发/频率超限，请稍后重试。';
        } else if (errType === 'engine_overloaded_error') {
          message = 'Engine Overloaded - 服务端容量压力过大。';
        } else {
          message = errMsg || errType || message;
        }
      }

      const isRetryable = !isQuotaExhausted && (response.status === 429 || response.status >= 500);

      throw new LlmError(`Kimi API Error (${response.status}): ${message}`, {
        retryable: isRetryable,
        provider: this.provider,
        code: errType,
        status: response.status
      });
    }

    let fullText = '';
    let fullReasoning = '';
    const toolCallsMap: Map<number, { id: string; name: string; args: string }> = new Map();
    let stopReason: StopReason = 'end_turn';
    let usage: NormalizedUsage | undefined;
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
          cachedTokens: chunk.usage.cached_tokens || 0,
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
          else stopReason = 'end_turn';
        }
      }
    });

    if (!sawTerminal) {
      throw new LlmError(`Kimi Stream Error: stream disconnected prematurely without terminal finish_reason.`, {
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
    let baseUrl = endpoint || 'https://api.moonshot.cn/v1';
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
      console.warn('[KimiAdapter] Failed to fetch live models from API, using fallback roster', e);
    }

    return [
      'kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6'
    ];
  }
}
