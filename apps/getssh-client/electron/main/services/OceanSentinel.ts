import { getRustCorePath } from '../utils/rustCorePath';
import { randomBytes } from 'node:crypto';
import { DatabaseManager } from './DatabaseManager';

let sentinelCore: any = null;
let loadError: string | null = null;

function sanitizeFallback(text: string): { cleanText: string; hits: number } {
  let hits = 0;
  const replacement = (token: string) => () => { hits++; return token; };
  let output = text;
  output = output.replace(
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    replacement('[REDACTED_PRIVATE_KEY]')
  );
  output = output.replace(/\bAKIA[0-9A-Z]{16}\b/g, replacement('[REDACTED_AWS_KEY]'));
  output = output.replace(/\bey[A-Za-z0-9_-]+\.ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, replacement('[REDACTED_JWT]'));
  output = output.replace(
    /\b(Bearer\s+)[A-Za-z0-9._~+\/-]+={0,2}/gi,
    (_match, prefix: string) => { hits++; return `${prefix}[REDACTED_BEARER_TOKEN]`; }
  );
  output = output.replace(
    /((?:\b[A-Za-z0-9]+[_-])*(?:password|passwd|pwd|pass|secret|token|api[_-]?key|access[_-]?key|auth[_-]?key)\b\s*[:=]\s*)(["']?)([A-Za-z0-9_!@#$%^&*().,\-+/=~:;?]{4,})(["']?)/gi,
    (_match, prefix: string, quote: string, _secret: string, closingQuote: string) => {
      hits++;
      return `${prefix}${quote}[REDACTED_SECRET]${closingQuote === quote ? closingQuote : ''}`;
    }
  );
  output = output.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (candidate) => {
    if (candidate === '127.0.0.1' || candidate === '0.0.0.0') return candidate;
    const octets = candidate.split('.').map(Number);
    if (!octets.every(value => value >= 0 && value <= 255)) return candidate;
    hits++;
    return '[REDACTED_IP]';
  });
  return { cleanText: output, hits };
}

export interface SentinelRuntimeStatus {
  gateway: {
    mode: 'native' | 'fallback';
    state: 'ready' | 'faulted';
    lastSanitizedAt: number | null;
    lastFailureAt: number | null;
  };
  stats: {
    runtimeHits: number;
    todayHits: number | null;
    totalHits: number | null;
    persistence: 'available' | 'unavailable';
    startedAt: number;
    day: string;
    lastFilteredAt: number | null;
    recordedSince: number | null;
  };
}

// Only numeric aggregates enter the existing encrypted settings table. Never retain input,
// placeholders, mappings, or distinct values here. Counts cover final-egress sanitize passes.
const METRICS_KEY = 'ocean-sentinel-filter-stats-v1';
const startedAt = Date.now();
let runtimeHits = 0;
let pendingHits = 0;
let pendingTodayHits = 0;
let pendingDay = localDay();
let lastSanitizedAt: number | null = null;
let lastFailureAt: number | null = null;
let lastFilteredAt: number | null = null;
let gatewayFaulted = false;
let storageAvailable = false;
let lastWriteFailed = false;
type StoredStats = { version: 1; totalHits: number; todayHits: number; day: string; recordedSince: number | null };
let storedStats: StoredStats | null = null;

function localDay(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function currentDay(): string {
  const day = localDay();
  if (day !== pendingDay) { pendingDay = day; pendingTodayHits = 0; }
  return day;
}

function addHits(total: number, hits: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, total + hits);
}

function loadStats(): boolean {
  storageAvailable = false;
  try {
    // get/setGlobalSetting silently return when the app DB is locked; check it explicitly.
    if (!DatabaseManager.isMainDbOpen()) return false;
    if (!storedStats) {
      const raw = DatabaseManager.getGlobalSetting(METRICS_KEY);
      if (raw === null) {
        storedStats = { version: 1, totalHits: 0, todayHits: 0, day: currentDay(), recordedSince: null };
      } else {
        const value = JSON.parse(raw);
        const count = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
        if (value?.version !== 1 || !count(value.totalHits) || !count(value.todayHits)
          || value.todayHits > value.totalHits || typeof value.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.day)
          || !(value.recordedSince === null || count(value.recordedSince))) return false;
        storedStats = { version: 1, totalHits: value.totalHits, todayHits: value.todayHits, day: value.day, recordedSince: value.recordedSince };
      }
    }
    storageAvailable = !lastWriteFailed && pendingHits === 0;
    return true;
  } catch { return false; }
}

