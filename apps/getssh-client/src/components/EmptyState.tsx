import React, { useState, useEffect } from 'react';
import { Sparkles, Server, Terminal, KeyRound } from 'lucide-react';
import { useTranslation, Trans } from 'react-i18next';
import { useAppStore } from '../store/appStore';
import { useSessionStore } from '../store/sessionStore';
import { motion } from 'framer-motion';

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

  return (
    <div className="w-full h-full flex flex-1 items-center justify-center bg-transparent overflow-hidden">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="flex flex-col items-center gap-8 text-center max-w-2xl w-full px-6"
      >
        {/* Clock & Date */}
        <div className="flex flex-col items-center gap-2 cursor-default select-none mb-4">
          <motion.div 
            className={`text-7xl md:text-8xl font-black tracking-tighter ${isDark ? 'text-transparent bg-clip-text bg-gradient-to-br from-white via-white/90 to-white/20' : 'text-transparent bg-clip-text bg-gradient-to-br from-slate-900 via-slate-800 to-slate-400'}`}
          >
            {timeString}
          </motion.div>
          <div className={`text-lg md:text-xl font-medium tracking-wide uppercase ${isDark ? 'text-white/40' : 'text-slate-500'}`}>
            {dateString}
          </div>
        </div>

        {/* Greeting */}
        <div className="space-y-3">
          <h3 className={`text-2xl font-bold flex items-center justify-center gap-3 ${isDark ? 'text-white' : 'text-slate-900'}`}>
            <Sparkles className="w-6 h-6 text-purple-500" />
            {t(`welcome.greeting.${getGreetingKey()}`)}
          </h3>
          <p className={`text-base max-w-md mx-auto leading-relaxed ${isDark ? 'text-white/50' : 'text-slate-500'}`}>
              <Trans i18nKey="welcome.openCommandCenter">
                Press <kbd className="px-1.5 py-0.5 rounded border border-current opacity-70 font-mono text-xs mx-1">Ctrl+K</kbd> or <kbd className="px-1.5 py-0.5 rounded border border-current opacity-70 font-mono text-xs mx-1">Option+Space</kbd> to wake up the Command Center
              </Trans>
          </p>
        </div>
        {/* Quick Access */}
        {displaySessions.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="w-full max-w-3xl mt-6"
          >
            <div className="flex items-center gap-2 mb-4 px-2 opacity-50">
              <Server className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-widest">{t('welcome.quickAccess', 'Quick Access')}</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {displaySessions.map((session, idx) => (
                <div
                  key={idx}
                  onClick={() => handleSessionClick(session)}
                  className={`group relative flex flex-col p-4 rounded-xl border cursor-pointer transition-all duration-200 ${
                    isDark 
                      ? 'border-white/5 bg-white/5 hover:bg-white/10 hover:border-white/20' 
                      : 'border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 shadow-sm hover:shadow-md'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-3 transition-transform duration-200 group-hover:scale-110 ${
                    isDark ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-700'
                  }`}>
                    {session.protocol === 'local' ? <Terminal className="w-4 h-4" /> : <Server className="w-4 h-4" />}
                  </div>
                  <div className={`text-sm font-bold truncate ${isDark ? 'text-white' : 'text-slate-900'}`}>
                    {session.alias || session.host}
                  </div>
                  <div className={`text-xs mt-1 truncate flex items-center gap-1 ${isDark ? 'text-white/40' : 'text-slate-500'}`}>
                    {session.authType === 'key' && <KeyRound className="w-3 h-3" />}
                    <span>{session.protocol === 'local' ? 'Local Terminal' : `${session.username}@${session.host}`}</span>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
};
