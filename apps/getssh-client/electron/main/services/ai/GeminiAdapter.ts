import { BaseAdapter } from './BaseAdapter';
import { LlmRequest, LlmResponse, StreamCallbacks, Block, Turn, UnifiedTool, NormalizedUsage, StopReason, LlmError } from './types';
import { ConcurrencyManager } from './ConcurrencyManager';
import { ModelCaps } from './ModelCapabilities';

interface GeminiStepState {
  type: 'user_input' | 'model_output' | 'thought' | 'function_call' | 'function_result';
  id?: string;
  name?: string;
  args?: string;
  text?: string;
  thought_signature?: string;
}

export class GeminiAdapter extends BaseAdapter {
  readonly provider = 'gemini';

  async streamTurn(request: LlmRequest, callbacks: StreamCallbacks): Promise<LlmResponse> {
    const cm = ConcurrencyManager.getInstance();
    await cm.acquire(this.provider, request.signal);
    try {
      return await this.streamInteractionsApi(request, callbacks);
    } finally {
      cm.release(this.provider);
    }
  }

  private async streamInteractionsApi(request: LlmRequest, callbacks: StreamCallbacks): Promise<LlmResponse> {
    let baseUrl = request.endpoint || 'https://generativelanguage.googleapis.com/v1beta';
    baseUrl = baseUrl.replace(/\/interactions\/?$/, '').replace(/\/models\/.*/, '').replace(/\/$/, '');
    const url = `${baseUrl}/interactions`;

    const { systemInstruction, turns } = this.normalizeTurns(request);
    
    const steps: any[] = [];

    // callId -> 工具名，用于回填 tool_result 缺失的 name
    const toolNameByCallId = new Map<string, string>();
    for (const turn of turns) {
      for (const b of turn.blocks) {
        if (b.kind === 'tool_call' && b.callId && b.name) {
          toolNameByCallId.set(b.callId, b.name);
        }
      }
    }

    for (const turn of turns) {
      if (turn.role === 'user') {
        const textParts = turn.blocks
          .filter((b): b is { kind: 'text'; text: string } => b.kind === 'text')
          .map(b => b.text)
          .join('\n');
        
        const toolResultParts = turn.blocks
          .filter((b): b is { kind: 'tool_result'; callId: string; name?: string; content: any[]; isError?: boolean } => b.kind === 'tool_result');

        if (textParts) {
          steps.push({
            type: 'user_input',
            content: [{ type: 'text', text: textParts }]
          });
        }

        for (const tr of toolResultParts) {
          const outText = tr.content
            .map(c => (typeof c === 'string' ? c : c.kind === 'text' ? c.text : JSON.stringify(c)))
            .join('\n');
          steps.push({
            type: 'function_result',
            call_id: tr.callId,
            name: tr.name || toolNameByCallId.get(tr.callId) || 'tool',
            result: [{ type: 'text', text: outText }]
          });
        }
      } else if (turn.role === 'assistant') {
        const textParts = turn.blocks.filter((b): b is { kind: 'text'; text: string } => b.kind === 'text').map(b => b.text).join('\n');
        const thoughtParts = turn.blocks.filter((b): b is { kind: 'thought'; text?: string; opaque?: string; providerItemId?: string } => b.kind === 'thought');
        const toolCalls = turn.blocks.filter((b): b is { kind: 'tool_call'; callId: string; name: string; args: any; raw: string; providerItemId?: string } => b.kind === 'tool_call');

        for (const th of thoughtParts) {
          if (th.opaque) {
            steps.push({
              type: 'thought',
              signature: th.opaque
            });
          }
        }

        if (textParts) {
          steps.push({
            type: 'model_output',
            content: [{ type: 'text', text: textParts }]
          });
        }

        for (const tc of toolCalls) {
          steps.push({
            type: 'function_call',
            id: tc.callId,
            name: tc.name,
            arguments: tc.args || {}
          });
        }
      }
    }

    const requestBody: any = {
      model: request.model || 'gemini-3.7-flash',
      store: false, // Ensure data is not retained
      stream: true
    };

    if (systemInstruction) {
      requestBody.system_instruction = systemInstruction;
    }

    if (steps.length > 0) {
      requestBody.input = steps;
    } else {
      requestBody.input = [{ type: 'user_input', content: [{ type: 'text', text: 'Hello' }] }];
    }

    const hasTools = request.tools && request.tools.length > 0;
    if (hasTools) {
      requestBody.tools = request.tools!.map((tool: UnifiedTool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }));
      
      // Interactions API 用的是顶层 tool_choice（auto / any / none / validated）。
      // toolConfig.functionCallingConfig 是 legacy generateContent 的字段，
      // 发到 /interactions 上不会生效 —— 两套 API 的形状不能混。
      if (request.toolChoice === 'none') {
        requestBody.tool_choice = 'none';
      } else if (request.toolChoice === 'required' || request.toolChoice === 'any') {
        requestBody.tool_choice = 'any';
      } else {
        requestBody.tool_choice = 'auto';
      }
    }

