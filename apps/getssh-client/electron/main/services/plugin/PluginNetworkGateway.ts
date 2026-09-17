import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';

const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

const blockedAddresses = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv4');
  blockedAddresses.addSubnet(`::ffff:${network}`, 96 + prefix, 'ipv6');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::', 96],
  ['64:ff9b:1::', 48],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
  ['2002::', 16],
  ['2001:db8::', 32]
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv6');
}

export interface SerializedPluginFetchOptions {
  method?: string;
  headers?: Array<[string, string]>;
  redirect?: RequestRedirect;
  bodyText?: string;
  bodyBase64?: string;
}

export interface SerializedPluginFetchResponse {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  bodyBase64: string;
  url: string;
}

export function isPrivateNetworkAddress(rawAddress: string): boolean {
  const address = rawAddress.startsWith('[') && rawAddress.endsWith(']')
    ? rawAddress.slice(1, -1)
    : rawAddress;
  const mappedIpv4 = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (mappedIpv4) return isPrivateNetworkAddress(mappedIpv4);
  const family = isIP(address);
  if (family === 4) return blockedAddresses.check(address, 'ipv4');
  if (family === 6) return blockedAddresses.check(address, 'ipv6');
  return true;
}

async function resolvePublicAddress(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  const literal = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  const literalFamily = isIP(literal);

  let addresses: Array<{ address: string; family: 4 | 6 }>;

  if (literalFamily) {
    addresses = [{ address: literal, family: literalFamily as 4 | 6 }];
  } else {
    // Use dns.resolve4/resolve6 instead of dns.lookup.
    // dns.lookup() goes through the OS resolver (getaddrinfo), which:
    //   - reads /etc/hosts FIRST (manipulable locally)
    //   - uses NSS / mDNS / OS cache (not real-time DNS)
    // dns.resolve4/resolve6 query the DNS wire protocol directly, bypassing all of that.
    // This is the correct approach to prevent OS-level DNS poisoning.
    const [v4Result, v6Result] = await Promise.allSettled([
      dns.resolve4(hostname),
      dns.resolve6(hostname),
    ]);
    const v4: Array<{ address: string; family: 4 | 6 }> =
      v4Result.status === 'fulfilled'
        ? v4Result.value.map(a => ({ address: a, family: 4 as const }))
        : [];
    const v6: Array<{ address: string; family: 4 | 6 }> =
      v6Result.status === 'fulfilled'
        ? v6Result.value.map(a => ({ address: a, family: 6 as const }))
        : [];
    addresses = [...v4, ...v6];
  }

  if (addresses.length === 0) {
    throw new Error(`NetworkError: '${hostname}' did not resolve to an address.`);
  }
  // Check EVERY resolved address — an attacker may return a mix of public and private IPs.
  for (const candidate of addresses) {
    if (isPrivateNetworkAddress(candidate.address)) {
      throw new Error(`SecurityError: '${hostname}' resolved to blocked address ${candidate.address}.`);
    }
  }
  return addresses[0] as { address: string; family: 4 | 6 };
}

function normalizeHeaders(input: Array<[string, string]> = []): Record<string, string> {
  if (!Array.isArray(input)) throw new Error('NetworkError: headers must be an array of pairs.');
  if (input.length > 128) throw new Error('NetworkError: too many request headers.');
  const blocked = new Set([
    'connection',
    'content-length',
    'host',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade'
  ]);
  const output: Record<string, string> = {};
  for (const pair of input) {
    if (!Array.isArray(pair) || pair.length !== 2) throw new Error('NetworkError: invalid header pair.');
    const [name, value] = pair;
    if (typeof name !== 'string' || typeof value !== 'string') {
      throw new Error('NetworkError: header names and values must be strings.');
    }
    if (name.length > 256 || value.length > 16_384 || /[\r\n]/.test(value)) {
      throw new Error('NetworkError: invalid header length or value.');
    }
    const lower = name.toLowerCase();
    if (blocked.has(lower)) continue;
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(lower)) {
      throw new Error(`NetworkError: invalid header name '${name}'.`);
    }
    output[lower] = String(value);
  }
  return output;
}

function responseHeaders(rawHeaders: string[]): Array<[string, string]> {
  const headers: Array<[string, string]> = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    headers.push([rawHeaders[i], rawHeaders[i + 1] || '']);
  }
  return headers;
}

