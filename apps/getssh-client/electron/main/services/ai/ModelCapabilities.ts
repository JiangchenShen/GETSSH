/**
 * 模型能力表 + 运行时自愈
 *
 * 解决的问题：厂商发新模型的速度远快于我们发版的速度。四个月里 DeepSeek 与 Kimi
 * 整条产品线退役、Anthropic 把思考参数从 budget_tokens 换成 output_config.effort、
 * 千问改了命名规范。靠一张手工维护的精确型号表，必然追不上。
 *
 * 这里的策略是让未知模型「降级但能跑」，而不是「报 400」：
 *
 *   第一层  家族前缀规则     —— 用 claude-haiku-* 而不是 claude-haiku-4-5，
 *                              新小版本发布时仍然命中
 *   第二层  未知模型最小请求 —— 匹配不到家族就把所有可选字段都不发，
 *                              能力打折但不会因为参数不认而失败
 *   第三层  400 自愈         —— 认得几种参数类报错的签名，剥掉冒犯的字段重试一次，
 *                              并把这个事实按 (渠道, 模型) 记下来，下次直接不发
 *   第四层  远端表（可选）    —— 见 setRemoteOverrides，只当加速器，拉不到不影响可用性
 *
 * 注意「渠道 + 模型」才是键，不是「模型」：kimi-k2.6 在阿里百炼部署和 Moonshot
 * 原厂部署下，思考的默认值是相反的。同一个模型名从不同平台接进来能力位不一样。
 */

export type ThinkingParamStyle = 'effort' | 'level' | 'budget' | 'none';
export type TokenLimitField = 'max_tokens' | 'max_completion_tokens' | 'max_output_tokens';

export interface ModelCapabilities {
  /** false 表示没有匹配到任何家族规则，调用方应当走最小请求 */
  known: boolean;
  /** 是否可以下发 temperature / top_p / top_k */
  supportsSampling: boolean;
  /** 是否支持思考 */
  supportsThinking: boolean;
  /** 思考能否显式关闭（Fable/Mythos/M2.x/GLM-5.3 等不能关） */
  thinkingCanBeDisabled: boolean;
  /** 思考强度的参数形状 */
  thinkingParamStyle: ThinkingParamStyle;
  /** 是否支持 tool_choice = required / 指定函数 */
  supportsToolChoiceRequired: boolean;
  /** 输出 token 上限，未知则 undefined */
  maxOutputTokens?: number;
  /** 输出上限的字段名 */
  tokenLimitField: TokenLimitField;
}

/** 运行时学到的「这个字段这个模型不认」 */
export type Quirk =
  | 'no_sampling'
  | 'no_thinking'
  | 'thinking_not_disablable'
  | 'no_effort'
  | 'no_tool_choice_required';

interface FamilyRule {
  /** 匹配 provider（渠道），undefined 表示任意 */
  provider?: string;
  /** 匹配模型名 */
  test: RegExp;
  caps: Partial<ModelCapabilities>;
}

/**
 * 最小请求：匹配不到家族规则时用这套。所有可选字段一律不发。
 * 宁可少一个功能，也不要整条请求 400。
 */
const MINIMAL: ModelCapabilities = {
  known: false,
  supportsSampling: false,
  supportsThinking: false,
  thinkingCanBeDisabled: false,
  thinkingParamStyle: 'none',
  supportsToolChoiceRequired: false,
  maxOutputTokens: undefined,
  tokenLimitField: 'max_tokens'
};

