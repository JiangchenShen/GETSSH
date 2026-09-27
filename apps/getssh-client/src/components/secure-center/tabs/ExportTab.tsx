import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Database, Download, FileJson, Upload } from 'lucide-react';
import { promptWebAuthn } from '../../../utils/webauthn';
import { SettingsRow, SettingsSection, settingButtonClass, settingDangerButtonClass, settingFieldClass } from '../../settings/SettingsControls';

type Status = { type: 'success' | 'error'; message: string };

export const ExportTab: React.FC = () => {
  const { t, i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const copy = (chinese: string, english: string) => zh ? chinese : english;
  const [status, setStatus] = useState<Status | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [importPwdModal, setImportPwdModal] = useState(false);
  const [importPwd, setImportPwd] = useState('');
  const [pendingDbImportPath, setPendingDbImportPath] = useState<string | null>(null);

  const run = async (action: string, work: () => Promise<void>) => {
    if (busyAction) return;
    setBusyAction(action);
    setStatus(null);
    try {
      await work();
    } catch (error) {
      setStatus({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusyAction(null);
    }
  };

  const exportAll = () => run('exportAll', async () => {
    if (!window.electronAPI?.exportDatabaseAll) return;
    let confirmed: boolean;
    try {
      confirmed = await promptWebAuthn();
    } catch (error) {
      throw error instanceof Error && error.message === 'MAC_WEBAUTHN_BLOCKED'
        ? new Error(t('security.errMacWebAuthnBlocked')) : error;
    }
    if (!confirmed) {
      setStatus({ type: 'error', message: copy('WebAuthn 操作未完成，未导出数据库。', 'The WebAuthn step was not completed; no database was exported.') });
      return;
    }
    const result = await window.electronAPI.exportDatabaseAll();
    if (result.success) setStatus({ type: 'success', message: copy(`全部数据库已导出至：${result.path}`, `All databases exported to: ${result.path}`) });
    else if (result.error !== 'canceled') setStatus({ type: 'error', message: copy(`导出失败：${result.error}`, `Export failed: ${result.error}`) });
  });

  const exportWorkspace = () => run('exportWorkspace', async () => {
    if (!window.electronAPI?.exportDatabaseWorkspace) return;
    const result = await window.electronAPI.exportDatabaseWorkspace();
    if (result.success) setStatus({ type: 'success', message: copy(`当前工作区已导出至：${result.path}`, `Current workspace exported to: ${result.path}`) });
    else if (result.error !== 'canceled') setStatus({ type: 'error', message: copy(`导出失败：${result.error}`, `Export failed: ${result.error}`) });
  });

  const exportTemplate = () => run('exportTemplate', async () => {
    if (!window.electronAPI?.exportProfiles) return;
    const result = await window.electronAPI.exportProfiles();
    if (result.success) setStatus({ type: 'success', message: copy(`已导出 ${result.count ?? 0} 条脱敏主机配置。`, `Exported ${result.count ?? 0} sanitized host profiles.`) });
    else if (result.reason !== 'canceled') setStatus({ type: 'error', message: copy(`导出失败：${result.reason}`, `Export failed: ${result.reason}`) });
  });

  const importDatabase = () => run('importDatabase', async () => {
    if (!window.electronAPI?.importDatabase) return;
    const result = await window.electronAPI.importDatabase();
    if (result.requiresConfirmation && result.sourcePath) {
      setPendingDbImportPath(result.sourcePath);
    } else if (!result.success && result.error !== 'canceled') {
      setStatus({ type: 'error', message: copy(`导入失败：${result.error}`, `Import failed: ${result.error}`) });
    } else if (result.success && result.merged) {
      setStatus({ type: 'success', message: copy('数据库已合并。', 'Database merged successfully.') });
    } else if (result.success) {
      setStatus({ type: 'success', message: copy('所选文件是当前数据库，未更改任何数据。', 'The selected file is the current database; no data was changed.') });
    }
  });

  const importTemplate = () => run('importTemplate', async () => {
    try {
      if (!window.electronAPI?.importProfiles) return;
      const result = await window.electronAPI.importProfiles({ masterPassword: importPwd });
      if (!result.success) {
        if (result.reason === 'canceled') return;
        const messages: Record<string, string> = {
          invalid_format: t('settings.importInvalidFormat'),
          password_required: t('settings.importPwdRequired'),
          wrong_password: t('settings.importWrongPwd'),
        };
        setStatus({ type: 'error', message: messages[result.reason ?? ''] ?? result.reason ?? copy('导入失败', 'Import failed') });
        return;
      }
      if (result.count && result.count > 0) {
        setStatus({ type: 'success', message: t('settings.importSuccessNew', { count: result.count, skipped: 0 }) });
        window.setTimeout(() => window.location.reload(), 2000);
      } else {
        setStatus({ type: 'success', message: t('settings.importSuccessEmpty') });
      }
    } finally {
      setImportPwd('');
    }
  });

  const confirmDatabaseImport = (strategy: 'merge' | 'overwrite') => {
    const sourcePath = pendingDbImportPath;
    if (!sourcePath) return;
    setPendingDbImportPath(null);
    void run(`confirm-${strategy}`, async () => {
      const result = await window.electronAPI.confirmImportDatabase(sourcePath, strategy);
      if (result.success) {
        setStatus({ type: 'success', message: strategy === 'merge'
          ? copy('数据库已合并。', 'Database merged successfully.')
          : copy('正在重启应用以完成覆盖。', 'Restarting the app to finish replacing the database.') });
      } else {
        setStatus({ type: 'error', message: copy(`导入失败：${result.error}`, `Import failed: ${result.error}`) });
      }
    });
  };

  const button = `${settingButtonClass} whitespace-nowrap`;
  const buttonContent = (Icon: typeof Database, label: string, action: string) => <><Icon className="h-3.5 w-3.5" aria-hidden="true" />{busyAction === action ? t('common.loading', '处理中…') : label}</>;

  return <div className="space-y-7">
    {status && <p role={status.type === 'error' ? 'alert' : 'status'} className={`rounded-md border px-3 py-2 text-sm break-all ${status.type === 'error' ? 'border-down/30 bg-down/10 text-down' : 'border-[var(--center-accent)]/30 bg-[var(--center-accent)]/10 text-ink'}`}>{status.message}</p>}

    <SettingsSection title={copy('数据库备份', 'Database backups')} description={copy('数据库备份可能包含敏感信息，请妥善保管导出的文件。', 'Database backups may contain sensitive data. Store exported files securely.')}>
      <SettingsRow label={copy('全部工作区', 'All workspaces')} description={copy('将所有数据库打包为 ZIP。此操作会先触发 WebAuthn 提示。', 'Export every database in one ZIP file. A WebAuthn prompt appears first.')}>
        <button type="button" onClick={exportAll} disabled={!!busyAction} className={button}>{buttonContent(Download, copy('导出全部', 'Export all'), 'exportAll')}</button>
      </SettingsRow>
      <SettingsRow label={copy('当前工作区', 'Current workspace')} description={copy('仅导出当前工作区的数据库文件。', 'Export only the current workspace database file.')}>
        <button type="button" onClick={exportWorkspace} disabled={!!busyAction} className={button}>{buttonContent(Database, copy('导出当前工作区', 'Export current'), 'exportWorkspace')}</button>
      </SettingsRow>
      <SettingsRow label={t('settings.importDb')} description={copy('选择数据库文件；如含主工作区，可选择合并或覆盖。覆盖会重启应用。', 'Select a database file. If it includes a main workspace, choose merge or replace. Replacing restarts the app.')}>
        <button type="button" onClick={importDatabase} disabled={!!busyAction} className={button}>{buttonContent(Upload, t('settings.importDb'), 'importDatabase')}</button>
      </SettingsRow>
    </SettingsSection>

    <SettingsSection title={copy('主机配置模板', 'Host profile template')} description={copy('JSON 模板会保留主机与工作区结构，但导出时会去掉用户名、密码、私钥路径等凭据。', 'The JSON template preserves hosts and workspace structure, but removes usernames, passwords, private-key paths and other credentials on export.')}>
      <SettingsRow label={t('settings.exportJson')} description={copy('导出所有工作区的脱敏配置模板。', 'Export sanitized host profiles from all workspaces.')}>
        <button type="button" onClick={exportTemplate} disabled={!!busyAction} className={button}>{buttonContent(FileJson, t('settings.exportJson'), 'exportTemplate')}</button>
      </SettingsRow>
      <SettingsRow label={t('settings.importJson')} description={copy('支持现有 JSON 模板和旧版加密配置文件；仅旧版加密文件需要密码。', 'Supports current JSON templates and legacy encrypted exports; only encrypted legacy files need a password.')}>
        <button type="button" onClick={() => { setStatus(null); setImportPwd(''); setImportPwdModal(true); }} disabled={!!busyAction} className={button}><Upload className="h-3.5 w-3.5" aria-hidden="true" />{t('settings.importJson')}</button>
      </SettingsRow>
    </SettingsSection>

    {importPwdModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4" role="presentation">
      <form role="dialog" aria-modal="true" aria-labelledby="import-json-title" onKeyDown={event => { if (event.key === 'Escape') { setImportPwdModal(false); setImportPwd(''); } }} onSubmit={event => { event.preventDefault(); setImportPwdModal(false); void importTemplate(); }} className="w-full max-w-sm rounded-xl border border-line bg-panel p-5 text-ink shadow-2xl">
        <h3 id="import-json-title" className="text-base font-semibold">{t('settings.importTitle')}</h3>
        <p className="mt-2 text-sm leading-6 text-ink-2">{t('settings.importHint')}</p>
        <label className="mt-5 block text-xs font-medium text-ink-2">{t('settings.importPwdPlaceholder')}
          <input autoFocus type="password" autoComplete="current-password" value={importPwd} onChange={event => setImportPwd(event.target.value)} className={`mt-1 ${settingFieldClass}`} />
        </label>
        <div className="mt-5 flex justify-end gap-2 border-t border-line pt-4">
          <button type="button" onClick={() => { setImportPwdModal(false); setImportPwd(''); }} className={settingButtonClass}>{t('settings.importCancel')}</button>
          <button type="submit" className="inline-flex min-h-8 items-center rounded-md bg-[var(--center-accent)] px-3 text-xs font-medium text-[var(--center-accent-ink)] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--center-accent)]">{t('settings.importConfirm')}</button>
        </div>
      </form>
    </div>}

    {pendingDbImportPath && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4" role="presentation">
      <div role="alertdialog" aria-modal="true" aria-labelledby="import-db-title" aria-describedby="import-db-description" onKeyDown={event => { if (event.key === 'Escape') setPendingDbImportPath(null); }} className="w-full max-w-md rounded-xl border border-line bg-panel p-5 text-ink shadow-2xl">
        <h3 id="import-db-title" className="text-base font-semibold">{t('settings.importStrategyTitle')}</h3>
        <p id="import-db-description" className="mt-2 text-sm leading-6 text-ink-2">{t('settings.importStrategyDesc')}</p>
        <p className="mt-3 text-xs text-down">{copy('全部覆盖会替换当前数据库，并立即重启应用。请确认已备份现有数据。', 'Replace all overwrites the current database and immediately restarts the app. Back up existing data first.')}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-line pt-4">
          <button type="button" onClick={() => setPendingDbImportPath(null)} className={settingButtonClass}>{t('settings.importStrategyCancel')}</button>
          <button type="button" autoFocus onClick={() => confirmDatabaseImport('merge')} className={settingButtonClass}>{t('settings.importStrategyMergeOnly')}</button>
          <button type="button" onClick={() => confirmDatabaseImport('overwrite')} className={settingDangerButtonClass}>{t('settings.importStrategyOverwriteAll')}</button>
        </div>
      </div>
    </div>}
  </div>;
};
