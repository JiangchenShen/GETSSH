// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CreateWorkspaceModal } from './CreateWorkspaceModal';
import { UnlockVaultModal } from './UnlockVaultModal';
import { SecurityOverlay } from './SecurityOverlay';

const mocks = vi.hoisted(() => ({ lockdown: undefined as ((info: { reason: string; countdown: number }) => void) | undefined }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }) }));
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: { div: ({ initial: _initial, animate: _animate, exit: _exit, transition: _transition, ...props }: any) => <div {...props} /> },
}));
vi.mock('../store/appStore', () => ({ useAppStore: (select: (state: any) => any) => select({ isDark: false, setIsPolluted: () => {} }) }));
vi.mock('../store/workspaceStore', () => ({ useWorkspaceStore: (select: (state: any) => any) => select({
  isCreateModalOpen: true, isUnlockModalOpen: true, activeWorkspaceId: 'current', workspaces: [{ id: 'current', name: 'Current' }],
  setIsCreateModalOpen: () => {}, setIsUnlockModalOpen: () => {}, switchWorkspace: () => {}, unlockVault: vi.fn(),
}) }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.lockdown = undefined;
  window.electronAPI = { onSecurityLockdown: (callback: typeof mocks.lockdown) => { mocks.lockdown = callback; return () => {}; } } as unknown as Window['electronAPI'];
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it.each([
  { name: 'workspace creation', component: CreateWorkspaceModal },
  { name: 'workspace unlock', component: UnlockVaultModal },
  { name: 'security lockdown', component: SecurityOverlay },
])('marks $name as a named modal so migration notices cannot cover it', async ({ component: Component }) => {
  await act(async () => root.render(<Component />));
  if (Component === SecurityOverlay) await act(async () => mocks.lockdown!({ reason: 'Test warning', countdown: 0 }));
  const dialog = container.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull(); expect(dialog!.getAttribute('aria-modal')).toBe('true');
  const namedBy = dialog!.getAttribute('aria-labelledby');
  const name = dialog!.getAttribute('aria-label') ?? (namedBy ? document.getElementById(namedBy)?.textContent : null);
  expect(name?.trim()).toBeTruthy();
});

it('marks the high-risk runbook confirmation as a named modal in the app shell', () => {
  // Booting App also boots its native services. Restrict this structural check to the runbook
  // confirmation's opening tag; the other modal checks above render the actual components.
  const source = readFileSync(`${process.cwd()}/src/App.tsx`, 'utf8');
  const confirmation = source.split('{pendingHighRiskRunbook && (')[1]?.match(/<motion\.div\s([\s\S]*?)\n\s*>/)?.[1];
  expect(confirmation).toBeDefined();
  expect(confirmation).toMatch(/role="dialog"/);
  expect(confirmation).toMatch(/aria-modal="true"/);
  expect(confirmation).toMatch(/aria-label="High Risk Operation"/);
});
