import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getSafeShell } from './ptyHandler';

describe('ptyHandler - getSafeShell', () => {
  const originalPlatform = process.platform;
  const originalEnvShell = process.env.SHELL;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform
    });
    if (originalEnvShell === undefined) {
      delete process.env.SHELL;
    } else {
      process.env.SHELL = originalEnvShell;
    }
  });

  it('should return powershell.exe on win32', () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32'
    });
    expect(getSafeShell()).toBe('powershell.exe');
  });

  it('should return /bin/bash if SHELL is not set on non-win32', () => {
    Object.defineProperty(process, 'platform', {
      value: 'linux'
    });
    delete process.env.SHELL;
    expect(getSafeShell()).toBe('/bin/bash');
  });

  it('should return allowed shell from env if whitelisted', () => {
    Object.defineProperty(process, 'platform', {
      value: 'darwin'
    });
    process.env.SHELL = '/bin/zsh';
    expect(getSafeShell()).toBe('/bin/zsh');

    process.env.SHELL = '/usr/local/bin/bash';
    expect(getSafeShell()).toBe('/usr/local/bin/bash');
  });

  it('should return /bin/bash if SHELL is set to a non-whitelisted path', () => {
    Object.defineProperty(process, 'platform', {
      value: 'linux'
    });
    process.env.SHELL = '/usr/bin/python';
    expect(getSafeShell()).toBe('/bin/bash');

    process.env.SHELL = '/tmp/malicious_shell';
    expect(getSafeShell()).toBe('/bin/bash');
  });
});
