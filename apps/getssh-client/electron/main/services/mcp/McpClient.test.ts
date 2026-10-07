import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The HTTP transport sends the server's headers (tokens) only to the server's own site.

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => process.cwd() } }));
vi.mock('../../security/WindowsProcessSandbox', () => ({ resolveWindowsSandboxLauncherPath: () => '' }));

import { isSameSite, McpClient } from './McpClient';

const TOKEN = 'Bearer mcp-secret';
const seen: Array<{ server: string; path: string; authorization?: string }> = [];

function listen(name: string, route: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      seen.push({ server: name, path: req.url || '', authorization: req.headers.authorization });
      route(req, res, body);
    });
  });
  return new Promise<{ server: http.Server; base: string }>(resolve =>
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })));
}

const answer = (res: http.ServerResponse, body: string) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(body).id, result: { ok: true } }));
};
const redirect = (res: http.ServerResponse, location: string) => {
  res.statusCode = 307;
  res.setHeader('Location', location);
  res.end();
};

let home: { server: http.Server; base: string };
let elsewhere: { server: http.Server; base: string };

beforeAll(async () => {
  elsewhere = await listen('elsewhere', (_req, res, body) => answer(res, body));
  home = await listen('home', (req, res, body) => {
    if (req.url === '/mcp') redirect(res, '/mcp/');
    else if (req.url === '/away') redirect(res, `${elsewhere.base}/mcp`);
    else if (req.url === '/loop') redirect(res, '/loop');
    else answer(res, body);
  });
});

afterAll(() => {
  home.server.close();
  elsewhere.server.close();
});

const request = (path: string) => {
  const client = new McpClient({ id: 'h', name: 'H', transport: 'http', enabled: true, url: `${home.base}${path}`, headers: { Authorization: TOKEN } });
  return (client as unknown as { sendHttpRequest: (method: string) => Promise<unknown> }).sendHttpRequest('ping');
};

describe('MCP HTTP redirects', () => {
  it('follows a redirect within the server\'s own site, with its headers', async () => {
    seen.length = 0;
    expect(await request('/mcp')).toEqual({ ok: true });
    expect(seen).toEqual([
      { server: 'home', path: '/mcp', authorization: TOKEN },
      { server: 'home', path: '/mcp/', authorization: TOKEN },
    ]);
  });

  it('refuses a redirect to another site and sends it nothing', async () => {
    seen.length = 0;
    await expect(request('/away')).rejects.toThrow(/not sent to another site/);
    expect(seen.map(entry => entry.server)).toEqual(['home']);
  });

  it('stops after five redirects', async () => {
    seen.length = 0;
    await expect(request('/loop')).rejects.toThrow(/too many times/);
    expect(seen).toHaveLength(6);
  });
});

describe('isSameSite', () => {
  const site = (from: string, to: string) => isSameSite(new URL(from), new URL(to));
  it('allows the same origin and an upgrade to https on the same host', () => {
    expect(site('https://mcp.example.com/a', 'https://mcp.example.com/b')).toBe(true);
    expect(site('http://mcp.example.com/a', 'https://mcp.example.com/a')).toBe(true);
  });
  it('refuses other hosts, ports and a downgrade to http', () => {
    expect(site('https://mcp.example.com/', 'https://evil.example/')).toBe(false);
    expect(site('https://mcp.example.com/', 'https://mcp.example.com:8443/')).toBe(false);
    expect(site('https://mcp.example.com/', 'http://mcp.example.com/')).toBe(false);
    expect(site('http://mcp.example.com/', 'https://api.mcp.example.com/')).toBe(false);
  });
});