function recordHits(hits: number): void {
  currentDay();
  runtimeHits = addHits(runtimeHits, hits);
  pendingHits = addHits(pendingHits, hits);
  pendingTodayHits = addHits(pendingTodayHits, hits);
  lastSanitizedAt = Date.now();
  if (hits > 0) lastFilteredAt = lastSanitizedAt;
  flushStats();
}

function flushStats(): void {
  currentDay();
  if (pendingHits === 0 && !lastWriteFailed) return;
  if (!loadStats() || !storedStats) return;
  const next: StoredStats = {
    version: 1,
    totalHits: addHits(storedStats.totalHits, pendingHits),
    todayHits: addHits(storedStats.day === pendingDay ? storedStats.todayHits : 0, pendingTodayHits),
    day: pendingDay,
    recordedSince: storedStats.recordedSince ?? startedAt,
  };
  try {
    DatabaseManager.setGlobalSetting(METRICS_KEY, JSON.stringify(next));
    storedStats = next;
    pendingHits = 0;
    pendingTodayHits = 0;
    lastWriteFailed = false;
    storageAvailable = true;
  } catch { lastWriteFailed = true; storageAvailable = false; }
}

try {
  sentinelCore = require(getRustCorePath('ocean-sentinel'));
  console.log('[OceanSentinel] Successfully loaded Rust ocean-sentinel native module');
} catch (e: any) {
  loadError = e?.message || String(e);
  console.error(
    '[OceanSentinel] ⚠️ 原生脱敏模块加载失败，发往模型的内容将使用不可逆 JS 脱敏兜底：',
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
export interface OceanSession {
  /** 脱敏一段文本，返回改写为全局占位符后的结果 */
  sanitize(text: string): string;
  /** 会话累积的 占位符 -> 原值 映射，回填时用（活引用，随 sanitize 增长） */
  readonly dict: Record<string, string>;
}

const TOKEN_PATTERN = /^\[([A-Z][A-Z_]*)_(\d+)\]$/;
const LITERAL_TOKEN_PATTERN = /\[[A-Z][A-Z_]*_\d+\]/g;

/**
 * Mirrors survives_reparsing() in rust-core/ocean-sentinel: the value stays one inert word however
 * many times a shell (or a tool's own escape syntax) parses it.
 */
function survivesReparsing(value: string): boolean {
  return value.length > 0 && !/^[!#-]/.test(value) && !/[\s\u0000-\u001f\u007f-\u009f;&|<>()`'"\\{}]/.test(value);
}

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

export class OceanSentinel {
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

  static getRuntimeStatus(): SentinelRuntimeStatus {
    const day = currentDay();
    loadStats();
    return {
      gateway: {
        mode: sentinelCore ? 'native' : 'fallback',
        state: gatewayFaulted ? 'faulted' : 'ready',
        lastSanitizedAt,
        lastFailureAt,
      },
      stats: {
        runtimeHits,
        todayHits: storedStats ? addHits(storedStats.day === day ? storedStats.todayHits : 0, pendingTodayHits) : null,
        totalHits: storedStats ? addHits(storedStats.totalHits, pendingHits) : null,
        persistence: storageAvailable ? 'available' : 'unavailable',
        startedAt,
        day,
        lastFilteredAt,
        recordedSince: storedStats?.recordedSince ?? null,
      },
    };
  }

  /** Best effort on graceful shutdown; never changes scan timestamps or triggers authentication. */
  static flushMetrics(): void {
    try { flushStats(); }
    catch { storageAvailable = false; lastWriteFailed = true; }
  }

  /**
   * Sanitizes text using the Rust NER engine.
   * Replaces IPs, Secrets, Private Keys, etc. with tokens like [IP_1].
   *
   * 注意：占位符编号只在这一次调用内唯一。跨多段文本时请用 createSession()，
   * 否则编号会冲突。
   */
  static sanitize(text: string, recordMetrics = false): SanitizeResult {
    if (!text) {
      return { cleanText: text, mappingDict: {} };
    }
    try {
      const fallback = !sentinelCore ? sanitizeFallback(text) : null;
      const result = fallback ? { cleanText: fallback.cleanText, mappingDict: {} } : sentinelCore.sanitize(text);
      gatewayFaulted = false;
      if (recordMetrics) {
        // Statistics must never turn a successfully sanitized segment into a gateway failure.
        try { recordHits(fallback ? fallback.hits : Object.keys(result.mappingDict).length); }
        catch { storageAvailable = false; lastWriteFailed = true; }
      }
      return {
        cleanText: result.cleanText,
        mappingDict: result.mappingDict,
      };
    } catch (err) {
      gatewayFaulted = true;
      lastFailureAt = Date.now();
      console.error('[OceanSentinel] Sanitize failed:', err);
      throw new Error(`Sentinel sanitization failed; refusing to send unsanitized data: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * 开一个跨多段文本、占位符编号全局唯一且按原值去重的脱敏会话。
   */
  static createSession(options?: { recordMetrics?: boolean }): OceanSession {
    const dict: Record<string, string> = {};
    const tokenByValue = new Map<string, string>();
    const counters = new Map<string, number>();
    const sessionNonce = randomBytes(16).toString('hex').toUpperCase();

    return {
      dict,
      sanitize(text: string): string {
        // A bracketed token already in the input ("[SECRET_1]" printed by a remote host) looks exactly
        // like one sanitize() inserts, and the renaming below would turn it into this session's token
        // for a real secret: a model repeating it would then get that secret filled in. Such literals
        // are hidden from both steps and put back unchanged.
        const shieldTag = randomBytes(6).toString('hex');
        const literals: string[] = [];
        const shielded = text.replace(LITERAL_TOKEN_PATTERN, literal => {
          literals.push(literal);
          return `\uE000${shieldTag}:${literals.length - 1}\uE001`;
        });
        const unshield = (value: string) => literals.length === 0
          ? value
          : value.replace(new RegExp(`\uE000${shieldTag}:(\\d+)\uE001`, 'g'), (_match, index) => literals[Number(index)]);

        const { cleanText, mappingDict } = OceanSentinel.sanitize(shielded, options?.recordMetrics === true);
        const localTokens = Object.keys(mappingDict);
        if (localTokens.length === 0) return unshield(cleanText);

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

        return unshield(replaceTokens(cleanText, rename));
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
      console.error('[OceanSentinel] Rehydrate failed:', err);
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
      return OceanSentinel.rehydrate(value, mappingDict) as unknown as T;
    }
    if (Array.isArray(value)) {
      return value.map(v => OceanSentinel.rehydrateDeep(v, mappingDict)) as unknown as T;
    }
    if (value && typeof value === 'object') {
      // Preserve "__proto__" as an ordinary data key. Using {} here would
      // invoke the legacy prototype setter and could synthesize inherited tool
      // arguments after an untrusted model response is parsed.
      const out: Record<string, any> = Object.create(null);
      for (const k of Object.keys(value as Record<string, any>)) {
        out[k] = OceanSentinel.rehydrateDeep((value as Record<string, any>)[k], mappingDict);
      }
      return out as unknown as T;
    }
    return value;
  }

  /**
   * Creates a streaming rehydrator that buffers incomplete tokens across chunks.
   *
   * Chunks are rehydrated one at a time, so the native guard never sees the whole command: `eval `
   * can arrive in one chunk and `"[token]"` in the next. While streaming, only values that survive
   * re-parsing are restored; the others stay placeholders in the chat text. Tool-call arguments are
   * rehydrated in one piece (LlmGateway.rehydrateBlock) and keep the full guard.
   */
  static createStreamRehydrator(liveMappingDict: Record<string, string>) {
    let buffer = '';
    // The session dict is live, so the safe subset is taken at each use.
    const streamSafe = (): Record<string, string> => Object.fromEntries(
      Object.entries(liveMappingDict).filter(([, value]) => survivesReparsing(value)),
    );
    const rehydrateSafe = (text: string) => OceanSentinel.rehydrate(text, streamSafe());

    return {
      processChunk: (chunk: string): string => {
        if (Object.keys(liveMappingDict).length === 0) {
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
              return rehydrateSafe(readyToEmit);
            }
          }
        }

        // If no partial token at the end, rehydrate everything and clear buffer
        const rehydrated = rehydrateSafe(buffer);
        buffer = '';
        return rehydrated;
      },
      flush: (): string => {
        if (!buffer) return '';
        const rehydrated = rehydrateSafe(buffer);
        buffer = '';
        return rehydrated;
      }
    };
  }
}
