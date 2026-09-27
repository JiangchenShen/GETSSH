import React from 'react';
import { useTranslation } from 'react-i18next';
import { Settings2 } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { PluginSettings } from './PluginSettings';

export const PluginCenterModal: React.FC = () => {
  const { t, i18n } = useTranslation();
  const glass = useAppStore(state => state.appConfig.enableGlassmorphism);
  return <main className="center-workbench h-full min-w-0 overflow-y-auto bg-bg px-7 py-7 text-ink max-[690px]:px-4" data-glass={glass ? 'true' : 'false'}>
    <div className="mx-auto max-w-4xl">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3 border-b border-line pb-5"><div><h1 className="text-[22px] font-semibold tracking-tight">{t('pluginCenter.title', 'Plugin Center')}</h1><p className="mt-1 text-sm text-ink-2">{i18n.language.startsWith('zh') ? '管理已安装插件和本地扩展包。' : 'Manage installed plugins and local extension packages.'}</p></div><button type="button" onClick={() => window.dispatchEvent(new CustomEvent('app:open-center', { detail: { type: 'settings', title: t('statusBar.settings'), settingsTab: 'Security' } }))} className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-line bg-panel px-3 text-xs text-ink-2 hover:bg-surf hover:text-ink focus-visible:outline-2 focus-visible:outline-primary"><Settings2 className="h-3.5 w-3.5" />{i18n.language.startsWith('zh') ? '插件权限' : 'Plugin permissions'}</button></header>
      <PluginSettings />
    </div>
  </main>;
};
