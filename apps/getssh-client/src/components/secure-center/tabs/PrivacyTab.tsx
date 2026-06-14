import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../../store/appStore';
import { EyeOff, Shield } from 'lucide-react';

export const PrivacyTab: React.FC = () => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const appConfig = useAppStore(state => state.appConfig);
  const updateConfig = useAppStore(state => state.updateConfig);

  return (
    <div className="space-y-8">
      <h4 className="text-4xl font-black tracking-tight flex items-center gap-4 text-white"><EyeOff className="w-10 h-10 text-emerald-500"/> {t("security.privacyTitle")}</h4>
      
      <div className="relative overflow-hidden p-8 bg-black/40 border border-emerald-500/20 flex flex-col gap-8 rounded-[32px] shadow-2xl backdrop-blur-xl">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-50 pointer-events-none" />
        
        <div className="relative z-10 flex flex-col gap-6">
          <label className={`flex items-center gap-5 cursor-pointer p-6 border transition-all rounded-2xl shadow-sm ${isDark ? 'border-white/10 hover:border-emerald-500/30 bg-black/40' : 'border-black/10 hover:border-emerald-500/30 bg-white/40'}`}>
            <div className="shrink-0 flex items-center justify-center">
              <div className={`w-10 h-6 rounded-full p-1 transition-colors ${appConfig.privacyMode ? 'bg-emerald-500' : 'bg-white/20'}`}>
                <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${appConfig.privacyMode ? 'translate-x-4' : 'translate-x-0'}`} />
              </div>
              <input type="checkbox" checked={appConfig.privacyMode || false} onChange={(e) => updateConfig('privacyMode', e.target.checked)} className="hidden" />
            </div>
            <div>
              <div className="text-lg font-black tracking-wide flex items-center gap-3 text-white">{t('security.privacyMode')} <Shield className="w-4 h-4 text-emerald-500" /></div>
              <div className="text-xs text-white/50 mt-2 font-bold leading-relaxed tracking-wide">{t('security.privacyModeDesc')}</div>
            </div>
          </label>
          
          <div className={`p-6 border transition-all rounded-2xl shadow-sm ${isDark ? 'border-white/10 bg-black/40' : 'border-black/10 bg-white/40'}`}>
            <label className="block text-xs font-bold text-white/40 mb-3 uppercase tracking-widest">{t('security.autoLockTitle')}</label>
            <select 
              value={appConfig.autoLockTimeout || 0}
              onChange={(e) => updateConfig('autoLockTimeout', parseInt(e.target.value) || 0)}
              className={`w-full p-4 border text-sm font-bold outline-none shadow-sm transition-all rounded-xl focus:border-emerald-500/50 appearance-none ${isDark ? 'bg-black/60 border-white/10 text-white focus:bg-black/80' : 'bg-white border-slate-200 text-slate-800'}`}
            >
              <option value={0}>{t('security.autoLockOff')}</option>
              <option value={5}>5 {t('security.minutes')}</option>
              <option value={15}>15 {t('security.minutes')}</option>
              <option value={30}>30 {t('security.minutes')}</option>
              <option value={60}>1 {t('security.hour')}</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};
