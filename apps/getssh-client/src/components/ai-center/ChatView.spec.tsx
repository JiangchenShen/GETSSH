// @vitest-environment jsdom
import { act, Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiBridge } from '../../services/aiBridge';
import { useAiChatStore, type ChatMessage, type Conversation } from '../../store/aiChatStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

const mocks = vi.hoisted(() => ({ profile: vi.fn(), parse: vi.fn(), scroll: vi.fn() }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => true,
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
  mocks.profile.mockClear(); mocks.parse.mockClear(); mocks.scroll.mockClear();
  onPaperPlane.mockClear(); onRetry.mockClear(); onServerSelect.mockClear();
  useAiChatStore.setState({ activeConversationId: 'chat', conversations: [conversation(Array.from({ length: 200 }, (_, index) => message(index)))] });
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { useAiChatStore.getState().flushChunks(); root.unmount(); });
  container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const render = () => act(async () => root.render(<ChatView onPaperPlane={onPaperPlane} onRetry={onRetry} onServerSelect={onServerSelect} />));
const paint = () => act(async () => { const callbacks = frames; frames = []; callbacks.forEach(callback => callback(16)); });

describe('chat render work', () => {
  it('profiles 200 messages and only commits/parses the live reply during a token batch', async () => {
    await render();
    expect(mocks.profile).toHaveBeenCalledTimes(200);
    expect(mocks.parse).toHaveBeenCalledTimes(200);
    mocks.profile.mockClear(); mocks.parse.mockClear();
    await act(async () => {
      for (let index = 0; index < 200; index++) useAiChatStore.getState().appendChunk('chat', 'm199', ' token');
    });
    expect(mocks.profile).not.toHaveBeenCalled();
    await paint();
    expect(mocks.profile.mock.calls.map(call => call[0])).toEqual(['m199']);
    expect(mocks.parse).toHaveBeenCalledTimes(1);
    mocks.profile.mockClear(); mocks.parse.mockClear();
    await act(async () => useAiChatStore.getState().updateMessage('chat', 'm199', { isStreaming: false, isThinking: false }));
    expect(mocks.profile.mock.calls.map(call => call[0])).toEqual(['m199']);
    expect(mocks.parse).not.toHaveBeenCalled();
  });

  it('does not subscribe to another conversation or lose the nearest user text for retry', async () => {
    useAiChatStore.setState({ conversations: [conversation([message(0, 'user'), message(1), message(2, 'user'), message(3)]), { ...conversation([message(4)]), id: 'other' }] });
    await render();
    mocks.profile.mockClear(); mocks.parse.mockClear();
    await act(async () => useAiChatStore.getState().appendChunk('other', 'm4', ' token'));
    await paint();
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.parse).not.toHaveBeenCalled();
    await act(async () => container.querySelectorAll<HTMLButtonElement>('button')[1].click());
    expect(onRetry).toHaveBeenCalledWith('m3', 'message 2');
  });
});

describe('earlier message pages', () => {
  it('loads a 450-message conversation in two pages while preserving the scroll anchor', async () => {
    const messages = Array.from({ length: 450 }, (_, index) => message(index, 'user'));
    useAiChatStore.setState({ conversations: [conversation(messages.slice(250), '250')] });
    vi.mocked(AiBridge.getMessages).mockResolvedValueOnce({ messages: messages.slice(50, 250), before: '50' }).mockResolvedValueOnce({ messages: messages.slice(0, 50), before: null });
    await render();
    const scroll = container.querySelector<HTMLDivElement>('[data-testid="ai-chat-scroll"]')!;
    Object.defineProperty(scroll, 'scrollHeight', { configurable: true, get: () => scroll.querySelectorAll('[data-message-id]').length * 20 + (scroll.querySelector('button') ? 40 : 0) });
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 100 });
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

  it('does not offer pagination for an undefined cursor on a new chat', async () => {
    useAiChatStore.setState({ conversations: [conversation([message(1, 'user')])] });
    await render();
    expect(container.querySelector('button')).toBeNull();
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
