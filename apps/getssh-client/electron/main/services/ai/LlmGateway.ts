import { ILlmAdapter, LlmRequest, LlmResponse, StreamCallbacks, Turn, Block, LlmError } from './types';
import { OpenAiAdapter } from './OpenAiAdapter';
import { AnthropicAdapter } from './AnthropicAdapter';
import { GeminiAdapter } from './GeminiAdapter';
import { OllamaAdapter } from './OllamaAdapter';
import { DeepSeekAdapter } from './DeepSeekAdapter';
import { ZhipuAdapter } from './ZhipuAdapter';
import { KimiAdapter } from './KimiAdapter';
import { MiniMaxAdapter } from './MiniMaxAdapter';
import { QwenAdapter } from './QwenAdapter';
import { SentinelGateway } from '../SentinelGateway';
import { ModelCaps } from './ModelCapabilities';
import type { SentinelSession } from '../SentinelGateway';

/**
 * 深度脱敏：工具调用参数是结构化的（{ command: "ssh root@1.2.3.4" }），
 * 只处理顶层字符串会把真实地址漏在嵌套字段里。
 * 与 SentinelGateway.rehydrateDeep 对称。
 */
function sanitizeDeep<T>(value: T, sentinel: SentinelSession): T {
  if (typeof value === 'string') {
    return sentinel.sanitize(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map(v => sanitizeDeep(v, sentinel)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    // Model/tool JSON can legally contain a "__proto__" key. A null-prototype
    // destination keeps it as data instead of invoking Object.prototype's
    // legacy setter and creating inherited tool arguments.
    const out: Record<string, any> = Object.create(null);
    for (const k of Object.keys(value as Record<string, any>)) {
      out[k] = sanitizeDeep((value as Record<string, any>)[k], sentinel);
    }
    return out as unknown as T;
  }
  return value;
}

export class LlmGateway {
  private static instance: LlmGateway;
  private adapters: Map<string, ILlmAdapter> = new Map();

  private constructor() {
    this.registerAdapter(new OpenAiAdapter());
    this.registerAdapter(new AnthropicAdapter());
    this.registerAdapter(new GeminiAdapter());
    this.registerAdapter(new OllamaAdapter());
    this.registerAdapter(new DeepSeekAdapter());
    this.registerAdapter(new ZhipuAdapter());
    this.registerAdapter(new KimiAdapter());
    this.registerAdapter(new MiniMaxAdapter());
    this.registerAdapter(new QwenAdapter());
  }

  public static getInstance(): LlmGateway {
    if (!LlmGateway.instance) {
      LlmGateway.instance = new LlmGateway();
    }
    return LlmGateway.instance;
  }

  public registerAdapter(adapter: ILlmAdapter) {
    this.adapters.set(adapter.provider.toLowerCase(), adapter);
  }

  public getAdapter(provider: string): ILlmAdapter {
    const key = (provider || 'openai').toLowerCase();
    if (key === 'anthropic' || key === 'claude') {
      return this.adapters.get('anthropic') || this.adapters.get('claude')!;
    }
    if (key === 'gemini' || key === 'google') {
      return this.adapters.get('gemini') || this.adapters.get('google')!;
    }
    if (key === 'ollama') {
      return this.adapters.get('ollama')!;
    }
    if (key === 'deepseek') {
      return this.adapters.get('deepseek')!;
    }
    if (key === 'zhipu') {
      return this.adapters.get('zhipu')!;
    }
    if (key === 'kimi' || key === 'moonshot') {
      return this.adapters.get('kimi')!;
    }
    if (key === 'minimax') {
      return this.adapters.get('minimax')!;
    }
    // 千问既可能被叫 qwen / tongyi，也可能被叫 dashscope / bailian（百炼）
    if (key === 'qwen' || key === 'tongyi' || key === 'dashscope' || key === 'bailian') {
      return this.adapters.get('qwen')!;
    }
    if (this.adapters.has(key)) {
      return this.adapters.get(key)!;
    }
    return this.adapters.get('openai')!;
  }

  /**
   * Main entrypoint for streaming LLM turns with Sentinel Privacy & Exponential Backoff
   */
  public async streamTurn(
    provider: string,
    request: LlmRequest,
    callbacks: StreamCallbacks
  ): Promise<LlmResponse> {
    const adapter = this.getAdapter(provider);

    // 1. [Sentinel] Privacy Sanitization (P1 #23)
    //
    // 用一个会话贯穿本轮所有分段：Rust 侧每次 sanitize() 的计数器都从 1 重来，
    // 逐段合并 mappingDict 会让不同段落的 [IP_1] 互相覆盖。会话内统一编号并按
    // 原值去重，同一个 IP 在哪一段出现都是同一个占位符。
    const sentinel = SentinelGateway.createSession();
    if (!SentinelGateway.isAvailable()) {
      console.warn(
        '[LlmGateway] Sentinel 原生模块不可用，本次请求将使用不可逆 JS 脱敏兜底：',
        SentinelGateway.getLoadError()
      );
    }
    const mappingDict = sentinel.dict; // 活引用：后面的分段脱敏会继续往里加

    const sanitizedPrompt = request.prompt ? sentinel.sanitize(request.prompt) : request.prompt;
    const sanitizedContext = request.context ? sentinel.sanitize(request.context) : request.context;
    const sanitizedSystemPrompt = request.systemPrompt ? sentinel.sanitize(request.systemPrompt) : request.systemPrompt;

    // Sanitize history (Text, Tool Results, and Tool Call Args)
    let sanitizedHistory: Turn[] | undefined;
    if (request.history) {
      sanitizedHistory = request.history.map(turn => ({
        role: turn.role,
        blocks: turn.blocks.map(block => {
          if (block.kind === 'text') {
            return { kind: 'text', text: sentinel.sanitize(block.text) };
          }
          if (block.kind === 'tool_result') {
            const sanitizedContent = block.content.map(c => {
              if (typeof c === 'string') {
                return sentinel.sanitize(c);
              } else if (c && typeof c === 'object' && c.kind === 'text') {
                return { ...c, text: sentinel.sanitize(c.text) };
              }
              return c;
            });
            return { ...block, content: sanitizedContent };
          }
          if (block.kind === 'tool_call') {
            // 去程：raw 与结构化 args 都要脱敏，否则历史里会漏出真实地址
            return {
              ...block,
              args: sanitizeDeep(block.args, sentinel),
              raw: block.raw ? sentinel.sanitize(block.raw) : block.raw
            };
          }
          return block;
        })
      }));
    }

    const sanitizedRequest: LlmRequest = {
      ...request,
      prompt: sanitizedPrompt,
      context: sanitizedContext,
      systemPrompt: sanitizedSystemPrompt,
      history: sanitizedHistory
    };

    // 2. Jittered Exponential Backoff Retry Loop (P0 #10)
    //
    // 回调与脱敏回填器必须"每次尝试"重建，不能在循环外共用：
    //   a) rehydrator 是有状态的（跨 chunk 缓冲半个占位符），失败的那次会把
    //      残留缓冲带进下一次尝试，回填出错位的文本；
    //   b) 一旦本次尝试已经往 UI 吐过字，重试就会把同一段内容再吐一遍。
    //      所以 emitted 为真时不再重试，直接把错误抛给调用方——重复输出
    //      比一次明确的失败更难排查。
    const MAX_RETRIES = 3;
    let attempt = 0;

    while (true) {
      attempt++;

      let emitted = false;
      let rehydratedResponse: LlmResponse | null = null;
      const textRehydrator = SentinelGateway.createStreamRehydrator(mappingDict);
      const thoughtRehydrator = SentinelGateway.createStreamRehydrator(mappingDict);

      // 回填必须覆盖 tool_call：模型基于 [IP_1] 推理出的
      // execute_terminal { command: "ssh root@[IP_1]" } 如果不还原，
      // 落到 SSHBridge.writeCommand 的就是字面量 [IP_1]。
      // 去程脱敏了却没有回程，方向不闭合。
      const rehydrateBlock = (block: Block): Block => {
        if (block.kind === 'text') {
          return { kind: 'text', text: SentinelGateway.rehydrate(block.text, mappingDict) };
        }
        if (block.kind === 'thought' && block.text) {
          return { ...block, text: SentinelGateway.rehydrate(block.text, mappingDict) };
        }
        if (block.kind === 'tool_call') {
          return {
            ...block,
            args: SentinelGateway.rehydrateDeep(block.args, mappingDict),
            raw: SentinelGateway.rehydrate(block.raw, mappingDict)
          };
        }
        return block;
      };
      const rehydrate = (response: LlmResponse): LlmResponse => ({
        ...response,
        text: SentinelGateway.rehydrate(response.text, mappingDict),
        blocks: response.blocks.map(rehydrateBlock),
        toolCalls: response.toolCalls.map(tc => ({
          ...tc,
          args: SentinelGateway.rehydrateDeep(tc.args, mappingDict),
          raw: SentinelGateway.rehydrate(tc.raw, mappingDict)
        }))
      });

      const wrappedCallbacks: StreamCallbacks = {
        onChunk: (chunk: string) => {
          const rehydrated = textRehydrator.processChunk(chunk);
          if (rehydrated) {
            emitted = true;
            callbacks.onChunk?.(rehydrated);
          }
        },
        onThoughtChunk: (thoughtChunk: string) => {
          const rehydrated = thoughtRehydrator.processChunk(thoughtChunk);
          if (rehydrated) {
            emitted = true;
            callbacks.onThoughtChunk?.(rehydrated);
          }
        },
        onBlockAdded: (block: Block) => {
          emitted = true;
          callbacks.onBlockAdded?.(rehydrateBlock(block));
        },
        onBlockDone: (block: Block) => callbacks.onBlockDone?.(rehydrateBlock(block)),
        onDone: (response: LlmResponse) => {
          const flushedText = textRehydrator.flush();
          if (flushedText) callbacks.onChunk?.(flushedText);
          const flushedThought = thoughtRehydrator.flush();
          if (flushedThought) callbacks.onThoughtChunk?.(flushedThought);

          rehydratedResponse = rehydrate(response);
          callbacks.onDone?.(rehydratedResponse);
        },
        onError: callbacks.onError
      };

      try {
        const raw = await adapter.streamTurn(sanitizedRequest, wrappedCallbacks);
        // onDone 走过就复用它的结果；适配器没触发 onDone 时兜底回填一次
        return rehydratedResponse ?? rehydrate(raw);
      } catch (err: any) {
        const isLlmError = err instanceof LlmError;
        const isRetryable = isLlmError ? err.retryable : (err.name === 'TypeError' || err.message?.includes('fetch failed'));

        // 400 自愈：厂商发新模型的速度快过我们发版，某个可选字段不被认识时
        // 剥掉它重试一次，并把这个事实按 (渠道, 模型) 记下来，下次就不发了。
        // 只在还没吐字时做，理由同下面的 emitted 闸门。
        if (!emitted && attempt <= MAX_RETRIES && isLlmError) {
          const learnedQuirk = ModelCaps.learnFromError(
            adapter.provider, request.model, err.status, err.message || ''
          );
          if (learnedQuirk) {
            console.warn(`[LlmGateway] 已剥离 ${learnedQuirk} 并重试一次（${adapter.provider}/${request.model}）`);
            continue;
          }
        }

        if (isRetryable && attempt <= MAX_RETRIES && !emitted) {
          const retryAfterMs = isLlmError && err.retryAfterMs ? err.retryAfterMs : undefined;
          const delay = retryAfterMs || Math.min(1000 * Math.pow(2, attempt - 1) + Math.random() * 500, 10000);

          console.warn(`[LlmGateway] Attempt ${attempt} failed with retryable error (${err.message}). Retrying in ${Math.round(delay)}ms...`);
          await new Promise(res => setTimeout(res, delay));
          continue;
        }

        if (isRetryable && emitted) {
          console.warn(`[LlmGateway] Retryable error after partial output was already streamed; not retrying to avoid duplicate text.`);
        }

        callbacks.onError?.(err);
        throw err;
      }
    }
  }

  public async fetchModels(provider: string, apiKey: string, endpoint?: string): Promise<string[]> {
    const adapter = this.getAdapter(provider);
    return adapter.fetchModels(apiKey, endpoint);
  }
}

export const llmGateway = LlmGateway.getInstance();
