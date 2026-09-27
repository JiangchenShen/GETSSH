import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCryptoStore } from '../../../store/cryptoStore';
import { promptWebAuthn } from '../../../utils/webauthn';
import { SettingsRow, SettingsSection, settingButtonClass, settingDangerButtonClass, settingFieldClass } from '../../settings/SettingsControls';

export interface SafeStorageTabProps {
  safeAction: 'none' | 'change' | 'disable' | 'enable';
  setSafeAction: (action: 'none' | 'change' | 'disable' | 'enable') => void;
  safeOldPwd?: string;
  setSafeOldPwd?: (value: string) => void;
  safeNewPwd?: string;
  setSafeNewPwd?: (value: string) => void;
  safeError?: string;
  setSafeError?: (value: string) => void;
  handleConfirmSafeAction: () => void;
  biometricEnabled?: boolean;
  onToggleBiometric?: (enabled: boolean) => void | Promise<void>;
  section?: 'app' | 'vault' | 'both';
}

export const SafeStorageTab: React.FC<SafeStorageTabProps> = ({
  safeAction, setSafeAction, safeOldPwd = '', setSafeOldPwd = () => {},
  safeNewPwd = '', setSafeNewPwd = () => {}, safeError = '', setSafeError = () => {},
  handleConfirmSafeAction, biometricEnabled = false, onToggleBiometric, section = 'both',
}) => {
  const { t, i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
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

  const loadGlobalSettings = async () => {
    const [hash, authType] = await Promise.all([
      window.electronAPI.getGlobalSetting('app_boot_password_hash'),
      window.electronAPI.getGlobalSetting('app_boot_webauthn_type'),
    ]);
    setGlobalLockEnabled(!!hash);
    setGlobalWebAuthnType(authType);
  };
  useEffect(() => { void loadGlobalSettings(); }, []);

  const hashPassword = async (password: string) => {
    const bytes = new TextEncoder().encode(password);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  };

  const confirmGlobalAction = async () => {
    if (globalAction === 'setup' && (globalPwd.length < 8 || globalPwd !== globalPwdConfirm)) {
      setGlobalError(globalPwd.length < 8 ? t('crypto.passwordTooShort') : t('crypto.passwordMismatch'));
      return;
    }
    if (globalAction === 'disable') {
      const storedHash = await window.electronAPI.getGlobalSetting('app_boot_password_hash');
      if (!globalDisablePwd || await hashPassword(globalDisablePwd) !== storedHash) {
        setGlobalError(t('security.errWrongOldPwd'));
        return;
      }
    }
    setGlobalLoading(true);
    setGlobalError('');
    try {
      await window.electronAPI.setGlobalSetting('app_boot_password_hash', globalAction === 'setup' ? await hashPassword(globalPwd) : '');
      if (globalAction === 'disable') await window.electronAPI.setGlobalSetting('app_boot_webauthn_type', '');
      setGlobalAction('none');
      setGlobalPwd(''); setGlobalPwdConfirm(''); setGlobalDisablePwd('');
      await loadGlobalSettings();
    } catch {
      setGlobalError(zh ? '无法保存应用锁设置' : 'Could not save app lock settings');
    } finally { setGlobalLoading(false); }
  };

  const bindGlobalAuth = async (type: 'platform' | 'cross-platform' | 'any') => {
    try {
      if (type === 'platform') {
        const result = await window.electronAPI.promptTouchID('Authenticate to enable OS Biometrics');
        if (result?.success) await window.electronAPI.setGlobalSetting('app_boot_webauthn_type', 'NativeBiometrics');
      } else {
        window.alert(t('security.insertFido'));
        if (await promptWebAuthn(type === 'any' ? undefined : type)) await window.electronAPI.setGlobalSetting('app_boot_webauthn_type', type);
      }
      await loadGlobalSettings();
    } catch (error: any) {
      window.alert(error?.message === 'MAC_WEBAUTHN_BLOCKED' ? t('security.errMacWebAuthnBlocked') : (zh ? '绑定失败' : 'Binding failed'));
    }
  };

  const bindWorkspaceAuth = async (type: 'cross-platform' | 'any') => {
    try {
      window.alert(t('security.insertFido'));
      if (await promptWebAuthn(type === 'any' ? undefined : type)) await onToggleBiometric?.(true);
    } catch (error: any) {
      window.alert(error?.message === 'MAC_WEBAUTHN_BLOCKED' ? t('security.errMacWebAuthnBlocked') : (zh ? '绑定失败' : 'Binding failed'));
    }
  };

  const beginSafeAction = (action: SafeStorageTabProps['safeAction']) => {
    setSafeAction(action); setSafeError(''); setSafeOldPwd(''); setSafeNewPwd('');
  };

  return <div className="space-y-7">
    {(section === 'app' || section === 'both') && <SettingsSection title={t('security.globalAppLockTitle')} description={t('security.globalAppLockDesc')}>
      <SettingsRow label={globalLockEnabled ? t('security.appLockEnabled') : t('security.appLockDisabled')}>
        <button type="button" onClick={() => { setGlobalError(''); setGlobalAction(globalLockEnabled ? 'disable' : 'setup'); }} className={globalLockEnabled ? settingDangerButtonClass : settingButtonClass}>{globalLockEnabled ? t('security.disableAppLock') : t('security.setupAppLock')}</button>
      </SettingsRow>
      {globalAction !== 'none' && <SettingsRow label={globalAction === 'setup' ? t('security.setupAppLock') : t('security.disableAppLock')} stacked>
        <div className="max-w-md space-y-3">
          {globalAction === 'setup' ? <><label className="block text-xs text-ink-2">{t('security.newAppBootPwd')}<input autoFocus type="password" value={globalPwd} onChange={event => setGlobalPwd(event.target.value)} className={`mt-1 ${settingFieldClass}`} /></label><label className="block text-xs text-ink-2">{t('security.confirmAppBootPwd')}<input type="password" value={globalPwdConfirm} onChange={event => setGlobalPwdConfirm(event.target.value)} className={`mt-1 ${settingFieldClass}`} /></label></>
            : <><label className="block text-xs text-ink-2">{t('security.currentPwd')}<input autoFocus type="password" value={globalDisablePwd} onChange={event => setGlobalDisablePwd(event.target.value)} className={`mt-1 ${settingFieldClass}`} /></label><p className="text-xs text-down">{t('security.warningAppLockDisable')}</p></>}
          {globalError && <p role="alert" className="text-xs text-down">{globalError}</p>}
          <div className="flex gap-2"><button type="button" onClick={() => setGlobalAction('none')} className={settingButtonClass}>{t('security.cancel')}</button><button type="button" onClick={confirmGlobalAction} disabled={globalLoading} className={settingButtonClass}>{globalLoading ? t('common.loading') : t('security.confirm')}</button></div>
        </div>
      </SettingsRow>}
      {globalLockEnabled && <SettingsRow label={t('security.osBiometrics')} description={t('security.osBiometricsDesc')}>
        <button type="button" onClick={async () => { if (globalWebAuthnType === 'NativeBiometrics') { await window.electronAPI.setGlobalSetting('app_boot_webauthn_type', ''); await loadGlobalSettings(); } else await bindGlobalAuth('platform'); }} className={settingButtonClass}>{globalWebAuthnType === 'NativeBiometrics' ? t('security.disableOsAuth') : t('security.enableOsAuth')}</button>
      </SettingsRow>}
      {globalLockEnabled && <SettingsRow label={t('security.hardwarePasskeyBinding')} description={globalWebAuthnType && globalWebAuthnType !== 'NativeBiometrics' ? `${t('security.currentlyBound')}: ${globalWebAuthnType}` : undefined}>
        <div className="flex flex-wrap gap-2"><button type="button" onClick={() => bindGlobalAuth('cross-platform')} className={settingButtonClass}>{t('security.bindYubiKey')}</button><button type="button" onClick={() => bindGlobalAuth('any')} className={settingButtonClass}>{t('security.bindPasskey')}</button></div>
      </SettingsRow>}
    </SettingsSection>}

    {(section === 'vault' || section === 'both') && <SettingsSection title={t('security.workspaceVaultLockTitle')} description={t('security.workspaceVaultLockDesc')}>
      <SettingsRow label={encryptionDisabled ? t('security.encryptionDisabledTitle') : t('security.encryptionEnabledTitle')} description={encryptionDisabled ? t('security.encryptionDisabledDesc') : t('security.encryptionEnabledDesc')}>
        <div className="flex flex-wrap gap-2">{encryptionDisabled || !masterPassword ? <button type="button" onClick={() => beginSafeAction('enable')} className={settingButtonClass}>{t('security.enableEncryption')}</button> : <><button type="button" onClick={() => beginSafeAction('change')} className={settingButtonClass}>{t('security.changeMasterPwd')}</button><button type="button" onClick={() => beginSafeAction('disable')} className={settingDangerButtonClass}>{t('security.disableEncryption')}</button></>}</div>
      </SettingsRow>
      {safeAction !== 'none' && <SettingsRow label={safeAction === 'enable' ? t('security.enableEncryption') : safeAction === 'change' ? t('security.changeMasterPwd') : t('security.disableEncryption')} stacked>
        <div className="max-w-md space-y-3">
          {(safeAction === 'change' || safeAction === 'disable') && <label className="block text-xs text-ink-2">{t('security.currentPwd')}<input autoFocus type="password" value={safeOldPwd} onChange={event => setSafeOldPwd(event.target.value)} className={`mt-1 ${settingFieldClass}`} /></label>}
          {(safeAction === 'enable' || safeAction === 'change') && <label className="block text-xs text-ink-2">{t('security.newPwd')}<input autoFocus={safeAction === 'enable'} type="password" value={safeNewPwd} onChange={event => setSafeNewPwd(event.target.value)} className={`mt-1 ${settingFieldClass}`} /></label>}
          {safeAction === 'disable' && <p className="text-xs text-down">{t('security.warningPlaintext')}</p>}
          {safeError && <p role="alert" className="text-xs text-down">{safeError}</p>}
          <div className="flex gap-2"><button type="button" onClick={() => setSafeAction('none')} className={settingButtonClass}>{t('security.cancel')}</button><button type="button" onClick={handleConfirmSafeAction} className={settingButtonClass}>{t('security.confirm')}</button></div>
        </div>
      </SettingsRow>}
      {!encryptionDisabled && !!masterPassword && onToggleBiometric && <SettingsRow label={t('security.osBiometrics')} description={t('security.osBiometricsDesc')}>
        <button type="button" onClick={async () => { await onToggleBiometric(!biometricEnabled); /* enabling shows Touch ID from the main process */ }} className={settingButtonClass}>{biometricEnabled ? t('security.disableOsAuth') : t('security.enableOsAuth')}</button>
      </SettingsRow>}
      {!encryptionDisabled && !!masterPassword && onToggleBiometric && <SettingsRow label={t('security.hardwarePasskeyBinding')}>
        <div className="flex flex-wrap gap-2"><button type="button" onClick={() => bindWorkspaceAuth('cross-platform')} className={settingButtonClass}>{t('security.bindYubiKey')}</button><button type="button" onClick={() => bindWorkspaceAuth('any')} className={settingButtonClass}>{t('security.bindPasskey')}</button></div>
      </SettingsRow>}
    </SettingsSection>}
  </div>;
};
