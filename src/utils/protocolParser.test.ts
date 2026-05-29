import { describe, it, expect } from 'vitest';
import { detectProtocol } from './protocolParser';

describe('detectProtocol', () => {
  describe('1. Local CLI keywords', () => {
    const localKeywords = ['local', 'localhost', '127.0.0.1', '/bin/sh', '/bin/bash', '/bin/zsh', 'powershell', 'cmd'];

    it('should detect exact local keywords', () => {
      for (const keyword of localKeywords) {
        expect(detectProtocol(keyword)).toEqual({ protocol: 'local' });
        // Test with uppercase and spaces
        expect(detectProtocol(`  ${keyword.toUpperCase()}  `)).toEqual({ protocol: 'local' });
      }
    });

    it('should detect local keywords with : suffix', () => {
      expect(detectProtocol('localhost:8080')).toEqual({ protocol: 'local' });
      expect(detectProtocol('127.0.0.1:22')).toEqual({ protocol: 'local' });
    });

    it('should detect local keywords with / suffix', () => {
      expect(detectProtocol('localhost/path')).toEqual({ protocol: 'local' });
    });
  });

  describe('2. Explicit telnet:// or :23 suffix', () => {
    it('should detect telnet:// prefix', () => {
      expect(detectProtocol('telnet://example.com')).toEqual({
        protocol: 'telnet',
        parsedHost: 'example.com',
      });
    });

    it('should detect telnet:// prefix with port', () => {
      expect(detectProtocol('telnet://example.com:23')).toEqual({
        protocol: 'telnet',
        parsedHost: 'example.com',
      });
    });

    it('should detect :23 suffix without telnet://', () => {
      expect(detectProtocol('example.com:23')).toEqual({
        protocol: 'telnet',
        parsedHost: 'example.com',
      });
    });

    it('should ignore case and spaces for telnet:// prefix', () => {
      expect(detectProtocol('  TELNET://example.com  ')).toEqual({
        protocol: 'telnet',
        parsedHost: 'example.com',
      });
    });
  });

  describe('3. ssh:// URI', () => {
    it('should parse ssh:// with just host', () => {
      expect(detectProtocol('ssh://example.com')).toEqual({
        protocol: 'ssh',
        parsedHost: 'example.com',
        parsedUser: undefined,
        parsedPort: 22,
      });
    });

    it('should parse ssh:// with user and host', () => {
      expect(detectProtocol('ssh://user@example.com')).toEqual({
        protocol: 'ssh',
        parsedUser: 'user',
        parsedHost: 'example.com',
        parsedPort: 22,
      });
    });

    it('should parse ssh:// with user, host, and port', () => {
      expect(detectProtocol('ssh://user@example.com:2222')).toEqual({
        protocol: 'ssh',
        parsedUser: 'user',
        parsedHost: 'example.com',
        parsedPort: 2222,
      });
    });

    it('should parse ssh:// with host and port', () => {
      expect(detectProtocol('ssh://example.com:2222')).toEqual({
        protocol: 'ssh',
        parsedUser: undefined,
        parsedHost: 'example.com',
        parsedPort: 2222,
      });
    });
  });

  describe('4. user@host shorthand', () => {
    it('should parse user@host', () => {
      expect(detectProtocol('user@example.com')).toEqual({
        protocol: 'ssh',
        parsedUser: 'user',
        parsedHost: 'example.com',
        parsedPort: 22,
      });
    });

    it('should parse user@host:port', () => {
      expect(detectProtocol('user@example.com:2222')).toEqual({
        protocol: 'ssh',
        parsedUser: 'user',
        parsedHost: 'example.com',
        parsedPort: 2222,
      });
    });

    it('should ignore user@host if it starts with http', () => {
      expect(detectProtocol('http://user@example.com')).toEqual({
        protocol: 'ssh', // Default fallback
      });
    });
  });

  describe('5. Default fallback', () => {
    it('should fallback to ssh for standard domains', () => {
      expect(detectProtocol('example.com')).toEqual({
        protocol: 'ssh',
      });
    });

    it('should fallback to ssh for random strings', () => {
      expect(detectProtocol('some random string')).toEqual({
        protocol: 'ssh',
      });
    });
  });
});
