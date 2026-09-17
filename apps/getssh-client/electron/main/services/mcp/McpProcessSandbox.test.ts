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
      expect(normalized.permissions?.readPaths).toEqual(['/tmp']);
      expect(normalized.permissions?.writePaths).toEqual(['/tmp/out']);
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
        url: 'http://localhost:8000/sse'
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
  });
});
