import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkspaceStore } from '../../../store/workspaceStore';

const defaultRules = {
  disableSftp: false,
  disableTelnet: true,
  strictHostKeyChecking: false,
  preventDataExport: false,
};

type RuleKey = keyof typeof defaultRules;

export const IsolationRulesTab: React.FC = () => {
  const { t } = useTranslation();
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const activeWorkspace = useWorkspaceStore(state => state.workspaces.find(workspace => workspace.id === state.activeWorkspaceId));
  const [rules, setRules] = useState(defaultRules);
  const [savingKey, setSavingKey] = useState<RuleKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRules({ ...defaultRules, ...activeWorkspace?.preferences?.isolationRules });
    setError(null);
  }, [activeWorkspaceId, activeWorkspace?.preferences?.isolationRules]);

  const toggleRule = async (key: RuleKey) => {
    if (!activeWorkspaceId || !window.electronAPI?.updateWorkspacePreferences || savingKey) return;
    const nextRules = { ...rules, [key]: !rules[key] };
    setSavingKey(key);
    setError(null);
    try {
      const result = await window.electronAPI.updateWorkspacePreferences(activeWorkspaceId, JSON.stringify({
        ...(activeWorkspace?.preferences || {}),
        isolationRules: nextRules,
      }));
      if (!result.success) throw new Error(result.error || 'Could not save isolation rules.');
      setRules(nextRules);
      await useWorkspaceStore.getState().initWorkspaces();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSavingKey(null);
    }
  };

  const items: { key: RuleKey; title: string; description: string }[] = [
    { key: 'disableSftp', title: t('workspaceCenter.disableSftp', 'Disable SFTP File Transfers'), description: t('workspaceCenter.disableSftpDesc', 'Block file uploads and downloads for this workspace.') },
    { key: 'disableTelnet', title: t('workspaceCenter.disableTelnet', 'Block Plaintext Protocols'), description: t('workspaceCenter.disableTelnetDesc', 'Prevent unencrypted protocols such as Telnet.') },
    { key: 'strictHostKeyChecking', title: t('workspaceCenter.strictHostKeyChecking', 'Strict Host Key Checking'), description: t('workspaceCenter.strictHostKeyCheckingDesc', 'Reject a connection if its host key changes.') },
    { key: 'preventDataExport', title: t('workspaceCenter.preventDataExport', 'Prevent Data Export'), description: t('workspaceCenter.preventDataExportDesc', 'Block profile exports from this workspace.') },
  ];

  return (
    <div className="max-w-2xl">
      <p className="mb-5 text-sm leading-6 text-ink-2">
        {t('workspaceCenter.isolationRulesDesc', 'These rules apply to connections in the current workspace.')}
      </p>
      {error && <p role="alert" className="mb-4 rounded-md border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{error}</p>}
      <div className="border-y border-line">
        {items.map(item => (
          <div key={item.key} className="flex min-h-17 items-center justify-between gap-4 border-b border-line-soft py-4 last:border-0">
            <div className="min-w-0">
              <h3 className="text-sm font-medium">{item.title}</h3>
              <p className="mt-1 text-xs leading-5 text-ink-2">{item.description}</p>
            </div>
            <button type="button" role="switch" aria-checked={rules[item.key]} aria-label={item.title}
              onClick={() => toggleRule(item.key)} disabled={!!savingKey}
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--center-accent)] disabled:opacity-50 ${rules[item.key] ? 'bg-[var(--center-accent)]' : 'bg-line'}`}>
              <span className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition-transform ${rules[item.key] ? 'translate-x-5' : ''}`} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
