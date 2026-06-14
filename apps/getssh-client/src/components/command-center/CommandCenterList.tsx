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
  isDark: boolean;
}

export const CommandCenterList = React.forwardRef<HTMLDivElement, CommandCenterListProps>(({
  unifiedItems,
  activeIndex,
  setActiveIndex,
  searchQuery,
  isDark
}, ref) => {
  const { t } = useTranslation();
  
  return (
    <div 
      ref={ref}
      className="max-h-[60vh] overflow-y-auto p-2 scrollbar-hide"
    >
      {unifiedItems.length === 0 ? (
        <div className="py-16 flex flex-col items-center justify-center text-center">
          <SearchX className="w-12 h-12 text-neutral-600 mb-4 opacity-50" />
          <div className="text-base font-medium opacity-80 mb-1">
            {t('commandCenter.noResults', "No results found for '{{query}}'", { query: searchQuery })}
          </div>
          <div className="text-xs text-neutral-500">
            {/* Split JSX to avoid nesting issues with translation */}
            {t('commandCenter.pressEnter', 'Press')} <kbd className="font-mono bg-white/10 px-1 rounded mx-0.5">Enter</kbd> {t('commandCenter.toCreateProfile', 'to create a new profile with this name.')}
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
                className={`relative flex items-center justify-between p-3 rounded-xl cursor-pointer group transition-colors`}
              >
                {isActive && (
                  <motion.div
                    layoutId="active-bg"
                    transition={{ type: 'spring', stiffness: 350, damping: 30, mass: 1 }}
                    className={`absolute inset-0 rounded-xl pointer-events-none ${isDark ? 'bg-white/10' : 'bg-black/5'}`}
                  />
                )}
                
                <div className="relative z-10 flex items-center gap-3">
                  <div className={`p-1.5 rounded-md ${isDark ? 'bg-white/5' : 'bg-black/5'}`}>
                    {item.icon}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium leading-none flex items-center gap-2">
                      {item.title}
                      {item.type === 'runbook' && item.data.dangerLevel === 'high' && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded border border-amber-500/30 text-amber-500 bg-amber-500/10 font-bold uppercase tracking-wider">
                          {t('commandCenter.highRisk', 'High Risk')}
                        </span>
                      )}
                    </span>
                    {item.subtitle && <span className="text-xs opacity-50 mt-1 leading-none">{item.subtitle}</span>}
                  </div>
                </div>

                {isActive && (
                  <div className="relative z-10 flex items-center gap-2">
                    <kbd className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${isDark ? 'border-white/20' : 'border-black/20'}`}>
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
