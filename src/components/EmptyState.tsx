import React from 'react';
import { Terminal as TerminalIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const EmptyState: React.FC = () => {
  const { t } = useTranslation();
  
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="flex flex-col items-center gap-6 max-w-sm">
        <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-inner">
          <TerminalIcon className="w-10 h-10" />
        </div>
        <div>
          <h2 className="text-2xl font-bold tracking-tight mb-2 opacity-90">{t('welcome.title')}</h2>
          <p className="text-sm opacity-50">{t('welcome.subtitle')}</p>
        </div>
        <button 
          className="mt-4 px-6 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-white font-medium shadow-lg shadow-primary/20 transition-all active:scale-95"
          onClick={() => {
            const btn = document.querySelector('button[aria-label="New Connection"], button[title="New Connection"], button[title="New Connection"]');
            if (btn) (btn as HTMLButtonElement).click();
          }}
        >
          {t('welcome.quickConnect')}
        </button>
      </div>
    </div>
  );
};
