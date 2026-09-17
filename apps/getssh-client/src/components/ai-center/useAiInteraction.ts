import { useAppStore } from '../../store/appStore';
import { useAiStore } from '../../store/aiStore';
import { useAiChatStore } from '../../store/aiChatStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { AiBridge } from '../../services/aiBridge';
import { getPersonaContent } from '../../utils/persona';
import { ContextService } from '../../services/contextService';

export function useAiInteraction(setIsGenerating: (val: boolean) => void) {
  const getSessionContext = () => {
    return ContextService.getTerminalSessionContext();
  };

  const handlePaperPlane = (code: string) => {
    const { activeSession, allSessions } = getSessionContext();
    if (!activeSession?.id && allSessions.length !== 1) {
      useAppStore.getState().addToast('多个终端环境可用，请先在此框外激活一个目标', 'warning');
      return;
    }
    const session = activeSession || allSessions[0];
    const success = ContextService.sendCommandToTerminal(session.id, code);
    if (success) {
      useAppStore.getState().addToast('代码已安全填入终端缓冲', 'success');
    }
  };

  const generateResponse = async (convId: string, aiMsgId: string, promptText: string, overrideSessionId?: string) => {
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
    const snapshot = ContextService.getActiveTerminalSnapshot(overrideSessionId);
    
    const sessionId = snapshot?.sessionId || '';
    const sessionName = snapshot?.name || '';
    
    let terminalBuffer = undefined;
    if (aiMode !== 'readonly' && sessionId) {
      terminalBuffer = snapshot?.buffer;
    }

    const updateMessage = useAiChatStore.getState().updateMessage;
    const appendChunk = useAiChatStore.getState().appendChunk;

    let firstChunk = false;
    try {
      await AiBridge.invokePrivileged(
        {
          requestId: aiMsgId,
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
          if (payload.chunk) {
            if (!firstChunk) {
              firstChunk = true;
              updateMessage(convId, aiMsgId, { isThinking: false, isStreaming: true });
            }
            appendChunk(convId, aiMsgId, payload.chunk);
          }
          if (payload.isDone) {
            updateMessage(convId, aiMsgId, { isThinking: false, isStreaming: false });
            setIsGenerating(false);
          }
          if (payload.error) {
            updateMessage(convId, aiMsgId, { content: `[Error] ${payload.error}`, isThinking: false, isStreaming: false });
            setIsGenerating(false);
          }
        },
        (command: string, requestId: string) => {
           updateMessage(convId, aiMsgId, { approvalRequest: { command, requestId, status: 'pending' } });
        }
      );
    } catch (err: any) {
      updateMessage(convId, aiMsgId, { content: `[Pipeline Error] ${err.message}`, isThinking: false, isStreaming: false });
      setIsGenerating(false);
    }
  };

  return {
    getSessionContext,
    handlePaperPlane,
    generateResponse
  };
}
