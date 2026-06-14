import React from 'react';
import { motion } from 'framer-motion';

export const RecBadge: React.FC<{ isRecording: boolean }> = ({ isRecording }) => {
  if (!isRecording) return null;

  return (
    <div 
      className="absolute top-2 right-4 flex items-center gap-2 px-2 py-1 rounded border border-red-500/30 bg-red-500/10 backdrop-blur-md z-[60] pointer-events-auto cursor-help group"
      title="Asciinema 物理级会话审计流记录中 (Gzipped)"
    >
      <motion.div
        className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]"
        animate={{ opacity: [1, 0.4, 1] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      />
      <span className="text-[10px] font-bold text-red-500 tracking-wider font-mono">
        REC
      </span>
      
      {/* Tooltip on Hover */}
      <div className="absolute top-full mt-2 right-0 hidden group-hover:block w-48 p-2 text-xs text-zinc-300 bg-zinc-900 border border-zinc-800 rounded shadow-xl whitespace-normal text-left">
        审计流记录已在物理底层接管，所有输出将被严格加密封存。
      </div>
    </div>
  );
};
