// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalCard } from './ApprovalCard';
import { AiBridge } from '../../services/aiBridge';
import { useAiChatStore, type ChatMessage } from '../../store/aiChatStore';
import { useAppLockStore } from '../../store/appLockStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, fallback: string) => fallback, i18n: { language: 'zh-CN' } }) }));
let root: Root;
let container: HTMLDivElement;
const message = (status: 'pending' | 'approved' | 'rejected' = 'pending'): ChatMessage => ({ id: 'reply', role: 'assistant', content: 'Run pwd', timestamp: 1, isStreaming: true, approvalRequest: { requestId: 'approval', command: 'pwd', status } });
const ready = { phase: 'ready' as const, appProtected: true, presenceSupported: false, presenceEnabled: false, recoveryConfigured: false, deviceKeyLost: false, masterPasswordMustChange: false };
function Harness() { const msg = useAiChatStore(state => state.conversations[0].messages[0]); return <ApprovalCard msg={msg} activeConversationId="chat" />; }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  useAppLockStore.setState({ state: ready }); useWorkspaceStore.setState({ activeWorkspaceId: 'default', isSwitching: false });
  useAiChatStore.setState({ activeConversationId: 'chat', conversations: [{ id: 'chat', title: 'Chat', createdAt: 1, updatedAt: 1, messages: [message()] }] });
  vi.spyOn(AiBridge, 'saveMessage').mockResolvedValue(true);
  window.electronAPI = { ai: { approveAgentAction: vi.fn() } } as unknown as Window['electronAPI'];
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
const lock = () => act(async () => useAppLockStore.setState({ state: { ...ready, phase: 'locked' } }));

describe('command approvals after app locking', () => {
  it('expires approval before the workspace switch changes its ID and cannot approve after a failed switch', async () => {
    await act(async () => root.render(<Harness />));
    await act(async () => useWorkspaceStore.setState({ isSwitching: true }));
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('default');
    expect(window.electronAPI.ai.approveAgentAction).toHaveBeenCalledExactlyOnceWith('approval', false);
    expect(useAiChatStore.getState().conversations[0].messages[0]).toMatchObject({ isStreaming: false, approvalRequest: { status: 'expired' } });
    await act(async () => useWorkspaceStore.setState({ isSwitching: false }));
    expect(container.querySelector('button')).toBeNull(); expect(container.textContent).toContain('授权请求已过期');
    expect(window.electronAPI.ai.approveAgentAction).toHaveBeenCalledTimes(1);
  });
  it.each([true, false])('expires pending approvals, rejects them once, and cannot approve after unlocking (streaming: %s)', async streaming => {
    useAiChatStore.setState(state => ({ conversations: state.conversations.map(conv => ({ ...conv, messages: [{ ...message(), isStreaming: streaming }] })) }));
    await act(async () => root.render(<Harness />)); expect(container.textContent).toContain('允许执行');
    await lock();
    expect(useAiChatStore.getState().conversations[0].messages[0]).toMatchObject({ isStreaming: false, isThinking: false, approvalRequest: { status: 'expired' } });
    expect(window.electronAPI.ai.approveAgentAction).toHaveBeenCalledExactlyOnceWith('approval', false);
    expect(AiBridge.saveMessage).not.toHaveBeenCalled();
    await act(async () => useAppLockStore.setState({ state: ready }));
    expect(container.textContent).toContain('授权请求已过期'); expect(container.querySelector('button')).toBeNull();
    await lock(); expect(window.electronAPI.ai.approveAgentAction).toHaveBeenCalledTimes(1);
  });
  it('refuses a stale pending card whose store request already expired', async () => {
    const stale = message(); await lock();
    await act(async () => useAppLockStore.setState({ state: ready }));
    await act(async () => root.render(<ApprovalCard msg={stale} activeConversationId="chat" />));
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
    expect(window.electronAPI.ai.approveAgentAction).toHaveBeenCalledExactlyOnceWith('approval', false);
    expect(useAiChatStore.getState().conversations[0].messages[0].approvalRequest?.status).toBe('expired');
  });
  it.each(['approved', 'rejected'] as const)('leaves an already %s request alone', async status => {
    useAiChatStore.setState(state => ({ conversations: state.conversations.map(conv => ({ ...conv, messages: [message(status)] })) }));
    await lock(); expect(window.electronAPI.ai.approveAgentAction).not.toHaveBeenCalled();
    expect(useAiChatStore.getState().conversations[0].messages[0].approvalRequest?.status).toBe(status);
  });
});
