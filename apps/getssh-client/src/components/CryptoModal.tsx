import { useId, useState, type FormEvent } from 'react';
import { Fingerprint, KeyRound, Lock, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './TrustDialog.css';

interface CryptoModalProps {
  mode: 'locked' | 'setup';
  isDark: boolean;
  onUnlock: (password: string) => Promise<boolean>;
  onSetup: (password: string) => Promise<void>;
  onCancel?: () => void;
  onSkip?: () => void;
  onRetryBiometric?: () => void;
  encryptionDisabled?: boolean;
  workspaceName?: string;
  themeColor?: string;
  onSwitchWorkspace?: () => void;
  /** The enclosing verification prompt already has the title and dialog semantics. */
  embedded?: boolean;
}

export function CryptoModal({ mode, onUnlock, onSetup, onCancel, onSkip, onRetryBiometric, encryptionDisabled, workspaceName, themeColor, onSwitchWorkspace, embedded }: CryptoModalProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const isLocked = mode === 'locked';
  const needsPassword = !isLocked || !encryptionDisabled;
  const passwordLabel = t(workspaceName && isLocked ? 'crypto.workspacePassword' : 'crypto.masterPassword');
  const Icon = isLocked ? Lock : ShieldAlert;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setError('');

    if (!isLocked && password !== confirm) {
      setError(t('crypto.passwordMismatch'));
      return;
    }
    if (!isLocked && password.length < 8) {
      setError(t('crypto.passwordTooShort'));
      return;
    }

    setLoading(true);
    try {
      if (!isLocked) await onSetup(password);
      else if (!await onUnlock(needsPassword ? password : '')) setError(t('crypto.invalidPassword'));
    } catch {
      setError(t('crypto.requestFailed'));
    } finally {
      setLoading(false);
    }
  };

  const fields = (
    <form className="trust-form" onSubmit={handleSubmit}>
      {needsPassword && (
        <>
          <label className="trust-field">
            <span>{passwordLabel}</span>
            <span className="trust-input-wrap">
              <KeyRound size={16} aria-hidden="true" />
              <input type="password" autoFocus value={password}
                autoComplete={isLocked ? 'current-password' : 'new-password'} required
                onChange={event => setPassword(event.target.value)} />
            </span>
          </label>
          {!isLocked && (
            <label className="trust-field">
              <span>{t('crypto.confirmPassword')}</span>
              <span className="trust-input-wrap">
                <KeyRound size={16} aria-hidden="true" />
                <input type="password" value={confirm} autoComplete="new-password" required
                  onChange={event => setConfirm(event.target.value)} />
              </span>
            </label>
          )}
        </>
      )}
      {error && <p className="trust-error" role="alert">{error}</p>}
      <div className="trust-actions">
        {!isLocked && onSkip && <button type="button" className="trust-button" disabled={loading} onClick={onSkip} title={t('crypto.skipTip')}>{t('crypto.skip')}</button>}
        {!isLocked && onCancel && <button type="button" className="trust-button" disabled={loading} onClick={onCancel} title={t('crypto.cancelTip')}>{t('crypto.cancel')}</button>}
        {isLocked && needsPassword && onRetryBiometric && (
          <button type="button" className="trust-button" disabled={loading} onClick={onRetryBiometric}>
            <Fingerprint size={16} aria-hidden="true" />{t('crypto.useDeviceVerification')}
          </button>
        )}
        <button type="submit" className="trust-button trust-button-primary"
          disabled={loading || (needsPassword && !password) || (!isLocked && !confirm)}>
          {t(loading ? 'crypto.processing' : isLocked ? 'crypto.unlock' : 'crypto.encrypt')}
        </button>
      </div>
      {isLocked && needsPassword && onSwitchWorkspace && (
        <button type="button" className="trust-text-button" onClick={onSwitchWorkspace}>{t('crypto.returnToDefault')}</button>
      )}
    </form>
  );

  if (embedded) return <div className="trust-embedded">{fields}</div>;

  return (
    <div className="trust-layer trust-layer--workspace">
      <div className="trust-card trust-card--compact" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
        <header className="trust-header">
          <div className="trust-emblem" style={themeColor && isLocked ? { color: themeColor } : undefined}>
            <Icon size={19} aria-hidden="true" />
          </div>
          <div className="trust-heading">
            {workspaceName && isLocked && <p className="trust-context">{workspaceName}</p>}
            <h2 id={titleId}>{t(isLocked ? 'crypto.lockedTitle' : 'crypto.setupTitle')}</h2>
            <p id={descriptionId}>{t(isLocked ? needsPassword ? 'crypto.lockedDesc' : 'crypto.unlockScreenDesc' : 'crypto.setupDesc')}</p>
          </div>
        </header>
        {fields}
      </div>
    </div>
  );
}
