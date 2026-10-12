// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiBridge } from '../services/aiBridge';
import { useAppLockStore } from './appLockStore';
import { useAiChatStore, type Conversation } from './aiChatStore';
import { useWorkspaceStore } from './workspaceStore';
import type { AppLockState } from '../types/ipc';

const ready: AppLockState = { phase: 'ready', appProtected: false, presenceSupported: false, presenceEnabled: false, recoveryConfigured: false, deviceKeyLost: false, masterPasswordMustChange: false };
const conversation = (): Conversation => ({ id: 'c1', title: 'Chat', createdAt: 1, updatedAt: 1, messagesLoaded: true, olderMessages: 'older', messages: [
  { id: 'history', role: 'user', content: 'question', timestamp: 1 },
  { id: 'live', role: 'assistant', content: '', isThinking: true, isStreaming: false, timestamp: 2 },
] });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
let frames: Map<number, FrameRequestCallback>;
let save: ReturnType<typeof vi.spyOn>;
let pages: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  useAiChatStore.getState().flushChunks();
  useWorkspaceStore.setState({ activeWorkspaceId: 'default', isSwitching: false });
  useAppLockStore.setState({ state: ready });
  frames = new Map();
  let frameId = 0;
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
  save = vi.spyOn(AiBridge, 'saveMessage').mockResolvedValue(true);
  pages = vi.spyOn(AiBridge, 'getMessages').mockResolvedValue({ messages: [], before: null });
  vi.spyOn(AiBridge, 'deleteSession').mockResolvedValue(true);
  useAiChatStore.setState({ conversations: [conversation()], activeConversationId: 'c1' });
});
afterEach(() => {
  useAiChatStore.getState().flushChunks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const current = () => useAiChatStore.getState().conversations.find(conv => conv.id === 'c1')!;
const message = () => current().messages.find(msg => msg.id === 'live')!;
const paint = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(16)); };

describe('stream text batches', () => {
  it('merges all tokens in one frame into one store notification while retaining historical message objects', () => {
    const history = current().messages[0];
    const changed = vi.fn();
    const unsubscribe = useAiChatStore.subscribe(changed);
    try {
      for (let token = 0; token < 200; token++) useAiChatStore.getState().appendChunk('c1', 'live', String(token) + ' ');
      expect(changed).not.toHaveBeenCalled();
      expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
      paint();
      expect(changed).toHaveBeenCalledTimes(1);
      expect(message().content).toBe(Array.from({ length: 200 }, (_, i) => `${i} `).join(''));
      expect(message()).toMatchObject({ isThinking: false, isStreaming: true });
      expect(current().messages[0]).toBe(history);
      expect(save).not.toHaveBeenCalled();
    } finally { unsubscribe(); }
  });

  it('folds the final unpainted token into completion and persistence, and never restarts streaming on the cancelled frame', () => {
    const changed = vi.fn();
    const unsubscribe = useAiChatStore.subscribe(changed);
    try {
      useAiChatStore.getState().appendChunk('c1', 'live', 'first');
      useAiChatStore.getState().appendChunk('c1', 'live', '-tail');
      useAiChatStore.getState().updateMessage('c1', 'live', { isThinking: false, isStreaming: false });
      expect(changed).toHaveBeenCalledTimes(1);
      expect(message()).toMatchObject({ content: 'first-tail', isStreaming: false });
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 'live', content: 'first-tail' }));
      paint();
      expect(changed).toHaveBeenCalledTimes(1);
      expect(message().isStreaming).toBe(false);
    } finally { unsubscribe(); }
  });

  it('drops buffered text on retry/error replacement and preserves new tokens in order', () => {
    useAiChatStore.getState().appendChunk('c1', 'live', 'discarded old reply');
    useAiChatStore.getState().updateMessage('c1', 'live', { content: '', isThinking: true, isStreaming: false });
    useAiChatStore.getState().appendChunk('c1', 'live', 'new');
    useAiChatStore.getState().appendChunk('c1', 'live', ' reply');
    paint();
    expect(message().content).toBe('new reply');
    useAiChatStore.getState().appendChunk('c1', 'live', 'discarded suffix');
    useAiChatStore.getState().updateMessage('c1', 'live', { content: '[Error] failed', isStreaming: false, isThinking: false });
    paint();
    expect(message().content).toBe('[Error] failed');
  });

  it('flushes text for an approval update but does not persist an incomplete streaming reply', () => {
    useAiChatStore.getState().appendChunk('c1', 'live', 'awaiting approval');
    useAiChatStore.getState().updateMessage('c1', 'live', { approvalRequest: { command: 'pwd', requestId: 'approve', status: 'pending' } });
    expect(message()).toMatchObject({ content: 'awaiting approval', isThinking: false, isStreaming: true });
    expect(save).not.toHaveBeenCalled();
  });

  it('saves received partial text before the workspace changes, and cancels the old scheduled frame', () => {
    const savedIn: string[] = [];
    save.mockImplementation(async () => { savedIn.push(useWorkspaceStore.getState().activeWorkspaceId); return true; });
    useAiChatStore.getState().appendChunk('c1', 'live', 'partial before switch');
    useWorkspaceStore.setState({ isSwitching: true });
    expect(message()).toMatchObject({ content: 'partial before switch', isStreaming: false, isThinking: false });
    expect(savedIn).toEqual(['default']);
    useWorkspaceStore.setState({ activeWorkspaceId: 'other', isSwitching: false });
    useAiChatStore.setState({ conversations: [conversation()], activeConversationId: 'c1' });
    paint();
    expect(message().content).toBe('');
    expect(savedIn).toEqual(['default']);
  });

  it('drains received text without saving after app locking and cannot replay that frame after unlock', () => {
    useAiChatStore.getState().appendChunk('c1', 'live', 'partial before lock');
    useAppLockStore.setState({ state: { ...ready, phase: 'locked' } });
    expect(message()).toMatchObject({ content: 'partial before lock', isStreaming: false, isThinking: false });
    expect(save).not.toHaveBeenCalled();
    useAppLockStore.setState({ state: ready });
    useAiChatStore.setState({ conversations: [conversation()] });
    paint();
    expect(message().content).toBe('');
  });
});

