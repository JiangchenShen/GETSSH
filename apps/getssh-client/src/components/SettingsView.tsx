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
import { ManagementHeader } from './ManagementSurface';

export type SettingsTab = 'System' | 'Appearance' | 'Terminal' | 'SSH' | 'AI' | 'Security' | 'Audit' | 'About';

export const SETTINGS_TABS: readonly SettingsTab[] = ['System', 'Appearance', 'Terminal', 'SSH', 'AI', 'Security', 'Audit', 'About'];

interface SettingsViewProps {
  settingsActiveTab: SettingsTab;
  setSettingsActiveTab: (tab: SettingsTab) => void;
  onClose?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ settingsActiveTab, setSettingsActiveTab, onClose }) => {
  const { t, i18n } = useTranslation();
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
    { id: 'Appearance' as const, title: label('外观', 'Appearance'), icon: Monitor, group: '', intro: label('浅色、深色与导航透明度。', 'Light and dark appearance, and navigation transparency.') },
    { id: 'Terminal' as const, title: label('终端', 'Terminal'), icon: TerminalSquare, group: '', intro: label('字体、配色与输入行为。', 'Typography, colors and input behavior.') },
    { id: 'SSH' as const, title: label('连接与传输', 'Connections & Transfer'), icon: Network, group: '', intro: label('SSH 默认值、代理、传输与初始化脚本。', 'SSH defaults, proxy, transfers and connection scripts.') },
    { id: 'AI' as const, title: label('AI 与集成', 'AI & Integrations'), icon: Sparkles, group: label('能力', 'Capabilities'), intro: label('模型连接、网页搜索与 MCP。', 'Model connections, web search and MCP.') },
    { id: 'Security' as const, title: t('settings.secureCenter'), icon: ShieldCheck, group: '', intro: label('保护配置、守护进程与脱敏运行状态。', 'Protection settings, supervisor and redaction runtime status.') },
    { id: 'Audit' as const, title: label('数据与日志', 'Data & Logs'), icon: Archive, group: '', intro: label('会话记录、录屏与导出。', 'Session records, recordings and export.') },
    { id: 'About' as const, title: label('关于', 'About'), icon: Info, group: label('其他', 'Other'), intro: label('版本、更新与法律信息。', 'Version, updates and legal information.') },
  ];
  const page = nav.find(item => item.id === settingsActiveTab) ?? nav[0];

  return (
    <div className="center-workbench management-center h-full w-full bg-bg text-ink" data-glass={glass ? 'true' : 'false'}>
    <div className="management-frame flex h-full min-h-0">
      <aside className="center-side-nav center-page-nav management-nav" aria-label={label('设置导航', 'Settings navigation')}>
        <h2 className="sr-only">{label('设置', 'Settings')}</h2>
        <nav aria-label={label('设置分类', 'Settings categories')}>
          {nav.map(({ id, title, icon: Icon, group }) => (
            <React.Fragment key={id}>
              {group && <div className="management-nav-label">{group}</div>}
              <button
                type="button"
                onClick={() => setSettingsActiveTab(id)}
                aria-current={settingsActiveTab === id ? 'page' : undefined}
                title={title}
                className="management-nav-item"
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{title}</span>
              </button>
            </React.Fragment>
          ))}
        </nav>
      </aside>

      <main className="management-main overflow-y-auto" aria-label={page.title}>
        <div className="management-content">
          <ManagementHeader context={label('设置', 'Settings')} title={page.title} description={page.intro} actions={<>
            <button type="button" onClick={() => navigateHistory(historyIndex - 1)} disabled={historyIndex === 0} aria-label={label('后退', 'Back')} className="management-icon-button"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" onClick={() => navigateHistory(historyIndex + 1)} disabled={historyIndex >= history.current.length - 1} aria-label={label('前进', 'Forward')} className="management-icon-button"><ChevronRight className="h-4 w-4" /></button>
            {onClose && <button type="button" onClick={onClose} aria-label={label('关闭设置', 'Close settings')} className="management-icon-button"><X className="h-4 w-4" /></button>}
          </>} />

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
    </div>
  );
};
