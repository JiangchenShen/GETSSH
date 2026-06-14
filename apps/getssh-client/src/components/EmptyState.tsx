import React, { useState, useEffect, useMemo } from 'react';
import { Sparkles, Server, Terminal, KeyRound } from 'lucide-react';
import { useTranslation, Trans } from 'react-i18next';
import { useAppStore } from '../store/appStore';
import { useSessionStore } from '../store/sessionStore';
import { motion } from 'framer-motion';
import { MoovierTile } from '@moovier/core';

interface EmptyStateProps {
  onConnect?: (session: any) => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ onConnect }) => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  const sessions = useSessionStore(state => state.sessions);
  const [time, setTime] = useState(new Date());
  const [recentSessions, setRecentSessions] = useState<any[]>([]);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    
    // Load recent sessions
    try {
      const stored = localStorage.getItem('getssh_recent_sessions');
      if (stored) {
        const parsed = JSON.parse(stored);
        // Map stored IDs back to actual session objects
        const recents = parsed
          .map((id: string) => sessions.find(s => `${s.username}@${s.host}` === id))
          .filter(Boolean);
        setRecentSessions(recents);
      }
    } catch (e) {}

    return () => clearInterval(timer);
  }, [sessions]);

  const displaySessions = recentSessions.length > 0 ? recentSessions.slice(0, 4) : sessions.slice(0, 4);

  const handleSessionClick = (session: any) => {
    try {
      const id = `${session.username}@${session.host}`;
      const stored = localStorage.getItem('getssh_recent_sessions');
      let parsed = stored ? JSON.parse(stored) : [];
      parsed = parsed.filter((i: string) => i !== id);
      parsed.unshift(id);
      localStorage.setItem('getssh_recent_sessions', JSON.stringify(parsed.slice(0, 10)));
    } catch (e) {}
    
    if (onConnect) {
      onConnect(session);
    }
  };

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

  const greetingIndex = useMemo(() => Math.floor(Math.random() * 10), []);

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col justify-center gap-6 animate-in fade-in zoom-in-95 duration-500">
      
      {/* Top Row: Clock, Greeting and Hint */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Left: Clock & Greeting Tile */}
        <MoovierTile exemptFromFocus dragLevel="fixed" className={`col-span-1 md:col-span-2 p-10 flex flex-col justify-center rounded-[32px] min-h-[240px] ${!isDark && '!bg-white !border-black/5 shadow-sm'}`}>
          <div className="flex flex-col items-start gap-4 cursor-default select-none">
            <h3 className={`text-2xl font-bold flex items-center gap-3 ${isDark ? 'text-white' : 'text-slate-900'}`}>
              <Sparkles className="w-6 h-6 text-primary" />
              {(() => {
                const greetingObj = t(`welcome.greeting.${getGreetingKey()}`, { returnObjects: true });
                return Array.isArray(greetingObj) ? greetingObj[greetingIndex % greetingObj.length] : greetingObj;
              })()}
            </h3>
            <div className="flex flex-col items-start">
              <motion.div 
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className={`text-6xl md:text-8xl font-black tracking-tighter ${isDark ? 'text-transparent bg-clip-text bg-gradient-to-br from-white via-white/90 to-white/20' : 'text-transparent bg-clip-text bg-gradient-to-br from-slate-900 via-slate-800 to-slate-400'}`}
              >
                {timeString}
              </motion.div>
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                className={`mt-2 text-lg md:text-xl font-medium tracking-wide uppercase ${isDark ? 'text-white/40' : 'text-slate-500'}`}
              >
                {dateString}
              </motion.div>
            </div>
          </div>
        </MoovierTile>

        {/* Right: Hint Tile */}
        <MoovierTile exemptFromFocus dragLevel="fixed" className={`col-span-1 p-8 flex flex-col items-center justify-center text-center rounded-[32px] min-h-[240px] group ${!isDark && '!bg-white !border-black/5 shadow-sm'}`}>
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1, type: "spring", stiffness: 200, damping: 20 }}
            className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 shadow-inner flex items-center justify-center mb-6 group-hover:bg-white/10 transition-colors duration-300"
          >
            <div className="text-xl font-black text-primary">⌘</div>
          </motion.div>
          <h3 className={`text-lg font-bold mb-3 ${isDark ? 'text-white' : 'text-slate-900'}`}>
            Command Center
          </h3>
          <p className={`text-sm leading-relaxed ${isDark ? 'text-white/50' : 'text-slate-500'}`}>
            <Trans i18nKey="welcome.openCommandCenter">
              Press <kbd className="px-2 py-1 rounded-md border border-current opacity-70 font-mono text-xs mx-1 bg-background/50 shadow-sm">Ctrl+K</kbd> or <kbd className="px-2 py-1 rounded-md border border-current opacity-70 font-mono text-xs mx-1 bg-background/50 shadow-sm">⌥ Space</kbd> to wake up the Command Center
            </Trans>
          </p>
        </MoovierTile>
      </div>

      {/* Bottom Row: Quick Access Tiles */}
      {displaySessions.length > 0 && (
        <div className="w-full">
          <div className="flex items-center gap-2 mb-4 px-2 opacity-50">
            <Server className="w-4 h-4" />
            <span className="text-xs font-bold uppercase tracking-widest">{t('welcome.quickAccess', 'Quick Access')}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {displaySessions.map((session, idx) => (
              <MoovierTile
                key={idx}
                exemptFromFocus
                dragLevel="fixed"
                onClick={() => handleSessionClick(session)}
                className={`group relative flex flex-col p-6 rounded-[32px] cursor-pointer h-[200px] ${!isDark && '!bg-white !border-black/5 shadow-sm'}`}
              >
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-auto transition-transform duration-300 group-hover:scale-110 ${
                  isDark ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-700'
                }`}>
                  {session.protocol === 'local' ? <Terminal className="w-6 h-6" /> : <Server className="w-6 h-6" />}
                </div>
                <div>
                  <div className={`text-xl font-bold truncate ${isDark ? 'text-white' : 'text-slate-900'}`}>
                    {session.alias || session.host}
                  </div>
                  <div className={`text-sm mt-2 truncate flex items-center gap-1.5 ${isDark ? 'text-white/40' : 'text-slate-500'}`}>
                    {session.authType === 'key' && <KeyRound className="w-3.5 h-3.5" />}
                    <span>{session.protocol === 'local' ? 'Local Terminal' : `${session.username}@${session.host}`}</span>
                  </div>
                </div>
              </MoovierTile>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