function requestBody(options: SerializedPluginFetchOptions): Buffer | undefined {
  if (options.bodyText !== undefined && options.bodyBase64 !== undefined) {
    throw new Error('NetworkError: request cannot contain two body encodings.');
  }
  if (options.bodyText !== undefined) {
    if (typeof options.bodyText !== 'string') throw new Error('NetworkError: text body must be a string.');
    return Buffer.from(options.bodyText, 'utf8');
  }
  if (options.bodyBase64 !== undefined) {
    if (typeof options.bodyBase64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(options.bodyBase64)) {
      throw new Error('NetworkError: binary body must be valid base64.');
    }
    return Buffer.from(options.bodyBase64, 'base64');
  }
  return undefined;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export async function fetchForPlugin(
  rawUrl: string,
  options: SerializedPluginFetchOptions = {},
  redirectCount = 0
): Promise<SerializedPluginFetchResponse> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`SecurityError: Invalid URL '${rawUrl}'.`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`SecurityError: Protocol '${url.protocol}' is not allowed.`);
  }
  if (url.username || url.password) {
    throw new Error('SecurityError: Credentials in plugin URLs are not allowed.');
  }

  const { address, family } = await resolvePublicAddress(url.hostname);
  if (
    options.redirect !== undefined &&
    options.redirect !== 'follow' &&
    options.redirect !== 'manual' &&
    options.redirect !== 'error'
  ) {
    throw new Error('NetworkError: invalid redirect policy.');
  }
  const body = requestBody(options);
  const method = String(options.method || 'GET').toUpperCase();
  if (!/^[!#$%&'*+.^_`|~0-9A-Z-]{1,32}$/.test(method)) {
    throw new Error('NetworkError: invalid HTTP method.');
  }
  const headers = normalizeHeaders(options.headers);
  headers.host = url.host;
  if (body) headers['content-length'] = String(body.byteLength);

  const transport = url.protocol === 'https:' ? https : http;
  const result = await new Promise<SerializedPluginFetchResponse>((resolve, reject) => {
    const request = transport.request({
      protocol: url.protocol,
      hostname: address,
      family,
      port: url.port || undefined,
      method,
      path: `${url.pathname}${url.search}`,
      headers,
      ...(url.protocol === 'https:' && isIP(url.hostname) === 0 ? { servername: url.hostname } : {})
    }, (response) => {
      const status = response.statusCode || 0;
      const location = response.headers.location;

      if (isRedirect(status) && location && options.redirect !== 'manual') {
        response.resume();
        if (options.redirect === 'error') {
          reject(new Error('NetworkError: redirect rejected by plugin request policy.'));
          return;
        }
        if (redirectCount >= MAX_REDIRECTS) {
          reject(new Error(`NetworkError: exceeded ${MAX_REDIRECTS} redirects.`));
          return;
        }
        const nextUrl = new URL(location, url);
        const nextHeaders = (options.headers || []).filter(([name]) => {
          if (nextUrl.origin === url.origin) return true;
          const lower = name.toLowerCase();
          return lower !== 'authorization' && lower !== 'cookie';
        });
        const switchToGet = status === 303 || ((status === 301 || status === 302) && method === 'POST');
        void fetchForPlugin(nextUrl.toString(), {
          ...options,
          headers: nextHeaders,
          ...(switchToGet
            ? { method: 'GET', bodyText: undefined, bodyBase64: undefined }
            : {})
        }, redirectCount + 1).then(resolve, reject);
        return;
      }

      const chunks: Buffer[] = [];
      let total = 0;
      response.on('data', (chunk: Buffer) => {
        total += chunk.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          request.destroy(new Error(`NetworkError: response exceeds ${MAX_RESPONSE_BYTES} bytes.`));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      response.on('end', () => {
        resolve({
          status,
          statusText: response.statusMessage || '',
          headers: responseHeaders(response.rawHeaders),
          bodyBase64: Buffer.concat(chunks).toString('base64'),
          url: url.toString()
        });
      });
      response.on('error', reject);
    });

    // --- Layer 2: Socket-level post-connection verification ---
    // Even though we connect to `address` (a pre-checked IP), the OS may still
    // resolve the hostname internally for certain edge cases (e.g. proxy settings,
    // transparent proxies, or kernel-level NAT rewrites). We re-check the actual
    // remote address after the TCP handshake completes to close the TOCTOU window.
    request.on('socket', (socket) => {
      socket.once('connect', () => {
        const raw = socket.remoteAddress ?? '';
        const remote = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;
        if (!remote) {
          request.destroy(new Error('SecurityError: Could not determine remote socket address.'));
          return;
        }
        if (isPrivateNetworkAddress(remote)) {
          request.destroy(new Error(`SecurityError: Socket connected to blocked address ${remote}.`));
          return;
        }
        // Ensure the connected IP is exactly the one we pre-checked \u2014
        // guarding against any OS-level address substitution.
        const normalizedExpected = address.startsWith('[') && address.endsWith(']')
          ? address.slice(1, -1)
          : address;
        if (remote !== normalizedExpected) {
          request.destroy(
            new Error(`SecurityError: Socket connected to unexpected address ${remote} (expected ${normalizedExpected}).`)
          );
        }
      });
    });

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`NetworkError: request timed out after ${REQUEST_TIMEOUT_MS}ms.`));
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });

  return result;
}
