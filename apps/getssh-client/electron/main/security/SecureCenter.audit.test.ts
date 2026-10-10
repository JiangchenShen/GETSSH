import { describe, expect, it, vi } from 'vitest';

// The terminal-command check runs on the main thread: it must stay fast on any input.

vi.mock('electron', () => ({ app: {}, ipcMain: { handle: vi.fn(), on: vi.fn() } }));
vi.mock('../handlers/systemHandler', () => ({ getBackendConfig: () => ({}) }));
vi.mock('../windowRegistry', () => ({ broadcastToAllWindows: vi.fn(), isKnownTopLevelSender: () => false }));
vi.mock('../services/OceanSentinel', () => ({ OceanSentinel: { flushMetrics: vi.fn() } }));

import { MAX_AUDITED_COMMAND, SecureCenter } from './SecureCenter';

const audit = (command: string) => {
  const center = SecureCenter.getInstance();
  const lockdown = vi.spyOn(center, 'triggerLockdown').mockImplementation(() => {});
  try {
    return { allowed: center.auditPluginCommand(command), lockdown: lockdown.mock.calls.length > 0 };
  } finally {
    lockdown.mockRestore();
  }
};

describe('auditPluginCommand', () => {
  it('still stops the dangerous commands it knows', () => {
    for (const command of ['rm -rf /', 'rm -r -f /', 'sudo rm -rf / ', 'rm -rf /*', 'mkfs.ext4 /dev/sdb1', ':(){:|:&};:', 'dd if=/dev/zero of=/dev/sda']) {
      expect(audit(command), command).toEqual({ allowed: false, lockdown: true });
    }
    // Far apart on one line, and whitespace across a line break, as the old patterns allowed.
    for (const command of [`rm -r --one-file-system${' '.repeat(600)}-f /*`, `dd if=/dev/zero bs=1M${' '.repeat(700)}of=/dev/sda`, 'rm\t\n-rf /', 'rm -r f\n/']) {
      expect(audit(command).allowed, JSON.stringify(command)).toBe(false);
    }
    for (const command of ['rm -rf /tmp/build', 'ls -la /', 'echo rm -r and f /x', 'rm -r x\nf /']) {
      expect(audit(command).allowed, command).toBe(true);
    }
  });

  it('checks a long line of repeated "rm -r" quickly', () => {
    const line = 'rm -r '.repeat(Math.ceil(MAX_AUDITED_COMMAND / 6)).slice(0, MAX_AUDITED_COMMAND);
    const started = Date.now();
    expect(audit(line).allowed).toBe(true);
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('refuses commands over the limit without raising an alert', () => {
    expect(audit('x'.repeat(MAX_AUDITED_COMMAND + 1))).toEqual({ allowed: false, lockdown: false });
  });
});
