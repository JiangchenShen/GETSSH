import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import net from 'net';
import { spawnTelnetSession, killTelnetSocket } from './ptyHandler';

// Mock dependencies required by ptyHandler
vi.mock('./cryptoHandler', () => ({
  getPasswordForHost: vi.fn(),
  savePasswordForHost: vi.fn(),
}));

vi.mock('../services/ConnectionManager', () => {
  return {
    connectionManager: {
      sessions: new Map(),
      removeSession: vi.fn(),
    }
  };
});

vi.mock('../services/sshBridge', () => ({
  sshBridge: {
    broadcastData: vi.fn(),
  }
}));

describe('ptyHandler - processTelnetData', () => {
  let server: net.Server;
  let serverPort: number;
  let receivedData: string = '';

  beforeEach(async () => {
    receivedData = '';
    // Start a real dummy TCP server to test telnet processing logic securely
    server = net.createServer((socket) => {
      // Simulate raw telnet responses that would trigger out-of-bounds reads
      // Send an incomplete IAC sequence at the end of the buffer
      socket.write(Buffer.from([0xFF, 0xFD])); // IAC + DO (missing option byte)
      // Send another valid sequence to show it's robust
      socket.write(Buffer.from([0xFF])); // Just IAC
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as net.AddressInfo;
        serverPort = address.port;
        resolve();
      });
    });
  });

  afterEach(() => {
    server.close();
    vi.clearAllMocks();
  });

  it('safely handles incomplete telnet option sequences without crashing', async () => {
    const sessionId = 'test-telnet-session';
    const config = { host: '127.0.0.1', port: serverPort };

    // This should resolve successfully and not throw an unhandled exception or crash
    const result = await spawnTelnetSession(config, sessionId, () => null);

    expect(result.success).toBe(true);
    expect(result.sessionId).toBe(sessionId);

    // Wait slightly to let the data arrive and be processed
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Cleanup
    killTelnetSocket(sessionId);
  });
});
