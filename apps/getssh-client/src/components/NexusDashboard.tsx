import React, { useState, useEffect } from 'react';

import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/appStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useCryptoStore } from '../store/cryptoStore';
import { useSessionStore, type SessionProfile } from '../store/sessionStore';
import { useAiStore } from '../store/aiStore';
import { motion } from 'framer-motion';
import { Sparkles, Plus, ArrowRight, ShieldCheck, ShieldAlert } from 'lucide-react';
import { CryptoModal } from './CryptoModal';
import { promptWebAuthn } from '../utils/webauthn';

/**
 * 主屏。
 *
 * 时钟和问候语保留，但从「内容」降为「状态带」—— 同一条带子顺带交付主机数、
 * 会话数、Watchdog 与模型端点。腾出来的中段放真能接着干的东西：当前会话与主机表。
 * 六个中心不在这里，它们是导航，归底部状态条。
 *
 * 颜色一律走 index.css 里的 v2 语义令牌（bg / panel / surf / line / ink…），
 * 深浅两套主题整套切换；近黑底上不投黑影，层级由表面提亮 + 1px 描边表达。
 *
 * 只渲染 store 里真实存在的字段。延迟、负载这类还没有数据源的指标不编。
 */
export const NexusDashboard: React.FC<{ onConnect?: (s: SessionProfile) => void }> = ({ onConnect }) => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const setIsCommandCenterOpen = useAppStore(state => state.setIsCommandCenterOpen);
  const watchdogStatus = useAppStore(state => state.watchdogStatus);

  const workspaces = useWorkspaceStore(state => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);

  const cryptoMode = useCryptoStore(state => state.cryptoMode);
  const setCryptoMode = useCryptoStore(state => state.setCryptoMode);
  const encryptionDisabled = useCryptoStore(state => state.encryptionDisabled);
  const setEncryptionDisabled = useCryptoStore(state => state.setEncryptionDisabled);
  const masterPassword = useCryptoStore(state => state.masterPassword);
  const setMasterPassword = useCryptoStore(state => state.setMasterPassword);

  const sessions = useSessionStore(state => state.sessions);
  const setSessions = useSessionStore(state => state.setSessions);
  const tabs = useSessionStore(state => state.tabs);
  const setActiveTabId = useSessionStore(state => state.setActiveTabId);

  const aiModel = useAiStore(state => state.aiModel);

  const handleUnlock = async (pwd: string) => {
    const profiles = await window.electronAPI.unlockProfiles(pwd);
    if (!profiles) return false;
    setMasterPassword(pwd);
    setSessions(profiles);
    setCryptoMode('idle');
    useWorkspaceStore.setState({ isVaultLocked: false, isUnlockModalOpen: false });
    return true;
  };

  const handleSetup = async (pwd: string) => {
    setEncryptionDisabled(false);
    setMasterPassword(pwd);
    const updatedSessions = sessions.map(s => ({ ...s, password: s.password || '' }));
    await window.electronAPI.saveProfiles({ masterPassword: pwd, payload: updatedSessions });
    setCryptoMode('idle');
  };

  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timeString = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateString = time.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  const getGreetingKey = () => {
    const hour = time.getHours();
    if (hour < 5) return 'midnight';
    if (hour < 9) return 'morning';
    if (hour < 12) return 'forenoon';
    if (hour < 14) return 'noon';
    if (hour < 18) return 'afternoon';
    if (hour < 22) return 'evening';
    return 'lateNight';
  };
  // 每次挂载固定一句，避免每秒 tick 时问候语乱跳
  const [greetingIndex] = useState(() => Math.floor(Math.random() * 10));

  const isVaultLocked = useWorkspaceStore(state => state.isVaultLocked);

  if (isVaultLocked) {
    const _activeWs = workspaces.find(w => w.id === activeWorkspaceId);
    return (
      <div className="absolute inset-0 w-full h-full z-[100] rounded-[32px] overflow-hidden">
        <CryptoModal
          mode="locked"
          isDark={isDark}
          encryptionDisabled={encryptionDisabled}
          onUnlock={handleUnlock}
          onSetup={async (pwd) => { await handleSetup(pwd); }}
          onSkip={cryptoMode === 'setup' ? () => setCryptoMode('idle') : undefined}
          onCancel={cryptoMode === 'setup' && sessions.length === 0 && !masterPassword ? undefined : () => {
            if (cryptoMode === 'setup') {
              setEncryptionDisabled(true);
              window.electronAPI.saveProfiles({ masterPassword: '', payload: sessions });
            }
            setCryptoMode('idle');
          }}
          onRetryBiometric={_activeWs?.biometricEnabled ? async () => {
            const webAuthnSuccess = await promptWebAuthn();
            if (!webAuthnSuccess) return;
            const bioRes = await window.electronAPI.promptBiometricUnlock();
            if (bioRes.success && bioRes.masterPassword) {
              try {
                const decrypted = await window.electronAPI.unlockProfiles(bioRes.masterPassword);
                setMasterPassword(bioRes.masterPassword);
                setSessions(decrypted);
                setCryptoMode('idle');
                useWorkspaceStore.setState({ isVaultLocked: false, isUnlockModalOpen: false });
              } catch (e) {
                console.warn('Biometric unlock failed:', e);
              }
            }
          } : undefined}
          workspaceName={_activeWs?.name || activeWorkspaceId}
          themeColor={_activeWs?.themeColor}
        />
      </div>
    );
  }

  // 已打开的会话 = 真实的 tabs，不是编出来的「最近记录」
  const openTabs = tabs.filter(tb => !tb.isTornOff).slice(0, 6);
  const openHostKeys = new Set(
    tabs.map(tb => (tb.config && 'host' in tb.config ? `${tb.config.username}@${tb.config.host}` : ''))
  );
  const keyOf = (s: SessionProfile) => `${s.username}@${s.host}`;

  const wd = watchdogStatus;
  const wdOk = !!wd && wd.status === 'secure' && !wd.watchdogDisabled;

  const connect = (s: SessionProfile) => {
    if (onConnect) onConnect(s);
    else setIsCommandCenterOpen(true); // 未接线时退回指令中心，不做死按钮
  };

  return (
    <div className="drag-region w-full h-full flex flex-col bg-bg text-ink">

      {/* ── 状态带：时钟与问候留下，但这条带子要自己挣到高度 ───────────── */}
      <div className="no-drag-region flex items-end justify-between gap-7 flex-wrap
                      px-7 pt-6 pb-4 border-b border-line-soft">
        <div className="flex flex-col gap-[7px] min-w-0">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.33, 1, 0.68, 1] }}
            className="text-[54px] leading-none font-extralight tracking-[-0.035em] tabular-nums"
          >
            {timeString}
          </motion.div>
          <div className="flex items-center gap-[9px] flex-wrap">
            <Sparkles className="w-[15px] h-[15px] text-primary shrink-0" />
            <p className="text-sm font-medium text-ink-2">
              {(() => {
                const g = t(`welcome.greeting.${getGreetingKey()}`, { returnObjects: true });
                return Array.isArray(g) ? g[greetingIndex % g.length] : g;
              })()}
            </p>
            <span className="font-mono text-[10.5px] tracking-wider text-ink-3 pl-[11px] border-l border-line">
              {dateString}
            </span>
          </div>
        </div>

        <div className="flex gap-6 flex-wrap">
          <Stat value={String(sessions.length)} label={t('welcome.stats.hosts', '主机')} />
          <Stat value={String(tabs.length)} label={t('welcome.stats.sessions', '活动会话')} />
          <Stat
            text
            value={wd ? (wdOk ? t('security.watchdogSecure', '正常') : (wd.reason || t('security.watchdogWarning', '异常'))) : '—'}
            label="Watchdog"
            tone={wd ? (wdOk ? 'ok' : 'warn') : undefined}
          />
          <Stat text value={aiModel || '—'} label={t('aiSettings.activeModel', '模型端点')} />
        </div>
      </div>

      {/* ── 工作区 ─────────────────────────────────────────────────── */}
      <div className="no-drag-region flex-1 min-h-0 overflow-y-auto px-7 py-5 flex flex-col gap-6">

        {openTabs.length > 0 && (
          <section>
            <SecHead title={t('welcome.openSessions', '当前会话')} />
            <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(226px,1fr))]">
              {openTabs.map(tb => (
                <button
                  key={tb.id}
                  onClick={() => setActiveTabId(tb.id)}
                  className="group text-left bg-panel border border-line-soft rounded-[10px] px-3.5 py-3
                             flex flex-col gap-2 transition-colors hover:bg-surf hover:border-line"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-ok shrink-0" />
                    <b className="text-[13px] font-semibold truncate">{tb.title}</b>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-ink-3 truncate">
                      {tb.config && 'host' in tb.config ? `${tb.config.username}@${tb.config.host}` : '—'}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-ink-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        <section>
          <SecHead
            title={t('welcome.hosts', '主机')}
            action={
              <button
                onClick={() => setIsCommandCenterOpen(true)}
                className="flex items-center gap-1.5 text-[11.5px] text-ink-3 hover:text-primary transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('welcome.newConnection', '新建连接')}
              </button>
            }
          />

          {sessions.length === 0 ? (
            <div className="border border-dashed border-line rounded-[10px] py-10 text-center">
              <p className="text-[13px] text-ink-3 mb-3">{t('welcome.noHosts', '还没有主机')}</p>
              <button
                onClick={() => setIsCommandCenterOpen(true)}
                className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg border border-line
                           text-[12.5px] text-ink-2 hover:border-primary hover:text-primary transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('welcome.newConnection', '新建连接')}
              </button>
            </div>
          ) : (
            <div className="border border-line-soft rounded-[10px] overflow-hidden bg-panel">
              <div className="grid items-center gap-3 px-3.5 h-8 bg-surf border-b border-line-soft
                              text-[10.5px] font-semibold tracking-wider uppercase text-ink-3
                              [grid-template-columns:16px_minmax(120px,1.3fr)_minmax(140px,1.5fr)_72px_64px_minmax(80px,1fr)_24px]">
                <span />
                <span>{t('welcome.col.name', '名称')}</span>
                <span>{t('welcome.col.addr', '地址')}</span>
                <span>{t('welcome.col.proto', '协议')}</span>
                <span>{t('welcome.col.port', '端口')}</span>
                <span>{t('welcome.col.group', '分组')}</span>
                <span />
              </div>

              {sessions.map((s, i) => {
                const online = openHostKeys.has(keyOf(s));
                return (
                  <button
                    key={`${keyOf(s)}-${i}`}
                    onClick={() => connect(s)}
                    className="group w-full text-left grid items-center gap-3 px-3.5 h-[42px]
                               border-b border-line-soft last:border-b-0 transition-colors hover:bg-surf
                               [grid-template-columns:16px_minmax(120px,1.3fr)_minmax(140px,1.5fr)_72px_64px_minmax(80px,1fr)_24px]"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-ok' : 'bg-ink-3'}`} />
                    <span className="text-[12.5px] font-medium truncate">{s.alias || s.host}</span>
                    <span className="font-mono text-[11px] text-ink-2 truncate">{keyOf(s)}</span>
                    <span className="justify-self-start font-mono text-[9.5px] tracking-wider
                                     px-1.5 py-0.5 rounded-md bg-surf-2 text-ink-3 uppercase">
                      {(s.protocol || 'ssh')}
                    </span>
                    <span className="font-mono text-[11px] text-ink-3 tabular-nums">{s.port ?? 22}</span>
                    <span className="text-[11px] text-ink-3 truncate">{s.group || '—'}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-ink-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

/* ── 小件 ─────────────────────────────────────────────────────────── */

const Stat: React.FC<{ value: string; label: string; text?: boolean; tone?: 'ok' | 'warn' }> =
  ({ value, label, text, tone }) => (
    <div className="flex flex-col gap-[3px] min-w-[62px]">
      <b className={`flex items-center gap-1.5 leading-tight tabular-nums
                     ${text ? 'text-[13px] font-medium font-mono text-ink-2' : 'text-[19px] font-semibold text-ink'}`}>
        {tone === 'ok' && <ShieldCheck className="w-3.5 h-3.5 text-ok shrink-0" />}
        {tone === 'warn' && <ShieldAlert className="w-3.5 h-3.5 text-warn shrink-0" />}
        <span className="truncate max-w-[160px]">{value}</span>
      </b>
      <s className="no-underline text-[11px] text-ink-3">{label}</s>
    </div>
  );

const SecHead: React.FC<{ title: string; action?: React.ReactNode }> = ({ title, action }) => (
  <div className="flex items-baseline justify-between gap-3 mb-2.5">
    <h2 className="text-[12.5px] font-semibold text-ink-2">{title}</h2>
    {action}
  </div>
);
