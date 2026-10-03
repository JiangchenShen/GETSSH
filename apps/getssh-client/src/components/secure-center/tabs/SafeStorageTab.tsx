import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../../store/appStore';
import { useCryptoStore } from '../../../store/cryptoStore';
import { useWorkspaceStore } from '../../../store/workspaceStore';
import type { KeystoreResult, SecurityStatus } from '../../../types/ipc';
import { SettingsRow, SettingsSection, settingButtonClass, settingDangerButtonClass, settingFieldClass } from '../../settings/SettingsControls';

/**
 * Master password, recovery code, Touch ID / Windows Hello and the active workspace's own
 * password. Everything is checked and stored by the main process (Rust keystore); this tab only
 * collects input. Where the OS can verify the user it does so first; the current password is
 * asked for only when the main process reports `current_password_required`.
 */

type Form =
  | { kind: 'none' }
  | { kind: 'set-master' | 'change-master' | 'set-workspace' | 'change-workspace'; next: string; confirm: string; current: string; needsCurrent: boolean }
  | { kind: 'remove-master' | 'remove-workspace' | 'new-recovery'; current: string; needsCurrent: boolean };

export interface SafeStorageTabProps {
  section?: 'app' | 'vault' | 'both';
}

// Must match getssh-keystore: the master password alone protects everything, including copies
// of the data taken off this computer.
const MIN_MASTER_PASSWORD = 12;
const MIN_WORKSPACE_PASSWORD = 8;
const minPasswordFor = (kind: string) => (kind.endsWith('-master') ? MIN_MASTER_PASSWORD : MIN_WORKSPACE_PASSWORD);

