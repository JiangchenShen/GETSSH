import { getRustCorePath } from '../utils/rustCorePath';

let sentinelCore: any = null;

try {
  sentinelCore = require(getRustCorePath('getssh-sentinel'));
  console.log('[SentinelGateway] Successfully loaded Rust getssh-sentinel native module');
} catch (e: any) {
  console.warn('[SentinelGateway] Sentinel Core native module not found. AI requests will NOT be sanitized!', e.message);
}

export interface SanitizeResult {
  cleanText: string;
  mappingDict: Record<string, string>;
}

export class SentinelGateway {
  /**
   * Sanitizes text using the Rust NER engine.
   * Replaces IPs, Secrets, Private Keys, etc. with tokens like [IP_1].
   */
  static sanitize(text: string): SanitizeResult {
    if (!sentinelCore || !text) {
      return { cleanText: text, mappingDict: {} };
    }

    try {
      const result = sentinelCore.sanitize(text);
      return {
        cleanText: result.clean_text,
        mappingDict: result.mapping_dict,
      };
    } catch (err) {
      console.error('[SentinelGateway] Sanitize failed:', err);
      return { cleanText: text, mappingDict: {} };
    }
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
