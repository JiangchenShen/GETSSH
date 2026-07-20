import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store/appStore';
import { Shield, ShieldAlert, Cpu, EyeOff, Lock, Server, ShieldOff } from 'lucide-react';

export interface SecureSidebarProps {
  securePage: string;
  setSecurePage: (page: 'rasp' | 'privacy' | 'safe_storage' | 'known_hosts' | 'shield_details') => void;
  setSafeAction?: (action: 'none' | 'change' | 'disable' | 'enable') => void;
}

export const SecureSidebar: React.FC<SecureSidebarProps> = ({ securePage, setSecurePage }) => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const watchdogStatus = useAppStore(state => state.watchdogStatus);

  const isWatchdogDisabled = !!watchdogStatus?.watchdogDisabled;
  const isDanger = !!watchdogStatus && (
    isWatchdogDisabled ||
    (watchdogStatus.status !== 'secure' && (
      watchdogStatus.level === 'red' || 
      (watchdogStatus.status === 'warning' && watchdogStatus.level !== 'yellow')
    ))
  );
  const isWarning = !!watchdogStatus && !isWatchdogDisabled && watchdogStatus.status !== 'secure' && watchdogStatus.level === 'yellow';

  const getShieldClass = () => {
    if (isDanger) return 'bg-red-500/10 border-red-500/30 hover:bg-red-500/20 hover:border-red-500/50' + (securePage === 'shield_details' ? ' ring-1 ring-red-500/30' : '');
    if (isWarning) return 'bg-yellow-500/10 border-yellow-500/30 hover:bg-yellow-500/20 hover:border-yellow-500/50' + (securePage === 'shield_details' ? ' ring-1 ring-yellow-500/30' : '');
    
    if (isWatchdogDisabled) return (isDark ? 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20' : 'bg-black/5 border-black/10 hover:bg-black/10 hover:border-black/20') + (securePage === 'shield_details' ? (isDark ? ' ring-1 ring-white/20' : ' ring-1 ring-black/20') : '');
    
    if (securePage === 'shield_details') return isDark ? 'bg-emerald-500/10 border-emerald-500/30 ring-1 ring-emerald-500/30' : 'bg-emerald-500/10 border-emerald-500/20 ring-1 ring-emerald-500/20';
    if (!watchdogStatus) return isDark ? 'bg-white/5 border-transparent hover:bg-white/10 hover:border-white/20' : 'bg-black/5 border-transparent hover:bg-black/10 hover:border-black/20';
    
    return 'bg-green-500/5 border-green-500/20 hover:bg-green-500/10 hover:border-green-500/30';
  };
  const shieldClass = getShieldClass();

  return (
    <div className={`w-80 p-8 flex flex-col gap-6 border-r ${isDark ? 'border-white/5 bg-black/20' : 'border-black/5 bg-white/30'} backdrop-blur-md`}>
      
      {/* Breathing Shield Widget */}
      <button 
        onClick={() => setSecurePage('shield_details')}
        className={`w-full p-8 flex flex-col items-center justify-center gap-5 transition-all group cursor-pointer border rounded-[32px] relative overflow-hidden shadow-lg ${shieldClass}`}
      >
        {!isWatchdogDisabled && watchdogStatus?.status === 'secure' && <div className="absolute inset-0 bg-gradient-to-b from-green-500/10 to-transparent opacity-50 pointer-events-none" />}
        
        {isWatchdogDisabled && !isDanger && !isWarning ? (
          <ShieldAlert className="w-28 h-28 text-white/20 group-hover:scale-105 transition-transform relative z-10 drop-shadow-md" />
        ) : isDanger ? (
          <ShieldAlert className="w-28 h-28 text-red-500 drop-shadow-[0_0_30px_rgba(239,68,68,0.6)] animate-bounce group-hover:scale-105 transition-transform relative z-10" />
        ) : isWarning ? (
          <ShieldAlert className="w-28 h-28 text-yellow-500 drop-shadow-[0_0_30px_rgba(234,179,8,0.6)] animate-pulse group-hover:scale-105 transition-transform relative z-10" />
        ) : watchdogStatus?.status === 'secure' ? (
          <Shield className="w-28 h-28 text-green-500 drop-shadow-[0_0_30px_rgba(34,197,94,0.6)] animate-pulse group-hover:scale-105 transition-transform relative z-10" />
        ) : (
          <Shield className="w-28 h-28 opacity-20 animate-pulse group-hover:scale-105 transition-transform relative z-10" />
        )}
        <div className="text-center mt-2 relative z-10">
          <h3 className={`text-[17px] font-black tracking-tight mb-1 whitespace-nowrap overflow-visible ${isDanger ? 'text-red-500' : isWarning ? 'text-yellow-600' : (isDark ? 'text-white' : 'text-slate-800')}`}>
            {!watchdogStatus ? t("security.watchdogConnecting") : 
             isWatchdogDisabled
               ? t("security.watchdogDisabled", "Unavailable (Disabled)")
               : watchdogStatus.status === 'secure' ? t("security.watchdogSecure") : 
             t("security.watchdogWarning")}
          </h3>
          <p className={`text-[10px] font-bold uppercase tracking-widest ${isDark ? 'text-white/50' : 'text-slate-500'}`}>{t("security.shieldClickToDetails", "View Details")}</p>
        </div>
      </button>

      {/* Navigation Menu */}
      <nav className="flex flex-col gap-1 overflow-y-auto pb-4">
         {(() => {
           const activeItemClass = isDark ? 'bg-emerald-500/10 text-emerald-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_0_10px_rgba(16,185,129,0.1)]' : 'bg-emerald-500/10 text-emerald-700 shadow-sm';
           const inactiveItemClass = isDark ? 'text-white/50 hover:text-white hover:bg-white/5' : 'text-slate-500 hover:text-slate-900 hover:bg-black/5';
           const baseItemClass = 'flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-all text-left font-bold border border-transparent';
           
           return (
             <>
               <div className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1 mt-4 px-4">{t('security.categoryEngine', 'Core Protection Engine')}</div>
               <button onClick={() => setSecurePage('rasp')} className={`${baseItemClass} ${securePage === 'rasp' ? activeItemClass : inactiveItemClass}`}><Cpu className="w-4 h-4"/>{t("security.raspTitle")}</button>
               <button onClick={() => setSecurePage('privacy')} className={`${baseItemClass} ${securePage === 'privacy' ? activeItemClass : inactiveItemClass}`}><EyeOff className="w-4 h-4"/>{t("security.privacyTitle")}</button>
               
               <div className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1 mt-4 px-4">{t('security.categoryData', 'Data & Privacy')}</div>
               <button onClick={() => setSecurePage('safe_storage')} className={`${baseItemClass} ${securePage === 'safe_storage' ? activeItemClass : inactiveItemClass}`}><Lock className="w-4 h-4"/>{t("security.safeStorageTitle")}</button>
               <button onClick={() => setSecurePage('isolation_rules')} className={`${baseItemClass} ${securePage === 'isolation_rules' ? activeItemClass : inactiveItemClass}`}><ShieldOff className="w-4 h-4"/>{t("workspaceCenter.isolationRulesTitle", "Isolation Rules")}</button>
               
               <div className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1 mt-4 px-4">{t('security.categoryNetwork', 'Network Management')}</div>
               <button onClick={() => setSecurePage('known_hosts')} className={`${baseItemClass} ${securePage === 'known_hosts' ? activeItemClass : inactiveItemClass}`}><Server className="w-4 h-4"/>{t("security.knownHostsTitle")}</button>
             </>
           );
         })()}
      </nav>
    </div>
  );
};
