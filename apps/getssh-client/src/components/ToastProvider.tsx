import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../store/appStore';
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from 'lucide-react';

export const ToastProvider: React.FC = () => {
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
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="px-4 py-3 rounded-lg flex items-center gap-3 text-sm min-w-[240px] max-w-md shadow-2xl pointer-events-auto border border-line bg-panel text-ink"
          >
            <div className="shrink-0">{getIcon(toast.type)}</div>
            <div className="flex-1 font-medium">{toast.message}</div>
            <button
              onClick={() => removeToast(toast.id)}
              className="shrink-0 p-1 rounded-md text-ink-3 transition-colors hover:bg-surf hover:text-ink"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
