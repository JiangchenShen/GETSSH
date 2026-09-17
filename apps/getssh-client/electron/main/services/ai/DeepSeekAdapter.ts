import { BaseAdapter } from './BaseAdapter';
import { LlmRequest, LlmResponse, StreamCallbacks, Block, Turn, UnifiedTool, NormalizedUsage, StopReason, LlmError } from './types';
import { ConcurrencyManager } from './ConcurrencyManager';
import { ModelCaps } from './ModelCapabilities';

export class DeepSeekAdapter extends BaseAdapter {
  readonly provider = 'deepseek';

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
    let baseUrl = request.endpoint || 'https://api.deepseek.com';
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
        
        // Spec: 不带 tools 时无需回传；带 tools 时必须全部回传，包括没实际调用工具的轮次
        if (hasTools && reasoningContent) {
          assistantMsg.reasoning_content = reasoningContent;
        }

        messages.push(assistantMsg);
      }
    }

    const requestBody: any = {
      model: request.model || 'deepseek-v4-pro',
      messages,
      stream: true,
      stream_options: { include_usage: true }
    };

    if (request.sessionId) {
      // 512 chars alphanumeric constraint
      requestBody.user_id = request.sessionId.replace(/[^a-zA-Z0-9\-_]/g, '').substring(0, 512);
    }

    if (hasTools) {
      requestBody.tools = request.tools!.map((tool: UnifiedTool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        }
      }));

      // Map toolChoice properly for DeepSeek
      if (request.toolChoice === 'none') {
        requestBody.tool_choice = 'none';
      } else if (request.toolChoice === 'required' || request.toolChoice === 'any') {
        requestBody.tool_choice = 'required';
      } else if (typeof request.toolChoice === 'object' && request.toolChoice.name) {
        requestBody.tool_choice = { type: 'function', function: { name: request.toolChoice.name } };
      } else {
        requestBody.tool_choice = 'auto';
      }
    }

    if (request.maxOutputTokens) {
      requestBody.max_tokens = request.maxOutputTokens;
    }

    if (request.thinkingEffort === 'none') {
      requestBody.thinking = { type: 'disabled' };
    } else {
      requestBody.thinking = { type: 'enabled' };
      if (request.thinkingEffort === 'max' || request.thinkingEffort === 'xhigh') {
        requestBody.reasoning_effort = 'max';
      } else if (request.thinkingEffort === 'low') {
        requestBody.reasoning_effort = 'low';
      } else {
        requestBody.reasoning_effort = 'high';
      }
    }

    // Temperature silently ignored if thinking is enabled, safe to pass
    // thinking 开着时 DeepSeek 会静默忽略 temperature —— 不报错，只是不生效。
    // 与其让用户以为设置生效了，不如按能力表判定，该发才发。
    const caps = ModelCaps.resolve(this.provider, requestBody.model || '');
    if (caps.supportsSampling && request.temperature !== undefined) {
      requestBody.temperature = request.temperature;
    }

    if (!request.apiKey) {
      throw new LlmError('未检测到有效的 API Key。请先在 AI 设置中保存您的 DeepSeek API Key。', {
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
      let errCode = '';
      
      const errJson = await response.json().catch(() => null);
      if (errJson && errJson.error && errJson.error.message) {
        message = errJson.error.message;
        errCode = errJson.error.code || errJson.error.type || '';
      }

      if (response.status === 402) {
        isQuotaExhausted = true;
        message = 'Insufficient Balance (402) - 余额不足，请充值。';
      } else if (response.status === 429) {
        message = 'Rate Limit Reached (429) - 并发超限，请稍后重试。';
      }

      const isRetryable = !isQuotaExhausted && (response.status === 429 || response.status >= 500);

      throw new LlmError(`DeepSeek API Error (${response.status}): ${message}`, {
        retryable: isRetryable,
        provider: this.provider,
        code: errCode,
        status: response.status
      });
    }

    let fullText = '';
    let fullReasoning = '';
    const toolCallsMap: Map<number, { id: string; name: string; args: string }> = new Map();
    let stopReason: StopReason = 'end_turn';
    let usage: NormalizedUsage | undefined;
    let insufficientResourceError = false;
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
          cachedTokens: chunk.usage.prompt_cache_hit_tokens || 0,
          reasoningTokens: chunk.usage.completion_tokens_details?.reasoning_tokens || 0
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
          else if (rawReason === 'insufficient_system_resource') {
            insufficientResourceError = true;
          } else stopReason = 'end_turn';
        }
      }
    });

    if (insufficientResourceError) {
      throw new LlmError(`DeepSeek API Error: Server returned insufficient_system_resource.`, {
        retryable: true,
        provider: this.provider,
        code: 'insufficient_system_resource'
      });
    }

    if (!sawTerminal) {
      throw new LlmError(`DeepSeek Stream Error: stream disconnected prematurely without terminal finish_reason.`, {
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
        callId: tc.id,
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
    let baseUrl = endpoint || 'https://api.deepseek.com';
    baseUrl = baseUrl.replace(/\/$/, '');
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
      console.warn('[DeepSeekAdapter] Failed to fetch live models from API, using fallback roster', e);
    }

    return [
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'deepseek-v4-flash-vision-exp'
    ];
  }
}
