import React from 'react';
import { motion } from 'framer-motion';
import { SearchX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store/appStore';
import { UnifiedItem } from '../CommandCenter';

interface CommandCenterListProps {
  unifiedItems: UnifiedItem[];
  activeIndex: number;
  setActiveIndex: (idx: number) => void;
  searchQuery: string;
}

export const CommandCenterList = React.forwardRef<HTMLDivElement, CommandCenterListProps>(({
  unifiedItems,
  activeIndex,
  setActiveIndex,
  searchQuery
}, ref) => {
  const { t } = useTranslation();
  
  return (
    <div 
      ref={ref}
      className="max-h-[60vh] overflow-y-auto p-1.5 scrollbar-hide"
    >
      {unifiedItems.length === 0 ? (
        <div className="py-16 flex flex-col items-center justify-center text-center">
          <SearchX className="w-9 h-9 text-ink-3 mb-3.5" />
          <div className="text-[13px] font-medium text-ink-2 mb-1">
            {t('commandCenter.noResults', "No results found for '{{query}}'", { query: searchQuery })}
          </div>
          <div className="text-[11.5px] text-ink-3">
            {/* Split JSX to avoid nesting issues with translation */}
            {t('commandCenter.pressEnter', 'Press')} <kbd className="font-mono text-[10px] px-1.5 py-px rounded border border-line-soft bg-surf-2 mx-0.5">Enter</kbd> {t('commandCenter.toCreateProfile', 'to create a new profile with this name.')}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1 relative">
          {unifiedItems.map((item, idx) => {
            const isActive = idx === activeIndex;
            return (
              <div
                key={item.id}
                onClick={() => { setActiveIndex(idx); item.onSelect(); }}
                onMouseEnter={() => setActiveIndex(idx)}
                className="relative flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-[7px] cursor-pointer group"
              >
                {isActive && (
                  <motion.div
                    layoutId="active-bg"
                    transition={{ type: 'spring', stiffness: 350, damping: 30, mass: 1 }}
                    className="absolute inset-0 rounded-[7px] pointer-events-none bg-surf"
                  />
                )}
                
                <div className="relative z-10 flex items-center gap-2.5 min-w-0">
                  <div className={`w-[22px] h-[22px] flex-none rounded-md grid place-items-center bg-surf-2
                                   [&>svg]:w-3.5 [&>svg]:h-3.5 ${isActive ? '[&>svg]:text-primary' : ''}`}>
                    {item.icon}
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[13px] text-ink leading-none flex items-center gap-2 truncate">
                      {item.title}
                      {item.type === 'runbook' && item.data.dangerLevel === 'high' && (
                        <span className="flex-none text-[9px] px-1.5 py-0.5 rounded border border-warn/30 text-warn bg-warn/10 font-medium uppercase tracking-wider">
                          {t('commandCenter.highRisk', 'High Risk')}
                        </span>
                      )}
                    </span>
                    {item.subtitle && <span className="font-mono text-[10.5px] text-ink-3 mt-1 leading-none truncate">{item.subtitle}</span>}
                  </div>
                </div>

                {isActive && (
                  <div className="relative z-10 flex items-center gap-2">
                    <kbd className="px-1.5 py-px rounded text-[9.5px] font-mono border border-line-soft bg-surf-2 text-ink-3">
                      {useAppStore.getState().isMac ? '⌘K' : 'Ctrl+K'}
                    </kbd>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

CommandCenterList.displayName = 'CommandCenterList';
