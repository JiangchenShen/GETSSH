// @vitest-environment node
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const store = require('../../../../../../rust-core/getssh-store/store.fake.js');
let testDirectory: string | undefined;
afterEach(() => { store.__fake.reset(); if (testDirectory) rmSync(testDirectory, { recursive: true, force: true }); testDirectory = undefined; });

describe('Backup recovery with the real in-memory store API', () => {
  it('keeps both workspaces and server profiles after import and a simulated restart', async () => {
    testDirectory = mkdtempSync(join(tmpdir(), 'getssh-ui-backup-'));
    store.__fake.reset(); store.configure(join(testDirectory, 'data'), '3.0.0-rc.1');
    store.__fake.seed({
      workspaces: [{ id: 'main', name: 'Main', is_main: true }, { id: 'private', name: 'Private', password: 'workspace-password' }],
      profiles: { main: [{ id: 'host-1', host: 'main.example.test', username: 'operator', password: 'saved-password' }], private: [{ id: 'host-2', host: 'private.example.test', username: 'operator', port: 2222 }] },
    });
    await store.start();
    const verification = await store.unlockWorkspaces(['main', 'private'], 'Export selected workspaces');
    expect(verification).toEqual({ unlocked: ['main'], failed: [{ id: 'private', code: 'needs_password' }] });
    await store.unlockWorkspace('private', { password: 'workspace-password' });
    const file = join(testDirectory, 'all.getssh-backup');
    const exported = await store.exportBundle(file, 'long-backup-password', ['main', 'private']);
    expect(exported.workspaceIds).toEqual(['main', 'private']);
    expect((await store.inspectBundle(file, 'long-backup-password')).workspaces.map((item: { id: string }) => item.id)).toEqual(['main', 'private']);
    store.__fake.seed({ workspaces: [{ id: 'unrelated', name: 'Replaced', is_main: true }] }); await store.start();
    await store.importBundle(file, 'long-backup-password', 'replace');
    expect(() => store.listWorkspaces()).toThrow('[store:unavailable]');
    store.__fake.restart(); await store.start();
    expect(store.listWorkspaces().map((item: { id: string }) => item.id)).toEqual(['main', 'private']);
    expect(store.listProfiles('main')).toEqual([expect.objectContaining({ id: 'host-1', host: 'main.example.test', hasPassword: true })]);
    await store.unlockWorkspace('private', { password: 'workspace-password' });
    expect(store.listProfiles('private')).toEqual([expect.objectContaining({ id: 'host-2', host: 'private.example.test', port: 2222 })]);
  });
});
