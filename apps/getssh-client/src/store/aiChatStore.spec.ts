// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAiChatStore } from './aiChatStore';

// The chat list is read a page at a time without messages; a chat's messages are read when it opens,
// and earlier ones on request.

const summary = (id: string, updated: number, preview: string | null = null) => ({ id, workspace_id: 'default', title: `Chat ${id}`, created_at: 1, updated_at: updated, message_count: 2, preview });
const row = (id: string, timestamp: number) => ({ id, session_id: 'c1', role: 'user', content: `${id} text`, raw_content: null, timestamp });

let listSessions: ReturnType<typeof vi.fn>;
let getMessages: ReturnType<typeof vi.fn>;

beforeEach(() => {
  listSessions = vi.fn()
    .mockResolvedValueOnce({ success: true, sessions: [summary('c1', 30, 'Disk is full'), summary('c2', 20)], next: 'p2' })
    .mockResolvedValueOnce({ success: true, sessions: [summary('c3', 10)], next: null });
  getMessages = vi.fn(async (_id: string, _limit: number, before: string | null) => before
    ? { success: true, messages: [row('m1', 1)], before: null }
    : { success: true, messages: [row('m2', 2), row('m3', 3)], before: 'older' });
  (window as any).electronAPI = { ai: { listSessions, getMessages, saveMessage: vi.fn().mockResolvedValue({ success: true }) } };
  useAiChatStore.setState({ conversations: [], activeConversationId: null, view: 'chat' });
});

const conv = (id: string) => useAiChatStore.getState().conversations.find(c => c.id === id)!;
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('aiChatStore pages', () => {
  it('lists every chat without messages and reads only the one that opens', async () => {
    await useAiChatStore.getState().loadWorkspaceChats();
    await settle();
    expect(listSessions.mock.calls.map(call => call[1])).toEqual([null, 'p2']);
    expect(useAiChatStore.getState().conversations.map(c => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(conv('c1')).toMatchObject({ preview: 'Disk is full', messagesLoaded: true, olderMessages: 'older' });
    expect(conv('c1').messages.map(m => m.id)).toEqual(['m2', 'm3']);
    expect(conv('c2')).toMatchObject({ messages: [], messagesLoaded: false });
    expect(getMessages).toHaveBeenCalledTimes(1);

    useAiChatStore.getState().setActiveConversation('c2');
    useAiChatStore.getState().setActiveConversation('c2');
    await settle();
    expect(getMessages).toHaveBeenCalledTimes(2);
    expect(getMessages).toHaveBeenLastCalledWith('c2', 200, null);
    useAiChatStore.getState().setActiveConversation('c2');
    await settle();
    expect(getMessages).toHaveBeenCalledTimes(2);
  });

  it('puts earlier messages before the loaded ones, and keeps what was added while reading', async () => {
    await useAiChatStore.getState().loadWorkspaceChats();
    await settle();
    useAiChatStore.getState().addMessage('c1', { id: 'new', role: 'user', content: 'hi', timestamp: 4 });
    await useAiChatStore.getState().loadOlderMessages('c1');
    expect(getMessages).toHaveBeenLastCalledWith('c1', 200, 'older');
    expect(conv('c1').messages.map(m => m.id)).toEqual(['m1', 'm2', 'm3', 'new']);
    expect(conv('c1').olderMessages).toBeNull();
    await useAiChatStore.getState().loadOlderMessages('c1');
    expect(getMessages).toHaveBeenCalledTimes(2);
  });

  it('keeps the messages of a chat already read when the list is read again', async () => {
    await useAiChatStore.getState().loadWorkspaceChats();
    await settle();
    listSessions.mockResolvedValueOnce({ success: true, sessions: [summary('c1', 40)], next: null });
    await useAiChatStore.getState().loadWorkspaceChats();
    await settle();
    expect(conv('c1').messages.map(m => m.id)).toEqual(['m2', 'm3']);
    expect(getMessages).toHaveBeenCalledTimes(1);
  });
});
