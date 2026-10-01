import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const touchId = vi.hoisted(() => ({
  canPromptTouchID: vi.fn(() => true),
  promptTouchID: vi.fn(async (_reason: string) => undefined),
}));

vi.mock('electron', () => ({ systemPreferences: touchId }));

import {
  checkMasterPassword,
  failedPasswordDelay,
  resetPasswordFailuresForTest,
  secretsEqual,
  verifyOwner,
  verifyUserPresence,
  type PresenceOutcome,
} from './userPresence';

const realPlatform = process.platform;
function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

beforeEach(() => {
  resetPasswordFailuresForTest();
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
  const matchesRight = async (candidate: string) => candidate === 'right';

  it('compares in constant time regardless of length', () => {
    expect(secretsEqual('correct horse', 'correct horse')).toBe(true);
    expect(secretsEqual('correct horse', 'correct horsf')).toBe(false);
    expect(secretsEqual('short', 'a much longer value')).toBe(false);
  });

  it('delays failed attempts, longer after repeated failures', async () => {
    expect([1, 2, 3, 4, 5, 6].map(failedPasswordDelay)).toEqual([750, 750, 750, 1500, 3000, 6000]);
    expect(failedPasswordDelay(50)).toBe(30_000);

    vi.useFakeTimers();
    let settled = false;
    const attempt = checkMasterPassword('wrong', matchesRight).then(result => { settled = true; return result; });
    await vi.advanceTimersByTimeAsync(700);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(await attempt).toBe(false);
    expect(await checkMasterPassword('right', matchesRight)).toBe(true);
  });

  it('treats an unreadable stored password as a mismatch', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const attempt = checkMasterPassword('anything', async () => { throw new Error('keychain denied'); });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await attempt).toBe(false);
    warn.mockRestore();
  });

  it('never makes a Touch ID prompt wait behind failed password guesses', async () => {
    vi.useFakeTimers();
    const guesses = [1, 2, 3, 4, 5].map(() => checkMasterPassword('wrong', matchesRight));
    const prompt = verifyUserPresence('unlock');
    await vi.advanceTimersByTimeAsync(0);
    expect(await Promise.race([prompt, new Promise(resolve => setTimeout(() => resolve('blocked'), 10))]))
      .toBe('verified');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await Promise.all(guesses)).toEqual([false, false, false, false, false]);
  });
});

describe('verifyOwner', () => {
  const deps = (stored: string | null, presence: PresenceOutcome = 'verified') => ({
    hasStoredPassword: () => stored !== null,
    passwordMatches: vi.fn(async (candidate: string) => candidate === stored),
    presence: vi.fn(async () => presence),
  });

  it('has nothing to verify without a stored master password', async () => {
    const d = deps(null);
    expect(await verifyOwner({ reason: 'x' }, d)).toBe('verified');
    expect(d.presence).not.toHaveBeenCalled();
  });

  it('requires Touch ID where available and never accepts a password instead', async () => {
    const withTouchId = deps('s3cret', 'verified');
    expect(await verifyOwner({ password: 'anything', reason: 'x' }, withTouchId)).toBe('verified');
    expect(withTouchId.passwordMatches).not.toHaveBeenCalled();

    // A renderer holding the right password cannot skip a cancelled prompt.
    const cancelled = deps('s3cret', 'cancelled');
    expect(await verifyOwner({ password: 's3cret', reason: 'x' }, cancelled)).toBe('denied');
    expect(cancelled.passwordMatches).not.toHaveBeenCalled();
  });

  it('falls back to the master password only where no OS prompt exists', async () => {
    vi.useFakeTimers();
    const d = deps('s3cret', 'unsupported');
    expect(await verifyOwner({ reason: 'x' }, d)).toBe('password_required');
    expect(await verifyOwner({ password: '', reason: 'x' }, d)).toBe('password_required');
    expect(await verifyOwner({ password: 's3cret', reason: 'x' }, d)).toBe('verified');
    const wrong = verifyOwner({ password: 'guess', reason: 'x' }, d);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await wrong).toBe('denied');
  });
});
