import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  ArrowRight,
  Check,
  FileKey2,
  FolderTree,
  Info,
  KeyRound,
  Link2,
  Palette,
  Server,
  Settings2,
  ShieldCheck,
  TerminalSquare,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AppConfig } from '../store/appStore';
import type { SessionProfile } from '../store/sessionStore';
import { detectProtocol } from '../utils/protocolParser';
import { TERMINAL_THEMES } from '../utils/themes';

export type ConnectFormSession = Partial<SessionProfile>;

interface ConnectFormProps {
  session: ConnectFormSession;
  index: number;
  appConfig: AppConfig;
  isDark: boolean;
  connecting: boolean;
  error: string | null;
  onCancel: () => void;
  onConnect: (session: ConnectFormSession) => void;
  onUpdateSession: (index: number, updatedSession: ConnectFormSession) => void;
}

type DisplayProtocol = 'auto' | 'ssh' | 'local' | 'telnet';

export const ConnectForm: React.FC<ConnectFormProps> = ({
  session,
  index,
  appConfig,
  connecting,
  error,
  onCancel,
  onConnect,
  onUpdateSession,
}) => {
  const { t } = useTranslation();
  const [displayProtocol, setDisplayProtocol] = useState<DisplayProtocol>('auto');
  const [isAutoLocked, setIsAutoLocked] = useState(false);
  const [autoFlash, setAutoFlash] = useState(false);
  const [showProtocolHelp, setShowProtocolHelp] = useState(false);
  const [localSession, setLocalSession] = useState(session);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalSession(session);
    const isSaved = !session.isDraft && Boolean(session.host || session.protocol === 'local');
    setIsAutoLocked(isSaved);
    setDisplayProtocol(isSaved ? (session.protocol || 'ssh') : 'auto');
  }, [index, session.id]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const handleUpdate = (updates: Partial<ConnectFormSession>) => {
    const updated = { ...localSession, ...updates };
    setLocalSession(updated);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onUpdateSession(index, updated), 400);
  };

  const effectiveProtocol: Exclude<DisplayProtocol, 'auto'> = displayProtocol === 'auto' ? 'ssh' : displayProtocol;
  const isLocal = effectiveProtocol === 'local';
  const isTelnet = effectiveProtocol === 'telnet';
  const isSsh = effectiveProtocol === 'ssh';
  const defaultPort = isTelnet ? 23 : (appConfig.defaultPort || 22);
  const endpoint = isLocal
    ? 'localhost'
    : `${localSession.username || 'user'}@${localSession.host || 'host'}:${localSession.port || defaultPort}`;
  const authLabel = isLocal
    ? t('connection.systemShell')
    : isTelnet || !localSession.authType || localSession.authType === 'password'
      ? t('connection.password')
      : t('connection.privateKey');
  const routeLabel = appConfig.proxyType && appConfig.proxyType !== 'none'
    ? appConfig.proxyType.toUpperCase()
    : t('connection.directRoute');
  const canConnect = isLocal || (Boolean(localSession.host?.trim()) && (isTelnet || Boolean(localSession.username?.trim())));

  const handleHostChange = (raw: string) => {
    if (!isAutoLocked && raw.length > 0) {
      const result = detectProtocol(raw);
      setDisplayProtocol(result.protocol);
      setAutoFlash(true);
      window.setTimeout(() => setAutoFlash(false), 900);
      const updates: Partial<ConnectFormSession> = { host: result.parsedHost ?? raw, protocol: result.protocol };
      if (result.parsedUser) updates.username = result.parsedUser;
      if (result.parsedPort) updates.port = result.parsedPort;
      handleUpdate(updates);
      return;
    }
    handleUpdate({ host: raw });
  };

  const selectProtocol = (protocol: DisplayProtocol) => {
    if (protocol === 'auto') {
      setIsAutoLocked(false);
      setDisplayProtocol('auto');
      handleUpdate({ protocol: 'auto' });
      return;
    }
    setIsAutoLocked(true);
    setDisplayProtocol(protocol);
    handleUpdate({ protocol, port: localSession.port || (protocol === 'telnet' ? 23 : protocol === 'ssh' ? (appConfig.defaultPort || 22) : undefined) });
  };

  const submit = () => {
    if (!canConnect) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const readySession = { ...localSession, isDraft: false, protocol: effectiveProtocol };
    onUpdateSession(index, readySession);
    onConnect(readySession);
  };

  const inputClass = 'w-full h-10 rounded-xl border border-line bg-surf px-3.5 text-[13px] text-ink outline-none transition-all placeholder:text-ink-3 focus:border-primary/70 focus:ring-2 focus:ring-primary/15';
  const labelClass = 'mb-2 block text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3';
  const cardClass = 'rounded-[22px] border border-line-soft bg-panel/80 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl';
  const protocols: { value: DisplayProtocol; label: string }[] = [
    { value: 'auto', label: t('connection.protocol.auto') },
    { value: 'ssh', label: 'SSH' },
    { value: 'local', label: t('connection.protocol.local') },
    { value: 'telnet', label: 'Telnet' },
  ];

  return (
    <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="flex h-full w-full flex-col text-ink">
      <header className="flex flex-none items-center justify-between gap-5 border-b border-line-soft bg-panel/35 px-7 py-4 backdrop-blur-xl">
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_12px_rgba(var(--primary-color),0.8)]" />
            {t('connection.workbench')} <span className="text-ink-3">/</span>
            <span className="text-ink-3">{session.isDraft ? t('connection.draft') : t('connection.saved')}</span>
          </div>
          <h2 className="truncate text-[22px] font-bold tracking-tight">{session.isDraft ? t('connection.newTitle') : (localSession.alias || endpoint)}</h2>
          <p className="mt-1 text-[12px] text-ink-3">{t('connection.workbenchDesc')}</p>
        </div>
        <div className="flex flex-none items-center gap-2.5">
          <div className="hidden items-center gap-2 rounded-xl border border-line-soft bg-surf/80 px-3 py-2 font-mono text-[11px] text-ink-2 lg:flex">
            <span className={`h-1.5 w-1.5 rounded-full ${canConnect ? 'bg-ok' : 'bg-warn'}`} />{endpoint}
          </div>
          <button type="button" onClick={onCancel} className="h-10 rounded-xl border border-line px-4 text-[12px] font-semibold text-ink-2 transition-all hover:bg-surf hover:text-ink active:scale-[0.98]">{t('common.cancel')}</button>
          <motion.button whileTap={{ scale: 0.96 }} type="submit" disabled={connecting || !canConnect} className="flex h-10 items-center gap-2 rounded-xl bg-primary px-5 text-[12px] font-bold text-black shadow-[0_10px_28px_rgba(var(--primary-color),0.22)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
            {connecting ? t('connection.connecting') : t('connection.connectBtn')}<ArrowRight className="h-3.5 w-3.5" />
          </motion.button>
        </div>
      </header>

      <div className="relative flex-1 overflow-y-auto px-6 py-5">
        <div className="pointer-events-none absolute inset-0 dashboard-grid" />
        <div className="relative mx-auto flex w-full max-w-[1320px] flex-col gap-4">
          {error && <div className="rounded-xl border border-down/35 bg-down/10 px-4 py-3 text-[12px] font-medium text-down">{error}</div>}

          <section className={`${cardClass} relative overflow-hidden`}>
            <div className="pointer-events-none absolute -right-24 -top-24 h-52 w-52 rounded-full bg-primary/10 blur-3xl" />
            <div className="relative flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-[13px] font-semibold">
                  <Link2 className="h-4 w-4 text-primary" />{t('connection.targetTitle')}
                  <button type="button" onClick={() => setShowProtocolHelp(true)} className="text-ink-3 transition-colors hover:text-ink" aria-label={t('connection.protocol.label')}><Info className="h-3.5 w-3.5" /></button>
                </div>
                <p className="mt-1 text-[11px] text-ink-3">{t('connection.protocol.autoDesc')}</p>
              </div>
              <div className="flex rounded-xl border border-line bg-surf p-1">
                {protocols.map(protocol => {
                  const active = protocol.value === 'auto'
                    ? !isAutoLocked && displayProtocol === 'auto'
                    : (isAutoLocked || displayProtocol !== 'auto') && displayProtocol === protocol.value;
                  return <button key={protocol.value} type="button" onClick={() => selectProtocol(protocol.value)} className={`rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.08em] transition-all ${active ? 'bg-primary text-black shadow-sm' : 'text-ink-3 hover:bg-panel hover:text-ink'}`}>{protocol.label}</button>;
                })}
              </div>
            </div>
            {isLocal ? (
              <div className="relative mt-4 flex min-h-14 items-center gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-4">
                <TerminalSquare className="h-5 w-5 text-primary" />
                <div><div className="text-[12px] font-semibold">{t('connection.localReady')}</div><div className="mt-0.5 text-[10px] text-ink-3">{t('connection.protocol.localHint')}</div></div>
              </div>
            ) : (
              <div className="relative mt-4 flex items-center rounded-2xl border border-line bg-surf/80 px-4 transition-all focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/10">
                <Server className={`h-5 w-5 flex-none transition-colors ${autoFlash ? 'text-primary' : 'text-ink-3'}`} />
                <input value={localSession.host || ''} onChange={(event) => handleHostChange(event.target.value)} placeholder="ssh://user@host:22" spellCheck={false} autoFocus={session.isDraft} className="h-14 min-w-0 flex-1 bg-transparent px-3 font-mono text-[14px] text-ink outline-none placeholder:text-ink-3" />
                <span className="hidden rounded-lg border border-line-soft bg-panel px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-3 sm:block">{displayProtocol === 'auto' ? 'AUTO' : displayProtocol}</span>
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
            <main className="flex flex-col gap-4 xl:col-span-7">
              <section className={cardClass}>
                <div className="mb-4 flex items-center justify-between">
                  <div><h3 className="flex items-center gap-2 text-[13px] font-semibold"><FolderTree className="h-4 w-4 text-cyan-400" />{t('connection.identityTitle')}</h3><p className="mt-1 text-[11px] text-ink-3">{t('connection.identityDesc')}</p></div>
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">01 / CORE</span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label><span className={labelClass}>{t('connection.alias')}</span><input value={localSession.alias || (localSession as { name?: string }).name || ''} onChange={(event) => handleUpdate({ alias: event.target.value })} className={inputClass} placeholder={t('connection.placeholder.alias')} /></label>
                  <label><span className={labelClass}>{t('connection.group')}</span><input value={localSession.group || ''} onChange={(event) => handleUpdate({ group: event.target.value })} className={inputClass} placeholder={t('connection.placeholder.group')} /></label>
                  {!isLocal && <>
                    <label><span className={labelClass}>{t('connection.username')}</span><input value={localSession.username || ''} onChange={(event) => handleUpdate({ username: event.target.value })} className={inputClass} placeholder={isTelnet ? 'admin' : 'root'} autoComplete="username" /></label>
                    <label><span className={labelClass}>{t('connection.port')}</span><input value={localSession.port || ''} onChange={(event) => handleUpdate({ port: Number(event.target.value) || undefined })} className={`${inputClass} font-mono`} type="number" min="1" max="65535" placeholder={String(defaultPort)} /></label>
                  </>}
                </div>
              </section>

              <section className={cardClass}>
                <div className="mb-4 flex items-center justify-between">
                  <div><h3 className="flex items-center gap-2 text-[13px] font-semibold"><KeyRound className="h-4 w-4 text-emerald-400" />{t('connection.authMethod')}</h3><p className="mt-1 text-[11px] text-ink-3">{t('connection.authDesc')}</p></div>
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">02 / AUTH</span>
                </div>
                {isLocal ? (
                  <div className="flex items-center gap-3 rounded-xl border border-ok/20 bg-ok/5 px-4 py-3 text-[11px] text-ink-2"><Check className="h-4 w-4 text-ok" />{t('connection.localAuthHint')}</div>
                ) : <>
                  {!isTelnet && <div className="mb-3 flex w-full max-w-sm rounded-xl border border-line bg-surf p-1">
                    <button type="button" onClick={() => handleUpdate({ authType: 'password' })} className={`flex-1 rounded-lg py-2 text-[10px] font-semibold transition-all ${!localSession.authType || localSession.authType === 'password' ? 'bg-panel text-ink shadow-sm' : 'text-ink-3 hover:text-ink'}`}>{t('connection.password')}</button>
                    <button type="button" onClick={() => handleUpdate({ authType: 'key' })} className={`flex-1 rounded-lg py-2 text-[10px] font-semibold transition-all ${localSession.authType === 'key' ? 'bg-panel text-ink shadow-sm' : 'text-ink-3 hover:text-ink'}`}>{t('connection.privateKey')}</button>
                  </div>}
                  {isTelnet || !localSession.authType || localSession.authType === 'password' ? (
                    <label><span className={labelClass}>{t('connection.password')}</span><input value={localSession.password || ''} onChange={(event) => handleUpdate({ password: event.target.value })} className={inputClass} type="password" autoComplete="current-password" placeholder={t('connection.password')} /></label>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
                      <label><span className={labelClass}>{t('connection.privateKey')}</span><div className="flex gap-2"><input value={localSession.privateKeyPath || ''} onChange={(event) => handleUpdate({ privateKeyPath: event.target.value })} className={`${inputClass} font-mono`} placeholder="~/.ssh/id_ed25519" /><button type="button" onClick={async () => { const path = await window.electronAPI.selectFile(); if (path) handleUpdate({ privateKeyPath: path }); }} className="grid h-10 w-10 flex-none place-items-center rounded-xl border border-line bg-surf text-ink-3 transition-colors hover:border-primary/50 hover:text-primary" aria-label={t('common.selectFile')}><FileKey2 className="h-4 w-4" /></button></div></label>
                      <label><span className={labelClass}>Passphrase</span><input value={localSession.passphrase || ''} onChange={(event) => handleUpdate({ passphrase: event.target.value })} className={inputClass} type="password" placeholder={t('connection.optional')} /></label>
                    </div>
                  )}
                </>}
              </section>

              <section className={cardClass}>
                <div className="mb-4 flex items-center justify-between">
                  <div><h3 className="flex items-center gap-2 text-[13px] font-semibold"><TerminalSquare className="h-4 w-4 text-amber-400" />{t('connection.tabAutomation')}</h3><p className="mt-1 text-[11px] text-ink-3">{t('connection.automationDesc')}</p></div>
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">03 / BOOT</span>
                </div>
                {isSsh ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[0.75fr_1.25fr]">
                    <label><span className={labelClass}>{t('connection.initialDir')}</span><input value={localSession.initialDirectory || ''} onChange={(event) => handleUpdate({ initialDirectory: event.target.value })} className={`${inputClass} font-mono`} placeholder="/var/www/html" /></label>
                    <label><span className={labelClass}>{t('connection.postConnectScript')}</span><textarea value={localSession.postConnectScript || ''} onChange={(event) => handleUpdate({ postConnectScript: event.target.value })} className={`${inputClass} min-h-20 resize-y py-2.5 font-mono`} placeholder="uptime && df -h" /></label>
                  </div>
                ) : <div className="rounded-xl border border-line-soft bg-surf px-4 py-3 text-[11px] text-ink-3">{t('connection.sshOnlyHint')}</div>}
              </section>
            </main>

            <aside className="flex flex-col gap-4 xl:col-span-5">
              <section className={cardClass}>
                <div className="mb-4 flex items-center justify-between"><h3 className="flex items-center gap-2 text-[13px] font-semibold"><Activity className="h-4 w-4 text-blue-400" />{t('connection.summaryTitle')}</h3><span className={`rounded-full border px-2 py-1 font-mono text-[9px] uppercase tracking-[0.12em] ${canConnect ? 'border-ok/25 bg-ok/10 text-ok' : 'border-warn/25 bg-warn/10 text-warn'}`}>{canConnect ? t('connection.ready') : t('connection.needsInput')}</span></div>
                <div className="grid grid-cols-2 gap-2">
                  {[[t('connection.protocol.label'), effectiveProtocol.toUpperCase()], [t('connection.endpoint'), endpoint], [t('connection.authMethod'), authLabel], [t('connection.route'), routeLabel]].map(([label, value]) => (
                    <div key={label} className="min-w-0 rounded-xl border border-line-soft bg-surf px-3 py-2.5"><div className="text-[9px] font-bold uppercase tracking-[0.12em] text-ink-3">{label}</div><div className="mt-1 truncate font-mono text-[11px] font-semibold text-ink" title={value}>{value}</div></div>
                  ))}
                </div>
              </section>

              <section className={cardClass}>
                <div className="mb-4 flex items-center justify-between">
                  <div><h3 className="flex items-center gap-2 text-[13px] font-semibold"><ShieldCheck className="h-4 w-4 text-emerald-400" />{t('connection.networkSecurityTitle')}</h3><p className="mt-1 text-[11px] text-ink-3">{t('connection.networkSecurityDesc')}</p></div>
                  <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('app:open-settings'))} className="grid h-8 w-8 place-items-center rounded-lg border border-line text-ink-3 transition-colors hover:bg-surf hover:text-ink" aria-label={t('connection.configureRoute')}><Settings2 className="h-3.5 w-3.5" /></button>
                </div>
                {isTelnet && <div className="mb-3 rounded-xl border border-warn/30 bg-warn/10 px-3 py-2 text-[10px] leading-relaxed text-warn">{t('connection.protocol.telnetHint')}</div>}
                <div className="flex flex-col divide-y divide-line-soft">
                  <div className="flex items-center justify-between gap-4 py-3 first:pt-0"><div><div className="text-[12px] font-semibold">{t('connection.keepAlive')}</div><div className="mt-0.5 text-[10px] text-ink-3">{t('connection.keepAliveDesc')}</div></div><button type="button" role="switch" aria-checked={localSession.useKeepAlive !== false} onClick={() => handleUpdate({ useKeepAlive: localSession.useKeepAlive === false })} className={`relative h-6 w-11 rounded-full border transition-colors ${localSession.useKeepAlive !== false ? 'border-ok/50 bg-ok' : 'border-line bg-surf-2'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${localSession.useKeepAlive !== false ? 'translate-x-5' : 'translate-x-1'}`} /></button></div>
                  {isSsh && <div className="flex items-center justify-between gap-4 py-3"><div><div className="text-[12px] font-semibold">{t('connection.strictHostKey')}</div><div className="mt-0.5 text-[10px] text-ink-3">{t('connection.strictHostKeyDesc')}</div></div><button type="button" role="switch" aria-checked={localSession.strictHostKeyChecking === true} onClick={() => handleUpdate({ strictHostKeyChecking: localSession.strictHostKeyChecking !== true })} className={`relative h-6 w-11 rounded-full border transition-colors ${localSession.strictHostKeyChecking === true ? 'border-ok/50 bg-ok' : 'border-line bg-surf-2'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${localSession.strictHostKeyChecking === true ? 'translate-x-5' : 'translate-x-1'}`} /></button></div>}
                  <div className="flex items-center justify-between gap-4 py-3 last:pb-0"><div><div className="text-[12px] font-semibold">{t('connection.route')}</div><div className="mt-0.5 text-[10px] text-ink-3">{t('connection.routeDesc')}</div></div><span className="rounded-lg border border-line bg-surf px-2.5 py-1 font-mono text-[10px] text-ink-2">{routeLabel}</span></div>
                </div>
              </section>

              <section className={cardClass}>
                <div className="mb-4 flex items-center justify-between"><div><h3 className="flex items-center gap-2 text-[13px] font-semibold"><Palette className="h-4 w-4 text-purple-400" />{t('connection.terminalTitle')}</h3><p className="mt-1 text-[11px] text-ink-3">{t('connection.themeOverrideDesc')}</p></div><span className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">VISUAL</span></div>
                <label><span className={labelClass}>{t('connection.themeOverride')}</span><select value={localSession.themeOverride || ''} onChange={(event) => handleUpdate({ themeOverride: event.target.value })} className={`${inputClass} appearance-none`}><option value="">{t('connection.themeDefault')}</option>{Object.keys(TERMINAL_THEMES).map(themeName => <option key={themeName} value={themeName}>{themeName.charAt(0).toUpperCase() + themeName.slice(1)}</option>)}{Object.keys(appConfig.customThemes || {}).map(themeName => <option key={themeName} value={themeName}>{themeName.replace('custom_', '')}</option>)}</select></label>
              </section>
            </aside>
          </div>
        </div>
      </div>

      {showProtocolHelp && <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-scrim p-5 backdrop-blur-sm" onClick={() => setShowProtocolHelp(false)}>
        <div className="w-full max-w-[480px] overflow-hidden rounded-[22px] border border-line bg-panel shadow-2xl" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-center justify-between border-b border-line-soft px-5 py-4"><div className="flex items-center gap-2 text-[13px] font-semibold"><Info className="h-4 w-4 text-primary" />{t('connection.protocol.label')}</div><button type="button" onClick={() => setShowProtocolHelp(false)} className="grid h-8 w-8 place-items-center rounded-lg text-ink-3 hover:bg-surf hover:text-ink"><X className="h-4 w-4" /></button></div>
          <div className="divide-y divide-line-soft">{[['AUTO', t('connection.protocol.tooltipAuto')], ['SSH', t('connection.protocol.tooltipSsh')], [t('connection.protocol.local'), t('connection.protocol.tooltipLocal')], ['TELNET', t('connection.protocol.tooltipTelnet')]].map(([label, description]) => <div key={label} className="px-5 py-4"><div className="font-mono text-[11px] font-bold text-primary">{label}</div><p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">{description}</p></div>)}</div>
        </div>
      </div>}
    </form>
  );
};
