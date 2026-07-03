import React, { useEffect, useState } from 'react';
import { usePluginStore } from '../store/pluginStore';
import { Trash, ShieldAlert, CheckCircle2, AlertTriangle } from 'lucide-react';
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
    <div className="space-y-8 max-w-xl">
      {pendingInstall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className={`w-full max-w-lg rounded-2xl p-6 shadow-2xl border ${isDark ? 'bg-zinc-900 border-white/10' : 'bg-white border-black/10'}`}>
            <div className="flex items-center gap-3 mb-4 text-primary">
              <ShieldAlert className="w-8 h-8" />
              <h2 className="text-xl font-bold">{t('plugins.permissionReview', 'Plugin Permission Review')}</h2>
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

            <div className="flex justify-end gap-3">
              <button 
                onClick={cancelInstall}
                className={`px-6 py-2 rounded-lg font-medium transition-colors ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
              >
                {t('common.cancel', 'Cancel')}
              </button>
              <button 
                onClick={confirmInstall}
                disabled={loading}
                className="px-6 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg font-medium transition-colors shadow-lg shadow-primary/20"
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
        className={`border-2 border-dashed rounded-[20px] p-12 text-center cursor-pointer transition-all font-medium ${isDark ? 'border-primary-600/50 bg-primary-900/10 hover:bg-primary-900/30 text-primary-400' : 'border-primary-300 bg-primary-50/50 hover:bg-primary-100/50 text-primary-600'}`}
      >
        {loading && !pendingInstall ? t('plugins.unpacking') : t('plugins.dropzone')}
      </div>
      
      <div className="space-y-4">
        <h3 className="font-semibold opacity-70 uppercase tracking-widest text-sm mb-4">{t('plugins.installed')}</h3>
        {installedPlugins.length === 0 && (
          <div className="text-sm opacity-50">{t('plugins.noPlugins')}</div>
        )}
        {installedPlugins.map(p => {
          const displayName = (p as any).getssh?.name || p.displayName || p.name;
          const hasSchema = !!usePluginStore.getState().settingsSchemas[p.name];
          
          return (
            <div key={p.name} className={`flex flex-col p-4 border rounded-xl shadow-sm ${isDark ? 'border-white/10 bg-black/20' : 'border-black/5 bg-white/50'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h4 className="font-bold cursor-default">{displayName} <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-mono opacity-70 ${isDark ? 'bg-white/10' : 'bg-black/5'}`}>v{p.version}</span></h4>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleUninstall(p.name, displayName)} className="text-red-500/50 hover:text-red-500 hover:bg-red-500/10 p-1.5 rounded-md transition-all" title={t('plugins.uninstall')}>
                    <Trash className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <p className="text-sm opacity-60 mt-1">{p.description}</p>
              
              {hasSchema && <PluginConfigPanel pluginId={p.name} isDark={isDark} />}
            </div>
          );
        })}
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
    <div className="mt-4 pt-4 border-t border-black/5 dark:border-white/5">
      <button 
        onClick={() => setIsOpen(!isOpen)} 
        className="text-sm font-medium text-primary hover:opacity-80 transition-opacity flex items-center gap-2"
      >
        {isOpen ? '▼ Hide Configuration' : '▶ Configure Plugin'}
      </button>

      {isOpen && (
        <div className="mt-4 space-y-4 pl-2 border-l-2 border-primary/20">
          {schema.map(field => (
            <div key={field.id} className="flex flex-col gap-1">
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
                  className={`mt-1 px-3 py-1.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all ${isDark ? 'bg-black/20 border-white/10' : 'bg-white border-black/10'}`}
                />
              ) : field.type === 'number' ? (
                <input 
                  type="number"
                  value={formData[field.id] || ''}
                  onChange={e => setFormData({ ...formData, [field.id]: parseFloat(e.target.value) })}
                  className={`mt-1 px-3 py-1.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all ${isDark ? 'bg-black/20 border-white/10' : 'bg-white border-black/10'}`}
                />
              ) : (
                <input 
                  type="text"
                  value={formData[field.id] || ''}
                  onChange={e => setFormData({ ...formData, [field.id]: e.target.value })}
                  className={`mt-1 px-3 py-1.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all ${isDark ? 'bg-black/20 border-white/10' : 'bg-white border-black/10'}`}
                />
              )}
            </div>
          ))}
          <button 
            onClick={handleSave}
            disabled={saving}
            className="mt-2 px-4 py-1.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors shadow-sm"
          >
            {saving ? 'Saving...' : 'Save & Restart Plugin'}
          </button>
        </div>
      )}
    </div>
  );
};
