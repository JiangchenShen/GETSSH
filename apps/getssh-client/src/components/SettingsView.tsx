import React, { useEffect, useRef, useState } from 'react';
import { Archive, ChevronLeft, ChevronRight, Info, Monitor, Network, Settings2, ShieldCheck, Sparkles, TerminalSquare, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/appStore';
import { AppearanceTab } from './settings/tabs/AppearanceTab';
import { TerminalTab } from './settings/tabs/TerminalTab';
import { SSHTab } from './settings/tabs/SSHTab';
import { SystemTab } from './settings/tabs/SystemTab';
import { AuditTab } from './settings/tabs/AuditTab';
import { AboutTab } from './settings/tabs/AboutTab';
import { SecurityTab } from './settings/tabs/SecurityTab';
import { AiIntegrationsTab } from './settings/tabs/AiIntegrationsTab';

export type SettingsTab = 'System' | 'Appearance' | 'Terminal' | 'SSH' | 'AI' | 'Security' | 'Audit' | 'About';

export const SETTINGS_TABS: readonly SettingsTab[] = ['System', 'Appearance', 'Terminal', 'SSH', 'AI', 'Security', 'Audit', 'About'];

interface SettingsViewProps {
  settingsActiveTab: SettingsTab;
  setSettingsActiveTab: (tab: SettingsTab) => void;
  onClose?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ settingsActiveTab, setSettingsActiveTab, onClose }) => {
  const { i18n } = useTranslation();
  const glass = useAppStore(state => state.appConfig.enableGlassmorphism);
  const zh = i18n.language.startsWith('zh');
  const label = (cn: string, en: string) => zh ? cn : en;
  const history = useRef<SettingsTab[]>([settingsActiveTab]);
  const [historyIndex, setHistoryIndex] = useState(0);

  useEffect(() => {
    if (history.current[historyIndex] === settingsActiveTab) return;
    history.current = [...history.current.slice(0, historyIndex + 1), settingsActiveTab];
    setHistoryIndex(history.current.length - 1);
  }, [settingsActiveTab, historyIndex]);

  const navigateHistory = (nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= history.current.length) return;
    setHistoryIndex(nextIndex);
    setSettingsActiveTab(history.current[nextIndex]);
  };

  const nav = [
    { id: 'System' as const, title: label('通用', 'General'), icon: Settings2, group: label('应用', 'App'), intro: label('语言、快捷键与应用行为。', 'Language, shortcuts and app behavior.') },
    { id: 'Appearance' as const, title: label('外观', 'Appearance'), icon: Monitor, group: '', intro: label('界面主题、强调色与侧栏质感。', 'Theme, colors and sidebar material.') },
    { id: 'Terminal' as const, title: label('终端', 'Terminal'), icon: TerminalSquare, group: '', intro: label('字体、配色与输入行为。', 'Typography, colors and input behavior.') },
    { id: 'SSH' as const, title: label('连接与传输', 'Connections & Transfer'), icon: Network, group: '', intro: label('SSH 默认值、代理、传输与初始化脚本。', 'SSH defaults, proxy, transfers and connection scripts.') },
    { id: 'AI' as const, title: label('AI 与集成', 'AI & Integrations'), icon: Sparkles, group: label('能力', 'Capabilities'), intro: label('模型连接、网页搜索与 MCP。', 'Model connections, web search and MCP.') },
    { id: 'Security' as const, title: label('安全与隐私', 'Security & Privacy'), icon: ShieldCheck, group: '', intro: label('应用保护、工作区保险库与连接信任。', 'App protection, workspace vault and host trust.') },
    { id: 'Audit' as const, title: label('数据与日志', 'Data & Logs'), icon: Archive, group: '', intro: label('会话记录、录屏与导出。', 'Session records, recordings and export.') },
    { id: 'About' as const, title: label('关于', 'About'), icon: Info, group: label('其他', 'Other'), intro: label('版本、更新与法律信息。', 'Version, updates and legal information.') },
  ];
  const page = nav.find(item => item.id === settingsActiveTab) ?? nav[0];

  return (
    <div className="center-workbench flex h-full min-h-0 w-full min-w-0 bg-bg text-ink" data-glass={glass ? 'true' : 'false'}>
      <aside className="center-side-nav sidebar-material flex w-[176px] shrink-0 flex-col border-r border-line px-2 py-5 max-[690px]:w-[148px]" aria-label={label('设置导航', 'Settings navigation')}>
        <h2 className="mb-4 px-3 text-base font-semibold text-ink">{label('设置', 'Settings')}</h2>
        <nav className="min-h-0 space-y-0.5 overflow-y-auto" aria-label={label('设置分类', 'Settings categories')}>
          {nav.map(({ id, title, icon: Icon, group }) => (
            <React.Fragment key={id}>
              {group && <div className="px-3 pb-1 pt-4 text-[10px] font-medium tracking-wide text-ink-3 first:pt-0">{group}</div>}
              <button
                type="button"
                onClick={() => setSettingsActiveTab(id)}
                aria-current={settingsActiveTab === id ? 'page' : undefined}
                className={`flex min-h-9 w-full items-center gap-2 rounded-md px-3 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${settingsActiveTab === id ? 'bg-primary/10 font-medium text-primary' : 'text-ink-2 hover:bg-surf hover:text-ink'}`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 truncate">{title}</span>
              </button>
            </React.Fragment>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto" aria-label={page.title}>
        <div className="mx-auto w-full max-w-[1060px] px-6 pb-12 pt-6 max-[690px]:px-4">
          <header className="mb-6 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-[22px] font-semibold tracking-tight text-ink">{page.title}</h1>
              <p className="mt-1 text-xs leading-relaxed text-ink-2">{page.intro}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" onClick={() => navigateHistory(historyIndex - 1)} disabled={historyIndex === 0} aria-label={label('后退', 'Back')} className="grid h-8 w-8 place-items-center rounded-md text-ink-3 hover:bg-surf hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" onClick={() => navigateHistory(historyIndex + 1)} disabled={historyIndex >= history.current.length - 1} aria-label={label('前进', 'Forward')} className="grid h-8 w-8 place-items-center rounded-md text-ink-3 hover:bg-surf hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
              {onClose && <button type="button" onClick={onClose} aria-label={label('关闭设置', 'Close settings')} className="ml-1 grid h-8 w-8 place-items-center rounded-md text-ink-3 hover:bg-surf hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><X className="h-4 w-4" /></button>}
            </div>
          </header>

          {settingsActiveTab === 'System' && <SystemTab />}
          {settingsActiveTab === 'Appearance' && <AppearanceTab />}
          {settingsActiveTab === 'Terminal' && <TerminalTab />}
          {settingsActiveTab === 'SSH' && <SSHTab />}
          {settingsActiveTab === 'AI' && <AiIntegrationsTab />}
          {settingsActiveTab === 'Security' && <SecurityTab />}
          {settingsActiveTab === 'Audit' && <AuditTab />}
          {settingsActiveTab === 'About' && <AboutTab />}
        </div>
      </main>
    </div>
  );
};
