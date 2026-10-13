import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppLockStore } from '../../../store/appLockStore';
import { useBackupRestartStore } from '../../../store/backupStore';
import { useWorkspaceStore } from '../../../store/workspaceStore';
import type { BundleInfo, ExportCandidate, StoreResult } from '../../../types/store';
import { storeFailureMessage } from '../../../utils/storeFeedback';
import { SettingsRow, SettingsSection, settingButtonClass, settingDangerButtonClass, settingFieldClass } from '../../settings/SettingsControls';

type ExportStep = 'choose' | 'unlock' | 'password';
type ImportFile = { fileId: string; fileName: string };

export function EncryptedBackupSection({ onRestartRequired }: { onRestartRequired?: () => void }) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const copy = (chinese: string, english: string) => zh ? chinese : english;
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const phase = useAppLockStore(state => state.state?.phase);
  const workspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const vaultLocked = useWorkspaceStore(state => state.isVaultLocked);
  const locked = phase === 'locked' || vaultLocked;
  const confirmation = useRef<HTMLDivElement>(null);
  const importTrigger = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [step, setStep] = useState<ExportStep | null>(null);
  const [candidates, setCandidates] = useState<ExportCandidate[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const [workspacePassword, setWorkspacePassword] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [file, setFile] = useState<ImportFile | null>(null);
  const [info, setInfo] = useState<BundleInfo | null>(null);
  const [importPassword, setImportPassword] = useState('');
  const report = useBackupRestartStore(state => state.report);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    generation.current += 1;
    setStep(null); setFailed([]); setWorkspacePassword(''); setPassword(''); setRepeat('');
    setFile(null); setInfo(null); setImportPassword(''); setError(''); setNotice('');
  }, [phase, vaultLocked, workspaceId]);
  useEffect(() => {
    if (!file || !info) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = confirmation.current;
    const buttons = () => [...(dialog?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    const focusInside = () => { const first = buttons()[0]; if (first) first.focus(); else dialog?.focus(); };
    focusInside();
    const trap = (event: KeyboardEvent) => {
      // Pause underlying page shortcuts too, including while a native import request is busy.
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!running.current) { setFile(null); setInfo(null); setImportPassword(''); setError(''); }
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = buttons();
      event.preventDefault();
      if (!controls.length) { dialog?.focus(); return; }
      const index = controls.indexOf(document.activeElement as HTMLButtonElement);
      controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
    };
    const containFocus = (event: FocusEvent) => { if (!dialog?.contains(event.target as Node)) focusInside(); };
    document.addEventListener('keydown', trap, true);
    document.addEventListener('focusin', containFocus, true);
    return () => {
      document.removeEventListener('keydown', trap, true);
      document.removeEventListener('focusin', containFocus, true);
      if (previous?.isConnected) previous.focus(); else importTrigger.current?.focus();
    };
  }, [file, info]);
  useEffect(() => { if (file && info && busy) confirmation.current?.focus(); }, [file, info, busy]);

  const handleFailure = (result: { error: string; retryAfterMs?: number }) => {
    setError(storeFailureMessage(result.error, zh, result.retryAfterMs));
  };
  const run = async (action: (isCurrent: () => boolean) => Promise<void>) => {
    if (running.current || report || locked) return;
    const epoch = generation.current;
    const isCurrent = () => mounted.current && generation.current === epoch && useAppLockStore.getState().state?.phase !== 'locked'
      && useWorkspaceStore.getState().activeWorkspaceId === workspaceId && !useWorkspaceStore.getState().isVaultLocked;
    running.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try { await action(isCurrent); }
    catch { if (isCurrent()) setError(copy('操作未完成，请重试', 'The operation could not be completed. Try again')); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  };
  const backup = () => {
    const api = window.electronAPI?.store?.backup;
    if (!api) throw new Error('backup unavailable');
    return api;
  };
  const clearExport = () => {
    setStep(null); setFailed([]); setWorkspacePassword(''); setPassword(''); setRepeat(''); setError('');
  };
  const clearImport = () => {
    setFile(null); setInfo(null); setImportPassword(''); setError('');
  };

  const chooseWorkspaces = () => run(async isCurrent => {
    const result = await backup().candidates();
    if (!isCurrent()) return;
    if (!result.ok) { handleFailure(result); return; }
    clearImport();
    clearExport();
    setCandidates(result.candidates);
    setSelected(result.candidates.map(item => item.id));
    setStep('choose');
  });
  const unlockSelection = () => run(async isCurrent => {
    const result = await backup().unlockForExport({ workspaceIds: selected });
    if (!isCurrent()) return;
    if (!result.ok) { handleFailure(result); return; }
    // A cancelled system prompt is quiet; its workspaces can still be opened with passwords.
    const blocking = result.failed.find(item => !['needs_password', 'wrong_password', 'cancelled', 'unavailable'].includes(item.code));
    if (blocking) { handleFailure({ error: blocking.code }); return; }
    const passwordFailures = result.failed.filter(item => candidates.find(candidate => candidate.id === item.id)?.unlockWith.includes('password'));
    setFailed(passwordFailures.map(item => item.id));
    if (passwordFailures.length) setStep('unlock');
    else if (!result.failed.length) setStep('password');
  });
  const unlockWorkspace = () => run(async isCurrent => {
    const workspaceId = failed[0];
    if (!workspaceId) return;
    const result = await window.electronAPI.workspace.unlock({ workspaceId, method: 'password', password: workspacePassword });
    if (!isCurrent()) return;
    setWorkspacePassword('');
    if (!result.ok) { handleFailure(result); return; }
    const remaining = failed.slice(1);
    setFailed(remaining);
    if (!remaining.length) setStep('password');
  });
  const exportBackup = () => {
    if ([...password.normalize('NFC')].length < 12) { setError(copy('备份密码至少 12 个字符', 'The backup password needs at least 12 characters')); return; }
    if (password !== repeat) { setError(copy('两次输入的密码不一致', 'The passwords do not match')); return; }
    return run(async isCurrent => {
      try {
        const result = await backup().export({ workspaceIds: selected, password });
        if (!isCurrent()) return;
        if (!result.ok) { handleFailure(result); return; }
        clearExport();
        setNotice(copy(`备份已保存至：${result.report.path}`, `Backup saved to: ${result.report.path}`));
      } finally {
        if (isCurrent()) { setPassword(''); setRepeat(''); }
      }
    });
  };
  const chooseImport = () => run(async isCurrent => {
    const result = await backup().chooseImportFile();
    if (!isCurrent()) return;
    if (!result.ok) { handleFailure(result); return; }
    clearExport(); clearImport();
    setFile({ fileId: result.fileId, fileName: result.fileName });
  });
  const inspectBackup = () => run(async isCurrent => {
    if (!file) return;
    const result = await backup().inspect({ fileId: file.fileId, password: importPassword });
    if (!isCurrent()) return;
    if (!result.ok) { setImportPassword(''); handleFailure(result); return; }
    setInfo(result.info);
  });
  const importBackup = () => run(async isCurrent => {
    if (!file || !info) return;
    const result = await backup().import({ fileId: file.fileId, password: importPassword });
    // A completed replacement must still require a restart if the user changed pages or locked
    // the app while the request was in flight. No entered password is retained here.
    if (result.ok) useBackupRestartStore.setState({ report: result.report });
    if (!isCurrent()) return;
    setImportPassword('');
    if (!result.ok) { setInfo(null); handleFailure(result); return; }
    clearImport();
    onRestartRequired?.();
  });
  const relaunch = async () => {
    if (running.current) return;
    running.current = true; setBusy(true); setError('');
    try {
      const result: StoreResult = await backup().relaunch();
      if (mounted.current && !result.ok) handleFailure(result);
    } catch { if (mounted.current) setError(copy('无法重启，请关闭并重新打开 GETSSH', 'Cannot restart. Close and reopen GETSSH')); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  };

  const actions = (submitLabel: string, onSubmit: () => void, disabled = false) => <div className="flex flex-wrap gap-2">
    <button type="button" disabled={busy} onClick={step ? clearExport : clearImport} className={settingButtonClass}>{copy('取消', 'Cancel')}</button>
    <button type="button" disabled={busy || disabled} onClick={onSubmit} className={settingButtonClass}>{busy ? copy('请稍候…', 'Working…') : submitLabel}</button>
  </div>;
  const needsRestart = !!report;

  return <SettingsSection title={copy('加密备份', 'Encrypted backups')} description={copy('选择要备份的工作区，用备份密码在另一台电脑上恢复数据。请妥善保存备份文件和密码。', 'Choose workspaces to back up and use the backup password to restore them on another computer. Keep the file and password securely.')}>
    {error && <p role="alert" className="py-3 text-sm text-down">{error}</p>}
    {notice && <p role="status" className="break-all py-3 text-sm text-ink">{notice}</p>}
    {report && <SettingsRow label={copy('需要重启', 'Restart required')} description={copy('备份已导入。重启后才能继续使用数据。', 'The backup has been imported. Restart to continue using the data.')} stacked>
      {report.backupPath && <p className="mb-3 break-all text-xs text-ink-2">{copy(`导入前的数据已保留在：${report.backupPath}`, `The previous data is kept at: ${report.backupPath}`)}</p>}
      <button type="button" onClick={() => void relaunch()} disabled={busy} className={settingButtonClass}>{copy('重启 GETSSH', 'Restart GETSSH')}</button>
    </SettingsRow>}
    <SettingsRow label={copy('导出备份', 'Export backup')} description={copy('备份包含所选工作区和应用设置。备份密码会保护其中所有工作区。', 'Includes the chosen workspaces and app settings. The backup password protects every workspace in the file.')}>
      <button type="button" disabled={busy || needsRestart || locked} onClick={() => void chooseWorkspaces()} className={settingButtonClass}>{copy('选择工作区', 'Choose workspaces')}</button>
    </SettingsRow>
    {step === 'choose' && <SettingsRow label={copy('选择要导出的工作区', 'Choose workspaces to export')} stacked>
      <fieldset disabled={busy} className="space-y-3">
        {candidates.map(item => <label key={item.id} className="flex gap-3 border-b border-line-soft py-2 last:border-0">
          <input type="checkbox" className="mt-1" checked={selected.includes(item.id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))} />
          <span className="min-w-0"><span className="block text-sm text-ink">{item.name}{item.is_main ? copy(' · 主工作区', ' · Main workspace') : ''}</span>
            <span className="block text-xs text-ink-2">{item.state === 'open' ? copy('已解锁', 'Unlocked') : copy('已锁定', 'Locked')}{copy(` · ${item.profileCount} 条配置`, ` · ${item.profileCount} profiles`)}{item.state === 'locked' ? copy('（锁定时不读取数量）', ' (counts are not read while locked)') : ''}</span>
            <span className="block text-xs text-ink-3">{item.unlockWith.length ? item.unlockWith.map(method => method === 'presence' ? 'Touch ID / Windows Hello' : copy('工作区密码', 'Workspace password')).join(' / ') : copy('无需额外验证', 'No extra verification needed')}</span>
          </span>
        </label>)}
        {!candidates.length && <p className="text-xs text-ink-2">{copy('没有可导出的工作区', 'No workspaces are available to export')}</p>}
        {actions(copy('验证并继续', 'Verify and continue'), () => void unlockSelection(), !selected.length)}
      </fieldset>
    </SettingsRow>}
    {step === 'unlock' && <SettingsRow label={copy(`解锁工作区：${candidates.find(item => item.id === failed[0])?.name ?? ''}`, `Unlock workspace: ${candidates.find(item => item.id === failed[0])?.name ?? ''}`)} description={copy('此工作区需要输入它的单独密码才能备份。', 'Enter this workspace’s own password to include it in the backup.')} stacked>
      <form className="max-w-md space-y-3" onSubmit={event => { event.preventDefault(); void unlockWorkspace(); }}>
        <label className="block text-xs text-ink-2">{copy('工作区密码', 'Workspace password')}<input autoFocus disabled={busy} type="password" autoComplete="current-password" value={workspacePassword} onChange={event => setWorkspacePassword(event.target.value)} className={`mt-1 ${settingFieldClass}`} /></label>
        {actions(copy('解锁并继续', 'Unlock and continue'), () => void unlockWorkspace(), !workspacePassword)}
      </form>
    </SettingsRow>}
    {step === 'password' && <SettingsRow label={copy('设置备份密码', 'Set a backup password')} description={copy('至少 12 个字符。这个密码用于打开备份文件，请保存到密码管理器。', 'At least 12 characters. This password opens the backup file; keep it in a password manager.')} stacked>
      <form className="max-w-md space-y-3" onSubmit={event => { event.preventDefault(); void exportBackup(); }}>
        <label className="block text-xs text-ink-2">{copy('备份密码', 'Backup password')}<input autoFocus disabled={busy} type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} className={`mt-1 ${settingFieldClass}`} /></label>
        <label className="block text-xs text-ink-2">{copy('再次输入备份密码', 'Repeat the backup password')}<input disabled={busy} type="password" autoComplete="new-password" value={repeat} onChange={event => setRepeat(event.target.value)} className={`mt-1 ${settingFieldClass}`} /></label>
        {actions(copy('保存备份', 'Save backup'), () => void exportBackup())}
      </form>
    </SettingsRow>}
    <SettingsRow label={copy('导入备份', 'Import backup')} description={copy('导入会替换现在的全部数据。确认前可以查看备份内容。导入前的数据会整份保留。', 'Import replaces all current data. Review the backup before confirming. A complete copy of the previous data is kept.')}>
      <button ref={importTrigger} type="button" disabled={busy || needsRestart || locked} onClick={() => void chooseImport()} className={settingButtonClass}>{copy('选择备份文件', 'Choose backup file')}</button>
    </SettingsRow>
    {file && !info && <SettingsRow label={file.fileName} description={copy('输入备份密码，查看文件中的工作区。', 'Enter the backup password to review its workspaces.')} stacked>
      <form className="max-w-md space-y-3" onSubmit={event => { event.preventDefault(); void inspectBackup(); }}>
        <label className="block text-xs text-ink-2">{copy('备份密码', 'Backup password')}<input autoFocus type="password" disabled={busy} value={importPassword} autoComplete="current-password" onChange={event => setImportPassword(event.target.value)} className={`mt-1 ${settingFieldClass}`} /></label>
        {actions(copy('查看备份', 'Review backup'), () => void inspectBackup(), !importPassword)}
      </form>
    </SettingsRow>}
    {file && info && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4" role="presentation">
      <div ref={confirmation} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby="backup-import-title" aria-describedby="backup-import-warning" className="max-h-[85vh] w-full max-w-md overflow-auto rounded-xl border border-line bg-panel p-5 text-ink shadow-2xl">
        <h3 id="backup-import-title" className="text-base font-semibold">{copy('确认导入备份', 'Confirm backup import')}</h3>
        <dl className="mt-3 space-y-1 break-all text-xs text-ink-2">
          <div><dt className="inline">{copy('文件：', 'File: ')}</dt><dd className="inline">{file.fileName}</dd></div>
          <div><dt className="inline">{copy('备份时间：', 'Created: ')}</dt><dd className="inline">{new Date(info.createdAt).toLocaleString(i18n.language)}</dd></div>
          <div><dt className="inline">{copy('应用版本：', 'App version: ')}</dt><dd className="inline">{info.appVersion}</dd></div>
        </dl>
        <ul className="my-3 space-y-1 text-sm">{info.workspaces.map(item => <li key={item.id}>{item.name}{item.hasPassword ? copy(' · 有工作区密码', ' · Has a workspace password') : ''}</li>)}</ul>
        <p id="backup-import-warning" className="text-sm text-down">{copy('会替换现在的全部数据。导入前的数据会保留在备份目录，导入完成后需要重启。', 'This replaces all current data. The previous data is kept in a backup directory. Restart is required afterwards.')}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-line pt-4">
          <button type="button" autoFocus disabled={busy} onClick={clearImport} className={settingButtonClass}>{copy('取消', 'Cancel')}</button>
          <button type="button" disabled={busy} onClick={() => void importBackup()} className={settingDangerButtonClass}>{busy ? copy('正在导入…', 'Importing…') : copy('替换全部数据并导入', 'Replace all data and import')}</button>
        </div>
      </div>
    </div>}
  </SettingsSection>;
}
