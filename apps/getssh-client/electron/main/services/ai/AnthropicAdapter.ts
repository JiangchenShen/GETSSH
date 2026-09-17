import { BaseAdapter } from './BaseAdapter';
import { LlmRequest, LlmResponse, StreamCallbacks, Block, Turn, UnifiedTool, NormalizedUsage, StopReason, LlmError } from './types';
import { ConcurrencyManager } from './ConcurrencyManager';
import { ModelCaps } from './ModelCapabilities';

interface ThinkingBlockState {
  type: 'thinking' | 'redacted_thinking';
  text: string;
  signature: string;
  data?: string;
}

interface ToolUseBlockState {
  id: string;
  name: string;
  args: string;
}

interface TextBlockState {
  text: string;
}

type StreamBlockState = 
  | { kind: 'thinking'; state: ThinkingBlockState }
  | { kind: 'tool_use'; state: ToolUseBlockState }
  | { kind: 'text'; state: TextBlockState };

export class AnthropicAdapter extends BaseAdapter {
  readonly provider = 'anthropic';

  async streamTurn(request: LlmRequest, callbacks: StreamCallbacks): Promise<LlmResponse> {
    const cm = ConcurrencyManager.getInstance();
    await cm.acquire(this.provider, request.signal);
    try {
      return await this.streamMessagesApi(request, callbacks);
    } finally {
      cm.release(this.provider);
    }
  }

  private async streamMessagesApi(request: LlmRequest, callbacks: StreamCallbacks): Promise<LlmResponse> {
    let baseUrl = request.endpoint || 'https://api.anthropic.com';
    baseUrl = baseUrl.replace(/\/v1\/messages\/?$/, '').replace(/\/$/, '');
    const url = `${baseUrl}/v1/messages`;

    const { systemInstruction, turns } = this.normalizeTurns(request);
    
    const messages: any[] = [];

    for (const turn of turns) {
      if (turn.role === 'user') {
        const contentBlocks: any[] = [];
        
        const textParts = turn.blocks
          .filter((b): b is { kind: 'text'; text: string } => b.kind === 'text')
          .map(b => b.text)
          .join('\n');
        
        const toolResultParts = turn.blocks
          .filter((b): b is { kind: 'tool_result'; callId: string; name?: string; content: any[]; isError?: boolean } => b.kind === 'tool_result');

        if (textParts) {
          contentBlocks.push({ type: 'text', text: textParts });
        }

        for (const tr of toolResultParts) {
          const outText = tr.content
            .map(c => (typeof c === 'string' ? c : c.kind === 'text' ? c.text : JSON.stringify(c)))
            .join('\n');
          contentBlocks.push({
            type: 'tool_result',
            tool_use_id: tr.callId,
            content: outText,
            is_error: tr.isError || false
          });
        }
        
        if (contentBlocks.length > 0) {
          messages.push({ role: 'user', content: contentBlocks });
        }
      } else if (turn.role === 'assistant') {
        const contentBlocks: any[] = [];
        
        // Anthropic STRICT ordering: thinking -> tool_use -> text
        const thoughtParts = turn.blocks.filter((b): b is { kind: 'thought'; text?: string; opaque?: string } => b.kind === 'thought');
        const toolCalls = turn.blocks.filter((b): b is { kind: 'tool_call'; callId: string; name: string; args: any; raw: string } => b.kind === 'tool_call');
        const textParts = turn.blocks.filter((b): b is { kind: 'text'; text: string } => b.kind === 'text').map(b => b.text).join('\n');

        for (const th of thoughtParts) {
          if (th.opaque) {
            try {
              const parsed = JSON.parse(th.opaque);
              if (parsed.type === 'redacted_thinking') {
                contentBlocks.push({
                  type: 'redacted_thinking',
                  data: parsed.data,
                  signature: parsed.signature
                });
              } else {
                contentBlocks.push({
                  type: 'thinking',
                  thinking: th.text || '',
                  signature: parsed.signature || th.opaque
                });
              }
            } catch (e) {
              contentBlocks.push({
                type: 'thinking',
                thinking: th.text || '',
                signature: th.opaque
              });
            }
          }
        }

        if (textParts) {
          contentBlocks.push({ type: 'text', text: textParts });
        }

        for (const tc of toolCalls) {
          contentBlocks.push({
            type: 'tool_use',
            id: tc.callId,
            name: tc.name,
            input: tc.args || {}
          });
        }

        if (contentBlocks.length > 0) {
          messages.push({ role: 'assistant', content: contentBlocks });
        }
      }
    }

    const modelName = request.model || 'claude-opus-5';
    const caps = ModelCaps.resolve(this.provider, modelName);
    const isHaiku = modelName.includes('haiku');

    const requestBody: any = {
      model: modelName,
      max_tokens: request.maxOutputTokens || (isHaiku ? 8192 : 65536),
      stream: true,
      messages
    };

    if (systemInstruction) {
      requestBody.system = [{ type: 'text', text: systemInstruction }];
    }

    const hasTools = request.tools && request.tools.length > 0;
    if (hasTools) {
      requestBody.tools = request.tools!.map((tool: UnifiedTool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters
      }));

      if (request.toolChoice === 'none') {
        requestBody.tool_choice = { type: 'none' };
      } else if ((request.toolChoice === 'required' || request.toolChoice === 'any') && caps.supportsToolChoiceRequired) {
        requestBody.tool_choice = { type: 'any' };
      } else if (typeof request.toolChoice === 'object' && request.toolChoice.name && caps.supportsToolChoiceRequired) {
        requestBody.tool_choice = { type: 'tool', name: request.toolChoice.name };
      } else {
        requestBody.tool_choice = { type: 'auto' };
      }
    }

