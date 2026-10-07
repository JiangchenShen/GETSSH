import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A command with a lot of output: the chat gets it in batches and at most 32 KB of it; the model
// gets the end.

const bridge = vi.hoisted(() => ({ value: null as any }));
vi.mock('../../SSHBridge', () => {
  const { EventEmitter: Emitter } = require('node:events');
  bridge.value = Object.assign(new Emitter(), { writeCommand: () => {} });
  return { sshBridge: bridge.value };
});
vi.mock('../../../security/SecureCenter', () => ({ SecureCenter: { getInstance: () => ({}) } }));

import { ExecuteTerminalTool } from './ExecuteTerminalTool';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function run(packets: string[], intervalMs: number) {
  const chunks: string[] = [];
  const result = new ExecuteTerminalTool().execute(
    { command: 'journalctl --no-pager' },
    { sessionId: 's1', mode: 'agent_full', aiMaxTokens: 4000, onChunk: (chunk: string) => chunks.push(chunk) } as any,
  );
  for (const packet of packets) {
    (bridge.value as EventEmitter).emit('data:s1', packet);
    await vi.advanceTimersByTimeAsync(intervalMs);
  }
  await vi.advanceTimersByTimeAsync(20_000);
  return { chunks, result: await result };
}

describe('execute_terminal output', () => {
  it('sends a flood of output to the chat in a few batches, at most 32 KB, then the closing fence', async () => {
    // 1 MB in 4 KB packets, one every 10 ms (within the 15 s window).
    const packets = [...Array.from({ length: 256 }, (_, i) => `${String(i).padStart(4, '0')}:${'x'.repeat(4091)}\n`), 'END-OF-OUTPUT\n'];
    const { chunks, result } = await run(packets, 10);
    const output = chunks.slice(chunks.findIndex(c => c.includes('[AGENT LIVE OUTPUT]')) + 1, -1);
    expect(output.length).toBeLessThan(15);
    expect(output.join('').length).toBeLessThan(33 * 1024);
    expect(output.join('')).toContain('完整内容在终端里');
    expect(chunks.at(-1)).toBe('\n```\n\n');
    // The model reads the end of the output, not the start.
    expect(result.promptFeed).toContain('END-OF-OUTPUT');
    expect(result.promptFeed).not.toContain('0000:');
  });

  it('batches packets that arrive within 100 ms', async () => {
    const { chunks } = await run(Array.from({ length: 20 }, (_, i) => `line ${i}\n`), 2);
    const output = chunks.slice(chunks.findIndex(c => c.includes('[AGENT LIVE OUTPUT]')) + 1, -1);
    expect(output).toEqual([Array.from({ length: 20 }, (_, i) => `line ${i}\n`).join('')]);
  });
});
