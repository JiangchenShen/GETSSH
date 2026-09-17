import React from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal, Shield, Globe, Sparkles, Blocks, Settings, Sun, Moon } from 'lucide-react';
import { useAppStore } from '../store/appStore';

/**
 * 底部状态条。
 *
 * 六个中心从主屏的等重卡片挪到这里 —— 它们是导航，不是内容。导航常驻底部，
 * 主屏那块地留给「接着干」的东西。
 *
 * 右侧只放真有数据源的东西：Watchdog 取 appStore.watchdogStatus。
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
               hover:bg-surf hover:text-ink"
  >
    <span className="flex-none text-ink-3 transition-colors group-hover:text-primary">{icon}</span>
    {label}
    {hint && (
      <kbd className="font-mono text-[9.5px] px-[5px] py-px rounded border border-line-soft bg-surf-2 text-ink-3">
        {hint}
      </kbd>
    )}
  </button>
);

export const StatusBar: React.FC = () => {
  const { t } = useTranslation();
  const isMac = useAppStore(state => state.isMac);
  const isDark = useAppStore(state => state.isDark);
  const updateConfig = useAppStore(state => state.updateConfig);
  const setIsCommandCenterOpen = useAppStore(state => state.setIsCommandCenterOpen);
  const watchdogStatus = useAppStore(state => state.watchdogStatus);

  const ico = 'w-3.5 h-3.5';
  const wd = watchdogStatus;
  const wdOk = !!wd && wd.status === 'secure' && !wd.watchdogDisabled;

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
        icon={<Shield className={ico} />}
        label={t('statusBar.secure')}
        onClick={() => openCenter('secure', t('statusBar.secure'))}
      />
      <BItem
        icon={<Globe className={ico} />}
        label={t('statusBar.workspace')}
        onClick={() => openCenter('workspace', t('statusBar.workspace'))}
      />
      <BItem
        icon={<Sparkles className={ico} />}
        label={t('statusBar.ai')}
        onClick={() => openCenter('ai', 'AI CENTER')}
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

      {wd && (
        <div className="flex-none flex items-center gap-[7px] px-[9px] text-[11.5px] text-ink-3 whitespace-nowrap">
          <span className={`w-1.5 h-1.5 rounded-full flex-none ${wdOk ? 'bg-ok' : 'bg-warn'}`} />
          Watchdog · {wdOk
            ? t('statusBar.wdOk')
            : (wd.reason || t('statusBar.wdBad'))}
        </div>
      )}

      <BItem
        icon={isDark ? <Sun className={ico} /> : <Moon className={ico} />}
        label={t('statusBar.theme')}
        onClick={() => updateConfig('theme', isDark ? 'light' : 'dark')}
      />
    </div>
  );
};
