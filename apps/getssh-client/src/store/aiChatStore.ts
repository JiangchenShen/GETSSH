/**
 * AI Chat Store — Persistent Conversation History
 *
 * Uses Zustand with manual localStorage persistence so that conversations
 * survive component unmounts, panel close/open cycles, and app restarts.
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { AiBridge } from '../services/aiBridge';

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

  setView: (view: 'chat' | 'history') => void;

  // ── SQLite Async Actions ──────────────────────────────────────────────────
  loadWorkspaceChats: () => Promise<void>;
  /** Reads the next older page of a chat's messages (when olderMessages is set). */
  loadOlderMessages: (conversationId: string) => Promise<void>;
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
const loadingMessages = new Set<string>();

// ── Store ─────────────────────────────────────────────────────────────────────

export const useAiChatStore = create<AiChatState>()(
  immer((set, get) => {
  /** Reads a page of a chat's messages: the newest when it opens, older ones on request. */
  const loadMessages = async (conversationId: string, older: boolean) => {
    const conv = get().conversations.find(c => c.id === conversationId);
    if (!conv || loadingMessages.has(conversationId)) return;
    if (older ? !conv.olderMessages : conv.messagesLoaded !== false) return;
    loadingMessages.add(conversationId);
    try {
      const page = await AiBridge.getMessages(conversationId, older ? conv.olderMessages : null);
      if (!page) return;
      set(state => {
        const target = state.conversations.find(c => c.id === conversationId);
        if (!target) return;
        const loaded = page.messages.map(toMessage);
        const ids = new Set(loaded.map(m => m.id));
        // An older page goes before what is shown; a first page before messages added while it was read.
        target.messages = [...loaded, ...target.messages.filter(m => !ids.has(m.id))];
        target.messagesLoaded = true;
        target.olderMessages = page.before;
      });
    } catch (e) {
      console.error('Failed to load chat messages', e);
    } finally {
      loadingMessages.delete(conversationId);
    }
  };

  return {
    conversations: [],
    activeConversationId: null,
    view: 'chat',

    loadWorkspaceChats: async () => {
      try {
        const dbSessions = await AiBridge.listSessions();
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
      set(state => {
        state.conversations = state.conversations.filter(c => c.id !== id);
        if (state.activeConversationId === id) {
          state.activeConversationId = state.conversations[0]?.id ?? null;
        }
      });
      AiBridge.deleteSession(id).catch(console.error);
    },

    clearAllConversations: () => {
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
      let finalMsg: any = null;
      set(state => {
        const conv = state.conversations.find(c => c.id === conversationId);
        if (!conv) return;
        const msg = conv.messages.find(m => m.id === msgId);
        if (msg) {
          Object.assign(msg, patch);
          finalMsg = { ...msg };
        }
        conv.updatedAt = Date.now();
      });
      
      // Save final message state when streaming completes
      if (finalMsg && !patch.isStreaming && !patch.isThinking) {
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
      set(state => {
        const conv = state.conversations.find(c => c.id === conversationId);
        if (!conv) return;
        const msg = conv.messages.find(m => m.id === msgId);
        if (msg) {
          msg.content += chunk;
          msg.isThinking = false;
          msg.isStreaming = true;
        }
        conv.updatedAt = Date.now();
      });
    },

    setView: (view) => set(state => { state.view = view; }),
  };
  })
);
