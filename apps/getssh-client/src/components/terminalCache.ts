import type { Terminal as XTerm } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { WebglAddon } from '@xterm/addon-webgl';
import type { CanvasAddon } from '@xterm/addon-canvas';
import type { LigaturesAddon } from '@xterm/addon-ligatures';
import type { SerializeAddon } from '@xterm/addon-serialize';

export interface XtermCacheEntry {
  term: XTerm;
  fitAddon: FitAddon;
  serializeAddon: SerializeAddon;
  webglAddon?: WebglAddon;
  canvasAddon?: CanvasAddon;
  ligaturesAddon?: LigaturesAddon;
  element: HTMLDivElement;
  /** Session output offset (main-process ring) already written into `term`. */
  lastOffset?: number;
  /** ssh-closed arrived; kept per entry so it is not lost while the pane is unmounted. */
  closed?: boolean;
  notifyClosed?: () => void;
  unsubClosed?: () => void;
}

// Global cache to preserve xterm instances and DOM nodes across React unmounts
export const xtermCache = new Map<string, XtermCacheEntry>();

export function disposeXtermEntry(sessionId: string) {
  const entry = xtermCache.get(sessionId);
  if (!entry) return;
  xtermCache.delete(sessionId);
  entry.unsubClosed?.();
  entry.webglAddon?.dispose();
  entry.canvasAddon?.dispose();
  entry.ligaturesAddon?.dispose();
  entry.serializeAddon.dispose();
  entry.fitAddon.dispose();
  entry.term.dispose();
}

/**
 * Disposes the cached terminals whose session is in no tab and which are not on the page. A
 * session can leave every tab while its terminal is not mounted (a torn-off tab whose window was
 * closed), and then the unmount cleanup in Terminal.tsx never runs for it again: its buffer, renderer and
 * WebGL context stayed for the life of the window.
 */
export function disposeOrphanedTerminals(live: Set<string>) {
  for (const [sessionId, entry] of xtermCache) {
    if (!live.has(sessionId) && !entry.element.isConnected) disposeXtermEntry(sessionId);
  }
}
