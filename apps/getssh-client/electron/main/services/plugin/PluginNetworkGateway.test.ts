import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isIP } from 'node:net';

/*
 * Security tests for the plugin network gateway (ctx.net.fetch).
 *
 * No real network is touched: the DNS resolver (node:dns/promises) and the HTTP
 * transports (node:http / node:https) are replaced with in-memory fakes.
 *
 * The fake transport behaves like the OS would: handed an IP literal, it connects to
 * exactly that IP; handed a hostname, it resolves it AGAIN through the same
 * attacker-controlled DNS zone (the DNS-rebinding TOCTOU described in the audit,
 * section 0.1.7 / V6). The socket's remoteAddress is whatever the connection reached.
 */

type Transport = 'http' | 'https';

interface Reply {
  status?: number;
  statusMessage?: string;
  headers?: Record<string, string>;
  body?: Buffer;
  /** Accept the connection but never send a response. */
  hang?: boolean;
  /** Send `bytes` one-byte chunks, `intervalMs` apart. */
  trickle?: { bytes: number; intervalMs: number };
}

interface Connection {
  transport: Transport;
  options: Record<string, any>;
  remoteAddress: string;
  body: Buffer;
  responded: boolean;
}

const fake = vi.hoisted(() => {
  const zone = new Map<string, { a: string[][]; aaaa: string[][]; aCalls: number; aaaaCalls: number }>();

  function answer(hostname: string, kind: 'a' | 'aaaa'): string[] {
    const entry = zone.get(hostname.toLowerCase());
    const answers = entry?.[kind] ?? [];
    if (!entry || answers.length === 0) {
      const err = new Error(`query${kind === 'a' ? 'A' : 'AAAA'} ENOTFOUND ${hostname}`) as Error & { code: string };
      err.code = 'ENOTFOUND';
      throw err;
    }
    const index = kind === 'a' ? entry.aCalls++ : entry.aaaaCalls++;
    return [...answers[Math.min(index, answers.length - 1)]];
  }

  const state = {
    zone,
    answer,
    resolve4: vi.fn(async (hostname: string) => answer(hostname, 'a')),
    resolve6: vi.fn(async (hostname: string) => answer(hostname, 'aaaa')),
    connections: [] as Array<{
      transport: 'http' | 'https';
      options: Record<string, any>;
      remoteAddress: string;
      body: Buffer;
      responded: boolean;
    }>,
    /** Server behaviour; receives the connection (incl. the address actually reached). */
    server: null as null | ((conn: any) => any),
    /** Simulates an OS / transparent-proxy substitution of the connected address. */
    substituteRemote: null as null | ((intended: string) => string),
    unexpectedErrors: [] as unknown[],
    makeTransport: async (transport: 'http' | 'https') => {
      const { EventEmitter } = await import('node:events');
      const { Readable } = await import('node:stream');
      const net = await import('node:net');

      class FakeClientRequest extends EventEmitter {
        destroyed = false;
        private written: Buffer[] = [];
        private timer: ReturnType<typeof setTimeout> | undefined;
        private idle: { ms: number; cb: () => void } | undefined;
        private response: InstanceType<typeof Readable> | undefined;

        constructor(readonly options: Record<string, any>, private readonly onResponse: (res: any) => void) {
          super();
        }

        setTimeout(ms: number, cb: () => void) {
          this.idle = { ms, cb };
          this.timer = setTimeout(cb, ms);
          return this;
        }

        /** Real sockets restart the idle timer whenever data arrives. */
        private touch() {
          if (!this.idle || !this.timer) return;
          clearTimeout(this.timer);
          this.timer = setTimeout(this.idle.cb, this.idle.ms);
        }

        write(chunk: Buffer | string) {
          this.written.push(Buffer.from(chunk));
          return true;
        }

        end() {
          setImmediate(() => {
            this.connect().catch((err) => state.unexpectedErrors.push(err));
          });
          return this;
        }

        destroy(err?: Error) {
          if (this.destroyed) return this;
          this.destroyed = true;
          this.clearTimer();
          this.response?.destroy();
          if (err) process.nextTick(() => this.emit('error', err));
          process.nextTick(() => this.emit('close'));
          return this;
        }

        private clearTimer() {
          if (this.timer) clearTimeout(this.timer);
          this.timer = undefined;
        }

        private async resolveLikeOs(host: string): Promise<string> {
          const literal = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
          if (net.isIP(literal)) return literal;
          if (typeof this.options.lookup === 'function') {
            return new Promise((resolve, reject) => {
              this.options.lookup(literal, { family: this.options.family ?? 0 }, (err: Error | null, addr: any) => {
                if (err) reject(err);
                else resolve(Array.isArray(addr) ? addr[0].address : addr);
              });
            });
          }
          // Independent second resolution, answered by the same (attacker-controlled) zone.
          return answer(literal, 'a')[0];
        }

        private async connect() {
          if (this.destroyed) return;
          const intended = await this.resolveLikeOs(String(this.options.hostname ?? this.options.host));
          const remoteAddress = state.substituteRemote ? state.substituteRemote(intended) : intended;
          const socket = Object.assign(new EventEmitter(), { remoteAddress });
          this.emit('socket', socket);
          socket.emit('connect');

          const conn = {
            transport,
            options: this.options,
            remoteAddress,
            body: Buffer.concat(this.written),
            responded: false
          };
          state.connections.push(conn);
          if (this.destroyed) return;

          const reply = state.server ? state.server(conn) : { status: 200, body: Buffer.from('ok') };
          if (reply.hang) return;
          conn.responded = true;

          const res = new Readable({ read() {} }) as InstanceType<typeof Readable> & Record<string, any>;
          const headers: Record<string, string> = {};
          const rawHeaders: string[] = [];
          for (const [k, v] of Object.entries((reply.headers ?? {}) as Record<string, string>)) {
            headers[k.toLowerCase()] = v;
            rawHeaders.push(k, v);
          }
          res.statusCode = reply.status ?? 200;
          res.statusMessage = reply.statusMessage ?? '';
          res.headers = headers;
          res.rawHeaders = rawHeaders;
          // Like a real socket going back to the pool: the idle timer stops once the body ends.
          res.once('end', () => this.clearTimer());
          this.response = res;
          this.onResponse(res);

          if (reply.trickle) {
            // One byte every intervalMs: never idle long enough for the idle timeout.
            for (let i = 0; i < reply.trickle.bytes; i++) {
              if (res.destroyed) return;
              res.push(Buffer.from('x'));
              this.touch();
              await new Promise((r) => setTimeout(r, reply.trickle.intervalMs));
            }
            if (!res.destroyed) res.push(null);
            return;
          }

          const body: Buffer = reply.body ?? Buffer.alloc(0);
          const CHUNK = 64 * 1024;
          for (let offset = 0; offset < body.byteLength; offset += CHUNK) {
            if (res.destroyed) return;
            res.push(body.subarray(offset, offset + CHUNK));
            await new Promise((r) => setImmediate(r));
          }
          if (!res.destroyed) res.push(null);
        }
      }

      return vi.fn((options: Record<string, any>, onResponse: (res: any) => void) =>
        new FakeClientRequest(options, onResponse));
    }
  };
  return state;
});

