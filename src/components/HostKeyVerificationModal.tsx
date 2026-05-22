import React from 'react';
import { useAppStore } from '../store/appStore';
import { ShieldAlert, CheckCircle, Clock, XCircle } from 'lucide-react';
import { useTranslation, Trans } from 'react-i18next';

export const HostKeyVerificationModal: React.FC = () => {
  const securityPrompt = useAppStore(state => state.securityPrompt);
  const resolveSecurityPrompt = useAppStore(state => state.resolveSecurityPrompt);
  const isDark = useAppStore(state => state.isDark);
  const { t } = useTranslation();

  if (!securityPrompt || !securityPrompt.isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />
      
      {/* Modal Content */}
      <div className={`relative w-full max-w-lg p-6 rounded-2xl shadow-2xl flex flex-col gap-5 ${isDark ? 'bg-[#1a1b1e] text-white/90 border border-white/10' : 'bg-white text-black/90 border border-black/10'}`}>
        <div className="flex items-center gap-3 text-amber-500">
          <ShieldAlert className="w-8 h-8" />
          <h2 className="text-xl font-bold">{t('hostKey.title')}</h2>
        </div>

        <div className="flex flex-col gap-3">
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
        </div>

        <div className="flex flex-col gap-2 mt-2">
          <button
            onClick={() => resolveSecurityPrompt('accept-save')}
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-primary hover:bg-primary/90 text-white font-medium transition-colors"
          >
            <CheckCircle className="w-4 h-4" />
            {t('hostKey.acceptSave')}
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => resolveSecurityPrompt('accept-once')}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg font-medium transition-colors ${isDark ? 'bg-white/10 hover:bg-white/20' : 'bg-black/5 hover:bg-black/10'}`}
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
