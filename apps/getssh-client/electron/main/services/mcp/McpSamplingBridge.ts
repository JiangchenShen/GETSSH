import { getAiApiKey } from '../../security/appSecrets';
import { McpSamplingParams, McpSamplingResult } from './mcpTypes';
import { streamLLM } from '../llmService';
import { SecureCenter } from '../../security/SecureCenter';
import { normalizeMcpSamplingParams } from './McpProtocolPolicy';

export type SamplingInferenceRunner = (params: McpSamplingParams) => Promise<string>;

export interface SamplingAiConfig {
  endpoint: string;
  apiKey: string;
  provider: string;
  model: string;
}

export type AiConfigProvider = () => SamplingAiConfig;

/**
 * McpSamplingBridge — Enables external MCP servers to request reverse LLM inference
 * from GETSSH's active AI provider without needing separate API keys.
 */
export class McpSamplingBridge {
  private static instance: McpSamplingBridge;
  private customRunner: SamplingInferenceRunner | null = null;
  private aiConfigProvider: AiConfigProvider | null = null;

  private constructor() {}

  public static getInstance(): McpSamplingBridge {
    if (!McpSamplingBridge.instance) {
      McpSamplingBridge.instance = new McpSamplingBridge();
    }
    return McpSamplingBridge.instance;
  }

  public setInferenceRunner(runner: SamplingInferenceRunner | null) {
    this.customRunner = runner;
  }

  /**
   * Set the AI config provider for resolving active LLM credentials.
   * This should be called during app initialization.
   */
  public setAiConfigProvider(provider: AiConfigProvider | null) {
    this.aiConfigProvider = provider;
  }

  /**
   * Resolve the active AI configuration from the provider, or fall back to
   * reading from secure storage and default settings.
   */
  private resolveAiConfig(): SamplingAiConfig {
    // 1. Use explicit provider if set
    if (this.aiConfigProvider) {
      return this.aiConfigProvider();
    }

    // 2. Fallback: the stored API key, default provider and model
    const provider = 'gemini';
    const apiKey = getAiApiKey(provider);

    return {
      endpoint: '',
      apiKey,
      provider,
      model: 'gemini-2.5-flash'
    };
  }

  /**
   * Handle an incoming sampling/createMessage request from an MCP server
   */
  public async handleSamplingRequest(serverName: string, params: McpSamplingParams): Promise<McpSamplingResult> {
    const normalizedParams = normalizeMcpSamplingParams(params);
    console.log(`[McpSamplingBridge] Received reverse sampling request from server '${serverName}' (messages=${normalizedParams.messages.length})`);

    // 1. RASP Security Check: Audit prompt for dangerous patterns or credential theft
    const concatenatedContent = normalizedParams.messages
      .map(m => (m.content.type === 'text' ? m.content.text : ''))
      .join('\n');

    try {
      const rasp = SecureCenter.getInstance();
      if (rasp && typeof (rasp as any).checkSecurityRisk === 'function') {
        const risk = (rasp as any).checkSecurityRisk(concatenatedContent);
        if (risk && risk.level === 'critical') {
          throw new Error(`Sampling request blocked by GETSSH RASP Security: ${risk.reason}`);
        }
      }
    } catch (e: any) {
      if (e.message?.includes('blocked by GETSSH RASP')) throw e;
    }

    // 2. If custom runner is installed (e.g. testing or specific workspace routing), use it
    if (this.customRunner) {
      const text = await this.customRunner(normalizedParams);
      return {
        role: 'assistant',
        content: { type: 'text', text },
        model: 'getssh-active-llm',
        stopReason: 'endTurn'
      };
    }

    // 3. Convert MCP Sampling Messages to unified text prompt
    const promptBody = normalizedParams.messages
      .map(m => `${m.role.toUpperCase()}: ${m.content.type === 'text' ? m.content.text : ''}`)
      .join('\n\n');

    // 4. Resolve active AI configuration from secure storage
    const aiConfig = this.resolveAiConfig();

    // 5. Invoke LLM Service (wrapped in Promise for proper error propagation)
    try {
      const responseText = await new Promise<string>((resolve, reject) => {
        let buffer = '';
        streamLLM(
          aiConfig.endpoint,
          aiConfig.apiKey,
          aiConfig.provider,
          aiConfig.model,
          promptBody,
          normalizedParams.systemPrompt || '',
          (chunk) => { buffer += chunk; },
          () => { resolve(buffer); },
          (err) => { reject(err); },
          { maxOutputTokens: normalizedParams.maxTokens }
        );
      });

      return {
        role: 'assistant',
        content: {
          type: 'text',
          text: responseText
        },
        model: `${aiConfig.provider}/${aiConfig.model}`,
        stopReason: 'endTurn'
      };
    } catch (err: any) {
      console.error(`[McpSamplingBridge] Inference error during sampling for '${serverName}':`, err.message);
      throw new Error(`GETSSH LLM Sampling failed: ${err.message}`);
    }
  }
}

export const mcpSamplingBridge = McpSamplingBridge.getInstance();
