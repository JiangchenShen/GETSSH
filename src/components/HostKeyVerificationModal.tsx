import React, { useState } from 'react';
import { useAppStore } from '../store/appStore';
import { ShieldAlert, CheckCircle, Clock, XCircle } from 'lucide-react';
import { useTranslation, Trans } from 'react-i18next';

export const HostKeyVerificationModal: React.FC = () => {
  const securityPrompt = useAppStore(state => state.securityPrompt);
  const resolveSecurityPrompt = useAppStore(state => state.resolveSecurityPrompt);
  const isDark = useAppStore(state => state.isDark);
  const { t } = useTranslation();
  const [mitmAcknowledged, setMitmAcknowledged] = useState(false);

  if (!securityPrompt || !securityPrompt.isOpen) return null;

  const isMitm = securityPrompt.isChanged;
  const canAccept = !isMitm || mitmAcknowledged;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />
      
      {/* Modal Content */}
      <div className={`relative w-full max-w-lg p-6 rounded-2xl shadow-2xl flex flex-col gap-5 ${
        isMitm 
          ? (isDark ? 'bg-red-950/90 text-white/90 border border-red-500/50' : 'bg-red-50 text-red-950 border border-red-500/30') 
          : (isDark ? 'bg-[#1a1b1e] text-white/90 border border-white/10' : 'bg-white text-black/90 border border-black/10')
      }`}>
        <div className={`flex items-center gap-3 ${isMitm ? 'text-red-500' : 'text-amber-500'}`}>
          <ShieldAlert className="w-8 h-8" />
          <h2 className="text-xl font-bold">
            {isMitm ? t('hostKey.mitmTitle', 'WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!') : t('hostKey.title')}
          </h2>
        </div>

        <div className="flex flex-col gap-3">
          {isMitm ? (
            <>
              <p className="text-sm font-bold">
                {t('hostKey.mitmMsg1', 'Someone could be eavesdropping on you right now (man-in-the-middle attack)!')}
              </p>
              <p className="text-sm">
                <Trans i18nKey="hostKey.mitmMsg2" values={{ hostname: securityPrompt.hostname }}>
                  It is also possible that a host key has just been changed for <strong className={isDark ? 'text-white' : 'text-black'}>{securityPrompt.hostname}</strong>.
                </Trans>
              </p>
              
              <div className="flex flex-col gap-2 mt-2">
                <div className={`p-3 rounded-md font-mono text-xs break-all ${isDark ? 'bg-black/60 text-green-400' : 'bg-green-50 text-green-700'}`}>
                  <div className="font-bold mb-1">{t('hostKey.oldFingerprint', 'Old Fingerprint:')}</div>
                  {securityPrompt.oldFingerprint}
                </div>
                <div className={`p-3 rounded-md font-mono text-xs break-all ${isDark ? 'bg-black/60 text-red-400' : 'bg-red-50 text-red-700'}`}>
                  <div className="font-bold mb-1">{t('hostKey.newFingerprint', 'New Fingerprint:')}</div>
                  {securityPrompt.fingerprint}
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm">
                <Trans i18nKey="hostKey.msg1" values={{ hostname: securityPrompt.hostname }}>
                  The authenticity of host <strong className={isDark ? 'text-white' : 'text-black'}>{securityPrompt.hostname}</strong> can't be established.
                </Trans>
              </p>
              <div className={`p-3 rounded-md font-mono text-xs break-all ${isDark ? 'bg-black/40 text-amber-200/80' : 'bg-amber-50 text-amber-900/80'}`}>
                {t('hostKey.msg2')}<br/>
                {securityPrompt.fingerprint}
              </div>
              <p className="text-sm">
                {t('hostKey.msg3')}
              </p>
            </>
          )}
        </div>

        {isMitm && (
          <label className="flex items-start gap-2 mt-2 cursor-pointer p-3 rounded bg-black/10 hover:bg-black/20 transition-colors">
            <input 
              type="checkbox" 
              className="mt-0.5 accent-red-500"
              checked={mitmAcknowledged}
              onChange={(e) => setMitmAcknowledged(e.target.checked)}
            />
            <span className="text-sm font-medium">
              {t('hostKey.mitmAck', 'I understand the risks and want to update the known host fingerprint.')}
            </span>
          </label>
        )}

        <div className="flex flex-col gap-2 mt-2">
          <button
            onClick={() => { if (canAccept) resolveSecurityPrompt('accept-save'); }}
            disabled={!canAccept}
            className={`flex items-center justify-center gap-2 w-full py-2.5 rounded-lg font-medium transition-colors ${
              canAccept 
                ? (isMitm ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-primary hover:bg-primary/90 text-white') 
                : 'bg-black/20 text-white/50 cursor-not-allowed'
            }`}
          >
            <CheckCircle className="w-4 h-4" />
            {t('hostKey.acceptSave')}
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => { if (canAccept) resolveSecurityPrompt('accept-once'); }}
              disabled={!canAccept}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg font-medium transition-colors ${
                canAccept
                  ? (isDark ? 'bg-white/10 hover:bg-white/20' : 'bg-black/5 hover:bg-black/10')
                  : 'bg-black/10 text-black/30 dark:bg-white/5 dark:text-white/30 cursor-not-allowed'
              }`}
            >
              <Clock className="w-4 h-4" />
              {t('hostKey.acceptOnce')}
            </button>
            <button
              onClick={() => resolveSecurityPrompt('reject')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg font-medium transition-colors ${isDark ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}
            >
              <XCircle className="w-4 h-4" />
              {t('hostKey.reject')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
