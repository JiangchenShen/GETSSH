import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Monitor, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../store/appStore';

export const UpdateToastOverlay: React.FC = () => {
  const { t } = useTranslation();
  const updateAvailable = useAppStore(state => state.updateAvailable);
  const setUpdateAvailable = useAppStore(state => state.setUpdateAvailable);

  return (
    <AnimatePresence>
      {updateAvailable && (
        <motion.div 
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.165, ease: 'easeOut' }}
          className="absolute bottom-6 right-6 p-4 rounded-xl shadow-xl border border-line bg-surf text-ink flex flex-col gap-3 z-[200] max-w-sm"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-md bg-surf-2 text-primary flex items-center justify-center shrink-0">
                <Monitor className="w-4 h-4" />
              </div>
              <div>
                <h4 className="font-semibold text-sm text-ink">{t('update.bannerTitle', { version: updateAvailable.version })}</h4>
                <p className="text-xs text-ink-2 mt-0.5">{t('update.bannerDesc')}</p>
              </div>
            </div>
            <button type="button" onClick={() => setUpdateAvailable(null)} className="text-ink-3 hover:text-ink p-1 rounded-md hover:bg-surf-2 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setUpdateAvailable(null)} className="flex-1 py-1.5 text-xs font-medium rounded-md border border-line bg-surf hover:bg-surf-2 text-ink-2 hover:text-ink transition-colors">
              {t('update.bannerDismiss')}
            </button>
            <button type="button" onClick={() => { window.electronAPI.openExternal(updateAvailable.url); setUpdateAvailable(null); }} className="flex-1 py-1.5 text-xs font-semibold rounded-md bg-primary hover:brightness-95 text-[var(--primary-ink)] transition-colors">
              {t('update.bannerDownload')}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