vi.mock('node:dns/promises', () => ({
  default: { resolve4: fake.resolve4, resolve6: fake.resolve6 },
  resolve4: fake.resolve4,
  resolve6: fake.resolve6
}));

vi.mock('node:http', async () => {
  const request = await fake.makeTransport('http');
  return { default: { request }, request };
});

vi.mock('node:https', async () => {
  const request = await fake.makeTransport('https');
  return { default: { request }, request };
});

import { fetchForPlugin, isPrivateNetworkAddress } from './PluginNetworkGateway';

function setDns(hostname: string, records: { a?: string[] | string[][]; aaaa?: string[] | string[][] }) {
  const norm = (value?: string[] | string[][]): string[][] => {
    if (!value || value.length === 0) return [];
    return Array.isArray(value[0]) ? (value as string[][]) : [value as string[]];
  };
  fake.zone.set(hostname.toLowerCase(), { a: norm(records.a), aaaa: norm(records.aaaa), aCalls: 0, aaaaCalls: 0 });
}

function resolverCallsFor(hostname: string): number {
  return [...fake.resolve4.mock.calls, ...fake.resolve6.mock.calls]
    .filter(([name]) => String(name).toLowerCase() === hostname.toLowerCase()).length;
}

const PUBLIC_A = '93.184.216.34';
const PUBLIC_B = '151.101.1.69';
const PUBLIC_C = '104.16.132.229';

