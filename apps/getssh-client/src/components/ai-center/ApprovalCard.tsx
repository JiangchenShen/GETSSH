import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useAiChatStore } from '../../store/aiChatStore';
import { useAppLockStore } from '../../store/appLockStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

export const ApprovalCard: React.FC<{
  msg: any;
  activeConversationId: string | null;
}> = ({ msg, activeConversationId }) => {
  const { t, i18n } = useTranslation();
  
  const [lockCountdown, setLockCountdown] = React.useState(3);

  const command = msg.approvalRequest?.command || '';
  const decide = (approved: boolean) => {
    const phase = useAppLockStore.getState().state?.phase;
    const current = useAiChatStore.getState().conversations.find(conv => conv.id === activeConversationId)
      ?.messages.find(message => message.id === msg.id)?.approvalRequest;
    if ((phase && phase !== 'ready') || useWorkspaceStore.getState().isSwitching || !current || current.status !== 'pending' || current.requestId !== msg.approvalRequest?.requestId) return;
    window.electronAPI.ai.approveAgentAction(current.requestId, approved);
    useAiChatStore.getState().updateMessage(activeConversationId!, msg.id, {
      approvalRequest: { ...current, status: approved ? 'approved' : 'rejected' },
    });
  };
  
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
      <div className="mt-3 text-xs font-medium flex items-center gap-1.5 text-ok">
        <div className="w-1.5 h-1.5 rounded-full bg-ok" />
        {t('ai.approvedText', '已授权，代理正在执行...')}
      </div>
    );
  }

  if (msg.approvalRequest?.status === 'expired') {
    return <p className="mt-3 text-xs text-ink-3">{i18n.language.startsWith('zh') ? '授权请求已过期，请重新发起。' : 'Approval expired. Start a new request.'}</p>;
  }

  if (msg.approvalRequest?.status === 'rejected') {
    return (
      <div className="mt-3 text-xs font-medium flex items-center gap-1.5 text-down">
        <X size={12} />
        {t('ai.rejectedText', '操作已被取消')}
      </div>
    );
  }

  if (msg.approvalRequest?.status === 'pending') {
    const isLocked = isHighRisk && lockCountdown > 0;
    
    return (
      <div className={`mt-3 p-3.5 rounded-lg border flex flex-col gap-2.5 transition-colors ${
        isHighRisk 
          ? 'bg-down/5 border-down/30'
          : 'bg-warn/5 border-warn/30'
      }`}>
        <div className={`text-xs font-semibold flex items-center gap-1.5 ${
          isHighRisk ? 'text-down' : 'text-warn'
        }`}>
          ⚠️ {isHighRisk ? t('ai.highRiskWarning', '高风险命令确认') : t('ai.awaitingApproval', '等待您的执行授权')}
        </div>
        <code className="block px-2.5 py-2 rounded-md border border-line-soft bg-bg text-xs font-mono text-ink break-all">
          {command}
        </code>
        <div className="flex gap-2 mt-0.5">
          <button 
            type="button"
            disabled={isLocked}
            className={`flex-1 py-1.5 px-3 rounded-md border text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              isHighRisk
                ? 'border-down/40 bg-down/15 hover:bg-down/25 text-down'
                : 'border-transparent bg-primary hover:brightness-95 text-[var(--primary-ink)]'
            }`}
            onClick={() => decide(true)}
          >
            {isLocked ? `${t('ai.lockedBtn', '风险锁定')} (${lockCountdown}s)` : t('ai.approveBtn', '允许执行')}
          </button>
          <button 
            type="button"
            className="flex-1 py-1.5 px-3 rounded-md border border-line bg-surf hover:bg-surf-2 text-ink-2 hover:text-ink text-xs font-medium transition-colors"
            onClick={() => decide(false)}
          >
            {t('ai.rejectBtn', '拒绝')}
          </button>
        </div>
      </div>
    );
  }

  return null;
};
