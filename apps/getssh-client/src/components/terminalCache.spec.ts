// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { disposeOrphanedTerminals, syncTerminalRenderer, xtermCache, type XtermCacheEntry } from './terminalCache';
import { liveSessionIds } from '../store/sessionStore';

const renderers = vi.hoisted(() => ({ addons: [] as Array<{ dispose: ReturnType<typeof vi.fn>; lose: () => void }> }));
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class {
  dispose = vi.fn();
  lose = () => {};
  constructor() { renderers.addons.push(this); }
  onContextLoss(listener: () => void) { this.lose = listener; }
} }));

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

describe('terminal renderer fallback', () => {
  function terminal() {
    renderers.addons.length = 0;
    return { term: { loadAddon: vi.fn(), dispose: vi.fn(), buffer: { active: { text: 'retained output' } } } } as unknown as XtermCacheEntry;
  }
  it('uses the built-in renderer when anti-glare is off', () => {
    const entry = terminal(); syncTerminalRenderer(entry, false);
    expect(entry.term.loadAddon).not.toHaveBeenCalled(); expect(renderers.addons).toHaveLength(0);
  });
  it('disposes WebGL on a mode switch without destroying the terminal or buffer', () => {
    const entry = terminal(); const buffer = entry.term.buffer;
    syncTerminalRenderer(entry, true); syncTerminalRenderer(entry, true);
    expect(entry.term.loadAddon).toHaveBeenCalledTimes(1);
    syncTerminalRenderer(entry, false);
    expect(renderers.addons[0].dispose).toHaveBeenCalledTimes(1); expect(entry.webglAddon).toBeUndefined();
    expect(entry.term.dispose).not.toHaveBeenCalled(); expect(entry.term.buffer).toBe(buffer);
  });
  it('disposes a failed addon and can load a fresh one later', () => {
    const entry = terminal(); const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(entry.term.loadAddon).mockImplementationOnce(() => { throw new Error('WebGL unavailable'); });
    syncTerminalRenderer(entry, true);
    expect(renderers.addons[0].dispose).toHaveBeenCalled(); expect(entry.webglAddon).toBeUndefined();
    syncTerminalRenderer(entry, true);
    expect(entry.webglAddon).toBe(renderers.addons[1]); expect(entry.term.dispose).not.toHaveBeenCalled();
    warn.mockRestore();
  });
  it('falls back after context loss and ignores late loss from an old addon', () => {
    const entry = terminal(); const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    syncTerminalRenderer(entry, true); const first = renderers.addons[0]; first.lose();
    expect(first.dispose).toHaveBeenCalledTimes(1); expect(entry.webglAddon).toBeUndefined();
    syncTerminalRenderer(entry, true); const second = entry.webglAddon; first.lose();
    expect(entry.webglAddon).toBe(second); expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(entry.term.dispose).not.toHaveBeenCalled(); warn.mockRestore();
  });
});
