import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Server, Terminal as TerminalIcon, Command, Settings, Plus, Lock, Box, Edit2, Play, Copy, Trash2, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePluginStore } from '../store/pluginStore';
import { useCryptoStore } from '../store/cryptoStore';
import { useAppStore } from '../store/appStore';
import { useMoovierFocus } from '@moovier/core';
import { useSessionStore } from '../store/sessionStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { motion, AnimatePresence } from 'framer-motion';
import Fuse from 'fuse.js';

import { PluginDetailsModal } from './command-center/PluginDetailsModal';
import { CommandCenterList } from './command-center/CommandCenterList';
import { ActionDrawer, ActionDrawerItem } from './command-center/ActionDrawer';

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

export const CommandCenter: React.FC<CommandCenterProps> = ({ isOpen, onClose, onConnect, onOpenPlugin, onDeleteSession, isDark, sessions }) => {
  const { t } = useTranslation();
  const installedPlugins = usePluginStore(state => state.installedPlugins);
  const setCryptoMode = useCryptoStore(state => state.setCryptoMode);
  const masterPassword = useCryptoStore(state => state.masterPassword);
  const isPolluted = useAppStore(state => state.isPolluted);
  const watchdogStatus = useAppStore(state => state.watchdogStatus);
  const runbooks = useWorkspaceStore(state => state.runbooks);
  
  const { setActiveTileId } = useMoovierFocus();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const [activeDrawerIndex, setActiveDrawerIndex] = useState(0);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [inspectingPlugin, setInspectingPlugin] = useState<any | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isPolluted && window.electronAPI?.invoke) {
      window.electronAPI.invoke('get-watchdog-status').then(() => {
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
      setInspectingPlugin(null);
      
      // Phase 3: Trigger Cinematic Focus Pulling globally
      setActiveTileId('overlay-cmd-center');
    } else {
      // Release focus when closed
      setActiveTileId(null);
    }
  }, [isOpen, setActiveTileId]);

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
        icon: <Plus className="w-4 h-4 text-emerald-500" />,
        onSelect: () => {
          onClose();
          window.dispatchEvent(new CustomEvent('app:create-session', { detail: '' }));
        }
      },
      {
        id: 'qa-settings',
        type: 'action',
        title: t('settings.title', 'Settings'),
        icon: <Settings className="w-4 h-4 text-slate-500" />,
        onSelect: () => {
          onClose();
          window.dispatchEvent(new CustomEvent('app:open-settings'));
        }
      },
      {
        id: 'qa-lock',
        type: 'action',
        title: t('welcome.lockProfile', 'Lock Profile'),
        subtitle: !masterPassword ? t('welcome.lockProfileDisabledTip', 'Password required') : undefined,
        icon: <Lock className="w-4 h-4 text-red-500" />,
        onSelect: () => {
          if (masterPassword) {
            onClose();
            setCryptoMode('locked');
            useCryptoStore.getState().setMasterPassword('');
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
      icon: <Server className="w-4 h-4 text-blue-500" />,
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
      icon: <Box className="w-4 h-4 text-purple-500" />,
      data: p,
      onSelect: () => {
        onClose();
        if (onOpenPlugin) {
          onOpenPlugin(p);
        } else {
          // Fallback if not provided
          useAppStore.setState(state => {
            const settingsBtn = document.querySelector('button[title="Settings"], button[title="设置"]') as HTMLButtonElement | null;
            if (settingsBtn) settingsBtn.click();
            return state;
          });
        }
      }
    })));

    // 4. Workspace Runbooks
    items.push(...runbooks.map((r, idx) => ({
      id: `runbook-${idx}-${r.id}`,
      type: 'runbook' as UnifiedItemType,
      title: r.name,
      subtitle: r.description,
      icon: <Command className={`w-4 h-4 ${r.dangerLevel === 'high' ? 'text-amber-500' : 'text-slate-400'}`} />,
      data: r,
      onSelect: () => {
        onClose();
        const event = new CustomEvent('app:runbook-execute', { detail: r });
        window.dispatchEvent(event);
      }
    })));

    return items;
  }, [sessions, installedPlugins, runbooks, masterPassword, t, onConnect, onOpenPlugin, onClose, setCryptoMode]);

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
        icon: <TerminalIcon className="w-4 h-4 text-cyan-500" />,
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
        if (inspectingPlugin) {
          setInspectingPlugin(null);
          inputRef.current?.focus();
        } else if (isActionMenuOpen) {
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
        if (unifiedItems.length > 0) {
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
        if (unifiedItems.length > 0) {
          unifiedItems[activeIndex].onSelect();
        } else if (searchQuery.trim().length > 0) {
          onClose();
          const event = new CustomEvent('app:create-session', { detail: searchQuery.trim() });
          window.dispatchEvent(event);
        }
      } else if (e.key === 'ArrowRight') {
        if (unifiedItems.length > 0) {
          e.preventDefault();
          setIsActionMenuOpen(true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [unifiedItems, activeIndex, isActionMenuOpen, onClose, activeDrawerIndex, inspectingPlugin]);

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
      icon: <Play className="w-4 h-4 opacity-70" />,
      shortcut: '↵',
      action: () => activeItem.onSelect()
    });

    if (activeItem.type === 'host') {
      items.push({
        label: t('commandCenter.copyIP', 'Copy IP'),
        icon: <Copy className="w-4 h-4 opacity-70" />,
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
        icon: <Edit2 className="w-4 h-4 opacity-70" />,
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
          icon: <Trash2 className="w-4 h-4 opacity-70" />,
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
        label: t('commandCenter.pluginParameters', 'Plugin Parameters'),
        icon: <Settings className="w-4 h-4 opacity-70" />,
        action: () => {
          setInspectingPlugin(activeItem.data);
          setIsActionMenuOpen(false);
        }
      });
    }

    return items;
  }, [activeItem, deleteConfirmId, onDeleteSession, sessions, onClose]);

  // Adjust activeDrawerIndex if it goes out of bounds
  useEffect(() => {
    if (activeDrawerIndex >= drawerItems.length) {
      setActiveDrawerIndex(Math.max(0, drawerItems.length - 1));
    }
  }, [drawerItems.length, activeDrawerIndex]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9999] flex items-start pt-[12vh] justify-center bg-black/40 backdrop-blur-sm"
      onClick={handleBackdropClick}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <div className="relative flex items-start justify-center w-full max-w-5xl px-4 pointer-events-none">
        
        {/* Main Command Center Panel */}
        <motion.div
          initial={{ y: 20, opacity: 0, scale: 0.98 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 10, opacity: 0, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 350, damping: 30, mass: 1 }}
          className={`relative w-[650px] shrink-0 pointer-events-auto shadow-2xl rounded-2xl overflow-hidden flex flex-col border ${
            isDark ? 'bg-[#151515]/80 border-white/10 water-glass text-white' : 'bg-white/90 border-black/10 text-slate-900 backdrop-blur-xl'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Alert Banner */}
          {isPolluted && (
            <div className={`w-full px-4 py-3 flex items-center justify-center gap-2 border-b text-sm font-bold tracking-widest ${
              watchdogStatus?.level === 'red' ? 'bg-red-500/20 text-red-500 border-red-500/30' : 'bg-yellow-500/20 text-yellow-500 border-yellow-500/30'
            }`}>
              <ShieldAlert className="w-4 h-4 animate-pulse" />
              {watchdogStatus?.level === 'red' ? '⚠️ 当前系统已被污染 (高危)' : '⚠️ 插件高危操作已阻断 (警告)'}
            </div>
          )}

          {/* Header Input */}
          <div className="flex items-center px-4 py-4 border-b border-white/10 shrink-0">
            <Command className="w-5 h-5 opacity-50 mr-3" />
            <input
              ref={inputRef}
              type="text"
              className="w-full bg-transparent border-none outline-none text-lg font-medium placeholder:opacity-40"
              placeholder={t('commandCenter.searchPlaceholder', 'Search actions, hosts, plugins...')}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
            <div className={`text-[10px] font-mono px-2 py-1 rounded border ${isDark ? 'bg-white/5 border-white/10 text-white/40' : 'bg-slate-100 border-slate-200 text-slate-500'}`}>
              {t('commandCenter.escToClose', 'ESC TO CLOSE')}
            </div>
          </div>

          {/* List Area */}
          <CommandCenterList
            ref={listRef}
            unifiedItems={unifiedItems}
            activeIndex={activeIndex}
            setActiveIndex={setActiveIndex}
            searchQuery={searchQuery}
            isDark={isDark}
          />
          
          {/* Footer */}
          <div className={`px-4 py-2 text-[10px] flex items-center justify-between border-t ${isDark ? 'border-white/5 text-white/30' : 'border-black/5 text-slate-400'}`}>
            <span>{t('commandCenter.version', 'GETSSH Command Center V2.0')}</span>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 bg-white/10 rounded font-mono text-[10px]">↑</kbd> <kbd className="px-1.5 py-0.5 bg-white/10 rounded font-mono text-[10px]">↓</kbd> {t('commandCenter.navigate', 'Navigate')}</span>
              <span className="flex items-center gap-1.5"><kbd className="px-1.5 py-0.5 bg-white/10 rounded font-mono text-[10px]">↵</kbd> {t('commandCenter.select', 'Select')}</span>
            </div>
          </div>
          
          {/* Plugin Details Modal Overlay */}
          <AnimatePresence>
            {inspectingPlugin && (
              <PluginDetailsModal 
                plugin={inspectingPlugin} 
                isDark={isDark} 
                onClose={() => { setInspectingPlugin(null); inputRef.current?.focus(); }} 
              />
            )}
          </AnimatePresence>
        </motion.div>

        {/* Action Drawer */}
        <ActionDrawer
          isOpen={isActionMenuOpen}
          isDark={isDark}
          drawerItems={drawerItems}
          activeDrawerIndex={activeDrawerIndex}
          activeItemId={activeItem?.id || null}
          deleteConfirmId={deleteConfirmId}
        />
        
      </div>
    </motion.div>
  );
};
