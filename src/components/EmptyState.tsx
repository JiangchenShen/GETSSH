import React from 'react';
import { Terminal as TerminalIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const EmptyState: React.FC = () => {
  const { t } = useTranslation();
  
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="opacity-30 flex flex-col items-center gap-4">
        <TerminalIcon className="w-16 h-16" />
        <p className="text-sm font-medium tracking-widest uppercase">{t('sidebar.emptyState')}</p>
      </div>
    </div>
  );
};
