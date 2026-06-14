import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../../store/appStore';
import { Server, Trash2 } from 'lucide-react';

export interface KnownHostsTabProps {
  knownHosts: {host: string, port: number, fingerprint: string, trustedAt: number}[];
  revokingHost: string | null;
  setRevokingHost: (hostPort: string | null) => void;
  handleRevokeHost: (host: string, port: number) => void;
}

export const KnownHostsTab: React.FC<KnownHostsTabProps> = ({ knownHosts, revokingHost, setRevokingHost, handleRevokeHost }) => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);

  return (
    <div className="space-y-8">
      <h4 className="text-4xl font-black tracking-tight flex items-center gap-4 text-white"><Server className="w-10 h-10 text-emerald-500"/> {t("security.knownHostsTitle")}</h4>
      
      <div className="relative overflow-hidden p-8 bg-black/40 border border-emerald-500/20 flex flex-col gap-6 rounded-[32px] shadow-2xl backdrop-blur-xl">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-50 pointer-events-none" />
        
        <div className="relative z-10 w-full">
          {knownHosts.length === 0 ? (
            <div className="text-xs font-bold uppercase tracking-widest text-white/30 py-16 text-center border-2 border-dashed rounded-2xl border-white/10 bg-black/20 shadow-inner">{t('security.noKnownHosts')}</div>
          ) : (
            <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 no-scrollbar">
              {knownHosts.map(h => (
                <div key={`${h.host}:${h.port}`} className={`flex items-center justify-between p-6 border rounded-2xl shadow-sm ${isDark ? 'bg-black/40 border-white/5' : 'bg-white/40 border-black/5'}`}>
                  <div>
                    <div className="font-black text-lg tracking-wide mb-2 text-white">{h.host}:{h.port}</div>
                    <div className="text-xs text-emerald-400 font-mono bg-black/40 border border-emerald-500/20 px-3 py-1.5 rounded-lg inline-block">{h.fingerprint}</div>
                  </div>
                  <button
                    onClick={() => {
                      if (revokingHost === `${h.host}:${h.port}`) {
                        handleRevokeHost(h.host, h.port);
                      } else {
                        setRevokingHost(`${h.host}:${h.port}`);
                        setTimeout(() => setRevokingHost(null), 3000);
                      }
                    }}
                    className={`shrink-0 whitespace-nowrap px-5 py-2.5 text-xs font-black uppercase tracking-widest border rounded-xl transition-all flex items-center gap-2 shadow-sm ${
                      revokingHost === `${h.host}:${h.port}`
                      ? 'bg-red-500/20 text-red-500 border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.2)]'
                      : isDark ? 'border-white/10 hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-500 text-white/50' : 'border-black/10 hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-500 text-black/50'
                    }`}
                  >
                    <Trash2 className="w-4 h-4" />
                    {revokingHost === `${h.host}:${h.port}` ? t('security.confirmRevoke') : t('security.revokeTrust')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
