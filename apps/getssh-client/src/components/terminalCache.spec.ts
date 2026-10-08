// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { disposeOrphanedTerminals, xtermCache, type XtermCacheEntry } from './terminalCache';
import { liveSessionIds } from '../store/sessionStore';

function entry(connected: boolean) {
  const dispose = vi.fn();
  const fake = {
    term: { dispose }, fitAddon: { dispose: vi.fn() }, serializeAddon: { dispose: vi.fn() },
    element: { isConnected: connected },
  } as unknown as XtermCacheEntry;
  return { fake, dispose };
}

describe('disposeOrphanedTerminals', () => {
  it('disposes a cached terminal whose session left every tab while it was not on the page', () => {
    const torn = entry(false);
    const shown = entry(true);
    const elsewhere = entry(false);
    xtermCache.set('closed-with-torn-window', torn.fake);
    xtermCache.set('on-screen', shown.fake);
    xtermCache.set('in-a-background-tab', elsewhere.fake);
    const tabs = [{ paneTree: { type: 'leaf', id: 'p1', sessionId: 'in-a-background-tab' } }] as any;
    disposeOrphanedTerminals(liveSessionIds(tabs));
    expect(torn.dispose).toHaveBeenCalled();
    expect(xtermCache.has('closed-with-torn-window')).toBe(false);
    expect(shown.dispose).not.toHaveBeenCalled();
    expect(elsewhere.dispose).not.toHaveBeenCalled();
    xtermCache.clear();
  });
});
