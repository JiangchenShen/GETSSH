/**
 * AI Chat Store — Persistent Conversation History
 *
 * Uses Zustand with manual localStorage persistence so that conversations
 * survive component unmounts, panel close/open cycles, and app restarts.
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { AiBridge } from '../services/aiBridge';
import { useWorkspaceStore } from './workspaceStore';
import { useAppLockStore } from './appLockStore';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  isThinking?: boolean;
  timestamp: number;
  approvalRequest?: { command: string, requestId: string, status?: 'pending' | 'approved' | 'rejected' };
  serverSelectionRequest?: {
    availableServers: { id: string, name: string }[];
    pendingPrompt: string;
    status?: 'pending' | 'resolved';
    selectedServerId?: string;
  };
}

export interface Conversation {
  id: string;
  title: string;        // auto-derived from first user message
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  /** From the chat list: the start of the first reply, shown before the messages are read. */
  preview?: string;
  /** false for a chat from the list whose messages are not read yet; they are read when it opens. */
  messagesLoaded?: boolean;
  /** Reads the messages before the loaded ones (loadOlderMessages); null when there are none. */
  olderMessages?: string | null;
}

interface AiChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  /** 'chat' | 'history' — which view is open in the panel */
  view: 'chat' | 'history';

  // ── Actions ──────────────────────────────────────────────────────────────
  newConversation: () => string;
  setActiveConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  clearAllConversations: () => void;

  addMessage: (conversationId: string, msg: ChatMessage) => void;
  updateMessage: (conversationId: string, msgId: string, patch: Partial<ChatMessage>) => void;
  appendChunk: (conversationId: string, msgId: string, chunk: string) => void;
  /** Apply queued stream text immediately before completion, persistence or leaving a workspace. */
  flushChunks: () => void;

  setView: (view: 'chat' | 'history') => void;

  // ── SQLite Async Actions ──────────────────────────────────────────────────
  loadWorkspaceChats: () => Promise<void>;
  /** Reads the next older page of a chat's messages (when olderMessages is set). */
  loadOlderMessages: (conversationId: string) => Promise<boolean>;
}

const toMessage = (m: any): ChatMessage => ({
  id: m.id,
  role: m.role,
  content: m.content,
  raw_content: m.raw_content,
  timestamp: m.timestamp,
  isStreaming: false,
  isThinking: false,
} as ChatMessage);

/** Chats whose messages are being read, so opening one twice reads it once. */
const loadingMessages = new Map<string, object>();
let workspaceGeneration = 0;

// ── Store ─────────────────────────────────────────────────────────────────────

