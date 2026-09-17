import { getRustCorePath } from '../utils/rustCorePath';
import { randomBytes } from 'node:crypto';

let sentinelCore: any = null;
let loadError: string | null = null;

function sanitizeFallback(text: string): string {
  let output = text;
  output = output.replace(
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    '[REDACTED_PRIVATE_KEY]'
  );
  output = output.replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]');
  output = output.replace(/\bey[A-Za-z0-9_-]+\.ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]');
  output = output.replace(
    /\b(Bearer\s+)[A-Za-z0-9._~+\/-]+={0,2}/gi,
    '$1[REDACTED_BEARER_TOKEN]'
  );
  output = output.replace(
    /((?:\b[A-Za-z0-9]+[_-])*(?:password|passwd|pwd|pass|secret|token|api[_-]?key|access[_-]?key|auth[_-]?key)\b\s*[:=]\s*)(["']?)([A-Za-z0-9_!@#$%^&*().,\-+/=~:;?]{4,})(["']?)/gi,
    (_match, prefix: string, quote: string, _secret: string, closingQuote: string) =>
      `${prefix}${quote}[REDACTED_SECRET]${closingQuote === quote ? closingQuote : ''}`
  );
  output = output.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (candidate) => {
    if (candidate === '127.0.0.1' || candidate === '0.0.0.0') return candidate;
    const octets = candidate.split('.').map(Number);
    return octets.every(value => value >= 0 && value <= 255)
      ? '[REDACTED_IP]'
      : candidate;
  });
  return output;
}

try {
  sentinelCore = require(getRustCorePath('getssh-sentinel'));
  console.log('[SentinelGateway] Successfully loaded Rust getssh-sentinel native module');
} catch (e: any) {
  loadError = e?.message || String(e);
  console.error(
    '[SentinelGateway] ⚠️ 原生脱敏模块加载失败，发往模型的内容将使用不可逆 JS 脱敏兜底：',
    loadError
  );
}

export interface SanitizeResult {
  cleanText: string;
  mappingDict: Record<string, string>;
}

/**
 * 一次会话内的脱敏上下文。
 *
 * Rust 侧 sanitize() 的计数器每次调用都从 1 重新开始（lib.rs 的 ip_count 等），
 * 而一轮 streamTurn 要对 prompt / context / systemPrompt / 每一条 history block
 * 分别调用它。直接把各次的 mappingDict 合并，prompt 里的 [IP_1] 和某条
 * tool_result 里的 [IP_1] 就指向两个不同的 IP，后合并的覆盖先合并的 ——
 * 回填时全都还原成同一个地址。Agent 多轮循环里每条终端输出都可能含 IP，
 * 这个冲突几乎必然发生。
 *
 * 所以这里在 TS 侧重新编号：整个会话共用一套计数器，并按「原值」去重 ——
 * 同一个 IP 无论在哪一段出现，都拿到同一个占位符。这既消除了冲突，
 * 也让模型能看出跨段落引用的是同一台机器。
 *
 * 顺带收窄了回填面：dict 里只有本次会话真正脱敏过的值，
 * 模型凭空编出一个没出现过的占位符时，不会再命中别处的真实数据。
 */
export interface SentinelSession {
  /** 脱敏一段文本，返回改写为全局占位符后的结果 */
  sanitize(text: string): string;
  /** 会话累积的 占位符 -> 原值 映射，回填时用（活引用，随 sanitize 增长） */
  readonly dict: Record<string, string>;
}

const TOKEN_PATTERN = /^\[([A-Z][A-Z_]*)_(\d+)\]$/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 一趟扫描完成批量替换。
 * 必须一趟：逐个 replace 会让 [IP_1]->[IP_2] 和 [IP_2]->[IP_1] 这种
 * 互换重命名把自己覆盖掉。
 */
function replaceTokens(text: string, rename: Record<string, string>): string {
  const keys = Object.keys(rename);
  if (keys.length === 0) return text;
  keys.sort((a, b) => b.length - a.length);
  const re = new RegExp(keys.map(escapeRegExp).join('|'), 'g');
  return text.replace(re, m => rename[m] ?? m);
}

export class SentinelGateway {
  /**
   * 原生模块是否可用。为 false 时 sanitize 使用不可逆 JS 兜底，
   * rehydrate 因没有映射而保持原文。调用方仍应显式告知用户降级状态。
   */
  static isAvailable(): boolean {
    return sentinelCore !== null;
  }

  static getLoadError(): string | null {
    return loadError;
  }