// 规则按数组顺序匹配，先命中的赢 —— 特例写在前面，通配写在后面。
const FAMILY_RULES: FamilyRule[] = [
  // ── Anthropic ────────────────────────────────────────────────
  // Haiku 完全不支持思考：adaptive / enabled / effort 一律 400
  { provider: 'anthropic', test: /haiku/i, caps: {
    known: true, supportsSampling: true, supportsThinking: false,
    thinkingCanBeDisabled: false, thinkingParamStyle: 'none',
    supportsToolChoiceRequired: true, maxOutputTokens: 65536, tokenLimitField: 'max_tokens' } },
  // Fable / Mythos：思考恒开，不可关闭
  { provider: 'anthropic', test: /fable|mythos/i, caps: {
    known: true, supportsSampling: false, supportsThinking: true,
    thinkingCanBeDisabled: false, thinkingParamStyle: 'effort',
    supportsToolChoiceRequired: true, maxOutputTokens: 131072, tokenLimitField: 'max_tokens' } },
  // Opus/Sonnet 5 与 4.7+：采样参数传非默认值一律 400
  { provider: 'anthropic', test: /(opus|sonnet)-(5|4-[789])/i, caps: {
    known: true, supportsSampling: false, supportsThinking: true,
    thinkingCanBeDisabled: true, thinkingParamStyle: 'effort',
    supportsToolChoiceRequired: true, maxOutputTokens: 131072, tokenLimitField: 'max_tokens' } },
  { provider: 'anthropic', test: /^claude-/i, caps: {
    known: true, supportsSampling: true, supportsThinking: true,
    thinkingCanBeDisabled: true, thinkingParamStyle: 'budget',
    supportsToolChoiceRequired: true, maxOutputTokens: 65536, tokenLimitField: 'max_tokens' } },

  // ── OpenAI ───────────────────────────────────────────────────
  { provider: 'openai', test: /^gpt-5/i, caps: {
    known: true, supportsSampling: false, supportsThinking: true,
    thinkingCanBeDisabled: true, thinkingParamStyle: 'effort',
    supportsToolChoiceRequired: true, maxOutputTokens: 128000, tokenLimitField: 'max_output_tokens' } },
  { provider: 'openai', test: /^(o[1-9]|gpt-4)/i, caps: {
    known: true, supportsSampling: true, supportsThinking: false,
    thinkingCanBeDisabled: false, thinkingParamStyle: 'none',
    supportsToolChoiceRequired: true, maxOutputTokens: 32768, tokenLimitField: 'max_completion_tokens' } },

  // ── Gemini ───────────────────────────────────────────────────
  { provider: 'gemini', test: /gemini-2\.5/i, caps: {
    known: true, supportsSampling: true, supportsThinking: true,
    thinkingCanBeDisabled: true, thinkingParamStyle: 'budget',
    supportsToolChoiceRequired: true, maxOutputTokens: 65536, tokenLimitField: 'max_output_tokens' } },
  { provider: 'gemini', test: /^gemini-/i, caps: {
    known: true, supportsSampling: true, supportsThinking: true,
    thinkingCanBeDisabled: true, thinkingParamStyle: 'level',
    supportsToolChoiceRequired: true, maxOutputTokens: 131072, tokenLimitField: 'max_output_tokens' } },

  // ── DeepSeek ─────────────────────────────────────────────────
  // 混合推理：thinking 默认开，而 thinking 开着时采样参数静默失效
  { provider: 'deepseek', test: /^deepseek-v[4-9]/i, caps: {
    known: true, supportsSampling: false, supportsThinking: true,
    thinkingCanBeDisabled: true, thinkingParamStyle: 'effort',
    supportsToolChoiceRequired: true, maxOutputTokens: 384000, tokenLimitField: 'max_tokens' } },

  // ── 智谱 GLM ─────────────────────────────────────────────────
  // GLM-5.3 与 5.3-Flash 强制思考，不可关闭
  { provider: 'zhipu', test: /^glm-5\.3/i, caps: {
    known: true, supportsSampling: true, supportsThinking: true,
    thinkingCanBeDisabled: false, thinkingParamStyle: 'effort',
    supportsToolChoiceRequired: false, maxOutputTokens: 131072, tokenLimitField: 'max_tokens' } },
  { provider: 'zhipu', test: /^glm-/i, caps: {
    known: true, supportsSampling: true, supportsThinking: true,
    thinkingCanBeDisabled: true, thinkingParamStyle: 'effort',
    // 智谱的 tool_choice 只支持 auto
    supportsToolChoiceRequired: false, maxOutputTokens: 131072, tokenLimitField: 'max_tokens' } },

  // ── Kimi ─────────────────────────────────────────────────────
  // 采样参数被锁死：传任何值都 400
  { provider: 'kimi', test: /^kimi-k3/i, caps: {
    known: true, supportsSampling: false, supportsThinking: true,
    thinkingCanBeDisabled: false, thinkingParamStyle: 'effort',
    supportsToolChoiceRequired: true, maxOutputTokens: 1048576, tokenLimitField: 'max_completion_tokens' } },
  { provider: 'kimi', test: /^kimi-k2\.7-code/i, caps: {
    known: true, supportsSampling: false, supportsThinking: true,
    thinkingCanBeDisabled: false, thinkingParamStyle: 'none',
    supportsToolChoiceRequired: false, maxOutputTokens: 262144, tokenLimitField: 'max_completion_tokens' } },
  { provider: 'kimi', test: /^kimi-/i, caps: {
    known: true, supportsSampling: false, supportsThinking: true,
    thinkingCanBeDisabled: true, thinkingParamStyle: 'none',
    supportsToolChoiceRequired: false, maxOutputTokens: 262144, tokenLimitField: 'max_completion_tokens' } },

  // ── MiniMax ──────────────────────────────────────────────────
  { provider: 'minimax', test: /m3/i, caps: {
    known: true, supportsSampling: true, supportsThinking: true,
    thinkingCanBeDisabled: true, thinkingParamStyle: 'none',
    supportsToolChoiceRequired: true, maxOutputTokens: 524288, tokenLimitField: 'max_completion_tokens' } },
  // M2.x 思考不可关闭
  { provider: 'minimax', test: /^minimax-m2/i, caps: {
    known: true, supportsSampling: true, supportsThinking: true,
    thinkingCanBeDisabled: false, thinkingParamStyle: 'none',
    supportsToolChoiceRequired: true, maxOutputTokens: 204800, tokenLimitField: 'max_completion_tokens' } },

  // ── 千问 ─────────────────────────────────────────────────────
  // qwq 强制思考
  { provider: 'qwen', test: /^qwq/i, caps: {
    known: true, supportsSampling: true, supportsThinking: true,
    thinkingCanBeDisabled: false, thinkingParamStyle: 'budget',
    supportsToolChoiceRequired: false, maxOutputTokens: 32768, tokenLimitField: 'max_completion_tokens' } },
  // Qwen3.5 及以上默认开思考；Qwen3 及以下默认关。两者都可关。
  { provider: 'qwen', test: /^qwen3(\.[5-9]|\.\d{2,})/i, caps: {
    known: true, supportsSampling: true, supportsThinking: true,
    thinkingCanBeDisabled: true, thinkingParamStyle: 'budget',
    supportsToolChoiceRequired: false, maxOutputTokens: 131072, tokenLimitField: 'max_completion_tokens' } },
  { provider: 'qwen', test: /^qwen/i, caps: {
    known: true, supportsSampling: true, supportsThinking: true,
    thinkingCanBeDisabled: true, thinkingParamStyle: 'budget',
    supportsToolChoiceRequired: false, maxOutputTokens: 65536, tokenLimitField: 'max_completion_tokens' } },

  // ── Ollama / 本地端点：通用适配器，什么都不假设 ──────────────
  { provider: 'ollama', test: /.*/, caps: {
    known: true, supportsSampling: true, supportsThinking: false,
    thinkingCanBeDisabled: false, thinkingParamStyle: 'none',
    supportsToolChoiceRequired: false, tokenLimitField: 'max_tokens' } },
];