export const useAiChatStore = create<AiChatState>()(
  immer((set, get) => {
  const pendingChunks = new Map<string, Map<string, string>>();
  let cancelFrame: (() => void) | null = null;
  const takeChunk = (conversationId: string, messageId: string) => {
    const messages = pendingChunks.get(conversationId);
    const chunk = messages?.get(messageId) ?? '';
    messages?.delete(messageId);
    if (!messages?.size) pendingChunks.delete(conversationId);
    return chunk;
  };
  const flushChunks = () => {
    cancelFrame?.();
    cancelFrame = null;
    if (!pendingChunks.size) return;
    const pending = new Map(pendingChunks);
    pendingChunks.clear();
    set(state => {
      for (const [conversationId, messages] of pending) {
        const conv = state.conversations.find(c => c.id === conversationId);
        if (!conv) continue;
        for (const [messageId, chunk] of messages) {
          const msg = conv.messages.find(m => m.id === messageId);
          if (!msg) continue;
          msg.content += chunk;
          msg.isThinking = false;
          msg.isStreaming = true;
          conv.updatedAt = Date.now();
        }
      }
    });
  };
  /** Reads a page of a chat's messages: the newest when it opens, older ones on request. */
  const loadMessages = async (conversationId: string, older: boolean) => {
    const conv = get().conversations.find(c => c.id === conversationId);
    if (!conv || loadingMessages.has(conversationId)) return false;
    if (older ? !conv.olderMessages : conv.messagesLoaded !== false) return false;
    const token = {};
    const epoch = workspaceGeneration;
    const cursor = older ? conv.olderMessages : null;
    loadingMessages.set(conversationId, token);
    try {
      const page = await AiBridge.getMessages(conversationId, cursor);
      if (!page || epoch !== workspaceGeneration || loadingMessages.get(conversationId) !== token
        || !get().conversations.some(c => c.id === conversationId) || (older && page.before === cursor)) return false;
      set(state => {
        const target = state.conversations.find(c => c.id === conversationId);
        if (!target) return;
        const loaded = page.messages.map(toMessage);
        const ids = new Set(target.messages.map(m => m.id));
        // An older page goes before what is shown; a first page before messages added while it was read.
        // Keep current objects (including an in-flight reply) when a page overlaps them.
        target.messages = [...loaded.filter(message => {
          if (ids.has(message.id)) return false;
          ids.add(message.id);
          return true;
        }), ...target.messages];
        target.messagesLoaded = true;
        target.olderMessages = page.before;
      });
      return true;
    } catch {
      return false;
    } finally {
      if (loadingMessages.get(conversationId) === token) loadingMessages.delete(conversationId);
    }
  };

  return {
    conversations: [],
    activeConversationId: null,
    view: 'chat',

    loadWorkspaceChats: async () => {
      const epoch = workspaceGeneration;
      try {
        const dbSessions = await AiBridge.listSessions();
        if (epoch !== workspaceGeneration) return;
        const previous = new Map(get().conversations.map(c => [c.id, c]));
        const conversations: Conversation[] = dbSessions.map(s => {
          // A chat already read keeps its messages.
          const known = previous.get(s.id);
          return {
            id: s.id,
            title: s.title,
            createdAt: s.created_at,
            updatedAt: s.updated_at,
            preview: s.preview ?? undefined,
            messages: known && known.messagesLoaded !== false ? known.messages : [],
            messagesLoaded: known ? known.messagesLoaded : false,
            olderMessages: known?.olderMessages ?? null,
          };
        });

        set(state => {
          // Merge dbSessions with any locally created sessions that haven't been fetched yet
          const existingIds = new Set(conversations.map(c => c.id));
          const locallyCreated = state.conversations.filter(c => !existingIds.has(c.id));
          
          state.conversations = [...locallyCreated, ...conversations];
          
          // Verify if activeConversationId is still valid, else pick first or null
          if (!state.activeConversationId || !state.conversations.find(c => c.id === state.activeConversationId)) {
            state.activeConversationId = state.conversations.length > 0 ? state.conversations[0].id : null;
          }
        });
        const active = get().activeConversationId;
        if (active) void loadMessages(active, false);
      } catch (e) {
        console.error('Failed to load workspace chats', e);
      }
    },

    loadOlderMessages: (conversationId) => loadMessages(conversationId, true),

    newConversation: () => {
      const id = `conv-${Date.now()}`;
      const now = Date.now();
      
      set(state => {
        state.conversations.unshift({
          id,
          title: '新对话',
          createdAt: now,
          updatedAt: now,
          messages: [],
        });
        if (state.conversations.length > 50) {
          state.conversations = state.conversations.slice(0, 50);
        }
        state.activeConversationId = id;
        state.view = 'chat';
      });
      
      // Async save
      AiBridge.createSession(id, '新对话', now).catch(console.error);
      return id;
    },

    setActiveConversation: (id) => {
      set(state => {
        state.activeConversationId = id;
        state.view = 'chat';
      });
      void loadMessages(id, false);
    },

    deleteConversation: (id) => {
      pendingChunks.delete(id);
      loadingMessages.delete(id);
      set(state => {
        state.conversations = state.conversations.filter(c => c.id !== id);
        if (state.activeConversationId === id) {
          state.activeConversationId = state.conversations[0]?.id ?? null;
        }
      });
      AiBridge.deleteSession(id).catch(console.error);
    },

    clearAllConversations: () => {
      pendingChunks.clear();
      loadingMessages.clear();
      cancelFrame?.(); cancelFrame = null;
      // In SQLite we let the user manually delete or implement a bulk delete
      // For now, clear state.
      set(state => {
        state.conversations.forEach(c => {
          AiBridge.deleteSession(c.id).catch(console.error);
        });
        state.conversations = [];
        state.activeConversationId = null;
      });
    },

    addMessage: (conversationId, msg) => {
      set(state => {
        const conv = state.conversations.find(c => c.id === conversationId);
        if (!conv) return;
        conv.messages.push(msg);
        conv.updatedAt = Date.now();
        
        if (msg.role === 'user' && conv.title === '新对话') {
          const newTitle = msg.content.slice(0, 40) + (msg.content.length > 40 ? '…' : '');
          conv.title = newTitle;
          AiBridge.updateSessionTitle(conv.id, newTitle).catch(console.error);
        }
      });
      
      // Save message to SQLite
      AiBridge.saveMessage({
        id: msg.id,
        session_id: conversationId,
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp
      }).catch(console.error);
    },

    updateMessage: (conversationId, msgId, patch) => {
      // A reset/error replaces queued text. Completion folds the final, unpainted tokens into
      // this same update so the last chunk is also present in the saved message.
      const chunk = takeChunk(conversationId, msgId);
      let finalMsg: any = null;
      set(state => {
        const conv = state.conversations.find(c => c.id === conversationId);
        if (!conv) return;
        const msg = conv.messages.find(m => m.id === msgId);
        if (msg) {
          if (patch.content === undefined && chunk) {
            msg.content += chunk;
            msg.isThinking = false;
            msg.isStreaming = true;
          }
          Object.assign(msg, patch);
          finalMsg = { ...msg };
        }
        conv.updatedAt = Date.now();
      });
      
      // Save final message state when streaming completes
      if (finalMsg && !finalMsg.isStreaming && !finalMsg.isThinking) {
        AiBridge.saveMessage({
          id: finalMsg.id,
          session_id: conversationId,
          role: finalMsg.role,
          content: finalMsg.content,
          timestamp: finalMsg.timestamp
        }).catch(console.error);
      }
    },

    appendChunk: (conversationId, msgId, chunk) => {
      if (!chunk || !get().conversations.find(c => c.id === conversationId)?.messages.some(m => m.id === msgId)) return;
      let messages = pendingChunks.get(conversationId);
      if (!messages) { messages = new Map(); pendingChunks.set(conversationId, messages); }
      messages.set(msgId, (messages.get(msgId) ?? '') + chunk);
      if (cancelFrame) return;
      if (typeof requestAnimationFrame === 'function') {
        const frame = requestAnimationFrame(() => { cancelFrame = null; flushChunks(); });
        cancelFrame = () => cancelAnimationFrame(frame);
      } else {
        const timer = setTimeout(() => { cancelFrame = null; flushChunks(); }, 16);
        cancelFrame = () => clearTimeout(timer);
      }
    },
    flushChunks,

    setView: (view) => set(state => { state.view = view; }),
  };
  })
);

