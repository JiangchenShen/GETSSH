import React from 'react';
import { Monitor, Download, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../../store/appStore';
import { parseCustomTheme } from '../../../utils/themes';
import { Palette, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
const HexColorPicker = ({ value, onChange, label, isDark }: { value: string, onChange: (hex: string) => void, label: string, isDark: boolean }) => {
  const [localHex, setLocalHex] = React.useState(value);
  
  React.useEffect(() => {
    setLocalHex(value);
  }, [value]);

  return (
    <div className="flex flex-col gap-2 w-full">
      <span className={`text-[10px] font-bold opacity-50 uppercase`}>{label}</span>
      <div className={`flex items-center gap-2 p-1.5 rounded-xl border transition-all focus-within:ring-2 focus-within:ring-primary focus-within:border-transparent ${isDark ? 'border-white/10 bg-black/20' : 'border-black/10 bg-black/5'}`}>
        <input
          type="color"
          value={localHex}
          onChange={(e) => {
            setLocalHex(e.target.value);
            onChange(e.target.value);
          }}
          className="w-8 h-8 rounded-lg cursor-pointer bg-transparent border-none p-0 overflow-hidden shrink-0 shadow-[0_0_10px_rgba(0,0,0,0.1)]"
        />
        <div className={`w-px h-6 mx-1 ${isDark ? 'bg-white/10' : 'bg-black/10'}`} />
        <span className={`text-xs font-mono font-bold opacity-40 ml-1 ${isDark ? 'text-white' : 'text-black'}`}>#</span>
        <input
          type="text"
          value={localHex.replace('#', '').toUpperCase()}
          onChange={(e) => {
            const newHex = '#' + e.target.value.replace(/[^0-9A-Fa-f]/g, '').slice(0, 6);
            setLocalHex(newHex);
            if (/^#[0-9A-F]{6}$/i.test(newHex)) {
              onChange(newHex);
            }
          }}
          className={`bg-transparent text-xs font-mono font-bold w-full outline-none uppercase tracking-widest ${isDark ? 'text-white' : 'text-black'}`}
          maxLength={6}
          placeholder="FFFFFF"
        />
      </div>
    </div>
  );
};

export const AppearanceTab: React.FC = () => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const appConfig = useAppStore(state => state.appConfig);
  const updateConfig = useAppStore(state => state.updateConfig);
  const [isCustomPickerOpen, setIsCustomPickerOpen] = React.useState(false);

  const handleImportTheme = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const raw = event.target?.result as string;
      const theme = parseCustomTheme(raw);
      if (theme) {
        const themeName = file.name.replace(/\.json$/i, '');
        const key = `custom_${themeName}`;
        const newThemes = { ...(appConfig.customThemes || {}), [key]: theme };
        updateConfig('customThemes', newThemes);
        updateConfig('terminalTheme', key);
        window.alert(t('appearance.importSuccess') || 'Theme imported successfully!');
      } else {
        window.alert(t('appearance.importFail') || 'Failed to parse theme. Invalid format.');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  return (
    <div className="max-w-4xl mx-auto w-full px-8 pt-8 pb-24 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Immersive Header */}
      <div className="flex flex-col gap-2 mb-10 relative group">
        <div className={`absolute -left-10 top-0 w-40 h-40 rounded-full blur-[60px] opacity-0 group-hover:opacity-100 transition-opacity duration-1000 pointer-events-none ${isDark ? 'bg-fuchsia-500/20' : 'bg-fuchsia-500/10'}`} />
        <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-4 relative z-10">
          <div className={`p-2.5 rounded-[1.25rem] ${isDark ? 'bg-fuchsia-500/20 text-fuchsia-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]' : 'bg-fuchsia-500/10 text-fuchsia-600'}`}>
            <Monitor className="w-7 h-7" />
          </div>
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-fuchsia-400 to-purple-600 pb-1">
            {t('settings.appearance')}
          </span>
        </h1>
        <p className={`text-sm ml-[4.5rem] ${isDark ? 'text-white/50' : 'text-black/50'}`}>
          {t('settings.appearanceHeaderDesc')}
        </p>
      </div>

      {/* Bento Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        {/* Global Theme & Color Group (Span 2) */}
        <div className={`col-span-1 md:col-span-2 rounded-3xl p-6 border flex flex-col md:flex-row gap-8 ${isDark ? 'bg-white/[0.02] border-white/10' : 'bg-white border-black/5'}`}>
          {/* Left: UI Theme Mode */}
          <div className="flex-1 flex flex-col justify-between">
            <div>
              <h3 className={`text-[11px] font-bold uppercase tracking-[0.2em] mb-4 ml-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{t('settings.appTheme')}</h3>
              <div className={`flex p-1.5 rounded-[1.25rem] ${isDark ? 'bg-black/30 shadow-inner border border-white/5' : 'bg-slate-100/80 shadow-inner border border-black/5'}`}>
                {(['system', 'light', 'dark'] as const).map(themeOpt => {
                  const active = appConfig.theme === themeOpt;
                  return (
                    <button 
                      key={themeOpt} 
                      onClick={() => updateConfig('theme', themeOpt)} 
                      className={`flex-1 py-2.5 text-xs font-bold rounded-xl transition-all duration-300 ${active ? (isDark ? 'bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] ring-1 ring-white/10' : 'bg-white text-slate-900 shadow-sm border border-black/5') : (isDark ? 'text-white/40 hover:text-white/70 hover:bg-white/5' : 'text-slate-500 hover:text-slate-800 hover:bg-black/5')}`}
                    >
                      {t(`settings.${themeOpt === 'system' ? 'systemTheme' : themeOpt}`)}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className={`hidden md:block w-px ${isDark ? 'bg-white/5' : 'bg-black/5'}`} />

          {/* Right: Accent Color */}
          <div className="flex-1 flex flex-col justify-between relative">
            <div>
              <h3 className={`text-[11px] font-bold uppercase tracking-[0.2em] mb-4 ml-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{t('appearance.themeColorsTitle')}</h3>
              <div className="flex flex-col gap-6 p-1.5">
                
                {/* Row 1: Solid Colors */}
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className={`text-[10px] font-bold opacity-50 uppercase tracking-widest`}>{t('appearance.monoColor')}</span>
                    {/* Custom Duo-Tone Menu Trigger */}
                    <button
                      onClick={() => setIsCustomPickerOpen(true)}
                      className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded-lg flex items-center gap-1.5 transition-all border ${isDark ? 'border-white/10 text-white/60 hover:text-white hover:bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]' : 'border-black/10 text-black/60 hover:text-black hover:bg-black/5 shadow-sm'}`}
                      title="Custom Theme Menu"
                    >
                      <Palette size={12} /> {t('appearance.custom')}
                    </button>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    {[
                      { name: 'appearance.colors.cyberPurple', color: '168 85 247', bg: 'bg-[#a855f7]' },
                      { name: 'appearance.colors.geekGreen',   color: '34 197 94',  bg: 'bg-[#22c55e]' },
                      { name: 'appearance.colors.deepBlue',    color: '59 130 246', bg: 'bg-[#3b82f6]' },
                      { name: 'appearance.colors.geekRed',     color: '239 68 68',  bg: 'bg-[#ef4444]' },
                    ].map(swatch => (
                      <button 
                        key={swatch.color}
                        onClick={() => {
                          updateConfig('themeColor', swatch.color);
                          updateConfig('duoTone', null);
                        }}
                        className={`w-8 h-8 rounded-xl transition-all ${swatch.bg} ${
                          appConfig.themeColor === swatch.color && !appConfig.duoTone
                            ? 'ring-2 ring-offset-4 ring-primary dark:ring-offset-[#1e1e1e] ring-offset-slate-50 scale-110 shadow-[inset_0_1px_0_rgba(255,255,255,0.3)]' 
                            : 'hover:scale-105 opacity-80 hover:opacity-100'
                        }`}
                        title={t(swatch.name)}
                      />
                    ))}
                  </div>
                </div>

                {/* Row 2: Duo-Tone Colors */}
                <div className="flex flex-col gap-3">
                  <span className={`text-[10px] font-bold opacity-50 uppercase tracking-widest`}>{t('appearance.duoTone')}</span>
                  <div className="flex items-center gap-3 flex-wrap">
                    {[
                      { name: 'appearance.colors.goldBlack', a: '255 215 0', b: '0 0 0' },
                      { name: 'appearance.colors.blueGray', a: '0 212 255', b: '44 44 52' },
                      { name: 'appearance.colors.redBlack', a: '230 26 35', b: '10 9 12' },
                      { name: 'appearance.colors.greenGray', a: '191 255 0', b: '34 34 34' },
                      { name: 'appearance.colors.pinkPurple', a: '255 0 128', b: '106 13 173' },
                      { name: 'appearance.colors.orangeBlue', a: '255 100 0', b: '110 240 255' },
                      { name: 'appearance.colors.mintRed', a: '152 255 152', b: '210 4 45' },
                    ].map(swatch => {
                      const isActive = appConfig.duoTone?.colorA === swatch.a && appConfig.duoTone?.colorB === swatch.b;
                      return (
                        <button 
                          key={swatch.name}
                          onClick={() => updateConfig('duoTone', { colorA: swatch.a, colorB: swatch.b })}
                          className={`w-8 h-8 rounded-full transition-all flex overflow-hidden border ${isDark ? 'border-white/10' : 'border-black/10'} ${
                            isActive 
                              ? 'ring-2 ring-offset-4 ring-primary dark:ring-offset-[#1e1e1e] ring-offset-slate-50 scale-110 shadow-[0_0_15px_rgba(255,255,255,0.1)]' 
                              : 'hover:scale-105 opacity-80 hover:opacity-100'
                          }`}
                          title={t(swatch.name)}
                        >
                          <div className="w-1/2 h-full" style={{ backgroundColor: `rgb(${swatch.a})` }} />
                          <div className="w-1/2 h-full" style={{ backgroundColor: `rgb(${swatch.b})` }} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Custom Duo-Tone Overlay */}
            <AnimatePresence>
              {isCustomPickerOpen && (
                <motion.div 
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  className={`absolute right-0 top-12 z-50 p-5 rounded-3xl shadow-2xl border ${isDark ? 'bg-[#18181b]/80 backdrop-blur-2xl border-white/10 shadow-black/50' : 'bg-white/80 backdrop-blur-2xl border-black/10 shadow-black/10'}`}
                >
                  <div className="flex justify-between items-center mb-5">
                    <h4 className={`text-xs font-bold uppercase tracking-wider ${isDark ? 'text-white' : 'text-black'}`}>自定义双轨色</h4>
                    <button onClick={() => setIsCustomPickerOpen(false)} className={`p-1.5 rounded-md transition-colors ${isDark ? 'hover:bg-white/10 text-white/50 hover:text-white' : 'hover:bg-black/10 text-black/50 hover:text-black'}`}>
                      <X size={14} />
                    </button>
                  </div>
                  <div className="flex flex-col gap-6 w-80">
                    {/* Solid Track */}
                    <HexColorPicker
                      label="单色模式 (Mono)"
                      isDark={isDark}
                      value={`#${appConfig.themeColor?.split(' ').map(n => parseInt(n).toString(16).padStart(2,'0')).join('') || 'a855f7'}`}
                      onChange={(hex) => {
                        const r = parseInt(hex.slice(1,3),16);
                        const g = parseInt(hex.slice(3,5),16);
                        const b = parseInt(hex.slice(5,7),16);
                        updateConfig('themeColor', `${r} ${g} ${b}`);
                        updateConfig('duoTone', null);
                      }}
                    />

                    <div className={`w-full h-px ${isDark ? 'bg-white/10' : 'bg-black/10'}`} />

                    {/* Duo-Tone Tracks */}
                    <div className="flex gap-4">
                      <HexColorPicker
                        label="轨道 A"
                        isDark={isDark}
                        value={appConfig.duoTone ? `#${appConfig.duoTone.colorA.split(' ').map(n => parseInt(n).toString(16).padStart(2,'0')).join('')}` : '#00d4ff'}
                        onChange={(hex) => {
                          const r = parseInt(hex.slice(1,3),16);
                          const g = parseInt(hex.slice(3,5),16);
                          const b = parseInt(hex.slice(5,7),16);
                          updateConfig('duoTone', { colorA: `${r} ${g} ${b}`, colorB: appConfig.duoTone?.colorB || '44 44 52' });
                        }}
                      />
                      <HexColorPicker
                        label="轨道 B"
                        isDark={isDark}
                        value={appConfig.duoTone ? `#${appConfig.duoTone.colorB.split(' ').map(n => parseInt(n).toString(16).padStart(2,'0')).join('')}` : '#2c2c34'}
                        onChange={(hex) => {
                          const r = parseInt(hex.slice(1,3),16);
                          const g = parseInt(hex.slice(3,5),16);
                          const b = parseInt(hex.slice(5,7),16);
                          updateConfig('duoTone', { colorA: appConfig.duoTone?.colorA || '0 212 255', colorB: `${r} ${g} ${b}` });
                        }}
                      />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Glassmorphism Settings */}
        <div className={`rounded-3xl p-6 border flex flex-col gap-6 ${isDark ? 'bg-white/[0.02] border-white/10' : 'bg-white border-black/5'}`}>
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className={`text-[11px] font-bold uppercase tracking-[0.2em] ml-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>
                {t('appearance.enableGlassmorphism')}
              </h3>
              <button 
                disabled={!isDark}
                onClick={() => updateConfig('enableGlassmorphism', !appConfig.enableGlassmorphism)}
                className={`relative w-12 h-6 rounded-xl border border-black/20 dark:border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-colors ${!isDark ? 'bg-slate-200 cursor-not-allowed' : appConfig.enableGlassmorphism ? 'bg-fuchsia-500' : 'bg-black/20 dark:bg-white/10'}`}
              >
                <div className={`absolute top-1 left-1 bg-white shadow-sm w-4 h-4 rounded-xl transition-transform ${appConfig.enableGlassmorphism && isDark ? 'translate-x-6' : 'translate-x-0'}`} />
              </button>
            </div>
            {!isDark ? (
              <div className="text-[10px] text-orange-500/80 font-bold tracking-widest uppercase ml-1">
                * {t('appearance.glassmorphismOnlyDark')}
              </div>
            ) : (
              <div className={`text-[10px] uppercase tracking-widest font-bold ml-1 ${appConfig.enableGlassmorphism ? 'text-fuchsia-400' : 'text-white/30'}`}>
                {appConfig.enableGlassmorphism ? 'Active' : 'Disabled'}
              </div>
            )}
          </div>
          
          {isDark && appConfig.enableGlassmorphism && (
            <div className={`p-4 rounded-2xl ${isDark ? 'bg-black/20' : 'bg-black/5'}`}>
              <div className="flex justify-between items-center mb-3">
                <label className="text-[10px] font-bold uppercase tracking-wider opacity-50">{t('appearance.glassmorphismOpacity')}</label>
                <span className="text-xs font-mono font-bold">{Math.round((appConfig.bgOpacity || 1) * 100)}%</span>
              </div>
              <input 
                type="range" min="0.3" max="1" step="0.05" 
                value={appConfig.bgOpacity || 1}
                onChange={(e) => updateConfig('bgOpacity', parseFloat(e.target.value) || 0.8)}
                className="w-full h-1.5 bg-white/10 rounded-xl appearance-none cursor-pointer accent-fuchsia-500"
              />
            </div>
          )}
        </div>

        {/* Vision / Anti-Glare & Language */}
        <div className={`rounded-3xl p-6 border flex flex-col justify-between gap-6 ${isDark ? 'bg-white/[0.02] border-white/10' : 'bg-white border-black/5'}`}>
          {/* Language */}
          <div>
            <h3 className={`text-[11px] font-bold uppercase tracking-[0.2em] mb-4 ml-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{t('settings.language')}</h3>
            <select 
              value={appConfig.language}
              onChange={(e) => updateConfig('language', e.target.value)}
              className={`w-full p-3 border rounded-xl text-sm font-medium outline-none shadow-sm focus:ring-2 focus:ring-fuchsia-500/50 transition-colors cursor-pointer ${isDark ? 'bg-black/40 border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] text-white' : 'bg-white border-black/10 text-slate-800 hover:border-black/20'}`}
            >
              <option value="en-US">English (US)</option>
              <option value="zh-CN">简体中文 (Simplified Chinese)</option>
            </select>
          </div>
          
          {/* Anti-Glare */}
          <div className={`pt-4 border-t ${isDark ? 'border-white/5' : 'border-black/5'}`}>
            <label className="flex items-center justify-between cursor-pointer group">
              <div className="flex flex-col ml-1">
                <span className={`text-[11px] font-bold uppercase tracking-[0.2em] ${!isDark ? 'opacity-40' : 'opacity-70 group-hover:opacity-100 transition-opacity'}`}>{t('settings.antiGlare')}</span>
                <span className="text-[10px] opacity-40 mt-1">{t('settings.antiGlareDesc')}</span>
              </div>
              <button 
                disabled={!isDark}
                onClick={() => updateConfig('antiGlare', !appConfig.antiGlare)} 
                className={`relative w-12 h-6 rounded-xl border border-black/20 dark:border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-colors flex-shrink-0 ${!isDark ? 'bg-slate-200 cursor-not-allowed' : appConfig.antiGlare ? 'bg-fuchsia-500' : 'bg-black/20 dark:bg-white/10'}`}
              >
                <div className={`absolute top-1 left-1 bg-white shadow-sm w-4 h-4 rounded-xl transition-transform ${appConfig.antiGlare ? 'translate-x-6' : 'translate-x-0'}`} />
              </button>
            </label>
          </div>
        </div>
        
        {/* Terminal Theme (Span 2) */}
        <div className={`col-span-1 md:col-span-2 rounded-3xl p-6 border flex flex-col gap-4 ${isDark ? 'bg-white/[0.02] border-white/10' : 'bg-white border-black/5'}`}>
          <h3 className={`text-[11px] font-bold uppercase tracking-[0.2em] ml-1 ${isDark ? 'text-white/40' : 'text-black/40'}`}>{t('appearance.terminalTheme')}</h3>
          <div className="flex gap-3">
            <select 
              value={appConfig.terminalTheme || 'default'}
              onChange={(e) => updateConfig('terminalTheme', e.target.value)}
              className={`flex-1 p-3 border rounded-xl text-sm font-medium outline-none shadow-sm focus:ring-2 focus:ring-fuchsia-500/50 transition-colors cursor-pointer ${isDark ? 'bg-black/40 border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] text-white' : 'bg-white border-black/10 text-slate-800 hover:border-black/20'}`}
            >
              <option value="default">{t('appearance.themeDefault')} (Transparent Blend)</option>
              <option disabled>───── Built-in Themes ─────</option>
              <option value="dracula">Dracula (Dark & Vibrant)</option>
              <option value="nord">Nord (Arctic Blue)</option>
              <option value="gruvbox">Gruvbox (Retro Warm)</option>
              <option value="tokyo-night">Tokyo Night (Neon Pulse)</option>
              <option value="catppuccin">Catppuccin (Pastel Dream)</option>
              <option value="monokai">Monokai (Sublime Classic)</option>
              <option value="solarized">Solarized (Precision & Clarity)</option>
              {Object.keys(appConfig.customThemes || {}).length > 0 && (
                <>
                  <option disabled>───── Custom Imports ─────</option>
                  {Object.keys(appConfig.customThemes || {}).map(key => (
                    <option key={key} value={key}>{key.replace('custom_', '')}</option>
                  ))}
                </>
              )}
            </select>
            
            <div className="relative flex items-center group">
              <input
                type="file"
                accept=".json"
                onChange={handleImportTheme}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                title={t('appearance.importTheme') || 'Import Custom Theme'}
              />
              <button
                className={`px-4 py-3 h-full rounded-xl text-sm font-bold uppercase tracking-wider border transition-all flex items-center gap-2 ${isDark ? 'border-white/10 bg-white/5 hover:bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]' : 'border-black/10 bg-black/5 hover:bg-black/10 text-black'}`}
              >
                <Download size={16} className="opacity-70 group-hover:opacity-100 group-hover:scale-110 transition-all" />
                Import
              </button>
            </div>
            
            {appConfig.terminalTheme?.startsWith('custom_') && (
              <button
                onClick={() => {
                  const newCustom = { ...(appConfig.customThemes || {}) };
                  delete newCustom[appConfig.terminalTheme];
                  updateConfig('customThemes', newCustom);
                  updateConfig('terminalTheme', 'default');
                }}
                className={`px-4 py-3 rounded-xl text-sm font-bold uppercase border transition-all flex items-center gap-2 ${isDark ? 'border-red-500/20 bg-red-500/10 hover:bg-red-500/20 text-red-400' : 'border-red-500/20 bg-red-50 text-red-600 hover:bg-red-100'}`}
                title={t('appearance.deleteTheme') || 'Delete Theme'}
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