    requestBody.generation_config = {};
    if (request.maxOutputTokens) {
      requestBody.generation_config.max_output_tokens = request.maxOutputTokens;
    }

    // thinkingLevel 是 Gemini 的原生说法，thinkingEffort 是统一层的说法，
    // 两个都要能触发，只要不是显式关闭。
    const caps = ModelCaps.resolve(this.provider, requestBody.model || '');
    const wantsThinking = caps.supportsThinking && (
      (request.thinkingEffort && request.thinkingEffort !== 'none') ||
      (!request.thinkingEffort && !!request.thinkingLevel));

    if (wantsThinking) {
      const isGemini25 = requestBody.model.includes('gemini-2.5');
      if (isGemini25) {
        requestBody.generation_config.thinking_budget = request.thinkingBudget || -1;
      } else {
        const effort = (request.thinkingEffort || request.thinkingLevel || 'medium') as string;
        requestBody.generation_config.thinking_level = 
          (effort === 'high' || effort === 'xhigh' || effort === 'max') ? 'high'
          : effort === 'low' ? 'low'
          : effort === 'minimal' ? 'minimal'
          : 'medium';
      }
    }

    if (!request.apiKey) {
      throw new LlmError('未检测到有效的 API Key。请先在 AI 设置中保存您的 Gemini API Key。', {
        retryable: false,
        provider: this.provider,
        code: 'MISSING_API_KEY'
      });
    }

    // Pass ONLY in header, NOT in URL query to prevent leaking key in logs/proxies
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-goog-api-key': request.apiKey
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
      let code = '';

      const errJson = await response.json().catch(() => null);
      if (errJson && errJson.error) {
        code = errJson.error.code || errJson.error.status || '';
        message = errJson.error.message || message;
      }

      if (response.status === 429) {
        if (code === 'quota_exceeded' || message.includes('Quota exceeded')) {
          isQuotaExhausted = true;
          message = 'Quota Exceeded (配额耗尽，不可重试)';
        } else {
          message = 'Rate Limit Exceeded (429) - 频率超限，可指数退避重试。';
        }
      }

      const isRetryable = !isQuotaExhausted && (response.status === 429 || response.status >= 500);

