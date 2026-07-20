import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, X, Settings2, Key, Network, Terminal, Palette, Link2 } from 'lucide-react';
import { detectProtocol } from '../utils/protocolParser';
import { motion } from 'framer-motion';
import type { SessionProfile } from '../store/sessionStore';
import type { AppConfig } from '../store/appStore';
import { TERMINAL_THEMES } from '../utils/themes';

export type ConnectFormSession = Partial<SessionProfile> & { id?: string; name?: string };

interface ConnectFormProps {
  session: ConnectFormSession;
  index: number;
  appConfig: AppConfig;
  isDark: boolean;
  connecting: boolean;
  error: string | null;
  onConnect: (session: ConnectFormSession) => void;
  onUpdateSession: (index: number, updatedSession: ConnectFormSession) => void;
}

export const ConnectForm: React.FC<ConnectFormProps> = ({
  session,
  index,
  appConfig,
  isDark,
  connecting,
  error,
  onConnect,
  onUpdateSession,
}) => {
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = useState('general');
  const [isAutoLocked, setIsAutoLocked] = useState(false);
  const [displayProtocol, setDisplayProtocol] = useState<'auto' | 'ssh' | 'local' | 'telnet'>('auto');
  const [autoFlash, setAutoFlash] = useState(false);
  const [showProtocolHelp, setShowProtocolHelp] = useState(false);

  const [localSession, setLocalSession] = useState(session);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setLocalSession(session);
  }, [session?.id, index]);

  const handleUpdate = (updates: Partial<ConnectFormSession>) => {
    const updated = { ...localSession, ...updates };
    setLocalSession(updated);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onUpdateSession(index, updated);
    }, 400);
  };

  const effectiveProtocol: 'ssh' | 'local' | 'telnet' = displayProtocol === 'auto' ? 'ssh' : displayProtocol;
  const isLocal  = effectiveProtocol === 'local';
  const isTelnet = effectiveProtocol === 'telnet';

  useEffect(() => {
    if (displayProtocol !== 'auto') {
      handleUpdate({ protocol: displayProtocol });
    } else {
      handleUpdate({ protocol: 'ssh' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayProtocol]);

  useEffect(() => {
    const isSavedOrExplicit = session && (session.host || (session.protocol && session.protocol !== 'auto') || session.id);
    if (isSavedOrExplicit) { 
      setIsAutoLocked(true);
      setDisplayProtocol(session.protocol || 'ssh');
    } else if (session) {
      setIsAutoLocked(false);
      setDisplayProtocol(session.protocol || 'auto');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, session?.id]);

  const handleHostChange = (raw: string) => {
    if (!isAutoLocked && raw.length > 0) {
      const result = detectProtocol(raw);
      setDisplayProtocol(result.protocol);
      setAutoFlash(true);
      setTimeout(() => setAutoFlash(false), 1500);

      const updates: Partial<ConnectFormSession> = { host: result.parsedHost ?? raw };
      if (result.parsedUser) updates.username = result.parsedUser;
      if (result.parsedPort) updates.port = result.parsedPort;
      updates.protocol = result.protocol;
      handleUpdate(updates);
    } else {
      handleUpdate({ host: raw });
    }
  };

  const handleManualProtocol = (p: 'ssh' | 'local' | 'telnet') => {
    setIsAutoLocked(true);
    setDisplayProtocol(p);
  };

  const unlockAuto = () => {
    setIsAutoLocked(false);
    setDisplayProtocol('auto');
  };

  const inputCls = `w-full border-none rounded-xl px-4 py-3 text-sm outline-none transition-all duration-300 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] ${
    isDark ? 'bg-white/5 placeholder:text-white/30 text-white' : 'bg-black/5 placeholder:text-black/40 text-black'
  } focus:ring-0 focus:shadow-[inset_0_-2px_0_rgb(var(--primary)),0_8px_20px_rgba(var(--primary),0.2)]`;

  const tabs: { value: 'ssh' | 'local' | 'telnet'; label: string }[] = [
    { value: 'ssh',    label: 'SSH' },
    { value: 'local',  label: t('connection.protocol.local') },
    { value: 'telnet', label: 'Telnet' },
  ];

  const preventImeSubmit = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const NAV_TABS = [
    { id: 'general', label: t('connection.tabGeneral', 'General'), icon: <Settings2 className="w-4 h-4" /> },
    { id: 'auth', label: t('connection.tabAuth', 'Authentication'), icon: <Key className="w-4 h-4" /> },
    { id: 'network', label: t('connection.tabNetwork', 'Networking'), icon: <Network className="w-4 h-4" /> },
    { id: 'automation', label: t('connection.tabAutomation', 'Automation'), icon: <Terminal className="w-4 h-4" /> },
    { id: 'appearance', label: t('connection.tabAppearance', 'Appearance'), icon: <Palette className="w-4 h-4" /> },
  ];

  return (
    <form onSubmit={(e) => { e.preventDefault(); onConnect({ ...localSession, protocol: effectiveProtocol }); }} className="w-full h-full flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-300">
      
      <div className="flex items-center justify-between px-2">
        <div>
          <h2 className="text-3xl font-bold tracking-tight mb-1">{t('welcome.quickConnect')}</h2>
          <p className="opacity-50 text-sm">{t('welcome.subtitle')}</p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); onConnect({ ...localSession, protocol: effectiveProtocol }); }}
            className={`px-6 py-3 font-bold uppercase tracking-wider text-xs rounded-[24px] transition-colors border ${isDark ? 'border-white/10 hover:bg-white/10 text-white/70' : 'border-black/10 hover:bg-black/5 text-black/70'}`}
          >
            {t('connection.saveAndConnect')}
          </button>
          <motion.button
            whileTap={{ scale: 0.92, transition: { type: 'spring', stiffness: 400, damping: 30, mass: 1.0 } }}
            type="submit" disabled={connecting}
            className={`px-8 py-3 ${!connecting ? 'bg-primary shadow-[0_8px_20px_rgba(var(--primary),0.3)] hover:brightness-110' : 'bg-primary/50'} disabled:opacity-50 text-white font-bold uppercase tracking-wider text-xs rounded-[24px] transition-all`}
          >
            {connecting ? t('connection.connecting') : t('connection.connectBtn')}
          </motion.button>
        </div>
      </div>

      {error && <div className="bg-red-500/20 border border-red-500/50 text-red-600 dark:text-red-200 p-4 rounded-[24px] text-sm font-medium">{error}</div>}

      <div className={`w-full relative px-6 py-4 rounded-[24px] flex flex-col gap-4 shadow-sm border ${isDark ? 'bg-white/5 border-white/5' : 'bg-black/5 border-black/5'}`}>
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-bold uppercase tracking-wider opacity-60">
                {t('connection.protocol.label')} / Smart URI
              </label>
              <button type="button" onClick={() => setShowProtocolHelp(true)} className="opacity-40 hover:opacity-100 transition-opacity"><Info size={12} /></button>
            </div>
            <button
              type="button"
              onClick={unlockAuto}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-wider rounded-lg border transition-all ${
                !isAutoLocked ? 'border-primary/60 text-primary bg-primary/10' : 'border-white/10 text-white/40 bg-transparent hover:opacity-100'
              }`}
            >
              <span className={`inline-block w-1.5 h-1.5 rounded-full bg-primary ${!isAutoLocked && autoFlash ? 'animate-ping' : !isAutoLocked ? 'animate-pulse' : ''}`} />
              {t('connection.protocol.auto')}
            </button>
        </div>
        <div className="flex gap-4 items-center flex-wrap">
            <div className={`shrink-0 flex border ${isDark ? 'border-white/10 bg-black/20' : 'border-black/10 bg-black/5'} rounded-xl p-1`}>
                {tabs.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => handleManualProtocol(p.value)}
                    className={`px-4 py-2 text-xs font-bold uppercase tracking-wider whitespace-nowrap rounded-lg transition-all ${
                      !isAutoLocked && displayProtocol === 'auto'
                        ? 'text-current opacity-40 hover:opacity-80'
                        : displayProtocol === p.value
                          ? 'bg-primary text-white shadow-md'
                          : 'text-current opacity-40 hover:opacity-80'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
            </div>
            <div className="relative flex-1 flex items-center">
               <Link2 className="absolute left-4 w-5 h-5 opacity-40" />
               <input 
                 value={localSession.host || ''}
                 onChange={(e) => handleHostChange(e.target.value)}
                 placeholder={!isAutoLocked ? 'ssh://user@host:22' : t('connection.placeholder.host') as string}
                 className={`w-full pl-12 pr-4 py-3 rounded-xl border-none outline-none font-mono text-sm transition-all duration-300 ${isDark ? 'bg-black/20 text-white placeholder:text-white/30 focus:bg-black/40 focus:ring-1 focus:ring-primary' : 'bg-white/50 text-black placeholder:text-black/40 focus:bg-white focus:shadow-md focus:ring-1 focus:ring-primary'}`}
               />
            </div>
        </div>
      </div>

      <div className="flex flex-1 gap-6 min-h-[400px]">
        {/* Left Sidebar Tabs */}
        <div className={`w-56 shrink-0 flex flex-col gap-1.5 border-r pr-6 pb-4 ${isDark ? 'border-white/10' : 'border-black/10'}`}>
           {NAV_TABS.map(t => (
              <button 
                key={t.id} 
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${activeTab === t.id ? (isDark ? 'bg-primary/20 text-primary font-bold shadow-sm border border-primary/30' : 'bg-primary/10 text-primary font-bold shadow-sm border border-primary/20') : 'opacity-60 hover:opacity-100 hover:bg-white/5 border border-transparent text-sm font-medium'}`}
              >
                {t.icon} {t.label}
              </button>
           ))}
        </div>

        {/* Right Content Area */}
        <div className="flex-1 overflow-y-auto pl-2 pr-6 pb-8 scrollbar-hide flex flex-col gap-8">
           
           {activeTab === 'general' && (
             <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-right-4 duration-300">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider opacity-60 mb-2">
                      {t('connection.alias')} <span className="opacity-50 lowercase tracking-normal">({t('connection.optional')})</span>
                    </label>
                    <input
                      value={localSession.alias || localSession.name || ''}
                      onChange={(e) => handleUpdate({ alias: e.target.value })}
                      onKeyDown={preventImeSubmit}
                      type="text"
                      placeholder={t('connection.placeholder.alias') as string}
                      className={inputCls + ' rounded-xl'}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider opacity-60 mb-2">
                      {t('connection.group')} <span className="opacity-50 lowercase tracking-normal">({t('connection.optional')})</span>
                    </label>
                    <input
                      value={localSession.group || ''}
                      onChange={(e) => handleUpdate({ group: e.target.value })}
                      onKeyDown={preventImeSubmit}
                      type="text"
                      placeholder={t('connection.placeholder.group') as string || 'e.g. Servers/Web'}
                      className={inputCls + ' rounded-xl'}
                    />
                  </div>
                </div>

                <div className={`transition-all duration-500 ${isLocal ? 'opacity-30 pointer-events-none grayscale blur-[2px]' : ''}`}>
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider opacity-60 mb-2">{t('connection.username')}</label>
                      <input
                        value={localSession.username || ''}
                        onChange={(e) => handleUpdate({ username: e.target.value })}
                        onKeyDown={preventImeSubmit}
                        type="text"
                        placeholder="root"
                        className={inputCls + ' rounded-xl'}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider opacity-60 mb-2">{t('connection.port')}</label>
                      <input
                        value={localSession.port || ''}
                        onChange={(e) => handleUpdate({ port: parseInt(e.target.value) || undefined })}
                        onKeyDown={preventImeSubmit}
                        type="number"
                        placeholder={isTelnet ? "23" : "22"}
                        className={inputCls + ' rounded-xl'}
                      />
                    </div>
                  </div>
                </div>
             </div>
           )}

           {activeTab === 'auth' && (
             <div className={`flex flex-col gap-6 animate-in fade-in slide-in-from-right-4 duration-300 ${isLocal ? 'opacity-30 pointer-events-none grayscale blur-[2px]' : ''}`}>
               <div>
                  <label className="text-xs font-bold uppercase tracking-wider opacity-60 mb-2 block">{t('connection.authMethod')}</label>
                  {!isTelnet && (
                    <div className={`flex border ${isDark ? 'border-white/10 bg-black/20' : 'border-black/10 bg-black/5'} rounded-xl p-1 mb-4 max-w-sm`}>
                      <button
                        type="button"
                        onClick={() => handleUpdate({ authType: 'password' })}
                        className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${
                          !localSession.authType || localSession.authType === 'password'
                            ? (isDark ? 'bg-white/10 text-white shadow-sm' : 'bg-white text-slate-900 shadow-sm')
                            : 'text-current opacity-40 hover:opacity-80'
                        }`}
                      >
                        {t('connection.password')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUpdate({ authType: 'key' })}
                        className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${
                          localSession.authType === 'key'
                            ? (isDark ? 'bg-white/10 text-white shadow-sm' : 'bg-white text-slate-900 shadow-sm')
                            : 'text-current opacity-40 hover:opacity-80'
                        }`}
                      >
                        {t('connection.privateKey')}
                      </button>
                    </div>
                  )}

                  {(isTelnet || !localSession.authType || localSession.authType === 'password') ? (
                    <input
                      value={localSession.password || ''}
                      onChange={(e) => handleUpdate({ password: e.target.value })}
                      onKeyDown={preventImeSubmit}
                      type="password"
                      placeholder={t('connection.password') as string}
                      className={inputCls + ' rounded-xl'}
                    />
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div className="flex gap-2">
                        <input
                          value={localSession.privateKeyPath || ''}
                          onChange={(e) => handleUpdate({ privateKeyPath: e.target.value })}
                          onKeyDown={preventImeSubmit}
                          type="text"
                          placeholder="~/.ssh/id_rsa"
                          className={`flex-1 ${inputCls} rounded-xl`}
                        />
                        <button
                          type="button"
                          onClick={async () => { const p = await window.electronAPI.selectFile(); if (p) handleUpdate({ privateKeyPath: p }); }}
                          className={`px-4 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors border ${isDark ? 'bg-white/5 hover:bg-white/10 border-white/10' : 'bg-black/5 hover:bg-black/10 border-black/10'}`}
                        >
                          {t('common.selectFile')}
                        </button>
                      </div>
                      <input
                        value={localSession.passphrase || ''}
                        onChange={(e) => handleUpdate({ passphrase: e.target.value })}
                        onKeyDown={preventImeSubmit}
                        type="password"
                        placeholder="Passphrase (Optional)"
                        className={`${inputCls} rounded-xl`}
                      />
                    </div>
                  )}
               </div>
             </div>
           )}

           {activeTab === 'network' && (
             <div className={`flex flex-col gap-6 animate-in fade-in slide-in-from-right-4 duration-300 ${isLocal ? 'opacity-30 pointer-events-none grayscale blur-[2px]' : ''}`}>
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className="relative flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={localSession.useKeepAlive !== false}
                      onChange={(e) => handleUpdate({ useKeepAlive: e.target.checked })}
                      className="w-5 h-5 appearance-none rounded-md border-2 border-white/20 checked:border-transparent checked:bg-gradient-duo transition-all cursor-pointer relative"
                    />
                    {localSession.useKeepAlive !== false && <span className="absolute text-white pointer-events-none text-xs font-bold z-10">✓</span>}
                  </div>
                  <div>
                    <div className="text-sm font-bold">{t('connection.keepAlive')}</div>
                    <div className="text-[10px] opacity-50 uppercase tracking-wider mt-0.5">{t('connection.keepAliveDesc')}</div>
                  </div>
                </label>

                <div className="h-px w-full bg-white/5 my-2" />

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider opacity-60 mb-2">
                    {t('connection.proxyJump', 'Proxy / Jump Host')} <span className="opacity-50 lowercase tracking-normal">({t('connection.optional')})</span>
                  </label>
                  <input
                    value={localSession.proxyJump || ''}
                    onChange={(e) => handleUpdate({ proxyJump: e.target.value })}
                    onKeyDown={preventImeSubmit}
                    type="text"
                    placeholder="jumpuser@jumphost:22"
                    className={inputCls + ' rounded-xl'}
                  />
                  <p className="text-[10px] opacity-50 mt-2">Connect to this server by routing the connection through another SSH host.</p>
                </div>
                
                <label className="flex items-center gap-3 cursor-pointer group mt-2">
                  <div className="relative flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={localSession.strictHostKeyChecking === true}
                      onChange={(e) => handleUpdate({ strictHostKeyChecking: e.target.checked })}
                      className="w-5 h-5 appearance-none rounded-md border-2 border-white/20 checked:border-transparent checked:bg-gradient-duo transition-all cursor-pointer relative"
                    />
                    {localSession.strictHostKeyChecking === true && <span className="absolute text-white pointer-events-none text-xs font-bold z-10">✓</span>}
                  </div>
                  <div>
                    <div className="text-sm font-bold">{t('connection.strictHostKey', 'Strict Host Key Checking')}</div>
                    <div className="text-[10px] opacity-50 uppercase tracking-wider mt-0.5">{t('connection.strictHostKeyDesc', 'Reject connection if host key changes (prevents MITM)')}</div>
                  </div>
                </label>
             </div>
           )}

           {activeTab === 'automation' && (
             <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-right-4 duration-300">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider opacity-60 mb-2">
                    {t('connection.initialDir', 'Initial Directory')} <span className="opacity-50 lowercase tracking-normal">({t('connection.optional')})</span>
                  </label>
                  <input
                    value={localSession.initialDirectory || ''}
                    onChange={(e) => handleUpdate({ initialDirectory: e.target.value })}
                    onKeyDown={preventImeSubmit}
                    type="text"
                    placeholder="/var/www/html"
                    className={inputCls + ' rounded-xl'}
                  />
                  <p className="text-[10px] opacity-50 mt-2">Automatically <code className="bg-black/20 px-1 rounded">cd</code> into this path immediately after connecting.</p>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider opacity-60 mb-2">
                    {t('connection.postConnectScript', 'Post-Connect Script')} <span className="opacity-50 lowercase tracking-normal">({t('connection.optional')})</span>
                  </label>
                  <textarea
                    value={localSession.postConnectScript || ''}
                    onChange={(e) => handleUpdate({ postConnectScript: e.target.value })}
                    placeholder="#!/bin/bash\necho 'Hello World'\nneofetch"
                    className={inputCls + ' rounded-xl min-h-[120px] font-mono resize-y'}
                  />
                  <p className="text-[10px] opacity-50 mt-2">Run this bash script automatically in the background right after login.</p>
                </div>
             </div>
           )}

           {activeTab === 'appearance' && (
             <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-right-4 duration-300">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider opacity-60 mb-2">
                    {t('connection.themeOverride', 'Session Theme Override')} <span className="opacity-50 lowercase tracking-normal">({t('connection.optional')})</span>
                  </label>
                  <select
                    value={localSession.themeOverride || ''}
                    onChange={(e) => handleUpdate({ themeOverride: e.target.value })}
                    className={inputCls + ' rounded-xl appearance-none'}
                  >
                    <option value="">{t('connection.themeDefault', 'Default Theme')}</option>
                    {Object.keys(TERMINAL_THEMES).map(themeName => (
                      <option key={themeName} value={themeName}>
                        {themeName.charAt(0).toUpperCase() + themeName.slice(1)}
                      </option>
                    ))}
                    {appConfig.customThemes && Object.keys(appConfig.customThemes).map(themeName => (
                      <option key={themeName} value={themeName}>
                        {themeName.replace('custom_', '')} (Custom)
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] opacity-50 mt-2">{t('connection.themeOverrideDesc', 'Assign a unique color theme to this specific connection to easily distinguish it from others.')}</p>
                </div>
                
                <div className="p-6 border border-white/5 bg-black/10 rounded-2xl flex flex-col items-center justify-center text-center mt-2">
                   <Palette className="w-8 h-8 opacity-20 mb-3" />
                   <div className="text-sm font-bold opacity-70">{t('connection.moreAppearance', 'More appearance settings coming soon')}</div>
                   <div className="text-xs opacity-40 mt-1">{t('connection.moreAppearanceDesc', 'Font ligatures, custom background images, opacity per-host.')}</div>
                </div>
             </div>
           )}

        </div>
      </div>

      {/* ── Protocol Help Modal ── */}
      {showProtocolHelp && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center"
          onClick={() => setShowProtocolHelp(false)}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

          {/* Panel */}
          <div
            onClick={(e) => e.stopPropagation()}
            className={`relative z-10 w-[460px] max-w-[90vw] border rounded-xl shadow-2xl flex flex-col ${
              isDark ? 'bg-[#1a1a1a] border-white/20 text-white' : 'bg-white border-black/15 text-slate-900'
            }`}
          >
            {/* Header */}
            <div className={`flex items-center justify-between px-5 py-3 border-b ${isDark ? 'border-white/10' : 'border-black/10'}`}>
              <div className="flex items-center gap-2">
                <Info size={14} className="text-primary" />
                <span className="font-mono font-bold text-sm uppercase tracking-wider opacity-80">
                  {t('connection.protocol.label')}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowProtocolHelp(false)}
                className={`p-1 transition-colors rounded-xl ${isDark ? 'hover:bg-white/10 text-white/50 hover:text-white' : 'hover:bg-black/5 text-black/40 hover:text-black'}`}
              >
                <X size={15} />
              </button>
            </div>

            {/* Body — protocol rows */}
            <div className="flex flex-col divide-y divide-white/[0.06] overflow-y-auto max-h-[60vh]">
              {([
                { icon: '⚡', key: 'auto',   label: t('connection.protocol.auto'),  desc: t('connection.protocol.tooltipAuto'),   badge: null },
                { icon: '🛡️', key: 'ssh',    label: 'SSH',                        desc: t('connection.protocol.tooltipSsh'),    badge: t('connection.protocol.badgeRecommended') },
                { icon: '💻', key: 'local',  label: t('connection.protocol.local'),  desc: t('connection.protocol.tooltipLocal'),  badge: null },
                { icon: '📡', key: 'telnet', label: 'Telnet',                      desc: t('connection.protocol.tooltipTelnet'), badge: t('connection.protocol.badgePlaintext') },
              ] as const).map(row => {
                const isActive =
                  (!isAutoLocked && row.key === 'auto') ||
                  (isAutoLocked && displayProtocol === row.key);
                return (
                  <div
                    key={row.key}
                    className={`px-5 py-4 transition-colors ${
                      isActive
                        ? isDark ? 'bg-primary/10' : 'bg-primary/5'
                        : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-base leading-none">{row.icon}</span>
                      <span className="font-mono font-bold text-sm text-primary">{row.label}</span>
                      {isActive && (
                        <span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 bg-primary/20 text-primary border border-primary/30 rounded-xl">
                          {t('connection.protocol.badgeActive')}
                        </span>
                      )}
                      {row.badge && !isActive && (
                        <span className={`ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded-xl border ${
                          row.badge === t('connection.protocol.badgePlaintext')
                            ? 'bg-amber-500/10 text-amber-500 border-amber-500/30'
                            : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                        }`}>
                          {row.badge}
                        </span>
                      )}
                    </div>
                    <p className={`text-xs leading-relaxed ${isDark ? 'text-white/55' : 'text-slate-500'}`}>
                      {row.desc}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className={`flex justify-end px-4 py-3 border-t ${isDark ? 'border-white/10' : 'border-black/10'}`}>
              <button
                type="button"
                onClick={() => setShowProtocolHelp(false)}
                className={`flex items-center gap-2 px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider rounded-xl border transition-colors ${
                  isDark
                    ? 'bg-white/10 border-white/20 hover:bg-white/20 text-white'
                    : 'bg-black/5 border-black/15 hover:bg-black/10 text-black'
                }`}
              >
                <X size={12} />
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
};
