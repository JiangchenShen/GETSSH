import { useEffect, useId, useState, type FormEvent } from 'react';
import { KeyRound, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../store/workspaceStore';
import './TrustDialog.css';

export function UnlockVaultModal() {
  const { t } = useTranslation();
  const isUnlockModalOpen = useWorkspaceStore(state => state.isUnlockModalOpen);
  const setIsUnlockModalOpen = useWorkspaceStore(state => state.setIsUnlockModalOpen);
  const unlockVault = useWorkspaceStore(state => state.unlockVault);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const workspaceName = useWorkspaceStore(state => state.workspaces.find(workspace => workspace.id === state.activeWorkspaceId)?.name);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!isUnlockModalOpen) return;
    setPassword('');
    setError('');
    setLoading(false);
  }, [isUnlockModalOpen]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password.trim() || loading) return;
    setLoading(true);
    setError('');
    try {
      if (!await unlockVault(password)) setError(t('crypto.invalidPassword'));
    } catch {
      setError(t('crypto.requestFailed'));
    } finally {
      setLoading(false);
    }
  };

  if (!isUnlockModalOpen) return null;

  return (
    <div className="trust-layer trust-layer--vault">
      <div className="trust-card trust-card--compact" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
        <header className="trust-header">
          <div className="trust-emblem"><Lock size={19} aria-hidden="true" /></div>
          <div className="trust-heading">
            <p className="trust-context">{workspaceName || activeWorkspaceId}</p>
            <h2 id={titleId}>{t('crypto.lockedTitle')}</h2>
            <p id={descriptionId}>{t('crypto.lockedDesc')}</p>
          </div>
        </header>
        <form className="trust-form" onSubmit={handleSubmit}>
          <label className="trust-field">
            <span>{t('crypto.workspacePassword')}</span>
            <span className="trust-input-wrap">
              <KeyRound size={16} aria-hidden="true" />
              <input type="password" value={password} autoFocus autoComplete="current-password"
                onChange={event => { setPassword(event.target.value); setError(''); }} />
            </span>
          </label>
          {error && <p className="trust-error" role="alert">{error}</p>}
          <div className="trust-actions">
            <button type="button" disabled={loading} className="trust-button" onClick={() => setIsUnlockModalOpen(false)}>{t('common.cancel')}</button>
            <button type="submit" disabled={loading || !password.trim()} className="trust-button trust-button-primary">
              {t(loading ? 'crypto.processing' : 'crypto.unlock')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
