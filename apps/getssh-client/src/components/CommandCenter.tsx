import React, { useState, useMemo, useEffect, useRef } from 'react';
import { lockActiveWorkspace } from '../lib/workspaceUnlock';
import { Server, Terminal as TerminalIcon, Search, Settings, Plus, Lock, Box, Edit2, Play, Copy, Trash2, ShieldAlert, Sparkles, BookOpen, Database } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePluginStore } from '../store/pluginStore';
import { useCryptoStore } from '../store/cryptoStore';
import { useAppStore } from '../store/appStore';
import { useSessionStore } from '../store/sessionStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { motion, useReducedMotion } from 'framer-motion';
import Fuse from 'fuse.js';

import { CommandCenterList } from './command-center/CommandCenterList';
import { ActionDrawer, ActionDrawerItem } from './command-center/ActionDrawer';
import { CommandCenterAiChat } from './command-center/CommandCenterAiChat';

interface CommandCenterProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (session: any) => void;
  onOpenPlugin?: (plugin: any) => void;
  onDeleteSession?: (session: any) => void;
  isDark: boolean;
  appConfig: any;
  sessions: any[];
}

export type UnifiedItemType = 'action' | 'host' | 'plugin' | 'runbook';

export interface UnifiedItem {
  id: string;
  type: UnifiedItemType;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  data?: any;
  onSelect: () => void;
}

