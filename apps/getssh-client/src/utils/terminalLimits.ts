export const MIN_SCROLLBACK = 1000;
export const MAX_SCROLLBACK = 100_000;
const DEFAULT_SCROLLBACK = 10_000;

/**
 * The scrollback a terminal may keep. xterm keeps rows + scrollback lines of 12 bytes per cell
 * and only refuses negative values, so a stored 1,000,000 cost about 2 GB per busy terminal and a
 * negative one broke every terminal at startup.
 */
export function clampScrollback(value: unknown): number {
  const lines = Math.trunc(Number(value));
  if (!Number.isFinite(lines) || lines <= 0) return DEFAULT_SCROLLBACK;
  return Math.min(Math.max(lines, MIN_SCROLLBACK), MAX_SCROLLBACK);
}
