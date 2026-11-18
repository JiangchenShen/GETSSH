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
}> = ({ thoughtProcess, isThinkingDone }) => {
  const [collapsed, setCollapsed] = useState(isThinkingDone);

  return (
    <div className="mb-3 mt-1 overflow-hidden rounded-lg border border-line-soft bg-surf-2/60">
      <div 
        className="flex items-center gap-2 px-3 py-1.5 cursor-pointer text-[11px] font-medium select-none text-ink-2 hover:bg-surf-2 transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        <Brain size={12} className={!isThinkingDone ? "animate-pulse text-primary" : "text-ink-3"} />
        <span className="flex-1">{!isThinkingDone ? '正在思考... (Thinking)' : '思考过程 (Thought Process)'}</span>
        {collapsed ? <ChevronRight size={12} className="text-ink-3" /> : <ChevronDown size={12} className="text-ink-3" />}
      </div>
      {!collapsed && (
        <div className="px-3.5 py-2.5 text-xs leading-relaxed border-t border-line-soft text-ink-2 whitespace-pre-wrap break-words">
          {thoughtProcess}
        </div>
      )}
    </div>
  );
};
