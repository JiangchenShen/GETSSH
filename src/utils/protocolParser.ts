/**
 * protocolParser.ts — Smart Protocol Auto-Detection Engine
 *
 * Pure function parser. Called on every keystroke in the host input field.
 * Returns protocol + any parseable connection params.
 */

export interface ProtocolDetectResult {
  protocol: 'ssh' | 'local' | 'telnet';
  parsedHost?: string;
  parsedUser?: string;
  parsedPort?: number;
}

export function detectProtocol(input: string): ProtocolDetectResult {
  const trimmed = input.trim().toLowerCase();

  // 1. Local CLI keywords
  const localKeywords = ['local', 'localhost', '127.0.0.1', '/bin/sh', '/bin/bash', '/bin/zsh', 'powershell', 'cmd'];
  if (localKeywords.some(k => trimmed === k || trimmed.startsWith(k + ':') || trimmed.startsWith(k + '/'))) {
    return { protocol: 'local' };
  }

  // 2. Explicit telnet:// or :23 suffix
  if (trimmed.startsWith('telnet://') || /:23$/.test(trimmed)) {
    const raw = input.trim().replace(/^telnet:\/\//i, '');
    const parsedHost = raw.split(':')[0];
    return { protocol: 'telnet', parsedHost: parsedHost || undefined };
  }

  // 3. ssh:// URI — try to extract user, host, port
  if (trimmed.startsWith('ssh://')) {
    const match = input.match(/ssh:\/\/(?:([^@:/?]+)@)?([^:/?]+)(?::(\d+))?/i);
    if (match) {
      return {
        protocol: 'ssh',
        parsedUser: match[1] || undefined,
        parsedHost: match[2] || undefined,
        parsedPort: match[3] ? parseInt(match[3], 10) : 22,
      };
    }
  }

  // 4. user@host shorthand (common SSH one-liner)
  if (/^[a-z0-9_.-]+@[a-z0-9_.-]+/i.test(trimmed) && !trimmed.startsWith('http')) {
    const atIdx = input.indexOf('@');
    const parsedUser = input.slice(0, atIdx);
    const rest = input.slice(atIdx + 1);
    const colonIdx = rest.lastIndexOf(':');
    const parsedHost = colonIdx >= 0 ? rest.slice(0, colonIdx) : rest;
    const portStr = colonIdx >= 0 ? rest.slice(colonIdx + 1) : '';
    const parsedPort = portStr && /^\d+$/.test(portStr) ? parseInt(portStr, 10) : 22;
    return { protocol: 'ssh', parsedUser, parsedHost, parsedPort };
  }

  // 5. Default fallback
  return { protocol: 'ssh' };
}
