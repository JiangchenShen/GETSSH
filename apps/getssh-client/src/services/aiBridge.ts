export interface AiRequest {
  requestId: string;
  prompt: string;
  context?: string;
  endpoint?: string;
  apiKey?: string;
  provider?: string;
  model?: string;
}

export interface StreamPayload {
  chunk: string;
  isDone: boolean;
  error?: string;
}


export interface AiResponse {
  success: boolean;
  data?: any;
  _audit?: {
    sanitizedPrompt: string;
    sanitizedContext: string;
  };
}

/**
 * AI Bridge SDK
 * The pure data pipeline connecting the React Frontend with the Main Process Sentinel Gateway.
 * Strictly decoupled from any UI components.
 */
export class AiBridge {
  /**
   * Invokes the privileged AI gateway.
   * This method will securely sanitize and proxy the request to the cloud LLM via the backend,
   * while streaming back the response via the onChunk callback.
   */
  static async invokePrivileged(
    request: AiRequest,
    onChunk?: (payload: StreamPayload) => void
  ): Promise<AiResponse> {
    try {
      if (!window.electronAPI || !window.electronAPI.ai) {
        throw new Error('Security Error: AI Bridge is not available in the current context.');
      }

      let unsubscribe: (() => void) | undefined;
      
      // Setup the stream listener before making the invoke call
      if (onChunk) {
        unsubscribe = window.electronAPI.ai.onStreamChunk(request.requestId, (payload) => {
          onChunk(payload);
          // Automatically clean up listener when stream finishes
          if (payload.isDone && unsubscribe) {
            unsubscribe();
          }
        });
      }

      // Sends the request to the Main Process Gateway for sanitization and origin verification
      const response = await window.electronAPI.ai.invokePrivileged(request);
      
      if (!response.success) {
        if (unsubscribe) unsubscribe();
        throw new Error('AI Gateway invocation failed or blocked.');
      }

      return response;
    } catch (error) {
      console.error('[AiBridge] 🔴 AI Pipeline invocation failed. Sentinel Gateway may have blocked the request:', error);
      throw error;
    }
  }

  /**
   * Fetches the live list of models directly from the provider's REST API.
   * Bypasses the backend entirely for maximum freshness and reliability.
   */
  static async getModels(request: Omit<AiRequest, 'requestId' | 'prompt'>): Promise<string[]> {
    const { provider, apiKey, endpoint } = request;

    try {
      // ─── Ollama ──────────────────────────────────────────────────────────
      if (provider === 'ollama') {
        const base = endpoint?.replace(/\/$/, '') || 'http://127.0.0.1:11434';
        const res = await fetch(`${base}/api/tags`);
        if (!res.ok) throw new Error(`Ollama responded with ${res.status}`);
        const data = await res.json();
        return (data.models as Array<{ name: string }> || []).map(m => m.name);
      }

      // ─── Google Gemini ───────────────────────────────────────────────────
      if (provider === 'gemini') {
        if (!apiKey) throw new Error('Gemini requires an API key.');
        // Use Authorization header — more robust than ?key= for all API key formats
        const res = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models',
          { headers: { 'x-goog-api-key': apiKey.trim() } }
        );
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Gemini API ${res.status}: ${body}`);
        }
        const data = await res.json();
        return (data.models as Array<{ name: string; supportedGenerationMethods?: string[] }> || [])
          .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
          .map(m => m.name.replace('models/', ''))
          .sort();
      }

      // ─── OpenAI (and OpenAI-compatible custom) ───────────────────────────
      {
        const base =
          provider === 'openai'
            ? 'https://api.openai.com'
            : (endpoint?.replace(/\/$/, '') || 'https://api.openai.com');

        const headers: HeadersInit = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        const res = await fetch(`${base}/v1/models`, { headers });
        if (!res.ok) throw new Error(`API responded with ${res.status}: ${await res.text()}`);
        const data = await res.json();
        const models: string[] = (data.data as Array<{ id: string; owned_by?: string }> || [])
          .map(m => m.id)
          .filter(id =>
            // Keep only language models – filter out embedding/tts/image models
            !id.includes('embedding') &&
            !id.includes('dall-e') &&
            !id.includes('tts') &&
            !id.includes('whisper') &&
            !id.includes('babbage') &&
            !id.includes('davinci') &&
            !id.includes('ada')
          )
          .sort();
        return models;
      }
    } catch (error: any) {
      console.error('[AiBridge] 🔴 Failed to fetch models from provider API:', error);
      throw new Error(`Failed to fetch models: ${error.message}`);
    }
  }

  /**
   * Commands the backend to securely zero-out all memory associated with a workspace.
   */
  static async clearHistory(workspaceId: string): Promise<void> {
    try {
      if (!window.electronAPI || !window.electronAPI.ai) {
        throw new Error('Security Error: AI Bridge is not available in the current context.');
      }

      const response = await window.electronAPI.ai.clearHistory(workspaceId);
      
      if (!response.success) {
        throw new Error('Failed to zero-out workspace memory.');
      }
      
      console.info(`[AiBridge] 🟡 Memory for workspace ${workspaceId} successfully zeroed out.`);
    } catch (error) {
      console.error('[AiBridge] 🔴 Memory zero-out failed:', error);
      throw error;
    }
  }
}
