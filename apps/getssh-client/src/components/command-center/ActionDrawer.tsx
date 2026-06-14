import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';

export interface ActionDrawerItem {
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
  isDestructive?: boolean;
  action: () => void;
}

interface ActionDrawerProps {
  isOpen: boolean;
  isDark: boolean;
  drawerItems: ActionDrawerItem[];
  activeDrawerIndex: number;
  activeItemId: string | null;
  deleteConfirmId: string | null;
}

export const ActionDrawer: React.FC<ActionDrawerProps> = ({
  isOpen,
  isDark,
  drawerItems,
  activeDrawerIndex,
  activeItemId,
  deleteConfirmId
}) => {
  const { t } = useTranslation();

  return (
    <AnimatePresence>
      {isOpen && activeItemId && (
        <motion.div
          initial={{ x: -20, opacity: 0, scale: 0.95 }}
          animate={{ x: 16, opacity: 1, scale: 1 }}
          exit={{ x: -10, opacity: 0, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 400, damping: 35 }}
          className={`relative pointer-events-auto shrink-0 w-[240px] shadow-2xl rounded-2xl border flex flex-col p-2 ${
            isDark ? 'bg-[#151515]/90 border-white/10 water-glass text-white' : 'bg-white/95 border-black/10 text-slate-900 backdrop-blur-xl'
          }`}
        >
          <div className="px-3 py-2 text-xs font-bold uppercase opacity-50 border-b mb-2 pb-2 border-current/10 flex justify-between items-center">
            {t('commandCenter.actions', 'ACTIONS')}
          </div>
          <div className="flex flex-col gap-1">
            {drawerItems.map((item, i) => {
              const isActive = activeDrawerIndex === i;
              return (
                <button 
                  key={i}
                  id={`drawer-btn-${i}`}
                  onClick={() => item.action()}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between group transition-colors relative ${
                    isActive 
                      ? (item.isDestructive && deleteConfirmId === activeItemId 
                          ? 'bg-red-500/20 text-red-500' 
                          : isDark ? 'bg-white/10' : 'bg-black/5')
                      : (item.isDestructive && deleteConfirmId === activeItemId 
                          ? 'text-red-500'
                          : isDark ? 'hover:bg-white/10' : 'hover:bg-black/5')
                  }`}
                >
                  <span className={`flex items-center gap-2 ${item.isDestructive ? 'text-red-500' : ''}`}>
                    {item.icon} {item.label}
                  </span>
                  {item.shortcut && <kbd className="text-[10px] opacity-40">{item.shortcut}</kbd>}
                </button>
              );
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
