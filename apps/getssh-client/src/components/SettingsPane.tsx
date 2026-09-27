import React, { useEffect, useState } from 'react';
import { SETTINGS_TABS, SettingsView, type SettingsTab } from './SettingsView';

export const SettingsPane: React.FC<{ initialTab?: SettingsTab }> = ({ initialTab = 'System' }) => {
  const [settingsActiveTab, setSettingsActiveTab] = useState<SettingsTab>(initialTab);

  useEffect(() => setSettingsActiveTab(initialTab), [initialTab]);

  useEffect(() => {
    const selectTab = (event: Event) => {
      const tab = (event as CustomEvent<SettingsTab>).detail;
      if (SETTINGS_TABS.includes(tab)) setSettingsActiveTab(tab);
    };
    window.addEventListener('app:settings-tab', selectTab);
    return () => window.removeEventListener('app:settings-tab', selectTab);
  }, []);

  return <SettingsView settingsActiveTab={settingsActiveTab} setSettingsActiveTab={setSettingsActiveTab} />;
};
