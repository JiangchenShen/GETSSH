import { useEffect, useId, useRef, useState } from 'react';
import { KeyRound, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/appStore';
import './TrustDialog.css';

export function HostKeyVerificationModal() {
  const securityPrompt = useAppStore(state => state.securityPrompts[0]);
  const pendingCount = useAppStore(state => state.securityPrompts.length);
  const resolveSecurityPrompt = useAppStore(state => state.resolveSecurityPrompt);
  const { t } = useTranslation();
  const titleId = useId();
  const warningId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const rejectRef = useRef<HTMLButtonElement>(null);
  const [acknowledgedRequestId, setAcknowledgedRequestId] = useState<string | null>(null);
  const requestId = securityPrompt?.requestId;

  useEffect(() => {
    if (!requestId) return;
    const previous = document.activeElement;
    rejectRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [requestId]);

  if (!securityPrompt) return null;

  const isChanged = !!securityPrompt.isChanged;
  const acknowledged = acknowledgedRequestId === requestId;
  const canAccept = !isChanged || acknowledged;
  const Icon = isChanged ? ShieldAlert : KeyRound;

  return (
    <div className="trust-layer">
      <div
        ref={dialogRef}
        className="trust-card"
        data-danger={isChanged || undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={warningId}
        onKeyDown={event => {
          if (event.key !== 'Tab') return;
          const controls = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])');
          if (!controls?.length) return;
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && event.target === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && event.target === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <header className="trust-header">
          <div className="trust-emblem"><Icon size={19} aria-hidden="true" /></div>
          <div className="trust-heading">
            <h2 id={titleId}>{t(isChanged ? 'hostKey.mitmTitle' : 'hostKey.title')}</h2>
            <p id={warningId}>{t(isChanged ? 'hostKey.changedDescription' : 'hostKey.verifyDescription')}</p>
          </div>
          {pendingCount > 1 && <span className="trust-queue">1 / {pendingCount}</span>}
        </header>

        <dl className="trust-facts">
          <div><dt>{t('hostKey.target')}</dt><dd><code dir="ltr">{securityPrompt.hostname}</code></dd></div>
          {isChanged && securityPrompt.oldFingerprint && (
            <div><dt>{t('hostKey.oldFingerprint')}</dt><dd><code dir="ltr">{securityPrompt.oldFingerprint}</code></dd></div>
          )}
          <div data-warning={isChanged || undefined}>
            <dt>{t(isChanged ? 'hostKey.newFingerprint' : 'hostKey.fingerprint')}</dt>
            <dd><code dir="ltr">{securityPrompt.fingerprint}</code></dd>
          </div>
        </dl>

        {isChanged && (
          <label className="trust-acknowledgement">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={event => setAcknowledgedRequestId(event.target.checked ? securityPrompt.requestId : null)}
            />
            <span>{t('hostKey.mitmAck')}</span>
          </label>
        )}

        <footer className="trust-actions">
          <button ref={rejectRef} type="button" className="trust-button" onClick={() => resolveSecurityPrompt('reject')}>
            {t('hostKey.reject')}
          </button>
          <button type="button" className="trust-button" disabled={!canAccept}
            onClick={() => { if (canAccept) resolveSecurityPrompt('accept-once'); }}>
            {t('hostKey.acceptOnce')}
          </button>
          <button type="button" className="trust-button trust-button-primary" disabled={!canAccept}
            onClick={() => { if (canAccept) resolveSecurityPrompt('accept-save'); }}>
            {t('hostKey.acceptSave')}
          </button>
        </footer>
      </div>
    </div>
  );
}
