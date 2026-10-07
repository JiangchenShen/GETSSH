// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  language: 'zh-CN',
  setPlugins: vi.fn(),
  selectConversation: vi.fn(),
  deleteConversation: vi.fn(),
  clearConversations: vi.fn(),
  newConversation: vi.fn(),
  appConfig: {} as Record<string, any>,
  updateConfig: vi.fn(),
  workspace: {} as any,
  setMainWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string) => ({
    'workspaceCenter.main': '主要',
    'workspaceCenter.setMainTooltip': '设为主要',
    'workspaceCenter.deleteTooltip': '删除工作区',
    'sidebar.defaultWorkspace': '默认工作区',
  } as Record<string, string>)[key] || key,
  i18n: { language: mocks.language },
}) }));
vi.mock('../store/pluginStore', () => {
  const state = {
    installedPlugins: [{ name: 'sample', displayName: 'Sample', version: '1.0' }],
    setPlugins: mocks.setPlugins,
    settingsSchemas: { sample: [{ id: 'token', label: 'Token', type: 'password' }] },
  };
  return { usePluginStore: (select?: (value: any) => any) => select ? select(state) : state };
});
vi.mock('../store/appStore', () => ({ useAppStore: (select: (state: any) => any) => select({ isDark: true, appConfig: mocks.appConfig, updateConfig: mocks.updateConfig }) }));
vi.mock('../store/aiStore', () => ({ useAiStore: (select: (state: any) => any) => select({ updateAiConfig: mocks.updateConfig }) }));
vi.mock('../store/workspaceStore', () => ({ useWorkspaceStore: Object.assign(
  (select: (state: any) => any) => select(mocks.workspace),
  { getState: () => mocks.workspace },
) }));
vi.mock('../store/aiChatStore', () => ({ useAiChatStore: (select: (state: any) => any) => select({
  conversations: [{ id: 'conversation', title: 'Server check', updatedAt: Date.now(), messages: [{ role: 'assistant', content: 'No errors' }] }],
  activeConversationId: 'conversation',
  setActiveConversation: mocks.selectConversation,
  deleteConversation: mocks.deleteConversation,
  clearAllConversations: mocks.clearConversations,
  newConversation: mocks.newConversation,
}) }));

import { PluginSettings } from './PluginSettings';
import { HistoryView } from './ai-center/HistoryView';
import { AiConfigurationSection } from './ai-center/AiConfigurationSection';
import { WorkspaceCenter } from './WorkspaceCenter';
import { MarkdownRenderer } from './common/MarkdownRenderer';

