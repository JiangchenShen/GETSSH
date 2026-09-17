import React from 'react';
import { useAppStore } from '../../store/appStore';
import { useAiChatStore } from '../../store/aiChatStore';
import { MessageSquare, Plus, Trash2 } from 'lucide-react';
import { formatRelativeTime } from './shared';

export const HistoryView: React.FC = () => {
  const isDark = useAppStore(state => state.isDark);
  const conversations = useAiChatStore(s => s.conversations);
  const activeConversationId = useAiChatStore(s => s.activeConversationId);
  const setActiveConversation = useAiChatStore(s => s.setActiveConversation);
  const deleteConversation = useAiChatStore(s => s.deleteConversation);
  const clearAllConversations = useAiChatStore(s => s.clearAllConversations);
  const newConversation = useAiChatStore(s => s.newConversation);

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    deleteConversation(id);
  };

  if (conversations.length === 0) {
    return (
      <div className={`flex-1 flex flex-col items-center justify-center gap-4 p-8 ${isDark ? 'text-white/40' : 'text-slate-400'}`}>
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-2">
          <MessageSquare className="w-8 h-8 text-primary/50" />
        </div>
        <div className="text-sm font-bold tracking-widest uppercase">暂无对话记录</div>
        <button
          onClick={() => newConversation()}
          className={`mt-4 flex items-center gap-2 px-6 py-2.5 bg-primary text-white text-xs font-bold uppercase tracking-widest transition-transform hover:scale-105 active:scale-95 rounded-full shadow-lg shadow-primary/20`}
        >
          <Plus className="w-4 h-4" /> 开始新对话
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* List */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2 scrollbar-hide">
        {conversations.map(conv => {
          const isActive = conv.id === activeConversationId;
          const preview = conv.messages.find(m => m.role === 'assistant')?.content?.slice(0, 60) || '…';
          return (
            <div
              key={conv.id}
              onClick={() => setActiveConversation(conv.id)}
              className={`group flex items-center gap-3 px-4 py-3 cursor-pointer transition-all rounded-2xl border ${
                isActive
                  ? 'border-primary/30 bg-primary/10 shadow-sm'
                  : (isDark ? 'border-white/5 hover:border-white/20 hover:bg-white/5' : 'border-black/5 hover:border-black/20 hover:bg-black/5')
              }`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isActive ? 'bg-primary text-white shadow-md shadow-primary/30' : (isDark ? 'bg-white/10 text-white/50' : 'bg-black/5 text-black/50')}`}>
                <MessageSquare className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-bold truncate ${isActive ? 'text-primary' : (isDark ? 'text-white' : 'text-slate-800')}`}>{conv.title}</div>
                <div className={`text-xs truncate mt-0.5 ${isDark ? 'text-white/40' : 'text-slate-500'}`}>{preview}</div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className={`text-[10px] font-mono ${isDark ? 'text-white/30' : 'text-slate-400'}`}>
                  {formatRelativeTime(conv.updatedAt)}
                </span>
                <button
                  onClick={e => handleDelete(e, conv.id)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500 hover:text-white text-red-400 transition-all rounded-lg"
                  title="删除对话"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className={`p-4 border-t flex flex-col gap-2 ${isDark ? 'border-white/10 bg-black/20' : 'border-black/10 bg-slate-50/50'}`}>
        <button
          onClick={() => newConversation()}
          className="w-full py-3 bg-primary hover:bg-primary/90 text-white text-xs font-bold uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" /> 创建新对话
        </button>
        <button
          onClick={clearAllConversations}
          className={`w-full py-2.5 text-xs font-bold uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 ${isDark ? 'text-red-400 hover:bg-red-500/20' : 'text-red-600 hover:bg-red-50'}`}
        >
          <Trash2 className="w-3.5 h-3.5" /> 清空全部记录
        </button>
      </div>
    </div>
  );
};
