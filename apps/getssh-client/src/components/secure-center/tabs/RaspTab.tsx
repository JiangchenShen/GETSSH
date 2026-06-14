import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../../store/appStore';
import { Cpu } from 'lucide-react';

export const RaspTab: React.FC = () => {
  const { t } = useTranslation();
  const appConfig = useAppStore(state => state.appConfig);
  const updateConfig = useAppStore(state => state.updateConfig);

  return (
    <div className="space-y-8">
      <h4 className="text-4xl font-black tracking-tight flex items-center gap-4 text-white"><Cpu className="w-10 h-10 text-emerald-500"/> {t("security.raspTitle")}</h4>
      <div className="relative overflow-hidden p-8 bg-black/40 border border-emerald-500/20 flex flex-col gap-6 rounded-[32px] shadow-2xl backdrop-blur-xl">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-50 pointer-events-none" />
        <div className="relative z-10">
          <label className="block text-xs font-bold text-white/40 mb-3 uppercase tracking-widest flex items-center gap-2"><Cpu className="w-4 h-4 text-emerald-500" /> {t('security.globalInitScript')}</label>
          <textarea 
            value={appConfig.initScript || ''} 
            onChange={(e) => updateConfig('initScript', e.target.value)} 
            rows={6}
            placeholder={t('security.globalInitScriptPlaceholder') as string} 
            className="w-full p-5 bg-black/60 border border-white/10 outline-none resize-none font-mono text-sm shadow-inner transition-all focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50 rounded-2xl text-emerald-400 placeholder:text-white/10" 
          />
          <div className="text-xs text-white/30 mt-4 font-bold leading-relaxed">{t('security.globalInitScriptDesc')}</div>
        </div>
      </div>
    </div>
  );
};
