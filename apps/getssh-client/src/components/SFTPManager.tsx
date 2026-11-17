import { Fragment, useCallback, useEffect, useId, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { ArrowUp, ChevronRight, Download, File, FilePlus, Folder, FolderPlus, HardDrive, Link2, Lock, Pencil, RefreshCw, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isSSHConfig, useSessionStore, type PaneLeaf, type PaneNode } from '../store/sessionStore';
import { useAppStore } from '../store/appStore';
import { usePluginStore } from '../store/pluginStore';
import { usePanelStore } from '../store/panelStore';
import './SessionFiles.css';

export interface SFTPFile {
  name: string;
  longname: string;
  type: 'd' | '-' | 'l';
  size: number;
  mtime: number;
}

export const SFTP_PANEL_ID = 'sftp';

/** Registers the SFTP panel in this window's panel host (main window and torn windows each have one). */
export function registerSftpPanel() {
  usePanelStore.getState().registerPanel({
    id: SFTP_PANEL_ID,
    title: 'SFTP Manager',
    component: SFTPManager,
    position: 'bottom',
    defaultSize: 280,
    minSize: 180,
    maxSize: 520,
  });
}

function findSession(node: PaneNode, sessionId: string): PaneLeaf | null {
  if (node.type === 'leaf') return node.paneType === 'terminal' && node.sessionId === sessionId ? node : null;
  return findSession(node.children[0], sessionId) ?? findSession(node.children[1], sessionId);
}

function joinPath(directory: string, name: string) {
  return `${directory.endsWith('/') ? directory : `${directory}/`}${name}`;
}

function formatSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return '–';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${Number((bytes / 1024 ** exponent).toFixed(1))} ${units[exponent]}`;
}

export const SFTPManager = ({ sessionId }: { sessionId: string, isDark: boolean }) => {
  const { t, i18n } = useTranslation();
  const [currentPath, setCurrentPath] = useState('/');
  const [files, setFiles] = useState<SFTPFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [listingError, setListingError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [createPrompt, setCreatePrompt] = useState<'file' | 'folder' | null>(null);
  const [promptInputValue, setPromptInputValue] = useState('');
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [pathInputValue, setPathInputValue] = useState('');
  const [downloadingItems, setDownloadingItems] = useState<Set<string>>(new Set());
  const listingRequest = useRef(0);
  const headingId = useId();
  const promptId = useId();

  const sftpDownloadPath = useAppStore(s => s.appConfig.sftpDownloadPath);
  const session = useSessionStore(state => {
    if (!sessionId) return null;
    const tree = state.tabs.find(tab => tab.id === state.activeTabId)?.paneTree;
    return tree ? findSession(tree, sessionId) : null;
  });
  const isDisconnected = !session || session.isDisconnected === true;
  const config = session && isSSHConfig(session.config) ? session.config : null;
  const host = config?.host?.trim();
  const server = host && config ? `${config.username ? `${config.username}@` : ''}${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${config.port || 22}` : '';
  const readError = t('sftp.listFailed');

  const fetchFiles = useCallback(async (path: string) => {
    if (isDisconnected) return;
    const request = ++listingRequest.current;
    setLoading(true);
    setListingError(null);
    try {
      const res = await window.electronAPI.sftpList(sessionId, path);
      if (request !== listingRequest.current) return;
      if (!res.success || !res.list) {
        setListingError(res.error || readError);
        return;
      }
      setTruncated(!!res.truncated);
      setFiles([...res.list].sort((a, b) => Number(b.type === 'd') - Number(a.type === 'd') || a.name.localeCompare(b.name)));
      setCurrentPath(path);
    } catch (err) {
      if (request === listingRequest.current) setListingError(err instanceof Error ? err.message : readError);
    } finally {
      if (request === listingRequest.current) setLoading(false);
    }
  }, [isDisconnected, readError, sessionId]);

  useEffect(() => {
    void fetchFiles('/');
    return () => { listingRequest.current += 1; };
  }, [fetchFiles]);

  const pathSegments = currentPath.split('/').filter(Boolean);
  const parentPath = `/${pathSegments.slice(0, -1).join('/')}`;
  const available = !isDisconnected && !loading && !mutating;
  const dateFormat = new Intl.DateTimeFormat(i18n?.language || undefined, { dateStyle: 'short', timeStyle: 'short' });

  const handleDelete = async (f: SFTPFile) => {
    if (!available || !window.confirm(t('sftp.deleteConfirm', { name: f.name }))) return;
    setActionError(null);
    setMutating(true);
    try {
      const res = await window.electronAPI.sftpDelete(sessionId, joinPath(currentPath, f.name), f.type === 'd');
      if (res.success) void fetchFiles(currentPath);
      else setActionError(res.error || t('sftp.deleteError'));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t('sftp.deleteError'));
    } finally {
      setMutating(false);
    }
  };

  const handleDownload = async (f: SFTPFile) => {
    if (!available || f.type === 'd') return;
    const path = joinPath(currentPath, f.name);
    setActionError(null);
    setDownloadingItems(prev => new Set(prev).add(path));
    try {
      const res = await window.electronAPI.sftpDownloadFile(sessionId, path, sftpDownloadPath);
      if (!res?.success && res?.canceled !== true) setActionError(res?.error || t('sftp.downloadError'));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t('sftp.downloadError'));
    } finally {
      setDownloadingItems(prev => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  };

  const handleEdit = async (file: SFTPFile) => {
    if (!available || file.type === 'd') return;
    setActionError(null);
    try {
      const res = await window.electronAPI.sftpEditSync(sessionId, joinPath(currentPath, file.name));
      if (!res.success) setActionError(res.error || t('sftp.editError'));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t('sftp.editError'));
    }
  };

  const openCreate = (kind: 'file' | 'folder') => {
    setPromptInputValue('');
    setCreatePrompt(kind);
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = promptInputValue;
    if (!createPrompt || !name.trim() || !available) return;
    setCreatePrompt(null);
    setActionError(null);
    setMutating(true);
    const path = joinPath(currentPath, name);
    try {
      const res = createPrompt === 'file'
        ? await window.electronAPI.sftpWriteFile(sessionId, path, '')
        : await window.electronAPI.sftpMkdir(sessionId, path);
      if (res.success) void fetchFiles(currentPath);
      else setActionError(res.error || t('sftp.createError'));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t('sftp.createError'));
    } finally {
      setMutating(false);
    }
  };

  const openContextMenu = (event: MouseEvent<HTMLTableRowElement>, file: SFTPFile) => {
    event.preventDefault();
    event.stopPropagation();
    if (!available) return;
    const uiExtensions = usePluginStore.getState().uiExtensions;
    void window.electronAPI.showContextMenu({
      target: 'sftp',
      extensions: uiExtensions.sftp,
      contextData: { sessionId, currentPath: joinPath(currentPath, file.name), selectedFiles: [file.name] },
    });
  };

  return (
    <section className="session-files" aria-labelledby={headingId}>
      <div className="session-files-body" inert={!!createPrompt}>
        <header className="session-files-header">
          <div className="session-files-identity">
            <HardDrive size={16} aria-hidden="true" />
            <h2 id={headingId}>{t('sftp.title')}</h2>
            {server && <span className="session-files-endpoint" title={server} dir="ltr">{server}</span>}
          </div>
          <div className="session-files-actions">
            <button type="button" className="session-files-action" disabled={!available} onClick={() => openCreate('file')} title={t('sftp.newFile')} aria-label={t('sftp.newFile')}>
              <FilePlus size={15} aria-hidden="true" /><span>{t('sftp.newFile')}</span>
            </button>
            <button type="button" className="session-files-action" disabled={!available} onClick={() => openCreate('folder')} title={t('sftp.newFolder')} aria-label={t('sftp.newFolder')}>
              <FolderPlus size={15} aria-hidden="true" /><span>{t('sftp.newFolder')}</span>
            </button>
            <button type="button" className="session-files-icon" disabled={!available} onClick={() => void fetchFiles(currentPath)} title={t('sftp.refresh')} aria-label={t('sftp.refresh')}>
              <RefreshCw size={15} aria-hidden="true" />
            </button>
            <button type="button" className="session-files-icon" onClick={() => usePanelStore.getState().togglePanel(SFTP_PANEL_ID)} title={t('common.close', 'Close')} aria-label={t('common.close', 'Close')}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="session-files-route">
          <button type="button" className="session-files-icon" disabled={!available || currentPath === '/'} onClick={() => void fetchFiles(parentPath)} title={t('sftp.parent')} aria-label={t('sftp.parent')}>
            <ArrowUp size={15} aria-hidden="true" />
          </button>
          {isEditingPath ? (
            <input
              autoFocus
              className="session-files-path-input"
              aria-label={t('sftp.path')}
              value={pathInputValue}
              spellCheck={false}
              dir="ltr"
              onChange={event => setPathInputValue(event.target.value)}
              onBlur={() => setIsEditingPath(false)}
              onKeyDown={event => {
                if (event.key === 'Enter' && available) void fetchFiles(pathInputValue.trim() || '/');
                if (event.key === 'Enter' || event.key === 'Escape') setIsEditingPath(false);
              }}
            />
          ) : (
            <>
              <nav className="session-files-crumbs" aria-label={t('sftp.path')} title={currentPath} dir="ltr">
                <button type="button" disabled={!available || !pathSegments.length} aria-current={!pathSegments.length ? 'location' : undefined} onClick={() => void fetchFiles('/')}>/</button>
                {pathSegments.map((part, index) => {
                  const last = index === pathSegments.length - 1;
                  return (
                    <Fragment key={index}>
                      <ChevronRight size={12} aria-hidden="true" />
                      <button type="button" disabled={!available || last} aria-current={last ? 'location' : undefined}
                        onClick={() => void fetchFiles('/' + pathSegments.slice(0, index + 1).join('/'))}><bdi>{part}</bdi></button>
                    </Fragment>
                  );
                })}
              </nav>
              <button type="button" className="session-files-icon" disabled={!available} onClick={() => { setPathInputValue(currentPath); setIsEditingPath(true); }} title={t('sftp.editPath')} aria-label={t('sftp.editPath')}>
                <Pencil size={14} aria-hidden="true" />
              </button>
            </>
          )}
        </div>

        {(listingError || actionError) && <p className="session-files-error" role="alert">{listingError || actionError}</p>}
        {truncated && !isDisconnected && <p className="session-files-notice" role="status">{t('sftp.truncated')}</p>}

        <div className="session-files-list" aria-busy={loading && !isDisconnected}>
          {isDisconnected ? (
            <p className="session-files-empty"><Lock size={16} aria-hidden="true" />{t('sftp.disabledHint')}</p>
          ) : (
            <table className="session-files-table" aria-label={t('sftp.title')}>
              <thead>
                <tr>
                  <th scope="col">{t('sftp.name')}</th>
                  <th scope="col" className="session-files-size">{t('sftp.size')}</th>
                  <th scope="col" className="session-files-modified">{t('sftp.modified')}</th>
                  <th scope="col" className="session-files-row-actions"><span className="sr-only">{t('sftp.actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {files.map(file => {
                  const path = joinPath(currentPath, file.name);
                  const downloading = downloadingItems.has(path);
                  const kind = file.type === 'd' ? 'folder' : file.type === 'l' ? 'link' : 'file';
                  const Icon = kind === 'folder' ? Folder : kind === 'link' ? Link2 : File;
                  const modified = new Date(file.mtime * 1000);
                  return (
                    <tr key={file.name} onContextMenu={event => openContextMenu(event, file)}>
                      <td title={file.name}>
                        {kind !== 'file' ? (
                          <button type="button" className="session-files-name" data-kind={kind} disabled={!available} onClick={() => void fetchFiles(path)}>
                            <Icon size={16} aria-hidden="true" /><bdi>{file.name}</bdi>
                          </button>
                        ) : (
                          <span className="session-files-name" onDoubleClick={() => void handleEdit(file)}>
                            <Icon size={16} aria-hidden="true" /><bdi>{file.name}</bdi>
                          </span>
                        )}
                      </td>
                      <td className="session-files-size">{kind === 'folder' ? '–' : formatSize(file.size)}</td>
                      <td className="session-files-modified">{Number.isNaN(modified.getTime()) ? '–' : dateFormat.format(modified)}</td>
                      <td className="session-files-row-actions">
                        <div className="session-files-row-buttons">
                          {kind !== 'folder' && (
                            <>
                              <button type="button" className="session-files-icon" disabled={!available} onClick={() => void handleEdit(file)}
                                aria-label={t('sftp.editNamed', { name: file.name })} title={t('sftp.edit')}>
                                <Pencil size={14} aria-hidden="true" />
                              </button>
                              <button type="button" className="session-files-icon" disabled={!available || downloading} onClick={() => void handleDownload(file)}
                                aria-label={t('sftp.downloadNamed', { name: file.name })} title={t('sftp.download')}>
                                {downloading ? <RefreshCw size={14} aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}
                              </button>
                            </>
                          )}
                          <button type="button" className="session-files-icon" data-danger disabled={!available} onClick={() => void handleDelete(file)}
                            aria-label={t('sftp.deleteNamed', { name: file.name })} title={t('sftp.delete')}>
                            <Trash2 size={14} aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {!isDisconnected && !loading && !listingError && !files.length && (
            <p className="session-files-empty"><Folder size={16} aria-hidden="true" />{t('sftp.empty')}</p>
          )}
        </div>
        {!isDisconnected && (
          <footer className="session-files-footer" role="status">
            <span>{loading ? t('sftp.loading') : mutating ? t('crypto.processing') : listingError && !files.length ? '' : t('sftp.items', { count: files.length })}</span>
            {downloadingItems.size > 0 && <span>{t('sftp.downloading', { count: downloadingItems.size })}</span>}
          </footer>
        )}
      </div>
      {createPrompt && (
        <div className="session-files-prompt-shade">
          <form role="dialog" aria-modal="true" aria-labelledby={promptId} className="session-files-prompt" onSubmit={event => void handleCreate(event)}
            onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setCreatePrompt(null); } }}>
            <h3 id={promptId}>{t(createPrompt === 'file' ? 'sftp.newFile' : 'sftp.newFolder')}</h3>
            <input autoFocus aria-label={t('sftp.name')} placeholder={t('sftp.name')}
              value={promptInputValue} onChange={event => setPromptInputValue(event.target.value)} />
            <div className="session-files-actions">
              <button type="button" className="session-files-action" onClick={() => setCreatePrompt(null)}>{t('common.cancel')}</button>
              <button type="submit" className="session-files-action" data-primary disabled={!promptInputValue.trim()}>{t('sftp.create')}</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
};
