import React from 'react';
import { Network } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../../store/appStore';

export const SSHTab: React.FC = () => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const appConfig = useAppStore(state => state.appConfig);
  const updateConfig = useAppStore(state => state.updateConfig);

  return (
    <div className="max-w-4xl mx-auto w-full px-8 pt-8 pb-24 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Immersive Header */}
      <div className="flex flex-col gap-2 mb-10 relative group">
        <div className={`absolute -left-10 top-0 w-40 h-40 rounded-full blur-[60px] opacity-0 group-hover:opacity-100 transition-opacity duration-1000 pointer-events-none ${isDark ? 'bg-blue-500/20' : 'bg-blue-500/10'}`} />
        <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-4 relative z-10">
          <div className={`p-2.5 rounded-[1.25rem] ${isDark ? 'bg-blue-500/20 text-blue-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]' : 'bg-blue-500/10 text-blue-600'}`}>
            <Network className="w-7 h-7" />
          </div>
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-600 pb-1">
            {t('settings.ssh')}
          </span>
        </h1>
        <p className={`text-sm ml-[4.5rem] ${isDark ? 'text-white/50' : 'text-black/50'}`}>
          {t('settings.sshHeaderDesc')}
        </p>
      </div>

      {/* Bento Grid */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
        
        {/* Core Network Settings (Span 2) */}
        <div className={`col-span-full rounded-3xl p-6 border flex flex-col md:flex-row gap-8 ${isDark ? 'bg-white/[0.02] border-white/10' : 'bg-white border-black/5'}`}>
          <div className="flex-1">
            <h3 className={`text-[11px] font-bold uppercase tracking-[0.2em] mb-4 ml-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{t('ssh.port')}</h3>
            <div className="relative">
              <div className={`absolute left-4 top-1/2 -translate-y-1/2 font-bold ${isDark ? 'text-white/30' : 'text-black/30'}`}>#</div>
              <input type="number" min="1" max="65535" value={appConfig.defaultPort || 22} onChange={(e) => updateConfig('defaultPort', parseInt(e.target.value) || 22)} className={`w-full p-3 pl-8 border rounded-xl text-sm font-medium outline-none shadow-sm focus:ring-2 focus:ring-blue-500/50 transition-colors ${isDark ? 'bg-black/40 border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] text-white' : 'bg-white border-black/10 text-slate-800 hover:border-black/20'}`} />
            </div>
          </div>

          <div className={`hidden md:block w-px ${isDark ? 'bg-white/5' : 'bg-black/5'}`} />

          <div className="flex-1">
            <h3 className={`text-[11px] font-bold uppercase tracking-[0.2em] mb-4 ml-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{t('ssh.keepAlive')}</h3>
            <div className="relative">
               <input type="number" min="0" value={appConfig.keepalive || 0} onChange={(e) => updateConfig('keepalive', parseInt(e.target.value) || 0)} className={`w-full p-3 border rounded-xl text-sm font-medium outline-none shadow-sm focus:ring-2 focus:ring-blue-500/50 transition-colors pr-20 ${isDark ? 'bg-black/40 border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] text-white' : 'bg-white border-black/10 text-slate-800 hover:border-black/20'}`} />
               <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-wider opacity-30">{t('settings.seconds')}</div>
            </div>
            <div className="text-[10px] opacity-40 mt-2 ml-1">{t('ssh.keepAliveDesc')}</div>
          </div>
        </div>

        {/* Proxy Configuration */}
        <div className={`rounded-3xl p-6 border flex flex-col gap-6 ${isDark ? 'bg-white/[0.02] border-white/10' : 'bg-white border-black/5'}`}>
          <h3 className={`text-[11px] font-bold uppercase tracking-[0.2em] ml-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{t('ssh.proxyType')}</h3>
          
          <div>
            <select value={appConfig.proxyType} onChange={(e) => updateConfig('proxyType', e.target.value as any)} className={`w-full p-3 border rounded-xl text-sm font-medium outline-none shadow-sm focus:ring-2 focus:ring-blue-500/50 transition-colors cursor-pointer ${isDark ? 'bg-black/40 border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] text-white' : 'bg-white border-black/10 text-slate-800 hover:border-black/20'}`}>
               <option value="none">{t('ssh.proxyNone')}</option>
               <option value="http">{t('ssh.proxyHttp')}</option>
               <option value="socks5">{t('ssh.proxySocks5')}</option>
            </select>
          </div>
          
          {appConfig.proxyType !== 'none' && (
            <div className={`pt-4 border-t ${isDark ? 'border-white/5' : 'border-black/5'} animate-in fade-in slide-in-from-top-2 duration-300`}>
              <div className="flex gap-3">
                 <div className="flex-[3]">
                    <label className={`block text-[10px] font-bold uppercase tracking-wider mb-2 ml-1 ${isDark ? 'text-white/60' : 'text-black/60'}`}>{t('ssh.proxyHost')}</label>
                    <input type="text" value={appConfig.proxyHost || ''} onChange={(e) => updateConfig('proxyHost', e.target.value)} className={`w-full p-3 border rounded-xl text-sm font-medium outline-none shadow-sm focus:ring-2 focus:ring-blue-500/50 transition-colors ${isDark ? 'bg-black/40 border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] text-white' : 'bg-white border-black/10 text-slate-800 hover:border-black/20'}`} />
                 </div>
                 <div className="flex-1">
                    <label className={`block text-[10px] font-bold uppercase tracking-wider mb-2 ml-1 ${isDark ? 'text-white/60' : 'text-black/60'}`}>{t('ssh.proxyPort')}</label>
                    <input type="number" min="1" max="65535" value={appConfig.proxyPort || 1080} onChange={(e) => updateConfig('proxyPort', parseInt(e.target.value) || 1080)} className={`w-full p-3 border rounded-xl text-sm font-medium outline-none shadow-sm focus:ring-2 focus:ring-blue-500/50 transition-colors ${isDark ? 'bg-black/40 border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] text-white' : 'bg-white border-black/10 text-slate-800 hover:border-black/20'}`} />
                 </div>
              </div>
            </div>
          )}
        </div>

        {/* SFTP Default Download Path */}
        <div className={`rounded-3xl p-6 border flex flex-col justify-between gap-6 ${isDark ? 'bg-white/[0.02] border-white/10' : 'bg-white border-black/5'}`}>
          <div>
            <h3 className={`text-[11px] font-bold uppercase tracking-[0.2em] mb-4 ml-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{t('settings.sftpStorage')}</h3>
            <label className={`block text-[10px] font-bold uppercase tracking-wider mb-2 ml-1 ${isDark ? 'text-white/60' : 'text-black/60'}`}>{t('settings.sftpDownloadPath')}</label>
            
            <div className="flex gap-2">
              <input type="text" readOnly value={appConfig.sftpDownloadPath || ''} placeholder="Default (Downloads Folder)" className={`flex-1 p-3 border rounded-xl text-sm font-medium outline-none shadow-sm transition-colors ${isDark ? 'bg-black/40 border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] text-white' : 'bg-white border-black/10 text-slate-800'}`} />
              <button onClick={async () => {
                const p = await window.electronAPI.selectFolder();
                if (p) updateConfig('sftpDownloadPath', p);
              }} className={`px-4 py-3 rounded-xl text-sm font-bold uppercase tracking-wider border transition-all ${isDark ? 'border-white/10 bg-white/5 hover:bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]' : 'border-black/10 bg-black/5 hover:bg-black/10 text-black'}`}>
                {t('settings.browse')}
              </button>
            </div>
            {appConfig.sftpDownloadPath && (
              <div className="flex justify-end mt-2">
                <button onClick={() => updateConfig('sftpDownloadPath', '')} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${isDark ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20' : 'bg-red-50 text-red-500 hover:bg-red-100'}`}>
                  {t('settings.clearCustomPath')}
                </button>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
