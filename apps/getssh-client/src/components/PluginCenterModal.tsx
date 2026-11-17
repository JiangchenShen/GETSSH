import React from 'react';
import { useTranslation } from 'react-i18next';
import { Settings2 } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { PluginSettings } from './PluginSettings';
import { ManagementHeader } from './ManagementSurface';
import { settingButtonClass } from './settings/SettingsControls';

export const PluginCenterModal: React.FC = () => {
  const { t, i18n } = useTranslation();
  const glass = useAppStore(state => state.appConfig.enableGlassmorphism);
  const zh = i18n.language.startsWith('zh');
  const openPermissions = () => window.dispatchEvent(new CustomEvent('app:open-center', {
    detail: { type: 'settings', title: t('statusBar.settings'), settingsTab: 'Security' },
  }));

  return (
    <div className="center-workbench management-center h-full bg-bg text-ink" data-glass={glass ? 'true' : 'false'}>
      <main className="management-main h-full overflow-y-auto" aria-label={t('pluginCenter.title', 'Plugin Center')}>
        <div className="management-content">
          <ManagementHeader
            title={t('pluginCenter.title', 'Plugin Center')}
            description={zh ? '管理已安装插件和本地扩展包。' : 'Manage installed plugins and local extension packages.'}
            actions={<button type="button" onClick={openPermissions} className={settingButtonClass}>
              <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />{zh ? '插件权限' : 'Plugin permissions'}
            </button>}
          />
          <PluginSettings />
        </div>
      </main>
    </div>
  );
};
