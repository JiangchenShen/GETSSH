import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchText } from './SearchEngine';
import { BaseAdapter, MAX_SSE_LINE } from './ai/BaseAdapter';

// One deadline for headers and body, and a size cap, against a local HTTP server.

let server: http.Server;
let base = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/ok') return res.end('{"results":[]}');
    if (req.url === '/huge') {
      res.writeHead(200);
      const chunk = Buffer.alloc(64 * 1024, 0x61);
      let sent = 0;
      const pump = () => {
        while (sent < 4 * 1024 * 1024) {
          sent += chunk.length;
          if (!res.write(chunk)) return void res.once('drain', pump);
        }
        res.end();
      };
      return pump();
    }
    if (req.url === '/trickle') {
      res.writeHead(200);
      const timer = setInterval(() => res.write('x'), 50);
      res.on('close', () => clearInterval(timer));
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe('fetchText', () => {
  it('reads a normal page', async () => {
    expect(await fetchText(`${base}/ok`, {}, 2000)).toEqual({ ok: true, status: 200, text: '{"results":[]}' });
  });

  it('refuses a body over 2 MB', async () => {
    await expect(fetchText(`${base}/huge`, {}, 5000)).rejects.toThrow(/2 MB/);
  });

  it('keeps the deadline while the body trickles in', async () => {
    const started = Date.now();
    await expect(fetchText(`${base}/trickle`, {}, 300)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

class SseProbe extends BaseAdapter {
  readonly provider = 'probe';
  async streamTurn(): Promise<never> { throw new Error('unused'); }
  async fetchModels(): Promise<string[]> { return []; }
  read(response: Response, onEvent: (event: string, data: string) => void) {
    return this.processSseStream(response, onEvent);
  }
}

const streamOf = (parts: string[]) => new Response(new ReadableStream({
  start(controller) {
    for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
    controller.close();
  },
}));

describe('processSseStream', () => {
  it('hands out events split across chunks', async () => {
    const events: string[] = [];
    await new SseProbe().read(streamOf(['data: {"a":', '1}\n\nevent: done\nda', 'ta: x\n\n']), (event, data) => events.push(`${event}:${data}`));
    expect(events).toEqual(['message:{"a":1}', 'done:x']);
  });

  it('refuses a line longer than 1 MB that never ends', async () => {
    const piece = 'y'.repeat(64 * 1024);
    const parts = ['data: ', ...Array.from({ length: Math.ceil(MAX_SSE_LINE / piece.length) + 2 }, () => piece)];
    await expect(new SseProbe().read(streamOf(parts), () => {})).rejects.toThrow(/1 MB/);
  });
});
