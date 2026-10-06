import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAiChatStore } from '../../store/aiChatStore';
import { MessageSquare, Plus, Trash2 } from 'lucide-react';

const primaryAction = 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-[var(--center-accent-ink)] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export const HistoryView: React.FC = () => {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const copy = (cn: string, en: string) => zh ? cn : en;
  const conversations = useAiChatStore(state => state.conversations);
  const activeConversationId = useAiChatStore(state => state.activeConversationId);
  const setActiveConversation = useAiChatStore(state => state.setActiveConversation);
  const deleteConversation = useAiChatStore(state => state.deleteConversation);
  const clearAllConversations = useAiChatStore(state => state.clearAllConversations);
  const newConversation = useAiChatStore(state => state.newConversation);
  const timeFormat = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' });
  const relativeTime = (timestamp: number) => {
    const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
    if (minutes === 0) return copy('刚刚', 'Just now');
    if (minutes < 60) return timeFormat.format(-minutes, 'minute');
    if (minutes < 1440) return timeFormat.format(-Math.floor(minutes / 60), 'hour');
    return timeFormat.format(-Math.floor(minutes / 1440), 'day');
  };

  if (conversations.length === 0) {
    return <div className="center-workbench flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-8 text-center text-ink">
      <MessageSquare className="h-7 w-7 text-ink-3" aria-hidden="true" />
      <p className="text-sm font-medium">{copy('暂无对话记录', 'No conversations yet')}</p>
      <p className="max-w-sm text-xs leading-relaxed text-ink-3">{copy('开始一段对话后，可以在这里继续查看。', 'Start a conversation to find it here later.')}</p>
      <button type="button" onClick={() => newConversation()} className={`mt-2 ${primaryAction}`}><Plus className="h-4 w-4" aria-hidden="true" />{copy('新对话', 'New chat')}</button>
    </div>;
  }

  return <div className="center-workbench flex min-h-0 flex-1 flex-col text-ink">
    <ul aria-label={copy('对话历史', 'Conversation history')} className="min-h-0 flex-1 divide-y divide-line-soft overflow-y-auto px-5 py-2">
      {conversations.map(conversation => {
        const isActive = conversation.id === activeConversationId;
        const preview = conversation.messages.find(message => message.role === 'assistant')?.content?.slice(0, 60) || copy('暂无回复', 'No reply yet');
        return <li key={conversation.id} className="flex items-center gap-2 py-1">
          <button type="button" onClick={() => setActiveConversation(conversation.id)} aria-pressed={isActive}
            className={`flex min-h-16 min-w-0 flex-1 items-start gap-3 rounded-md px-3 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-primary ${isActive ? 'bg-primary/10' : 'hover:bg-surf-2'}`}>
            <MessageSquare className={`mt-0.5 h-4 w-4 shrink-0 ${isActive ? 'text-primary' : 'text-ink-3'}`} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className={`min-w-0 truncate text-sm font-medium ${isActive ? 'text-primary' : 'text-ink'}`}>{conversation.title}</span>
                <time dateTime={new Date(conversation.updatedAt).toISOString()} title={new Date(conversation.updatedAt).toLocaleString(i18n.language)} className="shrink-0 text-[11px] text-ink-3">{relativeTime(conversation.updatedAt)}</time>
              </span>
              <span className="mt-1 block truncate text-xs text-ink-3">{preview}</span>
            </span>
          </button>
          <button type="button" onClick={() => deleteConversation(conversation.id)}
            aria-label={`${copy('删除对话：', 'Delete conversation: ')}${conversation.title}`} title={copy('删除对话', 'Delete conversation')}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-ink-3 transition-colors hover:bg-down/10 hover:text-down focus-visible:outline-2 focus-visible:outline-primary">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </li>;
      })}
    </ul>
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
      <button type="button" onClick={() => newConversation()} className={primaryAction}><Plus className="h-4 w-4" aria-hidden="true" />{copy('新对话', 'New chat')}</button>
      <button type="button" onClick={clearAllConversations} className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-xs text-ink-3 hover:bg-down/10 hover:text-down focus-visible:outline-2 focus-visible:outline-primary"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />{copy('清空全部记录', 'Clear all history')}</button>
    </div>
  </div>;
};
