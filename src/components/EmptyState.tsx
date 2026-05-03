import React from 'react';
import { Terminal as TerminalIcon } from 'lucide-react';

export const EmptyState: React.FC = () => {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="opacity-30 flex flex-col items-center gap-4">
        <TerminalIcon className="w-16 h-16" />
        <p className="text-sm font-medium tracking-widest uppercase">Select or create a session to connect</p>
      </div>
    </div>
  );
};
