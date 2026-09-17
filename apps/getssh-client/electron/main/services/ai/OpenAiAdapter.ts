import { BaseAdapter } from './BaseAdapter';
import { LlmRequest, LlmResponse, StreamCallbacks, Block, Turn, UnifiedTool, NormalizedUsage, StopReason, LlmError } from './types';
import { ConcurrencyManager } from './ConcurrencyManager';
import { ModelCaps } from './ModelCapabilities';

interface OpenAiItemState {
  type: 'reasoning' | 'function_call' | 'message';
  id?: string;
  call_id?: string;
  name?: string;
  args?: string;
  text?: string;
  encrypted_content?: string;
}

export class OpenAiAdapter extends BaseAdapter {
  readonly provider = 'openai';

  async streamTurn(request: LlmRequest, callbacks: StreamCallbacks): Promise<LlmResponse> {
    const cm = ConcurrencyManager.getInstance();
    await cm.acquire(this.provider, request.signal);
    try {
      return await this.streamResponsesApi(request, callbacks);
    } finally {
      cm.release(this.provider);
    }
  }

  private async streamResponsesApi(request: LlmRequest, callbacks: StreamCallbacks): Promise<LlmResponse> {
    let baseUrl = request.endpoint || 'https://api.openai.com/v1';
    baseUrl = baseUrl.replace(/\/chat\/completions\/?$/, '').replace(/\/responses\/?$/, '').replace(/\/$/, '');
    const url = `${baseUrl}/responses`;

    const { systemInstruction, turns } = this.normalizeTurns(request);
    
    // Convert turns to Response API items
    const inputItems: any[] = [];

    for (const turn of turns) {
      if (turn.role === 'user') {
        const textParts = turn.blocks
          .filter((b): b is { kind: 'text'; text: string } => b.kind === 'text')
          .map(b => b.text)
          .join('\n');
        
        const toolResultParts = turn.blocks
          .filter((b): b is { kind: 'tool_result'; callId: string; name?: string; content: any[]; isError?: boolean } => b.kind === 'tool_result');

        if (textParts) {
          inputItems.push({
            type: 'message',
            role: 'user',
            content: textParts
          });
        }

        for (const tr of toolResultParts) {
          const outText = tr.content
            .map(c => (typeof c === 'string' ? c : c.kind === 'text' ? c.text : JSON.stringify(c)))
            .join('\n');
          inputItems.push({
            type: 'function_call_output',
            call_id: tr.callId,
            output: outText
          });
        }
      } else if (turn.role === 'assistant') {
        const textParts = turn.blocks
          .filter((b): b is { kind: 'text'; text: string } => b.kind === 'text')
          .map(b => b.text)
          .join('\n');
        
        const thoughtParts = turn.blocks
          .filter((b): b is { kind: 'thought'; text?: string; opaque?: string; providerItemId?: string } => b.kind === 'thought');
        
        const toolCalls = turn.blocks
          .filter((b): b is { kind: 'tool_call'; callId: string; name: string; args: any; raw: string; providerItemId?: string } => b.kind === 'tool_call');

        // Order: reasoning -> function_call -> message
        for (const th of thoughtParts) {
          if (th.opaque) {
            const rItem: any = {
              type: 'reasoning',
              encrypted_content: th.opaque
            };
            if (th.providerItemId) {
              rItem.id = th.providerItemId;
            }
            inputItems.push(rItem);
          }
        }

        for (const tc of toolCalls) {
          const fcItem: any = {
            type: 'function_call',
            call_id: tc.callId,
            name: tc.name,
            arguments: tc.raw || JSON.stringify(tc.args || {})
          };
          if (tc.providerItemId) {
            fcItem.id = tc.providerItemId;
          }
          inputItems.push(fcItem);
        }

        if (textParts) {
          inputItems.push({
            type: 'message',
            role: 'assistant',
            content: textParts
          });
        }
      }
    }

    const requestBody: any = {
      model: request.model || 'gpt-5.6-terra',
      stream: true,
      store: false // Explicitly disable data retention for BYOK privacy
    };

    if (systemInstruction) {
      requestBody.instructions = systemInstruction;
    }

    if (inputItems.length > 0) {
      requestBody.input = inputItems;
    } else {
      requestBody.input = [{ type: 'message', role: 'user', content: 'Hello' }];
    }

    const hasTools = request.tools && request.tools.length > 0;
    if (hasTools) {
      requestBody.tools = request.tools!.map((tool: UnifiedTool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        strict: tool.strict ?? false // Default false to prevent breaking schemas without additionalProperties:false
      }));

      if (request.toolChoice === 'none') {
        requestBody.tool_choice = 'none';
      } else if (request.toolChoice === 'required' || request.toolChoice === 'any') {
        requestBody.tool_choice = 'required';
      } else if (typeof request.toolChoice === 'object' && request.toolChoice.name) {
        requestBody.tool_choice = { type: 'function', name: request.toolChoice.name };
      } else {
        requestBody.tool_choice = 'auto';
      }
    }

