import React from 'react';
import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';

export const SPRING_SNAPPY = { type: 'spring', stiffness: 400, damping: 30, mass: 1.0 } as const;

// ─── Thinking Indicator ───────────────────────────────────────────────────────
export const ThinkingIndicator: React.FC = () => (
  <div className="flex items-center gap-3 py-1 px-2">
    <div className="relative flex items-center justify-center w-5 h-5">
      <motion.div
        className="absolute inset-0 rounded-full border-t-2 border-primary"
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
      />
      <Sparkles className="w-3 h-3 text-primary animate-pulse" />
    </div>
    <div className="flex gap-1">
      {[0, 1, 2].map(i => (
        <motion.span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-primary/60"
          animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2, ease: 'easeInOut' }}
        />
      ))}
    </div>
  </div>
);

export const StreamCursor: React.FC = () => (
  <motion.span
    className="inline-block w-2 h-4 bg-primary/80 ml-1 align-middle rounded-sm"
    animate={{ opacity: [1, 0, 1] }}
    transition={{ duration: 0.8, repeat: Infinity }}
  />
);

export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  return `${days} 天前`;
}
