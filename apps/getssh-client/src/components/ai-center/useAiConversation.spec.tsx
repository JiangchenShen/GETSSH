// @vitest-environment jsdom
import { act, type FormEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiBridge, type StreamPayload } from '../../services/aiBridge';
import { useAppLockStore } from '../../store/appLockStore';
import { useAiChatStore, type ChatMessage } from '../../store/aiChatStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { AppLockState } from '../../types/ipc';

const mocks = vi.hoisted(() => ({ renders: vi.fn(), sessions: [] as { id: string; name: string }[] }));
vi.mock('../../services/contextService', () => ({ ContextService: {
  getTerminalSessionContext: () => ({ activeSession: null, allSessions: mocks.sessions }),
  getActiveTerminalSnapshot: () => null,
  sendCommandToTerminal: vi.fn(),
} }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => true,
  motion: { div: ({ children, 'data-message-id': id }: any) => { mocks.renders(id); return <div data-message-id={id}>{children}</div>; } },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback, i18n: { language: 'en-US' } }) }));
vi.mock('../common/MarkdownRenderer', () => ({ MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div> }));
vi.mock('./shared', () => ({ ThinkingIndicator: () => <span>Thinking</span>, StreamCursor: () => <span>Streaming</span> }));

import { useAiConversation } from './useAiConversation';
import { ChatView } from './ChatView';

const ready: AppLockState = { phase: 'ready', appProtected: false, presenceSupported: false, presenceEnabled: false, recoveryConfigured: false, deviceKeyLost: false, masterPasswordMustChange: false };
let root: Root;
let container: HTMLDivElement;
let flow!: ReturnType<typeof useAiConversation>;
let emit!: (payload: StreamPayload) => void;
function Harness({ target = '' }: { target?: string }) {
  flow = useAiConversation(target === 'select' ? undefined : target);
  return <ChatView onPaperPlane={flow.handlePaperPlane} onRetry={flow.handleRetry} onServerSelect={flow.handleServerSelect} />;
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  useAiChatStore.getState().flushChunks();
  useWorkspaceStore.setState({ activeWorkspaceId: 'default', isSwitching: false });
  useAppLockStore.setState({ state: ready });
  mocks.renders.mockClear(); mocks.sessions = [];
  vi.spyOn(Date, 'now').mockReturnValue(1000);
  vi.spyOn(AiBridge, 'listSessions').mockResolvedValue([]);
  vi.spyOn(AiBridge, 'saveMessage').mockResolvedValue(true);
  vi.spyOn(AiBridge, 'invokePrivileged').mockImplementation(async (_request, callback) => { emit = callback!; return { success: true }; });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const messages: ChatMessage[] = Array.from({ length: 200 }, (_, index) => ({ id: `m${index}`, role: index % 2 ? 'assistant' : 'user', content: `message ${index}`, timestamp: index }));
  useAiChatStore.setState({ activeConversationId: 'chat', conversations: [{ id: 'chat', title: 'Chat', createdAt: 1, updatedAt: 1, messagesLoaded: true, messages }] });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { useAiChatStore.getState().flushChunks(); root.unmount(); });
  container.remove(); vi.restoreAllMocks();
});
const handlers = () => [flow.handleSubmit, flow.handleRetry, flow.handleServerSelect, flow.handlePaperPlane] as const;
const submit = () => flow.handleSubmit({ preventDefault() {} } as FormEvent);

describe('conversation callbacks during generation', () => {
  it('keeps callbacks stable and leaves 200 earlier messages untouched through submit, completion and retry', async () => {
    await act(async () => root.render(<Harness />));
    const initial = handlers();
    expect(mocks.renders).toHaveBeenCalledTimes(200);
    mocks.renders.mockClear();
    await act(async () => flow.setPrompt('new question'));
    expect(handlers()).toEqual(initial);
    expect(mocks.renders).not.toHaveBeenCalled();
    await act(async () => { await submit(); });
    expect(flow.isGenerating).toBe(true);
    expect(handlers()).toEqual(initial);
    expect(mocks.renders.mock.calls.map(call => call[0])).toEqual(['user-1000', 'ai-1001']);
    mocks.renders.mockClear();
    await act(async () => { await flow.handleRetry('m199', 'message 198'); await submit(); });
    expect(AiBridge.invokePrivileged).toHaveBeenCalledTimes(1);
    await act(async () => emit({ chunk: 'answer', isDone: true }));
    expect(flow.isGenerating).toBe(false);
    expect(handlers()).toEqual(initial);
    expect(mocks.renders.mock.calls.map(call => call[0])).toEqual(['ai-1001']);
    mocks.renders.mockClear();
    // The ref blocks a second invocation in the same event, before React can render.
    await act(async () => { await initial[1]('ai-1001', 'new question'); await initial[1]('ai-1001', 'new question'); });
    expect(AiBridge.invokePrivileged).toHaveBeenCalledTimes(2);
    expect(flow.isGenerating).toBe(true);
    expect(handlers()).toEqual(initial);
    expect(mocks.renders.mock.calls.map(call => call[0])).toEqual(['ai-1001']);
    await act(async () => useAppLockStore.setState({ state: { ...ready, phase: 'locked' } }));
    expect(flow.isGenerating).toBe(false);
    expect(handlers()).toEqual(initial);
    await act(async () => useAppLockStore.setState({ state: ready }));
    await act(async () => { await flow.handleRetry('ai-1001', 'new question'); });
    expect(AiBridge.invokePrivileged).toHaveBeenCalledTimes(3);
    await act(async () => emit({ chunk: 'retried answer', isDone: true }));
  });

  it('keeps server selection stable and blocks duplicate selection until the stream completes', async () => {
    mocks.sessions = [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }];
    await act(async () => root.render(<Harness target="select" />));
    const initial = handlers();
    await act(async () => flow.setPrompt('choose a server'));
    await act(async () => { await submit(); });
    expect(flow.isGenerating).toBe(false);
    expect(AiBridge.invokePrivileged).not.toHaveBeenCalled();
    expect(handlers()).toEqual(initial);
    await act(async () => {
      await flow.handleServerSelect('ai-1001', 'one', 'One');
      await flow.handleServerSelect('ai-1001', 'two', 'Two');
    });
    expect(AiBridge.invokePrivileged).toHaveBeenCalledTimes(1);
    expect(flow.isGenerating).toBe(true);
    expect(handlers()).toEqual(initial);
    await act(async () => emit({ chunk: 'selected reply', isDone: true }));
    expect(flow.isGenerating).toBe(false);
    expect(handlers()).toEqual(initial);
  });
});