    if (request.maxOutputTokens) {
      requestBody.max_output_tokens = request.maxOutputTokens;
    }

    const caps = ModelCaps.resolve(this.provider, request.model || '');
    if (!caps.supportsThinking) {
      // 未知或非推理型号：reasoning 整块不发，走最小请求
    } else if (request.thinkingEffort === 'none' && caps.thinkingCanBeDisabled) {
      requestBody.reasoning = { effort: 'none' };
    } else {
      requestBody.reasoning = {
        effort: request.thinkingEffort || 'high',
        context: 'all_turns'
      };
      requestBody.include = ["reasoning.encrypted_content"];
    }

    if (caps.supportsSampling && request.temperature !== undefined) {
      requestBody.temperature = request.temperature;
    }

    if (!request.apiKey) {
      throw new LlmError('未检测到有效的 API Key。请先在 AI 设置中保存您的 OpenAI API Key。', {
        retryable: false,
        provider: this.provider,
        code: 'MISSING_API_KEY'
      });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${request.apiKey}`
    };

    const timeoutSignal = AbortSignal.timeout(300000);
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
      let message = response.statusText;
      let isQuotaExhausted = false;
      let errorCode = '';

      const errJson = await response.json().catch(() => null);
      if (errJson && errJson.error) {
        message = errJson.error.message || message;
        errorCode = errJson.error.code || errJson.error.type || '';
      }

      if (response.status === 429) {
        if (errorCode === 'insufficient_quota') {
          isQuotaExhausted = true;
          message = 'Insufficient Quota (余额/额度耗尽，请充值或提升配额)';
        } else {
          message = `Rate Limit Error (${errorCode}) - 并发超限，请稍后重试。`;
        }
      }

      const isRetryable = !isQuotaExhausted && (response.status === 429 || response.status >= 500);

      throw new LlmError(`OpenAI API Error (${response.status}): ${message}`, {
        retryable: isRetryable,
        provider: this.provider,
        code: errorCode,
        status: response.status
      });
    }

    // itemId -> item state
    const itemsMap: Map<string, OpenAiItemState> = new Map();
    const itemOrder: string[] = [];
    let stopReason = 'end_turn' as StopReason;
    let usage: NormalizedUsage | undefined;
    let hasStreamError = false;
    let sawTerminal = false;

    await this.processSseStream(response, (event, dataStr) => {
      if (dataStr === '[DONE]') {
        sawTerminal = true;
        return;
      }

      let chunk: any;
      try { chunk = JSON.parse(dataStr); } catch (e) { return; }

      if (chunk.type === 'response.output_text.delta') {
        const itemId = chunk.item_id || 'default_msg';
        if (!itemsMap.has(itemId)) {
          itemsMap.set(itemId, { type: 'message', text: '' });
          itemOrder.push(itemId);
        }
        if (chunk.delta) {
          itemsMap.get(itemId)!.text += chunk.delta;
          callbacks.onChunk?.(chunk.delta);
        }
      } else if (chunk.type === 'response.reasoning_text.delta') {
        const itemId = chunk.item_id || 'default_reasoning';
        if (!itemsMap.has(itemId)) {
          itemsMap.set(itemId, { type: 'reasoning', text: '' });
          itemOrder.push(itemId);
        }
        if (chunk.delta) {
          itemsMap.get(itemId)!.text += chunk.delta;
          callbacks.onThoughtChunk?.(chunk.delta);
        }
      } else if (chunk.type === 'response.function_call_arguments.delta') {
        const itemId = chunk.item_id;
        if (!itemsMap.has(itemId)) {
          itemsMap.set(itemId, { type: 'function_call', call_id: '', name: '', args: '' });
          itemOrder.push(itemId);
        }
        if (chunk.delta) {
          itemsMap.get(itemId)!.args += chunk.delta;
        }
      } else if (chunk.type === 'response.output_item.added') {
        if (chunk.item) {
          const itemId = chunk.item.id;
          if (!itemsMap.has(itemId)) {
            itemsMap.set(itemId, {
              type: chunk.item.type,
              id: chunk.item.id,
              call_id: chunk.item.call_id,
              name: chunk.item.name,
              args: chunk.item.arguments || '',
              text: '',
              encrypted_content: chunk.item.encrypted_content
            });
            itemOrder.push(itemId);
          } else {
            const cur = itemsMap.get(itemId)!;
            cur.id = chunk.item.id || cur.id;
            cur.call_id = chunk.item.call_id || cur.call_id;
            cur.name = chunk.item.name || cur.name;
            cur.encrypted_content = chunk.item.encrypted_content || cur.encrypted_content;
          }
        }
      } else if (chunk.type === 'response.output_item.done') {
        if (chunk.item) {
          const itemId = chunk.item.id;
          if (!itemsMap.has(itemId)) {
            itemsMap.set(itemId, {
              type: chunk.item.type,
              id: chunk.item.id,
              call_id: chunk.item.call_id,
              name: chunk.item.name,
              args: chunk.item.arguments || '',
              text: '',
              encrypted_content: chunk.item.encrypted_content
            });
            itemOrder.push(itemId);
          } else {
            const cur = itemsMap.get(itemId)!;
            cur.id = chunk.item.id || cur.id;
            cur.call_id = chunk.item.call_id || cur.call_id;
            cur.name = chunk.item.name || cur.name;
            cur.args = chunk.item.arguments || cur.args;
            cur.encrypted_content = chunk.item.encrypted_content || cur.encrypted_content;
          }
        }
      } else if (chunk.type === 'response.completed') {
        sawTerminal = true;
        if (chunk.response && chunk.response.usage) {
          const rawUsage = chunk.response.usage;
          usage = {
            inputTokens: rawUsage.input_tokens || 0,
            outputTokens: rawUsage.output_tokens || 0,
            reasoningTokens: rawUsage.output_tokens_details?.reasoning_tokens || 0,
            cachedTokens: rawUsage.input_tokens_details?.cached_tokens || 0,
            totalTokens: rawUsage.total_tokens || 0
          };
        }
      } else if (chunk.type === 'response.incomplete') {
        sawTerminal = true;
        stopReason = 'max_tokens';
      } else if (chunk.type === 'response.failed' || chunk.type === 'error') {
        hasStreamError = true;
      }
    });

    if (hasStreamError || !sawTerminal) {
      throw new LlmError(`OpenAI Stream Error: stream terminated unexpectedly without terminal event.`, {
        retryable: true,
        provider: this.provider
      });
    }

    const outputBlocks: Block[] = [];
    let fullText = '';
    const toolCallsList: Array<{ callId: string; name: string; args: any; raw: string }> = [];

    for (const itemId of itemOrder) {
      const item = itemsMap.get(itemId)!;
      if (item.type === 'reasoning') {
        outputBlocks.push({ 
          kind: 'thought', 
          text: item.text || '', 
          opaque: item.encrypted_content, // Undefined if not provided, NEVER sentinel string
          providerItemId: item.id
        });
      } else if (item.type === 'message') {
        fullText += (item.text || '');
        outputBlocks.push({ kind: 'text', text: item.text || '' });
      } else if (item.type === 'function_call') {
        let parsedArgs = {};
        try { parsedArgs = JSON.parse(item.args || '{}'); } catch { parsedArgs = { _raw: item.args }; }
        
        const callId = item.call_id || item.id || `call_${Math.random().toString(36).substring(7)}`;
        const tcBlock: Block = {
          kind: 'tool_call',
          callId,
          name: item.name || '',
          args: parsedArgs,
          raw: item.args || '',
          providerItemId: item.id
        };
        outputBlocks.push(tcBlock);
        toolCallsList.push({ callId, name: item.name || '', args: parsedArgs, raw: item.args || '' });
      }
    }

    // Only set tool_use stop reason if we weren't truncated by max_tokens
    if (toolCallsList.length > 0 && stopReason !== 'max_tokens') {
      stopReason = 'tool_use';
    }

    const finalResponse: LlmResponse = {
      blocks: outputBlocks,
      text: fullText,
      toolCalls: toolCallsList,
      stopReason,
      usage,
      model: request.model
    };

    callbacks.onDone?.(finalResponse);
    return finalResponse;
  }

  async fetchModels(apiKey: string, endpoint?: string): Promise<string[]> {
    let baseUrl = endpoint || 'https://api.openai.com/v1';
    baseUrl = baseUrl.replace(/\/chat\/completions\/?$/, '').replace(/\/responses\/?$/, '').replace(/\/$/, '');
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
      console.warn('[OpenAiAdapter] Failed to fetch live models from API, using fallback roster', e);
    }

    return [
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.6',
      'gpt-5',
      'gpt-5-mini',
      'o3',
      'o3-mini',
      'gpt-4o'
    ];
  }
}
