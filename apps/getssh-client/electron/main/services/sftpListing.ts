import type { FileEntry, SFTPWrapper } from 'ssh2';

/**
 * Lists a remote folder with a bound. ssh2's readdir(path) keeps asking until the server says
 * EOF and collects everything: a folder with millions of entries, or a server that never says
 * EOF, filled the main process's memory and never answered. This reads batch by batch through
 * a handle and stops at a number of entries, a number of bytes or a deadline, whichever comes
 * first; what was read by then is returned with `truncated`.
 */

export interface ListingLimits {
  maxEntries: number;
  /** File names plus ls-style long names. */
  maxBytes: number;
  deadlineMs: number;
}

export const DEFAULT_LISTING_LIMITS: ListingLimits = {
  maxEntries: 10_000,
  maxBytes: 8 * 1024 * 1024,
  deadlineMs: 20_000,
};

export interface Listing {
  entries: FileEntry[];
  truncated: boolean;
}

/** ssh2's status code for the end of a directory. */
const STATUS_EOF = 1;

type ListingSftp = Pick<SFTPWrapper, 'opendir' | 'readdir' | 'close'>;

export function listDirectoryBounded(sftp: ListingSftp, remotePath: string, limits: ListingLimits = DEFAULT_LISTING_LIMITS): Promise<Listing> {
  return new Promise((resolve, reject) => {
    const entries: FileEntry[] = [];
    let bytes = 0;
    let handle: Buffer | null = null;
    let settled = false;

    const finish = (error: Error | null, truncated = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (handle) sftp.close(handle, () => {});
      if (error) reject(error);
      else resolve({ entries, truncated });
    };

    // A server that stalls or sends empty batches forever: give back what arrived, or fail.
    const timer = setTimeout(() => {
      if (entries.length) finish(null, true);
      else finish(new Error('The server took too long to list this folder'));
    }, limits.deadlineMs);

    const readBatch = (dir: Buffer) => {
      sftp.readdir(dir, (error: (Error & { code?: number }) | undefined, list: FileEntry[]) => {
        if (settled) return;
        if (error) {
          if (error.code === STATUS_EOF) finish(null);
          else finish(error);
          return;
        }
        for (const entry of list) {
          bytes += (entry.filename?.length ?? 0) + (entry.longname?.length ?? 0);
          if (entries.length >= limits.maxEntries || bytes > limits.maxBytes) {
            finish(null, true);
            return;
          }
          entries.push(entry);
        }
        readBatch(dir);
      });
    };

    sftp.opendir(remotePath, (error: Error | undefined, dir: Buffer) => {
      if (error) {
        finish(error);
        return;
      }
      if (settled) {
        sftp.close(dir, () => {});
        return;
      }
      handle = dir;
      readBatch(dir);
    });
  });
}
