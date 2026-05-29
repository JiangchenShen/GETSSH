import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, X } from 'lucide-react';
import { detectProtocol } from '../utils/protocolParser';

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

  const inputCls = `w-full border rounded-none px-4 py-2 text-sm outline-none transition-colors focus:ring-1 focus:ring-primary ${
    isDark ? 'bg-black/30 border-white/10 placeholder:text-white/20' : 'bg-black/5 border-black/10 placeholder:text-black/30'
  }`;

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
    <form onSubmit={(e) => { e.preventDefault(); onConnect({ ...localSession, protocol: effectiveProtocol }); }} className="p-8 w-full max-w-md space-y-6 flex flex-col bg-transparent border-0">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-2">{t('welcome.quickConnect')}</h2>
        <p className="opacity-50 text-sm">{t('welcome.subtitle')}</p>
      </div>
      {error && <div className="bg-red-500/20 border border-red-500/50 text-red-600 dark:text-red-200 p-3 rounded-none text-sm">{error}</div>}

      {/* ── Protocol Switcher ── */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium opacity-70 uppercase tracking-wider font-mono">
              {t('connect.protocol.label')}
            </label>
            {/* Info icon — click to open modal */}
            <button
              type="button"
              onClick={() => setShowProtocolHelp(true)}
              className="cursor-pointer opacity-40 hover:opacity-90 transition-opacity focus:outline-none"
              title={t('connect.protocol.label') as string}
            >
              <Info size={13} />
            </button>
          </div>
          <button
            type="button"
            onClick={unlockAuto}
            title={t('connect.protocol.autoDesc') as string}
            className={`flex items-center gap-1 px-2 py-0.5 text-xs font-mono font-bold rounded-none border transition-all ${
              !isAutoLocked
                ? 'border-primary/60 text-primary bg-primary/10'
                : 'border-white/10 text-white/30 bg-transparent opacity-50 hover:opacity-100'
            }`}
          >
            <span className={`inline-block w-1.5 h-1.5 rounded-full bg-primary ${!isAutoLocked && autoFlash ? 'animate-ping' : !isAutoLocked ? 'animate-pulse' : ''}`} />
            ⚡ {t('connect.protocol.auto')}
          </button>
        </div>

        <div className={`flex border ${isDark ? 'border-white/15' : 'border-black/15'} rounded-none overflow-hidden`}>
          {tabs.map((p, i) => (
            <button
              key={p.value}
              type="button"
              onClick={() => handleManualProtocol(p.value)}
              className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider transition-colors font-mono ${
                !isAutoLocked && displayProtocol === 'auto'
                  ? (isDark ? 'bg-white/5 text-white/40 hover:bg-white/10' : 'bg-black/5 text-black/40 hover:bg-black/10')
                  : displayProtocol === p.value
                    ? 'bg-primary text-white'
                    : isDark
                      ? 'bg-white/5 text-white/50 hover:bg-white/10'
                      : 'bg-black/5 text-black/50 hover:bg-black/10'
              } ${i > 0 ? (isDark ? 'border-l border-white/10' : 'border-l border-black/10') : ''}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Status line */}
        <p className={`mt-1.5 text-xs font-mono transition-all ${!isAutoLocked ? 'text-primary/70' : 'opacity-40'}`}>
          {!isAutoLocked
            ? t('connect.protocol.autoDesc')
            : isLocal
              ? t('connect.protocol.localHint')
              : isTelnet
                ? t('connect.protocol.telnetHint')
                : null}
        </p>
      </div>

      <div className="space-y-4">
        {/* Alias — always visible */}
        <div>
          <label className="block text-xs font-medium opacity-70 mb-1">
            {t('connect.alias')} <span className="opacity-50 ml-1">({t('connect.optional')})</span>
          </label>
          <input
            value={localSession.alias || localSession.name || ''}
            onChange={(e) => handleUpdate({ alias: e.target.value })}
            onKeyDown={preventImeSubmit}
            type="text"
            placeholder={t('connect.placeholder.alias') as string}
            className={inputCls}
          />
        </div>

        {/* Host + Port — hidden for local */}
        {!isLocal && (
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="block text-xs font-medium opacity-70 mb-1">
                {!isAutoLocked
                  ? <span>{t('connect.host')} <span className="text-primary/60 text-xs">/ URI</span></span>
                  : t('connect.host')}
              </label>
              <input
                required
                value={localSession.host || ''}
                onChange={(e) => handleHostChange(e.target.value)}
                onKeyDown={preventImeSubmit}
                type="text"
                placeholder={
                  !isAutoLocked
                    ? 'host / ssh://user@host / telnet://...'
                    : t('connect.placeholder.host') as string
                }
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-medium opacity-70 mb-1">{t('connect.port')}</label>
              <input
                required
                value={localSession.port ?? (isTelnet ? 23 : (appConfig.defaultPort ?? 22))}
                onChange={(e) => handleUpdate({ port: parseInt(e.target.value) || (isTelnet ? 23 : 22) })}
                onKeyDown={preventImeSubmit}
                type="number"
                min="1"
                max="65535"
                className={inputCls}
              />
            </div>
          </div>
        )}

        {/* Username — hidden for local */}
        {!isLocal && (
          <div>
            <label className="block text-xs font-medium opacity-70 mb-1">{t('connect.username')}</label>
            <input
              required
              value={localSession.username || ''}
              onChange={(e) => handleUpdate({ username: e.target.value })}
              onKeyDown={preventImeSubmit}
              type="text"
              className={inputCls}
            />
          </div>
        )}

        {/* Auth block */}
        {!isLocal && (
          <div>
            <label className="block text-xs font-medium opacity-70 mb-1">{t('connect.authMethod')}</label>
            {!isTelnet && (
              <div className="grid grid-cols-2 gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => handleUpdate({ authType: 'password' })}
                  className={`py-1.5 text-xs rounded-none transition-colors border ${
                    (!localSession.authType || localSession.authType === 'password')
                      ? 'border-primary bg-primary/10 text-primary'
                      : isDark ? 'border-white/10 hover:bg-white/5' : 'border-black/10 hover:bg-black/5'
                  }`}
                >
                  {t('connect.password')}
                </button>
                <button
                  type="button"
                  onClick={() => handleUpdate({ authType: 'key' })}
                  className={`py-1.5 text-xs rounded-none transition-colors border ${
                    localSession.authType === 'key'
                      ? 'border-primary bg-primary/10 text-primary'
                      : isDark ? 'border-white/10 hover:bg-white/5' : 'border-black/10 hover:bg-black/5'
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
                className={inputCls}
              />
            ) : (
              <div className="flex gap-2">
                <input
                  value={localSession.privateKeyPath || ''}
                  onChange={(e) => handleUpdate({ privateKeyPath: e.target.value })}
                  onKeyDown={preventImeSubmit}
                  type="text"
                  placeholder="~/.ssh/id_rsa"
                  className={`flex-1 ${inputCls}`}
                />
                <button
                  type="button"
                  onClick={async () => { const p = await window.electronAPI.selectFile(); if (p) handleUpdate({ privateKeyPath: p }); }}
                  className={`px-3 border rounded-none text-sm shrink-0 ${isDark ? 'bg-white/10 hover:bg-white/20 border-white/10' : 'bg-white hover:bg-black/10 border-black/10'}`}
                >
                  {t('common.selectFile')}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Keep-Alive */}
        {!isLocal && (
          <label className="flex items-center gap-3 cursor-pointer pt-2">
            <input
              type="checkbox"
              checked={localSession.useKeepAlive !== false}
              onChange={(e) => handleUpdate({ useKeepAlive: e.target.checked })}
              className="w-4 h-4 accent-primary rounded"
            />
            <div>
              <div className="text-sm font-medium">{t('connect.keepAlive')}</div>
              <div className="text-xs opacity-50">{t('connect.keepAliveDesc')}</div>
            </div>
          </label>
        )}
      </div>

      <div className="flex gap-3 mt-4">
        <button
          disabled={connecting}
          type="submit"
          className="flex-1 bg-primary hover:bg-primary/80 disabled:opacity-50 text-white font-medium py-3 rounded-none transition-colors shadow-lg shadow-primary/20"
        >
          {connecting ? t('connect.connecting') : t('connect.connectBtn')}
        </button>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); onConnect({ ...localSession, protocol: effectiveProtocol }); }}
          className={`px-4 py-3 font-medium border rounded-none transition-colors ${isDark ? 'border-white/20 hover:bg-white/10' : 'border-black/20 hover:bg-black/5'}`}
        >
          {t('connect.saveAndConnect')}
        </button>
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
            className={`relative z-10 w-[460px] max-w-[90vw] border rounded-none shadow-2xl flex flex-col ${
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
                className={`p-1 transition-colors rounded-none ${isDark ? 'hover:bg-white/10 text-white/50 hover:text-white' : 'hover:bg-black/5 text-black/40 hover:text-black'}`}
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
                        <span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 bg-primary/20 text-primary border border-primary/30 rounded-none">
                          {t('connect.protocol.badgeActive')}
                        </span>
                      )}
                      {row.badge && !isActive && (
                        <span className={`ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded-none border ${
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
                className={`flex items-center gap-2 px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider rounded-none border transition-colors ${
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
