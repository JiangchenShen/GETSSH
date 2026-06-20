import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, X } from 'lucide-react';
import { detectProtocol } from '../utils/protocolParser';
import { motion } from 'framer-motion';

interface ConnectFormProps {
  session: any;
  index: number;
  appConfig: any;
  isDark: boolean;
  connecting: boolean;
  error: string | null;
  onConnect: (session: any) => void;
  onUpdateSession: (index: number, updatedSession: any) => void;
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

  // ── Auto-detection state ──────────────────────────────────────────────────
  // isAutoLocked: user manually clicked a protocol tab → stop auto-detecting
  const [isAutoLocked, setIsAutoLocked] = useState(false);
  // displayProtocol: what to show in the switcher ('auto' | 'ssh' | 'local' | 'telnet')
  const [displayProtocol, setDisplayProtocol] = useState<'auto' | 'ssh' | 'local' | 'telnet'>('auto');
  // autoDetectedBadge: flashing for 1.5s after auto-switching
  const [autoFlash, setAutoFlash] = useState(false);
  const [showProtocolHelp, setShowProtocolHelp] = useState(false);

  // Local state to prevent React re-render lag and IME interruption
  const [localSession, setLocalSession] = useState(session);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setLocalSession(session);
  }, [session?.id, index]); // Reset local state when switching to a different session

  const handleUpdate = (updates: Partial<any>) => {
    const updated = { ...localSession, ...updates };
    setLocalSession(updated);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onUpdateSession(index, updated);
    }, 400); // 400ms debounce to prevent disk I/O spam and UI lag
  };

  // Effective protocol used for conditional rendering
  const effectiveProtocol: 'ssh' | 'local' | 'telnet' =
    displayProtocol === 'auto' ? 'ssh' : displayProtocol;
  const isLocal  = effectiveProtocol === 'local';
  const isTelnet = effectiveProtocol === 'telnet';

  // Keep session.protocol in sync
  useEffect(() => {
    if (displayProtocol !== 'auto') {
      handleUpdate({ protocol: displayProtocol });
    } else {
      handleUpdate({ protocol: 'ssh' }); // default when auto = ssh
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayProtocol]);

  // 状态回填：当选择已有会话时，绑定协议并关闭智能识别
  useEffect(() => {
    // 判断是否为真正的新建：如果既没有 host，也没有明确指定具体协议（protocol为auto或空），且没有 id
    const isSavedOrExplicit = session && (session.host || (session.protocol && session.protocol !== 'auto') || session.id);

    if (isSavedOrExplicit) { 
      setIsAutoLocked(true);
      setDisplayProtocol(session.protocol || 'ssh');
    } else if (session) { // 新建会话
      setIsAutoLocked(false);
      setDisplayProtocol(session.protocol || 'auto');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, session?.id]);

  // ── Host input handler with smart detection ───────────────────────────────
  const handleHostChange = (raw: string) => {
    if (!isAutoLocked && raw.length > 0) {
      const result = detectProtocol(raw);

      // Auto-switch protocol tab
      setDisplayProtocol(result.protocol);

      // Flash badge
      setAutoFlash(true);
      setTimeout(() => setAutoFlash(false), 1500);

      // Smart backfill parsed fields
      const updates: any = { host: result.parsedHost ?? raw };
      if (result.parsedUser) updates.username = result.parsedUser;
      if (result.parsedPort) updates.port = result.parsedPort;
      updates.protocol = result.protocol;
      handleUpdate(updates);
    } else {
      handleUpdate({ host: raw });
    }
  };

  // ── Manual protocol selection ─────────────────────────────────────────────
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
    { value: 'local',  label: t('connect.protocol.local') },
    { value: 'telnet', label: 'Telnet' },
  ];

  const preventImeSubmit = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); onConnect({ ...localSession, protocol: effectiveProtocol }); }} className="w-full h-full flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-300">
      
      {/* Top Header Section */}
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
            {t('connect.saveAndConnect')}
          </button>
          <motion.button
            whileTap={{ scale: 0.92, transition: { type: 'spring', stiffness: 400, damping: 30, mass: 1.0 } }}
            type="submit" disabled={connecting}
            className={`px-8 py-3 ${!connecting ? 'bg-primary shadow-[0_8px_20px_rgba(var(--primary),0.3)] hover:brightness-110' : 'bg-primary/50'} disabled:opacity-50 text-white font-bold uppercase tracking-wider text-xs rounded-[24px] transition-all`}
          >
            {connecting ? t('connect.connecting') : t('connect.connectBtn')}
          </motion.button>
        </div>
      </div>

      {error && <div className="bg-red-500/20 border border-red-500/50 text-red-600 dark:text-red-200 p-4 rounded-[24px] text-sm font-medium">{error}</div>}

      {/* Grid Content Area */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 flex-1">
        
        {/* Card 1: Protocol & Identity */}
        <div className={`relative p-8 flex flex-col gap-6 rounded-[32px] ${isDark ? 'bg-[#1a1a1a] border border-white/5' : 'bg-white border border-black/5 shadow-sm'}`}>
          <div className="absolute inset-0 rounded-[32px] pointer-events-none shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" />
          <div className="flex items-center gap-3 mb-2 relative z-10">
            <div className="w-10 h-10 rounded-xl bg-primary/5 border border-primary/30 text-primary flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(var(--primary),0.2)] backdrop-blur-md">
              <span className="font-mono font-bold text-lg">1</span>
            </div>
            <h3 className="text-lg font-bold">Identity</h3>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider opacity-60 mb-2">
              {t('connect.alias')} <span className="opacity-50 lowercase tracking-normal">({t('connect.optional')})</span>
            </label>
            <input
              value={localSession.alias || localSession.name || ''}
              onChange={(e) => handleUpdate({ alias: e.target.value })}
              onKeyDown={preventImeSubmit}
              type="text"
              placeholder={t('connect.placeholder.alias') as string}
              className={inputCls + ' rounded-xl'}
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider opacity-60 mb-2">
              {t('connect.group')} <span className="opacity-50 lowercase tracking-normal">({t('connect.optional')})</span>
            </label>
            <input
              value={localSession.group || ''}
              onChange={(e) => handleUpdate({ group: e.target.value })}
              onKeyDown={preventImeSubmit}
              type="text"
              placeholder={t('connect.placeholder.group') as string || 'e.g. Servers/Web'}
              className={inputCls + ' rounded-xl'}
            />
          </div>

          <div className="flex-1">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <label className="text-xs font-bold uppercase tracking-wider opacity-60">
                  {t('connect.protocol.label')}
                </label>
                <button type="button" onClick={() => setShowProtocolHelp(true)} className="opacity-40 hover:opacity-100 transition-opacity"><Info size={14} /></button>
              </div>
              <button
                type="button"
                onClick={unlockAuto}
                className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-wider rounded-lg border transition-all ${
                  !isAutoLocked ? 'border-primary/60 text-primary bg-primary/10' : 'border-white/10 text-white/40 bg-transparent hover:opacity-100'
                }`}
              >
                <span className={`inline-block w-1.5 h-1.5 rounded-full bg-primary ${!isAutoLocked && autoFlash ? 'animate-ping' : !isAutoLocked ? 'animate-pulse' : ''}`} />
                {t('connect.protocol.auto')}
              </button>
            </div>

            <div className={`flex border ${isDark ? 'border-white/10 bg-black/20' : 'border-black/10 bg-black/5'} rounded-xl p-1`}>
              {tabs.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => handleManualProtocol(p.value)}
                  className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${
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
            
            <p className={`mt-3 text-xs leading-relaxed transition-all ${!isAutoLocked ? 'text-primary/70' : 'opacity-40'}`}>
              {!isAutoLocked ? t('connect.protocol.autoDesc') : isLocal ? t('connect.protocol.localHint') : isTelnet ? t('connect.protocol.telnetHint') : null}
            </p>
          </div>
        </div>

        {/* Card 2: Network */}
        <div className={`relative p-8 flex flex-col gap-6 rounded-[32px] transition-all duration-500 ${isLocal ? 'opacity-30 pointer-events-none grayscale blur-[2px]' : ''} ${isDark ? 'bg-[#1a1a1a] border border-white/5' : 'bg-white border border-black/5 shadow-sm'}`}>
          <div className="absolute inset-0 rounded-[32px] pointer-events-none shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" />
          <div className="flex items-center gap-3 mb-2 relative z-10">
            <div className="w-10 h-10 rounded-xl bg-blue-500/5 border border-blue-500/30 text-blue-500 flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(59,130,246,0.2)] backdrop-blur-md">
              <span className="font-mono font-bold text-lg">2</span>
            </div>
            <h3 className="text-lg font-bold">Network</h3>
          </div>

          <div className="flex-1 flex flex-col gap-6">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider opacity-60 mb-2">
                {!isAutoLocked ? <span>{t('connect.host')} <span className="text-primary/60 text-[10px] ml-1">/ SMART URI</span></span> : t('connect.host')}
              </label>
              <input
                required={!isLocal}
                value={localSession.host || ''}
                onChange={(e) => handleHostChange(e.target.value)}
                onKeyDown={preventImeSubmit}
                type="text"
                placeholder={!isAutoLocked ? 'ssh://user@host:22' : t('connect.placeholder.host') as string}
                className={inputCls + ' rounded-xl h-12 text-base'}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider opacity-60 mb-2">{t('connect.port')}</label>
                <input
                  required={!isLocal}
                  value={localSession.port ?? (isTelnet ? 23 : (appConfig.defaultPort ?? 22))}
                  onChange={(e) => handleUpdate({ port: parseInt(e.target.value) || (isTelnet ? 23 : 22) })}
                  onKeyDown={preventImeSubmit}
                  type="number"
                  min="1"
                  max="65535"
                  className={inputCls + ' rounded-xl'}
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider opacity-60 mb-2">{t('connect.username')}</label>
                <input
                  required={!isLocal}
                  value={localSession.username || ''}
                  onChange={(e) => handleUpdate({ username: e.target.value })}
                  onKeyDown={preventImeSubmit}
                  type="text"
                  className={inputCls + ' rounded-xl'}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Card 3: Authentication & Advanced */}
        <div className={`relative p-8 flex flex-col gap-6 rounded-[32px] transition-all duration-500 ${isLocal ? 'opacity-30 pointer-events-none grayscale blur-[2px]' : ''} ${isDark ? 'bg-[#1a1a1a] border border-white/5' : 'bg-white border border-black/5 shadow-sm'}`}>
          <div className="absolute inset-0 rounded-[32px] pointer-events-none shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" />
          <div className="flex items-center gap-3 mb-2 relative z-10">
            <div className="w-10 h-10 rounded-xl bg-orange-500/5 border border-orange-500/30 text-orange-500 flex items-center justify-center shrink-0 shadow-[0_0_15px_rgba(249,115,22,0.2)] backdrop-blur-md">
              <span className="font-mono font-bold text-lg">3</span>
            </div>
            <h3 className="text-lg font-bold">Security</h3>
          </div>

          <div className="flex-1 flex flex-col gap-6">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-bold uppercase tracking-wider opacity-60">{t('connect.authMethod')}</label>
              </div>
              
              {!isTelnet && (
                <div className={`flex border ${isDark ? 'border-white/10 bg-black/20' : 'border-black/10 bg-black/5'} rounded-xl p-1 mb-4`}>
                  <button
                    type="button"
                    onClick={() => handleUpdate({ authType: 'password' })}
                    className={`flex-1 py-1.5 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${
                      (!localSession.authType || localSession.authType === 'password')
                        ? 'bg-white/10 text-current shadow-sm'
                        : 'text-current opacity-40 hover:opacity-80'
                    }`}
                  >
                    {t('connect.password')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleUpdate({ authType: 'key' })}
                    className={`flex-1 py-1.5 text-xs font-bold uppercase tracking-wider rounded-lg transition-all ${
                      localSession.authType === 'key'
                        ? 'bg-white/10 text-current shadow-sm'
                        : 'text-current opacity-40 hover:opacity-80'
                    }`}
                  >
                    {t('connect.privateKey')}
                  </button>
                </div>
              )}

              {(isTelnet || !localSession.authType || localSession.authType === 'password') ? (
                <input
                  value={localSession.password || ''}
                  onChange={(e) => handleUpdate({ password: e.target.value })}
                  onKeyDown={preventImeSubmit}
                  type="password"
                  placeholder={t('connect.password') as string}
                  className={inputCls + ' rounded-xl'}
                />
              ) : (
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
              )}
            </div>

            <div className="mt-auto">
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
                  <div className="text-sm font-bold">{t('connect.keepAlive')}</div>
                  <div className="text-[10px] opacity-50 uppercase tracking-wider mt-0.5">{t('connect.keepAliveDesc')}</div>
                </div>
              </label>
            </div>
          </div>
        </div>

      </div>

      {/* ── Protocol Help Modal ── */}
      {showProtocolHelp && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
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
                  {t('connect.protocol.label')}
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
                { icon: '⚡', key: 'auto',   label: t('connect.protocol.auto'),  desc: t('connect.protocol.tooltipAuto'),   badge: null },
                { icon: '🛡️', key: 'ssh',    label: 'SSH',                        desc: t('connect.protocol.tooltipSsh'),    badge: t('connect.protocol.badgeRecommended') },
                { icon: '💻', key: 'local',  label: t('connect.protocol.local'),  desc: t('connect.protocol.tooltipLocal'),  badge: null },
                { icon: '📡', key: 'telnet', label: 'Telnet',                      desc: t('connect.protocol.tooltipTelnet'), badge: t('connect.protocol.badgePlaintext') },
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
                          {t('connect.protocol.badgeActive')}
                        </span>
                      )}
                      {row.badge && !isActive && (
                        <span className={`ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded-xl border ${
                          row.badge === t('connect.protocol.badgePlaintext')
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
