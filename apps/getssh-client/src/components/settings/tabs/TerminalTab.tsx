import React from 'react';
import { Terminal as TerminalIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../../store/appStore';

export const TerminalTab: React.FC = () => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const appConfig = useAppStore(state => state.appConfig);
  const updateConfig = useAppStore(state => state.updateConfig);

  return (
    <div className="max-w-4xl mx-auto w-full px-8 pt-8 pb-24 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Immersive Header */}
      <div className="flex flex-col gap-2 mb-10 relative group">
        <div className={`absolute -left-10 top-0 w-40 h-40 rounded-full blur-[60px] opacity-0 group-hover:opacity-100 transition-opacity duration-1000 pointer-events-none ${isDark ? 'bg-emerald-500/20' : 'bg-emerald-500/10'}`} />
        <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-4 relative z-10">
          <div className={`p-2.5 rounded-[1.25rem] ${isDark ? 'bg-emerald-500/20 text-emerald-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]' : 'bg-emerald-500/10 text-emerald-600'}`}>
            <TerminalIcon className="w-7 h-7" />
          </div>
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-teal-600 pb-1">
            {t('settings.terminal')}
          </span>
        </h1>
        <p className={`text-sm ml-[4.5rem] ${isDark ? 'text-white/50' : 'text-black/50'}`}>
          {t('settings.terminalHeaderDesc')}
        </p>
      </div>

      {/* Bento Grid */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
        
        {/* Font & Typography (Span 2) */}
        <div className={`col-span-full rounded-3xl p-6 border flex flex-col gap-6 ${isDark ? 'bg-white/[0.02] border-white/10' : 'bg-white border-black/5'}`}>
          <h3 className={`text-[11px] font-bold uppercase tracking-[0.2em] ml-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>Typography</h3>
          
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <label className={`block text-[10px] font-bold uppercase tracking-wider mb-2 ml-1 ${isDark ? 'text-white/60' : 'text-black/60'}`}>{t('terminal.fontFamily')}</label>
              <select 
                value={appConfig.fontFamily}
                onChange={(e) => updateConfig('fontFamily', e.target.value)}
                className={`w-full p-3 border rounded-xl text-sm font-medium outline-none shadow-sm focus:ring-2 focus:ring-emerald-500/50 transition-colors cursor-pointer ${isDark ? 'bg-black/40 border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] text-white' : 'bg-white border-black/10 text-slate-800 hover:border-black/20'}`}
              >
                 <option value='"Fira Code", monospace, "Courier New", Courier'>Fira Code (Default)</option>
                 <option value='"Consolas", "Courier New", monospace'>Consolas / Courier</option>
                 <option value='"Menlo", "Monaco", "Courier New", monospace'>Menlo / Monaco</option>
              </select>
            </div>
            
            <div className="flex gap-4 md:w-64">
              <div className="flex-1">
                <label className={`block text-[10px] font-bold uppercase tracking-wider mb-2 ml-1 ${isDark ? 'text-white/60' : 'text-black/60'}`}>{t('terminal.fontSize')}</label>
                <input type="number" value={appConfig.fontSize || 14} onChange={(e) => updateConfig('fontSize', parseInt(e.target.value) || 14)} className={`w-full p-3 border rounded-xl text-sm font-medium outline-none shadow-sm focus:ring-2 focus:ring-emerald-500/50 transition-colors ${isDark ? 'bg-black/40 border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] text-white' : 'bg-white border-black/10 text-slate-800 hover:border-black/20'}`} />
              </div>
              <div className="flex-1">
                <label className={`block text-[10px] font-bold uppercase tracking-wider mb-2 ml-1 ${isDark ? 'text-white/60' : 'text-black/60'}`}>{t('terminal.lineHeight')}</label>
                <input type="number" step="0.1" value={appConfig.lineHeight || 1.2} onChange={(e) => updateConfig('lineHeight', parseFloat(e.target.value) || 1.2)} className={`w-full p-3 border rounded-xl text-sm font-medium outline-none shadow-sm focus:ring-2 focus:ring-emerald-500/50 transition-colors ${isDark ? 'bg-black/40 border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] text-white' : 'bg-white border-black/10 text-slate-800 hover:border-black/20'}`} />
              </div>
            </div>
          </div>
        </div>

        {/* Cursor & Feedback */}
        <div className={`rounded-3xl p-6 border flex flex-col gap-6 ${isDark ? 'bg-white/[0.02] border-white/10' : 'bg-white border-black/5'}`}>
          <h3 className={`text-[11px] font-bold uppercase tracking-[0.2em] ml-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>Cursor</h3>
          
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <select 
                value={appConfig.cursorStyle}
                onChange={(e) => updateConfig('cursorStyle', e.target.value as any)}
                className={`w-full p-3 border rounded-xl text-sm font-medium outline-none shadow-sm focus:ring-2 focus:ring-emerald-500/50 transition-colors cursor-pointer ${isDark ? 'bg-black/40 border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] text-white' : 'bg-white border-black/10 text-slate-800 hover:border-black/20'}`}
              >
                 <option value="block">{t('terminal.block')}</option>
                 <option value="underline">{t('terminal.underline')}</option>
                 <option value="bar">{t('terminal.bar')}</option>
              </select>
            </div>
          </div>

          <div className={`pt-4 border-t ${isDark ? 'border-white/5' : 'border-black/5'}`}>
            <label className="flex items-center justify-between cursor-pointer group">
              <div className="flex flex-col ml-1">
                <span className={`text-[11px] font-bold uppercase tracking-[0.2em] ${!isDark ? 'opacity-40' : 'opacity-70 group-hover:opacity-100 transition-opacity'}`}>{t('terminal.cursorBlink')}</span>
                <span className="text-[10px] opacity-40 mt-1">{t('terminal.cursorBlinkDesc')}</span>
              </div>
              <button 
                onClick={() => updateConfig('cursorBlink', !(appConfig.cursorBlink ?? true))} 
                className={`relative w-12 h-6 rounded-xl border border-black/20 dark:border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-colors flex-shrink-0 ${(appConfig.cursorBlink ?? true) ? 'bg-emerald-500' : 'bg-black/20 dark:bg-white/10'}`}
              >
                <div className={`absolute top-1 left-1 bg-white shadow-sm w-4 h-4 rounded-xl transition-transform ${(appConfig.cursorBlink ?? true) ? 'translate-x-6' : 'translate-x-0'}`} />
              </button>
            </label>
          </div>
        </div>

        {/* Behavior */}
        <div className={`rounded-3xl p-6 border flex flex-col gap-6 ${isDark ? 'bg-white/[0.02] border-white/10' : 'bg-white border-black/5'}`}>
          <h3 className={`text-[11px] font-bold uppercase tracking-[0.2em] ml-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>Behavior</h3>
          
          <div>
            <select 
              value={appConfig.rightClickBehavior || 'menu'}
              onChange={(e) => updateConfig('rightClickBehavior', e.target.value as any)}
              className={`w-full p-3 border rounded-xl text-sm font-medium outline-none shadow-sm focus:ring-2 focus:ring-emerald-500/50 transition-colors cursor-pointer ${isDark ? 'bg-black/40 border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] text-white' : 'bg-white border-black/10 text-slate-800 hover:border-black/20'}`}
            >
               <option value="menu">{t('terminal.rightClickMenu')}</option>
               <option value="paste">{t('terminal.rightClickPaste')}</option>
            </select>
          </div>

          <div className={`pt-4 border-t ${isDark ? 'border-white/5' : 'border-black/5'}`}>
            <label className="flex items-center justify-between cursor-pointer group">
              <div className="flex flex-col ml-1">
                <span className={`text-[11px] font-bold uppercase tracking-[0.2em] ${!isDark ? 'opacity-40' : 'opacity-70 group-hover:opacity-100 transition-opacity'}`}>{t('terminal.copyOnSelect')}</span>
                <span className="text-[10px] opacity-40 mt-1">{t('terminal.copyOnSelectDesc')}</span>
              </div>
              <button 
                onClick={() => updateConfig('copyOnSelect', !appConfig.copyOnSelect)} 
                className={`relative w-12 h-6 rounded-xl border border-black/20 dark:border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-colors flex-shrink-0 ${appConfig.copyOnSelect ? 'bg-emerald-500' : 'bg-black/20 dark:bg-white/10'}`}
              >
                <div className={`absolute top-1 left-1 bg-white shadow-sm w-4 h-4 rounded-xl transition-transform ${appConfig.copyOnSelect ? 'translate-x-6' : 'translate-x-0'}`} />
              </button>
            </label>
          </div>
        </div>

        {/* Scrollback & Padding & Bell (Span 2) */}
        <div className={`col-span-full rounded-3xl p-6 border flex flex-col md:flex-row gap-8 ${isDark ? 'bg-white/[0.02] border-white/10' : 'bg-white border-black/5'}`}>
          {/* Padding */}
          <div className="flex-1">
            <div className="flex justify-between items-center mb-4">
              <h3 className={`text-[11px] font-bold uppercase tracking-[0.2em] ml-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{t('terminal.terminalPadding')}</h3>
              <span className="text-xs font-mono font-bold">{appConfig.terminalPadding ?? 8}px</span>
            </div>
            <div className={`p-5 rounded-2xl ${isDark ? 'bg-black/20' : 'bg-black/5'}`}>
              <input 
                type="range" min="0" max="32" step="2" 
                value={appConfig.terminalPadding ?? 8}
                onChange={(e) => updateConfig('terminalPadding', parseInt(e.target.value))}
                className="w-full h-1.5 bg-white/10 rounded-xl appearance-none cursor-pointer accent-emerald-500"
              />
              <div className="text-[10px] opacity-40 mt-4 text-center uppercase tracking-wider">{t('terminal.terminalPaddingDesc')}</div>
            </div>
          </div>

          <div className={`hidden md:block w-px ${isDark ? 'bg-white/5' : 'bg-black/5'}`} />

          {/* Scrollback & Bell */}
          <div className="flex-1 flex flex-col gap-6">
            <div>
              <h3 className={`text-[11px] font-bold uppercase tracking-[0.2em] mb-3 ml-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{t('terminal.scrollback')}</h3>
              <input type="number" min="1000" step="1000" value={appConfig.scrollback || 10000} onChange={(e) => updateConfig('scrollback', parseInt(e.target.value) || 10000)} className={`w-full p-3 border rounded-xl text-sm font-medium outline-none shadow-sm focus:ring-2 focus:ring-emerald-500/50 transition-colors ${isDark ? 'bg-black/40 border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] text-white' : 'bg-white border-black/10 text-slate-800 hover:border-black/20'}`} />
              <div className="text-[10px] uppercase tracking-wider mt-2 ml-1 text-emerald-500 font-bold">{t('terminal.scrollbackNote')}</div>
            </div>
            <div className={`pt-4 border-t ${isDark ? 'border-white/5' : 'border-black/5'}`}>
              <h3 className={`text-[11px] font-bold uppercase tracking-[0.2em] mb-3 ml-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{t('terminal.bellStyle')}</h3>
              <select 
                value={appConfig.bellStyle || 'visual'}
                onChange={(e) => updateConfig('bellStyle', e.target.value as any)}
                className={`w-full p-3 border rounded-xl text-sm font-medium outline-none shadow-sm focus:ring-2 focus:ring-emerald-500/50 transition-colors cursor-pointer ${isDark ? 'bg-black/40 border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] text-white' : 'bg-white border-black/10 text-slate-800 hover:border-black/20'}`}
              >
                 <option value="none">{t('terminal.bellNone')}</option>
                 <option value="audible">{t('terminal.bellAudible')}</option>
                 <option value="visual">{t('terminal.bellVisual')}</option>
              </select>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