useWorkspaceStore.subscribe((next, previous) => {
  if (next.isSwitching && !previous.isSwitching) {
    // switchWorkspace sets this before invoking the main process: persist the partial reply
    // while its own workspace is still active, then ignore that stream's later tokens.
    useAiChatStore.getState().flushChunks();
    const state = useAiChatStore.getState();
    for (const conv of state.conversations) for (const msg of conv.messages) {
      if (msg.isStreaming || msg.isThinking) state.updateMessage(conv.id, msg.id, { isStreaming: false, isThinking: false });
    }
    workspaceGeneration++;
    loadingMessages.clear();
  }
  if (next.activeWorkspaceId !== previous.activeWorkspaceId) {
    workspaceGeneration++;
    loadingMessages.clear();
    // No persistence after this point: the backend already belongs to the new workspace.
    useAiChatStore.setState({ conversations: [], activeConversationId: null });
    useAiChatStore.getState().flushChunks();
  }
});

useAppLockStore.subscribe((next, previous) => {
  if (next.state?.phase !== 'locked' || previous.state?.phase === 'locked') return;
  workspaceGeneration++;
  loadingMessages.clear();
  // Retain the received partial reply in memory, but never send a save after the backend locked.
  // Draining also cancels its scheduled frame before a later unlock can load another snapshot.
  useAiChatStore.getState().flushChunks();
  useAiChatStore.setState(state => ({ conversations: state.conversations.map(conv => ({
    ...conv, messages: conv.messages.map(msg => msg.isStreaming || msg.isThinking ? { ...msg, isStreaming: false, isThinking: false } : msg),
  })) }));
});
