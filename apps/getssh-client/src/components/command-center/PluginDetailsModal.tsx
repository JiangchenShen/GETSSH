import React, { useState, useEffect } from 'react';
import { Box } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { usePluginStore } from '../../store/pluginStore';

interface PluginDetailsModalProps {
  plugin: any;
  isDark: boolean;
  onClose: () => void;
}

export const PluginDetailsModal: React.FC<PluginDetailsModalProps> = ({ plugin, isDark, onClose }) => {
  const { t } = useTranslation();
  const schema = usePluginStore(state => state.settingsSchemas[plugin.name]);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      if (!schema) return;
      const data: Record<string, any> = {};
      await Promise.all(
        schema.map(async (field: any) => {
          const val = await window.electronAPI.pluginStorageGet(plugin.name, field.id);
          data[field.id] = val !== null && val !== undefined ? val : field.default;
        })
      );
      setFormData(data);
    };
    loadData();
  }, [plugin.name, schema]);

  const handleSavePluginSettings = async () => {
    setSaving(true);
    try {
      await Promise.all(
        Object.entries(formData).map(([key, value]) =>
          window.electronAPI.pluginStorageSet(plugin.name, key, value)
        )
      );
      await window.electronAPI.reloadPlugin(plugin.name);
      onClose();
    } catch (err: any) {
      alert(t('commandCenter.saveFailed', 'Failed to save settings: {{message}}', { message: err.message }));
    }
    setSaving(false);
  };

  const displayName = plugin.getssh?.name || plugin.displayName || plugin.name;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, y: 10 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className={`absolute inset-0 z-50 flex flex-col p-6 overflow-hidden ${isDark ? 'bg-[#121214]/95 backdrop-blur-3xl' : 'bg-white/95 backdrop-blur-3xl'}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-6 shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center">
             <Box className="w-6 h-6 text-purple-500" />
          </div>
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              {displayName}
              <span className="text-xs font-mono opacity-50 px-2 py-0.5 rounded border border-current/10">v{plugin.version}</span>
            </h2>
            <p className="text-sm opacity-60 mt-0.5">{plugin.description}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
        {!schema || schema.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center opacity-50 bg-white/5 px-6 py-4 rounded-xl border border-white/5">
              {t('commandCenter.noParameters', 'This plugin does not expose any configurable parameters.')}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <h3 className="text-xs font-bold uppercase opacity-50 tracking-widest border-b border-current/10 pb-2 mb-4">
              {t('commandCenter.parametersTitle', 'Parameters')}
            </h3>
            {schema.map((field: any) => (
              <div key={field.id} className="flex flex-col gap-1.5 mb-4">
                <label className="text-sm font-semibold opacity-80">{field.label}</label>
                {field.description && <span className="text-xs opacity-50">{field.description}</span>}
                
                {field.type === 'boolean' ? (
                  <input 
                    type="checkbox" 
                    checked={!!formData[field.id]}
                    onChange={e => setFormData({ ...formData, [field.id]: e.target.checked })}
                    className="mt-1 w-4 h-4"
                  />
                ) : field.type === 'password' ? (
                  <input 
                    type="password"
                    value={formData[field.id] || ''}
                    onChange={e => setFormData({ ...formData, [field.id]: e.target.value })}
                    className={`px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all ${isDark ? 'bg-black/20 border-white/10' : 'bg-white border-black/10'}`}
                  />
                ) : field.type === 'number' ? (
                  <input 
                    type="number"
                    value={formData[field.id] || ''}
                    onChange={e => setFormData({ ...formData, [field.id]: parseFloat(e.target.value) })}
                    className={`px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all ${isDark ? 'bg-black/20 border-white/10' : 'bg-white border-black/10'}`}
                  />
                ) : (
                  <input 
                    type="text"
                    value={formData[field.id] || ''}
                    onChange={e => setFormData({ ...formData, [field.id]: e.target.value })}
                    className={`px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all ${isDark ? 'bg-black/20 border-white/10' : 'bg-white border-black/10'}`}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-current/10 shrink-0">
        <button 
          onClick={onClose}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
        >
          {t('common.close', 'Close')}
        </button>
        {schema && schema.length > 0 && (
          <button 
            onClick={handleSavePluginSettings}
            disabled={saving}
            className="px-6 py-2 bg-purple-600 hover:bg-purple-500 active:scale-95 transition-all rounded-lg font-medium shadow-lg shadow-purple-500/20"
          >
            {t('commandCenter.saveReload', 'Save & Reload')}
          </button>
        )}
      </div>
    </motion.div>
  );
};
