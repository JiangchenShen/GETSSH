import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

// Editing a remote file: every open keeps its own sync until the session ends, and closing the
// session stops all of them.

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
  it('keeps every open file syncing until its session ends, then stops all of them', async () => {
    const first = await handlers.get('sftp-edit-sync')!({}, 's1', '/etc/app.conf');
    const firstDir = connectionManager.activeSftpWatchers[first.watchId].tempPath;
    // Opened again while the first copy may still be in an editor with a save on its way.
    const second = await handlers.get('sftp-edit-sync')!({}, 's1', '/etc/app.conf');
    expect(second.watchId).not.toBe(first.watchId);
    expect(Object.keys(connectionManager.activeSftpWatchers).sort()).toEqual([first.watchId, second.watchId].sort());
    expect(fs.existsSync(path.join(firstDir, 'app.conf'))).toBe(true);
    const secondDir = connectionManager.activeSftpWatchers[second.watchId].tempPath;
    expect(fs.readFileSync(path.join(secondDir, 'app.conf'), 'utf8')).toBe('remote text');

    await connectionManager.removeSession('s1');
    expect(connectionManager.activeSftpWatchers).toEqual({});
    expect(fs.readdirSync(root).filter(name => name.startsWith('edit-'))).toEqual([]);
  });

  it('registers no sync for a session that closed during the download', async () => {
    connectionManager.sessions.set('s2', { client: {} as any, stream: null, sftp: sftp as any });
    const pending = handlers.get('sftp-edit-sync')!({}, 's2', '/etc/late.conf');
    await connectionManager.removeSession('s2');
    await expect(pending).rejects.toThrow('SFTP session closed');
    expect(connectionManager.activeSftpWatchers).toEqual({});
    expect(fs.readdirSync(root).filter(name => name.startsWith('edit-'))).toEqual([]);
  });
});
