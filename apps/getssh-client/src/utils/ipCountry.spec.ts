import { describe, expect, it } from 'vitest';
import { lookupIpCountry } from './ipCountry';

describe('offline IP country lookup', () => {
  it('reads bundled country ranges for IPv4, IPv6 and IPv4-mapped IPv6', async () => {
    await expect(lookupIpCountry('8.8.8.8')).resolves.toBe('US');
    await expect(lookupIpCountry('[2400:3200::1]')).resolves.toBe('CN');
    await expect(lookupIpCountry('::ffff:1.1.1.1')).resolves.toBe('AU');
  });

  it('leaves names, malformed inputs, and special-use addresses unknown', async () => {
    const hosts = ['example.com', '999.8.8.8', '2001:::1', '100.64.0.1', '192.0.2.1', '::ffff:127.0.0.1', 'fd00::1', '2001:db8::1', '3fff::1'];
    await expect(Promise.all(hosts.map(lookupIpCountry))).resolves.toEqual(hosts.map(() => null));
  });
});
