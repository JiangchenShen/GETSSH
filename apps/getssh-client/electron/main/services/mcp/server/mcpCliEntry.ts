#!/usr/bin/env node
import { GetSshMcpServer } from './GetSshMcpServer';

/**
 * Entry point when GETSSH is executed as a standalone Stdio MCP Server:
 * e.g. `node mcpCliEntry.js` or `getssh --mcp-server`
 */
const server = new GetSshMcpServer(process.stdin, process.stdout);
server.start();
