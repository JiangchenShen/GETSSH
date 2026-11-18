import React from 'react';
import { motion } from 'framer-motion';

export const RecBadge: React.FC<{ isRecording: boolean }> = ({ isRecording }) => {
  if (!isRecording) return null;

  return (
    <div 
      className="absolute top-2 right-4 flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-down/30 bg-surf z-[60] pointer-events-auto cursor-help group"
      title="正在记录终端输出（Gzip 压缩保存在本机）"
    >
      <motion.div
        className="w-1.5 h-1.5 rounded-full bg-down"
        animate={{ opacity: [1, 0.4, 1] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      />
      <span className="text-[10px] font-semibold text-down font-mono">
        REC
      </span>
      
      {/* Tooltip on Hover */}
      <div className="absolute top-full mt-1.5 right-0 hidden group-hover:block w-48 p-2 text-xs text-ink-2 bg-surf border border-line rounded-md shadow-lg whitespace-normal text-left">
        当前会话的终端输出正在记录到本机录屏目录。
      </div>
    </div>
  );
};
