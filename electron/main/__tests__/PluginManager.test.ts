import { describe, it, expect, vi } from 'vitest';
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mocked/path'),
  },
  ipcMain: {
    handle: vi.fn(),
  },
}));
import { isPrivateIP } from '../PluginManager';

describe('isPrivateIP', () => {
  it('identifies loopback and common private IPs', () => {
    expect(isPrivateIP('127.0.0.1')).toBe(true);
    expect(isPrivateIP('::1')).toBe(true);
    expect(isPrivateIP('0.0.0.0')).toBe(true);
    expect(isPrivateIP('::')).toBe(true);
  });

  it('identifies IPs in the 10.0.0.0/8 range', () => {
    expect(isPrivateIP('10.0.0.0')).toBe(true);
    expect(isPrivateIP('10.255.255.255')).toBe(true);
    expect(isPrivateIP('10.1.2.3')).toBe(true);
  });

  it('identifies IPs in the 172.16.0.0/12 range', () => {
    expect(isPrivateIP('172.16.0.0')).toBe(true);
    expect(isPrivateIP('172.31.255.255')).toBe(true);
    expect(isPrivateIP('172.20.10.1')).toBe(true);
  });

  it('identifies IPs in the 192.168.0.0/16 range', () => {
    expect(isPrivateIP('192.168.0.0')).toBe(true);
    expect(isPrivateIP('192.168.255.255')).toBe(true);
    expect(isPrivateIP('192.168.1.1')).toBe(true);
  });

  it('identifies link-local 169.254.0.0/16 IPs', () => {
    expect(isPrivateIP('169.254.0.0')).toBe(true);
    expect(isPrivateIP('169.254.255.255')).toBe(true);
    expect(isPrivateIP('169.254.1.1')).toBe(true);
  });

  it('identifies 127.0.0.0/8 variants', () => {
    expect(isPrivateIP('127.0.0.2')).toBe(true);
    expect(isPrivateIP('127.255.255.255')).toBe(true);
    expect(isPrivateIP('127.127.127.127')).toBe(true);
  });

  it('returns false for public IPs', () => {
    expect(isPrivateIP('8.8.8.8')).toBe(false);
    expect(isPrivateIP('1.1.1.1')).toBe(false);
    expect(isPrivateIP('172.15.255.255')).toBe(false); // Just outside 172.16.0.0/12
    expect(isPrivateIP('172.32.0.0')).toBe(false); // Just outside 172.16.0.0/12
    expect(isPrivateIP('192.169.0.0')).toBe(false); // Just outside 192.168.0.0/16
    expect(isPrivateIP('9.255.255.255')).toBe(false); // Just outside 10.0.0.0/8
    expect(isPrivateIP('11.0.0.0')).toBe(false); // Just outside 10.0.0.0/8
  });

  it('returns false for invalid or malformed strings', () => {
    expect(isPrivateIP('')).toBe(false);
    expect(isPrivateIP('invalid')).toBe(false);
    expect(isPrivateIP('192.168.1')).toBe(false);
    expect(isPrivateIP('192.168.1.1.1')).toBe(false);
    expect(isPrivateIP('256.256.256.256')).toBe(false); // Valid parsing length, but not a private range
    expect(isPrivateIP('a.b.c.d')).toBe(false);
  });
});
