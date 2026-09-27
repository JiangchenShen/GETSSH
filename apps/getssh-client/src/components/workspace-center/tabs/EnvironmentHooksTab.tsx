import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2 } from 'lucide-react';
import { useWorkspaceStore } from '../../../store/workspaceStore';

const emptyHooks = { onConnect: '', onDisconnect: '', defaultPath: '~' };

export const EnvironmentHooksTab: React.FC = () => {
  const { t } = useTranslation();
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const activeWorkspace = useWorkspaceStore(state => state.workspaces.find(workspace => workspace.id === state.activeWorkspaceId));
  const [hooks, setHooks] = useState(emptyHooks);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHooks({ ...emptyHooks, ...activeWorkspace?.preferences?.envHooks });
    setError(null);
  }, [activeWorkspaceId, activeWorkspace?.preferences?.envHooks]);

  useEffect(() => setSaved(false), [activeWorkspaceId]);

  const handleSave = async () => {
    if (!activeWorkspaceId || !window.electronAPI?.updateWorkspacePreferences) return;
    setSaving(true);
    setError(null);
    try {
      const result = await window.electronAPI.updateWorkspacePreferences(activeWorkspaceId, JSON.stringify({
        ...(activeWorkspace?.preferences || {}),
        envHooks: hooks
      }));
      if (!result.success) throw new Error(result.error || 'Could not save workspace hooks.');
      await useWorkspaceStore.getState().initWorkspaces();
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <p className="mb-5 text-sm leading-6 text-ink-2">
        {t('workspaceCenter.envHooksDesc', 'Configure automatic actions for terminal sessions in this workspace.')}
      </p>
      {error && <p role="alert" className="mb-4 rounded-md border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{error}</p>}
      <div className="border-y border-line">
        <div className="grid gap-3 border-b border-line-soft py-5 sm:grid-cols-[180px_minmax(0,1fr)]">
          <label htmlFor="workspace-default-path" className="pt-2 text-sm font-medium">
            {t('workspaceCenter.defaultInitialPath', 'Default Initial Path')}
          </label>
          <input id="workspace-default-path" type="text" value={hooks.defaultPath}
            onChange={event => { setHooks(previous => ({ ...previous, defaultPath: event.target.value })); setSaved(false); }}
            placeholder="~"
            className="min-h-9 w-full rounded-md border border-line bg-surf px-3 font-mono text-sm text-ink outline-none focus:border-[var(--center-accent)]" />
        </div>
        <div className="grid gap-3 py-5 sm:grid-cols-[180px_minmax(0,1fr)]">
          <div>
            <label htmlFor="workspace-connect-script" className="text-sm font-medium">
              {t('workspaceCenter.postConnectScript', 'Post-Connect Script')}
            </label>
            <p className="mt-1 text-xs leading-5 text-ink-3">
              {t('workspaceCenter.postConnectScriptDesc', 'Runs after SSH authentication.')}
            </p>
          </div>
          <textarea id="workspace-connect-script" value={hooks.onConnect} rows={5}
            onChange={event => { setHooks(previous => ({ ...previous, onConnect: event.target.value })); setSaved(false); }}
            placeholder="source ~/.profile"
            className="w-full resize-y rounded-md border border-line bg-surf px-3 py-2 font-mono text-sm text-ink outline-none focus:border-[var(--center-accent)]" />
        </div>
      </div>
      <div className="mt-5 flex items-center justify-end gap-3">
        {saved && <span className="inline-flex items-center gap-1.5 text-xs text-ok"><CheckCircle2 className="h-4 w-4" />{t('workspaceCenter.saved', 'Saved')}</span>}
        <button type="button" onClick={handleSave} disabled={saving}
          className="min-h-9 rounded-md bg-[var(--center-accent)] px-4 text-sm font-medium text-[var(--center-accent-ink)] hover:opacity-90 disabled:opacity-50">
          {saving ? t('common.loading', 'Saving…') : t('workspaceCenter.saveHooks', 'Save hooks')}
        </button>
      </div>
    </div>
  );
};
