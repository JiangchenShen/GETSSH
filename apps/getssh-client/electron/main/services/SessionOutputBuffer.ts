import { broadcastToAllWindows } from '../windowRegistry';

/**
 * Per-session terminal output ring, kept in the main process.
 *
 * Every chunk sent on `ssh-data-<id>` carries the absolute character offset at which it ends.
 * A terminal that (re)mounts in any window — first mount, workspace switch, tear-off, tear-in —
 * pulls what it missed with `readScrollback(id, lastOffset)` and then keeps writing live chunks
 * whose `endOffset` is past what it already has. That replaces the old renderer-side buffer
 * hand-offs and the fixed 800 ms "wait for the renderer to subscribe" hold.
 *
 * Offsets count UTF-16 code units (JS string length) since the session started.
 */

const MAX_CHARS = 1_000_000;
// Small writes (keystroke echo) are appended to the last chunk up to this size, so the ring holds
// a few dozen chunks instead of hundreds of thousands and trimming from the front stays cheap.
const CHUNK_COALESCE_CHARS = 64 * 1024;

interface Ring {
  chunks: string[];
  /** Absolute offset of the first character still held. */
  start: number;
  /** Absolute offset just past the last character emitted. */
  end: number;
}

const rings = new Map<string, Ring>();
// Sessions that were dropped. Chunks still in flight when a session is torn down
// (decoder flush, a late channel packet) must not resurrect its ring.
const droppedSessions = new Set<string>();

export interface ScrollbackResult {
  data: string;
  endOffset: number;
  /** True when the caller's offset cannot be continued from: clear the terminal and write `data`. */
  reset: boolean;
}

function trim(ring: Ring) {
  while (ring.end - ring.start > MAX_CHARS && ring.chunks.length > 1) {
    const dropped = ring.chunks.shift()!;
    ring.start += dropped.length;
  }
  if (ring.end - ring.start > MAX_CHARS) {
    // A single chunk larger than the whole ring: keep its tail.
    const only = ring.chunks[0];
    let cut = only.length - MAX_CHARS;
    const code = only.charCodeAt(cut);
    if (code >= 0xdc00 && code <= 0xdfff) cut++; // do not start on the low half of a surrogate pair
    ring.chunks[0] = only.slice(cut);
    ring.start += cut;
  }
}

/** Record output for `sessionId` and deliver it to every window as `(data, endOffset)`. */
export function emitSessionData(sessionId: string, data: string) {
  if (!data || droppedSessions.has(sessionId)) return;

  let ring = rings.get(sessionId);
  if (!ring) {
    ring = { chunks: [], start: 0, end: 0 };
    rings.set(sessionId, ring);
  }

  const lastIndex = ring.chunks.length - 1;
  if (lastIndex >= 0 && ring.chunks[lastIndex].length + data.length <= CHUNK_COALESCE_CHARS) {
    ring.chunks[lastIndex] += data;
  } else {
    ring.chunks.push(data);
  }
  ring.end += data.length;
  trim(ring);

  broadcastToAllWindows(`ssh-data-${sessionId}`, data, ring.end);
}

/**
 * Output of `sessionId` after `fromOffset`. When `fromOffset` is missing, not an integer, older
 * than what the ring still holds, or past its end, the whole ring is returned with `reset: true`.
 */
export function readScrollback(sessionId: string, fromOffset?: number): ScrollbackResult {
  const ring = rings.get(sessionId);
  const start = ring ? ring.start : 0;
  const end = ring ? ring.end : 0;

  const canContinue = typeof fromOffset === 'number'
    && Number.isInteger(fromOffset)
    && fromOffset >= start
    && fromOffset <= end;

  if (!ring) return { data: '', endOffset: end, reset: !canContinue };
  if (!canContinue) return { data: ring.chunks.join(''), endOffset: end, reset: true };
  if (fromOffset === end) return { data: '', endOffset: end, reset: false };

  // Skip whole chunks that lie before fromOffset, slice the one it falls in.
  const parts: string[] = [];
  let pos = start;
  for (const chunk of ring.chunks) {
    const chunkEnd = pos + chunk.length;
    if (chunkEnd > fromOffset!) {
      parts.push(pos >= fromOffset! ? chunk : chunk.slice(fromOffset! - pos));
    }
    pos = chunkEnd;
  }
  return { data: parts.join(''), endOffset: end, reset: false };
}

/** Forget a session's output. Later output for the same id is ignored. */
export function dropSession(sessionId: string) {
  rings.delete(sessionId);
  droppedSessions.add(sessionId);
}
