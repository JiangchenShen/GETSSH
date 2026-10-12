import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileJson, Upload } from 'lucide-react';
import { EncryptedBackupSection } from './EncryptedBackupSection';
import { useAppLockStore } from '../../../store/appLockStore';
import { useBackupRestartStore } from '../../../store/backupStore';
import { SettingsRow, SettingsSection, settingButtonClass, settingFieldClass } from '../../settings/SettingsControls';

type Status = { type: 'success' | 'error'; message: string };

export const ExportTab: React.FC = () => {
  const { t, i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const copy = (chinese: string, english: string) => zh ? chinese : english;
  const [status, setStatus] = useState<Status | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const locked = useAppLockStore(state => state.state?.phase === 'locked');
  const needsRestart = !!useBackupRestartStore(state => state.report);
  const [importPwdModal, setImportPwdModal] = useState(false);
  const [importPwd, setImportPwd] = useState('');

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    generation.current += 1;
    setImportPwdModal(false); setImportPwd(''); setStatus(null);
  }, [locked, needsRestart]);

  const run = async (action: string, work: (isCurrent: () => boolean) => Promise<void>) => {
    if (running.current || needsRestart || locked) return;
    const epoch = generation.current;
    const isCurrent = () => mounted.current && generation.current === epoch;
    running.current = true;
    setBusyAction(action);
    setStatus(null);
    try { await work(isCurrent); }
    catch { if (isCurrent()) setStatus({ type: 'error', message: copy('操作未完成，请重试', 'The operation could not be completed. Try again') }); }
    finally { running.current = false; if (mounted.current) setBusyAction(null); }
  };

  const exportTemplate = () => run('exportTemplate', async isCurrent => {
    if (!window.electronAPI?.exportProfiles) throw new Error('export unavailable');
    const result = await window.electronAPI.exportProfiles();
    if (!isCurrent()) return;
    if (result.success) setStatus({ type: 'success', message: copy(`已导出 ${result.count ?? 0} 条脱敏主机配置。`, `Exported ${result.count ?? 0} sanitized host profiles.`) });
    else if (result.reason !== 'canceled') setStatus({ type: 'error', message: copy('配置导出未完成，请重试', 'Profile export could not be completed. Try again') });
  });

  const importTemplate = () => run('importTemplate', async isCurrent => {
    try {
      if (!window.electronAPI?.importProfiles) throw new Error('import unavailable');
      const result = await window.electronAPI.importProfiles({ masterPassword: importPwd });
      if (!isCurrent()) return;
      if (!result.success) {
        if (result.reason === 'canceled') return;
        const messages: Record<string, string> = {
          invalid_format: t('settings.importInvalidFormat'),
          password_required: t('settings.importPwdRequired'),
          wrong_password: t('settings.importWrongPwd'),
        };
        setStatus({ type: 'error', message: messages[result.reason ?? ''] ?? copy('配置导入未完成，请重试', 'Profile import could not be completed. Try again') });
        return;
      }
      if (result.count && result.count > 0) {
        setStatus({ type: 'success', message: t('settings.importSuccessNew', { count: result.count, skipped: 0 }) });
        window.setTimeout(() => window.location.reload(), 2000);
      } else setStatus({ type: 'success', message: t('settings.importSuccessEmpty') });
    } finally { if (mounted.current) setImportPwd(''); }
  });

  return <div className="space-y-7">
    <EncryptedBackupSection onRestartRequired={() => { setStatus(null); setImportPwdModal(false); setImportPwd(''); }} />

    {status && <p role={status.type === 'error' ? 'alert' : 'status'} className={`rounded-md border px-3 py-2 text-sm break-all ${status.type === 'error' ? 'border-down/30 bg-down/10 text-down' : 'border-line text-ink'}`}>{status.message}</p>}
    <SettingsSection title={copy('主机配置模板', 'Host profile template')} description={copy('JSON 模板会保留主机与工作区结构，但导出时会去掉用户名、密码、私钥路径等凭据。', 'The JSON template preserves hosts and workspace structure, but removes usernames, passwords, private-key paths and other credentials on export.')}>
      <SettingsRow label={t('settings.exportJson')} description={copy('导出所有工作区的脱敏配置模板。', 'Export sanitized host profiles from all workspaces.')}>
        <button type="button" onClick={() => void exportTemplate()} disabled={!!busyAction || needsRestart || locked} className={settingButtonClass}><FileJson className="h-3.5 w-3.5" aria-hidden="true" />{busyAction === 'exportTemplate' ? t('common.loading', '处理中…') : t('settings.exportJson')}</button>
      </SettingsRow>
      <SettingsRow label={t('settings.importJson')} description={copy('支持现有 JSON 模板和旧版加密配置文件；仅旧版加密文件需要密码。', 'Supports current JSON templates and legacy encrypted exports; only encrypted legacy files need a password.')}>
        <button type="button" onClick={() => { setStatus(null); setImportPwd(''); setImportPwdModal(true); }} disabled={!!busyAction || needsRestart || locked} className={settingButtonClass}><Upload className="h-3.5 w-3.5" aria-hidden="true" />{t('settings.importJson')}</button>
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
          <button type="submit" className={settingButtonClass}>{t('settings.importConfirm')}</button>
        </div>
      </form>
    </div>}
  </div>;
};
