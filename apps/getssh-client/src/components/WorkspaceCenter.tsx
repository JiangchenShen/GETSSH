import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, Database, FileJson, Layers, Loader2, Plus, Shield, Star, TerminalSquare, Trash2 } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { ExportTab } from './secure-center/tabs/ExportTab';
import { IsolationRulesTab } from './secure-center/tabs/IsolationRulesTab';
import { AssetBridgeTab } from './workspace-center/AssetBridgeTab';
import { EnvironmentHooksTab } from './workspace-center/tabs/EnvironmentHooksTab';
import { StorageAuditTab } from './workspace-center/tabs/StorageAuditTab';

export type WorkspacePage = 'all' | 'isolation' | 'assetBridge' | 'envHooks' | 'storageAudit' | 'export';
export const WORKSPACE_PAGES: readonly WorkspacePage[] = ['all', 'isolation', 'assetBridge', 'envHooks', 'storageAudit', 'export'];

export const WorkspaceCenter: React.FC<{ initialPage?: WorkspacePage }> = ({ initialPage = 'all' }) => {
  const { t } = useTranslation();
  const [page, setPage] = useState<WorkspacePage>(initialPage);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const enableGlassmorphism = useAppStore(state => state.appConfig.enableGlassmorphism);
  const workspaces = useWorkspaceStore(state => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const switchWorkspace = useWorkspaceStore(state => state.switchWorkspace);
  const setIsCreateModalOpen = useWorkspaceStore(state => state.setIsCreateModalOpen);

  useEffect(() => setPage(initialPage), [initialPage]);
  useEffect(() => {
    const selectPage = (event: Event) => {
      const requested = (event as CustomEvent<WorkspacePage>).detail;
      if (WORKSPACE_PAGES.includes(requested)) setPage(requested);
    };
    window.addEventListener('app:workspace-page', selectPage);
    return () => window.removeEventListener('app:workspace-page', selectPage);
  }, []);

  const nav = [
    { id: 'all', label: t('workspaceCenter.sidebar.allWorkspaces', 'All Workspaces'), icon: Layers },
    { id: 'isolation', label: t('workspaceCenter.sidebar.isolation', 'Isolation Rules'), icon: Shield },
    { id: 'assetBridge', label: t('workspaceCenter.sidebar.assetBridge', 'Asset Bridge'), icon: ArrowLeftRight },
    { id: 'envHooks', label: t('workspaceCenter.sidebar.envHooks', 'Environment Hooks'), icon: TerminalSquare },
    { id: 'storageAudit', label: t('workspaceCenter.sidebar.storageAudit', 'Storage & Audit'), icon: Database },
    { id: 'export', label: t('security.exportTitle', 'Import & Export'), icon: FileJson },
  ] as const;
  const activeNav = nav.find(item => item.id === page)!;
  const activeWorkspaceName = workspaces.find(workspace => workspace.id === activeWorkspaceId)?.name || activeWorkspaceId;

  const handleSwitch = async (id: string) => {
    if (id === activeWorkspaceId || busyId) return;
    setBusyId(id);
    setError(null);
    const success = await switchWorkspace(id);
    if (!success) setError(t('workspaceCenter.switchFailed', 'Could not switch workspaces. Please try again.'));
    setBusyId(null);
  };

  const handleSetMain = async (id: string, name: string) => {
    if (!window.confirm(t('workspaceCenter.setMainConfirm', { name }))) return;
    setBusyId(id);
    setError(null);
    if (!await useWorkspaceStore.getState().setMainWorkspace(id)) {
      setError(t('workspaceCenter.setMainFailed', 'Could not change the main workspace.'));
    }
    setBusyId(null);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(t('workspaceCenter.deleteConfirm', { name }))) return;
    setBusyId(id);
    setError(null);
    if (!await useWorkspaceStore.getState().deleteWorkspace(id)) {
      setError(t('workspaceCenter.deleteFailed', 'Could not delete the workspace.'));
    }
    setBusyId(null);
  };

  return (
    <div className="center-workbench flex h-full min-w-0 overflow-hidden bg-bg text-ink" data-glass={enableGlassmorphism}>
      <aside className="center-side-nav flex w-56 shrink-0 flex-col border-r border-line bg-panel/85 backdrop-blur-xl max-[820px]:w-48">
        <div className="border-b border-line px-5 py-5">
          <h2 className="text-base font-semibold">{t('workspaceCenter.title', 'Workspaces')}</h2>
          <p className="mt-1 truncate text-xs text-ink-3" title={activeWorkspaceName}>{activeWorkspaceName}</p>
        </div>
        <nav aria-label={t('workspaceCenter.title', 'Workspaces')} className="flex-1 overflow-y-auto px-2 py-3">
          {nav.map(({ id, label, icon: Icon }, index) => (
            <React.Fragment key={id}>
              {(index === 0 || index === 1) && (
                <p className={`px-3 pb-1 text-[11px] text-ink-3 ${index === 1 ? 'pt-5' : ''}`}>
                  {index === 0 ? t('workspaceCenter.sidebar.overview', 'Overview') : `${t('workspaceCenter.current', 'Current')} · ${activeWorkspaceName}`}
                </p>
              )}
              <button type="button" onClick={() => setPage(id)} aria-current={page === id ? 'page' : undefined}
                className={`flex min-h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--center-accent)] ${page === id ? 'bg-surf-2 font-medium text-[var(--center-accent)]' : 'text-ink-2 hover:bg-surf hover:text-ink'}`}>
                <Icon className="h-4 w-4 shrink-0" /> <span className="truncate">{label}</span>
              </button>
            </React.Fragment>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-7 py-7 max-[820px]:px-5">
          <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
            <div>
              <h1 className="text-[22px] font-semibold tracking-tight">{activeNav.label}</h1>
              <p className="mt-1 text-sm text-ink-2">
                {page === 'all' ? t('workspaceCenter.subtitle', 'Manage your separate workspaces.') : `${t('workspaceCenter.current', 'Current')}: ${activeWorkspaceName}`}
              </p>
            </div>
            {page === 'all' && (
              <button type="button" onClick={() => setIsCreateModalOpen(true)}
                className="inline-flex min-h-9 items-center gap-2 rounded-md bg-[var(--center-accent)] px-3.5 text-sm font-medium text-[var(--center-accent-ink)] transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--center-accent)]">
                <Plus className="h-4 w-4" />{t('workspaceCenter.create', 'New workspace')}
              </button>
            )}
          </header>

          {error && <p role="alert" className="mb-5 rounded-md border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{error}</p>}

          {page === 'all' && (
            <div className="overflow-hidden rounded-lg border border-line bg-panel">
              {workspaces.length === 0 && <p className="px-5 py-8 text-sm text-ink-2">{t('workspaceCenter.noWorkspaces', 'No workspaces yet.')}</p>}
              {workspaces.map(workspace => {
                const isActive = workspace.id === activeWorkspaceId;
                const isMain = workspace.isMain || workspace.id === 'default';
                const name = workspace.id === 'default' ? t('sidebar.defaultWorkspace') : workspace.name || workspace.id;
                return (
                  <div key={workspace.id} className="flex min-h-17 items-center gap-3 border-b border-line-soft px-4 py-3 last:border-0">
                    <span className="h-8 w-1 shrink-0 rounded-full" style={{ backgroundColor: workspace.themeColor || 'var(--center-accent)' }} aria-hidden="true" />
                    <button type="button" onClick={() => handleSwitch(workspace.id)} disabled={!!busyId || isActive}
                      className="min-w-0 flex-1 rounded-md px-2 py-1 text-left transition-colors hover:bg-surf disabled:cursor-default disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-[var(--center-accent)]">
                      <span className="flex items-center gap-2 truncate text-sm font-medium">
                        {name}
                        {isActive && <span className="rounded border border-[var(--center-accent)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--center-accent)]">{t('workspaceCenter.current', 'Current')}</span>}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-xs text-ink-3">{workspace.id}</span>
                    </button>
                    {busyId === workspace.id && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ink-2" aria-label={t('common.loading', 'Loading')} />}
                    {isMain ? (
                      <span className="flex shrink-0 items-center gap-1 text-xs text-ink-3"><Star className="h-3.5 w-3.5" />{t('workspaceCenter.main', 'Main')}</span>
                    ) : (
                      <button type="button" onClick={() => handleSetMain(workspace.id, name)} disabled={!!busyId}
                        className="shrink-0 rounded-md px-2 py-1.5 text-xs text-ink-2 hover:bg-surf hover:text-ink disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-[var(--center-accent)]"
                        title={t('workspaceCenter.setMainTooltip', 'Set as main')}>
                        {t('workspaceCenter.setMainTooltip', 'Set as main')}
                      </button>
                    )}
                    {!isMain && workspace.id !== 'default' && (
                      <button type="button" onClick={() => handleDelete(workspace.id, name)} disabled={!!busyId}
                        className="shrink-0 rounded-md p-2 text-ink-3 hover:bg-down/10 hover:text-down disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-down"
                        title={t('workspaceCenter.deleteTooltip', 'Delete workspace')} aria-label={`${t('workspaceCenter.deleteTooltip', 'Delete workspace')}: ${name}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {page === 'isolation' && <IsolationRulesTab />}
          {page === 'assetBridge' && <AssetBridgeTab />}
          {page === 'envHooks' && <EnvironmentHooksTab />}
          {page === 'storageAudit' && <StorageAuditTab />}
          {page === 'export' && <ExportTab />}
        </div>
      </main>
    </div>
  );
};
