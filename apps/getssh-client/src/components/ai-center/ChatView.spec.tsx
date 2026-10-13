// @vitest-environment jsdom
import { act, Profiler, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiBridge } from '../../services/aiBridge';
import { useAiChatStore, type ChatMessage, type Conversation } from '../../store/aiChatStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

const mocks = vi.hoisted(() => ({ profile: vi.fn(), parse: vi.fn(), scroll: vi.fn(), chatRender: vi.fn() }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => { mocks.chatRender(); return true; },
  motion: { div: ({ children, className, 'data-message-id': id }: any) => <Profiler id={id} onRender={mocks.profile}><div data-message-id={id} className={className}>{children}</div></Profiler> },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback, i18n: { language: 'zh-CN' } }) }));
vi.mock('../common/MarkdownRenderer', () => ({ MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div> }));
vi.mock('../common/ThoughtProcessBlock', async importOriginal => {
  const original = await importOriginal<typeof import('../common/ThoughtProcessBlock')>();
  return { ...original, parseThoughtProcess: (content: string) => { mocks.parse(content); return original.parseThoughtProcess(content); } };
});
vi.mock('./ApprovalCard', () => ({ ApprovalCard: () => <div>Approval</div> }));
vi.mock('./shared', () => ({ ThinkingIndicator: () => <span>Thinking</span>, StreamCursor: () => <span>Streaming</span> }));

import { ChatView } from './ChatView';

const message = (index: number, role: ChatMessage['role'] = 'assistant'): ChatMessage => ({ id: `m${index}`, role, content: `message ${index}`, timestamp: index });
const conversation = (messages: ChatMessage[], olderMessages?: string | null): Conversation => ({ id: 'chat', title: 'Chat', createdAt: 1, updatedAt: 1, messagesLoaded: true, olderMessages, messages });
let root: Root;
let container: HTMLDivElement;
let frames: FrameRequestCallback[];
const onPaperPlane = vi.fn();
const onRetry = vi.fn();
const onServerSelect = vi.fn();
const originalLoadOlder = useAiChatStore.getState().loadOlderMessages;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  useAiChatStore.getState().flushChunks();
  useWorkspaceStore.setState({ activeWorkspaceId: 'default', isSwitching: false });
  vi.spyOn(AiBridge, 'saveMessage').mockResolvedValue(true);
  vi.spyOn(AiBridge, 'getMessages').mockResolvedValue({ messages: [], before: null });
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames[id - 1] = () => {}; });
  HTMLElement.prototype.scrollIntoView = mocks.scroll;
  mocks.profile.mockClear(); mocks.parse.mockClear(); mocks.scroll.mockClear(); mocks.chatRender.mockClear();
  onPaperPlane.mockClear(); onRetry.mockClear(); onServerSelect.mockClear();
  useAiChatStore.setState({ activeConversationId: 'chat', conversations: [conversation(Array.from({ length: 200 }, (_, index) => message(index)))] });
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { useAiChatStore.getState().flushChunks(); root.unmount(); });
  useAiChatStore.setState({ loadOlderMessages: originalLoadOlder });
  container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const render = () => act(async () => root.render(<ChatView onPaperPlane={onPaperPlane} onRetry={onRetry} onServerSelect={onServerSelect} />));
const paint = () => act(async () => { const callbacks = frames; frames = []; callbacks.forEach(callback => callback(16)); });
const geometry = (scroll: HTMLDivElement, height = (_message: HTMLElement) => 20) => {
  const rows = () => Array.from(scroll.querySelectorAll<HTMLElement>('[data-message-id]'));
  const header = () => scroll.querySelector('button')?.textContent?.includes('更早') || scroll.querySelector('button')?.textContent?.includes('加载') ? 40 : 0;
  Object.defineProperty(scroll, 'scrollHeight', { configurable: true, get: () => rows().reduce((sum, row) => sum + height(row), header()) });
  Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 100 });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this === scroll ? 0 : header() + rows().slice(0, rows().indexOf(this)).reduce((sum, row) => sum + height(row), 0) - scroll.scrollTop;
    const size = this === scroll ? 100 : height(this);
    return { top, bottom: top + size, left: 0, right: 100, width: 100, height: size, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
};

