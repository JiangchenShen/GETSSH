import React, { useEffect, useRef } from 'react';
import {
  Search, Plus, Edit2, Zap, X, Lock, KeyRound,
  PanelLeftClose, PanelLeftOpen, ChevronRight, ChevronDown,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/appStore';
import { useSessionStore } from '../store/sessionStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { SessionProfile } from '../store/sessionStore';

/**
 * 主机侧栏。
 *
 * 每行原来是「24px 带框的 OS 图标 + 别名」，图标占了 24px 却只说了发行版；
 * 现在换成原型的三栏：6px 状态点 / 别名 + 等宽 user@host / 右侧留给状态与操作。
 * 地址是每天真要看的东西，发行版不是。
 *
 * 状态点接真实数据：该主机有没有开着的会话（tabs 里找得到就是绿的），
 * 没有的指标（延迟、负载）不编。
 */

interface ContextSidebarProps {
  onAddSession: () => void;
  onToggleAutoStart: (e: React.MouseEvent, targetSession: SessionProfile) => void;
  onDeleteSession: (e: React.MouseEvent, targetSession: SessionProfile) => void;
}

export const ContextSidebar: React.FC<ContextSidebarProps> = ({
  onAddSession,
  onToggleAutoStart,
  onDeleteSession,
}) => {
  const { t } = useTranslation();
  const isMac = useAppStore(state => state.isMac);
  const isFullScreen = useAppStore(state => state.isFullScreen);
  const isSidebarCollapsed = useAppStore(state => state.isSidebarCollapsed);
  const setIsSidebarCollapsed = useAppStore(state => state.setIsSidebarCollapsed);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const workspaces = useWorkspaceStore(state => state.workspaces);

  const isVaultLocked = useWorkspaceStore(state => state.isVaultLocked);
  const setIsUnlockModalOpen = useWorkspaceStore(state => state.setIsUnlockModalOpen);

  const sessions = useSessionStore(state => state.sessions);
  const tabs = useSessionStore(state => state.tabs);
  const searchQuery = useSessionStore(state => state.searchQuery);
  const setSearchQuery = useSessionStore(state => state.setSearchQuery);
  const selectedSessionIndex = useSessionStore(state => state.selectedSessionIndex);
  const setSelectedSessionIndex = useSessionStore(state => state.setSelectedSessionIndex);
  const setActiveTabId = useSessionStore(state => state.setActiveTabId);

  const expandedGroups = useSessionStore(state => state.expandedGroups);
  const setExpandedGroups = useSessionStore(state => state.setExpandedGroups);

  const topPad = isFullScreen ? 'pt-3.5' : (isMac ? 'pt-10' : 'pt-8');

  // 开着会话的主机 —— 状态点的唯一真实来源
  const openHostKeys = new Set(
    tabs
      .filter(tb => tb.config && 'host' in tb.config)
      .map(tb => `${(tb.config as any).username}@${(tb.config as any).host}`)
  );

  const sessionsWithIndex = sessions
    .map((s, idx) => ({ ...s, originalIndex: idx }))
    .filter(session => session.isDraft || session.protocol === 'local' || Boolean(session.host?.trim()));

  const filteredSessions = sessionsWithIndex.filter(s => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (s.alias && s.alias.toLowerCase().includes(query)) ||
           (s.host && s.host.toLowerCase().includes(query)) ||
           (s.username && s.username.toLowerCase().includes(query)) ||
           (s.group && s.group.toLowerCase().includes(query));
  });

  // 分组默认展开。expandedGroups 初始是空数组且不持久化，不种一次的话
  // 有分组的用户每次启动看到的都是一排空文件夹，得挨个点开才看得见主机。
  const didSeedGroups = useRef(false);
  useEffect(() => {
    if (didSeedGroups.current || expandedGroups.length > 0) return;
    const names = Array.from(new Set(
      sessions.map(s => (s.group || '').trim()).filter(Boolean)
    ));
    if (names.length === 0) return;
    didSeedGroups.current = true;
    setExpandedGroups(names);
  }, [sessions, expandedGroups, setExpandedGroups]);

  const toggleGroup = (group: string) => {
    if (expandedGroups.includes(group)) {
      setExpandedGroups(expandedGroups.filter(g => g !== group));
    } else {
      setExpandedGroups([...expandedGroups, group]);
    }
  };

  // 分组（搜索时拍平，不分组）
  const groupedSessions: Record<string, typeof sessionsWithIndex> = {};
  const rootSessions: typeof sessionsWithIndex = [];

  if (!searchQuery) {
    filteredSessions.forEach(s => {
      if (s.group && s.group.trim() !== '') {
        const g = s.group.trim();
        if (!groupedSessions[g]) groupedSessions[g] = [];
        groupedSessions[g].push(s);
      } else {
        rootSessions.push(s);
      }
    });
  }

  const renderSessionItem = (session: typeof sessionsWithIndex[0]) => {
    const idx = session.originalIndex;
    const isSelected = selectedSessionIndex === idx;
    const addr = session.protocol === 'local'
      ? t('connection.protocol.local')
      : [session.username, session.host].filter(Boolean).join('@');
    const isOpen = openHostKeys.has(addr);
    const title = session.isDraft ? t('connection.draftTitle') : (session.alias || addr || t('connection.untitled'));

    return (
      <div
        key={session.id || idx}
        className={`group relative w-full grid items-center gap-[9px] px-2 py-[7px] rounded-[7px]
                    transition-colors [grid-template-columns:6px_minmax(0,1fr)_auto] ${
          isSelected ? 'bg-surf shadow-[inset_2px_0_0_var(--color-primary)]' : 'hover:bg-surf'
        }`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${isOpen ? 'bg-ok' : 'bg-ink-3/50'}`} />

        <button
          type="button"
          onClick={() => { setSelectedSessionIndex(idx); setActiveTabId(null); }}
          className="min-w-0 text-left"
        >
          <span className={`block truncate text-[12.5px] font-medium ${isSelected ? 'text-ink' : 'text-ink-2 group-hover:text-ink'}`}>
            {title}
          </span>
          <span className="block truncate font-mono text-[10.5px] text-ink-3 mt-px">
            {session.isDraft ? t('connection.draftHint') : addr}
          </span>
        </button>

        {/* 静置时显示自启标记，悬停换成操作 */}
        <div className="flex items-center justify-end">
          {Boolean(session.autoStart) && (
            <Zap className="w-3 h-3 text-warn group-hover:hidden" />
          )}
          <div className="hidden group-hover:flex items-center gap-0.5">
            <IconBtn title={t('sidebar.editSession')} onClick={(e) => { e.stopPropagation(); setSelectedSessionIndex(idx); setActiveTabId(null); }}>
              <Edit2 className="w-3 h-3" />
            </IconBtn>
            <IconBtn
              title={t('sidebar.autoStartSession')}
              onClick={(e) => onToggleAutoStart(e, sessions[idx])}
              className={session.autoStart ? 'text-warn' : ''}
            >
              <Zap className="w-3 h-3" />
            </IconBtn>
            <IconBtn title={t('sidebar.deleteSession')} hover="down" onClick={(e) => onDeleteSession(e, sessions[idx])}>
              <X className="w-3 h-3" />
            </IconBtn>
          </div>
        </div>
      </div>
    );
  };

  if (isSidebarCollapsed) {
    return (
      <div className={`drag-region h-full w-full flex flex-col items-center ${topPad} border-r border-line-soft`}>
        <button
          type="button"
          onClick={() => setIsSidebarCollapsed(false)}
          title={t('sidebar.expand')}
          className="no-drag-region w-[30px] h-[30px] rounded-[7px] grid place-items-center
                     text-ink-3 transition-colors hover:bg-surf hover:text-ink-2"
        >
          <PanelLeftOpen className="w-4 h-4" />
        </button>
      </div>
    );
  }

  const activeWs = workspaces.find((w: any) => typeof w === 'object' ? w.id === activeWorkspaceId : w === activeWorkspaceId);
  const displayName = activeWs && typeof activeWs === 'object' ? activeWs.name || activeWorkspaceId : activeWorkspaceId;

  return (
    <div className={`drag-region h-full w-full flex flex-col gap-[11px] px-3 pb-3.5 ${topPad}
                     border-r border-line-soft min-w-0`}>

      <div className="no-drag-region flex items-center justify-between gap-2 px-0.5">
        <b className="min-w-0 truncate text-xs font-semibold text-ink-2" title={displayName}>
          {displayName}
        </b>
        <button
          type="button"
          onClick={() => setIsSidebarCollapsed(true)}
          title={t('sidebar.collapse')}
          className="flex-none w-[22px] h-[22px] rounded-md grid place-items-center
                     text-ink-3 transition-colors hover:bg-surf hover:text-ink-2"
        >
          <PanelLeftClose className="w-[15px] h-[15px]" />
        </button>
      </div>

      <div className="no-drag-region flex items-center gap-2 h-8 px-2.5 rounded-lg bg-panel border border-line-soft
                      focus-within:border-primary/60 transition-colors">
        <Search className="w-3.5 h-3.5 flex-none text-ink-3" />
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          type="text"
          spellCheck={false}
          placeholder={t('sidebar.search')}
          className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[12.5px]
                     text-ink placeholder:text-ink-3"
        />
      </div>

      <div className="no-drag-region flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col gap-[11px]">
        {isVaultLocked ? (
          <div className="flex flex-col items-center gap-3.5 p-4 rounded-[10px] border border-down/25 bg-down/5">
            <div className="w-10 h-10 rounded-[10px] grid place-items-center border border-down/25 bg-down/10">
              <Lock className="w-[18px] h-[18px] text-down" />
            </div>
            <div className="flex flex-col items-center gap-1 text-center">
              <div className="text-[11px] font-semibold tracking-[0.14em] uppercase text-down">
                {t('sidebar.vaultLocked')}
              </div>
              <div className="font-mono text-[10px] leading-relaxed text-ink-3">
                AES-256-GCM
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsUnlockModalOpen(true)}
              className="w-full h-8 flex items-center justify-center gap-1.5 rounded-lg
                         border border-down/30 bg-down/10 text-[11.5px] font-medium text-down
                         transition-colors hover:bg-down/20 hover:border-down/50"
            >
              <KeyRound className="w-3.5 h-3.5" />
              {t('sidebar.unlockVault')}
            </button>
          </div>
        ) : (
          <>
            {searchQuery ? (
              filteredSessions.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-ink-3">{t('sidebar.noMatch')}</div>
              ) : (
                <div className="flex flex-col gap-px">{filteredSessions.map(s => renderSessionItem(s))}</div>
              )
            ) : (
              <>
                {Object.entries(groupedSessions).sort(([a], [b]) => a.localeCompare(b)).map(([groupName, groupSessions]) => {
                  const isExpanded = expandedGroups.includes(groupName);
                  return (
                    <div key={`group-${groupName}`}>
                      <button
                        type="button"
                        onClick={() => toggleGroup(groupName)}
                        className="w-full flex items-center gap-1 px-0.5 mb-1 text-[10.5px] font-semibold
                                   uppercase tracking-[0.1em] text-ink-3 transition-colors hover:text-ink-2"
                      >
                        {isExpanded
                          ? <ChevronDown className="w-3 h-3 flex-none" />
                          : <ChevronRight className="w-3 h-3 flex-none" />}
                        <span className="truncate">{groupName}</span>
                        <span className="font-mono normal-case tracking-normal">· {groupSessions.length}</span>
                      </button>
                      {isExpanded && (
                        <div className="flex flex-col gap-px">{groupSessions.map(s => renderSessionItem(s))}</div>
                      )}
                    </div>
                  );
                })}

                {rootSessions.length > 0 && (
                  <div>
                    {Object.keys(groupedSessions).length > 0 && (
                      <div className="px-0.5 mb-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-3">
                        {t('sidebar.savedSessions')}
                      </div>
                    )}
                    <div className="flex flex-col gap-px">{rootSessions.map(s => renderSessionItem(s))}</div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      <button
        type="button"
        onClick={onAddSession}
        className="no-drag-region flex-none flex items-center justify-center gap-[7px] h-[34px] w-full
                   rounded-lg border border-dashed border-line text-[12.5px] text-ink-2
                   transition-colors hover:border-primary hover:text-primary"
      >
        <Plus className="w-3.5 h-3.5" />
        {t('sidebar.newConnection')}
      </button>
    </div>
  );
};

/* ── 小件 ─────────────────────────────────────────────────────────── */

const IconBtn: React.FC<{
  onClick: (e: React.MouseEvent) => void;
  title?: string;
  className?: string;
  hover?: 'primary' | 'down';
  children: React.ReactNode;
}> = ({ onClick, title, className = '', hover = 'primary', children }) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    className={`w-[18px] h-[18px] rounded grid place-items-center text-ink-3 transition-colors
                ${hover === 'down' ? 'hover:bg-down/15 hover:text-down' : 'hover:bg-surf-2 hover:text-ink'}
                ${className}`}
  >
    {children}
  </button>
);
