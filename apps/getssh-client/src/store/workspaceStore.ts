import { create } from 'zustand';
import { useSessionStore } from './sessionStore';

export interface WorkspaceMeta {
  id: string;
  name: string;
  themeColor: string;
  hasPassword?: boolean;
  isMain?: boolean;
}

export interface Runbook {
  id: string;
  name: string;
  description?: string;
  command: string;
  dangerLevel: 'low' | 'high';
  requireMfa?: boolean;
}

export interface AgentProposal {
  id: string;
  intent: string;
  command: string;
  riskLevel: 'low' | 'medium' | 'high';
}

interface WorkspaceState {
  workspaces: WorkspaceMeta[];
  activeWorkspaceId: string;
  runbooks: Runbook[];
  isSwitching: boolean;
  isCreateModalOpen: boolean;
  /** Zero-Trust: true when the active workspace has a password and hasn't been decrypted yet */
  isVaultLocked: boolean;
  isUnlockModalOpen: boolean;
  pendingAgentProposal: AgentProposal | null;

  // Actions
  initWorkspaces: () => Promise<void>;
  switchWorkspace: (targetId: string) => Promise<boolean>;
  setWorkspaces: (workspaces: WorkspaceMeta[]) => void;
  setActiveWorkspaceId: (id: string) => void;
  setIsCreateModalOpen: (open: boolean) => void;
  setIsUnlockModalOpen: (open: boolean) => void;
  unlockVault: (password: string) => Promise<boolean>;
  setPendingAgentProposal: (proposal: AgentProposal | null) => void;
  deleteWorkspace: (id: string) => Promise<boolean>;
  setMainWorkspace: (id: string) => Promise<boolean>;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  activeWorkspaceId: 'default',
  runbooks: [],
  isSwitching: false,
  isCreateModalOpen: false,
  isVaultLocked: false,
  isUnlockModalOpen: false,
  pendingAgentProposal: null,

  setWorkspaces: (workspaces) => set({ workspaces }),
  setActiveWorkspaceId: (id) => set({ activeWorkspaceId: id }),
  setPendingAgentProposal: (proposal) => set({ pendingAgentProposal: proposal }),
  setIsCreateModalOpen: (open) => set({ isCreateModalOpen: open }),
  setIsUnlockModalOpen: (open) => set({ isUnlockModalOpen: open }),

  unlockVault: async (password: string) => {
    try {
      // Use existing unlockProfiles IPC — it decrypts AES-256-GCM and returns profiles
      const profiles = await window.electronAPI.unlockProfiles(password);
      if (!profiles || profiles.length === 0) {
        // Empty array could mean wrong password or genuinely empty vault
        // Try accepting it — the caller can validate
        useSessionStore.getState().setSessions(profiles || []);
        set({ isVaultLocked: false, isUnlockModalOpen: false });
        return true;
      }
      useSessionStore.getState().setSessions(profiles);
      set({ isVaultLocked: false, isUnlockModalOpen: false });
      return true;
    } catch (e) {
      console.error('[WorkspaceStore] Vault unlock failed:', e);
      return false;
    }
  },

  initWorkspaces: async () => {
    if (window.electronAPI?.workspace?.getWorkspaces) {
      try {
        const wsList = await window.electronAPI.workspace.getWorkspaces();
        // Assuming wsList returns { id, name, themeColor, etc }
        const mappedList: WorkspaceMeta[] = wsList.map((ws: any) => ({
          id: typeof ws === 'string' ? ws : ws.id,
          name: typeof ws === 'string' ? ws : (ws.visualMeta?.name || ws.name || ws.id),
          themeColor: typeof ws === 'string' ? '#0ea5e9' : (ws.visualMeta?.themeColor || ws.themeColor || '#0ea5e9'),
          hasPassword: typeof ws === 'string' ? false : !!(ws.visualMeta?.hasPassword || ws.hasPassword),
          isMain: typeof ws === 'string' ? ws === 'default' : !!(ws.visualMeta?.isMain || ws.isMain)
        }));
        set({ workspaces: mappedList });
        
        // Auto switch to main workspace if not currently set or if default
        const mainWs = mappedList.find(w => (w as any).isMain);
        const { activeWorkspaceId } = get();
        if (mainWs && activeWorkspaceId === 'default' && mainWs.id !== 'default') {
          setTimeout(() => get().switchWorkspace(mainWs.id), 10);
        }
      } catch (e) {
        console.error('Failed to init workspaces:', e);
      }
    }
  },

  switchWorkspace: async (targetId: string) => {
    const { activeWorkspaceId } = get();
    if (targetId === activeWorkspaceId) return true;

    set({ isSwitching: true });

    // Zero-Trust: clear sessions from memory immediately before switching
    useSessionStore.getState().setSessions([]);

    try {
      if (window.electronAPI?.workspace?.switchWorkspace) {
        const res = await window.electronAPI.workspace.switchWorkspace(targetId);
        if (res && res.success) {
          set({ activeWorkspaceId: targetId, runbooks: res.visualMeta?.runbooks || (res as any).runbooks || [] });
          
          // Try to update theme color + check vault lock using a single lookup
          const targetWs = get().workspaces.find(w => w.id === targetId);
          if (targetWs?.themeColor) {
             document.documentElement.style.setProperty('--primary-color', targetWs.themeColor);
          }

          // Zero-Trust Lazy Unlock: if target workspace has a password, lock the vault
          if (targetWs?.hasPassword) {
            set({ isVaultLocked: true, isUnlockModalOpen: true });
          } else {
            set({ isVaultLocked: false });
            // Fetch sessions immediately if the workspace is plain (unencrypted)
            try {
              const plainSessions = await window.electronAPI.unlockProfiles('');
              useSessionStore.getState().setSessions(plainSessions || []);
            } catch (err) {
              console.error('Failed to load sessions for plain workspace:', err);
              useSessionStore.getState().setSessions([]);
            }
          }
          return true;

        }
      } else {
        // Fallback for development if IPC is not fully ready
        console.warn('IPC switchWorkspace not available, mocking switch.');
        set({ activeWorkspaceId: targetId });
        return true;
      }
      return false;
    } catch (e) {
      console.error('Failed to switch workspace:', e);
      return false;
    } finally {
      // Small delay to allow CSS transitions to finish smoothly
      setTimeout(() => {
        set({ isSwitching: false });
      }, 300);
    }
  },

  deleteWorkspace: async (id: string) => {
    if (id === 'default') return false;
    try {
      if (window.electronAPI?.deleteWorkspace) {
        const res = await window.electronAPI.deleteWorkspace(id);
        if (res && res.success) {
          // Remove from list
          const { workspaces } = get();
          set({ workspaces: workspaces.filter(w => w.id !== id) });
          // If active, switch to default
          if (get().activeWorkspaceId === id) {
            await get().switchWorkspace('default');
          }
          return true;
        }
      }
      return false;
    } catch (e) {
      console.error('Failed to delete workspace:', e);
      return false;
    }
  },

  setMainWorkspace: async (id: string) => {
    try {
      if (window.electronAPI?.setMainWorkspace) {
        const res = await window.electronAPI.setMainWorkspace(id);
        if (res && res.success) {
          await get().initWorkspaces();
          return true;
        }
      }
      return false;
    } catch (e) {
      console.error('Failed to set main workspace:', e);
      return false;
    }
  }
}));
