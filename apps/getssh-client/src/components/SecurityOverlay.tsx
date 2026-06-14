import React, { useEffect, useState } from 'react';
import { ShieldAlert, RefreshCcw, Save, ShieldOff, Terminal, Key, Unlock } from 'lucide-react';
import { useAppStore } from '../store/appStore';

export const SecurityOverlay: React.FC = () => {
  const [lockdownInfo, setLockdownInfo] = useState<{ reason: string; countdown: number; level?: 'red' | 'yellow' } | null>(null);
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
           return;
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

  const isRed = lockdownInfo.level !== 'yellow'; // default to red

  // Theme Variables
  const ambientBg = isRed ? 'bg-[#0f0303]' : 'bg-[#121002]';
  const glowCore = isRed ? 'bg-red-600/30' : 'bg-yellow-600/30';
  const glowOuter = isRed ? 'bg-red-900/20' : 'bg-yellow-900/20';
  const accentColor = isRed ? 'text-red-500' : 'text-yellow-500';
  const borderColor = isRed ? 'border-red-500/30' : 'border-yellow-500/30';
  const boxBg = isRed ? 'bg-red-950/20' : 'bg-yellow-950/20';
  const btnPrimary = isRed ? 'bg-red-600 hover:bg-red-500 text-white shadow-[0_0_30px_rgba(220,38,38,0.4)]' : 'bg-yellow-500 hover:bg-yellow-400 text-yellow-950 shadow-[0_0_30px_rgba(234,179,8,0.4)]';
  const statusTitle = isRed ? 'SYSTEM LOCKDOWN' : 'SECURITY WARNING';
  const statusSubtitle = isRed ? '内存完整性破坏 - 极高危风险' : '异常插件拦截 - 运行环境警告';

  return (
    <div 
      className={`fixed inset-0 z-[99999] flex flex-col items-center justify-center ${ambientBg} overflow-hidden text-slate-50 select-none pointer-events-auto`}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {/* Ambient Lighting */}
      <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] ${glowCore} blur-[120px] rounded-full mix-blend-screen pointer-events-none animate-pulse`} />
      <div className={`absolute inset-0 ${glowOuter} blur-[150px] mix-blend-overlay pointer-events-none`} />

      {/* Grid Container */}
      <div className="relative z-10 w-full max-w-5xl px-8 flex flex-col gap-6 animate-in zoom-in-95 duration-500">
        
        {/* Top Row: Icon/Title & Countdown */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* Card 1: Alert Header */}
          <div className={`col-span-1 md:col-span-2 p-8 border ${borderColor} ${boxBg} backdrop-blur-2xl rounded-3xl shadow-2xl flex items-center gap-8 relative overflow-hidden group`}>
            <div className={`absolute -left-10 top-1/2 -translate-y-1/2 w-40 h-40 ${glowCore} blur-3xl opacity-50`} />
            
            <div className={`relative shrink-0 w-24 h-24 rounded-2xl flex items-center justify-center border ${borderColor} bg-black/40 shadow-inner group-hover:scale-105 transition-transform duration-500`}>
              <ShieldAlert className={`w-12 h-12 ${accentColor} drop-shadow-[0_0_15px_currentColor] animate-pulse`} />
            </div>
            
            <div className="relative">
              <h1 className="text-4xl md:text-5xl font-black tracking-tighter mb-2 text-white drop-shadow-md">
                {statusTitle}
              </h1>
              <h2 className={`text-sm md:text-lg font-bold tracking-widest uppercase ${accentColor}`}>
                {statusSubtitle}
              </h2>
            </div>
          </div>

          {/* Card 2: Countdown Timer */}
          <div className={`p-8 border ${borderColor} ${boxBg} backdrop-blur-2xl rounded-3xl shadow-2xl flex flex-col items-center justify-center relative overflow-hidden`}>
            <div className={`absolute -right-10 top-1/2 -translate-y-1/2 w-40 h-40 ${glowCore} blur-3xl opacity-50`} />
            <div className="text-xs font-bold text-white/50 uppercase tracking-widest mb-2">Time Remaining</div>
            <div className={`text-6xl md:text-7xl font-black font-mono tracking-tighter ${accentColor} drop-shadow-[0_0_20px_currentColor]`}>
              00:{lockdownInfo.countdown.toString().padStart(2, '0')}
            </div>
          </div>

        </div>

        {/* Middle Row: Terminal Output */}
        <div className={`p-8 border ${borderColor} bg-black/80 backdrop-blur-3xl rounded-3xl shadow-2xl flex flex-col relative`}>
          <div className="flex items-center gap-3 mb-4 pb-4 border-b border-white/10">
            <Terminal className={`w-5 h-5 ${accentColor}`} />
            <span className="text-xs font-bold uppercase tracking-widest text-white/50">Trace Log // Violation Details</span>
          </div>
          <div className={`font-mono text-sm leading-relaxed whitespace-pre-wrap break-all ${isRed ? 'text-red-300' : 'text-yellow-300'} h-40 overflow-y-auto pr-4 custom-scrollbar`}>
            <span className={accentColor}>{'> '}</span>[VIOLATION DETECTED]<br />
            {lockdownInfo.reason}
          </div>
        </div>

        {/* Bottom Row: Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative">
          
          {pwdPrompt ? (
            <div className={`col-span-1 md:col-span-2 p-8 border ${borderColor} bg-black/90 backdrop-blur-3xl rounded-3xl shadow-2xl flex flex-col gap-6 animate-in slide-in-from-bottom-8`}>
              <div className="flex items-center gap-3">
                <Key className={`w-6 h-6 ${accentColor}`} />
                <h3 className="text-lg font-bold text-white tracking-wide">Identity Verification Required</h3>
              </div>
              <p className="text-sm text-white/50 font-medium">Please enter your Master Password to override this security lockdown. Leave blank if no password is set.</p>
              
              <div className="flex gap-4">
                <input 
                  type="password" 
                  value={pwdInput} 
                  onChange={(e) => setPwdInput(e.target.value)} 
                  placeholder="••••••••••••"
                  className={`flex-1 bg-black/50 border border-white/10 rounded-xl p-4 text-white outline-none font-mono tracking-widest transition-all focus:border-${isRed ? 'red' : 'yellow'}-500/50 focus:bg-white/5`}
                  autoFocus 
                  onKeyDown={(e) => e.key === 'Enter' && submitIgnore()}
                />
                <button onClick={submitIgnore} className={`px-8 rounded-xl font-black uppercase tracking-widest transition-all ${btnPrimary}`}>
                  <Unlock className="w-5 h-5 inline-block mr-2" /> Verify
                </button>
                <button onClick={() => setPwdPrompt(false)} className="px-8 rounded-xl font-bold border border-white/10 bg-white/5 hover:bg-white/10 transition-all text-white/80">
                  Cancel
                </button>
              </div>
            </div>
          ) : isRed ? (
            <>
              {/* Primary Danger Action */}
              <button 
                onClick={handleRestartSafe}
                className={`col-span-1 md:col-span-2 p-6 rounded-3xl border border-transparent flex items-center justify-center gap-4 text-xl font-black tracking-widest uppercase transition-all duration-300 hover:scale-[1.02] ${btnPrimary}`}
              >
                <RefreshCcw className="w-6 h-6" /> Reboot into Safe Mode
              </button>
              
              {/* Secondary Actions */}
              <button 
                onClick={handleSave15s}
                className="p-6 rounded-3xl border border-white/10 bg-white/5 hover:bg-white/10 backdrop-blur-md flex items-center justify-center gap-3 text-sm font-bold tracking-widest uppercase transition-all"
              >
                <Save className="w-5 h-5 opacity-70" /> Emergency Save (15s)
              </button>

              <button 
                onClick={handleIgnore}
                className="p-6 rounded-3xl border border-transparent bg-transparent hover:bg-red-950/30 flex items-center justify-center gap-3 text-sm font-bold tracking-widest uppercase text-red-500/40 hover:text-red-400 transition-all"
              >
                <ShieldOff className="w-5 h-5" /> Ignore & Continue (Not Recommended)
              </button>
            </>
          ) : (
            <>
              {/* Primary Warning Action */}
              <button 
                onClick={() => {
                  window.electronAPI.resolveSecurityLockdown('deactivate-plugin');
                  setIsPolluted(false);
                  setLockdownInfo(null);
                }}
                className={`col-span-1 md:col-span-2 p-6 rounded-3xl border border-transparent flex items-center justify-center gap-4 text-xl font-black tracking-widest uppercase transition-all duration-300 hover:scale-[1.02] ${btnPrimary}`}
              >
                <ShieldAlert className="w-6 h-6" /> Deactivate Malicious Plugin
              </button>
              
              {/* Secondary Actions */}
              <button 
                onClick={() => {
                  window.electronAPI.resolveSecurityLockdown('continue');
                  setIsPolluted(false);
                  setLockdownInfo(null);
                }}
                className="p-6 rounded-3xl border border-white/10 bg-white/5 hover:bg-white/10 backdrop-blur-md flex items-center justify-center gap-3 text-sm font-bold tracking-widest uppercase transition-all"
              >
                <RefreshCcw className="w-5 h-5 opacity-70" /> Continue Execution
              </button>

              <button 
                onClick={handleIgnore}
                className="p-6 rounded-3xl border border-transparent bg-transparent hover:bg-yellow-950/30 flex items-center justify-center gap-3 text-sm font-bold tracking-widest uppercase text-yellow-500/40 hover:text-yellow-400 transition-all"
              >
                <ShieldOff className="w-5 h-5" /> Ignore Warning
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
