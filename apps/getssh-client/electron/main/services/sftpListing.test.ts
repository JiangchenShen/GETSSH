import type { FileEntry } from 'ssh2';
import { describe, expect, it } from 'vitest';
import { listDirectoryBounded, type ListingLimits } from './sftpListing';

// A stand-in for ssh2's SFTP client: readdir(handle) hands out batches until the script says EOF.

const entry = (name: string, longnameLength = 10): FileEntry => ({
  filename: name,
  longname: 'x'.repeat(longnameLength),
  attrs: {} as FileEntry['attrs'],
});

function fakeSftp(batches: Array<FileEntry[] | 'eof' | 'error' | 'stall'>, repeatLast = false) {
  const state = { closed: 0, reads: 0 };
  let i = 0;
  const sftp = {
    opendir: (_path: string, cb: (err: Error | undefined, handle: Buffer) => void) => setImmediate(() => cb(undefined, Buffer.from('h'))),
    readdir: (_handle: Buffer, cb: (err: (Error & { code?: number }) | undefined, list: FileEntry[]) => void) => {
      state.reads++;
      const step = i < batches.length ? batches[i++] : repeatLast ? batches[batches.length - 1] : 'eof';
      if (step === 'stall') return;
      setImmediate(() => {
        if (step === 'eof') cb(Object.assign(new Error('EOF'), { code: 1 }), undefined as unknown as FileEntry[]);
        else if (step === 'error') cb(Object.assign(new Error('Permission denied'), { code: 3 }), undefined as unknown as FileEntry[]);
        else cb(undefined, step);
      });
    },
    close: (_handle: Buffer, cb: () => void) => { state.closed++; cb(); },
  };
  return { sftp: sftp as never, state };
}

const limits = (over: Partial<ListingLimits> = {}): ListingLimits => ({ maxEntries: 100, maxBytes: 10_000, deadlineMs: 200, ...over });

describe('listDirectoryBounded', () => {
  it('reads every batch up to EOF and closes the handle', async () => {
    const { sftp, state } = fakeSftp([[entry('a'), entry('b')], [entry('c')], 'eof']);
    expect(await listDirectoryBounded(sftp, '/x', limits())).toEqual({ entries: [entry('a'), entry('b'), entry('c')], truncated: false });
    expect(state.closed).toBe(1);
  });

  it('stops at the entry limit of a huge folder', async () => {
    const batch = Array.from({ length: 30 }, (_, n) => entry(`f${n}`));
    const { sftp, state } = fakeSftp([batch], true);
    const result = await listDirectoryBounded(sftp, '/x', limits({ maxEntries: 100 }));
    expect(result.truncated).toBe(true);
    expect(result.entries).toHaveLength(100);
    expect(state.closed).toBe(1);
  });

  it('stops at the byte limit when names are long', async () => {
    const { sftp } = fakeSftp([[entry('a', 4000), entry('b', 4000), entry('c', 4000)]], true);
    const result = await listDirectoryBounded(sftp, '/x', limits({ maxBytes: 10_000 }));
    expect(result).toMatchObject({ truncated: true });
    expect(result.entries).toHaveLength(2);
  });

  it('gives back what arrived when the server stops answering', async () => {
    const { sftp, state } = fakeSftp([[entry('a')], 'stall']);
    expect(await listDirectoryBounded(sftp, '/x', limits({ deadlineMs: 50 }))).toEqual({ entries: [entry('a')], truncated: true });
    expect(state.closed).toBe(1);
  });

  it('fails when nothing arrived before the deadline, and survives endless empty batches', async () => {
    const stalled = fakeSftp(['stall']);
    await expect(listDirectoryBounded(stalled.sftp, '/x', limits({ deadlineMs: 50 }))).rejects.toThrow(/too long/);
    const empty = fakeSftp([[]], true);
    await expect(listDirectoryBounded(empty.sftp, '/x', limits({ deadlineMs: 50 }))).rejects.toThrow(/too long/);
    expect(empty.state.closed).toBe(1);
  });

  it('reports a server error and closes the handle', async () => {
    const { sftp, state } = fakeSftp([[entry('a')], 'error']);
    await expect(listDirectoryBounded(sftp, '/x', limits())).rejects.toThrow('Permission denied');
    expect(state.closed).toBe(1);
  });
});
