import React from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
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
  drawerItems: ActionDrawerItem[];
  activeDrawerIndex: number;
  activeItemId: string | null;
}

export const ActionDrawer: React.FC<ActionDrawerProps> = ({
  isOpen,
  drawerItems,
  activeDrawerIndex,
  activeItemId
}) => {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {isOpen && activeItemId && (
        <motion.div
          initial={reduceMotion ? false : { y: -4, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduceMotion ? undefined : { y: -4, opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="absolute right-3 top-[88px] z-30 flex w-[226px] flex-col rounded-lg border border-line bg-surf p-1.5 text-ink shadow-[0_12px_36px_rgba(0,0,0,0.22)]"
        >
          <div className="mb-1 border-b border-line-soft px-2.5 py-2 text-xs font-medium text-ink-2">
            {t('commandCenter.actions', 'Actions')}
          </div>
          <div className="flex flex-col gap-0.5">
            {drawerItems.map((item, i) => {
              const isActive = activeDrawerIndex === i;
              return (
                <button
                  type="button"
                  key={i}
                  id={`drawer-btn-${i}`}
                  onClick={() => item.action()}
                  className={`flex min-h-9 w-full items-center justify-between rounded-md px-2.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${isActive ? 'bg-primary/10 text-primary' : 'text-ink-2 hover:bg-panel hover:text-ink'} ${item.isDestructive ? 'text-down' : ''}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {item.icon} {item.label}
                  </span>
                  {item.shortcut && <kbd className="font-mono text-[10px] text-ink-3">{item.shortcut}</kbd>}
                </button>
              );
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
