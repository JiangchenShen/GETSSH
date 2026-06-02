import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../store/appStore';
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from 'lucide-react';

export const ToastProvider: React.FC = () => {
  const toasts = useAppStore(state => state.toasts);
  const removeToast = useAppStore(state => state.removeToast);
  const isDark = useAppStore(state => state.isDark);

  const getIcon = (type: string) => {
    switch (type) {
      case 'success': return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case 'warning': return <AlertTriangle className="w-4 h-4 text-amber-500" />;
      case 'error': return <XCircle className="w-4 h-4 text-red-500" />;
      case 'info':
      default: return <Info className="w-4 h-4 text-blue-400" />;
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
            className={`px-4 py-3 rounded-lg flex items-center gap-3 text-sm min-w-[240px] max-w-md shadow-2xl pointer-events-auto ${
              isDark 
                ? 'water-glass text-neutral-200 border border-neutral-800/50' 
                : 'bg-white/90 backdrop-blur-xl text-slate-700 border border-slate-200/50 shadow-slate-200/50'
            }`}
          >
            <div className="shrink-0">{getIcon(toast.type)}</div>
            <div className="flex-1 font-medium">{toast.message}</div>
            <button
              onClick={() => removeToast(toast.id)}
              className={`shrink-0 p-1 rounded-md transition-colors ${
                isDark ? 'hover:bg-white/10 text-neutral-500 hover:text-neutral-300' : 'hover:bg-slate-100 text-slate-400 hover:text-slate-600'
              }`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
