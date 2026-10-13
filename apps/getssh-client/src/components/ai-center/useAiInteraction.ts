import { useCallback } from 'react';
import { useAppLockStore } from '../../store/appLockStore';
import { useAppStore } from '../../store/appStore';
import { useAiStore } from '../../store/aiStore';
import { useAiChatStore } from '../../store/aiChatStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { AiBridge } from '../../services/aiBridge';
import { getPersonaContent } from '../../utils/persona';
import { ContextService } from '../../services/contextService';

export function useAiInteraction(setIsGenerating: (val: boolean) => void, targetSessionId?: string) {
  const getSessionContext = useCallback(() => {
    if (targetSessionId === undefined) return ContextService.getTerminalSessionContext();
    const { allSessions } = ContextService.getTerminalSessionContext(true);
    return { activeSession: allSessions.find(session => session.id === targetSessionId) || null, allSessions };
  }, [targetSessionId]);

  const handlePaperPlane = useCallback((code: string) => {
    const { activeSession, allSessions } = getSessionContext();
    if (!activeSession?.id && (targetSessionId !== undefined || allSessions.length !== 1)) {
      useAppStore.getState().addToast(useAppStore.getState().appConfig.language.startsWith('zh') ? '请先选择一个已连接的目标终端' : 'Select a connected target terminal first', 'warning');
      return;
    }
    const session = activeSession || allSessions[0];
    const success = ContextService.sendCommandToTerminal(session.id, code);
    if (success) {
      useAppStore.getState().addToast('代码已安全填入终端缓冲', 'success');
    }
  }, [getSessionContext, targetSessionId]);

  const generateResponse = useCallback(async (convId: string, aiMsgId: string, promptText: string, overrideSessionId?: string) => {
    const phase = useAppLockStore.getState().state?.phase;
    if ((phase && phase !== 'ready') || useWorkspaceStore.getState().isSwitching) { setIsGenerating(false); return; }
    const appConfig = useAppStore.getState().appConfig;
    const aiConfig = useAiStore.getState().aiConfig;
    const searchPayload = useAiStore.getState().getSearchPayload();

    const provider = appConfig.aiProvider || aiConfig.aiProvider || 'gemini';
    const model = appConfig.aiModel || aiConfig.aiModel || (provider === 'gemini' ? 'gemini-3.7-flash' : provider === 'claude' ? 'claude-sonnet-5' : 'gpt-5.6-terra');
    const endpoint = appConfig.aiEndpoint || aiConfig.aiEndpoint;
    const thinkingEffort = appConfig.aiThinkingEffort || aiConfig.aiThinkingEffort || 'medium';
    const aiMode = appConfig.aiMode || aiConfig.aiMode || 'readonly';
    const aiMaxTokens = appConfig.aiMaxTokens || aiConfig.aiMaxTokens || 200000;
    const activePromptId = appConfig.activePromptId || aiConfig.activePromptId;

    const workspaces = useWorkspaceStore.getState().workspaces;
    const activeWsId = useWorkspaceStore.getState().activeWorkspaceId;
    const activeWs = workspaces.find((w: any) => w.id === activeWsId);
    const workspaceName = activeWs?.name || activeWsId;
    
    const runbooks = useWorkspaceStore.getState().runbooks || [];
    // The full-page center never implicitly targets a background server.
    const requestedTarget = overrideSessionId ?? targetSessionId;
    const snapshot = requestedTarget === '' ? null : ContextService.getActiveTerminalSnapshot(requestedTarget);
    
    const sessionId = snapshot?.sessionId || '';
    const sessionName = snapshot?.name || '';
    
    let terminalBuffer = undefined;
    if (aiMode !== 'readonly' && sessionId) {
      terminalBuffer = snapshot?.buffer;
    }

    const updateMessage = useAiChatStore.getState().updateMessage;
    const appendChunk = useAiChatStore.getState().appendChunk;

    let invalidated = false;
    let finished = false;
    const isCurrent = () => !invalidated && useWorkspaceStore.getState().activeWorkspaceId === activeWsId && !useWorkspaceStore.getState().isSwitching
      && (!useAppLockStore.getState().state || useAppLockStore.getState().state?.phase === 'ready');
    const unsubscribeWorkspace = useWorkspaceStore.subscribe(state => {
      if (state.activeWorkspaceId !== activeWsId || state.isSwitching) {
        invalidated = true;
        setIsGenerating(false);
        cleanup();
      }
    });
    const unsubscribeLock = useAppLockStore.subscribe(state => {
      if (state.state && state.state.phase !== 'ready') { invalidated = true; setIsGenerating(false); cleanup(); }
    });
    const cleanup = () => { unsubscribeWorkspace(); unsubscribeLock(); };
    const finish = () => {
      if (!isCurrent() || finished) return;
      finished = true;
      updateMessage(convId, aiMsgId, { isThinking: false, isStreaming: false });
      setIsGenerating(false);
      cleanup();
    };
    try {
      await AiBridge.invokePrivileged(
        {
          requestId: crypto.randomUUID(),
          prompt: promptText,
          contextData: { 
            workspaceName, 
            sessionId,
            sessionName,
            language: appConfig.language,
            personaContent: getPersonaContent(activePromptId, appConfig.language),
            runbooks: runbooks.map(r => ({ name: r.name, description: r.description || '', dangerLevel: r.dangerLevel })), 
            terminalBuffer,
            aiSearchEnabled: searchPayload.enabled
          },
          mode: aiMode,
          provider,
          model,
          thinkingEffort,
          endpoint,
          aiMaxTokens,
          searchConfig: searchPayload
        },
        (payload) => {
          if (!isCurrent() || finished) return;
          if (payload.chunk) {
            appendChunk(convId, aiMsgId, payload.chunk);
          }
          if (payload.error) {
            finished = true;
            updateMessage(convId, aiMsgId, { content: `[Error] ${payload.error}`, isThinking: false, isStreaming: false });
            setIsGenerating(false);
            cleanup();
          } else if (payload.isDone) finish();
        },
        (command: string, requestId: string) => {
           if (!isCurrent() || finished) return;
           updateMessage(convId, aiMsgId, { approvalRequest: { command, requestId, status: 'pending' } });
        }
      );
      // invoke acknowledges starting the request; only the later isDone event completes it.
    } catch (err: any) {
      if (isCurrent() && !finished) {
        finished = true;
        updateMessage(convId, aiMsgId, { content: `[Pipeline Error] ${err.message}`, isThinking: false, isStreaming: false });
        setIsGenerating(false);
      }
      cleanup();
    }
  }, [setIsGenerating, targetSessionId]);

  return {
    getSessionContext,
    handlePaperPlane,
    generateResponse
  };
}
