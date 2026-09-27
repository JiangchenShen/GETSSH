import React from 'react';
import { useTranslation } from 'react-i18next';
import { settingButtonClass, settingDangerButtonClass } from '../../settings/SettingsControls';

export interface KnownHostsTabProps {
  knownHosts: { host: string; port: number; fingerprint: string; trustedAt: number }[];
  revokingHost: string | null;
  setRevokingHost: (hostPort: string | null) => void;
  handleRevokeHost: (host: string, port: number) => void;
}

export const KnownHostsTab: React.FC<KnownHostsTabProps> = ({ knownHosts, revokingHost, setRevokingHost, handleRevokeHost }) => {
  const { t } = useTranslation();
  return <div className="border-y border-line">
    {knownHosts.length === 0 && <p className="py-8 text-center text-sm text-ink-3">{t('security.noKnownHosts')}</p>}
    {knownHosts.map(host => {
      const key = `${host.host}:${host.port}`;
      return <div key={key} className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft py-3 last:border-b-0">
        <div className="min-w-0"><div className="font-mono text-sm text-ink">{key}</div><div className="mt-1 break-all font-mono text-xs text-ink-3">{host.fingerprint}</div></div>
        <button type="button" onClick={() => {
          if (revokingHost === key) handleRevokeHost(host.host, host.port);
          else { setRevokingHost(key); setTimeout(() => setRevokingHost(null), 3000); }
        }} className={revokingHost === key ? settingDangerButtonClass : settingButtonClass}>{revokingHost === key ? t('security.confirmRevoke') : t('security.revokeTrust')}</button>
      </div>;
    })}
  </div>;
};
