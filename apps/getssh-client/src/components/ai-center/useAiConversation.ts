import { useEffect, useState } from 'react';
import type React from 'react';
import { useAiChatStore } from '../../store/aiChatStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useAiInteraction } from './useAiInteraction';

/** One conversation flow shared by the full AI workbench and its floating companion. */
export function useAiConversation() {
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId);
  const loadWorkspaceChats = useAiChatStore(state => state.loadWorkspaceChats);
  const activeConversationId = useAiChatStore(state => state.activeConversationId);
  const newConversation = useAiChatStore(state => state.newConversation);
  const addMessage = useAiChatStore(state => state.addMessage);
  const updateMessage = useAiChatStore(state => state.updateMessage);
  const setView = useAiChatStore(state => state.setView);
  const [isGenerating, setIsGenerating] = useState(false);
  const [prompt, setPrompt] = useState('');
  const { getSessionContext, handlePaperPlane, generateResponse } = useAiInteraction(setIsGenerating);

  useEffect(() => {
    if (activeWorkspaceId) void loadWorkspaceChats();
  }, [activeWorkspaceId, loadWorkspaceChats]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const currentPrompt = prompt.trim();
    if (!currentPrompt || isGenerating) return;

    let convId = activeConversationId;
    if (!convId || !useAiChatStore.getState().conversations.some(c => c.id === convId)) {
      convId = newConversation();
    }

    setPrompt('');
    setIsGenerating(true);
    setView('chat');
    addMessage(convId, { id: `user-${Date.now()}`, role: 'user', content: currentPrompt, timestamp: Date.now() });

    const { activeSession, allSessions } = getSessionContext();
    if (!activeSession && allSessions.length > 1) {
      addMessage(convId, {
        id: `ai-${Date.now() + 1}`, role: 'assistant', content: '', timestamp: Date.now(),
        serverSelectionRequest: { availableServers: allSessions, pendingPrompt: currentPrompt, status: 'pending' },
      });
      setIsGenerating(false);
      return;
    }

    const aiMsgId = `ai-${Date.now() + 1}`;
    addMessage(convId, { id: aiMsgId, role: 'assistant', content: '', isThinking: true, isStreaming: false, timestamp: Date.now() });
    await generateResponse(convId, aiMsgId, currentPrompt);
  };

  const handleRetry = async (aiMsgId: string, userText: string) => {
    if (isGenerating || !activeConversationId) return;
    setIsGenerating(true);
    updateMessage(activeConversationId, aiMsgId, { content: '', isThinking: true, isStreaming: false, approvalRequest: undefined });
    await generateResponse(activeConversationId, aiMsgId, userText);
  };

  const handleServerSelect = async (aiMsgId: string, serverId: string, serverName: string) => {
    if (!activeConversationId) return;
    const activeConv = useAiChatStore.getState().conversations.find(c => c.id === activeConversationId);
    const aiMsg = activeConv?.messages.find(m => m.id === aiMsgId);
    if (!aiMsg?.serverSelectionRequest) return;

    const pendingPrompt = aiMsg.serverSelectionRequest.pendingPrompt;
    updateMessage(activeConversationId, aiMsgId, {
      content: `已锁定目标服务器：**${serverName}**\n正在为您生成操作...`,
      serverSelectionRequest: { ...aiMsg.serverSelectionRequest, status: 'resolved', selectedServerId: serverId },
      isThinking: true,
    });
    setIsGenerating(true);
    await generateResponse(activeConversationId, aiMsgId, pendingPrompt, serverId);
  };

  return { prompt, setPrompt, isGenerating, handleSubmit, handleRetry, handleServerSelect, handlePaperPlane };
}
