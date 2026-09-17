/**
 * AI 流式请求服务 (Streaming LLM Service)
 * 支持御三家原生适配器 (OpenAI Responses / Anthropic Messages / Google Gemini Interactions / Ollama)
 */
import { llmGateway } from './ai/LlmGateway';
import { LlmRequest, LlmResponse, StreamCallbacks, Turn, Block, UnifiedTool } from './ai/types';

export * from './ai/types';
export { llmGateway } from './ai/LlmGateway';

/**
 * 经典字符串流式入口（向下兼容）
 */
export async function streamLLM(
  endpoint: string,
  apiKey: string,
  provider: string,
  model: string,
  prompt: string,
  context: string,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (error: Error) => void,
  options?: {
    thinkingEffort?: any;
    thinkingLevel?: any;
    maxOutputTokens?: number;
  }
) {
  try {
    const request: LlmRequest = {
      endpoint,
      apiKey,
      model,
      prompt,
      context,
      store: false, // 确保 BYOK 隐私优先
      thinkingEffort: options?.thinkingEffort || 'medium',
      thinkingLevel: options?.thinkingLevel,
      maxOutputTokens: options?.maxOutputTokens
    };

    let hasThoughtStarted = false;
    let hasThoughtEnded = false;

    const callbacks: StreamCallbacks = {
      onChunk: (chunk: string) => {
        if (hasThoughtStarted && !hasThoughtEnded) {
          hasThoughtEnded = true;
          onChunk('\n</think>\n\n');
        }
        onChunk(chunk);
      },
      onThoughtChunk: (thoughtChunk: string) => {
        if (!hasThoughtStarted) {
          hasThoughtStarted = true;
          onChunk('<think>\n');
        }
        onChunk(thoughtChunk);
      },
      onDone: () => {
        if (hasThoughtStarted && !hasThoughtEnded) {
          hasThoughtEnded = true;
          onChunk('\n</think>\n\n');
        }
        onDone();
      },
      onError
    };

    await llmGateway.streamTurn(provider, request, callbacks);
  } catch (err: any) {
    onError(err);
  }
}

/**
 * 原生 Block/Turn 流式调用接口
 */
export async function streamTurnLLM(
  provider: string,
  request: LlmRequest,
  callbacks: StreamCallbacks
): Promise<LlmResponse> {
  return llmGateway.streamTurn(provider, request, callbacks);
}

/**
 * 获取可用模型列表
 */
export async function fetchAvailableModels(
  endpoint: string,
  apiKey: string,
  provider: string
): Promise<string[]> {
  return llmGateway.fetchModels(provider, apiKey, endpoint);
}
