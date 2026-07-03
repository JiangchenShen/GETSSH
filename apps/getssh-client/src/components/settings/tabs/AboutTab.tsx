import React, { useState } from 'react';
import { Sparkles, Cpu, Globe, Box, Network, ArrowRight, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../../store/appStore';
import logoSrc from '../../../assets/logo.png';
import DOMPurify from 'dompurify';

export const AboutTab: React.FC = () => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const appConfig = useAppStore(state => state.appConfig);

  const [checkingUpdate, setCheckingUpdate] = useState(false);

  return (
    <div className="flex flex-col items-center pt-8 pb-16 max-w-4xl mx-auto w-full px-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header Section */}
      <div className="flex flex-col items-center gap-4 mb-10 relative w-full group cursor-default">
        {/* Background glow behind logo */}
        <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 rounded-full blur-[60px] opacity-0 group-hover:opacity-100 transition-opacity duration-1000 ${isDark ? 'bg-emerald-500/20' : 'bg-emerald-500/10'} pointer-events-none`} />
        
        <img 
          src={logoSrc} 
          alt="GETSSH Logo" 
          className={`w-24 h-24 rounded-[1.5rem] shadow-2xl object-cover relative z-10 transition-transform duration-700 group-hover:scale-[1.02] ${isDark ? 'border border-white/10 shadow-[0_0_40px_rgba(0,0,0,0.5)]' : 'border border-black/5 shadow-emerald-500/20'}`} 
        />
        
        <div className="flex flex-col items-center gap-2 relative z-10">
          <h1 className="text-4xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 via-teal-500 to-cyan-500 pb-1">
            GETSSH
          </h1>
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-bold tracking-widest uppercase border backdrop-blur-md ${isDark ? 'bg-white/5 border-white/10 text-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]' : 'bg-black/5 border-black/10 text-black/70'}`}>
            <Sparkles className="w-3 h-3 text-emerald-500" />
            v3.0.0 F0A0G - PREVIEW
          </div>
        </div>
      </div>

      {/* Bento Grid Layout */}
      <div className="w-full grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4 mb-8">
        
        {/* Column 1: Core Engine (Span 2) */}
        <div className={`col-span-full md:col-span-2 rounded-3xl p-8 flex flex-col justify-between relative overflow-hidden group ${isDark ? 'bg-gradient-to-br from-white/[0.03] to-white/[0.01] border border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]' : 'bg-gradient-to-br from-black/[0.02] to-transparent border border-black/5 shadow-sm'}`}>
          {/* Decorative background element */}
          <div className="absolute -right-20 -bottom-20 w-64 h-64 bg-emerald-500/10 rounded-full blur-[60px] opacity-50 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
          
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-6">
              <div className={`p-2.5 rounded-xl ${isDark ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-500/10 text-emerald-600'}`}>
                <Cpu className="w-6 h-6" />
              </div>
              <div>
                <h3 className={`text-sm font-bold uppercase tracking-[0.2em] ${isDark ? 'text-white/80' : 'text-black/80'}`}>{t('settings.hostArchitecture')}</h3>
                <p className={`text-xs mt-0.5 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{t('settings.systemHardware')}</p>
              </div>
            </div>
            
            <div className="mt-8">
              <div className="text-3xl font-bold tracking-tight mb-2">
                {(() => {
                  const p = window.electronAPI?.getEnvInfo?.()?.platform;
                  return p === 'darwin' ? 'macOS' : p === 'win32' ? 'Windows' : p === 'linux' ? 'Linux' : (p || 'Unknown');
                })()}
              </div>
              <div className={`text-sm font-mono ${isDark ? 'text-white/50' : 'text-black/50'}`}>
                {(() => {
                  const a = window.electronAPI?.getEnvInfo?.()?.arch;
                  return a === 'arm64' ? 'Apple Silicon / ARM64 (aarch64)' : a === 'x64' ? 'x86_64 (64-bit Intel/AMD)' : a === 'ia32' ? 'x86 (32-bit)' : a;
                })()}
              </div>
            </div>
          </div>
        </div>

        {/* Column 2: Engine Specs Grid (Span 1, 3 rows) */}
        <div className="flex flex-col gap-3">
          {[
            { icon: Globe, label: 'Electron', value: window.electronAPI?.getEnvInfo?.()?.electron || 'N/A', color: 'text-blue-400', bg: isDark ? 'bg-blue-500/10' : 'bg-blue-500/5' },
            { icon: Box, label: 'Chrome', value: window.electronAPI?.getEnvInfo?.()?.chrome || 'N/A', color: 'text-orange-400', bg: isDark ? 'bg-orange-500/10' : 'bg-orange-500/5' },
            { icon: Network, label: 'Node.js', value: window.electronAPI?.getEnvInfo?.()?.node || 'N/A', color: 'text-green-400', bg: isDark ? 'bg-green-500/10' : 'bg-green-500/5' }
          ].map((env) => (
            <div key={env.label} className={`flex-1 rounded-2xl px-4 py-3 flex items-center gap-3 border group transition-all duration-300 ${isDark ? 'bg-white/[0.02] border-white/10 hover:bg-white/[0.04]' : 'bg-white border-black/5 hover:border-black/10 hover:shadow-sm'}`}>
              <div className={`p-2 rounded-xl shrink-0 ${env.bg} ${env.color}`}>
                <env.icon className="w-4 h-4" />
              </div>
              <div className="flex flex-col min-w-0 flex-1 justify-center">
                <span className={`text-[10px] font-bold uppercase tracking-wider mb-0.5 ${isDark ? 'text-white/60' : 'text-black/60'}`}>{env.label}</span>
                <span className="font-mono text-sm font-medium truncate w-full" title={env.value}>{env.value}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Compliance & Updates Row */}
      <div className="w-full grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
        {/* Legal Block */}
        <div className={`rounded-3xl p-6 border flex flex-col ${isDark ? 'bg-white/[0.02] border-white/10' : 'bg-white border-black/5'}`}>
          <h3 className={`text-[11px] font-bold uppercase tracking-[0.2em] mb-4 ml-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>
            {t('about.compliance')}
          </h3>
          <div className="flex flex-col flex-1 justify-center gap-2">
            {['Terms of Service', 'Privacy Policy', 'Third-Party Licenses'].map((doc) => {
              const i18nMap = { 'Terms of Service': 'tos', 'Privacy Policy': 'privacy', 'Third-Party Licenses': 'licenses' } as Record<string, string>;
              const urlSlugMap = { 'Terms of Service': 'terms', 'Privacy Policy': 'privacy', 'Third-Party Licenses': 'licenses' } as Record<string, string>;
              const langPrefix = appConfig.language?.startsWith('zh') ? 'zh' : 'en';

              return (
                <button 
                  key={doc} 
                  onClick={() => window.electronAPI.openExternal(`https://getssh.realmcloud.net/${langPrefix}/legal/${urlSlugMap[doc]}`)}
                  className={`w-full py-2.5 px-4 rounded-xl flex items-center justify-between transition-all group ${isDark ? 'hover:bg-white/5 text-white/70 hover:text-white' : 'hover:bg-black/5 text-black/70 hover:text-black'}`}
                >
                  <span className="text-xs font-medium">{t(`about.${i18nMap[doc] || doc.toLowerCase().replace(/ /g, '')}`)}</span>
                  <ArrowRight className="w-3.5 h-3.5 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300" />
                </button>
              );
            })}
          </div>
        </div>

        {/* Updates Block */}
        <div className={`rounded-3xl p-8 border flex flex-col items-center justify-center text-center gap-6 relative overflow-hidden group ${isDark ? 'bg-gradient-to-br from-emerald-900/20 to-teal-900/10 border-emerald-500/20' : 'bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-500/10'}`}>
          <div className={`absolute inset-0 bg-emerald-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 ${isDark ? '' : 'mix-blend-multiply'}`} />
          
          <div className="relative z-10 flex flex-col items-center">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 ${isDark ? 'bg-emerald-500/20 text-emerald-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]' : 'bg-emerald-100 text-emerald-600 shadow-sm'}`}>
              <Download className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold mb-1">Stay up to date</h3>
            <p className={`text-sm mb-6 ${isDark ? 'text-white/60' : 'text-black/60'}`}>
              Check for the latest stability patches and security updates.
            </p>
            
            <button 
              onClick={async () => {
                setCheckingUpdate(true);
                try {
                  const res = await window.electronAPI.checkForUpdates();
                  if (res.hasUpdate) {
                     window.alert(t('update.found', { version: res.version }));
                     window.electronAPI.openExternal(res.url!);
                  } else if (res.error) {
                     window.alert(t('update.failed', { reason: res.error }));
                  } else {
                     window.alert(t('update.latest'));
                  }
                } catch (e: any) {
                  window.alert(t('update.networkError', { message: e.message }));
                } finally {
                  setCheckingUpdate(false);
                }
              }}
              disabled={checkingUpdate}
              className={`w-full py-4 rounded-2xl font-bold uppercase tracking-widest text-xs transition-all duration-300 flex items-center justify-center gap-2 ${
                checkingUpdate 
                  ? 'opacity-50 cursor-not-allowed bg-transparent border border-emerald-500/50 text-emerald-500' 
                  : 'bg-emerald-500 text-black hover:bg-emerald-400 hover:scale-[1.02] hover:shadow-[0_0_20px_rgba(16,185,129,0.4)]'
              }`}
            >
              {checkingUpdate ? (
                <>
                  <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  {t('about.checkingUpdates')}
                </>
              ) : (
                t('about.checkUpdates')
              )}
            </button>
          </div>
        </div>
      </div>
      
      {/* Footer Open Source text */}
      <div className={`mt-12 text-center w-full max-w-2xl px-6 ${isDark ? 'text-white/30' : 'text-black/30'}`}>
        <p className="text-[11px] leading-relaxed" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(t('about.openSourceDesc') as string) }} />
        <div className="mt-6 text-[10px] tracking-widest uppercase font-medium">
          {t('about.copyright')}
        </div>
      </div>
    </div>
  );
};
