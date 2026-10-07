import type { IpcMain } from 'electron';
import { describe, expect, it, vi } from 'vitest';

// Who may call the MCP channels: server settings (tokens, process start) from the main window's
// top frame only; prompts and resources from the top frame of any GETSSH window.

const manager = vi.hoisted(() => ({
  getAllServersState: vi.fn(() => [{ config: { id: 's', name: 'S', env: { TOKEN: 'secret-token' }, headers: { Authorization: 'Bearer secret-token' } }, status: 'connected', tools: [] }]),
  addServer: vi.fn(async () => ({ id: 'new', env: { TOKEN: 'secret-token' } })),
  updateServer: vi.fn(async () => ({ id: 's', headers: { Authorization: 'Bearer secret-token' } })),
  removeServer: vi.fn(),
  startServer: vi.fn(async () => ({})),
  getAllResources: vi.fn(() => []),
  readResource: vi.fn(async () => ({})),
  getAllPrompts: vi.fn(() => []),
  getPrompt: vi.fn(async () => ({})),
}));

vi.mock('electron', () => ({}));
vi.mock('../services/mcp/McpManager', () => ({ mcpManager: manager }));
vi.mock('../windowRegistry', () => ({
  isMainWebContents: (webContents: { id: number } | undefined) => webContents?.id === 1,
  isKnownTopLevelSender: (event: { sender?: { id: number }; senderFrame?: { parent: unknown } }) =>
    !!event.sender && [1, 2].includes(event.sender.id) && event.senderFrame?.parent === null,
}));

import { registerMcpHandlers } from './mcpHandler';

type Handler = (event: unknown, ...args: unknown[]) => Promise<any>;
const handlers = new Map<string, Handler>();
registerMcpHandlers({ handle: (channel: string, run: Handler) => handlers.set(channel, run) } as unknown as IpcMain);

const MAIN = { sender: { id: 1 }, senderFrame: { parent: null } };
const TORN = { sender: { id: 2 }, senderFrame: { parent: null } };
const SUBFRAME = { sender: { id: 1 }, senderFrame: { parent: {} } };
const STRANGER = { sender: { id: 9 }, senderFrame: { parent: null } };
const call = (channel: string, event: unknown, ...args: unknown[]) => handlers.get(channel)!(event, ...args);

describe('MCP IPC senders', () => {
  it('lets only the main window\'s top frame see or change server settings', async () => {
    const settings: Array<[string, unknown[]]> = [
      ['mcp:get-servers', []],
      ['mcp:add-server', [{ name: 'x' }]],
      ['mcp:update-server', [{ id: 's', updates: {} }]],
      ['mcp:remove-server', ['s']],
      ['mcp:restart-server', ['s']],
    ];
    for (const [channel, args] of settings) {
      for (const event of [TORN, SUBFRAME, STRANGER]) {
        expect(await call(channel, event, ...args), channel).toEqual({ success: false, error: 'Unauthorized sender' });
      }
      expect((await call(channel, MAIN, ...args)).success, channel).toBe(true);
    }
    expect(manager.addServer).toHaveBeenCalledTimes(1);
    expect(manager.removeServer).toHaveBeenCalledTimes(1);
  });

  it('never sends a server\'s environment variables or headers to the page', async () => {
    const servers = await call('mcp:get-servers', MAIN);
    expect(servers).toEqual({ success: true, servers: [{ config: { id: 's', name: 'S' }, status: 'connected', tools: [] }] });
    expect(JSON.stringify(await call('mcp:add-server', MAIN, { name: 'x' }))).not.toContain('secret-token');
    expect(JSON.stringify(await call('mcp:update-server', MAIN, { id: 's', updates: {} }))).not.toContain('secret-token');
    // The manager keeps them: restart still starts the server with its tokens.
    await call('mcp:restart-server', MAIN, 's');
    expect(manager.startServer).toHaveBeenLastCalledWith(expect.objectContaining({ env: { TOKEN: 'secret-token' } }));
  });

  it('lets any GETSSH window read prompts and resources, but no subframe', async () => {
    for (const channel of ['mcp:get-resources', 'mcp:get-prompts']) {
      expect((await call(channel, TORN)).success).toBe(true);
      expect(await call(channel, SUBFRAME)).toEqual({ success: false, error: 'Unauthorized sender' });
      expect(await call(channel, STRANGER)).toEqual({ success: false, error: 'Unauthorized sender' });
    }
    expect(await call('mcp:read-resource', SUBFRAME, { serverId: 's', uri: 'u' })).toEqual({ success: false, error: 'Unauthorized sender' });
    expect(await call('mcp:get-prompt', STRANGER, { serverId: 's', name: 'p' })).toEqual({ success: false, error: 'Unauthorized sender' });
  });
});
