import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerSshHandlers } from '../sshHandler';
import { connectionManager } from '../../services/ConnectionManager';
import { SocksClient } from 'socks';

// We need a mutable mock setup for ssh2 Client
let mockClientOn = vi.fn().mockReturnThis();
let mockClientConnect = vi.fn();
let mockClientEnd = vi.fn();
let mockClientShell = vi.fn();
let mockClientSftp = vi.fn();

// Mock electron
vi.mock('electron', () => {
  return {
    app: {
      getPath: vi.fn((name) => `/mock/path/${name}`)
    },
    powerSaveBlocker: { start: vi.fn(), stop: vi.fn() },
  };
});

// Mock node:fs
vi.mock('node:fs', () => {
  return {
    default: {
      promises: {
        readFile: vi.fn()
      }
    }
  };
});

// Mock socks
vi.mock('socks', () => {
  return {
    SocksClient: {
      createConnection: vi.fn()
    }
  };
});

// Mock ssh2
vi.mock('ssh2', () => {
  return {
    Client: class {
      on = function(...args: any[]) { return mockClientOn.apply(this, args as any); };
      connect = function(...args: any[]) { return mockClientConnect.apply(this, args as any); };
      end = function(...args: any[]) { return mockClientEnd.apply(this, args as any); };
      shell = function(...args: any[]) { return mockClientShell.apply(this, args as any); };
      sftp = function(...args: any[]) { return mockClientSftp.apply(this, args as any); };
    }
  };
});

vi.mock('../../services/ConnectionManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/ConnectionManager')>();
  return {
    ...actual,
    connectionManager: {
      ...actual.connectionManager,
      removeSession: vi.fn(),
      generateSessionId: vi.fn(() => 'req-1'),
      sessions: new Map(),
      updatePowerSaveBlocker: vi.fn(),
    }
  };
});

describe('sshHandler', () => {
  let mockIpcMain: any;
  let mockApp: any;
  let mockGetWindow: any;
  let handlers: Record<string, Function>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = {};
    mockIpcMain = {
      handle: vi.fn((channel, handler) => {
        handlers[channel] = handler;
      }),
      on: vi.fn()
    };
    mockApp = {
      getPath: vi.fn()
    };
    mockGetWindow = vi.fn(() => null);

    // Reset ssh2 Client mocks
    mockClientOn = vi.fn().mockReturnThis();
    mockClientConnect = vi.fn();
    mockClientEnd = vi.fn();
    mockClientShell = vi.fn();
    mockClientSftp = vi.fn();

    (connectionManager.removeSession as any).mockClear();
    (connectionManager.generateSessionId as any).mockClear();
    connectionManager.sessions.clear();

    registerSshHandlers(mockIpcMain, mockApp, mockGetWindow);
  });

  it('should clean up and return error if establishConnection rejects', async () => {
    const handler = handlers['ssh-connect'];
    expect(handler).toBeDefined();

    vi.mocked(SocksClient.createConnection).mockRejectedValueOnce(new Error('Proxy connection failed'));

    const config = {
      host: 'localhost',
      username: 'user',
      password: 'pwd',
      proxyType: 'socks5',
      proxyHost: '127.0.0.1',
      proxyPort: 1080
    };

    const result = await handler({} as any, config);

    expect(result).toEqual({ success: false, error: 'Proxy connection failed' });
    expect(connectionManager.removeSession).toHaveBeenCalledWith('req-1');
  });

  it('should return error if synchronous error occurs during setup', async () => {
    const handler = handlers['ssh-connect'];
    expect(handler).toBeDefined();

    vi.mocked(connectionManager.generateSessionId).mockImplementationOnce(() => {
      throw new Error('Sync error during setup');
    });

    const config = {
      host: 'localhost',
      username: 'user',
      password: 'pwd'
    };

    const result = await handler({} as any, config);

    expect(result).toEqual({ success: false, error: 'Sync error during setup' });
  });

  it('should clean up and return error if sshClient.connect triggers an error event', async () => {
    const handler = handlers['ssh-connect'];
    expect(handler).toBeDefined();

    // Set up mock to simulate an 'error' event emitted on the client
    mockClientOn = vi.fn().mockImplementation(function(this: any, event: string, cb: Function) {
      if (event === 'error') {
        setTimeout(() => cb(new Error('Connection timed out')), 0);
      }
      return this;
    });

    const config = {
      host: 'localhost',
      username: 'user',
      password: 'pwd'
    };

    const resultPromise = handler({} as any, config);
    const result = await resultPromise;

    expect(result).toEqual({ success: false, error: 'Connection timed out' });
    expect(connectionManager.removeSession).toHaveBeenCalledWith('req-1');
  });

  it('should return error if shell setup fails', async () => {
    const handler = handlers['ssh-connect'];
    expect(handler).toBeDefined();

    mockClientOn = vi.fn().mockImplementation(function(this: any, event: string, cb: Function) {
      if (event === 'ready') {
        setTimeout(() => cb(), 0);
      }
      return this;
    });

    mockClientShell = vi.fn().mockImplementation((config, cb) => {
      setTimeout(() => cb(new Error('Shell failed')), 0);
    });

    const config = {
      host: 'localhost',
      username: 'user',
      password: 'pwd'
    };

    const result = await handler({} as any, config);

    expect(result).toEqual({ success: false, error: 'Shell failed' });
    expect(connectionManager.removeSession).toHaveBeenCalledWith('req-1');
  });

  it('should clean up and return error if sshClient.connect triggers a catch handler', async () => {
    const handler = handlers['ssh-connect'];
    expect(handler).toBeDefined();

    mockClientOn = vi.fn().mockReturnThis();

    // Simulate sshClient.connect throwing an error inside the establishConnection promise chain
    // which gets caught by the outermost .catch
    mockClientConnect = vi.fn().mockImplementation(() => {
      throw new Error('Connection logic exception');
    });

    const config = {
      host: 'localhost',
      username: 'user',
      password: 'pwd'
    };

    const result = await handler({} as any, config);

    expect(result).toEqual({ success: false, error: 'Connection logic exception' });
    expect(connectionManager.removeSession).toHaveBeenCalledWith('req-1');
  });
});