beforeEach(() => {
  fake.zone.clear();
  fake.connections.length = 0;
  fake.server = null;
  fake.substituteRemote = null;
  fake.unexpectedErrors.length = 0;
  fake.resolve4.mockClear();
  fake.resolve6.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  expect(fake.unexpectedErrors).toEqual([]);
});

// ---------------------------------------------------------------------------
// isPrivateNetworkAddress
// ---------------------------------------------------------------------------

describe('isPrivateNetworkAddress', () => {
  it.each([
    // RFC 1918 private, including range edges
    '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.254', '192.168.0.1', '192.168.255.255',
    // loopback, the whole /8
    '127.0.0.1', '127.0.0.2', '127.255.255.254',
    // link-local, including the cloud metadata endpoint
    '169.254.0.1', '169.254.169.254',
    // CGNAT shared address space
    '100.64.0.1', '100.127.255.254',
    // multicast
    '224.0.0.1', '239.255.255.250',
    // "this network" / unspecified
    '0.0.0.0', '0.1.2.3',
    // reserved + limited broadcast
    '240.0.0.1', '255.255.255.255',
    // IETF protocol assignments, benchmarking, documentation ranges
    '192.0.0.8', '198.18.0.1', '198.19.255.254', '192.0.2.1', '198.51.100.7', '203.0.113.9'
  ])('blocks IPv4 %s', (address) => {
    expect(isPrivateNetworkAddress(address)).toBe(true);
  });

  it.each([
    '::1', '[::1]', '0:0:0:0:0:0:0:1', '::',
    // unique local (fc00::/7)
    'fc00::1', 'fd12:3456:789a::1', 'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    // link-local (fe80::/10) and deprecated site-local
    'fe80::1', 'febf:ffff::1', 'fec0::1',
    // multicast
    'ff02::1', 'ff05::1:3',
    // documentation
    '2001:db8::1'
  ])('blocks IPv6 %s', (address) => {
    expect(isPrivateNetworkAddress(address)).toBe(true);
  });

  it.each([
    '::ffff:127.0.0.1', '::FFFF:127.0.0.1', '[::ffff:127.0.0.1]',
    '::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1', '[::ffff:7f00:1]',
    '::ffff:10.0.0.1', '::ffff:a00:1',
    '::ffff:169.254.169.254', '::ffff:a9fe:a9fe',
    '::ffff:192.168.1.1', '::ffff:c0a8:101',
    '::ffff:0.0.0.0', '::ffff:100.64.0.1',
    // IPv4-compatible (::/96), 6to4 and local-use NAT64 wrappers around internal IPv4
    '::127.0.0.1', '2002:7f00:1::1', '2002:c0a8:101::1', '64:ff9b:1::a00:1'
  ])('blocks IPv4-embedded IPv6 form %s', (address) => {
    expect(isPrivateNetworkAddress(address)).toBe(true);
  });

  it.each([
    '8.8.8.8', '1.1.1.1', PUBLIC_A, PUBLIC_B,
    // just outside private/CGNAT/link-local range boundaries
    '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1',
    '169.253.255.255', '169.255.0.1', '11.0.0.1', '9.255.255.255', '126.255.255.255', '128.0.0.1',
    '192.167.255.255', '192.169.0.1', '223.255.255.254',
    // public IPv6 and IPv4-mapped public IPv4
    '2606:4700:4700::1111', '2001:4860:4860::8888', '[2606:4700:4700::1111]',
    '::ffff:8.8.8.8', '::ffff:808:808'
  ])('allows public address %s', (address) => {
    expect(isPrivateNetworkAddress(address)).toBe(false);
  });

  it.each([
    '64:ff9b::a00:1', '64:ff9b::10.0.0.1', '64:ff9b::a9fe:a9fe', '64:ff9b::7f00:1', '64:ff9b::c0a8:101',
    '::ffff:0:a00:1', '::ffff:0:7f00:1', '[64:ff9b::a00:1]'
  ])('blocks NAT64 / IPv4-translated address %s that embeds a private IPv4', (address) => {
    expect(isPrivateNetworkAddress(address)).toBe(true);
  });

  it.each(['64:ff9b::808:808', '64:ff9b::8.8.8.8', '::ffff:0:808:808'])(
    'allows NAT64 / IPv4-translated address %s that embeds a public IPv4',
    (address) => {
      expect(isPrivateNetworkAddress(address)).toBe(false);
    }
  );

  it.each(['localhost', 'example.com', '', 'not-an-ip', '127.0.0.1.nip.io', '0x7f000001', '2130706433', '127.1', '[localhost]'])(
    'fails closed for non-IP input %j',
    (input) => {
      expect(isPrivateNetworkAddress(input)).toBe(true);
    }
  );
});

