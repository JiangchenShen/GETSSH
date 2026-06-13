import React from 'react';
import { useAppStore } from '../store/appStore';
import { useTranslation } from 'react-i18next';
import { Blocks, X } from 'lucide-react';
import { PluginSettings } from './PluginSettings';

export const PluginCenterModal: React.FC = () => {
  const isPluginCenterOpen = useAppStore(state => (state as any).isPluginCenterOpen);
  const setIsPluginCenterOpen = useAppStore(state => (state as any).setIsPluginCenterOpen);
  const isDark = useAppStore(state => state.isDark);
  const { t } = useTranslation();

  if (!isPluginCenterOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-300">
      <div 
        className={`w-full h-full max-w-5xl max-h-[85vh] md:rounded-none shadow-2xl border flex flex-col overflow-hidden ${
          isDark 
            ? 'bg-[#0f0f0f]/90 border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] text-white' 
            : 'bg-white/90 border-black/20 text-slate-900'
        }`}
      >
        {/* Header */}
        <div className={`flex items-center justify-between p-6 border-b ${isDark ? 'border-white/10' : 'border-black/10'}`}>
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-none ${isDark ? 'bg-rose-500/20 text-rose-400' : 'bg-rose-100 text-rose-600'}`}>
              <Blocks className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-widest uppercase">PLUGIN CENTER</h2>
              <p className={`text-sm font-medium ${isDark ? 'text-white/50' : 'text-black/50'}`}>第三方插件与沙箱管控</p>
            </div>
          </div>
          <button 
            onClick={() => setIsPluginCenterOpen(false)}
            className={`p-2 rounded-none transition-colors ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-3xl mx-auto">
             <PluginSettings isDark={isDark} />
          </div>
        </div>
      </div>
    </div>
  );
};
