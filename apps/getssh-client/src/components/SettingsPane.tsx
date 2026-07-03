import React, { useState } from 'react';
import { SettingsView } from './SettingsView';

export const SettingsPane: React.FC = () => {
  const [settingsActiveTab, setSettingsActiveTab] = useState<'Appearance'|'Terminal'|'SSH'|'System'|'About'|'Audit'>('Appearance');
  
  // Note: encryptionDisabled isn't actually in AppStore normally but SettingsView wants it.
  // We can pass false or get it from wherever it was fetched in App.tsx
  const encryptionDisabled = false; 

  return (
    <div className="w-full h-full flex overflow-hidden">
      <SettingsView 
        settingsActiveTab={settingsActiveTab}
        setSettingsActiveTab={setSettingsActiveTab}
        encryptionDisabled={encryptionDisabled}
      />
    </div>
  );
};
