// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiBridge, type StreamPayload } from '../../services/aiBridge';
import { useAppLockStore } from '../../store/appLockStore';
import { useAiChatStore, type Conversation } from '../../store/aiChatStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { AppLockState } from '../../types/ipc';

vi.mock('../../services/contextService', () => ({ ContextService: {
  getTerminalSessionContext: () => ({ activeSession: null, allSessions: [] }),
  getActiveTerminalSnapshot: () => null,
  sendCommandToTerminal: vi.fn(),
} }));

import { useAiInteraction } from './useAiInteraction';
import { useAiConversation } from './useAiConversation';

const ready: AppLockState = { phase: 'ready', appProtected: false, presenceSupported: false, presenceEnabled: false, recoveryConfigured: false, deviceKeyLost: false, masterPasswordMustChange: false };
const conversation = (): Conversation => ({ id: 'chat', title: 'Chat', createdAt: 1, updatedAt: 1, messagesLoaded: true, messages: [{ id: 'live', role: 'assistant', content: '', isThinking: true, timestamp: 1 }] });
let latest!: ReturnType<typeof useAiInteraction>;
let conversationFlow!: ReturnType<typeof useAiConversation>;
let root: Root;
let container: HTMLDivElement;
let emit!: (payload: StreamPayload) => void;
let finish!: () => void;
let frames: FrameRequestCallback[];
function InteractionHarness() { const [, setGenerating] = useState(false); latest = useAiInteraction(setGenerating, ''); return null; }
function ConversationHarness() { conversationFlow = useAiConversation(''); return null; }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  useAiChatStore.getState().flushChunks();
  useWorkspaceStore.setState({ activeWorkspaceId: 'default', isSwitching: false });
  useAppLockStore.setState({ state: ready });
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames[id - 1] = () => {}; });
  vi.spyOn(AiBridge, 'saveMessage').mockResolvedValue(true);
  vi.spyOn(AiBridge, 'listSessions').mockResolvedValue([]);
  vi.spyOn(AiBridge, 'invokePrivileged').mockImplementation(async (_request, onChunk) => {
    emit = onChunk!;
    await new Promise<void>(resolve => { finish = resolve; });
    return { success: true };
  });
  useAiChatStore.setState({ conversations: [conversation()], activeConversationId: 'chat' });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { useAiChatStore.getState().flushChunks(); root.unmount(); });
  container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const live = () => useAiChatStore.getState().conversations[0].messages[0];

describe('AI flow identity and completion', () => {
  it('keeps paper-plane, retry and server-selection callbacks stable across prompt edits', async () => {
    await act(async () => root.render(<ConversationHarness />));
    const previous = conversationFlow;
    await act(async () => conversationFlow.setPrompt('changed prompt'));
    expect(conversationFlow.handlePaperPlane).toBe(previous.handlePaperPlane);
    expect(conversationFlow.handleRetry).toBe(previous.handleRetry);
    expect(conversationFlow.handleServerSelect).toBe(previous.handleServerSelect);
  });

  it('persists the final chunk when done arrives before a paint, and ignores later token callbacks', async () => {
    await act(async () => root.render(<InteractionHarness />));
    let request!: Promise<void>;
    await act(async () => { request = latest.generateResponse('chat', 'live', 'question'); });
    await act(async () => { emit({ chunk: 'first', isDone: false }); emit({ chunk: '-tail', isDone: true }); });
    expect(live()).toMatchObject({ content: 'first-tail', isStreaming: false, isThinking: false });
    expect(AiBridge.saveMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'live', content: 'first-tail' }));
    await act(async () => { emit({ chunk: 'late', isDone: false }); finish(); await request; });
    expect(live().content).toBe('first-tail');
  });

  it('invalidates an old stream on switching away and back, preserving its already received partial reply', async () => {
    await act(async () => root.render(<InteractionHarness />));
    let request!: Promise<void>;
    await act(async () => { request = latest.generateResponse('chat', 'live', 'question'); emit({ chunk: 'partial', isDone: false }); });
    await act(async () => useWorkspaceStore.setState({ isSwitching: true }));
    expect(live().content).toBe('partial');
    expect(AiBridge.saveMessage).toHaveBeenCalledWith(expect.objectContaining({ content: 'partial' }));
    await act(async () => {
      useWorkspaceStore.setState({ activeWorkspaceId: 'other' });
      useWorkspaceStore.setState({ activeWorkspaceId: 'default', isSwitching: false });
      useAiChatStore.setState({ conversations: [conversation()], activeConversationId: 'chat' });
      emit({ chunk: 'wrong old stream', isDone: true });
      finish(); await request;
    });
    expect(live().content).toBe('');
    expect(AiBridge.saveMessage).toHaveBeenCalledTimes(1);
  });

  it('invalidates an old stream over a lock/unlock round trip without saving while locked', async () => {
    await act(async () => root.render(<InteractionHarness />));
    let request!: Promise<void>;
    await act(async () => { request = latest.generateResponse('chat', 'live', 'question'); emit({ chunk: 'partial', isDone: false }); });
    await act(async () => useAppLockStore.setState({ state: { ...ready, phase: 'locked' } }));
    expect(live().content).toBe('partial');
    expect(AiBridge.saveMessage).not.toHaveBeenCalled();
    await act(async () => {
      useAppLockStore.setState({ state: ready });
      emit({ chunk: 'late after unlock', isDone: true });
      finish(); await request;
    });
    expect(live().content).toBe('partial');
    expect(AiBridge.saveMessage).not.toHaveBeenCalled();
  });
});
