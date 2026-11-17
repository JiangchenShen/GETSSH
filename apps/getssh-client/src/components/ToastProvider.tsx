import React from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/appStore';
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from 'lucide-react';

export const ToastProvider: React.FC = () => {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const toasts = useAppStore(state => state.toasts);
  const removeToast = useAppStore(state => state.removeToast);

  const getIcon = (type: string) => {
    switch (type) {
      case 'success': return <CheckCircle2 className="w-4 h-4 text-ok" />;
      case 'warning': return <AlertTriangle className="w-4 h-4 text-warn" />;
      case 'error': return <XCircle className="w-4 h-4 text-down" />;
      case 'info':
      default: return <Info className="w-4 h-4 text-primary" />;
    }
  };

  return (
    <div className="pointer-events-none fixed right-4 bottom-12 z-[9999] flex w-[min(22rem,calc(100%_-_2rem))] flex-col gap-2">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout={!reduceMotion}
            initial={reduceMotion ? false : { opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.15 }}
            className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-line bg-surf px-3 py-2.5 text-xs text-ink shadow-lg"
          >
            <div className="shrink-0">{getIcon(toast.type)}</div>
            <div role={toast.type === 'error' ? 'alert' : 'status'} className="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">{toast.message}</div>
            <button type="button" aria-label={t('common.close')}
              onClick={() => removeToast(toast.id)}
              className="shrink-0 rounded-md p-1 text-ink-3 transition-colors hover:bg-surf-2 hover:text-ink"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
