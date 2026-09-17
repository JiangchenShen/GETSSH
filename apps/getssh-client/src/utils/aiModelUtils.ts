/**
 * AI Model Cleaning, Normalization, Filtering & Fuzzy Matching Utilities
 */

// Prefixes to clean from vendor APIs
const PREFIXES_TO_STRIP = [
  /^models\//i,
  /^openai\//i,
  /^anthropic\//i,
  /^google\//i,
];

// Patterns that identify non-chat / non-conversational models to filter out from general list
const NON_CHAT_PATTERNS = [
  /embedding/i,
  /embed/i,
  /text-search/i,
  /similarity/i,
  /tts/i,
  /whisper/i,
  /audio/i,
  /dall-e/i,
  /imagen/i,
  /moderation/i,
  /babbage/i,
  /davinci/i,
  /canary/i,
  /aqa/i,
  /realtime-preview/i,
  /transcribe/i,
];

/**
 * Strips technical vendor prefixes like `models/` or leading slashes
 */
export function cleanModelId(rawId: string): string {
  if (!rawId) return '';
  let id = rawId.trim();
  for (const prefix of PREFIXES_TO_STRIP) {
    id = id.replace(prefix, '');
  }
  return id;
}

/**
 * Determines whether a model is a conversational / reasoning LLM suitable for chat & agents
 */
export function isConversationalModel(rawId: string): boolean {
  const id = cleanModelId(rawId);
  if (!id) return false;
  return !NON_CHAT_PATTERNS.some(pattern => pattern.test(id));
}

/**
 * Formats a clean, human-friendly display title for any model ID
 * E.g. "gemini-3.7-flash" -> "Gemini 3.7 Flash"
 *      "claude-3-5-sonnet-20241022" -> "Claude 3.5 Sonnet (2024-10-22)"
 *      "gpt-5.6-terra" -> "GPT-5.6 Terra"
 */
export function formatModelDisplayName(rawId: string): string {
  const id = cleanModelId(rawId);
  if (!id) return '';

  // Special known acronyms / brands
  if (/^gpt-/i.test(id)) {
    const parts = id.split('-');
    return parts.map((part, idx) => {
      if (idx === 0) return 'GPT';
      if (/^\d+(\.\d+)?$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    }).join(' ').replace(/^GPT\s+(\d)/, 'GPT-$1');
  }
  if (/^gemini-/i.test(id)) {
    return id.split('-').map((part, idx) => {
      if (idx === 0) return 'Gemini';
      if (/^\d+(\.\d+)?$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    }).join(' ');
  }
  if (/^claude-/i.test(id)) {
    return id.split('-').map((part, idx) => {
      if (idx === 0) return 'Claude';
      if (/^\d{8}$/.test(part)) {
        return `(${part.slice(0, 4)}-${part.slice(4, 6)}-${part.slice(6)})`;
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    }).join(' ');
  }
  if (/^deepseek-/i.test(id)) {
    return id.replace(/^deepseek-/i, 'DeepSeek-').replace(/-?r(\d+)/i, '-R$1').replace(/-?v(\d+)/i, '-V$1').replace(/--/g, '-');
  }
  if (/^qwen/i.test(id)) {
    return id.replace(/^qwen/i, 'Qwen-').replace(/-/g, ' ');
  }

  // Generic formatting: capitalize words, keep digits
  return id
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Normalizes a string by stripping hyphens, underscores, dots, whitespace, and lowercasing
 */
export function normalizeForSearch(str: string): string {
  if (!str) return '';
  return str.toLowerCase().replace(/[-_.\s/:]/g, '');
}

/**
 * Matches a user query against modelId or displayName, cleaning out hyphens and symbols
 * Multi-term search supported (e.g. "flash 3.7" matches "gemini-3.7-flash")
 */
export function matchModelQuery(rawId: string, displayName: string, query: string): boolean {
  if (!query || !query.trim()) return true;
  const target = normalizeForSearch(`${rawId} ${displayName}`);
  
  // Split query into terms to support multi-word search e.g. "flash 3.7"
  const terms = query.trim().split(/[\s,]+/).map(t => normalizeForSearch(t)).filter(Boolean);
  return terms.every(term => target.includes(term));
}

/**
 * Compares two model IDs ignoring casing, prefixes, and hyphens/underscores
 */
export function isSameModel(idA: string, idB: string): boolean {
  if (!idA || !idB) return false;
  return normalizeForSearch(cleanModelId(idA)) === normalizeForSearch(cleanModelId(idB));
}