let root: Root;
let container: HTMLDivElement;
let storageSet: ReturnType<typeof vi.fn>;
let reloadPlugin: ReturnType<typeof vi.fn>;
let saveApiKey: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.language = 'zh-CN';
  mocks.appConfig = { aiEnabled: true, aiProvider: 'openai', aiModel: 'test-model', hasAiApiKey: true };
  mocks.updateConfig.mockImplementation((key: string, value: any) => { mocks.appConfig[key] = value; });
  mocks.workspace = {
    activeWorkspaceId: 'other',
    workspaces: [{ id: 'default', name: 'Default', isMain: false }, { id: 'other', name: 'Main workspace', isMain: true }],
    switchWorkspace: vi.fn(), setIsCreateModalOpen: vi.fn(),
    setMainWorkspace: mocks.setMainWorkspace, deleteWorkspace: mocks.deleteWorkspace,
  };
  mocks.setMainWorkspace.mockResolvedValue(true);
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  storageSet = vi.fn().mockResolvedValue({ success: true });
  reloadPlugin = vi.fn().mockResolvedValue({ success: true });
  saveApiKey = vi.fn().mockResolvedValue({ success: true });
  window.electronAPI = {
    getPluginsList: vi.fn().mockResolvedValue([]),
    pluginStorageGet: vi.fn().mockResolvedValue('saved-token'),
    pluginStorageSet: storageSet,
    reloadPlugin,
    ai: { saveApiKey, deleteApiKey: vi.fn().mockResolvedValue({ success: true }) },
  } as unknown as Window['electronAPI'];
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const button = (text: string) => Array.from(container.querySelectorAll('button')).find(item => item.textContent?.includes(text))!;
const click = async (element: HTMLElement) => act(async () => element.click());
const typeKey = async (value: string) => act(async () => {
  const input = container.querySelector<HTMLInputElement>('input[aria-label="API Key"]')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
const openPluginSettings = async () => {
  await act(async () => root.render(<PluginSettings />));
  await click(button('配置插件'));
};

describe('center controls', () => {
  it('keeps plugin edits visible and does not reload when storage reports failure', async () => {
    storageSet.mockResolvedValue({ success: false, error: 'storage_unavailable' });
    await openPluginSettings();
    await click(button('保存并重新加载插件'));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('storage_unavailable');
    expect(container.querySelector<HTMLInputElement>('input[type="password"]')?.value).toBe('saved-token');
    expect(reloadPlugin).not.toHaveBeenCalled();
  });

  it('keeps plugin edits visible when reload reports failure; closes only after success', async () => {
    reloadPlugin.mockResolvedValueOnce({ success: false, error: 'reload_failed' });
    await openPluginSettings();
    await click(button('保存并重新加载插件'));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('reload_failed');
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
    await click(button('保存并重新加载插件'));
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(reloadPlugin).toHaveBeenCalledTimes(2);
  });

  it('uses focusable native history controls with visible delete actions', async () => {
    await act(async () => root.render(<HistoryView />));
    const conversation = button('Server check');
    expect(conversation).toBeDefined();
    conversation.focus();
    expect(document.activeElement).toBe(conversation);
    await click(conversation);
    expect(mocks.selectConversation).toHaveBeenCalledWith('conversation');
    const remove = container.querySelector<HTMLButtonElement>('button[aria-label="删除对话：Server check"]')!;
    expect(remove).not.toBeNull();
    expect(remove.className).not.toContain('opacity-0');
    await click(remove);
    expect(mocks.deleteConversation).toHaveBeenCalledWith('conversation');
  });

  it('shows history actions and relative time in English', async () => {
    mocks.language = 'en-US';
    await act(async () => root.render(<HistoryView />));
    expect(button('New chat')).toBeDefined();
    expect(button('Clear all history')).toBeDefined();
    expect(container.textContent).toContain('now');
    expect(container.querySelector('button[aria-label="Delete conversation: Server check"]')).not.toBeNull();
  });

  it('allows entering a provider key even when a key has already been saved', async () => {
    await act(async () => root.render(<AiConfigurationSection tab="providers" />));
    const input = container.querySelector<HTMLInputElement>('input[aria-label="API Key"]')!;
    expect(input).not.toBeNull();
    expect(input.disabled).toBe(false);
    expect(input.readOnly).toBe(false);
    await typeKey('test-key-not-a-real-secret');
    expect(input.value).toBe('test-key-not-a-real-secret');
    expect(button('保存密钥').disabled).toBe(false);
    await act(async () => {
      const provider = container.querySelector<HTMLSelectElement>('#ai-provider')!;
      provider.value = 'gemini';
      provider.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(mocks.updateConfig).toHaveBeenCalledWith('aiProvider', 'gemini');
    expect(mocks.appConfig.hasAiApiKey).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[aria-label="API Key"]')?.value).toBe('');
    await typeKey('new-provider-test-key');
    expect(container.querySelector<HTMLInputElement>('input[aria-label="API Key"]')?.value).toBe('new-provider-test-key');
    expect(button('保存密钥').disabled).toBe(false);
    expect(saveApiKey).not.toHaveBeenCalled();
  });

  it('uses the actual main workspace flag while retaining default workspace protection', async () => {
    await act(async () => root.render(<WorkspaceCenter />));
    expect(Array.from(container.querySelectorAll('span')).filter(item => item.textContent === '主要')).toHaveLength(1);
    const makeMain = container.querySelector<HTMLButtonElement>('button[title="设为主要"]')!;
    expect(makeMain).not.toBeNull();
    expect(makeMain.disabled).toBe(false);
    expect(makeMain.parentElement?.textContent).toContain('默认工作区');
    expect(makeMain.parentElement?.querySelector('button[title="删除工作区"]')).toBeNull();
    const confirmation = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      await click(makeMain);
      expect(mocks.setMainWorkspace).toHaveBeenCalledExactlyOnceWith('default');
      expect(mocks.deleteWorkspace).not.toHaveBeenCalled();
    } finally { confirmation.mockRestore(); }
  });

  it.each([
    ['zh-CN', '注入目标终端', '复制代码'],
    ['en-US', 'Inject to terminal', 'Copy code'],
  ])('keeps accessible code controls visible in %s and delegates injection without IPC', async (language, injectLabel, copyLabel) => {
    mocks.language = language;
    const inject = vi.fn();
    const ipcAccess = vi.fn();
    window.electronAPI = new Proxy(window.electronAPI, {
      get(target, key, receiver) {
        ipcAccess(key);
        return Reflect.get(target, key, receiver);
      },
    });
    const code = `echo ${'x'.repeat(500)}\necho done`;
    await act(async () => root.render(<MarkdownRenderer content={`\`\`\`bash\n${code}\n\`\`\``} onPaperPlane={inject} />));
    const wrapper = container.querySelector<HTMLDivElement>('.not-prose')!;
    expect(wrapper).not.toBeNull();
    // This checks the overflow contract, not layout or scroll dimensions in jsdom.
    for (const className of ['min-w-0', 'max-w-full', 'overflow-x-auto']) {
      expect(wrapper.classList.contains(className)).toBe(true);
    }
    expect(wrapper.querySelector('code')?.textContent).toBe(code);
    const injectButton = wrapper.querySelector<HTMLButtonElement>(`button[aria-label="${injectLabel}"]`)!;
    const copyButton = wrapper.querySelector<HTMLButtonElement>(`button[aria-label="${copyLabel}"]`)!;
    expect(wrapper.querySelectorAll('button')).toHaveLength(2);
    for (const control of [injectButton, copyButton]) {
      expect(control).not.toBeNull();
      expect(control.type).toBe('button');
      expect(control.closest('.opacity-0')).toBeNull();
      control.focus();
      expect(document.activeElement).toBe(control);
    }
    await click(injectButton);
    expect(inject).toHaveBeenCalledExactlyOnceWith(code);
    expect(ipcAccess).not.toHaveBeenCalled();
  });

  it('preserves newlines in fenced code without a language', async () => {
    await act(async () => root.render(<MarkdownRenderer content={'```\nfirst line\nsecond line\n```'} />));
    const wrapper = container.querySelector<HTMLDivElement>('.not-prose')!;
    expect(wrapper).not.toBeNull();
    expect(wrapper.classList.contains('whitespace-pre-wrap')).toBe(true);
    expect(wrapper.querySelector('code')?.textContent).toBe('first line\nsecond line\n');
  });
});
