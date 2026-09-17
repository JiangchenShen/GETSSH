import { ILlmAdapter, LlmRequest, LlmResponse, StreamCallbacks, Turn, Block } from './types';

export abstract class BaseAdapter implements ILlmAdapter {
  abstract readonly provider: string;

  abstract streamTurn(request: LlmRequest, callbacks: StreamCallbacks): Promise<LlmResponse>;
  abstract fetchModels(apiKey: string, endpoint?: string): Promise<string[]>;

  /**
   * Helper to normalize history from request:
   * If `request.history` is provided, use it directly.
   * Otherwise assemble a standard turn list from systemPrompt, context, and prompt.
   */
  protected normalizeTurns(request: LlmRequest): { systemInstruction?: string; turns: Turn[] } {
    const turns: Turn[] = [];
    let systemInstruction = request.systemPrompt || '';

    if (request.context) {
      if (systemInstruction) {
        systemInstruction = `${systemInstruction}\n\n[Context]\n${request.context}`;
      } else {
        systemInstruction = `[Context]\n${request.context}`;
      }
    }

    if (request.history && request.history.length > 0) {
      // Check if there is a system turn at the beginning of history
      for (const turn of request.history) {
        if (turn.role === 'system') {
          const sysText = turn.blocks
            .filter((b): b is { kind: 'text'; text: string } => b.kind === 'text')
            .map(b => b.text)
            .join('\n');
          systemInstruction = systemInstruction ? `${systemInstruction}\n\n${sysText}` : sysText;
        } else {
          turns.push(turn);
        }
      }
    } else if (request.prompt) {
      turns.push({
        role: 'user',
        blocks: [{ kind: 'text', text: request.prompt }]
      });
    }

    return { systemInstruction: systemInstruction.trim() || undefined, turns };
  }

  /**
   * Helper to handle SSE response stream with lines
   */
  protected async processSseStream(
    response: Response,
    onSseEvent: (event: string, data: string) => void | Promise<void>
  ): Promise<void> {
    if (!response.body) {
      throw new Error('Response body is null');
    }

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
          if (!line) {
            // Empty line: reset event type
            currentEvent = 'message';
            continue;
          }

          if (line.startsWith(':')) {
            // SSE comment / ping, ignore
            continue;
          }

          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const data = line.slice(6);
            await onSseEvent(currentEvent, data);
          } else if (line.startsWith('data:')) {
            const data = line.slice(5);
            await onSseEvent(currentEvent, data);
          }
        }
      }

      // Flush remaining line if any
      if (buffer.trim()) {
        const line = buffer.trim();
        if (line.startsWith('data: ')) {
          await onSseEvent(currentEvent, line.slice(6));
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Parse rate limit / quota errors to distinguish non-retryable 429 errors from standard rate limits
   */
  protected checkRateLimitError(status: number, errBody: any): { isQuotaExhausted: boolean; message: string } {
    const bodyStr = typeof errBody === 'string' ? errBody : JSON.stringify(errBody);
    
    // Anthropic: enforced_spend_limit_reached
    if (errBody?.error?.details?.error_code === 'enforced_spend_limit_reached') {
      return { isQuotaExhausted: true, message: 'Anthropic spend limit reached. Refusing retry.' };
    }

    // OpenAI: insufficient_quota
    if (errBody?.error?.code === 'insufficient_quota') {
      return { isQuotaExhausted: true, message: 'OpenAI insufficient quota / balance exhausted.' };
    }

    // Gemini: quota_exceeded
    if (errBody?.error?.code === 'quota_exceeded' || errBody?.error?.status === 'RESOURCE_EXHAUSTED') {
      if (bodyStr.includes('Quota exceeded') || bodyStr.includes('quota_exceeded')) {
        return { isQuotaExhausted: true, message: 'Google Gemini daily quota exhausted.' };
      }
    }

    return { isQuotaExhausted: false, message: bodyStr };
  }
}