describe('chat render work', () => {
  it('profiles 200 messages and only commits/parses the live reply during a token batch', async () => {
    await render();
    expect(mocks.profile).toHaveBeenCalledTimes(200);
    expect(mocks.parse).toHaveBeenCalledTimes(200);
    mocks.profile.mockClear(); mocks.parse.mockClear(); mocks.chatRender.mockClear();
    await act(async () => {
      for (let index = 0; index < 200; index++) useAiChatStore.getState().appendChunk('chat', 'm199', ' token');
    });
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.chatRender).not.toHaveBeenCalled();
    await paint();
    expect(mocks.profile.mock.calls.map(call => call[0])).toEqual(['m199']);
    expect(mocks.parse).toHaveBeenCalledTimes(1);
    expect(mocks.chatRender).toHaveBeenCalledTimes(1);
    mocks.profile.mockClear(); mocks.parse.mockClear(); mocks.chatRender.mockClear();
    await act(async () => useAiChatStore.getState().updateMessage('chat', 'm199', { isStreaming: false, isThinking: false }));
    expect(mocks.profile.mock.calls.map(call => call[0])).toEqual(['m199']);
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.chatRender).toHaveBeenCalledTimes(1);
  });

  it('does not subscribe to another conversation or lose the nearest user text for retry', async () => {
    useAiChatStore.setState({ conversations: [conversation([message(0, 'user'), message(1), message(2, 'user'), message(3)]), { ...conversation([message(4)]), id: 'other' }] });
    await render();
    mocks.profile.mockClear(); mocks.parse.mockClear(); mocks.chatRender.mockClear();
    await act(async () => useAiChatStore.getState().appendChunk('other', 'm4', ' token'));
    await paint();
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.parse).not.toHaveBeenCalled();
    expect(mocks.chatRender).not.toHaveBeenCalled();
    await act(async () => container.querySelectorAll<HTMLButtonElement>('button')[1].click());
    expect(onRetry).toHaveBeenCalledWith('m3', 'message 2');
  });

  it('does not render ChatView for conversation metadata, even when its parent subscribes to the conversation list', async () => {
    function Parent() {
      useAiChatStore(state => state.conversations);
      return <ChatView onPaperPlane={onPaperPlane} onRetry={onRetry} onServerSelect={onServerSelect} />;
    }
    await act(async () => root.render(<Parent />));
    mocks.chatRender.mockClear(); mocks.profile.mockClear();
    await act(async () => useAiChatStore.setState(state => ({ conversations: state.conversations.map(conv => ({ ...conv, title: 'Renamed', updatedAt: 2 })) })));
    expect(mocks.chatRender).not.toHaveBeenCalled();
    expect(mocks.profile).not.toHaveBeenCalled();
  });
});

