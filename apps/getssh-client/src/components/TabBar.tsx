import React from 'react';
import { X, Home, Columns2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tab, PaneNode } from '../store/sessionStore';
import { useAppStore } from '../store/appStore';

// Private drag type: other apps (Finder, editors, terminals) must not accept a dragged tab as text.
const TAB_DRAG_MIME = 'application/x-getssh-tab';

// Only trees made entirely of terminal panes can live in a torn-off window.
function isAllTerminal(node: PaneNode): boolean {
  if (node.type === 'leaf') return node.paneType === 'terminal';
  return isAllTerminal(node.children[0]) && isAllTerminal(node.children[1]);
}

// The drag was released outside this window (screen coordinates vs. the window's outer bounds).
function isOutsideWindow(screenX: number, screenY: number): boolean {
  return screenX < window.screenX || screenX > window.screenX + window.outerWidth
    || screenY < window.screenY || screenY > window.screenY + window.outerHeight;
}

/**
 * 标签条。
 *
 * 主页是一个标签，不是「没有标签时才出现的状态」—— 连进终端后主页还在，
 * 随时切回来，不用先关掉会话。
 *
 * 原来每个标签是 120–200px 的方块加渐变下划线，四五个标签就占满一行；
 * 现在是 27px 的药丸，选中态只靠 surf 提亮，不投影不描边。
 */

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onHomeClick: () => void;
  isHomeActive: boolean;
  onSplit?: () => void;
  canSplit?: boolean;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs, activeTabId, onSelectTab, onCloseTab, onHomeClick, isHomeActive, onSplit, canSplit,
}) => {
  const { t } = useTranslation();
  const sshTabs = tabs.filter(tb => tb.id !== 'settings' && !tb.isTornOff);

  return (
    <div className="drag-region flex-none flex items-center gap-0.5 h-[38px] px-2
                    border-b border-line-soft overflow-x-auto">

      <button
        type="button"
        onClick={onHomeClick}
        className={`no-drag-region flex-none flex items-center gap-[7px] h-[27px] px-2.5 rounded-[7px]
                    text-[12.5px] whitespace-nowrap transition-colors ${
          isHomeActive ? 'bg-surf text-ink' : 'text-ink-3 hover:bg-surf hover:text-ink-2'
        }`}
      >
        <Home className="w-[13px] h-[13px]" />
        {t('tabs.home')}
      </button>

      {sshTabs.map((tab) => {
        const isActive = activeTabId === tab.id;
        // 中心页（AI / 安全 / 工作区 / 插件 / 设置）不是会话，别给它画「在线」绿点
        const isCenter = !!tab.config && typeof tab.config === 'object' && 'centerType' in tab.config;
        const canTearOff = !!tab.paneTree && isAllTerminal(tab.paneTree);
        return (
          <div
            key={tab.id}
            onClick={() => onSelectTab(tab.id)}
            draggable={canTearOff}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData(TAB_DRAG_MIME, tab.id);
            }}
            onDragEnd={(e) => {
              // Tear off only when the tab was dropped outside the window and nothing accepted the drop
              // (a cancelled drag, e.g. Esc, also reports 'none' but ends inside the window).
              if (e.dataTransfer.dropEffect !== 'none' || !isOutsideWindow(e.screenX, e.screenY)) return;
              const tree = tab.paneTree;
              if (!tree || !canTearOff) return;
              window.electronAPI.windowTearOff({
                paneId: tree.paneId,
                screenX: e.screenX,
                screenY: e.screenY,
                width: Math.max(800, window.outerWidth * 0.8),
                height: Math.max(600, window.outerHeight * 0.8),
              }).then((res) => {
                if (!res.success) throw new Error(res.error || 'unknown');
              }).catch((err: any) => {
                useAppStore.getState().addToast(`${t('tabs.tearOffFailed', 'Could not open the tab in a new window')}: ${err?.message || err}`, 'error');
              });
            }}
            title={tab.title}
            className={`no-drag-region group flex-none flex items-center gap-[7px] h-[27px] pl-2.5 pr-1.5
                        rounded-[7px] text-[12.5px] whitespace-nowrap cursor-pointer transition-colors
                        max-w-[190px] ${
              isActive ? 'bg-surf text-ink' : 'text-ink-3 hover:bg-surf hover:text-ink-2'
            }`}
          >
            {!isCenter && <span className="w-[5px] h-[5px] rounded-full bg-ok flex-none" />}
            <span className="truncate">{tab.title}</span>
            <button
              type="button"
              aria-label={t('tabs.close')}
              onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
              className="flex-none w-[15px] h-[15px] rounded grid place-items-center text-ink-3
                         opacity-0 group-hover:opacity-100 transition-opacity hover:bg-surf-2 hover:text-ink"
            >
              <X className="w-[11px] h-[11px]" />
            </button>
          </div>
        );
      })}

      <div className="flex-1 min-w-[6px]" />

      {onSplit && (
        <button
          type="button"
          onClick={onSplit}
          disabled={!canSplit}
          className="no-drag-region flex-none flex items-center gap-1.5 h-[26px] px-2.5 rounded-[7px]
                     text-[11.5px] text-ink-3 whitespace-nowrap transition-colors
                     hover:bg-surf hover:text-ink disabled:opacity-40 disabled:pointer-events-none"
        >
          <Columns2 className="w-[13px] h-[13px]" />
          {t('tabs.split')}
        </button>
      )}
    </div>
  );
};
