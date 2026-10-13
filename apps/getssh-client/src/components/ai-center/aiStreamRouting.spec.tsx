// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiRequest, StreamPayload } from '../../services/aiBridge';
import { useAppLockStore } from '../../store/appLockStore';
import { useAiChatStore } from '../../store/aiChatStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { AppLockState } from '../../types/ipc';

vi.mock('../../services/contextService', () => ({ ContextService: {
  getTerminalSessionContext: () => ({ activeSession: null, allSessions: [] }),
  getActiveTerminalSnapshot: () => null,
  sendCommandToTerminal: vi.fn(),
} }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback, i18n: { language: 'en-US' } }) }));
vi.mock('../common/MarkdownRenderer', () => ({ MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div> }));

import { useAiConversation } from './useAiConversation';
import { CommandCenterAiChat } from '../command-center/CommandCenterAiChat';

type Approval = { streamRequestId: string; requestId: string; command: string };
const ready: AppLockState = { phase: 'ready', appProtected: false, presenceSupported: false, presenceEnabled: false, recoveryConfigured: false, deviceKeyLost: false, masterPasswordMustChange: false };
const sessions: any[] = [];
let root: Root;
let container: HTMLDivElement;
let flow!: ReturnType<typeof useAiConversation>;
let channels: Map<string, Set<(payload: StreamPayload) => void>>;
let approvals: Set<(payload: Approval) => void>;
let frames: Map<number, FrameRequestCallback>;
let invoke: ReturnType<typeof vi.fn>;
let saveMessage: ReturnType<typeof vi.fn>;
let clock: number;
function ConversationHarness() { flow = useAiConversation(''); return null; }

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  useAiChatStore.getState().flushChunks();
  useWorkspaceStore.setState({ activeWorkspaceId: 'default', isSwitching: false });
  useAppLockStore.setState({ state: ready });
  channels = new Map(); approvals = new Set(); frames = new Map();
  let frameId = 0;
  clock = 10;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  invoke = vi.fn(async (_request: AiRequest) => ({ success: true }));
  saveMessage = vi.fn(async () => ({ success: true }));
  // Keep the real AiBridge. This bus models preload's requestId-keyed IPC channels rather
  // than calling one saved component callback (which would conceal request ID collisions).
  window.electronAPI = { ai: {
    invokePrivileged: invoke,
    onStreamChunk: (requestId: string, callback: (payload: StreamPayload) => void) => {
      const channel = `ai-stream-chunk-${requestId}`;
      let listeners = channels.get(channel);
      if (!listeners) { listeners = new Set(); channels.set(channel, listeners); }
      listeners.add(callback);
      return () => listeners!.delete(callback);
    },
    onAgentApprovalRequest: (callback: (payload: Approval) => void) => { approvals.add(callback); return () => approvals.delete(callback); },
    saveMessage,
    listSessions: vi.fn(async () => ({ success: true, sessions: [{ id: 'chat', title: 'Chat', created_at: 1, updated_at: 1 }], next: null })),
    getMessages: vi.fn(async () => ({ success: true, messages: [], before: null })),
  } } as unknown as Window['electronAPI'];
  useAiChatStore.setState({ activeConversationId: 'chat', conversations: [{
    id: 'chat', title: 'Chat', createdAt: 1, updatedAt: 1, messagesLoaded: true, messages: [
      { id: 'question', role: 'user', content: 'question', timestamp: 1 },
      { id: 'live', role: 'assistant', content: '', isThinking: false, timestamp: 2 },
    ],
  }] });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { useAiChatStore.getState().flushChunks(); root.unmount(); });
  container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const chunk = (requestId: string, payload: StreamPayload) => {
  for (const listener of [...(channels.get(`ai-stream-chunk-${requestId}`) ?? [])]) listener(payload);
};
const approval = (payload: Approval) => { for (const listener of [...approvals]) listener(payload); };
const paint = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(16)); };
const message = (id: string) => useAiChatStore.getState().conversations.find(conv => conv.id === 'chat')!.messages.find(msg => msg.id === id)!;

describe('real AiBridge stream routing', () => {
  it.each(['conversation', 'command center'] as const)('separates old chunks, completion and approvals after lock/unlock retry in %s', async entry => {
    await act(async () => root.render(entry === 'conversation' ? <ConversationHarness /> : <CommandCenterAiChat onClose={() => {}} onConnect={() => {}} isDark sessions={sessions} />));
    const generate = () => entry === 'conversation'
      ? flow.handleRetry('live', 'question')
      : Promise.resolve(window.dispatchEvent(new CustomEvent('command-center:ai-submit', { detail: 'question' })));
    await act(async () => { await generate(); });
    const oldRequestId = invoke.mock.calls[0][0].requestId as string;
    const oldMessageId = entry === 'conversation' ? 'live' : 'ai-10';
    await act(async () => { chunk(oldRequestId, { chunk: 'old partial', isDone: false }); paint(); });
    expect(message(oldMessageId).content).toBe('old partial');

    await act(async () => useAppLockStore.setState({ state: { ...ready, phase: 'locked' } }));
    await act(async () => useAppLockStore.setState({ state: ready }));
    clock = 20;
    await act(async () => { await generate(); });
    expect(invoke).toHaveBeenCalledTimes(2);
    const newRequestId = invoke.mock.calls[1][0].requestId as string;
    const newMessageId = entry === 'conversation' ? 'live' : 'ai-20';
    expect(message(newMessageId).id).toBe(newMessageId);
    expect(message(newMessageId).content).toBe('');
    await act(async () => { chunk(newRequestId, { chunk: 'new reply', isDone: false }); paint(); });
    saveMessage.mockClear();

    await act(async () => {
      chunk(oldRequestId, { chunk: 'stale token', isDone: false });
      approval({ streamRequestId: oldRequestId, requestId: 'stale-approval', command: 'old command' });
      chunk(oldRequestId, { chunk: 'stale tail', isDone: true });
      paint();
    });
    expect(message(newMessageId)).toMatchObject({ content: 'new reply', isStreaming: true, isThinking: false });
    expect(message(newMessageId).approvalRequest).toBeUndefined();
    expect(oldRequestId).not.toBe(oldMessageId);
    expect(newRequestId).not.toBe(oldRequestId);
    expect(newRequestId).not.toBe(newMessageId);
    expect(saveMessage).not.toHaveBeenCalled();
    expect(channels.get(`ai-stream-chunk-${oldRequestId}`)?.size).toBe(0);
    expect(channels.get(`ai-stream-chunk-${newRequestId}`)?.size).toBe(1);
    if (entry === 'conversation') {
      expect(flow.isGenerating).toBe(true);
      await act(async () => approval({ streamRequestId: newRequestId, requestId: 'current-approval', command: 'new command' }));
      expect(message(newMessageId).approvalRequest).toMatchObject({ requestId: 'current-approval', command: 'new command' });
    }

    await act(async () => chunk(newRequestId, { chunk: ' tail', isDone: true }));
    expect(message(newMessageId)).toMatchObject({ id: newMessageId, content: 'new reply tail', isStreaming: false });
    expect(saveMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: newMessageId, content: 'new reply tail' }));
    expect(channels.get(`ai-stream-chunk-${newRequestId}`)?.size).toBe(0);
    if (entry === 'conversation') expect(flow.isGenerating).toBe(false);
  });
});
