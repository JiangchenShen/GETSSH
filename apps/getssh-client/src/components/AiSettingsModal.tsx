import React, { useEffect, useMemo, useState } from 'react';
import { Bot, Check, ClipboardPaste, Globe, History, MessageSquare, Plus, Send, Settings2, Trash2, X, BookOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/appStore';
import { useAiChatStore } from '../store/aiChatStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useSessionStore } from '../store/sessionStore';
import { ContextService } from '../services/contextService';
import { PERSONAS } from '../utils/persona';
import { ChatView } from './ai-center/ChatView';
import { HistoryView } from './ai-center/HistoryView';
import { useAiConversation } from './ai-center/useAiConversation';
import { ManagementHeader } from './ManagementSurface';
import { settingButtonClass, settingFieldClass } from './settings/SettingsControls';

export { AiConfigurationSection } from './ai-center/AiConfigurationSection';
export type { AiConfigurationTab } from './ai-center/AiConfigurationSection';

type CenterTab = 'chat' | 'history' | 'prompts' | 'agents';
type PromptDraft = { id: string; title: string; desc: string; content: string; isBuiltin?: boolean };

const navigation: { id: CenterTab; cn: string; en: string; icon: typeof MessageSquare }[] = [
  { id: 'chat', cn: '对话', en: 'Chat', icon: MessageSquare },
  { id: 'history', cn: '历史', en: 'History', icon: History },
  { id: 'prompts', cn: '提示词', en: 'Prompts', icon: BookOpen },
  { id: 'agents', cn: '智能体模式', en: 'Agent mode', icon: Bot },
];

const agentModes = [
  { id: 'readonly', cn: '只读问答', en: 'Read-only', cnDescription: '只回答问题，不读取终端或执行命令。', enDescription: 'Answers questions without reading the terminal or running commands.' },
  { id: 'assistant', cn: '感知助手', en: 'Context assistant', cnDescription: '可以读取活动终端上下文，不执行命令。', enDescription: 'Can read active terminal context but cannot run commands.' },
  { id: 'agent_semi', cn: '审批执行', en: 'Approval required', cnDescription: '可以提出命令，须经您批准后执行。', enDescription: 'Can propose commands, but runs them only after your approval.' },
  { id: 'agent_full', cn: '自动执行', en: 'Automatic execution', cnDescription: '可自主在服务器上执行命令；仅适用于完全信任的环境。', enDescription: 'Can run commands on servers autonomously; use only in fully trusted environments.' },
] as const;

export const AiSettingsModal: React.FC = () => {
  const { t, i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const copy = (cn: string, en: string) => zh ? cn : en;
  const appConfig = useAppStore(state => state.appConfig);
  const updateConfig = useAppStore(state => state.updateConfig);
  const conversations = useAiChatStore(state => state.conversations);
  const activeConversationId = useAiChatStore(state => state.activeConversationId);
  const newConversation = useAiChatStore(state => state.newConversation);
  const chatView = useAiChatStore(state => state.view);
  const setChatView = useAiChatStore(state => state.setView);
  const workspaces = useWorkspaceStore(state => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const workspaceName = workspaces.find(workspace => workspace.id === activeWorkspaceId)?.name || copy('当前工作区', 'Current workspace');
  const [activeTab, setActiveTab] = useState<CenterTab>('chat');
  const [draft, setDraft] = useState<PromptDraft | null>(null);
  const tabs = useSessionStore(state => state.tabs);
  const terminals = useMemo(() => ContextService.getTerminalSessionContext(true).allSessions, [tabs, activeWorkspaceId]);
  const [selectedTerminalId, setSelectedTerminalId] = useState('');
  const targetSessionId = terminals.some(terminal => terminal.id === selectedTerminalId) ? selectedTerminalId : '';
  const { prompt, setPrompt, isGenerating, handleSubmit, handleRetry, handleServerSelect, handlePaperPlane } = useAiConversation(targetSessionId);
  const activeConversation = conversations.find(conversation => conversation.id === activeConversationId);
  const ready = !!appConfig.aiEnabled && (appConfig.aiProvider === 'ollama' || !!appConfig.hasAiApiKey);
  const terminalSelection = useAppStore(state => state.currentTerminalSelection);

  useEffect(() => setSelectedTerminalId(''), [activeWorkspaceId]);

  useEffect(() => {
    if (activeTab === 'history' && chatView === 'chat') setActiveTab('chat');
  }, [chatView, activeTab]);

  const selectTab = (tab: CenterTab) => {
    setActiveTab(tab);
    if (tab === 'chat' || tab === 'history') setChatView(tab);
  };

  const openAiSettings = () => window.dispatchEvent(new CustomEvent('app:open-center', {
    detail: { type: 'settings', title: t('statusBar.settings'), settingsTab: 'AI' },
  }));

  const builtins: PromptDraft[] = [
    { id: 'linux', title: t('aiSettings.promptLinux', 'Linux 专家'), desc: t('aiSettings.promptLinuxDesc', '系统诊断与服务器配置'), content: appConfig.language === 'zh-CN' ? PERSONAS.linux.zh : PERSONAS.linux.en, isBuiltin: true },
    { id: 'log', title: t('aiSettings.promptLog', '日志分析'), desc: t('aiSettings.promptLogDesc', '查找异常与错误线索'), content: appConfig.language === 'zh-CN' ? PERSONAS.log.zh : PERSONAS.log.en, isBuiltin: true },
    { id: 'docker', title: t('aiSettings.promptDocker', 'Docker 专家'), desc: t('aiSettings.promptDockerDesc', '容器与编排配置'), content: appConfig.language === 'zh-CN' ? PERSONAS.docker.zh : PERSONAS.docker.en, isBuiltin: true },
    { id: 'security', title: t('aiSettings.promptSecurity', '安全审查'), desc: t('aiSettings.promptSecurityDesc', '审查配置与脚本风险'), content: appConfig.language === 'zh-CN' ? PERSONAS.security.zh : PERSONAS.security.en, isBuiltin: true },
  ];
  const allPrompts = [...builtins, ...(appConfig.customPrompts || []).map(item => ({ ...item, isBuiltin: false }))];

  const savePrompt = () => {
    if (!draft || !draft.title.trim() || !draft.content.trim() || draft.isBuiltin) return;
    const current = appConfig.customPrompts || [];
    const record = { id: draft.id, title: draft.title.trim(), desc: draft.desc.trim(), content: draft.content.trim() };
    updateConfig('customPrompts', current.some(item => item.id === draft.id)
      ? current.map(item => item.id === draft.id ? record : item)
      : [...current, record]);
    setDraft(null);
  };

  const deletePrompt = (id: string) => {
    if (!window.confirm(t('aiSettings.deletePersonaConfirm', '删除这个提示词？'))) return;
    updateConfig('customPrompts', (appConfig.customPrompts || []).filter(item => item.id !== id));
    if (appConfig.activePromptId === id) updateConfig('activePromptId', undefined);
  };

  const selectAgentMode = (mode: typeof agentModes[number]['id']) => {
    if (mode === 'agent_full' && appConfig.aiMode !== 'agent_full' && !window.confirm(copy(
      '自动执行模式允许 AI 无需逐条批准就在服务器运行命令。请仅在完全信任的环境使用。确定开启？',
      'Automatic execution lets AI run server commands without approving each one. Use it only in a fully trusted environment. Enable it?'
    ))) return;
    updateConfig('aiMode', mode);
  };

  const currentPage = navigation.find(item => item.id === activeTab) ?? navigation[0];
  const pageDescription = {
    chat: activeConversation?.title || copy('向 AI 提问，或从历史中继续对话。', 'Ask AI or continue a previous conversation.'),
    history: copy('当前工作区保存的对话。', 'Conversations saved in this workspace.'),
    prompts: copy('选择工作角色或编辑自己的提示词。', 'Choose a role or edit your prompts.'),
    agents: copy('选择 AI 可读取的信息及命令审批方式。', 'Choose what AI may read and how commands are approved.'),
  }[activeTab];

  return (
    <div className="center-workbench management-center relative h-full w-full bg-bg text-ink" data-glass={!!appConfig.enableGlassmorphism}>
    <div className="management-frame flex h-full min-h-0">
      <aside className="center-side-nav center-page-nav management-nav">
        <nav aria-label={copy('AI 中心导航', 'AI Center navigation')}>
          {navigation.map(({ id, cn, en, icon: Icon }) => (
            <button key={id} type="button" onClick={() => selectTab(id)} aria-current={activeTab === id ? 'page' : undefined} className="management-nav-item">
              <Icon size={15} aria-hidden="true" />{copy(cn, en)}
              {id === 'history' && conversations.length > 0 && <span className="ml-auto tabular-nums text-ink-3">{conversations.length}</span>}
            </button>
          ))}
        </nav>
        <div className="management-nav-detail mt-auto border-t border-line px-2.5 pt-4">
          <p className="truncate text-xs text-ink-3" title={workspaceName}>{workspaceName}</p>
          <p className="mt-1 truncate font-mono text-xs text-ink-2" title={appConfig.aiModel || ''}>{appConfig.aiModel || copy('未选择模型', 'No model selected')}</p>
        </div>
      </aside>

      <main className="management-main flex flex-col overflow-hidden" aria-label={copy(currentPage.cn, currentPage.en)}>
        <ManagementHeader compact context={copy('AI 中心', 'AI Center')} title={copy(currentPage.cn, currentPage.en)} description={pageDescription}
          actions={<>
            {activeTab === 'chat' && <button type="button" onClick={newConversation} className={settingButtonClass}><Plus size={14} aria-hidden="true" />{copy('新对话', 'New chat')}</button>}
            <button type="button" onClick={openAiSettings} className="management-icon-button" title={copy('AI 配置', 'AI settings')} aria-label={copy('AI 配置', 'AI settings')}><Settings2 size={15} aria-hidden="true" /></button>
          </>}
        />

        {activeTab === 'chat' && <div className="management-ai-context flex shrink-0 flex-wrap items-center gap-2 border-b border-line-soft bg-surf py-3 text-xs text-ink-2">
          <label htmlFor="ai-center-terminal">{copy('目标终端', 'Target terminal')}</label>
          <select id="ai-center-terminal" value={targetSessionId} onChange={event => setSelectedTerminalId(event.target.value)} className="min-h-8 min-w-0 max-w-full rounded-md border border-line bg-surf-2 px-2 text-xs text-ink outline-none focus:border-primary">
            <option value="">{copy('不附加终端', 'No terminal context')}</option>
            {terminals.map(terminal => <option key={terminal.id} value={terminal.id}>{terminal.name}</option>)}
          </select>
          <span className="text-ink-3">{copy('上下文读取与命令执行仍遵循智能体模式。', 'Context and commands follow the agent mode.')}</span>
        </div>}

        {activeTab === 'chat' && <div className="ui-section-enter flex min-h-0 flex-1 flex-col">
          {!ready ? <div className="m-7 border-l-2 border-warn bg-warn/10 px-4 py-3 text-sm text-ink"><p className="font-medium">{appConfig.aiEnabled ? copy('连接模型后即可开始对话', 'Connect a model to start chatting') : copy('AI 已关闭', 'AI is off')}</p><p className="mt-1 text-xs text-ink-2">{copy('在设置中选择供应商、模型并配置凭据。', 'Choose a provider, model and credentials in Settings.')}</p><button type="button" onClick={openAiSettings} className="mt-3 text-sm font-medium text-primary hover:underline">{copy('打开 AI 配置 →', 'Open AI settings →')}</button></div>
            : <><ChatView onPaperPlane={handlePaperPlane} onRetry={handleRetry} onServerSelect={handleServerSelect} />
              <form id="ai-center-page-form" onSubmit={handleSubmit} className="management-ai-context shrink-0 space-y-3 border-t border-line bg-surf py-4">
                {terminalSelection && <button type="button" onClick={() => {
                  setPrompt(current => `${current}${current ? '\n' : ''}${terminalSelection}`);
                  useAppStore.getState().setCurrentTerminalSelection('');
                }} className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-xs text-ink-2 hover:bg-surf"><ClipboardPaste size={13} />{copy('插入终端选中文本', 'Insert terminal selection')} · {terminalSelection.length}</button>}
                <textarea aria-label={copy('消息', 'Message')} value={prompt} onChange={event => setPrompt(event.target.value)} rows={3} placeholder={copy('输入问题。Enter 发送，Shift+Enter 换行', 'Ask a question. Enter sends, Shift+Enter adds a line.')} onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    if (!isGenerating && prompt.trim()) event.currentTarget.form?.requestSubmit();
                  }
                }} className={`${settingFieldClass} block resize-none leading-relaxed`} />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button type="button" aria-pressed={!!appConfig.aiSearchEnabled} onClick={() => updateConfig('aiSearchEnabled', !appConfig.aiSearchEnabled)} className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs focus-visible:outline-2 focus-visible:outline-primary ${appConfig.aiSearchEnabled ? 'text-primary hover:bg-primary/10' : 'text-ink-3 hover:bg-surf'}`}><Globe size={13} />{appConfig.aiSearchEnabled ? copy('网页搜索开启', 'Web search on') : copy('网页搜索关闭', 'Web search off')}</button>
                  <button type="submit" disabled={isGenerating || !prompt.trim()} className="inline-flex min-h-9 items-center gap-2 rounded-md bg-primary px-3.5 text-sm font-medium text-[var(--primary-ink)] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-40"><Send size={14} />{isGenerating ? copy('生成中…', 'Generating…') : copy('发送', 'Send')}</button>
                </div>
              </form>
            </>}
        </div>}

        {activeTab === 'history' && <div className="ui-section-enter flex min-h-0 flex-1 flex-col"><HistoryView /></div>}

        {activeTab === 'prompts' && <div className="ui-section-enter min-h-0 flex-1 overflow-y-auto">
          <div className="management-content"><div className="flex flex-wrap items-center justify-between gap-3 pb-3"><p className="text-xs text-ink-2">{copy('当前角色', 'Current role')} · {allPrompts.find(item => item.id === appConfig.activePromptId)?.title || copy('默认助手', 'Default assistant')}</p><button type="button" onClick={() => setDraft({ id: `custom_${Date.now()}`, title: '', desc: '', content: '' })} className={settingButtonClass}><Plus size={14} />{copy('新建提示词', 'New prompt')}</button></div>
            <div className="management-cards">
              {allPrompts.map(item => <article key={item.id} className="management-card flex flex-wrap items-start gap-3 p-4">
                <BookOpen size={17} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-medium">{item.title}</h3>{appConfig.activePromptId === item.id && <span className="text-xs text-primary">{copy('使用中', 'Active')}</span>}</div>
                  <p className="mt-1 text-xs leading-relaxed text-ink-3">{item.desc}</p>
                </div>
                <div className="flex w-full flex-wrap items-center justify-end gap-2 border-t border-line-soft pt-2">
                  <button type="button" onClick={() => setDraft(item)} className="rounded-md px-2 py-1.5 text-xs text-ink-2 hover:bg-surf-2 focus-visible:outline-2 focus-visible:outline-primary">{item.isBuiltin ? copy('查看', 'View') : copy('编辑', 'Edit')}</button>
                  {!item.isBuiltin && <button type="button" onClick={() => deletePrompt(item.id)} aria-label={`${copy('删除', 'Delete')} ${item.title}`} className="rounded-md p-1.5 text-ink-3 hover:bg-down/10 hover:text-down focus-visible:outline-2 focus-visible:outline-primary"><Trash2 size={14} /></button>}
                  <button type="button" onClick={() => updateConfig('activePromptId', appConfig.activePromptId === item.id ? undefined : item.id)} className={`rounded-md border px-2.5 py-1.5 text-xs focus-visible:outline-2 focus-visible:outline-primary ${appConfig.activePromptId === item.id ? 'border-primary/30 bg-primary/10 text-primary' : 'border-line bg-panel text-ink hover:bg-surf-2'}`}>{appConfig.activePromptId === item.id ? copy('取消使用', 'Deactivate') : copy('使用', 'Use')}</button>
                </div>
              </article>)}
            </div>
          </div>
        </div>}

        {activeTab === 'agents' && <div className="ui-section-enter min-h-0 flex-1 overflow-y-auto"><div className="management-content"><p className="mb-4 text-sm leading-relaxed text-ink-2">{copy('审批请求会直接显示在对话中。', 'Approval requests appear in the conversation.')}</p><div className="management-list">{agentModes.map(mode => <button type="button" key={mode.id} onClick={() => selectAgentMode(mode.id)} aria-pressed={(appConfig.aiMode || 'readonly') === mode.id} className="management-list-row flex w-full items-start gap-3 px-4 py-3.5 text-left focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"><span className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${(appConfig.aiMode || 'readonly') === mode.id ? 'border-primary bg-primary text-[var(--primary-ink)]' : 'border-line'}`}>{(appConfig.aiMode || 'readonly') === mode.id && <Check size={11} />}</span><span><span className="block text-sm font-medium">{copy(mode.cn, mode.en)}</span><span className="mt-1 block text-xs leading-relaxed text-ink-2">{copy(mode.cnDescription, mode.enDescription)}</span></span></button>)}</div></div></div>}
      </main>
    </div>

      {draft && <div className="absolute inset-0 z-40 flex items-center justify-center bg-scrim p-5" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setDraft(null); }}><div role="dialog" aria-modal="true" aria-label={draft.isBuiltin ? copy('查看提示词', 'View prompt') : copy('编辑提示词', 'Edit prompt')} className="flex max-h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-xl border border-line bg-surf p-6 text-ink shadow-2xl"><div className="flex items-center justify-between"><h3 className="text-lg font-semibold">{draft.isBuiltin ? copy('查看提示词', 'View prompt') : draft.title ? copy('编辑提示词', 'Edit prompt') : copy('新建提示词', 'New prompt')}</h3><button type="button" onClick={() => setDraft(null)} aria-label={copy('关闭', 'Close')} className="rounded-md p-1.5 text-ink-2 hover:bg-surf-2"><X size={17} /></button></div><label className="text-sm font-medium">{copy('名称', 'Name')}<input value={draft.title} readOnly={draft.isBuiltin} onChange={event => setDraft({ ...draft, title: event.target.value })} className="mt-1.5 w-full rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-primary" /></label><label className="text-sm font-medium">{copy('说明', 'Description')}<input value={draft.desc} readOnly={draft.isBuiltin} onChange={event => setDraft({ ...draft, desc: event.target.value })} className="mt-1.5 w-full rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-primary" /></label><label className="text-sm font-medium">{copy('系统提示词', 'System prompt')}<textarea value={draft.content} readOnly={draft.isBuiltin} onChange={event => setDraft({ ...draft, content: event.target.value })} rows={9} className="mt-1.5 w-full resize-y rounded-md border border-line bg-bg px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-primary" /></label>{!draft.isBuiltin && <div className="flex justify-end gap-2"><button type="button" onClick={() => setDraft(null)} className="rounded-md border border-line px-3 py-2 text-sm hover:bg-surf-2">{copy('取消', 'Cancel')}</button><button type="button" onClick={savePrompt} disabled={!draft.title.trim() || !draft.content.trim()} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-bg disabled:opacity-50">{copy('保存提示词', 'Save prompt')}</button></div>}</div></div>}
    </div>
  );
};