    // 思考能力门控全部走能力表：家族规则 + 运行时学到的 quirk。
    // 未知型号（caps.known === false）走最小请求，什么可选字段都不发。
    if (!caps.supportsThinking) {
      // 不下发 thinking，也不下发 output_config
    } else if (request.thinkingEffort === 'none' && caps.thinkingCanBeDisabled) {
      requestBody.thinking = { type: 'disabled' };
    } else {
      requestBody.thinking = { type: 'adaptive', display: 'summarized' };
      if (caps.thinkingParamStyle === 'effort') {
        requestBody.output_config = { effort: request.thinkingEffort || 'high' };
      }
    }

    // Anthropic 新模型对采样参数是硬拒；未知模型也一律不发。
    if (caps.supportsSampling && request.temperature !== undefined) {
      requestBody.temperature = request.temperature;
    }

    if (!request.apiKey) {
      throw new LlmError('未检测到有效的 API Key。请先在 AI 设置中保存您的 Anthropic API Key。', {
        retryable: false,
        provider: this.provider,
        code: 'MISSING_API_KEY'
      });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': request.apiKey,
      'anthropic-version': '2023-06-01'
    };

    const timeoutSignal = AbortSignal.timeout(600000);
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
      let errCode = '';

      const errJson = await response.json().catch(() => null);
      if (errJson && errJson.error) {
        message = errJson.error.message || message;
        errCode = errJson.error.type || '';
        
        if (errJson.error.details && errJson.error.details.error_code === 'enforced_spend_limit_reached') {
          isQuotaExhausted = true;
          message = 'Spend Limit Reached (余额耗尽，此报错不支持重试)';
        }
      }

      const isRetryable = !isQuotaExhausted && (response.status === 429 || response.status >= 500);

