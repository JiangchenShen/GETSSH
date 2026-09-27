import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const touchId = vi.hoisted(() => ({
  canPromptTouchID: vi.fn(() => true),
  promptTouchID: vi.fn(async (_reason: string) => undefined),
}));

vi.mock('electron', () => ({ systemPreferences: touchId }));

import {
  checkMasterPassword,
  secretsEqual,
  unlockWithBiometrics,
  verifyOwner,
  verifyUserPresence,
  type BiometricUnlockDeps,
  type PresenceOutcome,
} from './userPresence';

const realPlatform = process.platform;
function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

beforeEach(() => {
  setPlatform('darwin');
  touchId.canPromptTouchID.mockReset().mockReturnValue(true);
  touchId.promptTouchID.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  setPlatform(realPlatform);
  vi.useRealTimers();
});

describe('verifyUserPresence', () => {
  it('maps the Touch ID result', async () => {
    expect(await verifyUserPresence('test')).toBe('verified');
    touchId.promptTouchID.mockRejectedValueOnce(new Error('cancelled'));
    expect(await verifyUserPresence('test')).toBe('cancelled');
    touchId.canPromptTouchID.mockReturnValueOnce(false);
    expect(await verifyUserPresence('test')).toBe('unsupported');
  });

  it('reports unsupported off macOS (no Windows Hello yet) without prompting', async () => {
    setPlatform('win32');
    expect(await verifyUserPresence('test')).toBe('unsupported');
    expect(touchId.promptTouchID).not.toHaveBeenCalled();
  });

  it('shows one OS prompt at a time', async () => {
    let open = 0;
    let maxOpen = 0;
    touchId.promptTouchID.mockImplementation(async () => {
      open++;
      maxOpen = Math.max(maxOpen, open);
      await new Promise(resolve => setTimeout(resolve, 10));
      open--;
    });
    const results = await Promise.all([verifyUserPresence('a'), verifyUserPresence('b'), verifyUserPresence('c')]);
    expect(results).toEqual(['verified', 'verified', 'verified']);
    expect(maxOpen).toBe(1);
  });
});

describe('master password checks', () => {
  it('compares in constant time regardless of length', () => {
    expect(secretsEqual('correct horse', 'correct horse')).toBe(true);
    expect(secretsEqual('correct horse', 'correct horsf')).toBe(false);
    expect(secretsEqual('short', 'a much longer value')).toBe(false);
  });

  it('delays failed attempts', async () => {
    vi.useFakeTimers();
    let settled = false;
    const attempt = checkMasterPassword('wrong', async () => 'right').then(result => { settled = true; return result; });
    await vi.advanceTimersByTimeAsync(700);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(await attempt).toBe(false);
    expect(await checkMasterPassword('right', async () => 'right')).toBe(true);
  });

  it('treats an unreadable stored password as a mismatch', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const attempt = checkMasterPassword('anything', async () => { throw new Error('keychain denied'); });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await attempt).toBe(false);
    warn.mockRestore();
  });
});

describe('verifyOwner', () => {
  const deps = (stored: string | null, presence: PresenceOutcome = 'verified') => ({
    hasStoredPassword: () => stored !== null,
    readStoredPassword: async () => stored ?? '',
    presence: vi.fn(async () => presence),
  });

  it('has nothing to verify without a stored master password', async () => {
    const d = deps(null);
    expect(await verifyOwner({ reason: 'x' }, d)).toBe('verified');
    expect(d.presence).not.toHaveBeenCalled();
  });

  it('accepts the right password and rejects a wrong one without prompting', async () => {
    vi.useFakeTimers();
    const d = deps('s3cret');
    expect(await verifyOwner({ password: 's3cret', reason: 'x' }, d)).toBe('verified');
    const wrong = verifyOwner({ password: 'guess', reason: 'x' }, d);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await wrong).toBe('denied');
    expect(d.presence).not.toHaveBeenCalled();
  });

  it('uses the OS prompt when no password is given', async () => {
    expect(await verifyOwner({ reason: 'x' }, deps('s3cret', 'verified'))).toBe('verified');
    expect(await verifyOwner({ reason: 'x' }, deps('s3cret', 'cancelled'))).toBe('denied');
    expect(await verifyOwner({ reason: 'x' }, deps('s3cret', 'unsupported'))).toBe('password_required');
    expect(await verifyOwner({ password: '', reason: 'x' }, deps('s3cret', 'unsupported'))).toBe('password_required');
  });
});

describe('unlockWithBiometrics', () => {
  const base = (overrides: Partial<BiometricUnlockDeps> = {}): BiometricUnlockDeps => ({
    isMainSender: true,
    getActiveWorkspaceId: () => 'work',
    getWorkspace: () => ({ name: 'Work', biometricEnabled: true }),
    hasStoredPassword: () => true,
    readStoredPassword: async () => 'master-pw',
    presence: vi.fn(async () => 'verified' as PresenceOutcome),
    ...overrides,
  });

  it('releases the password only after the OS verified the user', async () => {
    const deps = base();
    expect(await unlockWithBiometrics(deps)).toEqual({ success: true, masterPassword: 'master-pw' });
    expect(deps.presence).toHaveBeenCalledWith('unlock the workspace "Work"');
  });

  const refusals: Array<[string, Partial<BiometricUnlockDeps>]> = [
    ['unauthorized', { isMainSender: false }],
    ['not_enabled', { getWorkspace: () => ({ name: 'Work', biometricEnabled: false }) }],
    ['not_enabled', { getWorkspace: () => null }],
    ['no_key', { hasStoredPassword: () => false }],
  ];
  it.each(refusals)('refuses with %s before any prompt', async (reason, overrides) => {
    const deps = base(overrides);
    expect(await unlockWithBiometrics(deps)).toEqual({ success: false, reason });
    expect(deps.presence).not.toHaveBeenCalled();
  });

  it.each(['cancelled', 'unsupported'] as const)('does not release the password when the prompt is %s', async outcome => {
    const read = vi.fn(async () => 'master-pw');
    const result = await unlockWithBiometrics(base({ presence: async () => outcome, readStoredPassword: read }));
    expect(result).toEqual({ success: false, reason: outcome });
    expect(read).not.toHaveBeenCalled();
  });

  it('refuses if the active workspace changed while the prompt was open', async () => {
    let active = 'work';
    const result = await unlockWithBiometrics(base({
      getActiveWorkspaceId: () => active,
      presence: async () => { active = 'other'; return 'verified'; },
    }));
    expect(result).toEqual({ success: false, reason: 'workspace_changed' });
  });

  it('reports a stored password that cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await unlockWithBiometrics(base({ readStoredPassword: async () => { throw new Error('denied'); } }));
    expect(result).toEqual({ success: false, reason: 'read_failed' });
    warn.mockRestore();
  });
});
