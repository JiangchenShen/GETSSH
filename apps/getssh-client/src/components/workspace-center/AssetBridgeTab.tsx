import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2 } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useSessionStore } from '../../store/sessionStore';

export const AssetBridgeTab: React.FC = () => {
  const { t } = useTranslation();
  const workspaces = useWorkspaceStore(state => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const [sourceWorkspaceId, setSourceWorkspaceId] = useState('');
  const [profiles, setProfiles] = useState<any[]>([]);
  const [runbooks, setRunbooks] = useState<any[]>([]);
  const [selectedProfiles, setSelectedProfiles] = useState<Set<string>>(new Set());
  const [selectedRunbooks, setSelectedRunbooks] = useState<Set<string>>(new Set());
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importSuccess, setImportSuccess] = useState(false);
  const [error, setError] = useState('');
  const otherWorkspaces = workspaces.filter(workspace => workspace.id !== activeWorkspaceId);

  useEffect(() => {
    if (sourceWorkspaceId === activeWorkspaceId) setSourceWorkspaceId('');
    setSelectedProfiles(new Set());
    setSelectedRunbooks(new Set());
    setImportSuccess(false);
  }, [activeWorkspaceId]);

  useEffect(() => {
    setProfiles([]);
    setRunbooks([]);
    setSelectedProfiles(new Set());
    setSelectedRunbooks(new Set());
    setImportSuccess(false);
    if (!sourceWorkspaceId) return;
    let mounted = true;
    setLoadingAssets(true);
    setError('');
    window.electronAPI.bridgeFetchProfiles(sourceWorkspaceId)
      .then(result => {
        if (!mounted) return;
        if (!result.success) throw new Error(result.error || 'Failed to load assets.');
        setProfiles(result.profiles || []);
        setRunbooks(result.runbooks || []);
      })
      .catch(cause => { if (mounted) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (mounted) setLoadingAssets(false); });
    return () => { mounted = false; };
  }, [sourceWorkspaceId]);

  const toggle = (id: string, selected: Set<string>, setSelected: (value: Set<string>) => void) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const handleImport = async () => {
    if (selectedProfiles.size === 0 && selectedRunbooks.size === 0) return;
    setImporting(true);
    setError('');
    setImportSuccess(false);
    const targetWorkspaceId = activeWorkspaceId;
    const canRefresh = () => {
      const workspace = useWorkspaceStore.getState();
      return workspace.activeWorkspaceId === targetWorkspaceId && !workspace.isSwitching && !workspace.isVaultLocked;
    };
    try {
      const result = await window.electronAPI.bridgeImportProfiles(
        targetWorkspaceId,
        profiles.filter(profile => selectedProfiles.has(profile.id)),
        runbooks.filter(runbook => selectedRunbooks.has(runbook.id))
      );
      if (!result.success) throw new Error(result.error || 'Failed to import assets.');
      await useWorkspaceStore.getState().initWorkspaces();
      if (!canRefresh()) return;
      // unlockProfiles returns normalized connection configs; the bridge reads raw SQL rows.
      const [currentProfiles, currentAssets] = await Promise.all([
        window.electronAPI.unlockProfiles(''),
        window.electronAPI.bridgeFetchProfiles(targetWorkspaceId),
      ]);
      if (!canRefresh()) return;
      if (!currentAssets.success) throw new Error(currentAssets.error || 'Failed to load assets.');
      const sessions = useSessionStore.getState();
      const selected = sessions.sessions[sessions.selectedSessionIndex ?? -1];
      const updated = [...currentProfiles, ...sessions.sessions.filter(profile => profile.isDraft || profile.isQuickConnect)];
      const selectedIndex = selected ? updated.findIndex(profile => profile === selected || (profile.id && profile.id === selected.id)) : -1;
      sessions.setSessions(updated);
      sessions.setSelectedSessionIndex(selectedIndex >= 0 ? selectedIndex : null);
      useWorkspaceStore.setState({ runbooks: (currentAssets.runbooks || []).map(runbook => ({
        ...runbook,
        name: runbook.name ?? runbook.title,
        command: runbook.command ?? runbook.script,
        dangerLevel: String(runbook.dangerLevel ?? runbook.riskLevel).toLowerCase() === 'low' ? 'low' : 'high',
        requireMfa: runbook.requireMfa ?? Boolean(runbook.requiresApproval || runbook.forceMFAVerification),
      })) });
      setImportSuccess(true);
      setSelectedProfiles(new Set());
      setSelectedRunbooks(new Set());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="w-full min-w-0 max-w-3xl">
      <p className="mb-5 text-sm leading-6 text-ink-2">
        {t('workspaceCenter.assetBridgeDesc', 'Import connection profiles and runbooks from another workspace.')}
      </p>
      {error && <p role="alert" className="mb-4 rounded-md border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{error}</p>}
      {importSuccess && <p role="status" className="mb-4 rounded-md border border-ok/30 bg-ok/10 px-3 py-2 text-sm text-ok">{t('workspaceCenter.importSuccess', 'Assets imported.')}</p>}

      <div className="border-y border-line py-5">
        <label htmlFor="bridge-source-workspace" className="mb-2 block text-sm font-medium">
          {t('workspaceCenter.selectSourceWorkspace', 'Source Workspace')}
        </label>
        <select id="bridge-source-workspace" value={sourceWorkspaceId} onChange={event => setSourceWorkspaceId(event.target.value)}
          className="min-h-10 w-full min-w-0 max-w-sm rounded-md border border-line bg-surf px-3 text-sm text-ink outline-none focus:border-[var(--center-accent)]">
          <option value="">{t('workspaceCenter.chooseWorkspace', 'Choose a workspace')}</option>
          {otherWorkspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name || workspace.id}</option>)}
        </select>
        {otherWorkspaces.length === 0 && <p className="mt-2 text-xs text-ink-3">{t('workspaceCenter.noOtherWorkspaces', 'Create another workspace to transfer assets.')}</p>}
      </div>

      {sourceWorkspaceId && (
        <div className="py-5">
          {loadingAssets ? (
            <p role="status" className="flex items-center gap-2 text-sm text-ink-2"><Loader2 className="h-4 w-4 animate-spin" />{t('workspaceCenter.loadingAssets', 'Loading assets…')}</p>
          ) : (
            <div className="center-columns grid gap-6 md:grid-cols-2">
              <section className="min-w-0">
                <h3 className="mb-2 text-sm font-medium">{t('workspaceCenter.serverProfiles', 'Server Profiles')} <span className="text-ink-3">({profiles.length})</span></h3>
                {profiles.length === 0 ? (
                  <p className="py-3 text-sm text-ink-3">{t('workspaceCenter.noProfilesFound', 'No profiles found.')}</p>
                ) : (
                  <div className="divide-y divide-line-soft border-y border-line">
                    {profiles.map(profile => (
                      <button key={profile.id} type="button" aria-pressed={selectedProfiles.has(profile.id)}
                        onClick={() => toggle(profile.id, selectedProfiles, setSelectedProfiles)}
                        className="flex min-h-14 w-full items-center gap-3 px-2 py-2 text-left hover:bg-surf focus-visible:outline-2 focus-visible:outline-[var(--center-accent)]">
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selectedProfiles.has(profile.id) ? 'border-[var(--center-accent)] bg-[var(--center-accent)] text-white' : 'border-line'}`}>
                          {selectedProfiles.has(profile.id) && <Check className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{profile.alias || profile.host}</span><span className="block truncate font-mono text-xs text-ink-3">{profile.username}@{profile.host}</span></span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
              <section className="min-w-0">
                <h3 className="mb-2 text-sm font-medium">{t('workspaceCenter.runbooksTitle', 'Runbooks')} <span className="text-ink-3">({runbooks.length})</span></h3>
                {runbooks.length === 0 ? (
                  <p className="py-3 text-sm text-ink-3">{t('workspaceCenter.noRunbooksFound', 'No runbooks found.')}</p>
                ) : (
                  <div className="divide-y divide-line-soft border-y border-line">
                    {runbooks.map(runbook => (
                      <button key={runbook.id} type="button" aria-pressed={selectedRunbooks.has(runbook.id)}
                        onClick={() => toggle(runbook.id, selectedRunbooks, setSelectedRunbooks)}
                        className="flex min-h-14 w-full items-center gap-3 px-2 py-2 text-left hover:bg-surf focus-visible:outline-2 focus-visible:outline-[var(--center-accent)]">
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selectedRunbooks.has(runbook.id) ? 'border-[var(--center-accent)] bg-[var(--center-accent)] text-white' : 'border-line'}`}>
                          {selectedRunbooks.has(runbook.id) && <Check className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{runbook.title || runbook.name}</span><span className="block text-xs text-ink-3">{runbook.riskLevel || 'LOW'}</span></span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end border-t border-line py-5">
        <button type="button" onClick={handleImport} disabled={importing || selectedProfiles.size + selectedRunbooks.size === 0}
          className="min-h-9 rounded-md bg-[var(--center-accent)] px-4 text-sm font-medium text-[var(--center-accent-ink)] hover:opacity-90 disabled:opacity-50">
          {importing ? t('common.loading', 'Importing…') : t('workspaceCenter.importSelected', 'Import selected')} ({selectedProfiles.size + selectedRunbooks.size})
        </button>
      </div>
    </div>
  );
};
