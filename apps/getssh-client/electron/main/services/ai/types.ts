/**
 * Unified AI/LLM Data Model (御三家大模型统一适配层数据规范)
 * 覆盖 OpenAI (Responses / Chat Completions) / Anthropic (Messages) / Google Gemini (Interactions)
 */

export type Block =
  | { kind: 'text'; text: string }
  | { kind: 'thought'; text?: string; opaque?: string; providerItemId?: string } // opaque = 签名/加密体 (encrypted_content / signature / thought_signature)
  | { kind: 'tool_call'; callId: string; name: string; args: any; raw: string; providerItemId?: string }
  | { kind: 'tool_result'; callId: string; name?: string; content: (Block | string)[]; isError?: boolean }
  | { kind: 'image'; mime: string; data: string }
  | { kind: 'server_tool'; toolType: string; payload: any; opaque?: string };

export class LlmError extends Error {
  public retryable: boolean;
  public provider: string;
  public code?: string;
  public retryAfterMs?: number;
  public status?: number;

  constructor(message: string, options: {
    retryable: boolean;
    provider: string;
    code?: string;
    retryAfterMs?: number;
    status?: number;
  }) {
    super(message);
    this.name = 'LlmError';
    this.retryable = options.retryable;
    this.provider = options.provider;
    this.code = options.code;
    this.retryAfterMs = options.retryAfterMs;
    this.status = options.status;
  }
}

export interface Turn {
  role: 'user' | 'assistant' | 'system';
  blocks: Block[];
}

export interface UnifiedTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
    additionalProperties?: boolean;
    [key: string]: any;
  };
  strict?: boolean;
}

export type ThinkingEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

export interface LlmRequest {
  endpoint?: string;
  apiKey: string;
  model: string;
  systemPrompt?: string;
  history?: Turn[];
  prompt?: string;
  context?: string;
  sessionId?: string;
  temperature?: number;
  tools?: UnifiedTool[];
  toolChoice?: 'auto' | 'any' | 'none' | 'required' | { type: 'tool'; name: string };
  maxOutputTokens?: number;
  thinkingEffort?: ThinkingEffort;
  thinkingLevel?: ThinkingLevel;
  thinkingBudget?: number;
  store?: boolean; // Default false for privacy
  stream?: boolean;
  signal?: AbortSignal;
}

export interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
}

export type StopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'pause_turn'
  | 'refusal'
  | 'model_context_window_exceeded'
  | 'budget_exceeded'
  | 'error';

export interface LlmResponse {
  blocks: Block[];
  text: string;
  toolCalls: Array<{ callId: string; name: string; args: any; raw: string }>;
  stopReason: StopReason;
  usage?: NormalizedUsage;
  model: string;
  rawResponse?: any;
}

export interface StreamCallbacks {
  onChunk?: (chunk: string) => void;
  onThoughtChunk?: (thoughtChunk: string) => void;
  onBlockAdded?: (block: Block) => void;
  onBlockDone?: (block: Block) => void;
  onDone?: (response: LlmResponse) => void;
  onError?: (error: Error) => void;
}

export interface ILlmAdapter {
  readonly provider: string;
  streamTurn(request: LlmRequest, callbacks: StreamCallbacks): Promise<LlmResponse>;
  fetchModels(apiKey: string, endpoint?: string): Promise<string[]>;
}
