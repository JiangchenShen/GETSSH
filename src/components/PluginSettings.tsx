import React, { useEffect, useState } from 'react';
import { usePluginStore } from '../store/pluginStore';
import { Trash } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const PluginSettings = ({ isDark }: { isDark: boolean }) => {
  const { t } = useTranslation();
  const { installedPlugins, setPlugins } = usePluginStore();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    window.electronAPI.getPluginsList().then((res) => setPlugins(res || []));
  }, []);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0] as File & { path: string };
    if (file && file.path.endsWith('.zip')) {
      setLoading(true);
      try {
        const res = await window.electronAPI.installPlugin(file.path);
        if (res.success && res.manifest) {
          const newList = await window.electronAPI.getPluginsList();
          setPlugins(newList || []);
          alert(`🎉 Plugin [${res.manifest.displayName}] Installed! Restart GETSSH to initialize.`);
        } else {
          alert('❌ Install Failed: ' + res.error);
        }
      } catch (err: unknown) {
        alert('❌ Install Error: ' + (err instanceof Error ? err.message : String(err)));
      }
      setLoading(false);
    }
  };

  const handleUninstall = async (pluginName: string) => {
    if (window.confirm(`Are you sure you want to uninstall ${pluginName}?`)) {
      setLoading(true);
      const res = await window.electronAPI.uninstallPlugin(pluginName);
      if (res.success) {
        const newList = await window.electronAPI.getPluginsList();
        setPlugins(newList || []);
        alert(`🗑️ Plugin uninstalled successfully. Restart GETSSH to clear UI artifacts.`);
      } else {
        alert('❌ Uninstall Failed: ' + res.error);
      }
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8 max-w-xl">
      <div 
        onDrop={handleDrop} 
        onDragOver={(e) => e.preventDefault()}
        className={`border-2 border-dashed rounded-[20px] p-12 text-center cursor-pointer transition-all font-medium ${isDark ? 'border-primary-600/50 bg-primary-900/10 hover:bg-primary-900/30 text-primary-400' : 'border-primary-300 bg-primary-50/50 hover:bg-primary-100/50 text-primary-600'}`}
      >
        {loading ? t('plugins.unpacking') : t('plugins.dropzone')}
      </div>
      
      <div className="space-y-4">
        <h3 className="font-semibold opacity-70 uppercase tracking-widest text-sm mb-4">{t('plugins.installed')}</h3>
        {installedPlugins.length === 0 && (
          <div className="text-sm opacity-50">{t('plugins.noPlugins')}</div>
        )}
        {installedPlugins.map(p => (
          <div key={p.name} className={`flex flex-col p-4 border rounded-xl shadow-sm ${isDark ? 'border-white/10 bg-black/20' : 'border-black/5 bg-white/50'}`}>
            <div className="flex items-center justify-between">
              <h4 className="font-bold cursor-default">{p.displayName} <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-mono opacity-70 ${isDark ? 'bg-white/10' : 'bg-black/5'}`}>v{p.version}</span></h4>
              <button onClick={() => handleUninstall(p.name)} className="text-red-500/50 hover:text-red-500 hover:bg-red-500/10 p-1.5 rounded-md transition-all" title={t('plugins.uninstall')}>
                <Trash className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm opacity-60 mt-1">{p.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
