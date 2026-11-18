import React, { useEffect, useRef } from 'react';
import { X, Home, Columns2, PanelsTopLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tab, PaneNode } from '../store/sessionStore';
import { useAppStore } from '../store/appStore';
import logo from '../assets/logo.png';

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

function sessionStatus(node: PaneNode | undefined): 'connected' | 'disconnected' | undefined {
  if (!node) return;
  if (node.type === 'leaf') {
    if (node.paneType !== 'terminal') return;
    return node.sessionId && !node.isDisconnected ? 'connected' : 'disconnected';
  }
  const left = sessionStatus(node.children[0]);
  const right = sessionStatus(node.children[1]);
  return left === 'connected' || right === 'connected' ? 'connected' : left ?? right;
}

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onHomeClick: () => void;
  isHomeActive: boolean;
  actions?: React.ReactNode;
  onSplit?: () => void;
  canSplit?: boolean;
}

export const TabBar: React.FC<TabBarProps> = ({
  tabs, activeTabId, onSelectTab, onCloseTab, onHomeClick, isHomeActive, actions, onSplit, canSplit,
}) => {
  const { t } = useTranslation();
  const visibleTabs = tabs.filter(tb => tb.id !== 'settings' && !tb.isTornOff);
  const tabStrip = useRef<HTMLElement>(null);

  useEffect(() => {
    tabStrip.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId]);

  return (
    <header className="workbench-header drag-region">
      <div className="workbench-brand">
        <img src={logo} width={24} height={24} alt="" />
        <strong>GETSSH</strong>
      </div>
      <button
        type="button"
        onClick={onHomeClick}
        className="workbench-home"
        aria-current={isHomeActive ? 'page' : undefined}
      >
        <Home size={15} aria-hidden="true" />{t('tabs.home')}
      </button>

      <nav ref={tabStrip} className="workbench-tabs" aria-label={t('welcome.home.openTabs')}>
      {visibleTabs.map((tab) => {
        const isActive = activeTabId === tab.id;
        const status = sessionStatus(tab.paneTree);
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
            className="workbench-tab no-drag-region"
            data-active={isActive}
          >
            <button type="button" className="workbench-tab-label" aria-current={isActive ? 'page' : undefined}
              aria-description={status ? t(status === 'connected' ? 'pane.statusConnected' : 'pane.statusDisconnected') : undefined}
              onClick={e => { e.stopPropagation(); onSelectTab(tab.id); }}>
              {status ? <span className="workbench-session-dot" data-status={status} aria-hidden="true" />
                : <PanelsTopLeft size={13} aria-hidden="true" />}
              <span>{tab.title}</span>
            </button>
            <button
              type="button"
              aria-label={t('tabs.close')}
              onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
              className="workbench-tab-close"
            >
              <X className="w-[11px] h-[11px]" />
            </button>
          </div>
        );
      })}
      </nav>

      {actions}
      {onSplit && (
        <button
          type="button"
          onClick={onSplit}
          disabled={!canSplit}
          aria-label={t('tabs.split')}
          title={t('tabs.split')}
          className="workbench-header-action"
        >
          <Columns2 className="w-[13px] h-[13px]" />
          <span>{t('tabs.split')}</span>
        </button>
      )}
    </header>
  );
};
