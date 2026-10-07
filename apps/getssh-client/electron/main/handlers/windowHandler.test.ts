import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({}));
vi.mock('../windowRegistry', () => ({ windowForSender: () => null }));

import { denyClipboardRead } from './windowHandler';

describe('denyClipboardRead', () => {
  it('refuses clipboard-read and keeps the default for other permissions', () => {
    let request!: (webContents: unknown, permission: string, callback: (granted: boolean) => void) => void;
    let check!: (webContents: unknown, permission: string) => boolean;
    denyClipboardRead({
      setPermissionRequestHandler: (handler: typeof request) => { request = handler; },
      setPermissionCheckHandler: (handler: typeof check) => { check = handler; },
    } as unknown as Electron.Session);

    const granted = (permission: string) => {
      let answer: boolean | undefined;
      request(null, permission, value => { answer = value; });
      return answer;
    };
    expect(granted('clipboard-read')).toBe(false);
    expect(check(null, 'clipboard-read')).toBe(false);
    for (const permission of ['clipboard-sanitized-write', 'notifications', 'fullscreen']) {
      expect(granted(permission)).toBe(true);
      expect(check(null, permission)).toBe(true);
    }
  });
});