describe('history page safeguards', () => {
  it('keeps live message objects when an older page overlaps them, and deduplicates a page', async () => {
    const live = message();
    pages.mockResolvedValue({ before: null, messages: [
      { id: 'old', role: 'user', content: 'older', timestamp: 0 },
      { id: 'old', role: 'user', content: 'duplicate', timestamp: 0 },
      { id: 'live', role: 'assistant', content: 'stale database snapshot', timestamp: 2 },
    ] });
    useAiChatStore.getState().appendChunk('c1', 'live', 'new reply');
    expect(await useAiChatStore.getState().loadOlderMessages('c1')).toBe(true);
    expect(current().messages.map(msg => msg.id)).toEqual(['old', 'history', 'live']);
    expect(message()).toBe(live);
    paint();
    expect(message().content).toBe('new reply');
  });

  it('does not issue duplicate requests, and keeps the cursor for retry after failure', async () => {
    const pending = deferred<{ messages: any[]; before: string | null } | null>();
    pages.mockReturnValueOnce(pending.promise);
    const first = useAiChatStore.getState().loadOlderMessages('c1');
    expect(await useAiChatStore.getState().loadOlderMessages('c1')).toBe(false);
    expect(pages).toHaveBeenCalledTimes(1);
    pending.resolve(null);
    expect(await first).toBe(false);
    expect(current().olderMessages).toBe('older');
    pages.mockResolvedValueOnce({ messages: [], before: null });
    expect(await useAiChatStore.getState().loadOlderMessages('c1')).toBe(true);
    expect(current().olderMessages).toBeNull();
  });

  it('rejects an unadvanced cursor and ignores undefined cursors on a new conversation', async () => {
    pages.mockResolvedValueOnce({ messages: [], before: 'older' });
    expect(await useAiChatStore.getState().loadOlderMessages('c1')).toBe(false);
    useAiChatStore.setState({ conversations: [{ ...conversation(), olderMessages: undefined }] });
    expect(await useAiChatStore.getState().loadOlderMessages('c1')).toBe(false);
    expect(pages).toHaveBeenCalledTimes(1);
  });

  it('discards pages that arrive after a workspace change, even when the new workspace uses the same conversation id', async () => {
    const pending = deferred<{ messages: any[]; before: string | null }>();
    pages.mockReturnValueOnce(pending.promise);
    const first = useAiChatStore.getState().loadOlderMessages('c1');
    useWorkspaceStore.setState({ activeWorkspaceId: 'other' });
    useAiChatStore.setState({ conversations: [conversation()], activeConversationId: 'c1' });
    pending.resolve({ messages: [{ id: 'wrong-workspace', role: 'user', content: 'old workspace', timestamp: 0 }], before: null });
    expect(await first).toBe(false);
    expect(current().messages.map(msg => msg.id)).toEqual(['history', 'live']);
  });
});
