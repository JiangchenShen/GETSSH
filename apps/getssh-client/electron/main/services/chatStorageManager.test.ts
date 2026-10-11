import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Chats a page at a time, and a chat's messages from the newest back, through ChatStorageManager on
// rust-core/getssh-store/store.fake.js with a temporary home directory.

const mocks = vi.hoisted(() => ({ home: '' }));

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd(), getVersion: () => '3.0.0-test', getPath: () => mocks.home },
}));
vi.mock('./LocalMemoryService', () => ({ LocalMemoryService: { indexMessage: vi.fn(), deleteSession: vi.fn() } }));

import { ChatStorageManager } from './chatStorageManager';
import { configureStore, getStore, resetStoreForTest } from './getsshStore';

const fake = createRequire(import.meta.url)(path.resolve(process.cwd(), '../../rust-core/getssh-store/store.fake.js'));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'getssh-chat-pages-'));
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, GETSSH_FAKE_STORE: process.env.GETSSH_FAKE_STORE };

beforeEach(async () => {
  mocks.home = fs.mkdtempSync(path.join(root, 'home-'));
  process.env.HOME = mocks.home;
  process.env.USERPROFILE = mocks.home;
  process.env.GETSSH_FAKE_STORE = '1';
  fake.__fake.reset();
  resetStoreForTest();
  await configureStore().start();
  ChatStorageManager.init('default');
});

afterAll(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

const say = (id: string, session: string, role: 'user' | 'assistant', timestamp: number, content = `${id} text`) =>
  ChatStorageManager.saveMessage({ id, session_id: session, role, content, timestamp });

describe('chat pages', () => {
  it('lists chats a page at a time without their messages', () => {
    for (let n = 0; n < 5; n++) ChatStorageManager.createSession(`c${n}`, `Chat ${n}`, 100 + n);
    say('a1', 'c1', 'user', 300);
    say('a2', 'c1', 'assistant', 301, 'The disk is 91% full.');
    const first = ChatStorageManager.listSessions(2);
    expect(first.sessions.map(s => s.id)).toEqual(['c1', 'c4']);
    expect(first.sessions[0]).toMatchObject({ message_count: 2, preview: 'The disk is 91% full.', updated_at: 301 });
    expect(first.sessions[0]).not.toHaveProperty('messages');
    const second = ChatStorageManager.listSessions(2, first.next);
    const third = ChatStorageManager.listSessions(2, second.next);
    expect([...second.sessions, ...third.sessions].map(s => s.id)).toEqual(['c3', 'c2', 'c0']);
    expect(third.next).toBeNull();
  });

  it('reads a chat from its newest messages back', () => {
    ChatStorageManager.createSession('c', 'Chat', 1);
    for (let n = 0; n < 5; n++) say(`m${n}`, 'c', n % 2 ? 'assistant' : 'user', 10 + n);
    const newest = ChatStorageManager.getMessages('c', 2);
    expect(newest.messages.map(m => m.id)).toEqual(['m3', 'm4']);
    const older = ChatStorageManager.getMessages('c', 2, newest.before);
    const oldest = ChatStorageManager.getMessages('c', 2, older.before);
    expect([...oldest.messages, ...older.messages].map(m => m.id)).toEqual(['m0', 'm1', 'm2']);
    expect(oldest.before).toBeNull();
    // DatabaseManager reads a missing chat like a locked workspace: nothing to show.
    expect(ChatStorageManager.getMessages('missing', 2)).toEqual({ messages: [], before: null });
  });

  it('gives empty pages while the workspace is locked, and none without one', async () => {
    await getStore().createWorkspace({ id: 'p1', name: 'P1', password: 'eight-chars' });
    ChatStorageManager.init('p1');
    ChatStorageManager.createSession('c', 'Chat', 1);
    expect(ChatStorageManager.listSessions(10).sessions).toHaveLength(1);
    getStore().lockWorkspace('p1');
    expect(ChatStorageManager.listSessions(10)).toEqual({ sessions: [], next: null });
    expect(ChatStorageManager.getMessages('c', 10)).toEqual({ messages: [], before: null });
    ChatStorageManager.init(null as unknown as string);
    expect(ChatStorageManager.listSessions(10)).toEqual({ sessions: [], next: null });
  });
});
