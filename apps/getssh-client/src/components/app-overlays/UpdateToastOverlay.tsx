import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Monitor, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store/appStore';

export const UpdateToastOverlay: React.FC = () => {
  const { t } = useTranslation();
  const updateAvailable = useAppStore(state => state.updateAvailable);
  const setUpdateAvailable = useAppStore(state => state.setUpdateAvailable);
  const isDark = useAppStore(state => state.isDark);

  return (
    <AnimatePresence>
      {updateAvailable && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className={`absolute bottom-6 right-6 p-4 rounded-xl shadow-2xl border flex flex-col gap-3 z-[200] max-w-sm ${isDark ? 'bg-[#2a2a2a] border-white/10 text-white' : 'bg-white border-black/10 text-black'}`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0">
                <Monitor className="w-4 h-4" />
              </div>
              <div>
                <h4 className="font-bold text-sm">{t('update.bannerTitle', { version: updateAvailable.version })}</h4>
                <p className="text-xs opacity-70 mt-0.5">{t('update.bannerDesc')}</p>
              </div>
            </div>
            <button onClick={() => setUpdateAvailable(null)} className="opacity-50 hover:opacity-100 p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setUpdateAvailable(null)} className={`flex-1 py-1.5 text-xs font-medium rounded-lg border transition-all ${isDark ? 'border-white/20 hover:bg-white/10 text-white/70 hover:text-white' : 'border-black/20 hover:bg-black/5 text-black/70 hover:text-black'}`}>
              {t('update.bannerDismiss')}
            </button>
            <button onClick={() => { window.electronAPI.openExternal(updateAvailable.url); setUpdateAvailable(null); }} className="flex-1 py-1.5 text-xs font-medium rounded-lg bg-primary hover:bg-primary/80 text-white shadow-md shadow-primary/20 transition-all">
              {t('update.bannerDownload')}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
