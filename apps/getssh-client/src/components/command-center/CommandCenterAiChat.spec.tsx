// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiBridge, type StreamPayload } from '../../services/aiBridge';
import { useAiChatStore } from '../../store/aiChatStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useAppLockStore } from '../../store/appLockStore';
import type { AppLockState } from '../../types/ipc';

const mocks = vi.hoisted(() => ({ parse: vi.fn(), markdown: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback, i18n: { language: 'en-US' } }) }));
vi.mock('../common/MarkdownRenderer', () => ({ MarkdownRenderer: ({ content }: { content: string }) => { mocks.markdown(content); return <div>{content}</div>; } }));
vi.mock('../common/ThoughtProcessBlock', async importOriginal => {
  const original = await importOriginal<typeof import('../common/ThoughtProcessBlock')>();
  return { ...original, parseThoughtProcess: (content: string) => { mocks.parse(content); return original.parseThoughtProcess(content); } };
});

import { CommandCenterAiChat } from './CommandCenterAiChat';

const ready: AppLockState = { phase: 'ready', appProtected: false, presenceSupported: false, presenceEnabled: false, recoveryConfigured: false, deviceKeyLost: false, masterPasswordMustChange: false };
let root: Root;
let container: HTMLDivElement;
let frames: FrameRequestCallback[];
let emit!: (payload: StreamPayload) => void;
let finish!: () => void;
const sessions: any[] = [];
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  useAiChatStore.getState().flushChunks();
  useWorkspaceStore.setState({ activeWorkspaceId: 'default', isSwitching: false });
  useAppLockStore.setState({ state: ready });
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames[id - 1] = () => {}; });
  vi.spyOn(AiBridge, 'saveMessage').mockResolvedValue(true);
  vi.spyOn(AiBridge, 'invokePrivileged').mockImplementation(async (_request, callback) => {
    emit = callback!; await new Promise<void>(resolve => { finish = resolve; }); return { success: true };
  });
  useAiChatStore.setState({ activeConversationId: 'chat', conversations: [{ id: 'chat', title: 'Chat', createdAt: 1, updatedAt: 1, messages: Array.from({ length: 200 }, (_, index) => ({ id: `m${index}`, role: 'assistant' as const, content: `history ${index}`, timestamp: index })) }] });
  mocks.parse.mockClear(); mocks.markdown.mockClear();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(async () => { await act(async () => { useAiChatStore.getState().flushChunks(); root.unmount(); }); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const render = () => act(async () => root.render(<CommandCenterAiChat onClose={() => {}} onConnect={() => {}} isDark sessions={sessions} />));
const submit = () => act(async () => { window.dispatchEvent(new CustomEvent('command-center:ai-submit', { detail: 'question' })); });

describe('Command Center shared streaming path', () => {
  it('only parses the current reply after a batched token frame, and saves the unpainted tail on done', async () => {
    await render();
    expect(mocks.parse).toHaveBeenCalledTimes(200);
    await submit();
    mocks.parse.mockClear(); mocks.markdown.mockClear();
    vi.mocked(AiBridge.saveMessage).mockClear();
    await act(async () => { for (let index = 0; index < 50; index++) emit({ chunk: 'token ', isDone: false }); });
    expect(mocks.parse).not.toHaveBeenCalled();
    await act(async () => { const callbacks = frames; frames = []; callbacks.forEach(callback => callback(16)); });
    expect(mocks.parse).toHaveBeenCalledTimes(1);
    expect(mocks.markdown).toHaveBeenCalledTimes(1);
    await act(async () => { emit({ chunk: 'tail', isDone: true }); finish(); });
    expect(AiBridge.saveMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ content: 'token '.repeat(50) + 'tail' }));
  });

  it('ignores late tokens after switching away and back to a workspace', async () => {
    await render(); await submit();
    await act(async () => emit({ chunk: 'partial', isDone: false }));
    await act(async () => {
      useWorkspaceStore.setState({ isSwitching: true });
      useWorkspaceStore.setState({ activeWorkspaceId: 'other' });
      useWorkspaceStore.setState({ activeWorkspaceId: 'default', isSwitching: false });
    });
    vi.mocked(AiBridge.saveMessage).mockClear();
    await act(async () => { emit({ chunk: 'late wrong workspace', isDone: true }); finish(); });
    expect(useAiChatStore.getState().conversations).toEqual([]);
    expect(AiBridge.saveMessage).not.toHaveBeenCalled();
  });
});
