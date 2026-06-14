import React from 'react';
import { motion } from 'framer-motion';
import { X, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SettingsView } from '../SettingsView';

interface SettingsModalOverlayProps {
  isOpen: boolean;
  isDark: boolean;
  settingsActiveTab: string;
  encryptionDisabled: boolean;
  onClose: () => void;
  setSettingsActiveTab: (tab: any) => void;
}

export const SettingsModalOverlay: React.FC<SettingsModalOverlayProps> = ({
  isOpen,
  isDark,
  settingsActiveTab,
  encryptionDisabled,
  onClose,
  setSettingsActiveTab
}) => {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-xl transition-all"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30, mass: 1.0 }}
        className={`relative w-[90vw] h-[90vh] max-w-[1200px] flex flex-col overflow-hidden border shadow-2xl rounded-xl ${
          isDark ? 'bg-[#0A0A0A]/95 border-white/10' : 'bg-white/95 border-black/10'
        } backdrop-blur-3xl`}
      >
        <div className={`shrink-0 flex items-center justify-between p-8 border-b ${isDark ? 'border-white/5 bg-white/5' : 'border-black/5 bg-black/5'}`} style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <h2 className="text-3xl font-black tracking-tighter flex items-center gap-4">
             <Settings className="w-8 h-8 text-primary" /> {t('settings.configuration')}
          </h2>
          <button 
            onClick={onClose}
            className={`p-3 transition-colors rounded-xl ${isDark ? 'hover:bg-white/10 text-white' : 'hover:bg-black/10 text-black'}`}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <X className="w-6 h-6" />
          </button>
        </div>
        
        <div className="flex-1 flex overflow-hidden relative" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
           <SettingsView 
             settingsActiveTab={settingsActiveTab as any}
             setSettingsActiveTab={setSettingsActiveTab}
             encryptionDisabled={encryptionDisabled}
           />
        </div>
      </motion.div>
    </motion.div>
  );
};