// ---------------------------------------------------------------------------
// fetchForPlugin
// ---------------------------------------------------------------------------

describe('fetchForPlugin: URL gate', () => {
  it.each([
    'file:///etc/passwd',
    'ftp://example.com/file',
    'data:text/plain,hello',
    'javascript:alert(1)',
    'ws://example.com/socket',
    'wss://example.com/socket',
    'gopher://example.com/',
    'chrome://settings',
    'app://local/index.html'
  ])('rejects non-http(s) scheme %s before resolving or connecting', async (url) => {
    setDns('example.com', { a: [PUBLIC_A] });
    await expect(fetchForPlugin(url)).rejects.toThrow(/SecurityError/);
    expect(fake.resolve4).not.toHaveBeenCalled();
    expect(fake.resolve6).not.toHaveBeenCalled();
    expect(fake.connections).toHaveLength(0);
  });

  it.each(['not a url', '', 'http//missing-colon.example', '//example.com/path'])(
    'rejects unparseable URL %j',
    async (url) => {
      await expect(fetchForPlugin(url)).rejects.toThrow(/SecurityError/);
      expect(fake.connections).toHaveLength(0);
    }
  );

  it.each([
    'http://user:pass@example.com/',
    'https://user@example.com/',
    'https://:secret@example.com/',
    'http://admin:admin@127.0.0.1/'
  ])('rejects URL with embedded credentials %s', async (url) => {
    setDns('example.com', { a: [PUBLIC_A] });
    await expect(fetchForPlugin(url)).rejects.toThrow(/SecurityError/);
    expect(fake.resolve4).not.toHaveBeenCalled();
    expect(fake.connections).toHaveLength(0);
  });
});

