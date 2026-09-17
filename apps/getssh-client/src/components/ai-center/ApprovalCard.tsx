import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useAiChatStore } from '../../store/aiChatStore';

export const ApprovalCard: React.FC<{
  msg: any;
  activeConversationId: string | null;
}> = ({ msg, activeConversationId }) => {
  const { t } = useTranslation();
  const isDark = useAppStore(state => state.isDark);
  
  const [lockCountdown, setLockCountdown] = React.useState(3);

  const command = msg.approvalRequest?.command || '';
  
  const isHighRisk = React.useMemo(() => {
    const patterns = [
      /rm\s+-rf/,
      /chmod\s+(-R\s+)?777/,
      /mkfs/,
      /dd\s+if=/,
      /(wget|curl)\s+[^|]+\|\s*(bash|sh|zsh)/,
      />\s*\/dev\/[sh]d[a-z]/
    ];
    return patterns.some(p => p.test(command));
  }, [command]);

  useEffect(() => {
    if (msg.approvalRequest?.status !== 'pending' || !isHighRisk) return;
    if (lockCountdown > 0) {
      const timer = setTimeout(() => setLockCountdown(c => c - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [lockCountdown, isHighRisk, msg.approvalRequest?.status]);

  if (msg.approvalRequest?.status === 'approved') {
    return (
      <div className={`mt-3 text-xs font-bold flex items-center gap-1.5 ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        {t('ai.approvedText', '已授权，代理正在执行...')}
      </div>
    );
  }

  if (msg.approvalRequest?.status === 'rejected') {
    return (
      <div className={`mt-3 text-xs font-bold flex items-center gap-1.5 ${isDark ? 'text-rose-400' : 'text-rose-600'}`}>
        <X size={12} />
        {t('ai.rejectedText', '操作已被取消')}
      </div>
    );
  }

  if (msg.approvalRequest?.status === 'pending') {
    const isLocked = isHighRisk && lockCountdown > 0;
    
    return (
      <div className={`mt-4 p-4 rounded-xl border flex flex-col gap-3 transition-colors ${
        isHighRisk 
          ? (isDark ? 'bg-red-500/10 border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.2)]' : 'bg-red-50 border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.2)]')
          : (isDark ? 'bg-amber-500/10 border-amber-500/30' : 'bg-amber-50 border-amber-500/30')
      }`}>
        <div className={`text-xs font-bold uppercase flex items-center gap-2 ${
          isHighRisk ? 'text-red-500 animate-pulse' : (isDark ? 'text-amber-500' : 'text-amber-600')
        }`}>
          ⚠️ {isHighRisk ? t('ai.highRiskWarning', '高危操作警告 (HIGH RISK)') : t('ai.awaitingApproval', '等待您的执行授权')}
        </div>
        <code className={`block p-2 rounded text-xs font-mono break-all ${
          isHighRisk
            ? (isDark ? 'bg-black/40 text-red-300' : 'bg-white text-red-700 border border-red-200')
            : (isDark ? 'bg-black/30 text-amber-200' : 'bg-white text-amber-900 border border-amber-200')
        }`}>
          {command}
        </code>
        <div className="flex gap-2 mt-1">
          <button 
            disabled={isLocked}
            className={`flex-1 py-2 px-4 rounded-lg text-xs font-bold transition-all shadow-lg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 ${
              isHighRisk
                ? 'bg-red-600 hover:bg-red-500 text-white shadow-red-500/20'
                : 'bg-amber-500 hover:bg-amber-400 text-amber-950 shadow-amber-500/20'
            }`}
            onClick={() => {
              window.electronAPI.ai.approveAgentAction(msg.approvalRequest!.requestId, true);
              useAiChatStore.getState().updateMessage(activeConversationId!, msg.id, {
                approvalRequest: { ...msg.approvalRequest!, status: 'approved' }
              });
            }}
          >
            {isLocked ? `${t('ai.lockedBtn', '风险锁定')} (${lockCountdown}s)` : t('ai.approveBtn', '允许执行')}
          </button>
          <button 
            className={`flex-1 py-2 px-4 rounded-lg border text-xs font-bold transition-all active:scale-95 ${
              isHighRisk
                ? (isDark ? 'border-red-500/30 text-red-400 hover:bg-red-500/10' : 'border-red-200 text-red-600 hover:bg-red-50')
                : (isDark ? 'border-white/20 text-white hover:bg-white/10' : 'border-slate-300 text-slate-700 hover:bg-slate-100')
            }`}
            onClick={() => {
              window.electronAPI.ai.approveAgentAction(msg.approvalRequest!.requestId, false);
              useAiChatStore.getState().updateMessage(activeConversationId!, msg.id, {
                approvalRequest: { ...msg.approvalRequest!, status: 'rejected' }
              });
            }}
          >
            {t('ai.rejectBtn', '拒绝')}
          </button>
        </div>
      </div>
    );
  }

  return null;
};