  /**
   * Sanitizes text using the Rust NER engine.
   * Replaces IPs, Secrets, Private Keys, etc. with tokens like [IP_1].
   *
   * 注意：占位符编号只在这一次调用内唯一。跨多段文本时请用 createSession()，
   * 否则编号会冲突。
   */
  static sanitize(text: string): SanitizeResult {
    if (!text) {
      return { cleanText: text, mappingDict: {} };
    }
    if (!sentinelCore) {
      return { cleanText: sanitizeFallback(text), mappingDict: {} };
    }

    try {
      const result = sentinelCore.sanitize(text);
      return {
        cleanText: result.cleanText,
        mappingDict: result.mappingDict,
      };
    } catch (err) {
      console.error('[SentinelGateway] Sanitize failed:', err);
      throw new Error(`Sentinel sanitization failed; refusing to send unsanitized data: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * 开一个跨多段文本、占位符编号全局唯一且按原值去重的脱敏会话。
   */
  static createSession(): SentinelSession {
    const dict: Record<string, string> = {};
    const tokenByValue = new Map<string, string>();
    const counters = new Map<string, number>();
    const sessionNonce = randomBytes(16).toString('hex').toUpperCase();

    return {
      dict,
      sanitize(text: string): string {
        const { cleanText, mappingDict } = SentinelGateway.sanitize(text);
        const localTokens = Object.keys(mappingDict);
        if (localTokens.length === 0) return cleanText;

        const rename: Record<string, string> = {};

        for (const localToken of localTokens) {
          const value = mappingDict[localToken];
          let globalToken = tokenByValue.get(value);

          if (!globalToken) {
            const m = TOKEN_PATTERN.exec(localToken);
            const prefix = m ? m[1] : 'REDACTED';
            const next = (counters.get(prefix) ?? 0) + 1;
            counters.set(prefix, next);
            globalToken = `[GETSSH_${sessionNonce}_${prefix}_${next}]`;
            tokenByValue.set(value, globalToken);
            dict[globalToken] = value;
          }

          if (globalToken !== localToken) rename[localToken] = globalToken;
        }

        return replaceTokens(cleanText, rename);
      }
    };
  }

  /**
   * Fast one-shot rehydration of the full text using the mapping dictionary.
   */
  static rehydrate(text: string, mappingDict: Record<string, string>): string {
    if (!sentinelCore || !text || Object.keys(mappingDict).length === 0) {
      return text;
    }

    try {
      return sentinelCore.rehydrate(text, mappingDict);
    } catch (err) {
      console.error('[SentinelGateway] Rehydrate failed:', err);
      return text;
    }
  }

  /**
   * 深度回填：字符串就地还原，数组与对象递归下去。
   * 工具调用参数是结构化的（{ command: "ssh root@[IP_1]" }），
   * 只还原顶层字符串不够。
   */
  static rehydrateDeep<T>(value: T, mappingDict: Record<string, string>): T {
    if (typeof value === 'string') {
      return SentinelGateway.rehydrate(value, mappingDict) as unknown as T;
    }
    if (Array.isArray(value)) {
      return value.map(v => SentinelGateway.rehydrateDeep(v, mappingDict)) as unknown as T;
    }
    if (value && typeof value === 'object') {
      // Preserve "__proto__" as an ordinary data key. Using {} here would
      // invoke the legacy prototype setter and could synthesize inherited tool
      // arguments after an untrusted model response is parsed.
      const out: Record<string, any> = Object.create(null);
      for (const k of Object.keys(value as Record<string, any>)) {
        out[k] = SentinelGateway.rehydrateDeep((value as Record<string, any>)[k], mappingDict);
      }
      return out as unknown as T;
    }
    return value;
  }

  /**
   * Creates a streaming rehydrator that buffers incomplete tokens across chunks.
   */
  static createStreamRehydrator(mappingDict: Record<string, string>) {
    let buffer = '';

    return {
      processChunk: (chunk: string): string => {
        if (Object.keys(mappingDict).length === 0) {
          return chunk;
        }

        buffer += chunk;

        // If the buffer contains '[' but no ']', it MIGHT be a partial token.
        // We find the last '['. If there is no ']' after it, we split the buffer.
        const lastOpenBracket = buffer.lastIndexOf('[');
        if (lastOpenBracket !== -1) {
          const closingBracketAfterOpen = buffer.indexOf(']', lastOpenBracket);
          if (closingBracketAfterOpen === -1) {
            // A potential token is cut off at the end of this buffer.
            // Check if what follows '[' looks like a valid token prefix.
            // e.g. '[IP_', '[SECRET_', '[AWS_KEY_', '[PRIVATE_KEY_'
            const potentialToken = buffer.slice(lastOpenBracket);
            if (/^\[[A-Z_0-9]*$/.test(potentialToken)) {
              // It looks like a partial token. We emit everything BEFORE the '[',
              // and keep the '[' and everything after it in the buffer.
              const readyToEmit = buffer.slice(0, lastOpenBracket);
              buffer = potentialToken;

              // Rehydrate the ready-to-emit part
              return SentinelGateway.rehydrate(readyToEmit, mappingDict);
            }
          }
        }

        // If no partial token at the end, rehydrate everything and clear buffer
        const rehydrated = SentinelGateway.rehydrate(buffer, mappingDict);
        buffer = '';
        return rehydrated;
      },
      flush: (): string => {
        if (!buffer) return '';
        const rehydrated = SentinelGateway.rehydrate(buffer, mappingDict);
        buffer = '';
        return rehydrated;
      }
    };
  }
}
