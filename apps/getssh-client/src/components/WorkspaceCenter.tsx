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
import { ManagementHeader } from './ManagementSurface';

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
    <div className="center-workbench management-center h-full bg-bg text-ink" data-glass={enableGlassmorphism}>
    <div className="management-frame flex h-full min-h-0">
      <aside className="center-side-nav center-page-nav management-nav">
        <h2 className="sr-only">{t('workspaceCenter.title', 'Workspaces')}</h2>
        <nav aria-label={t('workspaceCenter.title', 'Workspaces')}>
          {nav.map(({ id, label, icon: Icon }, index) => (
            <React.Fragment key={id}>
              {(index === 0 || index === 1) && (
                <p className="management-nav-label truncate" title={index === 1 ? activeWorkspaceName : undefined}>
                  {index === 0 ? t('workspaceCenter.sidebar.overview', 'Overview') : `${t('workspaceCenter.current', 'Current')} · ${activeWorkspaceName}`}
                </p>
              )}
              <button type="button" onClick={() => setPage(id)} aria-current={page === id ? 'page' : undefined} title={label}
                className="management-nav-item">
                <Icon className="h-4 w-4" aria-hidden="true" /> <span>{label}</span>
              </button>
            </React.Fragment>
          ))}
        </nav>
      </aside>

      <main className="management-main overflow-y-auto" aria-label={activeNav.label}>
        <div className="management-content">
          <ManagementHeader
            context={t('workspaceCenter.title', 'Workspaces')}
            title={activeNav.label}
            description={page === 'all' ? t('workspaceCenter.subtitle', 'Manage your separate workspaces.') : `${t('workspaceCenter.current', 'Current')} · ${activeWorkspaceName}`}
            actions={page === 'all' ? (
              <button type="button" onClick={() => setIsCreateModalOpen(true)}
                className="inline-flex min-h-9 items-center gap-2 rounded-md bg-primary px-3.5 text-sm font-medium text-[var(--primary-ink)] transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                <Plus className="h-4 w-4" aria-hidden="true" />{t('workspaceCenter.create', 'New workspace')}
              </button>
            ) : undefined}
          />

          {error && <p role="alert" className="mb-5 rounded-md border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{error}</p>}

          {page === 'all' && (
            <div className="management-list">
              {workspaces.length === 0 && <p className="px-5 py-8 text-sm text-ink-2">{t('workspaceCenter.noWorkspaces', 'No workspaces yet.')}</p>}
              {workspaces.map(workspace => {
                const isActive = workspace.id === activeWorkspaceId;
                const isMain = workspace.isMain ?? (workspace.id === 'default');
                const name = workspace.id === 'default' ? t('sidebar.defaultWorkspace') : workspace.name || workspace.id;
                return (
                  <div key={workspace.id} className="management-list-row flex min-h-17 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-3" data-current={isActive || undefined}>
                    <span className="grid size-8 shrink-0 place-items-center rounded-md border border-line-soft bg-surf-2" aria-hidden="true"><Layers size={15} style={{ color: workspace.themeColor || 'var(--center-accent)' }} /></span>
                    <button type="button" onClick={() => handleSwitch(workspace.id)} disabled={!!busyId || isActive}
                      className="min-w-0 flex-1 rounded-md px-2 py-1 text-left transition-colors hover:bg-surf disabled:cursor-default disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-[var(--center-accent)]">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-medium">
                        <span className="max-w-full break-words">{name}</span>
                        {isActive && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">{t('workspaceCenter.current', 'Current')}</span>}
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
    </div>
  );
};
