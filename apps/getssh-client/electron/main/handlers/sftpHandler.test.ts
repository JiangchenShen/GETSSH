import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

// Editing a remote file: opening the same file again replaces its sync instead of leaving the old
// watcher, temp copy and session behind; closing the session stops every sync.

const paths = vi.hoisted(() => {
  const root = `${(process.env.TMPDIR || '/tmp/').replace(/\/?$/, '/')}getssh-sftp-sync-${process.pid}`;
  return { root, addon: `${root}/sftp-stream.cjs` };
});
const { root } = paths;

// Stands in for the sftp-stream addon: each download lands in a directory of its own. Written by the
// mock factory, which runs before sftpHandler loads the addon.
vi.mock('../utils/rustCorePath', async () => {
  const nodeFs = await import('node:fs');
  nodeFs.mkdirSync(paths.root, { recursive: true });
  nodeFs.writeFileSync(paths.addon, `
const fs = require('node:fs'), path = require('node:path');
let n = 0;
exports.SftpDownloader = { create: () => {
  const dir = path.join(${JSON.stringify(paths.root)}, 'edit-' + (++n));
  fs.mkdirSync(dir);
  const file = path.join(dir, 'download.tmp');
  fs.writeFileSync(file, '');
  return { append: (chunk) => fs.appendFileSync(file, chunk), finish: () => ({ safePath: file, dirPath: dir }) };
} };
exports.SftpUploader = { open: () => ({ readChunk: () => null, close: () => {} }) };
`);
  return { getRustCorePath: () => paths.addon };
});
vi.mock('electron', () => ({ app: { getPath: () => root }, shell: { showItemInFolder: vi.fn() }, dialog: {}, powerSaveBlocker: { start: () => 1, stop: () => {} } }));

import { connectionManager } from '../services/ConnectionManager';
import { registerSftpHandlers } from './sftpHandler';

type Handler = (event: unknown, ...args: unknown[]) => Promise<any>;
const handlers = new Map<string, Handler>();
registerSftpHandlers({ handle: (channel: string, run: Handler) => handlers.set(channel, run), on: () => {} } as any);

const sftp = {
  createReadStream: () => {
    const stream = new EventEmitter();
    setImmediate(() => { stream.emit('data', Buffer.from('remote text')); stream.emit('end'); });
    return stream;
  },
};
connectionManager.sessions.set('s1', { client: {} as any, stream: null, sftp: sftp as any });

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('SFTP edit sync', () => {
  it('replaces the sync of a file opened again, and stops all of them with the session', async () => {
    const first = await handlers.get('sftp-edit-sync')!({}, 's1', '/etc/app.conf');
    const firstDir = connectionManager.activeSftpWatchers[first.watchId].tempPath;
    const second = await handlers.get('sftp-edit-sync')!({}, 's1', '/etc/app.conf');
    expect(second.watchId).toBe(first.watchId);
    expect(Object.keys(connectionManager.activeSftpWatchers)).toEqual([first.watchId]);
    expect(fs.existsSync(firstDir)).toBe(false);
    const secondDir = connectionManager.activeSftpWatchers[second.watchId].tempPath;
    expect(fs.readFileSync(path.join(secondDir, 'app.conf'), 'utf8')).toBe('remote text');

    await handlers.get('sftp-edit-sync')!({}, 's1', '/etc/other.conf');
    expect(Object.keys(connectionManager.activeSftpWatchers)).toHaveLength(2);
    await connectionManager.removeSession('s1');
    expect(connectionManager.activeSftpWatchers).toEqual({});
    expect(fs.readdirSync(root).filter(name => name.startsWith('edit-'))).toEqual([]);
  });
});
