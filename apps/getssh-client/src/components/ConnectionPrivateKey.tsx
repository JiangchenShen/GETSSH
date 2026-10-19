import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { adoptWorkspaceProfiles } from '../lib/adoptWorkspaceProfiles';
import { useAppLockStore } from '../store/appLockStore';
import { useSessionStore } from '../store/sessionStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { SshKey } from '../types/store';
import { storeFailureMessage } from '../utils/storeFeedback';
import type { ConnectFormSession } from './ConnectForm';

interface Props {
  session: ConnectFormSession;
  savedSession: ConnectFormSession;
  disabled: boolean;
  onSelectKey: (id: string) => void;
  onUseFile: () => void;
  children: ReactNode;
}
const buttonClass = 'rounded-md border border-line px-3 py-2 text-xs text-ink hover:bg-surf focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50';

/** Stored keys expose metadata only. Profile-file import and optional Trash confirmation stay in main. */
export function ConnectionPrivateKey({ session, savedSession, disabled, onSelectKey, onUseFile, children }: Props) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const workspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const switching = useWorkspaceStore(state => state.isSwitching);
  const locked = useWorkspaceStore(state => state.isVaultLocked);
  const phase = useAppLockStore(state => state.state?.phase);
  const mustChangePassword = useAppLockStore(state => state.state?.masterPasswordMustChange);
  const revision = useSessionStore(state => state.sessionsRevision);
  const [keys, setKeys] = useState<SshKey[]>([]);
  const [open, setOpen] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [needsPassphrase, setNeedsPassphrase] = useState(false);
  const [trashOriginal, setTrashOriginal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [listError, setListError] = useState('');
  const [notice, setNotice] = useState('');
  const alive = useRef(false);
  const generation = useRef(0);
  const importing = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const allowed = phase === 'ready' && !mustChangePassword && !locked && !switching;
  const copy = (cn: string, en: string) => zh ? cn : en;
  const clearDialog = () => { setOpen(false); setPassphrase(''); setNeedsPassphrase(false); setTrashOriginal(false); setError(''); };

  useEffect(() => {
    alive.current = true;
    const invalidate = () => {
      generation.current++;
      importing.current = false;
      setKeys([]); clearDialog(); setBusy(false); setNotice(''); setListError('');
    };
    const stopWorkspace = useWorkspaceStore.subscribe((next, previous) => {
      if (next.activeWorkspaceId !== previous.activeWorkspaceId || next.isSwitching !== previous.isSwitching || next.isVaultLocked !== previous.isVaultLocked) invalidate();
    });
    const stopApp = useAppLockStore.subscribe((next, previous) => {
      if (next.state?.phase !== previous.state?.phase || next.state?.masterPasswordMustChange !== previous.state?.masterPasswordMustChange) invalidate();
    });
    return () => { alive.current = false; generation.current++; stopWorkspace(); stopApp(); };
  }, []);

  const scope = () => ({ generation: generation.current, workspaceId, revision: useSessionStore.getState().sessionsRevision });
  const current = (request: ReturnType<typeof scope>) => {
    const workspace = useWorkspaceStore.getState();
    const app = useAppLockStore.getState().state;
    return alive.current && request.generation === generation.current && request.workspaceId === workspace.activeWorkspaceId
      && !workspace.isSwitching && !workspace.isVaultLocked && app?.phase === 'ready' && !app.masterPasswordMustChange
      && request.revision === useSessionStore.getState().sessionsRevision;
  };
  const loadKeys = async () => {
    if (!allowed || !window.electronAPI?.store?.sshKeys) return;
    const request = scope();
    try {
      const result = await window.electronAPI.store.sshKeys.list({ workspaceId });
      if (!current(request)) return;
      if (result.ok) { setKeys(result.keys); setListError(''); }
      else setListError(storeFailureMessage(result.error, zh, result.retryAfterMs));
    } catch { if (current(request)) setListError(copy('私钥列表未能加载，请重试。', 'Could not load saved keys. Retry.')); }
  };
  useEffect(() => { void loadKeys(); }, [workspaceId, allowed, revision]);

  const failure = (code: string, retryAfterMs?: number) => {
    if (code === 'needs_password') return copy('这个私钥需要口令，请输入后重试。', 'This key needs a passphrase. Enter it and retry.');
    if (code === 'wrong_password') return copy('私钥口令不正确，请重新输入。', 'The key passphrase is incorrect. Try again.');
    if (code === 'unsupported_key') return copy('不支持这个私钥。请使用 Ed25519、RSA 或 ECDSA 的 OpenSSH、PEM 或 PuTTY PPK v2/v3 文件，或先转为 OpenSSH 格式。', 'Unsupported key. Use an Ed25519, RSA or ECDSA key in OpenSSH, PEM or PuTTY PPK v2/v3 format, or convert it to OpenSSH first.');
    if (code === 'not_found') return copy('服务器或私钥文件已不存在，请检查连接配置。', 'The server or key file no longer exists. Check the connection settings.');
    return storeFailureMessage(code, zh, retryAfterMs);
  };
  const importedNotice = (trashed: boolean, kept?: string) => {
    if (trashed) return copy('私钥已导入，原文件已移到废纸篓。', 'Key imported. The original file was moved to the Trash.');
    switch (kept) {
      case 'used_elsewhere': return copy('私钥已导入。原文件仍被其他连接或 2.0 数据使用，已保留。', 'Key imported. The original file was kept because other connections or GETSSH 2.0 data still use it.');
      case 'workspaces_locked': return copy('私钥已导入。有工作区锁定，无法检查所有引用，原文件已保留。', 'Key imported. Some workspaces are locked, so all references could not be checked. The original file was kept.');
      case 'declined': return copy('私钥已导入，已按选择保留原文件。', 'Key imported. The original file was kept as requested.');
      case 'trash_failed': return copy('私钥已导入，但原文件未能移到废纸篓。请检查文件权限后自行处理。', 'Key imported, but the original file could not be moved to the Trash. Check its permissions before handling it manually.');
      default: return copy('私钥已导入，原文件已保留。', 'Key imported. The original file was kept.');
    }
  };
  const importFile = async () => {
    const request = scope();
    if (importing.current || disabled || !current(request) || !savedSession.id) return;
    importing.current = true; setBusy(true); setError('');
    const body = { workspaceId, profileId: savedSession.id, passphrase: passphrase || undefined, trashOriginal, language: zh ? 'zh-CN' as const : 'en-US' as const };
    setPassphrase('');
    try {
      const result = await window.electronAPI.store.sshKeys.importProfileFile(body);
      if (!current(request)) return;
      if (!result.ok) {
        if (result.error === 'needs_password' || result.error === 'wrong_password') setNeedsPassphrase(true);
        setError(failure(result.error, result.retryAfterMs));
        return;
      }
      if (!adoptWorkspaceProfiles(result)) return;
      clearDialog(); setNotice(importedNotice(result.trashed, result.kept));
    } catch { if (current(request)) setError(copy('私钥未能导入，请重试。原文件会保留。', 'The key could not be imported. Retry. The original file is kept.')); }
    finally {
      body.passphrase = undefined;
      if (alive.current && request.generation === generation.current) { importing.current = false; setBusy(false); }
    }
  };

  useEffect(() => {
    if (!open || !allowed) return;
    const previous = document.activeElement;
    const controls = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []);
    const focusFirst = () => (controls()[0] ?? dialog.current)?.focus();
    focusFirst();
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (!importing.current) clearDialog(); }
      if (event.key !== 'Tab') return;
      const items = controls(); const first = items[0]; const last = items[items.length - 1];
      if (!first) { event.preventDefault(); dialog.current?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    const focus = (event: FocusEvent) => { if (!dialog.current?.contains(event.target as Node)) focusFirst(); };
    document.addEventListener('keydown', keys, true); document.addEventListener('focusin', focus, true);
    return () => {
      document.removeEventListener('keydown', keys, true); document.removeEventListener('focusin', focus, true);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [open, allowed]);

  const usesStored = !!session.keyId;
  const fileSaved = !!savedSession.id && !savedSession.isDraft && !savedSession.isQuickConnect && !!savedSession.privateKeyPath && !savedSession.keyId;
  const pendingEdits = Object.entries(session).some(([field, value]) => !Object.is(value, savedSession[field as keyof ConnectFormSession]));
  return <div className="space-y-3">
    <label className="block space-y-2 text-xs text-ink-2">
      <span>{copy('私钥来源', 'Key source')}</span>
      <select aria-label={copy('私钥来源', 'Key source')} disabled={disabled || !allowed} value={session.keyId || ''} onChange={event => {
        setNotice(''); setError('');
        if (event.target.value) onSelectKey(event.target.value); else onUseFile();
      }} className="h-10 w-full rounded-md border border-line bg-surf px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-primary">
        <option value="">{copy('使用文件', 'Use a file')}</option>
        {usesStored && !keys.some(key => key.id === session.keyId) && <option value={session.keyId!}>{copy('已保存的私钥（请确认列表）', 'Saved key (check the list)')}</option>}
        {keys.map(key => <option key={key.id} value={key.id} disabled={!!session.isQuickConnect}>{copy('已保存：', 'Saved: ')}{key.name} · {key.algorithm}</option>)}
      </select>
    </label>
    {session.isQuickConnect && <p className="text-xs text-ink-3">{copy('先保存连接后使用已保存私钥。快速连接可以使用磁盘上的私钥文件。', 'Save this connection before using a saved key. Quick connections can use a key file on disk.')}</p>}
    {!keys.length && !listError && <p className="text-xs text-ink-3">{copy('当前工作区没有保存的私钥。可在设置 → SSH 中导入或生成。', 'No saved keys in this workspace. Import or generate one in Settings → SSH.')}</p>}
    {listError && <div className="flex flex-wrap items-center gap-2 text-xs"><p role="alert" className="text-down">{listError}</p><button type="button" disabled={!allowed} className={buttonClass} onClick={() => void loadKeys()}>{copy('重试', 'Retry')}</button></div>}
    {!usesStored && children}
    {fileSaved && !usesStored && <div className="space-y-2 border-t border-line-soft pt-3 text-xs text-ink-2">
      <p>{copy('这个私钥还是磁盘上的文件，加密备份里不包含它。', 'This key is still a file on disk and is not included in encrypted backups.')}</p>
      <button type="button" disabled={disabled || !allowed || pendingEdits} className={buttonClass} onClick={() => { clearDialog(); setNotice(''); setOpen(true); }}>{copy('导入到 GETSSH', 'Import into GETSSH')}</button>
      {pendingEdits && <p className="text-ink-3">{copy('等待连接更改保存后，再导入私钥。', 'Wait for connection changes to save before importing the key.')}</p>}
    </div>}
    {notice && <p role="status" className="text-xs text-ink-2">{notice}</p>}
    {open && allowed && createPortal(<div className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/60 p-4">
      <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="profile-key-import-title" className="w-full max-w-md space-y-4 rounded-xl border border-line bg-panel p-5 text-ink shadow-xl">
        <h3 id="profile-key-import-title" className="text-base font-semibold">{copy('导入私钥到 GETSSH', 'Import key into GETSSH')}</h3>
        <p className="text-sm text-ink-2">{copy('当前工作区中使用同一文件的服务器会一起改用导入的私钥。原文件默认保留。', 'Servers in this workspace using the same file will switch to the imported key. The original file is kept by default.')}</p>
        <form onSubmit={event => { event.preventDefault(); event.stopPropagation(); void importFile(); }} className="space-y-4">
          {needsPassphrase && <label className="block space-y-2 text-sm"><span>{copy('私钥口令', 'Key passphrase')}</span><input autoFocus disabled={busy} type="password" autoComplete="off" value={passphrase} onChange={event => setPassphrase(event.target.value)} className="w-full rounded-md border border-line bg-surf px-3 py-2 focus-visible:outline-2 focus-visible:outline-primary" /></label>}
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy} checked={trashOriginal} onChange={event => setTrashOriginal(event.target.checked)} /><span>{copy('导入后把原文件移到废纸篓', 'Move the original file to the Trash after import')}</span></label>
          {error && <p role="alert" className="text-sm text-down">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={clearDialog} className={buttonClass}>{copy('取消', 'Cancel')}</button><button type="submit" disabled={busy || (needsPassphrase && !passphrase)} className={buttonClass}>{busy ? copy('正在导入…', 'Importing…') : copy('导入私钥', 'Import key')}</button></div>
        </form>
      </div>
    </div>, document.body)}
  </div>;
}
