import type { IpcMain } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// What the chat channel hands to the model layer: the context limit from AI settings is for the
// context only, and an empty model is left to the adapter's own default.

const llm = vi.hoisted(() => ({ streamLLM: vi.fn(), fetchAvailableModels: vi.fn(async () => []) }));
const agent = vi.hoisted(() => ({ runAgentLoop: vi.fn() }));

vi.mock('electron', () => ({}));
vi.mock('../security/appSecrets', () => ({ getAiApiKey: vi.fn(() => 'test-key-fixture'), setAiApiKey: vi.fn(), deleteAiApiKey: vi.fn() }));
vi.mock('../services/llmService', () => llm);
vi.mock('../services/AgentEngine', () => ({ AgentEngine: agent }));
vi.mock('../services/MicroContextAssembler', () => ({ MicroContextAssembler: { assemble: vi.fn(() => 'context') } }));
vi.mock('../services/chatStorageManager', () => ({ ChatStorageManager: { getCurrentWorkspaceId: () => null } }));
vi.mock('../services/LocalMemoryService', () => ({ LocalMemoryService: { search: vi.fn(() => []) }, formatLocalMemoryContext: vi.fn(() => '') }));
vi.mock('../services/SearchEngine', () => ({ SearchEngine: {} }));
vi.mock('../services/OceanSentinel', () => ({ OceanSentinel: { sanitize: (text: string) => ({ cleanText: text }), isAvailable: () => true, getLoadError: () => null } }));

import { registerAiHandlers } from './aiHandler';

type Handler = (event: unknown, ...args: unknown[]) => Promise<any>;
const handlers = new Map<string, Handler>();
registerAiHandlers(
  { handle: (channel: string, run: Handler) => handlers.set(channel, run), on: vi.fn(), removeListener: vi.fn() } as unknown as IpcMain,
  () => ({ webContents: { id: 1 } }) as any,
);

const MAIN = { sender: { id: 1, isDestroyed: () => false, send: vi.fn(), once: vi.fn() }, senderFrame: { parent: null } };
const invoke = (payload: Record<string, unknown>) => handlers.get('ai-privileged-invoke')!(MAIN, { requestId: 'req-1', prompt: 'df -h', ...payload });

beforeEach(() => { vi.clearAllMocks(); });

describe('ai-privileged-invoke', () => {
  it.each(['readonly', 'assistant'])('in %s mode sends no output limit and leaves an empty model to the adapter', async mode => {
    await invoke({ mode, provider: 'qwen', model: '', aiMaxTokens: 200000 });
    expect(llm.streamLLM).toHaveBeenCalledTimes(1);
    const [, apiKey, provider, model, , , , , , options] = llm.streamLLM.mock.calls[0] as unknown[];
    expect(provider).toBe('qwen');
    expect(apiKey).toBe('test-key-fixture');
    expect(model).toBe('');
    expect(options).toEqual({ thinkingEffort: 'medium' });
  });

  it('passes the chosen model and effort through', async () => {
    await invoke({ mode: 'readonly', provider: 'minimax', model: 'MiniMax-M3.1-Flash', thinkingEffort: 'low', aiMaxTokens: 2000000 });
    const call = llm.streamLLM.mock.calls[0] as unknown[];
    expect(call[3]).toBe('MiniMax-M3.1-Flash');
    expect(call[9]).toEqual({ thinkingEffort: 'low' });
  });

  it('still gives the agent the context limit, for assembling context', async () => {
    await invoke({ mode: 'agent_semi', provider: 'qwen', model: 'qwen3.8-max', aiMaxTokens: 120000 });
    expect(llm.streamLLM).not.toHaveBeenCalled();
    expect(agent.runAgentLoop).toHaveBeenCalledTimes(1);
    const call = agent.runAgentLoop.mock.calls[0] as unknown[];
    expect(call[3]).toBe('qwen3.8-max');
    expect(call[10]).toBe(120000);
  });
});
