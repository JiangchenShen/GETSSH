import React from 'react';
import { useTranslation } from 'react-i18next';

interface ConnectFormProps {
  session: any;
  index: number;
  appConfig: any;
  isDark: boolean;
  connecting: boolean;
  error: string | null;
  onConnect: (session: any) => void;
  onUpdateSession: (index: number, updatedSession: any) => void;
}

export const ConnectForm: React.FC<ConnectFormProps> = ({
  session,
  index,
  appConfig,
  isDark,
  connecting,
  error,
  onConnect,
  onUpdateSession,
}) => {
  const { t } = useTranslation();

  const handleUpdate = (updates: Partial<any>) => {
    onUpdateSession(index, { ...session, ...updates });
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); onConnect(session); }} className="p-8 w-full max-w-md space-y-6 flex flex-col bg-transparent border-0">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-2">Connect to Server</h2>
        <p className="opacity-50 text-sm">Launch a new Tabbed SSH session</p>
      </div>
      {error && <div className="bg-red-500/20 border border-red-500/50 text-red-600 dark:text-red-200 p-3 rounded-lg text-sm">{error}</div>}
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <label className="block text-xs font-medium opacity-70 mb-1">{t('connect.host')}</label>
            <input required value={session.host} onChange={(e) => handleUpdate({ host: e.target.value })} type="text" placeholder="IP / Hostname" className={`w-full border rounded-lg px-4 py-2 text-sm outline-none transition-colors focus:ring-1 focus:ring-primary ${isDark ? 'bg-black/30 border-white/10 placeholder:text-white/20' : 'bg-black/5 border-black/10 placeholder:text-black/30'}`} />
          </div>
          <div>
            <label className="block text-xs font-medium opacity-70 mb-1">{t('connect.port')}</label>
            <input required value={session.port ?? appConfig.defaultPort ?? 22} onChange={(e) => handleUpdate({ port: parseInt(e.target.value) || 22 })} type="number" min="1" max="65535" className={`w-full border rounded-lg px-4 py-2 text-sm outline-none ${isDark ? 'bg-black/30 border-white/10' : 'bg-black/5 border-black/10'}`} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium opacity-70 mb-1">{t('connect.username')}</label>
          <input required value={session.username} onChange={(e) => handleUpdate({ username: e.target.value })} type="text" className={`w-full border rounded-lg px-4 py-2 text-sm outline-none ${isDark ? 'bg-black/30 border-white/10' : 'bg-black/5 border-black/10'}`} />
        </div>
        <div>
          <label className="block text-xs font-medium opacity-70 mb-1">{t('connect.password')}</label>
          <input value={session.password || ''} onChange={(e) => handleUpdate({ password: e.target.value })} type="password" placeholder="Leave empty if using key" className={`w-full border rounded-lg px-4 py-2 text-sm outline-none ${isDark ? 'bg-black/30 border-white/10 placeholder:text-white/20' : 'bg-black/5 border-black/10 placeholder:text-black/30'}`} />
        </div>
        <div>
          <label className="block text-xs font-medium opacity-70 mb-1">{t('connect.privateKey')}</label>
          <div className="flex gap-2">
            <input value={session.privateKeyPath || ''} onChange={(e) => handleUpdate({ privateKeyPath: e.target.value })} type="text" placeholder="e.g. ~/.ssh/id_rsa" className={`flex-1 border rounded-lg px-4 py-2 text-sm outline-none ${isDark ? 'bg-black/30 border-white/10 placeholder:text-white/20' : 'bg-black/5 border-black/10 placeholder:text-black/30'}`} />
            <button type="button" onClick={async () => { const path = await (window as any).electronAPI.selectFile(); if (path) handleUpdate({ privateKeyPath: path }); }} className={`px-3 border rounded-lg text-sm shrink-0 ${isDark ? 'bg-white/10 hover:bg-white/20 border-white/10' : 'bg-white hover:bg-black/10 border-black/10'}`}>Browse</button>
          </div>
        </div>
        <label className="flex items-center gap-3 cursor-pointer pt-2">
          <input type="checkbox" checked={session.useKeepAlive !== false} onChange={(e) => handleUpdate({ useKeepAlive: e.target.checked })} className="w-4 h-4 accent-primary rounded" />
          <div><div className="text-sm font-medium">Enable Keep-Alive</div><div className="text-xs opacity-50">Prevents session timeout drop</div></div>
        </label>
      </div>
      <button disabled={connecting} type="submit" className="w-full bg-primary hover:bg-primary/80 disabled:opacity-50 text-white font-medium py-3 mt-4 rounded-lg transition-colors shadow-lg shadow-primary/20">
        {connecting ? t('connect.connecting') : t('connect.connectBtn')}
      </button>
    </form>
  );
};
