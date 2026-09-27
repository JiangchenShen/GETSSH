import React, { useEffect, useRef, useState } from 'react';
import {
  Search, Plus, Edit2, Zap, X, Lock, KeyRound, Folder, FolderOpen,
  FolderPlus, FolderInput, MoreHorizontal, Check, ListChecks,
  PanelLeftClose, PanelLeftOpen, ChevronRight, ChevronDown,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/appStore';
import { useSessionStore } from '../store/sessionStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { SessionProfile } from '../store/sessionStore';
import { AssetFolderNode, buildAssetFolderTree } from '../utils/assetFolderTree';

/**
 * 主机侧栏。
 *
 * 每行原来是「24px 带框的 OS 图标 + 别名」，图标占了 24px 却只说了发行版；
 * 现在换成原型的三栏：6px 状态点 / 别名 + 等宽 user@host / 右侧留给状态与操作。
 * 地址是每天真要看的东西，发行版不是。
 *
 * 状态点接真实数据：该主机有没有开着的会话（tabs 里找得到就是绿的），
 * 没有的指标（延迟、负载）不编。
 */

interface ContextSidebarProps {
  onAddSession: () => void;
  onToggleAutoStart: (e: React.MouseEvent, targetSession: SessionProfile) => void;
  onDeleteSession: (e: React.MouseEvent, targetSession: SessionProfile) => void;
}

export const ContextSidebar: React.FC<ContextSidebarProps> = ({
  onAddSession,
  onToggleAutoStart,
  onDeleteSession,
}) => {
  const { t } = useTranslation();
  const isMac = useAppStore(state => state.isMac);
  const isFullScreen = useAppStore(state => state.isFullScreen);
  const isSidebarCollapsed = useAppStore(state => state.isSidebarCollapsed);
  const setIsSidebarCollapsed = useAppStore(state => state.setIsSidebarCollapsed);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const isSwitching = useWorkspaceStore(state => state.isSwitching);
  const workspaces = useWorkspaceStore(state => state.workspaces);

  const isVaultLocked = useWorkspaceStore(state => state.isVaultLocked);
  const setIsUnlockModalOpen = useWorkspaceStore(state => state.setIsUnlockModalOpen);

  const sessions = useSessionStore(state => state.sessions);
  const tabs = useSessionStore(state => state.tabs);
  const searchQuery = useSessionStore(state => state.searchQuery);
  const setSearchQuery = useSessionStore(state => state.setSearchQuery);
  const selectedSessionIndex = useSessionStore(state => state.selectedSessionIndex);
  const setSelectedSessionIndex = useSessionStore(state => state.setSelectedSessionIndex);
  const setActiveTabId = useSessionStore(state => state.setActiveTabId);

  const [folderPaths, setFolderPaths] = useState<string[]>([]);
  const [collapsedFolders, setCollapsedFolders] = useState<string[]>([]);
  const [folderError, setFolderError] = useState('');
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderMenu, setFolderMenu] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [folderEdit, setFolderEdit] = useState<{ mode: 'create' | 'rename'; parent: string; path?: string; name: string } | null>(null);
  const [movingIndex, setMovingIndex] = useState<number | null>(null);
  const [moveDestination, setMoveDestination] = useState('');
  const [organizing, setOrganizing] = useState(false);
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
  const [bulkDestination, setBulkDestination] = useState('');
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const folderBusyRef = useRef(false);
  const folderGeneration = useRef(0);

  useEffect(() => {
    let live = true;
    folderGeneration.current += 1;
    setFolderPaths([]);
    setCollapsedFolders([]);
    setFolderError('');
    setFolderMenu(null);
    setConfirmDelete(null);
    setFolderEdit(null);
    setMovingIndex(null);
    setFolderBusy(false);
    folderBusyRef.current = false;
    setOrganizing(false);
    setSelectedProfileIds([]);
    setDropTarget(null);
    if (!isVaultLocked && !isSwitching) {
      if (!window.electronAPI?.assetFolders) {
        setFolderError(t('assetFolders.loadFailed', '无法加载文件夹'));
        return () => { live = false; };
      }
      window.electronAPI.assetFolders.list(activeWorkspaceId).then(result => {
        if (!live || useWorkspaceStore.getState().activeWorkspaceId !== activeWorkspaceId || useWorkspaceStore.getState().isSwitching) return;
        if (!result.success) {
          setFolderError(result.error || t('assetFolders.loadFailed', '无法加载文件夹'));
          return;
        }
        setFolderPaths(result.folders || []);
      }).catch(error => {
        if (live && useWorkspaceStore.getState().activeWorkspaceId === activeWorkspaceId && !useWorkspaceStore.getState().isSwitching) {
          setFolderError(error instanceof Error ? error.message : t('assetFolders.loadFailed', '无法加载文件夹'));
        }
      });
    }
    return () => { live = false; };
  }, [activeWorkspaceId, isVaultLocked, isSwitching, t]);

  const mutateFolders = async (action: () => Promise<{ success: boolean; folders?: string[]; memberships?: { id: string; group: string | null }[]; error?: string }>) => {
    if (folderBusyRef.current || isVaultLocked || isSwitching) return false;
    const workspaceId = activeWorkspaceId;
    const generation = folderGeneration.current;
    folderBusyRef.current = true;
    setFolderBusy(true);
    setFolderError('');
    const stillHere = () => {
      const workspace = useWorkspaceStore.getState();
      return folderGeneration.current === generation && workspace.activeWorkspaceId === workspaceId && !workspace.isVaultLocked && !workspace.isSwitching;
    };
    try {
      const result = await action();
      if (!stillHere()) return false;
      if (!result.success) throw new Error(result.error || t('assetFolders.actionFailed', '文件夹操作失败'));
      if (result.folders) setFolderPaths(result.folders);
      if (result.memberships) {
        const state = useSessionStore.getState();
        const memberships = new Map(result.memberships.map(item => [item.id, item.group]));
        state.setSessions(state.sessions.map(profile => profile.id && !profile.isDraft && !profile.isQuickConnect && memberships.has(profile.id)
          ? { ...profile, group: memberships.get(profile.id) || undefined }
          : profile));
      }
      return true;
    } catch (error) {
      if (stillHere()) setFolderError(error instanceof Error ? error.message : t('assetFolders.actionFailed', '文件夹操作失败'));
      return false;
    } finally {
      if (stillHere()) {
        folderBusyRef.current = false;
        setFolderBusy(false);
      }
    }
  };

  const submitFolderEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!folderEdit) return;
    const name = folderEdit.name.trim();
    if (!name || name.includes('/')) {
      setFolderError(t('assetFolders.invalidName', '文件夹名称不能为空，也不能包含 /'));
      return;
    }
    const done = folderEdit.mode === 'create'
      ? await mutateFolders(() => window.electronAPI.assetFolders.create(activeWorkspaceId, [folderEdit.parent, name].filter(Boolean).join('/')))
      : await mutateFolders(() => window.electronAPI.assetFolders.rename(activeWorkspaceId, folderEdit.path!, name));
    if (done) {
      setFolderEdit(null);
      setFolderMenu(null);
      setCollapsedFolders(previous => previous.filter(path => path !== folderEdit.parent));
    }
  };

  const moveProfile = async (profile: SessionProfile) => {
    if (!profile.id) {
      setFolderError(t('assetFolders.saveBeforeMove', '请先保存此连接，再移动到文件夹'));
      return;
    }
    if (await mutateFolders(() => window.electronAPI.assetFolders.moveProfile(activeWorkspaceId, profile.id!, moveDestination || null))) {
      setMovingIndex(null);
    }
  };

  const moveSelectedProfiles = async () => {
    if (selectedProfileIds.length === 0) return;
    const moved = await mutateFolders(() => window.electronAPI.assetFolders.moveProfiles(activeWorkspaceId, selectedProfileIds, bulkDestination || null));
    if (moved) {
      setSelectedProfileIds([]);
      setOrganizing(false);
    }
  };

  const handleHostDrop = async (event: React.DragEvent, destination: string | null) => {
    event.preventDefault();
    setDropTarget(null);
    const id = event.dataTransfer.getData('application/x-getssh-profile-id');
    if (!id || isVaultLocked || isSwitching) return;
    await mutateFolders(() => window.electronAPI.assetFolders.moveProfile(activeWorkspaceId, id, destination));
  };

  const topPad = isFullScreen ? 'pt-3.5' : (isMac ? 'pt-10' : 'pt-8');

  // 开着会话的主机 —— 状态点的唯一真实来源
  const openHostKeys = new Set(
    tabs
      .filter(tb => (tb.workspaceId ?? activeWorkspaceId) === activeWorkspaceId && tb.config && 'host' in tb.config)
      .map(tb => `${(tb.config as any).username}@${(tb.config as any).host}`)
  );

  const sessionsWithIndex = sessions
    .map((s, idx) => ({ ...s, originalIndex: idx }))
    .filter(session => session.isDraft || session.protocol === 'local' || Boolean(session.host?.trim()));

  const filteredSessions = sessionsWithIndex.filter(s => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (s.alias && s.alias.toLowerCase().includes(query)) ||
           (s.host && s.host.toLowerCase().includes(query)) ||
           (s.username && s.username.toLowerCase().includes(query)) ||
           (s.group && s.group.toLowerCase().includes(query));
  });

  const { folders, rootSessions } = buildAssetFolderTree(folderPaths, sessionsWithIndex);
  const folderOptions = Array.from(new Set([
    ...folderPaths,
    ...sessionsWithIndex.filter(session => !session.isDraft && !session.isQuickConnect).flatMap(session => {
      const parts = (session.group || '').split('/');
      return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
    }),
  ].filter(Boolean))).sort((a, b) => a.localeCompare(b));

  const toggleFolder = (path: string) => setCollapsedFolders(previous => previous.includes(path)
    ? previous.filter(item => item !== path)
    : [...previous, path]);

  const renderSessionItem = (session: typeof sessionsWithIndex[0], depth = 0) => {
    const idx = session.originalIndex;
    const isSelected = selectedSessionIndex === idx;
    const addr = session.protocol === 'local'
      ? t('connection.protocol.local')
      : [session.username, session.host].filter(Boolean).join('@');
    const isOpen = openHostKeys.has(addr);
    const title = session.isDraft ? t('connection.draftTitle') : (session.alias || addr || t('connection.untitled'));

    return (
      <div
        key={session.id || idx}
        style={{ marginLeft: Math.min(depth, 4) * 12 }}
        draggable={Boolean(session.id && !session.isDraft && !session.isQuickConnect && !organizing && !isVaultLocked && !isSwitching && !folderBusy)}
        onDragStart={event => {
          if (!session.id) return;
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('application/x-getssh-profile-id', session.id);
        }}
        onDragEnd={() => setDropTarget(null)}
      >
        <div
          className={`group relative w-full grid items-center gap-[9px] px-2 py-[7px] rounded-[7px]
                      transition-colors ${organizing ? '[grid-template-columns:14px_minmax(0,1fr)]' : '[grid-template-columns:6px_minmax(0,1fr)_auto]'} ${
            isSelected ? 'bg-surf shadow-[inset_2px_0_0_var(--color-primary)]' : 'hover:bg-surf'
          }`}
        >
          {organizing ? (
            <input
              type="checkbox"
              aria-label={`${t('assetFolders.selectHost', '选择主机')} ${title}`}
              checked={Boolean(session.id && selectedProfileIds.includes(session.id))}
              disabled={!session.id || session.isDraft || session.isQuickConnect || isSwitching || folderBusy}
              onChange={event => {
                if (!session.id) return;
                setSelectedProfileIds(previous => event.target.checked
                  ? [...previous, session.id!]
                  : previous.filter(item => item !== session.id));
              }}
              className="w-3 h-3 accent-primary"
            />
          ) : (
            <span className={`w-1.5 h-1.5 rounded-full ${isOpen ? 'bg-ok' : 'bg-ink-3/50'}`} />
          )}

          <button
            type="button"
            onClick={() => { setSelectedSessionIndex(idx); setActiveTabId(null); }}
            className="min-w-0 text-left"
          >
            <span className={`block truncate text-[12.5px] font-medium ${isSelected ? 'text-ink' : 'text-ink-2 group-hover:text-ink'}`}>
              {title}
            </span>
            <span className="block truncate font-mono text-[10.5px] text-ink-3 mt-px">
              {session.isDraft ? t('connection.draftHint') : addr}
            </span>
          </button>

          {/* 操作在悬停、键盘聚焦或选中行时可见。 */}
          <div className={`flex items-center justify-end ${organizing ? 'hidden' : ''}`}>
            {Boolean(session.autoStart) && (
              <Zap className="w-3 h-3 text-warn group-hover:hidden group-focus-within:hidden" />
            )}
            <div className={`items-center gap-0.5 ${isSelected ? 'flex' : 'hidden group-hover:flex group-focus-within:flex'}`}>
              <IconBtn title={t('sidebar.editSession')} onClick={(e) => { e.stopPropagation(); setSelectedSessionIndex(idx); setActiveTabId(null); }}>
                <Edit2 className="w-3 h-3" />
              </IconBtn>
              <IconBtn
                title={session.id && !session.isDraft && !session.isQuickConnect
                  ? t('assetFolders.moveHost', '移动主机')
                  : t('assetFolders.saveBeforeMove', '请先保存此连接，再移动到文件夹')}
                onClick={() => { setMovingIndex(idx); setMoveDestination(session.group || ''); setFolderError(''); }}
                disabled={!session.id || session.isDraft || session.isQuickConnect || isVaultLocked || isSwitching || folderBusy}
              >
                <FolderInput className="w-3 h-3" />
              </IconBtn>
              <IconBtn
                title={t('sidebar.autoStartSession')}
                onClick={(e) => onToggleAutoStart(e, sessions[idx])}
                className={session.autoStart ? 'text-warn' : ''}
              >
                <Zap className="w-3 h-3" />
              </IconBtn>
              <IconBtn title={t('sidebar.deleteSession')} hover="down" onClick={(e) => onDeleteSession(e, sessions[idx])}>
                <X className="w-3 h-3" />
              </IconBtn>
            </div>
          </div>
        </div>
        {movingIndex === idx && (
          <div className="mx-2 mb-1 rounded-[7px] border border-line bg-panel px-2 py-2 space-y-1.5">
            <label className="block text-[11px] text-ink-2" htmlFor={`move-host-${idx}`}>
              {t('assetFolders.moveHost', '移动主机')}
            </label>
            <select
              id={`move-host-${idx}`}
              value={moveDestination}
              onChange={event => setMoveDestination(event.target.value)}
              className="w-full h-7 px-1.5 rounded border border-line bg-panel text-[11px] text-ink outline-none focus:border-primary"
            >
              <option value="">{t('assetFolders.root', '未分类（根目录）')}</option>
              {folderOptions.map(path => <option key={path} value={path}>{path}</option>)}
            </select>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setMovingIndex(null)} className="text-[11px] text-ink-3 hover:text-ink">
                {t('assetFolders.cancel', '取消')}
              </button>
              <button
                type="button"
                disabled={folderBusy || moveDestination === (session.group || '')}
                onClick={() => moveProfile(sessions[idx])}
                className="text-[11px] font-medium text-primary disabled:opacity-40"
              >
                {t('assetFolders.move', '移动')}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderFolderEdit = (depth: number) => folderEdit && (
    <form
      onSubmit={submitFolderEdit}
      style={{ marginLeft: Math.min(depth, 4) * 12 }}
      className="flex items-center gap-1 px-1 py-1"
    >
      <Folder className="w-3.5 h-3.5 flex-none text-ink-3" />
      <input
        autoFocus
        aria-label={folderEdit.mode === 'rename'
          ? t('assetFolders.rename', '重命名文件夹')
          : t('assetFolders.newFolder', '新建文件夹')}
        value={folderEdit.name}
        onChange={event => setFolderEdit({ ...folderEdit, name: event.target.value })}
        onKeyDown={event => { if (event.key === 'Escape') setFolderEdit(null); }}
        className="min-w-0 flex-1 h-7 px-1.5 rounded border border-primary/50 bg-panel text-xs text-ink outline-none"
      />
      <button type="submit" title={t('assetFolders.save', '保存')} disabled={folderBusy}
        className="w-[22px] h-[22px] rounded grid place-items-center text-primary hover:bg-surf disabled:opacity-40 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary">
        <Check className="w-3.5 h-3.5" />
      </button>
      <IconBtn title={t('assetFolders.cancel', '取消')} onClick={() => setFolderEdit(null)}>
        <X className="w-3.5 h-3.5" />
      </IconBtn>
    </form>
  );

  const renderFolder = (folder: AssetFolderNode, depth = 0): React.ReactNode => {
    const isExpanded = !collapsedFolders.includes(folder.path);
    const isRenaming = folderEdit?.mode === 'rename' && folderEdit.path === folder.path;
    const isCreatingChild = folderEdit?.mode === 'create' && folderEdit.parent === folder.path;
    return (
      <div key={folder.path}>
        {isRenaming ? renderFolderEdit(depth) : (
          <div
            style={{ marginLeft: Math.min(depth, 4) * 12 }}
            onDragOver={event => {
              if (event.dataTransfer.types.includes('application/x-getssh-profile-id')) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setDropTarget(folder.path);
              }
            }}
            onDragLeave={event => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(null);
            }}
            onDrop={event => handleHostDrop(event, folder.path)}
            className={`flex items-center gap-0.5 rounded-[7px] hover:bg-surf ${dropTarget === folder.path ? 'bg-primary/10 ring-1 ring-primary/60' : ''}`}
          >
            <button
              type="button"
              aria-expanded={isExpanded}
              onClick={() => toggleFolder(folder.path)}
              title={folder.path}
              className="min-w-0 flex-1 flex items-center gap-1.5 px-1 py-[5px] text-left text-[12px] text-ink-2 hover:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
            >
              {isExpanded ? <ChevronDown className="w-3 h-3 flex-none" /> : <ChevronRight className="w-3 h-3 flex-none" />}
              {isExpanded ? <FolderOpen className="w-3.5 h-3.5 flex-none text-primary" /> : <Folder className="w-3.5 h-3.5 flex-none text-ink-3" />}
              <span className="min-w-0 flex-1 truncate font-medium">{folder.name}</span>
              <span className="font-mono text-[10px] text-ink-3">{folder.total}</span>
            </button>
            <IconBtn title={t('assetFolders.folderActions', '文件夹操作')} disabled={isVaultLocked || isSwitching || folderBusy} onClick={() => { setFolderMenu(folderMenu === folder.path ? null : folder.path); setConfirmDelete(null); }}>
              <MoreHorizontal className="w-3.5 h-3.5" />
            </IconBtn>
          </div>
        )}
        {folderMenu === folder.path && !isRenaming && (
          <div style={{ marginLeft: Math.min(depth, 4) * 12 + 20 }} className="mb-1 flex flex-wrap gap-x-2 gap-y-1 px-1 text-[11px]">
            {confirmDelete === folder.path ? (
              <>
                <span className="w-full text-ink-3">{t('assetFolders.deleteConfirm', '仅删除空文件夹，不会删除主机。')}</span>
                <button type="button" disabled={folderBusy || isSwitching} onClick={async () => {
                  if (await mutateFolders(() => window.electronAPI.assetFolders.remove(activeWorkspaceId, folder.path))) {
                    setFolderMenu(null);
                    setConfirmDelete(null);
                  }
                }} className="text-down disabled:opacity-40">{t('assetFolders.confirm', '确认删除')}</button>
                <button type="button" onClick={() => setConfirmDelete(null)} className="text-ink-3 hover:text-ink">{t('assetFolders.cancel', '取消')}</button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => { setFolderEdit({ mode: 'create', parent: folder.path, name: '' }); setFolderMenu(null); setCollapsedFolders(previous => previous.filter(path => path !== folder.path)); }} className="text-ink-2 hover:text-primary">
                  {t('assetFolders.newSubfolder', '新建子文件夹')}
                </button>
                <button type="button" onClick={() => { setFolderEdit({ mode: 'rename', parent: '', path: folder.path, name: folder.name }); setFolderMenu(null); }} className="text-ink-2 hover:text-primary">
                  {t('assetFolders.rename', '重命名文件夹')}
                </button>
                <button type="button" disabled={folder.total > 0 || folder.children.length > 0}
                  title={folder.total > 0 || folder.children.length > 0 ? t('assetFolders.emptyBeforeDelete', '先移走主机并删除子文件夹') : undefined}
                  onClick={() => setConfirmDelete(folder.path)} className="text-down disabled:opacity-40">
                  {t('assetFolders.delete', '删除文件夹')}
                </button>
              </>
            )}
          </div>
        )}
        {isCreatingChild && renderFolderEdit(depth + 1)}
        {isExpanded && (
          <div className="flex flex-col gap-px">
            {folder.children.map(child => renderFolder(child, depth + 1))}
            {folder.sessions.map(session => renderSessionItem(session, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (isSidebarCollapsed) {
    return (
      <div className={`drag-region h-full w-full flex flex-col items-center ${topPad} border-r border-line-soft`}>
        <button
          type="button"
          onClick={() => setIsSidebarCollapsed(false)}
          title={t('sidebar.expand')}
          className="no-drag-region w-[30px] h-[30px] rounded-[7px] grid place-items-center
                     text-ink-3 transition-colors hover:bg-surf hover:text-ink-2"
        >
          <PanelLeftOpen className="w-4 h-4" />
        </button>
      </div>
    );
  }

  const activeWs = workspaces.find((w: any) => typeof w === 'object' ? w.id === activeWorkspaceId : w === activeWorkspaceId);
  const displayName = activeWs && typeof activeWs === 'object' ? activeWs.name || activeWorkspaceId : activeWorkspaceId;

  return (
    <div className={`drag-region h-full w-full flex flex-col gap-[11px] px-3 pb-3.5 ${topPad}
                     border-r border-line-soft min-w-0`}>

      <div className="no-drag-region flex items-center justify-between gap-2 px-0.5">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('app:open-center', {
            detail: { type: 'workspace', title: t('statusBar.workspace') },
          }))}
          title={`${displayName} · ${t('statusBar.workspace')}`}
          className="min-w-0 flex items-center gap-1 rounded-md px-1 py-1 text-xs font-semibold text-ink-2 hover:bg-surf hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          <span className="truncate">{displayName}</span>
          <ChevronRight className="h-3 w-3 flex-none text-ink-3" />
        </button>
        <button
          type="button"
          onClick={() => setIsSidebarCollapsed(true)}
          title={t('sidebar.collapse')}
          className="flex-none w-[22px] h-[22px] rounded-md grid place-items-center
                     text-ink-3 transition-colors hover:bg-surf hover:text-ink-2"
        >
          <PanelLeftClose className="w-[15px] h-[15px]" />
        </button>
      </div>

      <div className="no-drag-region flex items-center gap-2 h-8 px-2.5 rounded-lg bg-panel border border-line-soft
                      focus-within:border-primary/60 transition-colors">
        <Search className="w-3.5 h-3.5 flex-none text-ink-3" />
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          type="text"
          spellCheck={false}
          placeholder={t('sidebar.search')}
          className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[12.5px]
                     text-ink placeholder:text-ink-3"
        />
      </div>

      <div className="no-drag-region flex items-center justify-between px-1">
        <span className="text-[11px] font-medium text-ink-3">{t('assetFolders.assets', '资产')}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={isVaultLocked || isSwitching || folderBusy}
            aria-pressed={organizing}
            onClick={() => { setOrganizing(!organizing); setSelectedProfileIds([]); setMovingIndex(null); setFolderMenu(null); }}
            title={t('assetFolders.organize', '批量整理主机')}
            aria-label={t('assetFolders.organize', '批量整理主机')}
            className={`w-6 h-6 rounded-md grid place-items-center hover:bg-surf hover:text-primary
                       focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary disabled:opacity-40 ${organizing ? 'text-primary bg-surf' : 'text-ink-2'}`}
          >
            <ListChecks className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={isVaultLocked || isSwitching || folderBusy}
            onClick={() => { setSearchQuery(''); setFolderEdit({ mode: 'create', parent: '', name: '' }); setFolderMenu(null); setFolderError(''); }}
            title={isVaultLocked ? t('sidebar.unlockVault') : t('assetFolders.newFolder', '新建文件夹')}
            aria-label={t('assetFolders.newFolder', '新建文件夹')}
            className="w-6 h-6 rounded-md grid place-items-center text-ink-2 hover:bg-surf hover:text-primary
                       focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary disabled:opacity-40"
          >
            <FolderPlus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {folderError && (
        <div role="alert" className="no-drag-region rounded-[7px] border border-down/30 bg-down/5 px-2 py-1.5 text-[11px] text-down">
          {folderError}
        </div>
      )}

      <div className="no-drag-region flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col gap-[11px]">
        {isVaultLocked ? (
          <div className="flex flex-col items-center gap-3.5 p-4 rounded-[10px] border border-down/25 bg-down/5">
            <div className="w-10 h-10 rounded-[10px] grid place-items-center border border-down/25 bg-down/10">
              <Lock className="w-[18px] h-[18px] text-down" />
            </div>
            <div className="flex flex-col items-center gap-1 text-center">
              <div className="text-[11px] font-semibold tracking-[0.14em] uppercase text-down">
                {t('sidebar.vaultLocked')}
              </div>
              <div className="font-mono text-[10px] leading-relaxed text-ink-3">
                AES-256-GCM
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsUnlockModalOpen(true)}
              className="w-full h-8 flex items-center justify-center gap-1.5 rounded-lg
                         border border-down/30 bg-down/10 text-[11.5px] font-medium text-down
                         transition-colors hover:bg-down/20 hover:border-down/50"
            >
              <KeyRound className="w-3.5 h-3.5" />
              {t('sidebar.unlockVault')}
            </button>
          </div>
        ) : (
          <>
            {searchQuery ? (
              filteredSessions.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-ink-3">{t('sidebar.noMatch')}</div>
              ) : (
                <div className="flex flex-col gap-px">{filteredSessions.map(s => renderSessionItem(s))}</div>
              )
            ) : (
              <>
                {folderEdit?.mode === 'create' && !folderEdit.parent && renderFolderEdit(0)}
                {folders.map(folder => renderFolder(folder))}

                {(rootSessions.length > 0 || folders.length > 0) && (
                  <div>
                    {folders.length > 0 && (
                      <div
                        onDragOver={event => {
                          if (event.dataTransfer.types.includes('application/x-getssh-profile-id')) {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = 'move';
                            setDropTarget('');
                          }
                        }}
                        onDragLeave={event => {
                          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(null);
                        }}
                        onDrop={event => handleHostDrop(event, null)}
                        className={`px-1 py-1 mb-1 rounded-[7px] text-[11px] font-medium text-ink-3 ${dropTarget === '' ? 'bg-primary/10 ring-1 ring-primary/60' : ''}`}
                      >
                        {t('assetFolders.root', '未分类（根目录）')}
                      </div>
                    )}
                    <div className="flex flex-col gap-px">{rootSessions.map(s => renderSessionItem(s))}</div>
                  </div>
                )}
                {folders.length === 0 && rootSessions.length === 0 && !folderEdit && (
                  <div className="px-1 py-2 text-[11px] text-ink-3">{t('assetFolders.empty', '暂无主机或文件夹')}</div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {organizing && !isVaultLocked && (
        <div className="no-drag-region flex-none rounded-[7px] border border-line bg-panel p-2 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-ink-2">
            <span>{t('assetFolders.selectedCount', { count: selectedProfileIds.length, defaultValue: '已选 {{count}} 台主机' })}</span>
            <button type="button" onClick={() => { setOrganizing(false); setSelectedProfileIds([]); }} className="text-ink-3 hover:text-ink">
              {t('assetFolders.cancel', '取消')}
            </button>
          </div>
          <label className="sr-only" htmlFor="bulk-folder-destination">{t('assetFolders.moveHost', '移动主机')}</label>
          <select
            id="bulk-folder-destination"
            value={bulkDestination}
            onChange={event => setBulkDestination(event.target.value)}
            className="w-full h-7 px-1.5 rounded border border-line bg-panel text-[11px] text-ink outline-none focus:border-primary"
          >
            <option value="">{t('assetFolders.root', '未分类（根目录）')}</option>
            {folderOptions.map(path => <option key={path} value={path}>{path}</option>)}
          </select>
          <button
            type="button"
            disabled={selectedProfileIds.length === 0 || folderBusy || isSwitching}
            onClick={moveSelectedProfiles}
            className="w-full h-7 rounded-[6px] bg-primary/15 text-[11px] font-medium text-primary hover:bg-primary/25 disabled:opacity-40"
          >
            {t('assetFolders.moveSelected', '移动选中的主机')}
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onAddSession}
        className="no-drag-region flex-none flex items-center justify-center gap-[7px] h-[34px] w-full
                   rounded-lg border border-dashed border-line text-[12.5px] text-ink-2
                   transition-colors hover:border-primary hover:text-primary"
      >
        <Plus className="w-3.5 h-3.5" />
        {t('sidebar.newConnection')}
      </button>
    </div>
  );
};

/* ── 小件 ─────────────────────────────────────────────────────────── */

const IconBtn: React.FC<{
  onClick: (e: React.MouseEvent) => void;
  title?: string;
  className?: string;
  hover?: 'primary' | 'down';
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ onClick, title, className = '', hover = 'primary', disabled, children }) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    disabled={disabled}
    className={`w-[18px] h-[18px] rounded grid place-items-center text-ink-3 transition-colors
                focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary disabled:opacity-40
                ${hover === 'down' ? 'hover:bg-down/15 hover:text-down' : 'hover:bg-surf-2 hover:text-ink'}
                ${className}`}
  >
    {children}
  </button>
);
