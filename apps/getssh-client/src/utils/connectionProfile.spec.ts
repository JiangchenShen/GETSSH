// Pane configs are stored in nexus-core and broadcast to every window: they must never carry credentials.
import { describe, it, expect } from 'vitest';
import { stripConnectionSecrets } from './connectionProfile';

describe('stripConnectionSecrets', () => {
  it('removes password and passphrase and keeps everything else', () => {
    const config = { host: 'h', port: 22, username: 'u', password: 'pw', passphrase: 'pp', privateKeyPath: '/k', profileId: 'p1' };
    const stripped = stripConnectionSecrets(config);
    expect(stripped).toEqual({ host: 'h', port: 22, username: 'u', privateKeyPath: '/k', profileId: 'p1' });
    expect(JSON.stringify(stripped)).not.toContain('pw');
    expect(config.password).toBe('pw');
  });

  it('passes configs without secrets and null through', () => {
    const plugin = { pluginUrl: 'getssh-plugin://x/index.html' };
    expect(stripConnectionSecrets(plugin)).toBe(plugin);
    expect(stripConnectionSecrets(null)).toBeNull();
  });
});
