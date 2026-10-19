import { useAppLockStore } from '../store/appLockStore';
import { useSessionStore, type SessionProfile } from '../store/sessionStore';
import { useWorkspaceStore } from '../store/workspaceStore';

/** Adopt a complete list already saved by the main process; callers also invalidate requests on scope changes. */
export function adoptWorkspaceProfiles(result: { workspaceId: string; profiles: SessionProfile[] }): boolean {
  const workspace = useWorkspaceStore.getState();
  const app = useAppLockStore.getState().state;
  if (result.workspaceId !== workspace.activeWorkspaceId || workspace.isSwitching || workspace.isVaultLocked
    || app?.phase !== 'ready' || app.masterPasswordMustChange) return false;
  const sessions = useSessionStore.getState();
  const selected = sessions.sessions[sessions.selectedSessionIndex ?? -1];
  const updated = [...result.profiles, ...sessions.sessions.filter(profile => profile.isDraft || profile.isQuickConnect)];
  const selectedIndex = selected ? updated.findIndex(profile => profile === selected || !!profile.id && profile.id === selected.id) : -1;
  sessions.replaceSessions(updated, result.workspaceId);
  sessions.setSelectedSessionIndex(selectedIndex >= 0 ? selectedIndex : null);
  return true;
}
