import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, ShieldCheck, Lock, Fingerprint, Loader2, KeyRound } from 'lucide-react';
import { useAppStore } from '../../../store/appStore';
import { useCryptoStore } from '../../../store/cryptoStore';
import { promptWebAuthn } from '../../../utils/webauthn';

export interface SafeStorageTabProps {
  safeAction: 'none' | 'change' | 'disable' | 'enable';
  setSafeAction: (action: 'none' | 'change' | 'disable' | 'enable') => void;
  safeOldPwd?: string;
  setSafeOldPwd?: (val: string) => void;
  safeNewPwd?: string;
  setSafeNewPwd?: (val: string) => void;
  safeError?: string;
  setSafeError?: (val: string) => void;
  handleConfirmSafeAction: () => void;
  biometricEnabled?: boolean;
  onToggleBiometric?: (enabled: boolean) => void;
  isMainWorkspace?: boolean;
}

export const SafeStorageTab: React.FC<SafeStorageTabProps> = ({
  safeAction,
  setSafeAction,
  safeOldPwd = '',
  setSafeOldPwd = () => {},
  safeNewPwd = '',
  setSafeNewPwd = () => {},
  safeError = '',
  setSafeError = () => {},
  handleConfirmSafeAction,
  biometricEnabled = false,
  onToggleBiometric
}) => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const encryptionDisabled = useCryptoStore(state => state.encryptionDisabled);
  const masterPassword = useCryptoStore(state => state.masterPassword);

  const [globalLockEnabled, setGlobalLockEnabled] = useState(false);
  const [globalWebAuthnType, setGlobalWebAuthnType] = useState<string | null>(null);
  
  const [globalAction, setGlobalAction] = useState<'none' | 'setup' | 'disable'>('none');
  const [globalPwd, setGlobalPwd] = useState('');
  const [globalPwdConfirm, setGlobalPwdConfirm] = useState('');
  const [globalDisablePwd, setGlobalDisablePwd] = useState('');
  const [globalError, setGlobalError] = useState('');
  const [globalLoading, setGlobalLoading] = useState(false);

  useEffect(() => {
    loadGlobalSettings();
  }, []);

  const loadGlobalSettings = async () => {
    const hash = await window.electronAPI.getGlobalSetting('app_boot_password_hash');
    const authType = await window.electronAPI.getGlobalSetting('app_boot_webauthn_type');
    setGlobalLockEnabled(!!hash);
    setGlobalWebAuthnType(authType);
  };

  const hashPassword = async (pwd: string): Promise<string> => {
    const encoder = new TextEncoder();
    const data = encoder.encode(pwd);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const handleGlobalLockConfirm = async () => {
    if (globalAction === 'setup') {
      if (globalPwd.length < 8) {
        setGlobalError(t('crypto.passwordTooShort', 'Password too short (min 8 chars)'));
        return;
      }
      if (globalPwd !== globalPwdConfirm) {
        setGlobalError(t('crypto.passwordMismatch', 'Passwords do not match'));
        return;
      }
    }
    if (globalAction === 'disable') {
      if (!globalDisablePwd) {
        setGlobalError(t('security.errEmptyPwd', 'Please enter your current password'));
        return;
      }
      const storedHash = await window.electronAPI.getGlobalSetting('app_boot_password_hash');
      const inputHash = await hashPassword(globalDisablePwd);
      if (inputHash !== storedHash) {
        setGlobalError(t('security.errWrongOldPwd', 'Incorrect password'));
        return;
      }
    }

    setGlobalLoading(true);
    setGlobalError('');

    try {
       if (globalAction === 'setup') {
         const hashHex = await hashPassword(globalPwd);
         await window.electronAPI.setGlobalSetting('app_boot_password_hash', hashHex);
       } else if (globalAction === 'disable') {
         await window.electronAPI.setGlobalSetting('app_boot_password_hash', '');
         await window.electronAPI.setGlobalSetting('app_boot_webauthn_type', '');
       }
       setGlobalAction('none');
       setGlobalPwd('');
       setGlobalPwdConfirm('');
       setGlobalDisablePwd('');
       loadGlobalSettings();
    } catch (e) {
       setGlobalError('Failed to save settings');
    } finally {
       setGlobalLoading(false);
    }
  };

  const handleGlobalWebAuthnBind = async (type: 'platform' | 'cross-platform' | 'any') => {
    try {
      if (type === 'platform') {
        const res = await window.electronAPI.promptTouchID('Authenticate to enable OS Biometrics');
        if (res && res.success) {
           await window.electronAPI.setGlobalSetting('app_boot_webauthn_type', 'NativeBiometrics');
           loadGlobalSettings();
        }
        return; // Always return for platform type — don't fall through to WebAuthn
      } else {
        alert(t('security.insertFido', 'Please insert and touch your YubiKey / FIDO key now...'));
      }

      const success = await promptWebAuthn(type === 'any' ? undefined : type);
      if (success) {
         await window.electronAPI.setGlobalSetting('app_boot_webauthn_type', type);
         loadGlobalSettings();
         alert('WebAuthn Security Key bound successfully for App Lock!');
      }
    } catch (e: any) {
      if (e?.message === 'MAC_WEBAUTHN_BLOCKED') {
        alert(t('security.errMacWebAuthnBlocked', 'macOS blocked FIDO/Passkey. App needs Apple Developer Entitlements.'));
      } else {
        alert('Failed to bind Security Key.');
      }
    }
  };

  const handleWorkspaceWebAuthnBind = async (type: 'platform' | 'cross-platform' | 'any') => {
    try {
      if (type === 'platform') {
        const res = await window.electronAPI.promptTouchID('Authenticate to bind Touch ID / Windows Hello');
        if (res && res.success) {
           if (onToggleBiometric) onToggleBiometric(true);
           alert('Native Biometrics bound successfully for Workspace Vault Lock!');
        }
        return; // Always return for platform type — don't fall through to WebAuthn
      } else {
        alert(t('security.insertFido', 'Please insert and touch your YubiKey / FIDO key now...'));
      }

      const success = await promptWebAuthn(type === 'any' ? undefined : type);
      if (success) {
         if (onToggleBiometric) onToggleBiometric(true);
         alert('WebAuthn Security Key bound successfully for Workspace Vault Lock!');
      }
    } catch (e: any) {
      if (e?.message === 'MAC_WEBAUTHN_BLOCKED') {
        alert(t('security.errMacWebAuthnBlocked', 'macOS blocked FIDO/Passkey. App needs Apple Developer Entitlements.'));
      } else {
        alert('Failed to bind Security Key.');
      }
    }
  };

  return (
    <div className="w-full flex flex-col gap-10">
      
      {/* Global Application Lock */}
      <div className="relative overflow-hidden p-8 bg-black/40 border border-purple-500/20 flex flex-col gap-6 rounded-[32px] shadow-2xl backdrop-blur-xl">
        <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent opacity-50 pointer-events-none" />
        <div className="relative z-10">
          <h3 className="text-xl font-black text-purple-400 uppercase tracking-widest mb-4 flex items-center gap-3">
             <KeyRound className="w-6 h-6" /> {t('security.globalAppLockTitle', 'Global Application Lock')}
          </h3>
          <p className="text-sm text-purple-200/50 mb-8 leading-relaxed font-bold">{t('security.globalAppLockDesc', 'This lock protects the entire GETSSH application from being opened by unauthorized users, acting as the first line of defense before any workspace can be accessed. (Supports Touch ID / Biometrics)')}</p>
          
          {globalAction === 'none' ? (
            <div className="flex flex-col gap-6">
              <div className={`p-6 border rounded-2xl shadow-sm ${globalLockEnabled ? 'border-purple-500/30 bg-purple-500/10' : 'border-white/10 bg-white/5'}`}>
                 <h5 className={`${globalLockEnabled ? 'text-purple-500' : 'text-white/50'} font-black mb-2 flex items-center gap-3 tracking-wide`}>
                   {globalLockEnabled ? <ShieldCheck className="w-5 h-5"/> : <ShieldAlert className="w-5 h-5"/>} 
                   {globalLockEnabled ? t('security.appLockEnabled', 'App Lock Enabled') : t('security.appLockDisabled', 'App Lock Disabled')}
                 </h5>
              </div>

              <div className="flex gap-4">
                 {globalLockEnabled ? (
                   <button onClick={() => setGlobalAction('disable')} className="py-4 px-8 text-sm font-black tracking-widest uppercase border border-red-500/30 text-red-500 bg-red-500/10 hover:bg-red-500 hover:text-white transition-all rounded-xl shadow-sm flex-1">
                     {t('security.disableAppLock', 'Disable App Lock')}
                   </button>
                 ) : (
                   <button onClick={() => setGlobalAction('setup')} className="py-4 px-8 text-sm font-black tracking-widest uppercase border border-purple-500/30 bg-purple-500/20 hover:bg-purple-500 text-purple-400 hover:text-white transition-all shadow-[0_0_20px_rgba(168,85,247,0.3)] rounded-xl w-full">
                     {t('security.setupAppLock', 'Setup App Lock Password')}
                   </button>
                 )}
              </div>

              {globalLockEnabled && (
                <div className={`p-6 border rounded-2xl flex flex-col gap-4 ${isDark ? 'border-white/10 bg-black/40' : 'border-black/10 bg-white/40'}`}>
                  <div className="font-black uppercase tracking-widest text-sm text-purple-500 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Fingerprint className="w-5 h-5" /> {t('security.osBiometrics', 'OS Biometrics / Touch ID')}
                    </div>
                    {globalWebAuthnType === 'NativeBiometrics' && (
                      <span className="text-xs text-emerald-400 bg-emerald-400/10 px-3 py-1 rounded-full">{t('security.enabled', 'Enabled')}</span>
                    )}
                  </div>
                  <p className="text-xs text-white/40 font-bold leading-relaxed">
                    {t('security.osBiometricsDesc', 'Require OS authentication (Touch ID, Windows Hello, or System Password) to unlock GETSSH. This adds a seamless layer of security.')}
                  </p>
                  <div className="flex gap-4 mt-2">
                    {globalWebAuthnType !== 'NativeBiometrics' ? (
                      <button onClick={() => handleGlobalWebAuthnBind('platform')} className="py-3 px-4 text-xs font-bold tracking-widest uppercase border border-white/10 hover:bg-white/10 rounded-lg flex-1 transition-all">
                        {t('security.enableOsAuth', 'Enable OS Authentication')}
                      </button>
                    ) : (
                      <button onClick={async () => {
                        await window.electronAPI.setGlobalSetting('app_boot_webauthn_type', '');
                        loadGlobalSettings();
                      }} className="py-3 px-4 text-xs font-bold tracking-widest text-red-400 uppercase border border-red-500/20 hover:bg-red-500/20 rounded-lg transition-all">
                        {t('security.disableOsAuth', 'Disable OS Authentication')}
                      </button>
                    )}
                  </div>

                  <div className="mt-4 pt-4 border-t border-white/5">
                    <div className="font-black uppercase tracking-widest text-xs text-purple-500 flex items-center gap-2 mb-2">
                      <KeyRound className="w-4 h-4" /> {t('security.hardwarePasskeyBinding', 'Hardware / Passkey Binding (High Security)')}
                    </div>
                    <div className="flex gap-4">
                      <button onClick={() => handleGlobalWebAuthnBind('cross-platform')} className="py-3 px-4 text-xs font-bold tracking-widest uppercase border border-white/10 hover:bg-white/10 rounded-lg flex-1 transition-all">
                        {t('security.bindYubiKey', 'Bind YubiKey / FIDO2')}
                      </button>
                      <button onClick={() => handleGlobalWebAuthnBind('any')} className="py-3 px-4 text-xs font-bold tracking-widest uppercase border border-white/10 hover:bg-white/10 rounded-lg flex-1 transition-all">
                        {t('security.bindPasskey', 'Bind Passkey (Cloud)')}
                      </button>
                    </div>
                    {globalWebAuthnType && globalWebAuthnType !== 'NativeBiometrics' && <div className="text-xs text-purple-400 mt-2 font-bold uppercase">{t('security.currentlyBound', 'Currently Bound')}: {globalWebAuthnType}</div>}
                  </div>
                </div>
              )}
            </div>
          ) : (
             <div className={`p-8 border space-y-6 shadow-2xl rounded-2xl ${isDark ? 'border-white/10 bg-black/60' : 'border-black/10 bg-white/60'} backdrop-blur-md`}>
               {globalError && <div className="text-red-500 text-xs font-bold uppercase tracking-widest bg-red-500/10 p-4 leading-relaxed rounded-xl shadow-sm border border-red-500/20">{globalError}</div>}
               
               {globalAction === 'setup' && (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-white/40 mb-3 uppercase tracking-widest">{t('security.newAppBootPwd', 'New App Boot Password')}</label>
                      <input autoFocus type="password" value={globalPwd} onChange={e => setGlobalPwd(e.target.value)} className={`w-full p-4 border text-sm font-mono tracking-widest outline-none transition-all rounded-xl focus:border-purple-500/50 shadow-inner ${isDark ? 'bg-black/50 border-white/10 text-purple-500 focus:bg-black/80' : 'bg-white border-black/10 text-purple-600'}`} placeholder="••••••••••••" />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-white/40 mb-3 uppercase tracking-widest">{t('security.confirmAppBootPwd', 'Confirm App Boot Password')}</label>
                      <input type="password" value={globalPwdConfirm} onChange={e => setGlobalPwdConfirm(e.target.value)} className={`w-full p-4 border text-sm font-mono tracking-widest outline-none transition-all rounded-xl focus:border-purple-500/50 shadow-inner ${isDark ? 'bg-black/50 border-white/10 text-purple-500 focus:bg-black/80' : 'bg-white border-black/10 text-purple-600'}`} placeholder="••••••••••••" />
                    </div>
                  </>
               )}
               {globalAction === 'disable' && (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-white/40 mb-3 uppercase tracking-widest">{t('security.currentPwd', 'Current Password')}</label>
                      <input autoFocus type="password" value={globalDisablePwd} onChange={e => setGlobalDisablePwd(e.target.value)} className={`w-full p-4 border text-sm font-mono tracking-widest outline-none transition-all rounded-xl focus:border-red-500/50 shadow-inner ${isDark ? 'bg-black/50 border-white/10 text-red-500 focus:bg-black/80' : 'bg-white border-black/10 text-red-600'}`} placeholder="••••••••••••" />
                    </div>
                    <div className="text-xs text-red-500 font-bold uppercase tracking-widest bg-red-500/10 p-4 leading-relaxed rounded-xl border border-red-500/20">{t('security.warningAppLockDisable', 'Warning: Removing the global app lock means anyone with OS access can open the GETSSH application.')}</div>
                  </>
               )}
               
               <div className="flex gap-4 pt-6 mt-6 border-t border-white/5">
                  <button onClick={() => setGlobalAction('none')} className={`flex-1 py-4 px-6 text-sm font-black tracking-widest uppercase border transition-all rounded-xl shadow-sm ${isDark ? 'border-white/20 text-white hover:bg-white/10' : 'border-black/20 text-black hover:bg-black/5'}`}>{t('security.cancel')}</button>
                  <button onClick={handleGlobalLockConfirm} disabled={globalLoading} className="flex-1 py-4 px-6 text-sm font-black tracking-widest uppercase bg-purple-500 hover:bg-purple-400 text-purple-950 transition-all shadow-[0_0_20px_rgba(168,85,247,0.4)] rounded-xl flex items-center justify-center gap-2">
                    {globalLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : t('security.confirm')}
                  </button>
               </div>
             </div>
          )}
        </div>
      </div>

      {/* Active Workspace Vault Lock */}
      <div className="relative overflow-hidden p-8 bg-black/40 border border-emerald-500/20 flex flex-col gap-6 rounded-[32px] shadow-2xl backdrop-blur-xl">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-50 pointer-events-none" />
        
        <div className="relative z-10">
          <h3 className="text-xl font-black text-emerald-400 uppercase tracking-widest mb-4 flex items-center gap-3">
             <Lock className="w-6 h-6" /> {t('security.workspaceVaultLockTitle', 'Workspace Vault Lock')}
          </h3>
          <p className="text-sm text-emerald-200/50 mb-8 leading-relaxed font-bold">{t('security.workspaceVaultLockDesc', 'This lock protects the sensitive assets (SSH Private Keys, Runbooks, Configs) in your current active workspace independently from other workspaces.')}</p>

          {encryptionDisabled ? (
            <div className="p-6 border border-red-500/30 bg-red-500/10 rounded-2xl mb-8 shadow-sm">
               <h5 className="text-red-500 font-black mb-2 flex items-center gap-3 tracking-wide"><ShieldAlert className="w-5 h-5"/> {t('security.encryptionDisabledTitle')}</h5>
               <p className="text-xs text-red-500/80 leading-relaxed font-bold uppercase tracking-widest">{t('security.encryptionDisabledDesc')}</p>
            </div>
          ) : (
            <div className="p-6 border border-emerald-500/30 bg-emerald-500/10 rounded-2xl mb-8 shadow-sm">
               <h5 className="text-emerald-500 font-black mb-2 flex items-center gap-3 tracking-wide"><ShieldCheck className="w-5 h-5"/> {t('security.encryptionEnabledTitle')}</h5>
               <p className="text-xs text-emerald-500/80 leading-relaxed font-bold uppercase tracking-widest">{t('security.encryptionEnabledDesc')}</p>
            </div>
          )}

          {safeAction === 'none' ? (
               <div className="flex gap-4">
                 {!encryptionDisabled && !!masterPassword ? (
                    <div className="flex flex-col gap-4 w-full">
                      <div className="flex gap-4">
                        <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSafeAction('change'); setSafeError(''); setSafeOldPwd(''); setSafeNewPwd(''); }} className={`py-4 px-8 text-sm font-black tracking-widest uppercase border border-white/10 transition-all shadow-sm rounded-xl flex-1 ${isDark ? 'bg-white/5 hover:bg-white/10 text-white' : 'bg-black/5 hover:bg-black/10 text-black'}`}>
                           {t('security.changeMasterPwd')}
                        </button>
                        <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSafeAction('disable'); setSafeError(''); setSafeOldPwd(''); }} className="py-4 px-8 text-sm font-black tracking-widest uppercase border border-red-500/30 text-red-500 bg-red-500/10 hover:bg-red-500 hover:text-white transition-all rounded-xl flex-1 shadow-[0_0_15px_rgba(239,68,68,0.2)]">
                           {t('security.disableEncryption')}
                        </button>
                      </div>
                      
                      {onToggleBiometric && (
                        <div className={`p-6 border rounded-xl flex flex-col gap-4 ${isDark ? 'border-white/10 bg-black/40' : 'border-black/10 bg-white/40'}`}>
                          <div className="flex items-center justify-between w-full">
                            <div>
                              <div className="font-black uppercase tracking-widest text-sm flex items-center gap-2 text-emerald-500">
                                <Fingerprint className="w-4 h-4" /> {t('security.osBiometrics', 'OS Biometrics / Touch ID')}
                              </div>
                              <div className="text-xs text-emerald-500/70 font-bold leading-relaxed tracking-widest mt-1">
                                {t('security.osBiometricsDesc', 'Require OS authentication (Touch ID, Windows Hello, or System Password) to unlock GETSSH. This adds a seamless layer of security.')}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={async () => {
                                if (!biometricEnabled) {
                                  // Prompt native touch id to verify before enabling
                                  const res = await window.electronAPI.promptTouchID('Authenticate to enable OS Biometrics for this workspace');
                                  if (res && res.success && onToggleBiometric) {
                                    onToggleBiometric(true);
                                  }
                                } else {
                                  if (onToggleBiometric) onToggleBiometric(false);
                                }
                              }}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${biometricEnabled ? 'bg-emerald-500' : isDark ? 'bg-white/20' : 'bg-black/20'}`}
                            >
                              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${biometricEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                            </button>
                          </div>
                          
                          {biometricEnabled && (
                            <div className="mt-4 pt-4 border-t border-white/5">
                              <div className="font-black uppercase tracking-widest text-xs text-emerald-500 flex items-center gap-2 mb-2">
                                <KeyRound className="w-4 h-4" /> {t('security.hardwarePasskeyBinding', 'Hardware / Passkey Binding (High Security)')}
                              </div>
                              <div className="flex gap-4">
                                <button onClick={() => handleWorkspaceWebAuthnBind('cross-platform')} className="py-3 px-4 text-xs font-bold tracking-widest uppercase border border-white/10 hover:bg-white/10 rounded-lg flex-1 transition-all">
                                  {t('security.bindYubiKey', 'Bind YubiKey / FIDO2')}
                                </button>
                                <button onClick={() => handleWorkspaceWebAuthnBind('any')} className="py-3 px-4 text-xs font-bold tracking-widest uppercase border border-white/10 hover:bg-white/10 rounded-lg flex-1 transition-all">
                                  {t('security.bindPasskey', 'Bind Passkey (Cloud)')}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
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
