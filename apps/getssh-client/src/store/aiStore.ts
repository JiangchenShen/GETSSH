import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AiPrompt {
  id: string;
  title: string;
  desc: string;
  content: string;
}

export interface AiConfig {
  aiEndpoint: string;
  hasAiApiKey: boolean;
  aiProvider: 'openai' | 'gemini' | 'claude' | 'ollama' | 'deepseek' | 'zhipu' | 'kimi' | 'custom';
  aiModel: string;
  aiThinkingEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  aiEnabled: boolean;
  aiMode: 'readonly' | 'assistant' | 'agent_semi' | 'agent_full';
  activePromptId: string;
  customPrompts: AiPrompt[];
  aiMaxTokens: number;
  aiSearchEnabled: boolean;
  aiSearchProvider: 'hybrid' | 'google' | 'searxng' | 'duckduckgo' | 'bing';
  aiSearchGoogleApiKey?: string;
  aiSearchGoogleCx?: string;
  aiSearchCustomUrl?: string;
}

export const DEFAULT_AI_CONFIG: AiConfig = {
  aiEndpoint: '',
  hasAiApiKey: false,
  aiProvider: 'gemini',
  aiModel: 'gemini-3.7-flash',
  aiThinkingEffort: 'medium',
  aiEnabled: true,
  aiMode: 'readonly',
  activePromptId: 'default',
  customPrompts: [],
  aiMaxTokens: 200000,
  aiSearchEnabled: true,
  aiSearchProvider: 'hybrid',
  aiSearchGoogleApiKey: '',
  aiSearchGoogleCx: '',
  aiSearchCustomUrl: '',
};

interface AiState {
  aiConfig: AiConfig;
  updateAiConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
  setAiConfig: (config: Partial<AiConfig>) => void;
  resetAiConfig: () => void;
  getSearchPayload: () => {
    enabled: boolean;
    provider: 'hybrid' | 'google' | 'searxng' | 'duckduckgo' | 'bing';
    googleApiKey?: string;
    googleCx?: string;
    customUrl?: string;
  };
}

export const useAiStore = create<AiState>()(
  persist(
    (set, get) => ({
      aiConfig: DEFAULT_AI_CONFIG,

      updateAiConfig: (key, value) =>
        set((state) => ({
          aiConfig: {
            ...state.aiConfig,
            [key]: value,
          },
        })),

      setAiConfig: (partial) =>
        set((state) => ({
          aiConfig: {
            ...state.aiConfig,
            ...partial,
          },
        })),

      resetAiConfig: () => set({ aiConfig: DEFAULT_AI_CONFIG }),

      getSearchPayload: () => {
        const { aiConfig } = get();
        return {
          enabled: aiConfig.aiSearchEnabled ?? true,
          provider: aiConfig.aiSearchProvider || 'hybrid',
          googleApiKey: aiConfig.aiSearchGoogleApiKey,
          googleCx: aiConfig.aiSearchGoogleCx,
          customUrl: aiConfig.aiSearchCustomUrl,
        };
      },
    }),
    {
      name: 'getssh_ai_settings_v1', // Separate, isolated LocalStorage partition
    }
  )
);
