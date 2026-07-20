/**
 * AI 流式请求服务 (Streaming LLM Service)
 * 支持多提供商 (OpenAI, Gemini, Ollama)
 */
import { SentinelGateway } from './SentinelGateway';

export async function streamLLM(
  endpoint: string,
  apiKey: string,
  provider: string,
  model: string,
  prompt: string,
  context: string,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (error: Error) => void
) {
  try {
    let apiUrl = endpoint;
    let fetchOptions: RequestInit = {};

    console.log(`[LLM Service] Initiating stream via provider: ${provider}, model: ${model}`);

    // [Sentinel] Sanitize the incoming prompt and context
    const sanitizedPrompt = SentinelGateway.sanitize(prompt);
    const sanitizedContext = SentinelGateway.sanitize(context);

    // Merge their mapping dicts
    const mappingDict = { ...sanitizedPrompt.mappingDict, ...sanitizedContext.mappingDict };
    const safePrompt = sanitizedPrompt.cleanText;
    const safeContext = sanitizedContext.cleanText;

    if (provider === 'gemini') {
      apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
      const text = safeContext ? `Context:\n${safeContext}\n\nQuery:\n${safePrompt}` : safePrompt;
      
      fetchOptions = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text }] }]
        })
      };
    } else {
      // OpenAI / Custom / Ollama (OpenAI-compatible mode)
      if (provider === 'ollama') {
        apiUrl = endpoint || 'http://127.0.0.1:11434';
        if (!apiUrl.includes('/v1/chat/completions') && !apiUrl.includes('/api/chat')) {
          apiUrl = apiUrl.replace(/\/$/, '') + '/v1/chat/completions';
        }
      } else {
        apiUrl = endpoint || 'https://api.openai.com/v1/chat/completions';
      }

      const messages = [];
      if (safeContext) messages.push({ role: 'system', content: `Context:\n${safeContext}` });
      messages.push({ role: 'user', content: safePrompt });

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey && provider !== 'ollama') {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      fetchOptions = {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: model || 'gpt-3.5-turbo',
          messages,
          stream: true
        })
      };
    }

    const response = await fetch(apiUrl, fetchOptions);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`LLM API Error: ${response.status} ${response.statusText} - ${errText}`);
    }

    if (!response.body) {
      throw new Error('No response body from LLM');
    }

    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    // [Sentinel] Create stream rehydrator
    const rehydrator = SentinelGateway.createStreamRehydrator(mappingDict);

    for await (const chunk of response.body as any) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const dataStr = trimmed.slice(6);
          if (dataStr === '[DONE]') continue;

          try {
            const data = JSON.parse(dataStr);
            let content = '';

            if (provider === 'gemini') {
              content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            } else {
              content = data.choices?.[0]?.delta?.content || '';
            }

            if (content) {
              const rehydratedContent = rehydrator.processChunk(content);
              if (rehydratedContent) onChunk(rehydratedContent);
            }
          } catch (e) {
            // ignore
          }
        }
      }
    }

    // Flush any remaining buffered tokens
    const finalRehydrated = rehydrator.flush();
    if (finalRehydrated) onChunk(finalRehydrated);

    console.log('[LLM Service] Stream completion received.');
    onDone();
  } catch (error: any) {
    console.error('[LLM Service] Streaming error:', error);
    onError(error);
  }
}

export async function fetchAvailableModels(
  endpoint: string,
  apiKey: string,
  provider: string
): Promise<string[]> {
  try {
    let apiUrl = endpoint;
    let fetchOptions: RequestInit = {};

    if (provider === 'gemini') {
      apiUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
      fetchOptions = { method: 'GET' };
    } else if (provider === 'ollama') {
      apiUrl = endpoint || 'http://127.0.0.1:11434';
      // Remove trailing slashes and /v1/chat/completions if present
      apiUrl = apiUrl.replace(/\/v1\/chat\/completions$/, '').replace(/\/api\/chat$/, '').replace(/\/$/, '');
      apiUrl += '/api/tags';
      fetchOptions = { method: 'GET' };
    } else {
      // openai or custom
      apiUrl = endpoint || 'https://api.openai.com/v1/chat/completions';
      // Extract base URL
      apiUrl = apiUrl.replace(/\/chat\/completions$/, '').replace(/\/$/, '');
      if (!apiUrl.endsWith('/v1')) apiUrl += '/v1';
      apiUrl += '/models';
      
      const headers: Record<string, string> = {};
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      fetchOptions = { method: 'GET', headers };
    }

    const response = await fetch(apiUrl, fetchOptions);
    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (provider === 'gemini') {
      return (data.models || []).map((m: any) => m.name.replace('models/', ''));
    } else if (provider === 'ollama') {
      return (data.models || []).map((m: any) => m.name);
    } else {
      return (data.data || []).map((m: any) => m.id);
    }
  } catch (error) {
    console.error('[LLM Service] Failed to fetch available models:', error);
    throw error;
  }
}
