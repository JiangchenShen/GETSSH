import React, { useState } from 'react';
import { Brain, ChevronDown, ChevronRight } from 'lucide-react';

export function parseThoughtProcess(content: string) {
  const thinkMatch = content.match(/<think>([\s\S]*?)(?:<\/think>|$)/);
  if (!thinkMatch) return { thoughtProcess: null, actualContent: content, isThinkingDone: true };
  
  const thoughtProcess = thinkMatch[1].trim();
  const actualContent = content.replace(/<think>[\s\S]*?(?:<\/think>|$)/, '').trim();
  const isThinkingDone = content.includes('</think>');
  
  return { thoughtProcess, actualContent, isThinkingDone };
}

export const ThoughtProcessBlock: React.FC<{
  thoughtProcess: string;
  isDark: boolean;
  isThinkingDone: boolean;
}> = ({ thoughtProcess, isDark, isThinkingDone }) => {
  const [collapsed, setCollapsed] = useState(isThinkingDone);

  return (
    <div className={`mb-3 mt-1 overflow-hidden rounded-xl border ${isDark ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-slate-50'}`}>
      <div 
        className={`flex items-center gap-2 px-3 py-2 cursor-pointer text-[10px] font-bold uppercase tracking-wider select-none ${isDark ? 'text-white/50 hover:bg-white/5' : 'text-slate-500 hover:bg-slate-100'}`}
        onClick={() => setCollapsed(!collapsed)}
      >
        <Brain size={12} className={!isThinkingDone ? "animate-pulse text-indigo-400" : ""} />
        <span className="flex-1">{!isThinkingDone ? '正在思考... (Thinking)' : '思考过程 (Thought Process)'}</span>
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
      </div>
      {!collapsed && (
        <div className={`px-4 py-3 text-[13px] leading-relaxed border-t ${isDark ? 'border-white/10 text-white/50' : 'border-slate-200 text-slate-500'} whitespace-pre-wrap break-words italic`}>
          {thoughtProcess}
        </div>
      )}
    </div>
  );
};
