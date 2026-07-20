export interface AiRequest {
  requestId: string;
  prompt: string;
  contextData?: {
    workspaceName: string;
    sessionId?: string;
    sessionName?: string;
    terminalBuffer?: string; // Automatically extracted terminal history
    language?: string;
    personaContent?: string;
    runbooks: Array<{
      name: string;
      description: string;
      dangerLevel: string;
    }>;
  };
  mode?: 'readonly' | 'assistant' | 'agent_semi' | 'agent_full';
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

export class DataMasker {
  private static vault = new Map<string, string>();
  private static counter = 0;

  private static storeSecret(secret: string): string {
    for (const [token, val] of this.vault.entries()) {
      if (val === secret) return token;
    }
    this.counter++;
    const token = `{{GETSSH_SEC_${this.counter}}}`;
    this.vault.set(token, secret);
    return token;
  }

  static tokenize(text: string): string {
    if (!text) return text;
    let masked = text;
    
    // Passwords
    masked = masked.replace(/(password|passwd|pwd)\s*(:|=)\s*(\S+)/gi, (_match, p1, p2, p3) => {
      const token = this.storeSecret(p3);
      return `${p1}${p2}${token}`;
    });
    
    // Bearer Tokens
    masked = masked.replace(/Bearer\s+([A-Za-z0-9\-\._~\+\/]+={0,2})/g, (_match, p1) => {
      const token = this.storeSecret(p1);
      return `Bearer ${token}`;
    });
    
    // Private Keys
    masked = masked.replace(/-----BEGIN (RSA|OPENSSH|DSA|EC|PGP) PRIVATE KEY-----[\s\S]*?-----END \1 PRIVATE KEY-----/g, (match) => {
      return this.storeSecret(match);
    });
    
    // JWTs
    masked = masked.replace(/ey[A-Za-z0-9_-]+\.ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, (match) => {
      return this.storeSecret(match);
    });
    
    return masked;
  }

  static detokenize(text: string): string {
    if (!text) return text;
    let result = text;
    for (const [token, secret] of this.vault.entries()) {
      result = result.split(token).join(secret);
    }
    return result;
  }
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
    onChunk?: (payload: StreamPayload) => void,
    onApprovalRequest?: (command: string, requestId: string) => void
  ): Promise<AiResponse> {
    try {
      if (!window.electronAPI || !window.electronAPI.ai) {
        throw new Error('Security Error: AI Bridge is not available in the current context.');
      }

      // Apply Data Vaulting (Tokenization)
      request.prompt = DataMasker.tokenize(request.prompt);
      if (request.contextData && request.contextData.terminalBuffer) {
        request.contextData.terminalBuffer = DataMasker.tokenize(request.contextData.terminalBuffer);
      }

      let unsubscribeChunk: (() => void) | undefined;
      let unsubscribeApproval: (() => void) | undefined;
      
      // Setup the stream listener before making the invoke call
      if (onChunk) {
        unsubscribeChunk = window.electronAPI.ai.onStreamChunk(request.requestId, (payload) => {
          // Detokenize chunk seamlessly before UI receives it
          payload.chunk = DataMasker.detokenize(payload.chunk);
          onChunk(payload);
          // Automatically clean up listener when stream finishes
          if (payload.isDone) {
            if (unsubscribeChunk) unsubscribeChunk();
            if (unsubscribeApproval) unsubscribeApproval();
          }
        });
      }

      if (onApprovalRequest && window.electronAPI.ai.onAgentApprovalRequest) {
        unsubscribeApproval = window.electronAPI.ai.onAgentApprovalRequest((payload: { requestId: string, command: string }) => {
          if (payload.requestId === request.requestId) {
             // Detokenize command seamlessly before execution and UI approval
             payload.command = DataMasker.detokenize(payload.command);
             onApprovalRequest(payload.command, payload.requestId);
          }
        });
      }

      // Sends the request to the Main Process Gateway for sanitization and origin verification
      const response = await window.electronAPI.ai.invokePrivileged(request);
      
      if (!response.success) {
        if (unsubscribeChunk) unsubscribeChunk();
        if (unsubscribeApproval) unsubscribeApproval();
        throw new Error('AI Gateway invocation failed or blocked.');
      }

      return response;
    } catch (error) {
      console.error('[AiBridge] 🔴 AI Pipeline invocation failed. Sentinel Gateway may have blocked the request:', error);
      throw error;
    }
  }

  /**
   * Fetches the live list of models securely via the Main Process Gateway.
   * This ensures the API key is retrieved from the secure Vault on disk.
   */
  static async getModels(request: Omit<AiRequest, 'requestId' | 'prompt'>): Promise<string[]> {
    const { provider, endpoint } = request;

    try {
      if (!window.electronAPI || !window.electronAPI.ai) {
        throw new Error('Security Error: AI Bridge is not available in the current context.');
      }
      
      const response = await window.electronAPI.ai.getModels({ endpoint, provider });
      if (!response.success) {
        throw new Error(response.error || 'Failed to fetch models from AI Gateway.');
      }
      
      // The backend returns a raw list of models (except for gemini which might need some mapping, 
      // but llmService.fetchAvailableModels already maps it properly)
      let models = response.models || [];
      if (provider === 'gemini') {
        models = models.sort();
      }
      return models;
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

  // ── SQLite Persistence ──────────────────────────────────────────────────
  static async getSessions(): Promise<any[]> {
    if (!window.electronAPI || !window.electronAPI.ai) return [];
    const res = await window.electronAPI.ai.getSessions();
    return res.success ? res.sessions : [];
  }

  static async createSession(id: string, title: string, timestamp: number): Promise<boolean> {
    if (!window.electronAPI || !window.electronAPI.ai) return false;
    const res = await window.electronAPI.ai.createSession(id, title, timestamp);
    return res.success;
  }

  static async saveMessage(msg: any): Promise<boolean> {
    if (!window.electronAPI || !window.electronAPI.ai) return false;
    const res = await window.electronAPI.ai.saveMessage(msg);
    return res.success;
  }

  static async deleteSession(id: string): Promise<boolean> {
    if (!window.electronAPI || !window.electronAPI.ai) return false;
    const res = await window.electronAPI.ai.deleteSession(id);
    return res.success;
  }

  static async updateSessionTitle(id: string, title: string): Promise<boolean> {
    if (!window.electronAPI || !window.electronAPI.ai) return false;
    const res = await window.electronAPI.ai.updateSessionTitle(id, title);
    return res.success;
  }
}