      throw new LlmError(`Anthropic API Error (${response.status}): ${message}`, {
        retryable: isRetryable,
        provider: this.provider,
        code: errCode,
        status: response.status
      });
    }

    const blockStates: Map<number, StreamBlockState> = new Map();
    let stopReason: StopReason = 'end_turn';
    let usage: NormalizedUsage | undefined;
    let hasStreamError = false;
    let sawTerminal = false;
    
    await this.processSseStream(response, (event, dataStr) => {
      let chunk: any;
      try { chunk = JSON.parse(dataStr); } catch (e) { return; }

      if (chunk.type === 'content_block_start') {
        const index = chunk.index;
        const block = chunk.content_block;
        if (block.type === 'thinking') {
          blockStates.set(index, {
            kind: 'thinking',
            state: { type: 'thinking', text: '', signature: '' }
          });
        } else if (block.type === 'redacted_thinking') {
          blockStates.set(index, {
            kind: 'thinking',
            state: { type: 'redacted_thinking', text: '', signature: '', data: block.data }
          });
        } else if (block.type === 'tool_use') {
          blockStates.set(index, {
            kind: 'tool_use',
            state: { id: block.id, name: block.name, args: '' }
          });
        } else if (block.type === 'text') {
          blockStates.set(index, {
            kind: 'text',
            state: { text: block.text || '' }
          });
        }
      } else if (chunk.type === 'content_block_delta') {
        const index = chunk.index;
        const delta = chunk.delta;
        const current = blockStates.get(index);
        
        if (delta.type === 'text_delta') {
          if (current && current.kind === 'text') {
            current.state.text += delta.text;
          }
          callbacks.onChunk?.(delta.text);
        } else if (delta.type === 'input_json_delta') {
          if (current && current.kind === 'tool_use') {
            current.state.args += delta.partial_json;
          }
        } else if (delta.type === 'thinking_delta') {
          if (current && current.kind === 'thinking') {
            current.state.text += delta.thinking;
          }
          callbacks.onThoughtChunk?.(delta.thinking);
        } else if (delta.type === 'signature_delta') {
          if (current && current.kind === 'thinking') {
            current.state.signature = delta.signature;
          }
        }
      } else if (chunk.type === 'message_delta') {
        if (chunk.delta && chunk.delta.stop_reason) {
          const rawReason = chunk.delta.stop_reason;
          if (rawReason === 'tool_use') stopReason = 'tool_use';
          else if (rawReason === 'max_tokens') stopReason = 'max_tokens';
          else if (rawReason === 'pause_turn') stopReason = 'pause_turn';
          else if (rawReason === 'refusal') stopReason = 'refusal';
          else if (rawReason === 'model_context_window_exceeded') stopReason = 'model_context_window_exceeded';
          else stopReason = 'end_turn';
          sawTerminal = true;
        }

        if (chunk.usage) {
          const rawUsage = chunk.usage;
          usage = {
            inputTokens: (rawUsage.input_tokens || 0) + (rawUsage.cache_read_input_tokens || 0) + (rawUsage.cache_creation_input_tokens || 0),
            outputTokens: rawUsage.output_tokens || 0,
            reasoningTokens: rawUsage.output_tokens_details?.thinking_tokens || 0,
            cachedTokens: rawUsage.cache_read_input_tokens || 0,
            totalTokens: ((rawUsage.input_tokens || 0) + (rawUsage.cache_read_input_tokens || 0) + (rawUsage.cache_creation_input_tokens || 0)) + (rawUsage.output_tokens || 0)
          };
        }
      } else if (chunk.type === 'message_stop') {
        sawTerminal = true;
      } else if (chunk.type === 'error') {
        hasStreamError = true;
      }
    });

    if (hasStreamError || !sawTerminal) {
      throw new LlmError(`Anthropic Stream Error: stream terminated prematurely or encountered an error event.`, {
        retryable: true,
        provider: this.provider
      });
    }

    const outputBlocks: Block[] = [];
    let fullText = '';
    const sortedIndices = Array.from(blockStates.keys()).sort((a, b) => a - b);

    for (const idx of sortedIndices) {
      const item = blockStates.get(idx)!;
      if (item.kind === 'thinking') {
        const th = item.state;
        let opaqueContent = '';
        if (th.type === 'redacted_thinking') {
          opaqueContent = JSON.stringify({ type: 'redacted_thinking', data: th.data, signature: th.signature });
        } else if (th.signature) {
          opaqueContent = JSON.stringify({ signature: th.signature });
        }
        outputBlocks.push({
          kind: 'thought',
          text: th.text,
          opaque: opaqueContent || undefined
        });
      } else if (item.kind === 'text') {
        fullText += item.state.text;
        outputBlocks.push({ kind: 'text', text: item.state.text });
      } else if (item.kind === 'tool_use') {
        const tc = item.state;
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
    }

    const toolCalls = outputBlocks
      .filter((b): b is { kind: 'tool_call'; callId: string; name: string; args: any; raw: string } => b.kind === 'tool_call')
      .map(b => ({ callId: b.callId, name: b.name, args: b.args, raw: b.raw }));

    const finalResponse: LlmResponse = {
      blocks: outputBlocks,
      text: fullText,
      toolCalls,
      stopReason,
      usage,
      model: request.model
    };

    callbacks.onDone?.(finalResponse);
    return finalResponse;
  }

  async fetchModels(apiKey: string, endpoint?: string): Promise<string[]> {
    let baseUrl = endpoint || 'https://api.anthropic.com';
    baseUrl = baseUrl.replace(/\/v1\/messages\/?$/, '').replace(/\/$/, '');
    const url = `${baseUrl}/v1/models`;

    try {
      if (apiKey) {
        const res = await fetch(url, {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
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
      console.warn('[AnthropicAdapter] Failed to fetch live models from API, using fallback roster', e);
    }

    return [
      'claude-opus-5',
      'claude-sonnet-5',
      'claude-fable-5',
      'claude-mythos-5',
      'claude-haiku-4-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-opus-4-6',
      'claude-sonnet-4-6'
    ];
  }
}