describe('fetchForPlugin: private destinations', () => {
  it.each([
    'http://127.0.0.1/',
    'http://127.0.0.1:6379/',
    'http://127.8.9.10/',
    'http://[::1]:8080/',
    'http://[::]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://[fd00::1]/',
    'http://[fe80::1]/',
    'http://169.254.169.254/latest/meta-data/iam/',
    'http://10.0.0.1/',
    'https://192.168.1.1/',
    'http://100.64.0.1/',
    'http://0.0.0.0:3000/',
    'http://224.0.0.251/',
    // legacy numeric encodings that the WHATWG parser canonicalises to loopback/unspecified
    'http://0x7f000001/',
    'http://2130706433/',
    'http://127.1/',
    'http://0177.0.0.1/',
    'http://0/'
  ])('refuses %s without opening a connection', async (url) => {
    await expect(fetchForPlugin(url)).rejects.toThrow(/SecurityError/);
    expect(fake.connections).toHaveLength(0);
  });

  it('refuses a hostname whose A record is loopback', async () => {
    setDns('localhost', { a: ['127.0.0.1'], aaaa: ['::1'] });
    setDns('internal.attacker.example', { a: ['127.0.0.1'] });
    await expect(fetchForPlugin('http://localhost:8080/')).rejects.toThrow(/SecurityError/);
    await expect(fetchForPlugin('http://internal.attacker.example/')).rejects.toThrow(/SecurityError/);
    expect(fake.connections).toHaveLength(0);
  });

  it('refuses a hostname that only has a private AAAA record', async () => {
    setDns('v6only.attacker.example', { aaaa: ['fd00::5'] });
    await expect(fetchForPlugin('https://v6only.attacker.example/')).rejects.toThrow(/SecurityError/);
    expect(fake.connections).toHaveLength(0);
  });

  it.each([
    { name: 'private address after a public one', a: [PUBLIC_A, '10.0.0.5'], aaaa: [] },
    { name: 'private address before a public one', a: ['192.168.0.10', PUBLIC_A], aaaa: [] },
    { name: 'public A plus private AAAA', a: [PUBLIC_A], aaaa: ['fd00::1'] },
    { name: 'public A plus loopback AAAA', a: [PUBLIC_A], aaaa: ['::1'] },
    { name: 'public AAAA plus metadata A', a: ['169.254.169.254'], aaaa: ['2606:4700:4700::1111'] },
    { name: 'IPv4-mapped loopback hidden in AAAA', a: [PUBLIC_A], aaaa: ['::ffff:127.0.0.1'] }
  ])('refuses when ANY resolved address is private ($name)', async ({ a, aaaa }) => {
    setDns('mixed.attacker.example', { a, aaaa });
    await expect(fetchForPlugin('https://mixed.attacker.example/')).rejects.toThrow(/SecurityError/);
    expect(fake.connections).toHaveLength(0);
  });

  it('refuses a hostname that does not resolve at all', async () => {
    await expect(fetchForPlugin('https://nxdomain.example/')).rejects.toThrow(/did not resolve/);
    expect(fake.connections).toHaveLength(0);
  });
});