      throw new LlmError(`Gemini API Error (${response.status}): ${message}`, {
        retryable: isRetryable,
        provider: this.provider,
        code,
        status: response.status
      });
    }

    const stepStates: Map<number, GeminiStepState> = new Map();
    let stopReason: StopReason = 'end_turn';
    let usage: NormalizedUsage | undefined;
    let budgetExceeded = false;
    let sawTerminal = false;

    await this.processSseStream(response, (event, dataStr) => {
      if (dataStr === '[DONE]') {
        sawTerminal = true;
        return;
      }

      let chunk: any;
      try { chunk = JSON.parse(dataStr); } catch (e) { return; }

      // 事件名以 SSE 的 event: 行为准，payload 里的 event_type 只作兜底。
      // 只认 event_type 的话，一旦服务端某类事件没在 body 里重复带这个字段，
      // 整条分支就全不触发（表现为工具调用凭空消失、stopReason 退回 end_turn）。
      const eventType = (event && event !== 'message') ? event : chunk.event_type;
      const index = chunk.index ?? 0;

      if (eventType === 'step.start') {
        const step = chunk.step;
        if (step) {
          stepStates.set(index, {
            type: step.type,
            id: step.id,
            name: step.name,
            args: ''
          });
        }
      } else if (eventType === 'step.delta') {
        const delta = chunk.delta;
        if (!stepStates.has(index)) {
          stepStates.set(index, {
            type: delta.type === 'arguments_delta' ? 'function_call' : delta.type === 'thought' ? 'thought' : 'model_output'
          });
        }
        const cur = stepStates.get(index)!;

        if (delta.type === 'text') {
          cur.text = (cur.text || '') + delta.text;
          callbacks.onChunk?.(delta.text);
        } else if (delta.type === 'arguments_delta') {
          cur.args = (cur.args || '') + (delta.arguments || '');
        } else if (delta.type === 'thought_summary' || delta.type === 'thought') {
          const txt = delta.content?.text || delta.text || '';
          if (txt) {
            cur.text = (cur.text || '') + txt;
            callbacks.onThoughtChunk?.(txt);
          }
        } else if (delta.type === 'thought_signature') {
          cur.thought_signature = delta.signature;
        }
      } else if (eventType === 'interaction.status_update' || eventType === 'interaction.completed') {
        sawTerminal = true;
        const interaction = chunk.interaction;
        if (interaction) {
          if (interaction.status === 'requires_action') stopReason = 'tool_use';
          else if (interaction.status === 'budget_exceeded') budgetExceeded = true;
          else if (interaction.status === 'completed') {
            stopReason = 'end_turn';
          }

          if (interaction.usage) {
            const rawUsage = interaction.usage;
            usage = {
              inputTokens: rawUsage.total_input_tokens || 0,
              outputTokens: rawUsage.total_output_tokens || 0,
              reasoningTokens: rawUsage.total_thought_tokens || 0,
              cachedTokens: rawUsage.total_cached_tokens || 0,
              totalTokens: rawUsage.total_tokens || 0
            };
          }
        }
      }
    });

    if (!sawTerminal) {
      throw new LlmError(`Gemini Stream Error: stream terminated prematurely without completion event.`, {
        retryable: true,
        provider: this.provider
      });
    }

    if (budgetExceeded) {
      stopReason = 'budget_exceeded';
    }

    const outputBlocks: Block[] = [];
    let fullText = '';
    const toolCallsList: Array<{ callId: string; name: string; args: any; raw: string }> = [];

    const sortedStepIndices = Array.from(stepStates.keys()).sort((a, b) => a - b);

    for (const idx of sortedStepIndices) {
      const step = stepStates.get(idx)!;
      if (step.type === 'thought' || step.thought_signature) {
        outputBlocks.push({
          kind: 'thought',
          text: step.text || '',
          opaque: step.thought_signature || undefined
        });
      } else if (step.type === 'model_output' || step.text) {
        fullText += (step.text || '');
        outputBlocks.push({ kind: 'text', text: step.text || '' });
      } else if (step.type === 'function_call') {
        let parsedArgs = {};
        try { parsedArgs = JSON.parse(step.args || '{}'); } catch { parsedArgs = { _raw: step.args }; }
        
        const callId = step.id || `call_${Math.random().toString(36).substring(7)}`;
        outputBlocks.push({
          kind: 'tool_call',
          callId,
          name: step.name || '',
          args: parsedArgs,
          raw: step.args || ''
        });
        toolCallsList.push({ callId, name: step.name || '', args: parsedArgs, raw: step.args || '' });
      }
    }

    if (toolCallsList.length > 0 && stopReason !== 'budget_exceeded') {
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
    let baseUrl = endpoint || 'https://generativelanguage.googleapis.com/v1beta';
    baseUrl = baseUrl.replace(/\/interactions\/?$/, '').replace(/\/models\/.*/, '').replace(/\/$/, '');
    const url = `${baseUrl}/models`;

    try {
      if (apiKey) {
        const res = await fetch(url, {
          headers: { 'x-goog-api-key': apiKey },
          signal: AbortSignal.timeout(10000)
        });
        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json.models)) {
            return json.models.map((m: any) => m.name.replace(/^models\//, ''));
          }
        }
      }
    } catch (e) {
      console.warn('[GeminiAdapter] Failed to fetch live models from API, using fallback roster', e);
    }

    return [
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite'
    ];
  }
}
