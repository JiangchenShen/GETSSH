import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/appStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { Settings, Plus, Sparkles, Home } from 'lucide-react';

/**
 * 工作区导轨。
 *
 * 原来是 Discord 那套：48px 圆头像、圆↔圆角变形、投影、写死的 bg-red-900。
 * 近黑底上投黑影本来就看不见，只会糊掉边界；现在改成 34px 方章 + 1px 描边，
 * 选中态 = 主色淡底 + 主色描边 + 贴着导轨左沿的 2px 竖条。
 *
 * 底色不写死：导轨、侧栏、主区在原型里是同一个 --bg，只靠发丝线分隔，
 * 所以这里保持透明，让根容器的底色（以及开了毛玻璃时的透射）透上来。
 */

interface GlobalWorkspaceBarProps {
  onHomeClick: () => void;
}

const RailIcon: React.FC<{
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}> = ({ onClick, title, children }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    className="w-[34px] h-[34px] rounded-[9px] grid place-items-center text-ink-3
               transition-colors hover:bg-surf hover:text-ink-2"
  >
    {children}
  </button>
);

export const GlobalWorkspaceBar: React.FC<GlobalWorkspaceBarProps> = ({ onHomeClick }) => {
  const { t } = useTranslation();
  const isFullScreen = useAppStore(state => state.isFullScreen);
  const isMac = useAppStore(state => state.isMac);
  const workspaces = useWorkspaceStore(state => state.workspaces);
  const setWorkspaces = useAppStore(state => state.setWorkspaces);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const switchWorkspace = useWorkspaceStore(state => state.switchWorkspace);
  const setIsCreateModalOpen = useWorkspaceStore(state => state.setIsCreateModalOpen);
  const setIsAiCenterOpen = useAppStore(state => state.setIsAiCenterOpen);

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

  const handleWorkspaceSwitch = async (id: string) => {
    if (id === activeWorkspaceId) {
      window.dispatchEvent(new CustomEvent('app:open-center', {
        detail: { type: 'workspace', title: t('statusBar.workspace') }
      }));
      return;
    }
    await switchWorkspace(id);
  };

  const topPad = isFullScreen ? 'pt-3.5' : (isMac ? 'pt-10' : 'pt-8');

  return (
    <div className={`drag-region h-full w-full flex flex-col items-center gap-2 pb-3.5 ${topPad}
                     border-r border-line-soft`}>

      {/* 工作区 */}
      <div className="no-drag-region flex-1 min-h-0 w-full flex flex-col items-center gap-2 overflow-y-auto">
        {workspaces.map((wObj: any) => {
          const wsId = typeof wObj === 'string' ? wObj : wObj.id;
          const meta = typeof wObj === 'string' ? null : wObj.visualMeta;
          const isActive = wsId === activeWorkspaceId;
          const name = (typeof wObj === 'object' && wObj.name) || wsId;
          const tint = meta?.themeColor;

          // 工作区自定义色是真实数据，选中时用它当强调色；没设就退回主色
          const activeStyle: React.CSSProperties = tint
            ? { backgroundColor: `${tint}26`, borderColor: tint, color: tint }
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
                title={name}
                style={isActive ? activeStyle : undefined}
                className={`w-[34px] h-[34px] rounded-[9px] grid place-items-center border
                            text-[13px] font-semibold transition-colors ${
                  isActive
                    ? 'bg-primary/15 border-primary text-primary'
                    : 'bg-surf border-line-soft text-ink-2 hover:text-ink'
                }`}
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

      {/* 主页 / AI / 设置 */}
      <div className="no-drag-region flex flex-col items-center gap-1.5">
        <RailIcon onClick={onHomeClick} title={t('tabs.home')}>
          <Home className="w-[17px] h-[17px]" />
        </RailIcon>
        <RailIcon onClick={() => setIsAiCenterOpen(true)} title={t('statusBar.aiAssistant')}>
          <Sparkles className="w-[17px] h-[17px]" />
        </RailIcon>
        <RailIcon
          onClick={() => window.dispatchEvent(new CustomEvent('app:open-center', {
            detail: { type: 'settings', title: t('statusBar.settings') }
          }))}
          title={t('statusBar.settings')}
        >
          <Settings className="w-[17px] h-[17px]" />
        </RailIcon>
      </div>
    </div>
  );
};
