import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { normalizeMcpServerConfig, createMcpSpawnPlan } from './McpProcessSandbox';
import type { McpServerConfig } from './mcpTypes';

describe('McpProcessSandbox', () => {
  describe('normalizeMcpServerConfig', () => {
    it('normalizes valid stdio server configuration', () => {
      const normalized = normalizeMcpServerConfig({
        id: 'test-server',
        name: 'Test Server',
        transport: 'stdio',
        command: 'node',
        args: ['index.js'],
        enabled: true,
        permissions: {
          network: false,
          readPaths: ['/tmp'],
          writePaths: ['/tmp/out']
        }
      });

      expect(normalized.id).toBe('test-server');
      expect(normalized.name).toBe('Test Server');
      expect(normalized.transport).toBe('stdio');
      expect(normalized.command).toBe('node');
      expect(normalized.args).toEqual(['index.js']);
      expect(normalized.permissions?.network).toBe(false);
      expect(normalized.permissions?.readPaths).toEqual([path.resolve('/tmp')]);
      expect(normalized.permissions?.writePaths).toEqual([path.resolve('/tmp/out')]);
    });

    it('rejects unsupported transports', () => {
      expect(() => {
        normalizeMcpServerConfig({
          id: 'invalid-transport',
          name: 'Invalid',
          transport: 'websocket'
        });
      }).toThrow('Unsupported MCP transport: websocket');
    });

    it('rejects invalid server IDs', () => {
      expect(() => {
        normalizeMcpServerConfig({
          id: 'invalid/id!',
          name: 'Invalid',
          transport: 'stdio'
        });
      }).toThrow('MCP server id contains unsupported characters');
    });
  });

  describe('createMcpSpawnPlan', () => {
    it('rejects non-stdio transport', () => {
      const sseConfig: McpServerConfig = {
        id: 'sse-server',
        name: 'SSE Server',
        transport: 'sse',
        url: 'http://localhost:8000/sse',
        enabled: true
      };

      expect(() => {
        createMcpSpawnPlan(sseConfig, {
          userDataDir: '/tmp',
          runtimeHomeDir: '/tmp/home'
        });
      }).toThrow('Only stdio MCP servers use a process sandbox');
    });

    it('blocks hazardous environment variables like NODE_OPTIONS', () => {
      expect(() => {
        normalizeMcpServerConfig({
          id: 'unsafe-server',
          name: 'Unsafe Server',
          transport: 'stdio',
          command: 'node',
          env: {
            NODE_OPTIONS: '--inspect'
          }
        });
      }).toThrow("MCP stdio environment variable 'NODE_OPTIONS' is blocked");
    });

    it('generates a valid macOS sandbox spawn plan for safe stdio server', () => {
      const tmp = os.tmpdir();
      const testDir = path.join(tmp, `test-mcp-sandbox-${Date.now()}`);
      const runtimeHome = path.join(testDir, 'runtime-home');
      const cwd = path.join(testDir, 'cwd');
      const userData = path.join(testDir, 'userData');

      fs.mkdirSync(runtimeHome, { recursive: true });
      fs.mkdirSync(cwd, { recursive: true });
      fs.mkdirSync(userData, { recursive: true });

      try {
        const plan = createMcpSpawnPlan(
          {
            id: 'safe-server',
            name: 'Safe Server',
            transport: 'stdio',
            command: process.execPath,
            cwd,
            enabled: true,
            env: {
              SAFE_VAR: 'hello'
            }
          },
          {
            platform: 'darwin',
            runtimeHomeDir: runtimeHome,
            userDataDir: userData,
            homeDir: path.join(testDir, 'mock-home'),
            executableExists: () => true
          }
        );

        expect(plan.env.SAFE_VAR).toBe('hello');
        expect(plan.isolation).toBe('macos-seatbelt');
        expect(plan.command).toBe('/usr/bin/sandbox-exec');
      } finally {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('rejects filesystem root as cwd', () => {
      const rootDir = path.parse(process.cwd()).root;
      expect(() => {
        createMcpSpawnPlan(
          {
            id: 'root-cwd-server',
            name: 'Root CWD Server',
            transport: 'stdio',
            command: 'node',
            cwd: rootDir,
            enabled: true
          },
          {
            userDataDir: '/tmp/userdata',
            runtimeHomeDir: '/tmp/runtimehome'
          }
        );
      }).toThrow('Secure MCP cwd cannot be the filesystem root.');
    });

    it('rejects granting read access to protected host credentials like ~/.ssh', () => {
      const tmp = os.tmpdir();
      const testDir = path.join(tmp, `test-mcp-ssh-protection-${Date.now()}`);
      const mockHome = path.join(testDir, 'mock-home');
      const sshDir = path.join(mockHome, '.ssh');
      const runtimeHome = path.join(testDir, 'runtime-home');
      const cwd = path.join(testDir, 'cwd');
      const userData = path.join(testDir, 'userData');

      fs.mkdirSync(sshDir, { recursive: true });
      fs.mkdirSync(runtimeHome, { recursive: true });
      fs.mkdirSync(cwd, { recursive: true });
      fs.mkdirSync(userData, { recursive: true });

      try {
        expect(() => {
          createMcpSpawnPlan(
            {
              id: 'steal-ssh-server',
              name: 'Malicious Server',
              transport: 'stdio',
              command: process.execPath,
              cwd,
              enabled: true,
              permissions: {
                network: false,
                readPaths: [sshDir]
              }
            },
            {
              platform: 'darwin',
              runtimeHomeDir: runtimeHome,
              userDataDir: userData,
              homeDir: mockHome,
              executableExists: () => true
            }
          );
        }).toThrow('overlaps a protected credential directory');
      } finally {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });
  });
});
