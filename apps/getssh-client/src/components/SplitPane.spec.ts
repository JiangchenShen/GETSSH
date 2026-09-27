// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isSftpCapable } from './SplitPane';
import type { PaneLeaf } from '../store/sessionStore';

const leaf = (overrides: Partial<PaneLeaf>): PaneLeaf => ({
  type: 'leaf',
  paneId: 'p1',
  paneType: 'terminal',
  sessionId: 's1',
  config: { host: 'example.com', port: 22, username: 'root' },
  ...overrides,
});

describe('isSftpCapable', () => {
  it('offers SFTP for connected SSH terminal panes', () => {
    expect(isSftpCapable(leaf({}))).toBe(true);
    expect(isSftpCapable(leaf({ config: { host: 'h', port: 22, username: 'u', protocol: 'ssh' } }))).toBe(true);
  });

  it('hides SFTP for local shells, telnet, sessionless and non-terminal panes', () => {
    expect(isSftpCapable(leaf({ config: { host: 'localhost', port: 0, username: '', protocol: 'local' } }))).toBe(false);
    expect(isSftpCapable(leaf({ config: { host: 'h', port: 23, username: '', protocol: 'telnet' } }))).toBe(false);
    expect(isSftpCapable(leaf({ sessionId: null }))).toBe(false);
    expect(isSftpCapable(leaf({ paneType: 'plugin', config: { pluginId: 'x' } }))).toBe(false);
    expect(isSftpCapable(leaf({ paneType: 'welcome', sessionId: null, config: null }))).toBe(false);
  });
});
