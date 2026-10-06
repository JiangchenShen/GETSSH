// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ILlmAdapter, LlmRequest, LlmResponse } from './types';

const storage = vi.hoisted(() => ({
  open: true,
  rows: new Map<string, string>(),
  read: vi.fn(),
  write: vi.fn(),
}));

// Keep the real Rust redaction module, but never open an app database or keychain.
vi.mock('electron', () => ({ app: undefined }));
vi.mock('../../utils/rustCorePath', async () => {
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const here = path.dirname(fileURLToPath(import.meta.url));
  return { getRustCorePath: (name: string) => path.resolve(here, '../../../../../../rust-core', name) };
});
vi.mock('../DatabaseManager', () => ({
  DatabaseManager: {
    isMainDbOpen: () => storage.open,
    getGlobalSetting: storage.read,
    setGlobalSetting: storage.write,
  },
}));
vi.mock('./ModelCapabilities', () => ({ ModelCaps: { learnFromError: () => null } }));

const response = (text = 'done'): LlmResponse => ({
  model: 'fixture-model', text, blocks: [{ kind: 'text', text }], toolCalls: [], stopReason: 'end_turn',
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  storage.open = true;
  storage.rows.clear();
  storage.read.mockImplementation((key: string) => storage.rows.get(key) ?? null);
  storage.write.mockImplementation((key: string, value: string) => { storage.rows.set(key, value); });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function setup() {
  const { OceanSentinel } = await import('../OceanSentinel');
  const { LlmGateway } = await import('./LlmGateway');
  expect(OceanSentinel.isAvailable()).toBe(true);
  expect(OceanSentinel.getLoadError()).toBeNull();
  const streamTurn = vi.fn<ILlmAdapter['streamTurn']>().mockResolvedValue(response());
  const gateway = LlmGateway.getInstance();
  gateway.registerAdapter({ provider: 'fixture', streamTurn, fetchModels: vi.fn().mockResolvedValue([]) });
  return { OceanSentinel, gateway, streamTurn };
}

describe('LlmGateway redaction metrics at the real egress boundary', () => {
  it('counts repeated replacements across all supported segments, excluding the local audit pass', async () => {
    const { OceanSentinel, gateway, streamTurn } = await setup();
    const request: LlmRequest = {
      apiKey: 'fixture-provider-key', model: 'fixture-model',
      prompt: 'ssh 10.2.3.4 then 10.2.3.4', context: '10.2.3.5',
      systemPrompt: 'DB_PASSWORD=verysecret123',
      history: [{ role: 'user', blocks: [
        { kind: 'text', text: '10.2.3.6 literal [IP_999]' },
        { kind: 'tool_result', callId: 'result-1', content: ['10.2.3.7', { kind: 'text', text: '10.2.3.8' }] },
        { kind: 'tool_call', callId: 'call-1', name: 'fixture',
          args: { command: 'ssh 10.2.3.9', nested: ['10.2.3.10', 12] }, raw: '{"host":"10.2.3.9"}' },
      ] }],
    };
    // aiHandler generates local audit evidence through these same static calls.
    OceanSentinel.sanitize(request.prompt!);
    OceanSentinel.sanitize(request.context!);
    expect(OceanSentinel.getRuntimeStatus().stats.runtimeHits).toBe(0);

    await gateway.streamTurn('fixture', request, {});
    const sent = streamTurn.mock.calls[0][0];
    const content = JSON.stringify([sent.prompt, sent.context, sent.systemPrompt, sent.history]);
    expect(content).not.toMatch(/10\.2\.3\./);
    expect(content).not.toContain('verysecret123');
    expect(content).toContain('[IP_999]');
    expect(sent.apiKey).toBe(request.apiKey);
    expect(OceanSentinel.getRuntimeStatus().stats).toMatchObject({ runtimeHits: 10, todayHits: 10, totalHits: 10 });
    const persisted = [...storage.rows.values()].join('');
    expect(persisted).not.toMatch(/10\.2\.3\.|verysecret123|fixture-provider-key|GETSSH_|mappingDict/);
  });

  it('reuses the prepared request on transport retry without recounting its replacements', async () => {
    vi.useFakeTimers();
    const { OceanSentinel, gateway, streamTurn } = await setup();
    const { LlmError } = await import('./types');
    streamTurn.mockRejectedValueOnce(new LlmError('fixture retry', { provider: 'fixture', retryable: true, retryAfterMs: 1 }));
    const pending = gateway.streamTurn('fixture', { apiKey: 'fixture-key', model: 'fixture-model', prompt: '10.8.7.6 10.8.7.6' }, {});
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(streamTurn).toHaveBeenCalledTimes(2);
    expect(streamTurn.mock.calls[1][0]).toBe(streamTurn.mock.calls[0][0]);
    expect(OceanSentinel.getRuntimeStatus().stats).toMatchObject({ runtimeHits: 2, todayHits: 2, totalHits: 2 });
  });

  it('fails before the adapter when a segment cannot be sanitized, without counting an invented match', async () => {
    const { OceanSentinel, gateway, streamTurn } = await setup();
    vi.spyOn(OceanSentinel, 'sanitize').mockImplementation(() => { throw new Error('fixture sanitizer failure'); });
    await expect(gateway.streamTurn('fixture', { apiKey: 'fixture-key', model: 'fixture-model', prompt: '10.8.7.6' }, {}))
      .rejects.toThrow('fixture sanitizer failure');
    expect(streamTurn).not.toHaveBeenCalled();
    expect(OceanSentinel.getRuntimeStatus().stats.runtimeHits).toBe(0);
  });

  it('keeps redaction active when numeric counter persistence fails', async () => {
    const { OceanSentinel, gateway, streamTurn } = await setup();
    storage.write.mockImplementation(() => { throw new Error('fixture database unavailable'); });
    await gateway.streamTurn('fixture', { apiKey: 'fixture-key', model: 'fixture-model', prompt: '10.8.7.6' }, {});
    expect(streamTurn).toHaveBeenCalledTimes(1);
    expect(streamTurn.mock.calls[0][0].prompt).not.toContain('10.8.7.6');
    expect(OceanSentinel.getRuntimeStatus()).toMatchObject({
      gateway: { mode: 'native', state: 'ready' }, stats: { runtimeHits: 1, persistence: 'unavailable' },
    });
  });
});
