import React, { useState } from 'react';
import { Lock, ShieldAlert, KeyRound, ArrowRight, Fingerprint } from 'lucide-react';

interface CryptoModalProps {
  mode: 'locked' | 'setup';
  isDark: boolean;
  onUnlock: (password: string) => Promise<boolean>;
  onSetup: (password: string) => Promise<void>;
  onCancel?: () => void;   // Permanently skip (no more prompts)
  onSkip?: () => void;     // Skip this time only
  onRetryBiometric?: () => void; // Manually retry TouchID
}

export function CryptoModal({ mode, isDark, onUnlock, onSetup, onCancel, onSkip, onRetryBiometric }: CryptoModalProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (mode === 'setup') {
      if (password !== confirm) {
        setError('Passwords do not match');
        return;
      }
      if (password.length < 4) {
        setError('Password too short (min 4 chars)');
        return;
      }
      setLoading(true);
      await onSetup(password);
      setLoading(false);
    } else {
      setLoading(true);
      const success = await onUnlock(password);
      setLoading(false);
      if (!success) {
        setError('Invalid master password or corrupted file');
      }
    }
  };

  return (
    <div className={`fixed inset-0 z-[100] flex items-center justify-center backdrop-blur-[10px] bg-black/50 transition-all`}>
      <div className={`w-full max-w-md p-8 rounded-[20px] shadow-2xl border flex flex-col relative ${isDark ? 'bg-black/60 border-white/10 text-white' : 'bg-white/90 border-black/10 text-black'}`}>
        
        {/* Top-right action buttons for setup mode */}
        {mode === 'setup' && (onSkip || onCancel) && (
          <div className="absolute top-4 right-4 flex items-center gap-3">
            {onSkip && (
              <button
                onClick={onSkip}
                className="opacity-50 hover:opacity-100 text-sm transition-opacity"
                title="Skip for now — will be prompted again next time"
              >
                Skip
              </button>
            )}
            {onCancel && (
              <button
                onClick={onCancel}
                className="opacity-50 hover:opacity-100 text-sm transition-opacity"
                title="Cancel — won't be prompted again"
              >
                Cancel
              </button>
            )}
          </div>
        )}

        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center">
            {mode === 'locked' ? <Lock className="w-8 h-8 text-primary" /> : <ShieldAlert className="w-8 h-8 text-primary" />}
          </div>
        </div>

        <h2 className="text-2xl font-bold text-center mb-2">
          {mode === 'locked' ? 'Zero-Knowledge Storage Locked' : 'Initialize Secure Storage'}
        </h2>
        <p className="text-sm opacity-60 text-center mb-8">
          {mode === 'locked' 
            ? 'Your SSH profiles are locally encrypted using AES-256-GCM. Enter your Master Password to decrypt.'
            : 'Set a Master Password to encrypt your SSH profiles. This password is never saved or transmitted.'}
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 text-red-500 rounded-lg text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="relative">
            <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-50" />
            <input 
              type="password" 
              autoFocus
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Master Password" 
              className={`w-full pl-10 ${mode === 'locked' && onRetryBiometric ? 'pr-12' : 'pr-4'} py-3 rounded-[20px] border outline-none transition-colors ${isDark ? 'bg-black/40 border-white/10 focus:border-primary' : 'bg-black/5 border-black/10 focus:border-primary'}`}
              required
            />
            {mode === 'locked' && onRetryBiometric && (
              <button
                type="button"
                onClick={onRetryBiometric}
                className={`absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-full transition-colors ${isDark ? 'hover:bg-white/10 text-primary' : 'hover:bg-black/5 text-primary'}`}
                title="Retry TouchID"
              >
                <Fingerprint className="w-5 h-5" />
              </button>
            )}
          </div>

          {mode === 'setup' && (
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-50" />
              <input 
                type="password" 
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="Confirm Master Password" 
                className={`w-full pl-10 pr-4 py-3 rounded-[20px] border outline-none transition-colors ${isDark ? 'bg-black/40 border-white/10 focus:border-primary' : 'bg-black/5 border-black/10 focus:border-primary'}`}
                required
              />
            </div>
          )}

          <button 
            type="submit" 
            disabled={loading || !password || (mode === 'setup' && !confirm)}
            className="mt-4 flex items-center justify-center gap-2 w-full py-3 rounded-[20px] bg-primary hover:bg-primary text-white font-medium transition-all disabled:opacity-50"
          >
            {loading ? 'Processing...' : (mode === 'locked' ? 'Decrypt Profiles' : 'Encrypt & Save')}
            {!loading && <ArrowRight className="w-4 h-4" />}
          </button>
        </form>
      </div>
    </div>
  );
}