describe('earlier message pages', () => {
  it.each([false, true])('follows a new user question after loading earlier history (batched assistant: %s)', async batchedAssistant => {
    useAiChatStore.setState({ conversations: [conversation([message(2, 'user'), message(3)], 'older')] });
    vi.mocked(AiBridge.getMessages).mockResolvedValueOnce({ messages: [message(0, 'user'), message(1)], before: null });
    await render();
    const scroll = container.querySelector<HTMLDivElement>('[data-testid="ai-chat-scroll"]')!;
    Object.defineProperty(scroll, 'scrollHeight', { configurable: true, get: () => scroll.querySelectorAll('[data-message-id]').length * 20 });
    scroll.scrollTop = 10;
    mocks.scroll.mockClear();
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
    expect(container.querySelectorAll('[data-message-id]')).toHaveLength(4);
    expect(mocks.scroll).not.toHaveBeenCalled();
    await act(async () => {
      useAiChatStore.getState().addMessage('chat', message(4, 'user'));
      if (batchedAssistant) useAiChatStore.getState().addMessage('chat', { ...message(5), content: '', isThinking: true });
    });
    expect(mocks.scroll).toHaveBeenCalledExactlyOnceWith({ behavior: 'auto' });
    if (batchedAssistant) {
      mocks.scroll.mockClear();
      await act(async () => useAiChatStore.getState().appendChunk('chat', 'm5', 'reply'));
      await paint();
      expect(mocks.scroll).toHaveBeenCalledExactlyOnceWith({ behavior: 'auto' });
    }
  });

  it('loads a 450-message conversation in two pages while preserving the scroll anchor', async () => {
    const messages = Array.from({ length: 450 }, (_, index) => message(index, 'user'));
    useAiChatStore.setState({ conversations: [conversation(messages.slice(250), '250')] });
    vi.mocked(AiBridge.getMessages).mockResolvedValueOnce({ messages: messages.slice(50, 250), before: '50' }).mockResolvedValueOnce({ messages: messages.slice(0, 50), before: null });
    await render();
    const scroll = container.querySelector<HTMLDivElement>('[data-testid="ai-chat-scroll"]')!;
    geometry(scroll);
    scroll.scrollTop = 120;
    const initialHeight = scroll.scrollHeight;
    mocks.scroll.mockClear();
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
    expect(container.querySelectorAll('[data-message-id]')).toHaveLength(400);
    expect(scroll.scrollTop).toBe(120 + scroll.scrollHeight - initialHeight);
    const secondTop = scroll.scrollTop;
    const secondHeight = scroll.scrollHeight;
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
    expect(container.querySelectorAll('[data-message-id]')).toHaveLength(450);
    expect(scroll.scrollTop).toBe(secondTop + scroll.scrollHeight - secondHeight);
    expect(mocks.scroll).not.toHaveBeenCalled();
    expect(AiBridge.getMessages).toHaveBeenNthCalledWith(1, 'chat', '250');
    expect(AiBridge.getMessages).toHaveBeenNthCalledWith(2, 'chat', '50');
    expect(container.querySelector('button')).toBeNull();
  });

  it('follows a new question and completed reply while an earlier page is still pending', async () => {
    useAiChatStore.setState({ conversations: [conversation([message(2, 'user'), message(3)], 'older')] });
    let resolvePage!: (value: { messages: ChatMessage[]; before: null }) => void;
    vi.mocked(AiBridge.getMessages).mockReturnValueOnce(new Promise(resolve => { resolvePage = resolve; }));
    await render();
    const scroll = container.querySelector<HTMLDivElement>('[data-testid="ai-chat-scroll"]')!;
    geometry(scroll); scroll.scrollTop = 10;
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
    mocks.scroll.mockClear();
    await act(async () => {
      useAiChatStore.getState().addMessage('chat', message(4, 'user'));
      useAiChatStore.getState().addMessage('chat', { ...message(5), content: 'completed answer', isStreaming: false });
    });
    expect(mocks.scroll).toHaveBeenCalledExactlyOnceWith({ behavior: 'auto' });
    mocks.scroll.mockClear();
    await act(async () => resolvePage({ messages: [message(0, 'user'), message(1)], before: null }));
    expect(mocks.scroll).toHaveBeenCalledExactlyOnceWith({ behavior: 'auto' });
  });

  it('restores the visible message in the prepend layout commit, excluding streamed tail growth while loading', async () => {
    const messages = Array.from({ length: 10 }, (_, index) => message(index, index === 9 ? 'assistant' : 'user'));
    useAiChatStore.setState({ conversations: [conversation(messages.slice(3), '3')] });
    let resolvePage!: (value: { messages: ChatMessage[]; before: string }) => void;
    let settleLoad!: () => void;
    vi.mocked(AiBridge.getMessages).mockReturnValueOnce(new Promise(resolve => { resolvePage = resolve; }));
    const pending = new Promise<void>(resolve => { settleLoad = resolve; });
    useAiChatStore.setState({ loadOlderMessages: async id => { const loaded = await originalLoadOlder(id); await pending; return loaded; } });
    const insertionCommits: { top: number; offset: number; loading: boolean }[] = [];
    function CommitProbe() {
      const currentMessages = useAiChatStore(state => state.conversations.find(conv => conv.id === 'chat')!.messages);
      useLayoutEffect(() => {
        if (currentMessages[0].id !== 'm0') return;
        const scroll = container.querySelector<HTMLDivElement>('[data-testid="ai-chat-scroll"]')!;
        insertionCommits.push({ top: scroll.scrollTop, offset: scroll.querySelector<HTMLElement>('[data-message-id="m5"]')!.getBoundingClientRect().top, loading: container.querySelector<HTMLButtonElement>('button')!.disabled });
      }, [currentMessages]);
      return null;
    }
    await act(async () => root.render(<><ChatView onPaperPlane={onPaperPlane} onRetry={onRetry} onServerSelect={onServerSelect} /><CommitProbe /></>));
    const scroll = container.querySelector<HTMLDivElement>('[data-testid="ai-chat-scroll"]')!;
    geometry(scroll, row => row.dataset.messageId === 'm9' && row.textContent?.includes('large tail') ? 220 : 20);
    scroll.scrollTop = 85;
    const before = scroll.querySelector<HTMLElement>('[data-message-id="m5"]')!.getBoundingClientRect().top;
    mocks.scroll.mockClear();
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
    await act(async () => useAiChatStore.getState().appendChunk('chat', 'm9', 'large tail'));
    await paint();
    expect(scroll.scrollTop).toBe(85);
    await act(async () => resolvePage({ messages: messages.slice(0, 3), before: '0' }));
    expect(insertionCommits).toEqual([{ top: 145, offset: before, loading: true }]);
    expect(scroll.scrollTop).toBe(145);
    await act(async () => settleLoad());
    expect(scroll.scrollTop).toBe(145);
    expect(mocks.scroll).not.toHaveBeenCalled();
  });

  it('does not offer pagination for an undefined cursor on a new chat', async () => {
    useAiChatStore.setState({ conversations: [conversation([message(1, 'user')])] });
    await render();
    expect(container.querySelector('button')).toBeNull();
  });

  it('keeps the latest visible message when the user scrolls while an earlier page is loading', async () => {
    const messages = Array.from({ length: 20 }, (_, index) => message(index, 'user'));
    useAiChatStore.setState({ conversations: [conversation(messages.slice(3), '3')] });
    let resolvePage!: (value: { messages: ChatMessage[]; before: string }) => void;
    vi.mocked(AiBridge.getMessages).mockReturnValueOnce(new Promise(resolve => { resolvePage = resolve; }));
    await render();
    const scroll = container.querySelector<HTMLDivElement>('[data-testid="ai-chat-scroll"]')!;
    geometry(scroll); scroll.scrollTop = 85;
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
    await act(async () => { scroll.scrollTop = 125; scroll.dispatchEvent(new Event('scroll')); });
    const before = scroll.querySelector<HTMLElement>('[data-message-id="m7"]')!.getBoundingClientRect().top;
    await act(async () => resolvePage({ messages: messages.slice(0, 3), before: '0' }));
    expect(scroll.scrollTop).toBe(185);
    expect(scroll.querySelector<HTMLElement>('[data-message-id="m7"]')!.getBoundingClientRect().top).toBe(before);
  });

  it('keeps a failed page available for retry and prevents concurrent duplicate clicks', async () => {
    useAiChatStore.setState({ conversations: [conversation([message(1, 'user')], 'older')] });
    let resolve!: (value: null) => void;
    vi.mocked(AiBridge.getMessages).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    await render();
    const button = container.querySelector<HTMLButtonElement>('button')!;
    await act(async () => { button.click(); button.click(); });
    expect(button.disabled).toBe(true);
    expect(AiBridge.getMessages).toHaveBeenCalledTimes(1);
    await act(async () => resolve(null));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('请重试');
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(AiBridge.getMessages).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
