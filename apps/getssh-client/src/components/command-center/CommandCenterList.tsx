import React from 'react';
import { SearchX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store/appStore';
import { UnifiedItem, UnifiedItemType } from '../CommandCenter';

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
  const { t, i18n } = useTranslation();
  const isMac = useAppStore(state => state.isMac);
  const zh = i18n.language.startsWith('zh');
  const typeLabels: Record<UnifiedItemType, string> = zh
    ? { action: '操作', host: '主机', plugin: '插件', runbook: 'Runbook' }
    : { action: 'Action', host: 'Host', plugin: 'Plugin', runbook: 'Runbook' };

  return (
    <div ref={ref} className="min-h-[160px] max-h-[56vh] overflow-y-auto p-2">
      {unifiedItems.length === 0 ? (
        <div className="flex min-h-[160px] flex-col items-center justify-center px-4 py-8 text-center">
          <SearchX className="mb-3 h-5 w-5 text-ink-3" aria-hidden="true" />
          <p className="text-sm text-ink-2">{t('commandCenter.noResults', "No results found for '{{query}}'", { query: searchQuery })}</p>
          <p className="mt-2 text-xs text-ink-3">
            {t('commandCenter.pressEnter', 'Press')} <kbd className="mx-0.5 rounded border border-line px-1 font-mono text-[10px]">Enter</kbd> {t('commandCenter.toCreateProfile', 'to create a new profile with this name.')}
          </p>
        </div>
      ) : unifiedItems.map((item, idx) => {
        const isActive = idx === activeIndex;
        return (
          <button
            type="button"
            key={item.id}
            onClick={() => { setActiveIndex(idx); item.onSelect(); }}
            onMouseEnter={() => setActiveIndex(idx)}
            className={`group flex min-h-[48px] w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${isActive ? 'bg-primary/10 text-ink' : 'text-ink-2 hover:bg-panel'}`}
          >
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-md border border-line-soft bg-panel [&>svg]:h-3.5 [&>svg]:w-3.5 ${isActive ? 'text-primary [&>svg]:text-primary' : 'text-ink-3'}`} aria-hidden="true">{item.icon}</span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-ink">
                <span className="truncate">{item.title}</span>
                {item.type === 'runbook' && item.data.dangerLevel === 'high' && <span className="shrink-0 rounded border border-warn/40 px-1.5 py-0.5 text-[10px] font-medium text-warn">{t('commandCenter.highRisk', 'High Risk')}</span>}
              </span>
              {item.subtitle && <span className={`truncate text-[11px] text-ink-3 ${item.type === 'host' ? 'font-mono' : ''}`}>{item.subtitle}</span>}
            </span>
            <span className="shrink-0 text-[10px] text-ink-3">{typeLabels[item.type]}</span>
            {isActive && <kbd className="hidden shrink-0 rounded border border-line bg-panel px-1.5 py-0.5 font-mono text-[10px] text-ink-3 min-[540px]:inline">{isMac ? '⌘K' : 'Ctrl+K'}</kbd>}
          </button>
        );
      })}
    </div>
  );
});

CommandCenterList.displayName = 'CommandCenterList';
