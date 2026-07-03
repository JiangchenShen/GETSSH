import React, { useEffect, useState } from 'react';
import { usePluginStore } from '../store/pluginStore';
import { Trash, ShieldAlert, CheckCircle2, AlertTriangle, Box, Settings2, PackagePlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import DOMPurify from 'dompurify';

export const PluginSettings = ({ isDark }: { isDark: boolean }) => {
  const { t } = useTranslation();
  const { installedPlugins, setPlugins } = usePluginStore();
  const [loading, setLoading] = useState(false);
  const [pendingInstall, setPendingInstall] = useState<{ manifest: any; tempDir: string; sourceDir: string } | null>(null);

  useEffect(() => {
    window.electronAPI.getPluginsList().then((res) => setPlugins(res || []));
  }, []);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0] as File;
    if (!file) return;

    // Use webUtils via IPC to safely retrieve the absolute path regardless of context isolation
    const realPath = window.electronAPI.getPathForFile ? window.electronAPI.getPathForFile(file) : (file as any).path;

    if (realPath && realPath.endsWith('.zip')) {
      // #9 FIX: If a previous preview is pending, clean it up first to avoid tempDir leaks
      if (pendingInstall) {
        await window.electronAPI.abortPluginInstall(pendingInstall.tempDir);
        // Note: we don't strictly need to setPendingInstall(null) because we will overwrite it on success,
        // but if preview fails we want it cleared. It's safer to clear it here.
        setPendingInstall(null);
      }

      setLoading(true);
      try {
        const res = await window.electronAPI.previewPlugin(realPath);
        if (res.success && res.manifest) {
          setPendingInstall({
            manifest: res.manifest,
            tempDir: res.tempDir!,
            sourceDir: res.sourceDir!
          });
        } else {
          const errorMsg = res.error || '';
          if (errorMsg.includes('lifecycle')) {
            alert(t('plugins.lifecycleGateError', 'Plugin rejected: Missing lifecycle capabilities for safe RASP shutdown.'));
          } else {
            alert(t('plugins.installFailed', { error: errorMsg }));
          }
        }
      } catch (err: unknown) {
        alert(t('plugins.installFailed', { error: err instanceof Error ? err.message : String(err) }));
      }
      setLoading(false);
    }
  };

  const confirmInstall = async () => {
    if (!pendingInstall) return;
    setLoading(true);
    try {
      const res = await window.electronAPI.commitPluginInstall(pendingInstall);
      if (res.success && res.manifest) {
        const newList = await window.electronAPI.getPluginsList();
        setPlugins(newList || []);
        const name = (res.manifest as any).getssh?.name || res.manifest.displayName || res.manifest.name;
        alert(t('plugins.installSuccess', { name, defaultValue: `Plugin ${name} installed successfully!` }));
      } else {
        alert(t('plugins.installFailed', { error: res.error }));
      }
    } catch (err: unknown) {
      alert(t('plugins.installFailed', { error: err instanceof Error ? err.message : String(err) }));
    }
    setPendingInstall(null);
    setLoading(false);
  };

  const cancelInstall = async () => {
    if (pendingInstall) {
      await window.electronAPI.abortPluginInstall(pendingInstall.tempDir);
      setPendingInstall(null);
    }
  };

  const handleUninstall = async (pluginName: string, displayName: string) => {
    if (window.confirm(t('plugins.uninstallConfirm', { name: displayName, defaultValue: `Are you sure you want to uninstall ${displayName}?` }))) {
      setLoading(true);
      const res = await window.electronAPI.uninstallPlugin(pluginName);
      if (res.success) {
        const newList = await window.electronAPI.getPluginsList();
        setPlugins(newList || []);
        alert(t('plugins.uninstallSuccess', { defaultValue: '🗑️ Plugin uninstalled. Restart GETSSH to clear UI.' }));
      } else {
        alert(t('plugins.installFailed', { error: res.error }));
      }
      setLoading(false);
    }
  };

  return (
    <div className="w-full flex flex-col gap-10">
      {pendingInstall && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-xl p-4 transition-all">
          <div className={`w-full max-w-lg rounded-3xl p-8 shadow-[0_20px_60px_rgba(0,0,0,0.5)] border ${isDark ? 'bg-[#151515]/90 border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] text-white' : 'bg-white/90 border-black/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] text-slate-900'}`}>
            <div className="flex items-center gap-3 mb-4 text-rose-500">
              <ShieldAlert className="w-8 h-8" />
              <h2 className="text-2xl font-black tracking-wide">{t('plugins.permissionReview', 'Permission Review')}</h2>
            </div>
            
            <p className="text-sm opacity-80 mb-6 leading-relaxed" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(t('plugins.permissionDesc', { name: pendingInstall.manifest.getssh?.name || pendingInstall.manifest.name, defaultValue: `You are about to install <strong>${pendingInstall.manifest.getssh?.name || pendingInstall.manifest.name}</strong>. Please review the requested capabilities before proceeding.` })) }}>
            </p>

            <div className="space-y-3 mb-8">
              {/* Parse Capabilities */}
              {(() => {
                const caps: string[] = pendingInstall.manifest.getssh?.capabilities || [];
                const items = [];
                
                if (caps.includes('storage:unlimited')) {
                  items.push(
                    <div key="storage:unlimited" className="flex gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-500">
                      <AlertTriangle className="w-5 h-5 shrink-0" />
                      <div className="text-sm font-medium">
                        <strong>storage:unlimited</strong> — {t('plugins.caps.storageUnlimited', 'Unlimited disk storage access (High Risk)')}
                      </div>
                    </div>
                  );
                } else if (caps.includes('storage:extended')) {
                  items.push(
                    <div key="storage:extended" className="flex gap-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-500">
                      <AlertTriangle className="w-5 h-5 shrink-0" />
                      <div className="text-sm font-medium">
                        <strong>storage:extended</strong> — {t('plugins.caps.storageExtended', 'Extended storage up to 500MB (Warning)')}
                      </div>
                    </div>
                  );
                } else {
                  items.push(
                    <div key="storage:default" className="flex gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-green-500">
                      <CheckCircle2 className="w-5 h-5 shrink-0" />
                      <div className="text-sm font-medium">
                        <strong>storage</strong> — {t('plugins.caps.storageDefault', 'Storage limited to 5MB (Safe)')}
                      </div>
                    </div>
                  );
                }

                if (caps.includes('ssh:write')) {
                  items.push(
                    <div key="ssh:write" className="flex gap-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-500">
                      <AlertTriangle className="w-5 h-5 shrink-0" />
                      <div className="text-sm font-medium">
                        <strong>ssh:write</strong> — {t('plugins.caps.sshWrite', 'Can inject commands into active SSH sessions (Warning)')}
                      </div>
                    </div>
                  );
                }

                if (caps.includes('ssh:read')) {
                  items.push(
                    <div key="ssh:read" className="flex gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-green-500">
                      <CheckCircle2 className="w-5 h-5 shrink-0" />
                      <div className="text-sm font-medium">
                        <strong>ssh:read</strong> — {t('plugins.caps.sshRead', 'Can read output from active SSH sessions (Safe)')}
                      </div>
                    </div>
                  );
                }
                
                if (caps.includes('lifecycle')) {
                  items.push(
                    <div key="lifecycle" className="flex gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-500">
                      <CheckCircle2 className="w-5 h-5 shrink-0" />
                      <div className="text-sm font-medium">
                        <strong>lifecycle</strong> — {t('plugins.caps.lifecycle', 'Standard plugin lifecycle management')}
                      </div>
                    </div>
                  );
                }

                if (caps.includes('host:clipboard')) {
                  items.push(
                    <div key="host:clipboard" className="flex gap-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-500">
                      <AlertTriangle className="w-5 h-5 shrink-0" />
                      <div className="text-sm font-medium">
                        <strong>host:clipboard</strong> — {t('plugins.caps.hostClipboard', 'Can read and write to your system clipboard (Warning)')}
                      </div>
                    </div>
                  );
                }

                return items.length > 0 ? items : (
                  <div className="text-sm opacity-50 p-2 text-center border border-dashed rounded">
                    {t('plugins.caps.none', 'No special capabilities requested.')}
                  </div>
                );
              })()}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button 
                onClick={cancelInstall}
                className={`px-6 py-2.5 rounded-xl font-bold transition-all active:scale-95 ${isDark ? 'hover:bg-white/10 text-white/70 hover:text-white' : 'hover:bg-black/5 text-slate-500 hover:text-slate-900'}`}
              >
                {t('common.cancel', 'Cancel')}
              </button>
              <button 
                onClick={confirmInstall}
                disabled={loading}
                className="px-6 py-2.5 bg-rose-500 text-white hover:bg-rose-600 rounded-xl font-bold transition-all active:scale-95 shadow-lg shadow-rose-500/20"
              >
                {loading ? t('common.loading', 'Loading...') : t('plugins.confirmInstall', 'Accept & Install')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div 
        onDrop={handleDrop} 
        onDragOver={(e) => e.preventDefault()}
        className={`relative group overflow-hidden rounded-3xl p-16 text-center cursor-pointer transition-all duration-500 border-2 border-dashed ${
          isDark 
            ? 'border-white/10 bg-white/5 hover:border-rose-500/50 hover:bg-white/10 text-rose-300' 
            : 'border-black/10 bg-black/5 hover:border-rose-600/50 hover:bg-black/10 text-rose-600'
        } shadow-[0_8px_30px_rgb(0,0,0,0.12)] backdrop-blur-md shrink-0`}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-rose-500/20 via-purple-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
        <div className="relative z-10 flex flex-col items-center justify-center gap-4">
          <div className={`p-4 rounded-full transition-transform duration-500 group-hover:-translate-y-2 group-hover:scale-110 ${isDark ? 'bg-white/10' : 'bg-black/5'}`}>
            <PackagePlus className="w-10 h-10" />
          </div>
          <div>
            <h3 className="text-xl font-bold mb-1 tracking-wide">{loading && !pendingInstall ? t('plugins.unpacking') : t('plugins.dropzone')}</h3>
            <p className="text-sm font-medium opacity-60">Drag and drop a valid .zip plugin package here</p>
          </div>
        </div>
      </div>
      
      <div className="flex flex-col">
        <h3 className="font-black opacity-80 uppercase tracking-widest text-lg mb-6 flex items-center gap-3">
          <Box className="w-5 h-5 text-rose-500" />
          {t('plugins.installed')}
        </h3>
        {installedPlugins.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-sm font-medium opacity-50 border-2 border-dashed rounded-3xl p-10 border-black/10 dark:border-white/10">
            {t('plugins.noPlugins')}
          </div>
        )}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-6 pb-10 pr-2">
          {installedPlugins.map(p => {
            const displayName = (p as any).getssh?.name || p.displayName || p.name;
            const hasSchema = !!usePluginStore.getState().settingsSchemas[p.name];
            
            return (
              <div key={p.name} className={`group relative flex flex-col p-6 rounded-3xl backdrop-blur-xl transition-all duration-500 hover:-translate-y-2 hover:shadow-[0_20px_40px_rgba(0,0,0,0.2)] border ${isDark ? 'border-white/10 bg-[#1A1A1A]/80 hover:border-rose-500/40' : 'border-black/5 bg-white/80 hover:border-rose-500/40 shadow-sm'}`}>
                {/* Glow Overlay */}
                <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-rose-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                
                <div className="relative z-10 flex items-start justify-between mb-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <div className={`w-10 h-10 shrink-0 flex items-center justify-center rounded-xl font-black text-lg shadow-inner ${isDark ? 'bg-white/10 text-rose-400' : 'bg-rose-100 text-rose-600'}`}>
                      {displayName.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="font-bold text-lg leading-tight tracking-tight break-words">{displayName}</h4>
                      <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold tracking-wider ${isDark ? 'bg-white/10 text-white/70' : 'bg-black/5 text-slate-500'}`}>v{p.version}</span>
                    </div>
                  </div>
                  <button onClick={() => handleUninstall(p.name, displayName)} className={`p-2 shrink-0 rounded-xl transition-all active:scale-95 ${isDark ? 'text-red-400 hover:bg-red-500/20' : 'text-red-500 hover:bg-red-50'}`} title={t('plugins.uninstall')}>
                    <Trash className="w-4 h-4" />
                  </button>
                </div>
                
                <p className="relative z-10 text-sm opacity-70 mb-4 line-clamp-2 leading-relaxed flex-1">
                  {p.description || "No description provided."}
                </p>
                
                {hasSchema && (
                  <div className="relative z-10 mt-auto pt-4 border-t border-black/5 dark:border-white/10">
                    <PluginConfigPanel pluginId={p.name} isDark={isDark} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// Inline subcomponent for config panel
const PluginConfigPanel = ({ pluginId, isDark }: { pluginId: string, isDark: boolean }) => {
  const schema = usePluginStore(state => state.settingsSchemas[pluginId]);
  const [isOpen, setIsOpen] = useState(false);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const loadData = async () => {
        const data: Record<string, any> = {};
        await Promise.all(
          schema.map(async (field) => {
            const val = await window.electronAPI.pluginStorageGet(pluginId, field.id);
            data[field.id] = val !== null && val !== undefined ? val : field.default;
          })
        );
        setFormData(data);
      };
      loadData();
    }
  }, [isOpen, pluginId, schema]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all(
        Object.entries(formData).map(([key, value]) =>
          window.electronAPI.pluginStorageSet(pluginId, key, value)
        )
      );
      await window.electronAPI.reloadPlugin(pluginId);
      alert('Settings saved. Plugin hot-reloaded successfully!');
    } catch (err: any) {
      alert(`Failed to save settings: ${err.message}`);
    }
    setSaving(false);
  };

  if (!schema || schema.length === 0) return null;

  return (
    <div className="w-full">
      <button 
        onClick={() => setIsOpen(!isOpen)} 
        className={`w-full py-2 flex items-center justify-center gap-2 text-xs font-bold rounded-xl transition-all ${isDark ? 'bg-white/5 hover:bg-white/10 text-white/70' : 'bg-black/5 hover:bg-black/10 text-slate-700'}`}
      >
        <Settings2 className="w-3.5 h-3.5" />
        {isOpen ? 'Hide Configuration' : 'Configure Plugin'}
      </button>

      {isOpen && (
        <div className={`mt-4 space-y-4 p-4 rounded-xl border ${isDark ? 'bg-black/20 border-white/5' : 'bg-slate-50 border-black/5'}`}>
          {schema.map(field => (
            <div key={field.id} className="flex flex-col gap-1">
              <label className="text-sm font-semibold opacity-80">{field.label}</label>
              {field.description && <span className="text-xs opacity-50">{field.description}</span>}
              
              {field.type === 'boolean' ? (
                <input 
                  type="checkbox" 
                  checked={!!formData[field.id]}
                  onChange={e => setFormData({ ...formData, [field.id]: e.target.checked })}
                  className="mt-1 w-4 h-4 rounded text-primary focus:ring-primary/50"
                />
              ) : (
                <div className="relative group">
                  <input 
                    type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'}
                    value={formData[field.id] || ''}
                    onChange={e => setFormData({ ...formData, [field.id]: field.type === 'number' ? parseFloat(e.target.value) : e.target.value })}
                    className={`mt-1 w-full px-4 py-2.5 rounded-xl border border-transparent text-sm outline-none transition-all ${
                      isDark 
                        ? 'bg-black/20 text-white focus:bg-black/40 placeholder:text-white/20' 
                        : 'bg-black/5 text-slate-900 focus:bg-black/10 placeholder:text-black/30'
                    }`}
                  />
                  {/* Neon Indicator */}
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-0 h-[2px] bg-primary rounded-full transition-all duration-300 group-focus-within:w-[calc(100%-24px)] shadow-[0_0_8px_rgba(0,180,216,0.8)] pointer-events-none" />
                </div>
              )}
            </div>
          ))}
          <button 
            onClick={handleSave}
            disabled={saving}
            className="mt-4 px-5 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-xl hover:bg-primary/90 transition-all active:scale-95 shadow-lg shadow-primary/20"
          >
            {saving ? 'Saving...' : 'Save & Restart Plugin'}
          </button>
        </div>
      )}
    </div>
  );
};
