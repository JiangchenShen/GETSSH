import React from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal, Sparkles, Blocks, Settings } from 'lucide-react';
import { useAppStore } from '../store/appStore';

/**
 * 底部状态条。
 *
 * 底栏只保留跨工作区的常用目的地。当前工作区由左侧导轨管理，
 * 安全设置归入设置页；Ocean Sentinel 在右侧报告实际状态。
 *
 * 右侧只放真有数据源的东西：Ocean Sentinel 取 appStore.sentinelStatus。
 * 原型里画的「Rust Core 运行中」现在没有对应信号，不编。
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
    className="group flex-none flex items-center gap-[7px] h-[26px] px-[9px] rounded-md
               text-xs text-ink-2 whitespace-nowrap transition-colors
               hover:bg-surf hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
  >
    <span className="flex-none text-ink-3 transition-colors group-hover:text-primary">{icon}</span>
    {label}
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
  const sentinelStatus = useAppStore(state => state.sentinelStatus);

  const ico = 'w-3.5 h-3.5';
  const sentinelOk = !!sentinelStatus && sentinelStatus.status === 'secure' && sentinelStatus.daemonState === 'running' && !sentinelStatus.sentinelDisabled;

  return (
    <div
      className="no-drag-region flex-none flex items-center gap-0.5 h-[38px] px-3
                 border-t border-line-soft bg-panel/75 backdrop-blur-xl overflow-x-auto"
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
        icon={<Blocks className={ico} />}
        label={t('statusBar.plugins')}
        onClick={() => openCenter('plugin', t('statusBar.plugins'))}
      />
      <BItem
        icon={<Settings className={ico} />}
        label={t('statusBar.settings')}
        onClick={() => openCenter('settings', t('statusBar.settings'))}
      />

      <div className="flex-1 min-w-[8px]" />

      {sentinelStatus && (
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('app:open-center', {
            detail: { type: 'settings', title: t('statusBar.settings'), settingsTab: 'Security' },
          }))}
          className="flex-none flex items-center gap-[7px] max-w-[190px] px-[9px] text-[11.5px] text-ink-3 whitespace-nowrap rounded-md hover:bg-surf focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          aria-label={`${t('statusBar.secure')} · ${sentinelOk ? t('statusBar.sentinelOk') : (sentinelStatus.reason || t('statusBar.sentinelBad'))}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full flex-none ${sentinelOk ? 'bg-ok' : 'bg-warn'}`} />
          <span className="truncate" title={sentinelOk ? t('statusBar.sentinelOk') : (sentinelStatus.reason || t('statusBar.sentinelBad'))}>
            {t('statusBar.secure')} · {sentinelOk ? t('statusBar.sentinelOk') : (sentinelStatus.reason || t('statusBar.sentinelBad'))}
          </span>
        </button>
      )}
    </div>
  );
};
