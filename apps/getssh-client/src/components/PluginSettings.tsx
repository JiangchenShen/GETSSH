import React, { useEffect, useRef, useState } from 'react';
import { Download, PackagePlus, Settings2, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePluginStore } from '../store/pluginStore';

type PendingInstall = { manifest: any; tempDir: string; sourceDir: string };
const buttonClass = 'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-line bg-panel px-3 text-sm text-ink-2 transition-colors hover:bg-surf-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50';

export const PluginSettings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const { installedPlugins, setPlugins } = usePluginStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pendingInstall, setPendingInstall] = useState<PendingInstall | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => { void window.electronAPI.getPluginsList().then(list => setPlugins(list || [])).catch(reason => setError(String(reason))); }, [setPlugins]);

  const previewFile = async (file?: File) => {
    if (!file || loading) return;
    const realPath = window.electronAPI.getPathForFile?.(file) || (file as File & { path?: string }).path;
    if (!realPath || !realPath.toLowerCase().endsWith('.zip')) { setError(zh ? '请选择本地 ZIP 插件包' : 'Choose a local ZIP plugin package'); return; }
    setLoading(true); setError('');
    try {
      if (pendingInstall) await window.electronAPI.abortPluginInstall(pendingInstall.tempDir);
      setPendingInstall(null);
      const result = await window.electronAPI.previewPlugin(realPath);
      if (!result.success || !result.manifest || !result.tempDir || !result.sourceDir) throw new Error(result.error || 'Plugin preview failed');
      setPendingInstall({ manifest: result.manifest, tempDir: result.tempDir, sourceDir: result.sourceDir });
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); if (fileInput.current) fileInput.current.value = ''; }
  };

  const cancelInstall = async () => {
    if (!pendingInstall) return;
    await window.electronAPI.abortPluginInstall(pendingInstall.tempDir);
    setPendingInstall(null);
  };

  const confirmInstall = async () => {
    if (!pendingInstall || loading) return;
    setLoading(true); setError('');
    try {
      const result = await window.electronAPI.commitPluginInstall(pendingInstall);
      if (!result.success) throw new Error(result.error || 'Plugin install failed');
      setPlugins(await window.electronAPI.getPluginsList() || []);
      setPendingInstall(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };

  const uninstall = async (name: string, displayName: string) => {
    if (!window.confirm(t('plugins.uninstallConfirm', { name: displayName }))) return;
    setLoading(true); setError('');
    try {
      const result = await window.electronAPI.uninstallPlugin(name);
      if (!result.success) throw new Error(result.error || 'Uninstall failed');
      setPlugins(await window.electronAPI.getPluginsList() || []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };

  const capabilities: string[] = pendingInstall?.manifest?.getssh?.capabilities || [];
  const riskText: Record<string, string> = {
    'storage:unlimited': zh ? '无限制本地存储' : 'Unlimited local storage',
    'storage:extended': zh ? '扩展本地存储' : 'Extended local storage',
    'ssh:write': zh ? '可以向 SSH 会话写入命令' : 'Can write commands to SSH sessions',
    'ssh:read': zh ? '可以读取 SSH 会话输出' : 'Can read SSH session output',
    'host:clipboard': zh ? '可以读写系统剪贴板' : 'Can read and write the system clipboard',
    lifecycle: zh ? '标准生命周期管理' : 'Standard lifecycle management',
  };

  return <div className="space-y-7">
    <section className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-5">
      <div><h2 className="text-sm font-semibold">{t('plugins.installed')}</h2><p className="mt-1 text-xs text-ink-3">{installedPlugins.length} {zh ? '个已安装插件' : 'installed plugins'}</p></div>
      <button type="button" onClick={() => fileInput.current?.click()} disabled={loading} className={buttonClass}><PackagePlus size={15} />{zh ? '安装本地 ZIP' : 'Install local ZIP'}</button>
      <input ref={fileInput} type="file" accept=".zip,application/zip" onChange={event => void previewFile(event.target.files?.[0])} className="sr-only" aria-label={zh ? '选择本地插件包' : 'Choose local plugin package'} />
    </section>

    {error && <p role="alert" className="border-l-2 border-down bg-down/10 px-3 py-2 text-sm text-down">{error}</p>}

    <div onDrop={event => { event.preventDefault(); void previewFile(event.dataTransfer.files[0]); }} onDragOver={event => event.preventDefault()} className="rounded-md border border-dashed border-line px-4 py-5 text-center text-xs text-ink-3"><Download size={16} className="mx-auto mb-2" />{zh ? '也可以把 ZIP 插件包拖到这里' : 'Or drop a ZIP plugin package here'}</div>

    <section className="border-y border-line">
      {installedPlugins.length === 0 && <p className="py-10 text-center text-sm text-ink-3">{t('plugins.noPlugins')}</p>}
      {installedPlugins.map(plugin => {
        const name = (plugin as any).getssh?.name || plugin.displayName || plugin.name;
        return <div key={plugin.name} className="border-b border-line-soft px-1 py-4 last:border-b-0">
          <div className="flex items-start gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surf-2 text-sm font-medium text-ink-2">{name.charAt(0).toUpperCase()}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline gap-2"><h3 className="text-sm font-medium text-ink">{name}</h3><span className="font-mono text-xs text-ink-3">v{plugin.version}</span></div><p className="mt-1 text-xs leading-relaxed text-ink-3">{plugin.description || (zh ? '暂无说明' : 'No description')}</p></div><button type="button" onClick={() => void uninstall(plugin.name, name)} disabled={loading} title={t('plugins.uninstall')} aria-label={`${t('plugins.uninstall')}: ${name}`} className="rounded-md p-2 text-ink-3 hover:bg-down/10 hover:text-down disabled:opacity-40"><Trash2 size={15} /></button></div>
          <PluginConfigPanel pluginId={plugin.name} />
        </div>;
      })}
    </section>

    {pendingInstall && <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) void cancelInstall(); }}><div role="dialog" aria-modal="true" aria-label={t('plugins.permissionReview', 'Permission review')} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-panel p-6 text-ink shadow-2xl"><div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{t('plugins.permissionReview', 'Permission review')}</h2><p className="mt-1 text-sm text-ink-2">{pendingInstall.manifest.getssh?.name || pendingInstall.manifest.displayName || pendingInstall.manifest.name} · v{pendingInstall.manifest.version}</p></div><button type="button" onClick={() => void cancelInstall()} aria-label={zh ? '取消安装' : 'Cancel installation'} className="rounded-md p-1.5 text-ink-3 hover:bg-surf-2"><X size={17} /></button></div><p className="mt-4 text-xs leading-relaxed text-ink-2">{zh ? '请检查该插件请求的能力。安装后是否实际运行，还取决于设置中的插件权限模式。' : 'Review requested capabilities. Whether backend code runs also depends on the plugin permission mode in Settings.'}</p><div className="mt-4 border-y border-line">{capabilities.length ? capabilities.map(capability => <div key={capability} className="border-b border-line-soft py-2.5 last:border-b-0"><code className="font-mono text-xs text-ink">{capability}</code><p className="mt-1 text-xs text-ink-3">{riskText[capability] || (zh ? '未识别的能力，请确认来源。' : 'Unrecognized capability; verify the source.')}</p></div>) : <p className="py-3 text-xs text-ink-3">{t('plugins.caps.none', 'No special capabilities requested.')}</p>}</div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => void cancelInstall()} className={buttonClass}>{t('common.cancel')}</button><button type="button" onClick={() => void confirmInstall()} disabled={loading} className="min-h-9 rounded-md bg-primary px-3 text-sm font-medium text-bg hover:opacity-90 disabled:opacity-50">{loading ? t('common.loading') : t('plugins.confirmInstall', 'Accept & install')}</button></div></div></div>}
  </div>;
};

const PluginConfigPanel: React.FC<{ pluginId: string }> = ({ pluginId }) => {
  const { t, i18n } = useTranslation();
  const schema = usePluginStore(state => state.settingsSchemas[pluginId]);
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open || !schema?.length) return;
    void Promise.all(schema.map(async field => [field.id, await window.electronAPI.pluginStorageGet(pluginId, field.id)] as const))
      .then(entries => setFormData(Object.fromEntries(entries.map(([id, value]) => [id, value ?? schema.find(field => field.id === id)?.default]))))
      .catch(reason => setError(String(reason)));
  }, [open, pluginId, schema]);
  if (!schema?.length) return null;
  const save = async () => {
    setSaving(true); setError('');
    try {
      await Promise.all(Object.entries(formData).map(([key, value]) => window.electronAPI.pluginStorageSet(pluginId, key, value)));
      await window.electronAPI.reloadPlugin(pluginId);
      setOpen(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };
  return <div className="ml-11 mt-3"><button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-1.5 text-xs text-ink-2 hover:text-primary"><Settings2 size={13} />{i18n.language.startsWith('zh') ? '配置插件' : 'Configure plugin'}</button>{open && <div className="mt-3 max-w-xl space-y-3 border-t border-line-soft pt-3">{schema.map(field => <label key={field.id} className="block text-xs text-ink-2"><span className="font-medium">{field.label}</span>{field.description && <span className="mt-0.5 block text-ink-3">{field.description}</span>}{field.type === 'boolean' ? <input type="checkbox" checked={!!formData[field.id]} onChange={event => setFormData({ ...formData, [field.id]: event.target.checked })} className="mt-2 block h-4 w-4 accent-primary" /> : <input type={field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'} value={formData[field.id] ?? ''} onChange={event => setFormData({ ...formData, [field.id]: field.type === 'number' ? Number(event.target.value) : event.target.value })} className="mt-1.5 block min-h-9 w-full rounded-md border border-line bg-panel px-3 text-sm text-ink outline-none focus:border-primary" />}</label>)}{error && <p role="alert" className="text-xs text-down">{error}</p>}<button type="button" onClick={() => void save()} disabled={saving} className={buttonClass}>{saving ? t('common.loading') : (i18n.language.startsWith('zh') ? '保存并重新加载插件' : 'Save & reload plugin')}</button></div>}</div>;
};
