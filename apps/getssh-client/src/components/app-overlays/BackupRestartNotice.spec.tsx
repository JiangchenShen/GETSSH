// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackupRestartNotice } from './BackupRestartNotice';
import { AppLockScreen } from './AppLockScreen';
import { useBackupRestartStore } from '../../store/backupStore';
import { useAppLockStore } from '../../store/appLockStore';
import { storeFailureMessage } from '../../utils/storeFeedback';
import type { ImportReport } from '../../types/store';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }));
const report: ImportReport = { workspaceIds: ['main'], backupPath: '/test/previous' };
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; useBackupRestartStore.setState({ report: null });
  window.electronAPI = { store: { backup: { relaunch: vi.fn().mockResolvedValue({ ok: true }) } }, appLock: { unlock: vi.fn() } } as unknown as Window['electronAPI'];
  useAppLockStore.setState({ state: null });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); useBackupRestartStore.setState({ report: null }); });
function Pages() {
  const [page, setPage] = useState('导出 / 导入');
  return <><BackupRestartNotice /><button onClick={() => setPage('主页')}>切换页面</button><main>{page}</main></>;
}
const render = async () => act(async () => root.render(<Pages />));
const restart = async () => act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === '重启应用')!.click());

describe('app-wide backup restart notice', () => {
  it('appears after import and remains when leaving the export page', async () => {
    await render(); expect(container.querySelector('[role="status"]')).toBeNull();
    await act(async () => useBackupRestartStore.setState({ report }));
    expect(container.querySelector('[role="status"]')?.textContent).toContain('需要重启应用');
    await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === '切换页面')!.click());
    expect(container.querySelector('main')?.textContent).toBe('主页');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('备份已导入');
    await restart(); expect(window.electronAPI.store.backup.relaunch).toHaveBeenCalledOnce();
    expect(useBackupRestartStore.getState().report).toBe(report);
  });
  it.each(['unauthorized', 'invalid_argument'] as const)('reports a real relaunch error and allows retry (%s)', async error => {
    useBackupRestartStore.setState({ report });
    vi.mocked(window.electronAPI.store.backup.relaunch).mockResolvedValueOnce({ ok: false, error });
    await render(); await restart(); expect(container.querySelector('[role="alert"]')?.textContent).toBe(storeFailureMessage(error, true));
    await restart(); expect(window.electronAPI.store.backup.relaunch).toHaveBeenCalledTimes(2);
  });
  it('shows the restart requirement for unavailable storage in both languages', () => {
    const before = storeFailureMessage('unavailable', true); useBackupRestartStore.setState({ report });
    expect(storeFailureMessage('unavailable', true)).toBe('备份已导入，请先重启应用以继续使用存储。');
    expect(storeFailureMessage('unavailable', false)).toBe('Backup imported. Restart the app to use storage again.');
    expect(storeFailureMessage('unavailable', true)).not.toBe(before);
    expect(storeFailureMessage('wrong_password', true)).toBe('密码不正确，请重新输入');
  });

  it.each(['locked', 'starting', 'error'] as const)('keeps restart reachable above the lock screen (%s)', async phase => {
    useBackupRestartStore.setState({ report });
    useAppLockStore.setState({ state: { phase, appProtected: true, presenceEnabled: true, presenceSupported: true, recoveryConfigured: true, deviceKeyLost: false, masterPasswordMustChange: false } });
    await act(async () => root.render(<AppLockScreen />));
    expect(container.querySelector('[role="dialog"] [role="status"]')?.textContent).toContain('需要重启应用');
    expect(container.querySelector('input')).toBeNull();
    expect(window.electronAPI.appLock.unlock).not.toHaveBeenCalled();
    await restart(); expect(window.electronAPI.store.backup.relaunch).toHaveBeenCalledOnce();
  });
});
