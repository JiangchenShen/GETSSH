import { describe, expect, it, vi } from 'vitest';

vi.mock('../windowRegistry', () => ({ broadcastToAllWindows: vi.fn() }));

import { dropSession, emitSessionData, readScrollback } from './SessionOutputBuffer';

describe('dropped sessions', () => {
  it('ignore late output of a recently dropped session, and keep only the most recent ids', () => {
    emitSessionData('first', 'hello');
    dropSession('first');
    emitSessionData('first', 'late packet');
    expect(readScrollback('first').data).toBe('');

    for (let i = 0; i < 1024; i++) dropSession(`later-${i}`);
    emitSessionData('later-1023', 'late packet');
    expect(readScrollback('later-1023').data).toBe('');
    // 'first' is the oldest of 1025 drops: no longer remembered.
    emitSessionData('first', 'new output');
    expect(readScrollback('first').data).toBe('new output');
  });
});
