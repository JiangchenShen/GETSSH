import React from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal, Sparkles, Layers, Blocks, Settings } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { WorkspaceSentinel } from './WorkspaceSentinel';

/**
 * 底部状态条。
 *
 * 底栏保留常用目的地，工作区入口直达独立管理页。
 * Ocean Sentinel 指示当前监护状态。
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
    className="workbench-footer-action"
  >
    <span className="workbench-footer-icon" aria-hidden="true">{icon}</span>
    <span className="workbench-footer-label">{label}</span>
    {hint && (
      <kbd className="workbench-footer-key" aria-hidden="true">
        {hint}
      </kbd>
    )}
  </button>
);

export const StatusBar: React.FC<{ pollSentinel?: boolean }> = ({ pollSentinel }) => {
  const { t } = useTranslation();
  const isMac = useAppStore(state => state.isMac);
  const setIsCommandCenterOpen = useAppStore(state => state.setIsCommandCenterOpen);
  const ico = 'w-3.5 h-3.5';

  return (
    <div className="workbench-footer no-drag-region">
      <BItem
        icon={<Terminal className={ico} />}
        label={t('statusBar.commandCenter')}
        hint={isMac ? '⌘K' : 'Ctrl K'}
        onClick={() => setIsCommandCenterOpen(true)}
      />
      <span className="workbench-footer-spacer" aria-hidden="true" />
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
      <WorkspaceSentinel poll={pollSentinel} />

    </div>
  );
};