export const CommandCenter: React.FC<CommandCenterProps> = ({ isOpen, onClose, onConnect, onOpenPlugin, onDeleteSession, isDark, appConfig, sessions }) => {
  const { t, i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const reduceMotion = useReducedMotion();
  const installedPlugins = usePluginStore(state => state.installedPlugins);
  const setCryptoMode = useCryptoStore(state => state.setCryptoMode);
  const workspaceUnprotected = useCryptoStore(state => state.workspaceUnprotected);
  const isPolluted = useAppStore(state => state.isPolluted);
  const sentinelStatus = useAppStore(state => state.sentinelStatus);
  const runbooks = useWorkspaceStore(state => state.runbooks);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const [activeDrawerIndex, setActiveDrawerIndex] = useState(0);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isAiMode, setIsAiMode] = useState(false);
  const [mcpPrompts, setMcpPrompts] = useState<any[]>([]);
  const [mcpResources, setMcpResources] = useState<any[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && window.electronAPI?.mcp) {
      window.electronAPI.mcp.getPrompts().then(res => {
        if (res.success && res.prompts) setMcpPrompts(res.prompts);
      });
      window.electronAPI.mcp.getResources().then(res => {
        if (res.success && res.resources) setMcpResources(res.resources);
      });
    }
  }, [isOpen]);

  useEffect(() => {
    if (isPolluted && window.electronAPI?.invoke) {
      window.electronAPI.invoke('get-sentinel-status').then(() => {
        // Status retrieved
      });
    }
  }, [isPolluted]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
      setSearchQuery('');
      setActiveIndex(0);
      setIsActionMenuOpen(false);
      setActiveDrawerIndex(0);
      setDeleteConfirmId(null);
      setIsAiMode(false);
      
    }
  }, [isOpen]);

  useEffect(() => {
    setDeleteConfirmId(null);
    setActiveDrawerIndex(0);
  }, [activeIndex, isActionMenuOpen]);

  // Construct Base Unified List
  const baseItems = useMemo<UnifiedItem[]>(() => {
    const items: UnifiedItem[] = [];

    // 1. Quick Actions
    const quickActions: UnifiedItem[] = [
      {
        id: 'qa-new',
        type: 'action',
        title: t('sidebar.newConnection', 'New Session'),
        icon: <Plus className="w-4 h-4 text-ink-3" />,
        onSelect: () => {
          onClose();
          window.dispatchEvent(new CustomEvent('app:create-session', { detail: '' }));
        }
      },
      {
        id: 'qa-settings',
        type: 'action',
        title: t('settings.title', 'Settings'),
        icon: <Settings className="w-4 h-4 text-ink-3" />,
        onSelect: () => {
          onClose();
          window.dispatchEvent(new CustomEvent('app:open-settings'));
        }
      },
      {
        id: 'qa-lock',
        type: 'action',
        title: t('welcome.lockProfile', 'Lock Profile'),
        subtitle: workspaceUnprotected ? t('welcome.lockProfileDisabledTip', 'Password required') : undefined,
        icon: <Lock className="w-4 h-4 text-ink-3" />,
        onSelect: () => {
          // Only a workspace with its own password (or a master password) can be locked.
          if (!workspaceUnprotected) {
            onClose();
            void lockActiveWorkspace();
          }
        }
      }
    ];

    items.push(...quickActions);

    // 2. Remote Hosts
    items.push(...sessions.map((s, idx) => ({
      id: `host-${idx}-${s.host}`,
      type: 'host' as UnifiedItemType,
      title: s.alias || `${s.username}@${s.host}`,
      subtitle: s.host,
      icon: <Server className="w-4 h-4 text-ink-3" />,
      data: s,
      onSelect: () => {
        onClose();
        onConnect(s);
      }
    })));

    // 3. Plugins
    items.push(...installedPlugins.map((p: any, idx) => ({
      id: `plugin-${idx}-${p.name}`,
      type: 'plugin' as UnifiedItemType,
      title: p.getssh?.name || p.displayName || p.name,
      subtitle: `v${p.version}`,
      icon: <Box className="w-4 h-4 text-ink-3" />,
      data: p,
      onSelect: () => {
        onClose();
        if (onOpenPlugin) {
          onOpenPlugin(p);
        } else {
          window.dispatchEvent(new CustomEvent('app:open-center', {
            detail: { type: 'plugin', title: t('statusBar.plugins', 'Plugins') },
          }));
        }
      }
    })));

    // 4. Workspace Runbooks
    items.push(...runbooks.map((r, idx) => ({
      id: `runbook-${idx}-${r.id}`,
      type: 'runbook' as UnifiedItemType,
      title: r.name,
      subtitle: r.description,
        icon: <TerminalIcon className={`w-4 h-4 ${r.dangerLevel === 'high' ? 'text-warn' : 'text-ink-3'}`} />,
      data: r,
      onSelect: () => {
        onClose();
        const event = new CustomEvent('app:runbook-execute', { detail: r });
        window.dispatchEvent(event);
      }
    })));

    // 5. MCP Prompts & Workflows (Slash commands)
    items.push(...mcpPrompts.map((p, idx) => ({
      id: `mcp-prompt-${idx}-${p.prompt.name}`,
      type: 'action' as UnifiedItemType,
      title: `/${p.prompt.name}`,
      subtitle: `[MCP: ${p.serverName}] ${p.prompt.description || 'External Workflow'}`,
      icon: <BookOpen className="w-4 h-4 text-ink-3" />,
      data: p,
      onSelect: async () => {
        try {
          setIsAiMode(true);
          if (window.electronAPI?.mcp) {
            const res = await window.electronAPI.mcp.getPrompt(p.serverId, p.prompt.name);
            if (res.success && res.prompt?.messages) {
              const promptText = res.prompt.messages.map((m: any) => m.content?.text).filter(Boolean).join('\n');
              window.dispatchEvent(new CustomEvent('ai:submit-prompt', { detail: promptText }));
            }
          }
        } catch (err) {
          console.error(`[CommandCenter] MCP Prompt '${p.prompt.name}' failed:`, err);
        }
      }
    })));

    // 6. MCP Resources (@ references)
    items.push(...mcpResources.map((r, idx) => ({
      id: `mcp-resource-${idx}-${r.resource.uri}`,
      type: 'action' as UnifiedItemType,
      title: `@${r.resource.name || r.resource.uri}`,
      subtitle: `[MCP: ${r.serverName}] ${r.resource.uri}`,
      icon: <Database className="w-4 h-4 text-ink-3" />,
      data: r,
      onSelect: async () => {
        try {
          setIsAiMode(true);
          if (window.electronAPI?.mcp) {
            const res = await window.electronAPI.mcp.readResource(r.serverId, r.resource.uri);
            if (res.success && res.data?.contents) {
              const contentText = res.data.contents.map((c: any) => c.text).filter(Boolean).join('\n');
              window.dispatchEvent(new CustomEvent('ai:submit-prompt', {
                detail: `[Attached MCP Resource: ${r.resource.uri}]\n\`\`\`\n${contentText}\n\`\`\`\nPlease analyze this resource.`
              }));
            }
          }
        } catch (err) {
          console.error(`[CommandCenter] MCP Resource '${r.resource.uri}' failed:`, err);
        }
      }
    })));

    return items;
  }, [sessions, installedPlugins, runbooks, mcpPrompts, mcpResources, workspaceUnprotected, t, onConnect, onOpenPlugin, onClose, setCryptoMode]);

  const fuse = useMemo(() => {
    return new Fuse(baseItems, {
      keys: [
        { name: 'title', weight: 2.0 },
        { name: 'data.alias', weight: 2.0 },
        { name: 'subtitle', weight: 1.5 },
        { name: 'data.host', weight: 1.5 },
        { name: 'data.username', weight: 1.0 },
        { name: 'data.description', weight: 1.0 },
        { name: 'id', weight: 0.5 }
      ],
      threshold: 0.3,
      ignoreLocation: true,
    });
  }, [baseItems]);

  const unifiedItems = useMemo<UnifiedItem[]>(() => {
    const wrapSelect = (items: UnifiedItem[]) => items.map(item => ({
      ...item,
      onSelect: () => {
        const counts = JSON.parse(localStorage.getItem('cc-usage-counts') || '{}');
        counts[item.id] = (counts[item.id] || 0) + 1;
        localStorage.setItem('cc-usage-counts', JSON.stringify(counts));
        item.onSelect();
      }
    }));

    const q = searchQuery.trim();
    if (!q) {
      const counts = JSON.parse(localStorage.getItem('cc-usage-counts') || '{}');
      const sortedBaseItems = [...baseItems].sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0));
      return wrapSelect(sortedBaseItems);
    }

    const results = fuse.search(q).map(result => result.item);

    // Add fallback for pure SSH string
    if (q.includes('@') && results.length === 0) {
      let username = '';
      let host = q;
      [username, host] = q.split('@');
      
      results.push({
        id: 'quick-connect',
        type: 'host',
        title: t('commandCenter.quickConnect', 'Quick Connect to {{host}}', { host: q }),
        icon: <TerminalIcon className="w-4 h-4 text-ink-3" />,
        onSelect: () => {
          onClose();
          onConnect({ host, username, protocol: 'ssh' });
        }
      });
    }

    return wrapSelect(results);
  }, [searchQuery, baseItems, fuse, onClose, onConnect, t]);

  // Reset activeIndex when searchQuery changes
  useEffect(() => {
    setActiveIndex(0);
  }, [searchQuery]);

  // Adjust active index if it goes out of bounds when searching
  useEffect(() => {
    if (activeIndex >= unifiedItems.length) {
      setActiveIndex(Math.max(0, unifiedItems.length - 1));
    }
  }, [unifiedItems.length, activeIndex]);

  // Keyboard Navigation & Action Drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. Two-Stage Escape
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (isActionMenuOpen) {
          setIsActionMenuOpen(false);
          inputRef.current?.focus();
        } else {
          onClose();
        }
        return;
      }

      // 2. Cmd+K / Ctrl+K Toggle Action Drawer
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopPropagation();
        if (!isAiMode && unifiedItems.length > 0) {
          setIsActionMenuOpen(prev => !prev);
        }
        return;
      }

      if (isActionMenuOpen) {
        // Drawer Navigation
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActiveDrawerIndex(prev => prev + 1); // We'll cap it at render or dynamically
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActiveDrawerIndex(prev => Math.max(prev - 1, 0));
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setIsActionMenuOpen(false);
          inputRef.current?.focus();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          // Trigger handled in render effect/ref, but simpler: simulate Enter by global state or we refactor drawerItems higher.
          // Let's fire a custom event or just let the activeDrawerIndex trigger via a global callback, but since drawerItems is dynamic, we'll click it.
          const activeDrawerBtn = document.getElementById(`drawer-btn-${activeDrawerIndex}`);
          if (activeDrawerBtn) activeDrawerBtn.click();
        }
        return;
      }

      // Main List Navigation
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex(prev => Math.min(prev + 1, unifiedItems.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (isAiMode && searchQuery.trim()) {
          window.dispatchEvent(new CustomEvent('command-center:ai-submit', { detail: searchQuery.trim() }));
          setSearchQuery('');
        } else if (!isAiMode && unifiedItems.length > 0) {
          unifiedItems[activeIndex].onSelect();
        } else if (searchQuery.trim().length > 0 && !isAiMode) {
          onClose();
          const event = new CustomEvent('app:create-session', { detail: searchQuery.trim() });
          window.dispatchEvent(event);
        }
      } else if (e.key === 'ArrowRight') {
        if (!isAiMode && unifiedItems.length > 0) {
          e.preventDefault();
          setIsActionMenuOpen(true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [unifiedItems, activeIndex, isActionMenuOpen, onClose, activeDrawerIndex, isAiMode, searchQuery]);

  // Handle outside click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const activeItem = unifiedItems[activeIndex];

  const drawerItems = useMemo<ActionDrawerItem[]>(() => {
    if (!activeItem) return [];
    const items: ActionDrawerItem[] = [];
    
    // Execute
    items.push({
      label: t('commandCenter.execute', 'Execute'),
      icon: <Play className="w-4 h-4" />,
      shortcut: '↵',
      action: () => activeItem.onSelect()
    });

    if (activeItem.type === 'host') {
      items.push({
        label: t('commandCenter.copyIP', 'Copy IP'),
        icon: <Copy className="w-4 h-4" />,
        action: () => {
          if (activeItem.data?.host) {
            navigator.clipboard.writeText(activeItem.data.host);
            useAppStore.getState().addToast(t('commandCenter.ipCopied', 'IP Address copied to clipboard'), 'success');
            setTimeout(() => setIsActionMenuOpen(false), 600);
          }
        }
      });

      items.push({
        label: t('commandCenter.editProfile', 'Edit Profile'),
        icon: <Edit2 className="w-4 h-4" />,
        action: () => {
          onClose();
          const idx = sessions.indexOf(activeItem.data);
          if (idx !== -1) {
            useSessionStore.getState().setSelectedSessionIndex(idx);
          }
        }
      });

      if (onDeleteSession) {
        items.push({
          label: deleteConfirmId === activeItem.id ? t('commandCenter.clickToConfirm', 'Click to Confirm') : t('commandCenter.deleteProfile', 'Delete Profile'),
          icon: <Trash2 className="w-4 h-4" />,
          isDestructive: true,
          action: () => {
            if (deleteConfirmId === activeItem.id) {
              onDeleteSession(activeItem.data);
              setIsActionMenuOpen(false);
              setDeleteConfirmId(null);
              useAppStore.getState().addToast(t('commandCenter.profileDeleted', 'Profile deleted successfully'), 'warning');
            } else {
              setDeleteConfirmId(activeItem.id);
            }
          }
        });
      }
    }

    if (activeItem.type === 'plugin') {
      items.push({
        label: zh ? '在插件中心管理' : 'Manage in Plugin Center',
        icon: <Settings className="w-4 h-4" />,
        action: () => {
          onClose();
          setIsActionMenuOpen(false);
          window.dispatchEvent(new CustomEvent('app:open-center', {
            detail: { type: 'plugin', title: t('statusBar.plugins', 'Plugins') },
          }));
        }
      });
    }

    return items;
  }, [activeItem, deleteConfirmId, onDeleteSession, sessions, onClose, t, zh]);

  // Adjust activeDrawerIndex if it goes out of bounds
  useEffect(() => {
    if (activeDrawerIndex >= drawerItems.length) {
      setActiveDrawerIndex(Math.max(0, drawerItems.length - 1));
    }
  }, [drawerItems.length, activeDrawerIndex]);

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reduceMotion ? undefined : { opacity: 0 }}
      transition={{ duration: 0.16 }}
      className="center-workbench fixed inset-0 z-[9999] flex items-start justify-center bg-scrim pt-[10vh]"
      data-glass={appConfig?.enableGlassmorphism ? 'true' : 'false'}
      onClick={handleBackdropClick}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <div className="pointer-events-none relative flex w-full max-w-5xl items-start justify-center px-4">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 7 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: -5 }}
          transition={{ duration: 0.16 }}
          role="dialog"
          aria-modal="true"
          aria-label={t('statusBar.commandCenter', 'Command Center')}
          className={`pointer-events-auto relative flex max-h-[82vh] w-[620px] max-w-[calc(100vw-32px)] shrink-0 flex-col overflow-hidden rounded-[14px] border bg-surf text-ink shadow-[0_24px_70px_rgba(0,0,0,0.28)] ${isAiMode ? 'border-primary/60' : 'border-line'}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-line-soft bg-panel/60 px-4 py-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-ink-2">
              <TerminalIcon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              {t('statusBar.commandCenter', 'Command Center')}
            </div>
            <span className="text-[11px] text-ink-3">{isAiMode ? (zh ? 'AI 调度' : 'AI dispatch') : (zh ? '搜索与执行' : 'Search and execute')}</span>
          </div>

          {isPolluted && (
            <div className={`flex w-full items-center gap-2 border-b px-4 py-2 text-xs font-medium ${
              sentinelStatus?.level === 'red' ? 'bg-down/10 text-down border-down/25' : 'bg-warn/10 text-warn border-warn/25'
            }`}>
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {sentinelStatus?.level === 'red'
                ? (zh ? `${t('statusBar.secure')}报告高危系统状态` : `${t('statusBar.secure')} reports a high-risk system state`)
                : (zh ? `${t('statusBar.secure')}已阻断插件高危操作` : `${t('statusBar.secure')} blocked a high-risk plugin operation`)}
            </div>
          )}

          <div className="relative z-10 flex shrink-0 items-center gap-3 border-b border-line px-4 py-3.5">
            {isAiMode ? <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /> : <Search className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />}
            <input
              ref={inputRef}
              type="text"
              aria-label={isAiMode ? t('commandCenter.aiPlaceholder', 'Ask AI to run commands or open servers...') : t('commandCenter.searchPlaceholder', 'Search actions, hosts, plugins...')}
              className="min-w-0 flex-1 border-none bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3"
              placeholder={isAiMode ? t('commandCenter.aiPlaceholder', 'Ask AI to run commands or open servers...') : t('commandCenter.searchPlaceholder', 'Search actions, hosts, plugins...')}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 py-1.5 text-xs text-ink-2 transition-colors hover:border-primary/50 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              onClick={() => { setIsAiMode(!isAiMode); setIsActionMenuOpen(false); inputRef.current?.focus(); }}
              aria-label={t('commandCenter.aiModeToggle', 'Toggle AI Mode')}
              aria-pressed={isAiMode}
            >
              {isAiMode ? <Search className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
              {isAiMode ? (zh ? '搜索' : 'Search') : 'AI'}
            </button>
          </div>

          {/* List Area */}
          {!isAiMode ? (
            <CommandCenterList
              ref={listRef}
              unifiedItems={unifiedItems}
              activeIndex={activeIndex}
              setActiveIndex={setActiveIndex}
              searchQuery={searchQuery}
            />
          ) : (
            <CommandCenterAiChat 
              onClose={onClose} 
              onConnect={onConnect} 
              isDark={isDark} 
              sessions={sessions} 
            />
          )}
          
          <div className="flex items-center justify-between gap-3 border-t border-line bg-panel/60 px-4 py-2.5 text-[11px] text-ink-3">
            <span>{isAiMode ? (zh ? 'AI 权限遵循智能体模式设置' : 'AI access follows your agent mode') : (zh ? '主机 · 操作 · 插件 · Runbook' : 'Hosts · Actions · Plugins · Runbooks')}</span>
            <div className="flex shrink-0 items-center gap-3">
              {!isAiMode && <span className="hidden items-center gap-1 sm:flex"><kbd className="rounded border border-line px-1 font-mono">↑↓</kbd>{t('commandCenter.navigate', 'Navigate')}</span>}
              <span className="flex items-center gap-1"><kbd className="rounded border border-line px-1 font-mono">↵</kbd>{isAiMode ? (zh ? '发送' : 'Send') : t('commandCenter.select', 'Select')}</span>
              <span className="hidden items-center gap-1 sm:flex"><kbd className="rounded border border-line px-1 font-mono">Esc</kbd>{zh ? '关闭' : 'Close'}</span>
            </div>
          </div>
          <ActionDrawer
            isOpen={isActionMenuOpen}
            drawerItems={drawerItems}
            activeDrawerIndex={activeDrawerIndex}
            activeItemId={activeItem?.id || null}
          />
        </motion.div>
      </div>
    </motion.div>
  );
};
