import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Server, Terminal as TerminalIcon, Command, Settings, Plus, Lock, Box, Edit2, Play, Copy, Trash2, SearchX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePluginStore } from '../store/pluginStore';
import { useCryptoStore } from '../store/cryptoStore';
import { useAppStore } from '../store/appStore';
import { useSessionStore } from '../store/sessionStore';
import { motion, AnimatePresence } from 'framer-motion';
import Fuse from 'fuse.js';

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

type UnifiedItemType = 'action' | 'host' | 'plugin';

interface UnifiedItem {
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
        icon: <Plus className="w-4 h-4 text-emerald-500" />,
        onSelect: () => {
          onClose();
          const btn = document.querySelector('.sidebar-add-btn') as HTMLButtonElement | null;
          if (btn) btn.click();
        }
      },
      {
        id: 'qa-settings',
        type: 'action',
        title: t('settings.title', 'Settings'),
        icon: <Settings className="w-4 h-4 text-slate-500" />,
        onSelect: () => {
          onClose();
          const settingsBtn = document.querySelector('button[title="Settings"], button[title="设置"]') as HTMLButtonElement | null;
          if (settingsBtn) settingsBtn.click();
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

    return items;
  }, [sessions, installedPlugins, masterPassword, t, onConnect, onOpenPlugin, onClose, setCryptoMode]);

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
    const q = searchQuery.trim();
    if (!q) return baseItems;

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

    return results;
  }, [searchQuery, baseItems, fuse, onClose, onConnect]);

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

  const drawerItems = useMemo(() => {
    if (!activeItem) return [];
    const items = [];
    
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
          <div 
            ref={listRef}
            className="max-h-[60vh] overflow-y-auto p-2 scrollbar-hide"
          >
            {unifiedItems.length === 0 ? (
              <div className="py-16 flex flex-col items-center justify-center text-center">
                <SearchX className="w-12 h-12 text-neutral-600 mb-4 opacity-50" />
                <div className="text-base font-medium opacity-80 mb-1">
                  No results found for '{searchQuery}'
                </div>
                <div className="text-xs text-neutral-500">
                  Press <kbd className="font-mono bg-white/10 px-1 rounded mx-0.5">Enter</kbd> to create a new profile with this name.
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1 relative">
                {unifiedItems.map((item, idx) => {
                  const isActive = idx === activeIndex;
                  return (
                    <div
                      key={item.id}
                      onClick={() => { setActiveIndex(idx); item.onSelect(); }}
                      onMouseEnter={() => setActiveIndex(idx)}
                      className={`relative flex items-center justify-between p-3 rounded-xl cursor-pointer group transition-colors`}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="active-bg"
                          transition={{ type: 'spring', stiffness: 350, damping: 30, mass: 1 }} // Preset C (Apple Fluid)
                          className={`absolute inset-0 rounded-xl pointer-events-none ${isDark ? 'bg-white/10' : 'bg-black/5'}`}
                        />
                      )}
                      
                      <div className="relative z-10 flex items-center gap-3">
                        <div className={`p-1.5 rounded-md ${isDark ? 'bg-white/5' : 'bg-black/5'}`}>
                          {item.icon}
                        </div>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium leading-none">{item.title}</span>
                          {item.subtitle && <span className="text-xs opacity-50 mt-1 leading-none">{item.subtitle}</span>}
                        </div>
                      </div>

                      {isActive && (
                        <div className="relative z-10 flex items-center gap-2">
                          <kbd className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${isDark ? 'border-white/20' : 'border-black/20'}`}>
                            ⌘K
                          </kbd>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          
          {/* Footer */}
          <div className={`px-4 py-2 text-[10px] flex items-center justify-between border-t ${isDark ? 'border-white/5 text-white/30' : 'border-black/5 text-slate-400'}`}>
            <span>GETSSH Command Center V2.0</span>
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
        <AnimatePresence>
          {isActionMenuOpen && activeItem && (
            <motion.div
              initial={{ x: -20, opacity: 0, scale: 0.95 }}
              animate={{ x: 16, opacity: 1, scale: 1 }}
              exit={{ x: -10, opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 400, damping: 35 }}
              className={`relative pointer-events-auto shrink-0 w-[240px] shadow-2xl rounded-2xl border flex flex-col p-2 ${
                isDark ? 'bg-[#151515]/90 border-white/10 water-glass text-white' : 'bg-white/95 border-black/10 text-slate-900 backdrop-blur-xl'
              }`}
            >
              <div className="px-3 py-2 text-xs font-bold uppercase opacity-50 border-b mb-2 pb-2 border-current/10 flex justify-between items-center">
                {t('commandCenter.actions', 'ACTIONS')}
              </div>
              <div className="flex flex-col gap-1">
                {drawerItems.map((item, i) => {
                  const isActive = activeDrawerIndex === i;
                  return (
                    <button 
                      key={i}
                      id={`drawer-btn-${i}`}
                      onClick={() => item.action()}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between group transition-colors relative ${
                        isActive 
                          ? (item.isDestructive && deleteConfirmId === activeItem.id 
                              ? 'bg-red-500/20 text-red-500' 
                              : isDark ? 'bg-white/10' : 'bg-black/5')
                          : (item.isDestructive && deleteConfirmId === activeItem.id 
                              ? 'text-red-500'
                              : isDark ? 'hover:bg-white/10' : 'hover:bg-black/5')
                      }`}
                    >
                      <span className={`flex items-center gap-2 ${item.isDestructive ? 'text-red-500' : ''}`}>
                        {item.icon} {item.label}
                      </span>
                      {item.shortcut && <kbd className="text-[10px] opacity-40">{item.shortcut}</kbd>}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        
      </div>
    </motion.div>
  );
};

const PluginDetailsModal = ({ plugin, isDark, onClose }: { plugin: any, isDark: boolean, onClose: () => void }) => {
  const schema = usePluginStore(state => state.settingsSchemas[plugin.name]);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      if (!schema) return;
      const data: Record<string, any> = {};
      await Promise.all(
        schema.map(async (field: any) => {
          const val = await window.electronAPI.pluginStorageGet(plugin.name, field.id);
          data[field.id] = val !== null && val !== undefined ? val : field.default;
        })
      );
      setFormData(data);
    };
    loadData();
  }, [plugin.name, schema]);

  const handleSavePluginSettings = async () => {
    setSaving(true);
    try {
      await Promise.all(
        Object.entries(formData).map(([key, value]) =>
          window.electronAPI.pluginStorageSet(plugin.name, key, value)
        )
      );
      await window.electronAPI.reloadPlugin(plugin.name);
      onClose();
    } catch (err: any) {
      alert(`Failed to save settings: ${err.message}`);
    }
    setSaving(false);
  };

  const displayName = plugin.getssh?.name || plugin.displayName || plugin.name;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, y: 10 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className={`absolute inset-0 z-50 flex flex-col p-6 overflow-hidden ${isDark ? 'bg-[#121214]/95 backdrop-blur-3xl' : 'bg-white/95 backdrop-blur-3xl'}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-6 shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center">
             <Box className="w-6 h-6 text-purple-500" />
          </div>
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              {displayName}
              <span className="text-xs font-mono opacity-50 px-2 py-0.5 rounded border border-current/10">v{plugin.version}</span>
            </h2>
            <p className="text-sm opacity-60 mt-0.5">{plugin.description}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
        {!schema || schema.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center opacity-50 bg-white/5 px-6 py-4 rounded-xl border border-white/5">
              {t('commandCenter.noParameters', 'This plugin does not expose any configurable parameters.')}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <h3 className="text-xs font-bold uppercase opacity-50 tracking-widest border-b border-current/10 pb-2 mb-4">Parameters</h3>
            {schema.map((field: any) => (
              <div key={field.id} className="flex flex-col gap-1.5 mb-4">
                <label className="text-sm font-semibold opacity-80">{field.label}</label>
                {field.description && <span className="text-xs opacity-50">{field.description}</span>}
                
                {field.type === 'boolean' ? (
                  <input 
                    type="checkbox" 
                    checked={!!formData[field.id]}
                    onChange={e => setFormData({ ...formData, [field.id]: e.target.checked })}
                    className="mt-1 w-4 h-4"
                  />
                ) : field.type === 'password' ? (
                  <input 
                    type="password"
                    value={formData[field.id] || ''}
                    onChange={e => setFormData({ ...formData, [field.id]: e.target.value })}
                    className={`px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all ${isDark ? 'bg-black/20 border-white/10' : 'bg-white border-black/10'}`}
                  />
                ) : field.type === 'number' ? (
                  <input 
                    type="number"
                    value={formData[field.id] || ''}
                    onChange={e => setFormData({ ...formData, [field.id]: parseFloat(e.target.value) })}
                    className={`px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all ${isDark ? 'bg-black/20 border-white/10' : 'bg-white border-black/10'}`}
                  />
                ) : (
                  <input 
                    type="text"
                    value={formData[field.id] || ''}
                    onChange={e => setFormData({ ...formData, [field.id]: e.target.value })}
                    className={`px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all ${isDark ? 'bg-black/20 border-white/10' : 'bg-white border-black/10'}`}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-current/10 shrink-0">
        <button 
          onClick={onClose}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isDark ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
        >
          Close
        </button>
        {schema && schema.length > 0 && (
          <button 
            onClick={handleSavePluginSettings}
            disabled={saving}
            className="px-6 py-2 bg-purple-600 hover:bg-purple-500 active:scale-95 transition-all rounded-lg font-medium shadow-lg shadow-purple-500/20"
          >
            {t('commandCenter.saveReload', 'Save & Reload')}
          </button>
        )}
      </div>
    </motion.div>
  );
};