describe('fetchForPlugin: DNS rebinding', () => {
  it('connects to the exact address it validated, never re-resolving the hostname', async () => {
    // Attacker DNS: first answer is public (passes validation), every later answer is loopback.
    setDns('rebind.attacker.example', { a: [[PUBLIC_A], ['127.0.0.1']] });
    fake.server = (conn: Connection) => ({
      status: 200,
      body: Buffer.from(conn.remoteAddress === PUBLIC_A ? 'public' : 'INTERNAL-SECRET')
    });

    const res = await fetchForPlugin('http://rebind.attacker.example:8080/path?q=1');

    expect(fake.connections).toHaveLength(1);
    const [conn] = fake.connections;
    expect(conn.remoteAddress).toBe(PUBLIC_A);
    expect(isIP(String(conn.options.hostname))).toBe(4);
    expect(conn.options.hostname).toBe(PUBLIC_A);
    expect(isPrivateNetworkAddress(conn.remoteAddress)).toBe(false);
    // The hostname was resolved once for this hop — there was no second lookup for the attacker to answer.
    expect(fake.resolve4.mock.calls.filter(([h]) => h === 'rebind.attacker.example')).toHaveLength(1);
    // Virtual hosting still works: Host header carries the original authority.
    expect(conn.options.headers.host).toBe('rebind.attacker.example:8080');
    expect(conn.options.path).toBe('/path?q=1');
    expect(Buffer.from(res.bodyBase64, 'base64').toString()).toBe('public');
    expect(res.url).toBe('http://rebind.attacker.example:8080/path?q=1');
  });

  it('pins the validated IPv6 address the same way', async () => {
    setDns('rebind6.attacker.example', { aaaa: [['2606:4700:4700::1111'], ['::1']] });
    await fetchForPlugin('http://rebind6.attacker.example/');
    expect(fake.connections).toHaveLength(1);
    expect(fake.connections[0].remoteAddress).toBe('2606:4700:4700::1111');
    expect(fake.connections[0].options.hostname).toBe('2606:4700:4700::1111');
  });

  it('over HTTPS, pins the IP while verifying TLS against the original hostname (SNI)', async () => {
    setDns('api.example', { a: [[PUBLIC_B], ['10.0.0.1']] });
    await fetchForPlugin('https://api.example/v1/data');

    expect(fake.connections).toHaveLength(1);
    const [conn] = fake.connections;
    expect(conn.transport).toBe('https');
    expect(conn.remoteAddress).toBe(PUBLIC_B);
    expect(conn.options.hostname).toBe(PUBLIC_B);
    expect(conn.options.servername).toBe('api.example');
    expect(conn.options.headers.host).toBe('api.example');
    // Certificate verification is not weakened to make IP pinning work.
    expect(conn.options.rejectUnauthorized).not.toBe(false);
  });

  it('a plugin-supplied Host header cannot redirect the request to another virtual host', async () => {
    setDns('api.example', { a: [PUBLIC_B] });
    await fetchForPlugin('http://api.example/', { headers: [['Host', 'localhost'], ['X-Ok', '1']] });
    expect(fake.connections[0].options.headers.host).toBe('api.example');
    expect(fake.connections[0].options.headers['x-ok']).toBe('1');
  });

  it('rejects header values carrying CRLF (request smuggling) before connecting', async () => {
    setDns('api.example', { a: [PUBLIC_B] });
    await expect(
      fetchForPlugin('http://api.example/', { headers: [['X-Test', 'a\r\nHost: 127.0.0.1']] })
    ).rejects.toThrow(/NetworkError/);
    expect(fake.connections).toHaveLength(0);
  });

  it('aborts if the socket ends up connected to a private address (post-connect check)', async () => {
    setDns('api.example', { a: [PUBLIC_A] });
    fake.substituteRemote = () => '10.0.0.7';
    await expect(fetchForPlugin('http://api.example/')).rejects.toThrow(/SecurityError/);
    // The connection was torn down before any response was delivered to the plugin.
    expect(fake.connections.every((c) => !c.responded)).toBe(true);
  });

  it('aborts if the socket ends up connected to a public address other than the validated one', async () => {
    setDns('api.example', { a: [PUBLIC_A] });
    fake.substituteRemote = () => PUBLIC_C;
    await expect(fetchForPlugin('http://api.example/')).rejects.toThrow(/SecurityError/);
    expect(fake.connections.every((c) => !c.responded)).toBe(true);
  });
});