export const SafeStorageTab: React.FC<SafeStorageTabProps> = ({ section = 'both' }) => {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const isMac = useAppStore(state => state.isMac);
  const addToast = useAppStore(state => state.addToast);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const workspace = useWorkspaceStore(state => state.workspaces.find(item => item.id === state.activeWorkspaceId));
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [form, setForm] = useState<Form>({ kind: 'none' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [recoverySaved, setRecoverySaved] = useState(false);

  const presenceName = isMac ? 'Touch ID' : 'Windows Hello';
  const refresh = useCallback(async () => {
    setStatus(await window.electronAPI.security.status());
  }, []);
  useEffect(() => { void refresh(); }, [refresh, activeWorkspaceId]);

  const workspaceScope = status?.scopes.find(scope => scope.workspaceId === activeWorkspaceId);
  const appScope = status?.scopes.find(scope => scope.id === 'app');
  const isMainWorkspace = !!workspace?.isMain;

  const describe = (failure: string, retryAfterMs?: number) => {
    switch (failure) {
      case 'wrong_password':
      case 'verification_failed': return zh ? '身份验证未通过，没有做任何修改' : 'Verification failed; nothing was changed';
      case 'current_password_required': return zh ? '请输入当前密码' : 'Enter the current password';
      case 'rate_limited': return zh ? `尝试次数过多，请 ${Math.ceil((retryAfterMs ?? 1000) / 1000)} 秒后再试` : `Too many attempts. Try again in ${Math.ceil((retryAfterMs ?? 1000) / 1000)} s`;
      case 'cancelled': return zh ? '已取消' : 'Cancelled';
      case 'main_workspace_needs_master_password': return zh ? '主工作区不能单独设置密码，请先设置主密码' : 'The main workspace cannot have its own password; set a master password instead';
      case 'locked': return zh ? '请先解锁这个工作区' : 'Unlock this workspace first';
      case 'invalid_argument': return zh ? '输入无效' : 'Invalid input';
      default: return zh ? `操作失败（${failure}）` : `Failed (${failure})`;
    }
  };

  const open = (kind: Form['kind']) => {
    setError('');
    if (kind === 'none') setForm({ kind: 'none' });
    else if (kind === 'remove-master' || kind === 'remove-workspace' || kind === 'new-recovery') setForm({ kind, current: '', needsCurrent: false });
    else setForm({ kind, next: '', confirm: '', current: '', needsCurrent: false });
  };

  /** Runs an action; on `current_password_required` shows the current-password field and stops. */
  const run = async <T extends object>(action: (current?: string) => Promise<KeystoreResult<T>>): Promise<(KeystoreResult<T> & { ok: true }) | null> => {
    setBusy(true);
    setError('');
    try {
      const current = form.kind !== 'none' && form.current ? form.current : undefined;
      const result = await action(current);
      if (result.ok) return result as KeystoreResult<T> & { ok: true };
      if (result.error === 'current_password_required' && form.kind !== 'none') setForm({ ...form, needsCurrent: true } as Form);
      setError(describe(result.error, result.retryAfterMs));
      return null;
    } finally {
      setBusy(false);
    }
  };

  /** With a master password the store needs it typed (no Touch ID route): `password` is the one just set. */
  const createRecovery = async (password?: string) => {
    const result = await run(current => window.electronAPI.security.setupRecovery({ currentPassword: password ?? current }));
    if (result) {
      setRecoveryCode(result.code);
      setRecoverySaved(false);
      setForm({ kind: 'none' });
      await refresh();
    }
  };

  const submit = async () => {
    if (form.kind === 'none') return;
    if ('next' in form) {
      const min = minPasswordFor(form.kind);
      if ([...form.next].length < min) { setError(zh ? `密码至少 ${min} 个字符` : `At least ${min} characters`); return; }
      if (form.next !== form.confirm) { setError(zh ? '两次输入的密码不一致' : 'The passwords do not match'); return; }
    }
    switch (form.kind) {
      case 'set-master':
      case 'change-master': {
        const result = await run(current => window.electronAPI.security.setMasterPassword({ password: form.next, currentPassword: current }));
        if (!result) return;
        setForm({ kind: 'none' });
        await refresh();
        addToast(zh ? '主密码已更新' : 'Master password updated', 'success');
        // A new master password discards the old recovery code: make a new one right away.
        if (result.recoveryReset) await createRecovery(form.next);
        return;
      }
      case 'remove-master': {
        if (!(await run(current => window.electronAPI.security.removeMasterPassword({ currentPassword: current })))) return;
        break;
      }
      case 'set-workspace':
      case 'change-workspace': {
        if (!(await run(current => window.electronAPI.workspace.setPassword({ workspaceId: activeWorkspaceId, password: form.next, currentPassword: current })))) return;
        useCryptoStore.getState().setWorkspaceUnprotected(false);
        break;
      }
      case 'remove-workspace': {
        if (!(await run(current => window.electronAPI.workspace.removePassword({ workspaceId: activeWorkspaceId, currentPassword: current })))) return;
        useCryptoStore.getState().setWorkspaceUnprotected(!status?.appProtected);
        break;
      }
      case 'new-recovery':
        await createRecovery();
        return;
    }
    setForm({ kind: 'none' });
    await refresh();
    await useWorkspaceStore.getState().initWorkspaces();
    addToast(zh ? '已更新' : 'Updated', 'success');
  };

  const togglePresence = async (workspaceId: string | null, enabled: boolean) => {
    const result = await run(() => window.electronAPI.security.setPresence({ workspaceId, enabled }));
    if (result) {
      await refresh();
      await useWorkspaceStore.getState().initWorkspaces();
    }
  };

  const formRows = form.kind !== 'none' && (
    <SettingsRow label={({
      'set-master': zh ? '设置主密码' : 'Set master password',
      'change-master': zh ? '修改主密码' : 'Change master password',
      'remove-master': zh ? '移除主密码' : 'Remove master password',
      'set-workspace': zh ? '设置工作区密码' : 'Set workspace password',
      'change-workspace': zh ? '修改工作区密码' : 'Change workspace password',
      'remove-workspace': zh ? '移除工作区密码' : 'Remove workspace password',
      'new-recovery': zh ? '生成新的恢复码' : 'New recovery code',
    } as const)[form.kind]} stacked>
      <form className="max-w-md space-y-3" onSubmit={event => { event.preventDefault(); void submit(); }}>
        {form.needsCurrent && <label className="block text-xs text-ink-2">{zh ? '当前密码' : 'Current password'}<input autoFocus type="password" value={form.current} onChange={event => setForm({ ...form, current: event.target.value })} className={`mt-1 ${settingFieldClass}`} /></label>}
        {'next' in form && <>
          <label className="block text-xs text-ink-2">{zh ? `新密码（至少 ${minPasswordFor(form.kind)} 个字符）` : `New password (at least ${minPasswordFor(form.kind)} characters)`}<input autoFocus={!form.needsCurrent} type="password" value={form.next} onChange={event => setForm({ ...form, next: event.target.value })} className={`mt-1 ${settingFieldClass}`} /></label>
          <label className="block text-xs text-ink-2">{zh ? '再输入一次' : 'Repeat it'}<input type="password" value={form.confirm} onChange={event => setForm({ ...form, confirm: event.target.value })} className={`mt-1 ${settingFieldClass}`} /></label>
        </>}
        {form.kind === 'remove-master' && <p className="text-xs text-down">{zh ? '移除后，打开 GETSSH 不再需要密码；任何使用这台电脑的人都能打开没有单独密码的工作区。数据在磁盘上仍然加密。' : 'Afterwards GETSSH opens without a password and anyone using this computer can open workspaces that have no password of their own. Data on disk stays encrypted.'}</p>}
        {form.kind === 'remove-workspace' && <p className="text-xs text-down">{status?.appProtected ? (zh ? '移除后这个工作区仍受主密码保护。' : 'The workspace stays protected by the master password.') : (zh ? '移除后，任何使用这台电脑的人都能打开这个工作区。' : 'Afterwards anyone using this computer can open this workspace.')}</p>}
        {form.kind === 'new-recovery' && status?.recoveryConfigured && <p className="text-xs text-ink-3">{zh ? '旧的恢复码会立即失效。' : 'The old recovery code stops working right away.'}</p>}
        {error && <p role="alert" className="text-xs text-down">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={() => open('none')} className={settingButtonClass}>{zh ? '取消' : 'Cancel'}</button>
          <button type="submit" disabled={busy} className={form.kind.startsWith('remove') ? settingDangerButtonClass : settingButtonClass}>{busy ? (zh ? '请稍候…' : 'Working…') : (zh ? '确认' : 'Confirm')}</button>
        </div>
      </form>
    </SettingsRow>
  );

  return <div className="space-y-7">
    {recoveryCode && <SettingsSection title={zh ? '你的恢复码' : 'Your recovery code'} description={zh ? '只显示这一次。请抄写下来或保存到密码管理器，放在这台电脑以外的地方。忘记主密码或换电脑时，用它找回数据。' : 'Shown only this once. Write it down or store it in a password manager, somewhere other than this computer. Use it if you forget the master password or move to another computer.'}>
      <SettingsRow label={zh ? '恢复码' : 'Recovery code'} stacked>
        <div className="max-w-md space-y-3">
          <code className="block select-all rounded-md border border-line bg-surf-2 px-3 py-3 text-center font-mono text-base tracking-wider text-ink">{recoveryCode}</code>
          <label className="flex items-center gap-2 text-xs text-ink-2"><input type="checkbox" checked={recoverySaved} onChange={event => setRecoverySaved(event.target.checked)} />{zh ? '我已经妥善保存' : 'I have saved it'}</label>
          <button type="button" disabled={!recoverySaved} onClick={() => setRecoveryCode(null)} className={settingButtonClass}>{zh ? '完成' : 'Done'}</button>
        </div>
      </SettingsRow>
    </SettingsSection>}

    {(section === 'app' || section === 'both') && <SettingsSection title={zh ? '主密码' : 'Master password'} description={status?.appProtected
      ? (zh ? '启动 GETSSH、空闲 5 分钟、锁屏或休眠后，需要主密码或系统验证才能打开。一次解锁即可打开所有工作区。' : 'Needed after launch, 5 idle minutes, a locked screen or sleep. One unlock opens every workspace.')
      : (zh ? '未设置：打开 GETSSH 不需要密码，任何使用这台电脑的人都能打开没有单独密码的工作区。数据在磁盘上始终加密，复制到别的电脑也打不开。' : 'Not set: GETSSH opens without a password, and anyone using this computer can open workspaces without a password of their own. Data on disk is always encrypted and does not open on another computer.')}>
      <SettingsRow label={status?.appProtected ? (zh ? '已设置' : 'On') : (zh ? '未设置' : 'Off')}>
        <div className="flex flex-wrap gap-2">{status?.appProtected
          ? <><button type="button" onClick={() => open('change-master')} className={settingButtonClass}>{zh ? '修改' : 'Change'}</button><button type="button" onClick={() => open('remove-master')} className={settingDangerButtonClass}>{zh ? '移除' : 'Remove'}</button></>
          : <button type="button" onClick={() => open('set-master')} className={settingButtonClass}>{zh ? '设置主密码' : 'Set master password'}</button>}</div>
      </SettingsRow>
      {status?.appProtected && status.presenceSupported && <SettingsRow label={presenceName} description={zh ? `用 ${presenceName} 代替输入主密码。` : `Use ${presenceName} instead of typing the master password.`}>
        <button type="button" disabled={busy} onClick={() => void togglePresence(null, !appScope?.presence)} className={settingButtonClass}>{appScope?.presence ? (zh ? '关闭' : 'Turn off') : (zh ? '开启' : 'Turn on')}</button>
      </SettingsRow>}
      <SettingsRow label={zh ? '恢复码' : 'Recovery code'} description={status?.recoveryConfigured
        ? (status.appProtected ? (zh ? '已创建，可以打开所有数据。' : 'Created; it opens all data.') : (zh ? '已创建。未设置主密码时，它不覆盖有单独密码的工作区。' : 'Created. Without a master password it does not cover workspaces that have their own password.'))
        : (zh ? '尚未创建。没有恢复码时，换电脑或忘记密码将无法找回数据。' : 'Not created. Without one, data cannot be recovered on another computer or after a forgotten password.')}>
        <button type="button" onClick={() => status?.recoveryConfigured || status?.appProtected ? open('new-recovery') : void createRecovery()} className={settingButtonClass}>{status?.recoveryConfigured ? (zh ? '生成新的' : 'Replace') : (zh ? '创建' : 'Create')}</button>
      </SettingsRow>
      {status?.deviceBackend && <SettingsRow label={zh ? '设备密钥' : 'Device key'} description={({
        'macos-se': 'Secure Enclave', 'macos-keychain': zh ? '登录钥匙串（此 Mac 没有 Secure Enclave）' : 'Login Keychain (this Mac has no Secure Enclave)',
        'windows-tpm': 'TPM', 'windows-dpapi': zh ? 'Windows DPAPI（未找到可用的 TPM）' : 'Windows DPAPI (no usable TPM)',
      } as Record<string, string>)[status.deviceBackend] || status.deviceBackend} />}
      {(form.kind === 'set-master' || form.kind === 'change-master' || form.kind === 'remove-master' || form.kind === 'new-recovery') && formRows}
    </SettingsSection>}

    {(section === 'vault' || section === 'both') && <SettingsSection title={zh ? '工作区密码' : 'Workspace password'} description={zh ? `当前工作区：${workspace?.name || activeWorkspaceId}` : `Current workspace: ${workspace?.name || activeWorkspaceId}`}>
      <SettingsRow label={workspaceScope?.ownPassword ? (zh ? '已设置单独密码' : 'Has its own password') : status?.appProtected ? (zh ? '由主密码保护' : 'Protected by the master password') : (zh ? '没有密码' : 'No password')}
        description={!workspaceScope?.ownPassword && !status?.appProtected
          ? (isMainWorkspace ? (zh ? '主工作区不能单独设置密码；设置主密码后它会受到保护。' : 'The main workspace cannot have its own password; set a master password to protect it.') : (zh ? '任何使用这台电脑的人都能打开这个工作区。' : 'Anyone using this computer can open this workspace.'))
          : undefined}>
        <div className="flex flex-wrap gap-2">{workspaceScope?.ownPassword
          ? <><button type="button" onClick={() => open('change-workspace')} className={settingButtonClass}>{zh ? '修改' : 'Change'}</button><button type="button" onClick={() => open('remove-workspace')} className={settingDangerButtonClass}>{zh ? '移除' : 'Remove'}</button></>
          : (!isMainWorkspace || status?.appProtected) && <button type="button" onClick={() => open('set-workspace')} className={settingButtonClass}>{zh ? '设置密码' : 'Set password'}</button>}</div>
      </SettingsRow>
      {workspaceScope?.ownPassword && status?.presenceSupported && <SettingsRow label={presenceName} description={zh ? `用 ${presenceName} 代替输入这个工作区的密码。` : `Use ${presenceName} instead of typing this workspace's password.`}>
        <button type="button" disabled={busy} onClick={() => void togglePresence(activeWorkspaceId, !workspaceScope.presence)} className={settingButtonClass}>{workspaceScope.presence ? (zh ? '关闭' : 'Turn off') : (zh ? '开启' : 'Turn on')}</button>
      </SettingsRow>}
      {(form.kind === 'set-workspace' || form.kind === 'change-workspace' || form.kind === 'remove-workspace') && formRows}
    </SettingsSection>}
    {form.kind === 'none' && error && <p role="alert" className="text-xs text-down">{error}</p>}
  </div>;
};
