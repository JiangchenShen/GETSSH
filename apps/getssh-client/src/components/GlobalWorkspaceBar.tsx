import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, ShieldAlert, ShieldCheck, ShieldOff, ShieldQuestionMark } from 'lucide-react';
import { useAppLockStore } from '../store/appLockStore';
import { useAppStore } from '../store/appStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { getSentinelSupervisorState } from '../utils/sentinelSupervisorState';
import './GlobalWorkspaceBar.css';

/**
 * 工作区导轨。
 *
 * 工作区切换与本机进程监护入口。
 */

export const GlobalWorkspaceBar: React.FC = () => {
  const { t } = useTranslation();
  const isFullScreen = useAppStore(state => state.isFullScreen);
  const isMac = useAppStore(state => state.isMac);
  const workspaces = useWorkspaceStore(state => state.workspaces);
  const setWorkspaces = useAppStore(state => state.setWorkspaces);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const switchWorkspace = useWorkspaceStore(state => state.switchWorkspace);
  const setIsCreateModalOpen = useWorkspaceStore(state => state.setIsCreateModalOpen);
  const isVaultLocked = useWorkspaceStore(state => state.isVaultLocked);
  const phase = useAppLockStore(state => state.state?.phase);
  const sentinelStatus = useAppStore(state => state.sentinelStatus);
  const sentinelStatusError = useAppStore(state => state.sentinelStatusError);
  const pollSentinelStatus = useAppStore(state => state.pollSentinelStatus);
  const canPollSentinel = phase === 'ready' && !isVaultLocked;

  useEffect(() => {
    const fetchWorkspaces = async () => {
      if (window.electronAPI?.workspace?.getWorkspaces) {
        try {
          const wsList = await window.electronAPI.workspace.getWorkspaces();
          setWorkspaces(wsList);
        } catch (e) {
          console.error('Failed to fetch workspaces:', e);
        }
      }
    };
    fetchWorkspaces();
  }, [setWorkspaces]);

  useEffect(() => {
    if (!canPollSentinel) return;
    void pollSentinelStatus();
    const timer = window.setInterval(pollSentinelStatus, 3_000);
    return () => window.clearInterval(timer);
  }, [canPollSentinel, pollSentinelStatus]);

  const handleWorkspaceSwitch = async (id: string) => {
    if (id === activeWorkspaceId) {
      window.dispatchEvent(new CustomEvent('app:open-center', {
        detail: { type: 'workspace', title: t('statusBar.workspace'), workspacePage: 'all' }
      }));
      return;
    }
    await switchWorkspace(id);
  };

  const topPad = isFullScreen ? 'pt-3.5' : (isMac ? 'pt-10' : 'pt-8');
  const supervisor = canPollSentinel
    ? getSentinelSupervisorState(sentinelStatus, sentinelStatusError)
    : { label: 'unconfirmed', tone: 'neutral' };
  const statusText = t(`welcome.home.${supervisor.label}`);
  const sentinelLabel = `${t('statusBar.secure')} · ${statusText}`;
  const sentinelDetail = canPollSentinel && (sentinelStatusError || sentinelStatus?.reason);
  const SentinelIcon = supervisor.tone === 'ok' ? ShieldCheck
    : supervisor.label === 'supervisorDisabled' ? ShieldOff
    : supervisor.tone === 'warn' ? ShieldAlert : ShieldQuestionMark;

  return (
    <div className={`drag-region h-full w-full flex flex-col items-center gap-2 pb-3.5 ${topPad}
                     workspace-rail-divider ${isMac && !isFullScreen ? 'workspace-rail-divider-titlebar' : ''}`}>

      {/* 工作区 */}
      <div className="no-drag-region flex-1 min-h-0 w-full flex flex-col items-center gap-2 overflow-y-auto">
        {workspaces.map((wObj: any) => {
          const wsId = typeof wObj === 'string' ? wObj : wObj.id;
          const meta = typeof wObj === 'string' ? null : (wObj.visualMeta || wObj);
          const isActive = wsId === activeWorkspaceId;
          const name = (typeof wObj === 'object' && wObj.name) || wsId;
          const tint = meta?.themeColor;

          // 工作区自定义色是真实数据，选中时用它当强调色；没设就退回主色
          const activeStyle: React.CSSProperties = tint
            ? { backgroundColor: `${tint}18`, borderColor: `${tint}55` }
            : {};

          return (
            <div key={wsId} className="relative w-full flex items-center justify-center">
              {isActive && (
                <span
                  className="absolute left-0 top-[7px] bottom-[7px] w-0.5 rounded-sm bg-primary"
                  style={tint ? { backgroundColor: tint } : undefined}
                />
              )}
              <button
                type="button"
                onClick={() => handleWorkspaceSwitch(wsId)}
                title={isActive ? `${name} · ${t('statusBar.workspace')}` : name}
                aria-label={isActive ? `${name} · ${t('statusBar.workspace')}` : name}
                aria-pressed={isActive}
                style={isActive ? activeStyle : undefined}
                className={`w-[34px] h-[34px] rounded-[9px] grid place-items-center border
                            text-[13px] font-semibold transition-colors ${
                  isActive
                    ? 'bg-primary/10 border-primary/35 text-ink'
                    : 'border-transparent text-ink-2 hover:bg-surf hover:text-ink'
                } focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary`}
              >
                {String(wsId).charAt(0).toUpperCase()}
              </button>
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => setIsCreateModalOpen(true)}
          title={t('workspaceCenter.create', '新建工作区')}
          className="w-[34px] h-[34px] rounded-[9px] grid place-items-center border border-dashed
                     border-line text-ink-3 transition-colors hover:border-primary hover:text-primary"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <button
        type="button"
        className="workspace-rail-sentinel no-drag-region focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        data-tone={supervisor.tone}
        aria-label={sentinelLabel}
        title={sentinelDetail ? `${sentinelLabel} · ${sentinelDetail}` : sentinelLabel}
        onClick={() => window.dispatchEvent(new CustomEvent('app:open-center', {
          detail: { type: 'settings', title: t('statusBar.settings'), settingsTab: 'Security' },
        }))}
      >
        <span className="workspace-rail-sentinel-shield" aria-hidden="true">
          <SentinelIcon size={17} />
        </span>
        <span className="workspace-rail-sentinel-name" aria-hidden="true">Ocean<br />Sentinel</span>
      </button>
      <span className="sr-only" role="status">{sentinelLabel}</span>
    </div>
  );
};