describe('fetchForPlugin: redirects are revalidated on every hop', () => {
  function redirectFrom(fromAddress: string, status: number, location: string) {
    return (conn: Connection): Reply =>
      conn.remoteAddress === fromAddress
        ? { status, headers: { Location: location } }
        : { status: 200, body: Buffer.from(`reached ${conn.remoteAddress}`) };
  }

  it.each([
    [302, 'http://127.0.0.1/admin'],
    [301, 'http://127.0.0.1:2375/containers/json'],
    [303, 'http://169.254.169.254/latest/meta-data/'],
    [307, 'http://[::1]:8080/'],
    [308, 'http://[::ffff:127.0.0.1]/'],
    [302, 'http://0x7f000001/'],
    [302, 'https://10.1.2.3/']
  ])('refuses a %i redirect from a public host to %s', async (status, location) => {
    setDns('public.example', { a: [PUBLIC_A] });
    fake.server = redirectFrom(PUBLIC_A, status, location);
    await expect(fetchForPlugin('https://public.example/start')).rejects.toThrow(/SecurityError/);
    expect(fake.connections.map((c) => c.remoteAddress)).toEqual([PUBLIC_A]);
  });

  it('refuses a redirect to a hostname that resolves to a private address', async () => {
    setDns('public.example', { a: [PUBLIC_A] });
    setDns('intranet.attacker.example', { a: ['10.20.30.40'] });
    fake.server = redirectFrom(PUBLIC_A, 302, 'http://intranet.attacker.example/secret');
    await expect(fetchForPlugin('https://public.example/')).rejects.toThrow(/SecurityError/);
    expect(fake.connections.map((c) => c.remoteAddress)).toEqual([PUBLIC_A]);
    expect(resolverCallsFor('intranet.attacker.example')).toBeGreaterThan(0);
  });

  it('refuses a redirect to a hostname with a mixed public/private answer', async () => {
    setDns('public.example', { a: [PUBLIC_A] });
    setDns('mixed.attacker.example', { a: [PUBLIC_B], aaaa: ['fe80::1'] });
    fake.server = redirectFrom(PUBLIC_A, 307, 'https://mixed.attacker.example/');
    await expect(fetchForPlugin('https://public.example/')).rejects.toThrow(/SecurityError/);
    expect(fake.connections.map((c) => c.remoteAddress)).toEqual([PUBLIC_A]);
  });

  it('re-resolves on each hop, so a same-host relative redirect cannot ride a stale validation', async () => {
    // First resolution public, second (for the redirect hop) loopback.
    setDns('rebind.attacker.example', { a: [[PUBLIC_A], ['127.0.0.1']] });
    fake.server = redirectFrom(PUBLIC_A, 302, '/next');
    await expect(fetchForPlugin('http://rebind.attacker.example/')).rejects.toThrow(/SecurityError/);
    expect(fake.connections.map((c) => c.remoteAddress)).toEqual([PUBLIC_A]);
    expect(fake.resolve4.mock.calls.filter(([h]) => h === 'rebind.attacker.example')).toHaveLength(2);
  });

  it.each([
    'file:///etc/passwd',
    'ftp://public2.example/',
    'http://user:pw@public2.example/',
    'javascript:alert(1)'
  ])('refuses a redirect to a disallowed URL %s', async (location) => {
    setDns('public.example', { a: [PUBLIC_A] });
    setDns('public2.example', { a: [PUBLIC_B] });
    fake.server = redirectFrom(PUBLIC_A, 302, location);
    await expect(fetchForPlugin('https://public.example/')).rejects.toThrow(/SecurityError/);
    expect(fake.connections.map((c) => c.remoteAddress)).toEqual([PUBLIC_A]);
  });

  it('follows a public-to-public redirect, pinning each hop to its own validated address', async () => {
    setDns('public.example', { a: [[PUBLIC_A], ['127.0.0.1']] });
    setDns('cdn.example', { a: [[PUBLIC_B], ['127.0.0.1']] });
    fake.server = redirectFrom(PUBLIC_A, 302, 'https://cdn.example/asset.bin');

    const res = await fetchForPlugin('https://public.example/download');

    expect(fake.connections.map((c) => [c.remoteAddress, c.options.hostname, c.options.servername])).toEqual([
      [PUBLIC_A, PUBLIC_A, 'public.example'],
      [PUBLIC_B, PUBLIC_B, 'cdn.example']
    ]);
    expect(res.status).toBe(200);
    expect(res.url).toBe('https://cdn.example/asset.bin');
    expect(Buffer.from(res.bodyBase64, 'base64').toString()).toBe(`reached ${PUBLIC_B}`);
  });

  it('strips Authorization and Cookie on cross-origin redirects but keeps them same-origin', async () => {
    setDns('public.example', { a: [PUBLIC_A] });
    setDns('other.example', { a: [PUBLIC_B] });
    let hop = 0;
    fake.server = () => {
      hop += 1;
      if (hop === 1) return { status: 302, headers: { Location: '/same-origin' } };
      if (hop === 2) return { status: 302, headers: { Location: 'https://other.example/x' } };
      return { status: 200 };
    };
    await fetchForPlugin('https://public.example/', {
      headers: [['Authorization', 'Bearer token'], ['Cookie', 'sid=1'], ['X-Trace', 't']]
    });

    expect(fake.connections).toHaveLength(3);
    const [first, sameOrigin, crossOrigin] = fake.connections.map((c) => c.options.headers);
    expect(first.authorization).toBe('Bearer token');
    expect(sameOrigin.authorization).toBe('Bearer token');
    expect(sameOrigin.cookie).toBe('sid=1');
    expect(crossOrigin.authorization).toBeUndefined();
    expect(crossOrigin.cookie).toBeUndefined();
    expect(crossOrigin['x-trace']).toBe('t');
  });

  it('strips credentials when a redirect downgrades https to http on the same host', async () => {
    setDns('public.example', { a: [PUBLIC_A] });
    let hop = 0;
    fake.server = () => (++hop === 1 ? { status: 302, headers: { Location: 'http://public.example/' } } : { status: 200 });
    await fetchForPlugin('https://public.example/', { headers: [['authorization', 'Bearer token']] });
    expect(fake.connections).toHaveLength(2);
    expect(fake.connections[1].transport).toBe('http');
    expect(fake.connections[1].options.headers.authorization).toBeUndefined();
  });

  it.each(['http://[', 'http://a b/', 'http://[::1'])(
    'rejects an unparsable redirect Location %j instead of hanging',
    async (location) => {
      setDns('public.example', { a: [PUBLIC_A] });
      fake.server = redirectFrom(PUBLIC_A, 302, location);
      const outcome = await Promise.race([
        fetchForPlugin('https://public.example/').then(() => 'resolved', (err: Error) => err.message),
        new Promise((r) => setTimeout(() => r('hung'), 1000)),
      ]);
      expect(outcome).toMatch(/invalid redirect location/);
    }
  );

  it('caps redirect chains', async () => {
    setDns('loop.example', { a: [PUBLIC_A] });
    let n = 0;
    fake.server = () => ({ status: 302, headers: { Location: `/hop${++n}` } });
    await expect(fetchForPlugin('http://loop.example/')).rejects.toThrow(/redirects/);
    expect(fake.connections.length).toBeLessThanOrEqual(6);
  });

  it('redirect: "error" refuses to follow; redirect: "manual" returns the 3xx without touching the target', async () => {
    setDns('public.example', { a: [PUBLIC_A] });
    fake.server = redirectFrom(PUBLIC_A, 302, 'http://127.0.0.1/admin');

    await expect(fetchForPlugin('https://public.example/', { redirect: 'error' })).rejects.toThrow(/redirect/);
    expect(fake.connections.map((c) => c.remoteAddress)).toEqual([PUBLIC_A]);

    fake.connections.length = 0;
    const res = await fetchForPlugin('https://public.example/', { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(fake.connections.map((c) => c.remoteAddress)).toEqual([PUBLIC_A]);
  });
});

describe('fetchForPlugin: resource limits', () => {
  const MIB = 1024 * 1024;

  it('rejects a response body larger than 1 MiB', async () => {
    setDns('big.example', { a: [PUBLIC_A] });
    fake.server = () => ({ status: 200, body: Buffer.alloc(MIB + 1, 0x61) });
    await expect(fetchForPlugin('https://big.example/')).rejects.toThrow(/exceeds/);
  });

  it('accepts a response body of exactly 1 MiB', async () => {
    setDns('big.example', { a: [PUBLIC_A] });
    fake.server = () => ({ status: 200, body: Buffer.alloc(MIB, 0x61) });
    const res = await fetchForPlugin('https://big.example/');
    expect(Buffer.from(res.bodyBase64, 'base64').byteLength).toBe(MIB);
  });

  it('aborts a request whose server never answers within the 30s timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    setDns('slow.example', { a: [PUBLIC_A] });
    fake.server = () => ({ hang: true });

    const pending = fetchForPlugin('https://slow.example/');
    const outcome = pending.then(
      () => 'resolved',
      (err: Error) => err.message
    );
    for (let i = 0; i < 100 && fake.connections.length === 0; i++) {
      await new Promise((r) => setImmediate(r));
    }
    expect(fake.connections).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await outcome).toMatch(/timed out/);
  });

  it('enforces a total deadline on a server that trickles one byte at a time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    setDns('trickle.example', { a: [PUBLIC_A] });
    fake.server = () => ({ status: 200, trickle: { bytes: 1000, intervalMs: 20_000 } });

    const outcome = fetchForPlugin('https://trickle.example/').then(
      () => 'resolved',
      (err: Error) => err.message
    );
    for (let i = 0; i < 100 && fake.connections.length === 0; i++) {
      await new Promise((r) => setImmediate(r));
    }
    expect(fake.connections).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(await outcome).toMatch(/in total/);
  });
});
