import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../../store/appStore';
import { useCryptoStore } from '../../../store/cryptoStore';
import { useSessionStore } from '../../../store/sessionStore';
import { Lock, ShieldAlert } from 'lucide-react';

export interface SafeStorageTabProps {
  safeAction: 'none' | 'change' | 'disable' | 'enable';
  setSafeAction: (action: 'none' | 'change' | 'disable' | 'enable') => void;
  safeOldPwd: '';
  setSafeOldPwd: (val: string) => void;
  safeNewPwd: '';
  setSafeNewPwd: (val: string) => void;
  safeError: string;
  setSafeError: (val: string) => void;
  handleConfirmSafeAction: () => void;
}

export const SafeStorageTab: React.FC<SafeStorageTabProps> = ({
  safeAction,
  setSafeAction,
  safeOldPwd,
  setSafeOldPwd,
  safeNewPwd,
  setSafeNewPwd,
  safeError,
  setSafeError,
  handleConfirmSafeAction
}) => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const encryptionDisabled = useCryptoStore(state => state.encryptionDisabled);
  const masterPassword = useCryptoStore(state => state.masterPassword);

  return (
    <div className="space-y-8">
      <h4 className="text-4xl font-black tracking-tight flex items-center gap-4 text-white"><Lock className="w-10 h-10 text-emerald-500"/> {t("security.safeStorageTitle")}</h4>
      
      <div className="relative overflow-hidden p-8 bg-black/40 border border-emerald-500/20 flex flex-col gap-6 rounded-[32px] shadow-2xl backdrop-blur-xl">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-50 pointer-events-none" />
        
        <div className="relative z-10">
          {encryptionDisabled ? (
            <div className="p-6 border border-red-500/30 bg-red-500/10 rounded-2xl mb-8 shadow-sm">
               <h5 className="text-red-500 font-black mb-2 flex items-center gap-3 tracking-wide"><ShieldAlert className="w-5 h-5"/> {t('security.encryptionDisabledTitle')}</h5>
               <p className="text-xs text-red-500/80 leading-relaxed font-bold uppercase tracking-widest">{t('security.encryptionDisabledDesc')}</p>
            </div>
          ) : (
            <div className="p-6 border border-emerald-500/30 bg-emerald-500/10 rounded-2xl mb-8 shadow-sm">
               <h5 className="text-emerald-500 font-black mb-2 flex items-center gap-3 tracking-wide"><Lock className="w-5 h-5"/> {t('security.encryptionEnabledTitle')}</h5>
               <p className="text-xs text-emerald-500/80 leading-relaxed font-bold uppercase tracking-widest">{t('security.encryptionEnabledDesc')}</p>
            </div>
          )}

          {safeAction === 'none' ? (
               <div className="flex gap-4">
                 {!encryptionDisabled && !!masterPassword ? (
                    <>
                      <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSafeAction('change'); setSafeError(''); setSafeOldPwd(''); setSafeNewPwd(''); }} className={`py-4 px-8 text-sm font-black tracking-widest uppercase border border-white/10 transition-all shadow-sm rounded-xl flex-1 ${isDark ? 'bg-white/5 hover:bg-white/10 text-white' : 'bg-black/5 hover:bg-black/10 text-black'}`}>
                         {t('security.changeMasterPwd')}
                      </button>
                      <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSafeAction('disable'); setSafeError(''); setSafeOldPwd(''); }} className="py-4 px-8 text-sm font-black tracking-widest uppercase border border-red-500/30 text-red-500 bg-red-500/10 hover:bg-red-500 hover:text-white transition-all rounded-xl flex-1 shadow-[0_0_15px_rgba(239,68,68,0.2)]">
                         {t('security.disableEncryption')}
                      </button>
                    </>
                 ) : (
                    <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSafeAction('enable'); setSafeError(''); setSafeNewPwd(''); }} className={`py-4 px-8 text-sm font-black tracking-widest uppercase border border-emerald-500/30 bg-emerald-500/20 hover:bg-emerald-500 text-emerald-400 hover:text-white transition-all shadow-[0_0_20px_rgba(16,185,129,0.3)] rounded-xl w-full`}>
                       {t('security.enableEncryption')}
                    </button>
                 )}
               </div>
            ) : (
               <div className={`p-8 border space-y-6 shadow-2xl rounded-2xl ${isDark ? 'border-white/10 bg-black/60' : 'border-black/10 bg-white/60'} backdrop-blur-md`}>
                 {safeError && <div className="text-red-500 text-xs font-bold uppercase tracking-widest bg-red-500/10 p-4 leading-relaxed rounded-xl shadow-sm border border-red-500/20">{safeError}</div>}
                 
                 {(safeAction === 'change' || safeAction === 'disable') && (
                    <div>
                      <label className="block text-xs font-bold text-white/40 mb-3 uppercase tracking-widest">{t('security.currentPwd')}</label>
                      <input autoFocus type="password" value={safeOldPwd} onChange={e => setSafeOldPwd(e.target.value)} className={`w-full p-4 border text-sm font-mono tracking-widest outline-none transition-all rounded-xl focus:border-emerald-500/50 shadow-inner ${isDark ? 'bg-black/50 border-white/10 text-emerald-500 focus:bg-black/80' : 'bg-white border-black/10 text-emerald-600'}`} placeholder="••••••••••••" />
                    </div>
                 )}
                 
                 {(safeAction === 'change' || safeAction === 'enable') && (
                    <div>
                      <label className="block text-xs font-bold text-white/40 mb-3 uppercase tracking-widest">{t('security.newPwd')}</label>
                      <input autoFocus={safeAction === 'enable'} type="password" value={safeNewPwd} onChange={e => setSafeNewPwd(e.target.value)} className={`w-full p-4 border text-sm font-mono tracking-widest outline-none transition-all rounded-xl focus:border-emerald-500/50 shadow-inner ${isDark ? 'bg-black/50 border-white/10 text-emerald-500 focus:bg-black/80' : 'bg-white border-black/10 text-emerald-600'}`} placeholder="••••••••••••" />
                    </div>
                 )}

                 {safeAction === 'disable' && (
                    <div className="text-xs text-red-500 font-bold uppercase tracking-widest bg-red-500/10 p-4 leading-relaxed rounded-xl border border-red-500/20">{t('security.warningPlaintext')}</div>
                 )}

                 <div className="flex gap-4 pt-6 mt-6 border-t border-white/5">
                    <button onClick={() => setSafeAction('none')} className={`flex-1 py-4 px-6 text-sm font-black tracking-widest uppercase border transition-all rounded-xl shadow-sm ${isDark ? 'border-white/20 text-white hover:bg-white/10' : 'border-black/20 text-black hover:bg-black/5'}`}>{t('security.cancel')}</button>
                    <button onClick={handleConfirmSafeAction} className="flex-1 py-4 px-6 text-sm font-black tracking-widest uppercase bg-emerald-500 hover:bg-emerald-400 text-emerald-950 transition-all shadow-[0_0_20px_rgba(16,185,129,0.4)] rounded-xl">{t('security.confirm')}</button>
                 </div>
               </div>
            )}
        </div>
      </div>
    </div>
  );
};
