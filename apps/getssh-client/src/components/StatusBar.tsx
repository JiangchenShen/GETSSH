import React from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal, Sparkles, Layers, Blocks, Settings } from 'lucide-react';
import { useAppStore } from '../store/appStore';

/**
 * 底部状态条。
 *
 * 底栏保留常用目的地，工作区入口直达独立管理页。
 * 左侧导轨显示工作区和本机进程监护状态。
 */

const openCenter = (type: string, title: string) => {
  window.dispatchEvent(new CustomEvent('app:open-center', { detail: { type, title } }));
};

const BItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  title?: string;
}> = ({ icon, label, hint, onClick, title }) => (
  <button
    type="button"
    onClick={onClick}
    title={title || label}
    aria-label={label}
    className="group flex-none flex items-center gap-[7px] h-[26px] px-[9px] rounded-md
               text-xs text-ink-2 whitespace-nowrap transition-colors
               hover:bg-surf hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
  >
    <span className="flex h-4 w-4 flex-none items-center justify-center text-ink-3 transition-colors group-hover:text-primary">{icon}</span>
    <span className="hidden sm:inline">{label}</span>
    {hint && (
      <kbd className="hidden min-[980px]:inline font-mono text-[9.5px] px-[5px] py-px rounded border border-line-soft bg-surf-2 text-ink-3">
        {hint}
      </kbd>
    )}
  </button>
);

export const StatusBar: React.FC = () => {
  const { t } = useTranslation();
  const isMac = useAppStore(state => state.isMac);
  const setIsCommandCenterOpen = useAppStore(state => state.setIsCommandCenterOpen);
  const ico = 'w-3.5 h-3.5';

  return (
    <div
      className="no-drag-region sidebar-material flex-none flex items-center gap-0.5 h-[38px] px-3
                 border-t border-line-soft overflow-x-auto"
      style={{ '--sidebar-tint': 'var(--v2-panel)' } as React.CSSProperties}
    >
      <BItem
        icon={<Terminal className={ico} />}
        label={t('statusBar.commandCenter')}
        hint={isMac ? '⌘K' : 'Ctrl K'}
        onClick={() => setIsCommandCenterOpen(true)}
      />
      <BItem
        icon={<Sparkles className={ico} />}
        label={t('statusBar.ai')}
        onClick={() => openCenter('ai', t('statusBar.ai'))}
      />
      <BItem
        icon={<Layers className={ico} />}
        label={t('statusBar.workspace')}
        onClick={() => window.dispatchEvent(new CustomEvent('app:open-center', {
          detail: { type: 'workspace', title: t('statusBar.workspace'), workspacePage: 'all' },
        }))}
      />
      <BItem
        icon={<Blocks className={ico} />}
        label={t('statusBar.plugins')}
        onClick={() => openCenter('plugin', t('statusBar.plugins'))}
      />
      <BItem
        icon={<Settings className={ico} />}
        label={t('statusBar.settings')}
        onClick={() => openCenter('settings', t('statusBar.settings'))}
      />

    </div>
  );
};
