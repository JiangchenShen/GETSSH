import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppLockStore } from '../../../store/appLockStore';
import { useBackupRestartStore } from '../../../store/backupStore';
import { useSessionStore } from '../../../store/sessionStore';
import { useWorkspaceStore } from '../../../store/workspaceStore';
import { adoptWorkspaceProfiles } from '../../../lib/adoptWorkspaceProfiles';
import type { SshKey, StoreResult } from '../../../types/store';
import { storeFailureMessage } from '../../../utils/storeFeedback';
import { SettingsSection, settingButtonClass, settingDangerButtonClass, settingFieldClass } from '../SettingsControls';

type Scope = { generation: number; workspaceId: string };
type Panel = ({ scope: Scope } & (
  | { kind: 'import'; file: { fileId: string; fileName: string } | null; name: string; needsPassphrase: boolean; passphrase: string }
  | { kind: 'generate'; name: string }
  | { kind: 'delete'; key: SshKey }
  | { kind: 'generated'; key: SshKey }
)) | null;

export function SshKeysSection() {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const text = (cn: string, en: string) => zh ? cn : en;
  const workspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const workspaces = useWorkspaceStore(state => state.workspaces);
  const switching = useWorkspaceStore(state => state.isSwitching);
  const vaultLocked = useWorkspaceStore(state => state.isVaultLocked);
  const phase = useAppLockStore(state => state.state?.phase);
  const mustChange = useAppLockStore(state => state.state?.masterPasswordMustChange);
  const restartRequired = useBackupRestartStore(state => !!state.report);
  const sessions = useSessionStore(state => state.sessions);
  const profilesWorkspaceId = useSessionStore(state => state.profilesWorkspaceId);
  const [listing, setListing] = useState<{ scope: Scope; keys: SshKey[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const generation = useRef(0);
  const listRevision = useRef(0);
  const alive = useRef(false);
  const inFlight = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const available = phase === 'ready' && !mustChange && !switching && !vaultLocked && !restartRequired;
  const capture = (): Scope => ({ generation: generation.current, workspaceId: useWorkspaceStore.getState().activeWorkspaceId });
  const current = (scope: Scope) => {
    const workspace = useWorkspaceStore.getState();
    const app = useAppLockStore.getState().state;
    return alive.current && scope.generation === generation.current && scope.workspaceId === workspace.activeWorkspaceId
      && !workspace.isSwitching && !workspace.isVaultLocked && app?.phase === 'ready' && !app.masterPasswordMustChange
      && !useBackupRestartStore.getState().report;
  };
  const keys = listing && current(listing.scope) ? listing.keys : [];
  const profilesKnown = profilesWorkspaceId === workspaceId;
  const references = (id: string) => sessions.filter(profile => !profile.isDraft && !profile.isQuickConnect && profile.authType === 'key' && profile.keyId === id);

  const load = async () => {
    const scope = capture();
    if (!current(scope)) return;
    const revision = ++listRevision.current;
    setLoading(true);
    try {
      const result = await window.electronAPI.store.sshKeys.list({ workspaceId: scope.workspaceId });
      if (!current(scope) || revision !== listRevision.current) return;
      if (result.ok) { setListing({ scope, keys: result.keys }); setError(''); }
      else { setListing(null); failure(result); }
    } catch {
      if (current(scope) && revision === listRevision.current) { setListing(null); setError('request_failed'); }
    } finally {
      if (current(scope) && revision === listRevision.current) setLoading(false);
    }
  };

  useEffect(() => {
    alive.current = true;
    const invalidate = () => {
      generation.current++;
      listRevision.current++;
      inFlight.current = false;
      setListing(null); setLoading(false); setBusy(false); setPanel(null); setError(''); setNotice('');
      void load();
    };
    const stopWorkspace = useWorkspaceStore.subscribe((next, previous) => {
      if (next.activeWorkspaceId !== previous.activeWorkspaceId || next.isSwitching !== previous.isSwitching || next.isVaultLocked !== previous.isVaultLocked) invalidate();
    });
    const stopApp = useAppLockStore.subscribe((next, previous) => {
      if (next.state?.phase !== previous.state?.phase || next.state?.masterPasswordMustChange !== previous.state?.masterPasswordMustChange) invalidate();
    });
    const stopBackup = useBackupRestartStore.subscribe((next, previous) => { if (next.report !== previous.report) invalidate(); });
    invalidate();
    return () => { alive.current = false; generation.current++; stopWorkspace(); stopApp(); stopBackup(); };
  }, []);

  useEffect(() => {
    if (!panel) {
      if (busy) return;
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
      returnFocus.current = null;
      return;
    }
    const controls = () => Array.from(dialog.current?.querySelectorAll<HTMLElement>('input:not(:disabled), textarea:not(:disabled), button:not(:disabled)') ?? []);
    const focusFirst = () => (dialog.current?.querySelector<HTMLElement>('input[type="password"]:not(:disabled)') ?? controls()[0] ?? dialog.current)?.focus();
    focusFirst();
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
      if (event.key !== 'Tab') return;
      const items = controls(); const first = items[0]; const last = items.at(-1);
      if (!first) { event.preventDefault(); dialog.current?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    const focus = (event: FocusEvent) => { if (!dialog.current?.contains(event.target as Node)) focusFirst(); };
    document.addEventListener('keydown', keys, true); document.addEventListener('focusin', focus, true);
    return () => { document.removeEventListener('keydown', keys, true); document.removeEventListener('focusin', focus, true); };
  }, [panel?.kind, panel?.kind === 'import' && panel.needsPassphrase, busy]);

  const open = (next: NonNullable<Panel>) => {
    if (!current(next.scope) || busy || loading) return;
    if (!panel) returnFocus.current = document.activeElement as HTMLElement;
    setError(''); setNotice(''); setPanel(next);
  };
  const close = () => { if (!inFlight.current) { setPanel(null); setError(''); setNotice(''); } };
  const begin = (scope: Scope) => {
    if (!current(scope) || inFlight.current) return false;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    return true;
  };
  const finish = (scope: Scope) => { if (current(scope)) { inFlight.current = false; setBusy(false); } };
  const failure = (result: StoreResult) => {
    if (result.ok) return;
    if (result.error === 'locked' || result.error === 'unauthorized') {
      generation.current++; listRevision.current++; inFlight.current = false;
      setListing(null); setPanel(null); setBusy(false); setLoading(false);
    }
    setError(result.error);
  };
  const describe = () => {
    if (error === 'needs_password') return text('请输入私钥口令以继续。', 'Enter the private key passphrase to continue.');
    if (error === 'wrong_password') return text('口令不对，请重新输入。', 'Incorrect passphrase. Try again.');
    if (error === 'file_expired') return text('所选文件已过期，请重新选择文件。', 'The selected file has expired. Choose the file again.');
    if (error === 'unsupported_key') return text('支持 Ed25519、RSA、ECDSA 的 OpenSSH、PEM、PPK v2/v3 私钥，不支持 DSA。请转换为 OpenSSH 或改用 Ed25519；口令计算量过高时可用 ssh-keygen -p 重新设置口令。', 'Supported keys: Ed25519, RSA and ECDSA in OpenSSH, PEM or PPK v2/v3 format. DSA is not supported. Convert to OpenSSH or use Ed25519; for excessive passphrase work factors, reset the passphrase with ssh-keygen -p.');
    if (error === 'copy_failed') return text('公钥未能复制，请重试。', 'Could not copy the public key. Try again.');
    return storeFailureMessage(error, zh);
  };

  const chooseFile = async () => {
    const scope = panel?.scope ?? capture();
    if (!begin(scope)) return;
    if (!panel) returnFocus.current = document.activeElement as HTMLElement;
    try {
      const result = await window.electronAPI.store.sshKeys.chooseFile();
      if (!current(scope)) return;
      if (!result.ok) { if (result.error !== 'cancelled') failure(result); return; }
      setPanel({ kind: 'import', scope, file: result, name: result.fileName, needsPassphrase: result.encrypted, passphrase: '' });
    } catch { if (current(scope)) setError('request_failed'); }
    finally { finish(scope); }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!panel || panel.kind === 'generated') return;
    const scope = panel.scope;
    if (panel.kind === 'generate' && !panel.name.trim() || panel.kind === 'import' && (!panel.file || panel.needsPassphrase && !panel.passphrase)
      || panel.kind === 'delete' && !profilesKnown || !begin(scope)) return;
    try {
      const api = window.electronAPI.store.sshKeys;
      if (panel.kind === 'delete') {
        const result = await api.delete({ workspaceId: scope.workspaceId, id: panel.key.id });
        if (!current(scope)) return;
        if (!result.ok) { failure(result); return; }
        if (result.workspaceId !== scope.workspaceId || !adoptWorkspaceProfiles(result)) return;
        setPanel(null); setNotice('deleted');
      } else {
        const result = panel.kind === 'generate'
          ? await api.generate({ workspaceId: scope.workspaceId, name: panel.name.trim() })
          : await api.import({ workspaceId: scope.workspaceId, fileId: panel.file!.fileId, name: panel.name.trim() || undefined, passphrase: panel.passphrase || undefined });
        if (!current(scope)) return;
        if (!result.ok) {
          if (panel.kind === 'import' && (result.error === 'needs_password' || result.error === 'wrong_password')) {
            setPanel({ ...panel, needsPassphrase: true, passphrase: '' });
          } else if (panel.kind === 'import') {
            setPanel({ ...panel, file: null, needsPassphrase: false, passphrase: '' });
            if (result.error === 'not_found') { setError('file_expired'); return; }
          }
          failure(result); return;
        }
        if (panel.kind === 'generate') setPanel({ kind: 'generated', scope, key: result.key });
        else { setPanel(null); setNotice('imported'); }
      }
      await load();
    } catch {
      if (current(scope)) {
        if (panel.kind === 'import') setPanel({ ...panel, file: null, needsPassphrase: false, passphrase: '' });
        setError('request_failed');
      }
    }
    finally { finish(scope); }
  };

  const copyKey = async (key: SshKey) => {
    const scope = panel?.scope ?? listing?.scope;
    if (!scope || !current(scope)) return;
    try { await navigator.clipboard.writeText(key.publicKey); if (current(scope)) { setError(''); setNotice('copied'); } }
    catch { if (current(scope)) setError('copy_failed'); }
  };
  const feedback = <>{error && <p role="alert" className="text-xs leading-relaxed text-down">{describe()}</p>}{notice && <p role="status" className="text-xs text-ink-2">{notice === 'copied' ? text('公钥已复制。', 'Public key copied.') : notice === 'imported' ? text('私钥已导入。', 'Private key imported.') : text('私钥已删除。', 'Private key deleted.')}</p>}</>;
  const disabled = !available || busy || loading || error === 'locked' || error === 'unauthorized';
  const panelTitle = panel?.kind === 'generate' ? text('生成私钥', 'Generate private key') : panel?.kind === 'delete' ? text('删除私钥', 'Delete private key') : panel?.kind === 'generated' ? text('私钥已生成', 'Private key generated') : text('导入私钥', 'Import private key');

  return <SettingsSection title={text('私钥 · 当前工作区', 'Private keys · Current workspace')} description={`${workspaces.find(workspace => workspace.id === workspaceId)?.name || workspaceId} · ${text('私钥和口令加密保存在本工作区，随加密备份导出。', 'Keys and their passphrases are encrypted in this workspace and included in encrypted backups.')}`}>
    <div className="flex flex-wrap gap-2 px-1 py-3">
      <button type="button" disabled={disabled} onClick={() => void chooseFile()} className={settingButtonClass}>{text('导入私钥', 'Import private key')}</button>
      <button type="button" disabled={disabled} onClick={() => open({ kind: 'generate', scope: capture(), name: '' })} className={settingButtonClass}>{text('生成私钥', 'Generate private key')}</button>
      <button type="button" disabled={!available || busy || loading} onClick={() => void load()} className={settingButtonClass}>{text('刷新列表', 'Refresh keys')}</button>
    </div>
    {!available && <p className="px-1 pb-3 text-xs text-ink-3">{restartRequired ? text('备份已导入，请先重启应用。', 'Backup imported. Restart the app first.') : text('请先解锁应用和当前工作区。', 'Unlock the app and current workspace first.')}</p>}
    {!panel && <div className="space-y-2 px-1 pb-3">{feedback}</div>}
    {available && loading && <p role="status" className="px-1 pb-3 text-xs text-ink-3">{text('正在加载私钥…', 'Loading private keys…')}</p>}
    {available && listing && !loading && !keys.length && <p className="px-1 pb-3 text-xs text-ink-3">{text('当前工作区还没有保存的私钥。', 'No private keys saved in this workspace yet.')}</p>}
    <ul className="divide-y divide-line-soft">
      {keys.map(key => <li key={key.id} className="flex flex-wrap items-center justify-between gap-3 px-1 py-3">
        <div className="min-w-0 flex-1 basis-52">
          <div className="break-words text-sm font-medium text-ink">{key.name} <span className="font-mono text-xs font-normal text-ink-3">{key.algorithm}</span></div>
          <p className="mt-1 truncate font-mono text-xs text-ink-2" title={key.fingerprint}>{key.fingerprint}</p>
          <p className="mt-1 text-xs text-ink-3">{text('创建于', 'Created')} {key.created_at > 0 && Number.isFinite(new Date(key.created_at).getTime()) ? new Date(key.created_at).toLocaleString(i18n.language) : '—'} · {profilesKnown ? text(`${references(key.id).length} 台服务器在用`, `Used by ${references(key.id).length} ${references(key.id).length === 1 ? 'server' : 'servers'}`) : text('使用情况尚未加载', 'References not loaded')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={disabled} onClick={() => void copyKey(key)} className={settingButtonClass} aria-label={text(`复制 ${key.name} 的公钥`, `Copy public key for ${key.name}`)}>{text('复制公钥', 'Copy public key')}</button>
          <button type="button" disabled={disabled || !profilesKnown} onClick={() => open({ kind: 'delete', scope: capture(), key })} className={settingDangerButtonClass} aria-label={text(`删除私钥 ${key.name}`, `Delete private key ${key.name}`)}>{text('删除', 'Delete')}</button>
        </div>
      </li>)}
    </ul>

    {panel && available && <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4">
      <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-panel p-5 shadow-xl">
        <h3 id={titleId} className="text-base font-semibold text-ink">{panelTitle}</h3>
        <form onSubmit={submit} className="mt-4 space-y-4" aria-busy={busy}>
          {(panel.kind === 'import' || panel.kind === 'generate') && <label className="block space-y-1.5 text-sm text-ink-2"><span>{text('名称', 'Name')}</span><input value={panel.name} onChange={event => setPanel({ ...panel, name: event.target.value })} maxLength={128} required={panel.kind === 'generate'} disabled={busy} className={settingFieldClass} /></label>}
          {panel.kind === 'import' && <>
            <p className="break-words text-xs text-ink-3">{panel.file?.fileName}</p>
            {panel.file && panel.needsPassphrase && <label className="block space-y-1.5 text-sm text-ink-2"><span>{text('私钥口令', 'Private key passphrase')}</span><input type="password" value={panel.passphrase} onChange={event => setPanel({ ...panel, passphrase: event.target.value })} autoComplete="off" disabled={busy} required className={settingFieldClass} /></label>}
            {!panel.file && <button type="button" onClick={() => void chooseFile()} disabled={busy} className={settingButtonClass}>{text('重新选择文件', 'Choose file again')}</button>}
          </>}
          {panel.kind === 'delete' && <div className="space-y-2 text-sm text-ink-2"><p>{text(`删除“${panel.key.name}”后，以下服务器需要重新选择私钥：`, `After deleting “${panel.key.name}”, these servers need another private key:`)}</p><ul className="list-inside list-disc break-words">{references(panel.key.id).map((profile, index) => <li key={profile.id || index}>{profile.alias || profile.host}</li>)}</ul>{!references(panel.key.id).length && <p>{text('没有已保存的服务器在用这个私钥。', 'No saved servers use this key.')}</p>}</div>}
          {panel.kind === 'generated' && <><p className="text-sm leading-relaxed text-ink-2">{text('把下面这一行公钥加到服务器的 ~/.ssh/authorized_keys 里。', 'Add this public key line to ~/.ssh/authorized_keys on the server.')}</p><label className="block space-y-1.5 text-sm text-ink-2"><span>{text('公钥', 'Public key')}</span><textarea readOnly value={panel.key.publicKey} rows={3} className={`${settingFieldClass} resize-y break-all font-mono`} /></label><button type="button" onClick={() => void copyKey(panel.key)} className={settingButtonClass}>{text('复制公钥', 'Copy public key')}</button></>}
          {feedback}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={close} disabled={busy} className={settingButtonClass}>{panel.kind === 'generated' ? text('完成', 'Done') : text('取消', 'Cancel')}</button>
            {panel.kind !== 'generated' && <button type="submit" disabled={busy || panel.kind === 'generate' && !panel.name.trim() || panel.kind === 'import' && (!panel.file || panel.needsPassphrase && !panel.passphrase) || panel.kind === 'delete' && !profilesKnown} className={panel.kind === 'delete' ? settingDangerButtonClass : settingButtonClass}>{busy ? text('正在处理…', 'Working…') : panel.kind === 'generate' ? text('生成', 'Generate') : panel.kind === 'delete' ? text('确认删除', 'Confirm delete') : text('导入', 'Import')}</button>}
          </div>
        </form>
      </div>
    </div>}
  </SettingsSection>;
}