/** 学到的 quirk：`${provider}:${model}` -> Set<Quirk> */
const learned: Map<string, Set<Quirk>> = new Map();

/** 远端能力表覆盖（可选加速器），`${provider}:${model}` -> 部分能力 */
let remoteOverrides: Map<string, Partial<ModelCapabilities>> = new Map();

/** 持久化钩子。默认只在内存里，接上本地数据库后学到的东西才能跨进程活下来。 */
let persistence: { save?: (entries: Array<[string, Quirk[]]>) => void } = {};

const key = (provider: string, model: string) =>
  `${(provider || '').toLowerCase()}:${(model || '').toLowerCase()}`;

function flush() {
  if (!persistence.save) return;
  try {
    persistence.save(Array.from(learned.entries()).map(([k, v]) => [k, Array.from(v)]));
  } catch (e) {
    console.warn('[ModelCapabilities] 持久化 quirk 失败（不影响本次运行）', e);
  }
}

export const ModelCaps = {
  /** 从持久化层恢复之前学到的 quirk。应用启动时调一次。 */
  hydrate(entries: Array<[string, Quirk[]]>, save?: (e: Array<[string, Quirk[]]>) => void) {
    learned.clear();
    for (const [k, qs] of entries || []) learned.set(k, new Set(qs));
    if (save) persistence.save = save;
  },

  /** 装载远端能力表。拉不到就别调，前三层照常工作。 */
  setRemoteOverrides(table: Record<string, Partial<ModelCapabilities>>) {
    remoteOverrides = new Map(Object.entries(table || {}).map(([k, v]) => [k.toLowerCase(), v]));
  },

  /**
   * 解析某个 (渠道, 模型) 的能力。
   * 顺序：家族规则 → 远端覆盖 → 运行时学到的 quirk（优先级最高，因为它是实测出来的）
   */
  resolve(provider: string, model: string): ModelCapabilities {
    const p = (provider || '').toLowerCase();
    const m = model || '';

    let caps: ModelCapabilities = { ...MINIMAL };
    for (const rule of FAMILY_RULES) {
      if (rule.provider && rule.provider !== p) continue;
      if (!rule.test.test(m)) continue;
      caps = { ...MINIMAL, ...rule.caps, known: true };
      break;
    }

    const ov = remoteOverrides.get(key(p, m));
    if (ov) caps = { ...caps, ...ov, known: true };

    const qs = learned.get(key(p, m));
    if (qs) {
      if (qs.has('no_sampling')) caps.supportsSampling = false;
      if (qs.has('no_thinking')) { caps.supportsThinking = false; caps.thinkingParamStyle = 'none'; }
      if (qs.has('thinking_not_disablable')) caps.thinkingCanBeDisabled = false;
      if (qs.has('no_effort')) caps.thinkingParamStyle = 'none';
      if (qs.has('no_tool_choice_required')) caps.supportsToolChoiceRequired = false;
    }
    return caps;
  },

  /**
   * 从一次失败里学东西。
   * 只处理参数类的 4xx —— 429/5xx 是运行时状况，跟能力无关。
   * 返回 true 表示学到了新东西，调用方可以重试一次。
   */
  learnFromError(provider: string, model: string, status: number | undefined, message: string): Quirk | null {
    if (status !== undefined && status !== 400 && status !== 422) return null;
    const msg = (message || '').toLowerCase();

    let quirk: Quirk | null = null;

    // 顺序有讲究：先判更具体的「思考不能关」，再判泛化的「不支持思考」
    if (/thinking|reasoning/.test(msg) && /disab|cannot be turned off|not allowed/.test(msg)) {
      quirk = 'thinking_not_disablable';
    } else if (/effort|reasoning_effort|output_config/.test(msg)) {
      quirk = 'no_effort';
    } else if (/thinking|reasoning|enable_thinking/.test(msg)) {
      quirk = 'no_thinking';
    } else if (/temperature|top_p|top_k|presence_penalty|frequency_penalty|do_sample/.test(msg)) {
      quirk = 'no_sampling';
    } else if (/tool_choice/.test(msg)) {
      quirk = 'no_tool_choice_required';
    }

    if (!quirk) return null;

    const k = key(provider, model);
    const set = learned.get(k) || new Set<Quirk>();
    if (set.has(quirk)) return null;   // 已经学过，别再重试
    set.add(quirk);
    learned.set(k, set);
    flush();
    console.warn(`[ModelCapabilities] 学到 ${k} → ${quirk}（来自：${message.slice(0, 120)}）`);
    return quirk;
  },

  /** 测试与排查用 */
  _dump(): Record<string, Quirk[]> {
    const out: Record<string, Quirk[]> = {};
    for (const [k, v] of learned.entries()) out[k] = Array.from(v);
    return out;
  },
  _reset() { learned.clear(); remoteOverrides.clear(); }
};
