/**
 * AI Chat Store — Persistent Conversation History
 *
 * Uses Zustand with manual localStorage persistence so that conversations
 * survive component unmounts, panel close/open cycles, and app restarts.
 */
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
  isThinking?: boolean;
  timestamp: number;
}

export interface Conversation {
  id: string;
  title: string;        // auto-derived from first user message
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
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
}

// ── localStorage persistence helpers ─────────────────────────────────────────
const STORAGE_KEY = 'getssh:ai-chat-history';
const MAX_CONVERSATIONS = 50; // cap to avoid unbounded growth

function load(): Pick<AiChatState, 'conversations' | 'activeConversationId'> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { conversations: [], activeConversationId: null };
}

function save(state: AiChatState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      conversations: state.conversations,
      activeConversationId: state.activeConversationId,
    }));
  } catch {}
}

// ── Store ─────────────────────────────────────────────────────────────────────
const persisted = load();

export const useAiChatStore = create<AiChatState>()(
  immer((set, get) => ({
    conversations: persisted.conversations,
    activeConversationId: persisted.activeConversationId,
    view: 'chat',

    newConversation: () => {
      const id = `conv-${Date.now()}`;
      set(state => {
        state.conversations.unshift({
          id,
          title: '新对话',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [],
        });
        // Trim to max
        if (state.conversations.length > MAX_CONVERSATIONS) {
          state.conversations = state.conversations.slice(0, MAX_CONVERSATIONS);
        }
        state.activeConversationId = id;
        state.view = 'chat';
      });
      save(get());
      return id;
    },

    setActiveConversation: (id) => {
      set(state => {
        state.activeConversationId = id;
        state.view = 'chat';
      });
      save(get());
    },

    deleteConversation: (id) => {
      set(state => {
        state.conversations = state.conversations.filter(c => c.id !== id);
        if (state.activeConversationId === id) {
          state.activeConversationId = state.conversations[0]?.id ?? null;
        }
      });
      save(get());
    },

    clearAllConversations: () => {
      set(state => {
        state.conversations = [];
        state.activeConversationId = null;
      });
      save(get());
    },

    addMessage: (conversationId, msg) => {
      set(state => {
        const conv = state.conversations.find(c => c.id === conversationId);
        if (!conv) return;
        conv.messages.push(msg);
        conv.updatedAt = Date.now();
        // Auto-title from first user message
        if (msg.role === 'user' && conv.title === '新对话') {
          conv.title = msg.content.slice(0, 40) + (msg.content.length > 40 ? '…' : '');
        }
      });
      save(get());
    },

    updateMessage: (conversationId, msgId, patch) => {
      set(state => {
        const conv = state.conversations.find(c => c.id === conversationId);
        if (!conv) return;
        const msg = conv.messages.find(m => m.id === msgId);
        if (msg) Object.assign(msg, patch);
        conv.updatedAt = Date.now();
      });
      // Don't persist on every stream tick — only on final update
      if (!patch.isStreaming && !patch.isThinking) {
        save(get());
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
      // Don't write to localStorage on every chunk for performance
    },

    setView: (view) => set(state => { state.view = view; }),
  }))
);
