import React, { useEffect, useState } from 'react';
import { ShieldAlert, RefreshCcw, Save, ShieldOff } from 'lucide-react';
import { useAppStore } from '../store/appStore';

export const SecurityOverlay: React.FC = () => {
  const [lockdownInfo, setLockdownInfo] = useState<{ reason: string; countdown: number } | null>(null);
  const setIsPolluted = useAppStore(state => state.setIsPolluted);

  const [pwdPrompt, setPwdPrompt] = useState(false);
  const [pwdInput, setPwdInput] = useState('');

  useEffect(() => {
    if (window.electronAPI?.onSecurityLockdown) {
      const remove = window.electronAPI.onSecurityLockdown((data) => {
        setLockdownInfo(data);
      });
      return remove;
    }
  }, []);

  useEffect(() => {
    if (!lockdownInfo) return;
    
    let timerId: NodeJS.Timeout;
    if (lockdownInfo.countdown > 0) {
      timerId = setInterval(() => {
        setLockdownInfo(prev => prev ? { ...prev, countdown: prev.countdown - 1 } : null);
      }, 1000);
    }

    return () => {
      if (timerId) clearInterval(timerId);
    };
  }, [lockdownInfo]);

  const handleRestartSafe = () => {
    window.electronAPI.resolveSecurityLockdown('restart-safe');
  };

  const handleSave15s = () => {
    window.electronAPI.resolveSecurityLockdown('save-15s');
    setLockdownInfo(null);
  };

  const submitIgnore = () => {
    window.electronAPI.resolveSecurityLockdown('ignore');
    setIsPolluted(true);
    setLockdownInfo(null);
    setPwdPrompt(false);
  };

  const handleIgnore = async () => {
    if (window.electronAPI?.promptBiometricUnlock) {
      const res = await window.electronAPI.promptBiometricUnlock();
      if (!res.success) {
        if (res.reason === 'unsupported' || res.reason === 'no_key') {
           setPwdPrompt(true);
           return; // Wait for user to submit via the inline form
        } else {
           return;
        }
      }
    } else {
      setPwdPrompt(true);
      return;
    }

    submitIgnore();
  };

  if (!lockdownInfo) return null;

  return (
    <div 
      className="fixed inset-0 z-[99999] flex flex-col items-center justify-center bg-red-950/90 backdrop-blur-3xl text-red-50 select-none animate-in fade-in duration-300 pointer-events-auto"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <div className="flex flex-col items-center max-w-2xl text-center space-y-6">
        <div className="w-24 h-24 rounded-full bg-red-500/20 flex items-center justify-center animate-pulse">
          <ShieldAlert className="w-12 h-12 text-red-500" />
        </div>
        
        <h1 className="text-4xl font-black tracking-tight text-white">GETSSH SECURE CENTER</h1>
        
        <div className="px-6 py-4 bg-black/40 border border-red-500/30 rounded-xl w-full">
          <h2 className="text-xl font-bold text-red-400 mb-2">⚠️ 内存完整性已被破坏，您的安全底线正面临重大风险！</h2>
          <p className="text-sm text-red-200/80 font-mono break-all whitespace-pre-wrap text-left">{lockdownInfo.reason}</p>
        </div>

        <div className="text-8xl font-black font-mono tracking-tighter text-red-500 my-8">
          00:{lockdownInfo.countdown.toString().padStart(2, '0')}
        </div>

        <div className="flex flex-col gap-4 w-full max-w-md">
          {pwdPrompt ? (
            <div className="bg-black/60 p-6 rounded-xl border border-red-500/50 flex flex-col gap-4 animate-in slide-in-from-bottom-2">
              <p className="text-sm text-red-200">Verify identity with Master Password to ignore (leave blank if not set):</p>
              <input 
                type="password" 
                value={pwdInput} 
                onChange={(e) => setPwdInput(e.target.value)} 
                className="w-full bg-black/50 border border-white/20 rounded-md p-2 text-white outline-none focus:border-red-500" 
                autoFocus 
                onKeyDown={(e) => e.key === 'Enter' && submitIgnore()}
              />
              <div className="flex gap-2 mt-2">
                <button onClick={() => setPwdPrompt(false)} className="flex-1 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm transition-all">Cancel</button>
                <button onClick={submitIgnore} className="flex-1 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-sm font-bold shadow-lg shadow-red-900/50 transition-all">Confirm</button>
              </div>
            </div>
          ) : (
            <>
              <button 
                onClick={handleRestartSafe}
                className="w-full flex items-center justify-center gap-3 py-4 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold text-lg transition-all shadow-lg shadow-red-900/50"
              >
                <RefreshCcw className="w-5 h-5" /> 【立刻重启至安全模式】
              </button>
              
              <button 
                onClick={handleSave15s}
                className="w-full flex items-center justify-center gap-3 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-medium transition-all"
              >
                <Save className="w-4 h-4" /> 【抢救性存盘 (解锁 15 秒)】
              </button>

              <button 
                onClick={handleIgnore}
                className="w-full flex items-center justify-center gap-2 py-2 mt-4 opacity-50 hover:opacity-100 text-red-400 hover:text-red-300 text-xs transition-all"
              >
                <ShieldOff className="w-3 h-3" /> 【忽略风险并继续】(不推荐)
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
