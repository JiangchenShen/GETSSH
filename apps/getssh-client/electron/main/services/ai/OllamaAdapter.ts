import { BaseAdapter } from './BaseAdapter';
import { LlmRequest, LlmResponse, StreamCallbacks, Block, Turn, UnifiedTool, StopReason } from './types';

export class OllamaAdapter extends BaseAdapter {
  readonly provider = 'ollama';

  async streamTurn(request: LlmRequest, callbacks: StreamCallbacks): Promise<LlmResponse> {
    let baseUrl = request.endpoint || 'http://127.0.0.1:11434';
    baseUrl = baseUrl.replace(/\/v1\/chat\/completions\/?$/, '').replace(/\/api\/chat\/?$/, '').replace(/\/$/, '');
    const url = `${baseUrl}/v1/chat/completions`;

    const { systemInstruction, turns } = this.normalizeTurns(request);

    const messages: any[] = [];
    if (systemInstruction) {
      messages.push({ role: 'system', content: systemInstruction });
    }

    for (const turn of turns) {
      if (turn.role === 'user') {
        const textParts = turn.blocks
          .filter((b): b is { kind: 'text'; text: string } => b.kind === 'text')
          .map(b => b.text)
          .join('\n');
        
        const toolResultParts = turn.blocks.filter((b): b is { kind: 'tool_result'; callId: string; content: any[]; isError?: boolean } => b.kind === 'tool_result');

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
        
        const toolCalls = turn.blocks
          .filter((b): b is { kind: 'tool_call'; callId: string; name: string; args: any; raw: string } => b.kind === 'tool_call')
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
        messages.push(assistantMsg);
      }
    }

    const tools = request.tools?.map((tool: UnifiedTool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));

    const requestBody: any = {
      model: request.model || 'llama3',
      messages,
      stream: true
    };

    if (tools && tools.length > 0) {
      requestBody.tools = tools;
      requestBody.tool_choice = request.toolChoice || 'auto';
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: request.signal
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Ollama API Error (${response.status}): ${errText}`);
    }

    let fullText = '';
    const toolCallsMap: Map<number, { id: string; name: string; args: string }> = new Map();
    let stopReason: StopReason = 'end_turn';

    await this.processSseStream(response, (event, dataStr) => {
      if (dataStr === '[DONE]') return;

      let chunk: any;
      try {
        chunk = JSON.parse(dataStr);
      } catch (e) {
        return;
      }

      const choice = chunk.choices?.[0];
      if (choice?.delta?.content) {
        fullText += choice.delta.content;
        callbacks.onChunk?.(choice.delta.content);
      }

      if (choice?.delta?.tool_calls) {
        for (const tc of choice.delta.tool_calls) {
          const idx = tc.index ?? 0;
          const current = toolCallsMap.get(idx) || { id: '', name: '', args: '' };
          if (tc.id) current.id = tc.id;
          if (tc.function?.name) current.name = tc.function.name;
          if (tc.function?.arguments) current.args += tc.function.arguments;
          toolCallsMap.set(idx, current);
        }
      }

      if (choice?.finish_reason === 'tool_calls') {
        stopReason = 'tool_use';
      }
    });

    const outputBlocks: Block[] = [];
    if (fullText) {
      outputBlocks.push({ kind: 'text', text: fullText });
    }

    const toolCalls: Array<{ callId: string; name: string; args: any; raw: string }> = [];
    for (const [_, tc] of toolCallsMap.entries()) {
      let parsed = {};
      try {
        parsed = JSON.parse(tc.args || '{}');
      } catch (e) {
        parsed = { _raw: tc.args };
      }
      const callObj = { callId: tc.id || `call_${Date.now()}`, name: tc.name, args: parsed, raw: tc.args };
      toolCalls.push(callObj);
      outputBlocks.push({
        kind: 'tool_call',
        callId: callObj.callId,
        name: callObj.name,
        args: callObj.args,
        raw: callObj.raw
      });
    }

    const finalResponse: LlmResponse = {
      blocks: outputBlocks,
      text: fullText,
      toolCalls,
      stopReason: toolCalls.length > 0 ? 'tool_use' : stopReason,
      model: request.model
    };

    callbacks.onDone?.(finalResponse);
    return finalResponse;
  }

  async fetchModels(apiKey: string, endpoint?: string): Promise<string[]> {
    let baseUrl = endpoint || 'http://127.0.0.1:11434';
    baseUrl = baseUrl.replace(/\/v1\/chat\/completions\/?$/, '').replace(/\/api\/chat\/?$/, '').replace(/\/$/, '');
    const url = `${baseUrl}/api/tags`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Ollama fetchModels failed: ${res.status}`);
    const data = await res.json();
    return (data.models || []).map((m: any) => m.name);
  }
}
