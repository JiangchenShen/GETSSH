import { IpcMain, IpcMainInvokeEvent } from 'electron';
import { mcpManager } from '../services/mcp/McpManager';
import { isKnownTopLevelSender, isMainWebContents } from '../windowRegistry';

const UNAUTHORIZED = { success: false, error: 'Unauthorized sender' };

/** Server settings carry tokens (env, headers) and start processes: the main window's top frame only. */
const fromMainFrame = (event: IpcMainInvokeEvent) =>
  isMainWebContents(event.sender) && !!event.senderFrame && event.senderFrame.parent === null;

export function registerMcpHandlers(ipcMain: IpcMain) {
  // Get all MCP servers and their discovered tools, resources, and prompts
  ipcMain.handle('mcp:get-servers', async (event) => {
    if (!fromMainFrame(event)) return UNAUTHORIZED;
    try {
      const servers = mcpManager.getAllServersState();
      return { success: true, servers };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // Add a new MCP server
  ipcMain.handle('mcp:add-server', async (event, config: any) => {
    if (!fromMainFrame(event)) return UNAUTHORIZED;
    try {
      const server = await mcpManager.addServer(config);
      return { success: true, server };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // Update an existing MCP server
  ipcMain.handle('mcp:update-server', async (event, payload: { id: string; updates: any }) => {
    if (!fromMainFrame(event)) return UNAUTHORIZED;
    try {
      const server = await mcpManager.updateServer(payload.id, payload.updates);
      return { success: true, server };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // Remove an MCP server
  ipcMain.handle('mcp:remove-server', async (event, serverId: string) => {
    if (!fromMainFrame(event)) return UNAUTHORIZED;
    try {
      mcpManager.removeServer(serverId);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // Restart an MCP server
  ipcMain.handle('mcp:restart-server', async (event, serverId: string) => {
    if (!fromMainFrame(event)) return UNAUTHORIZED;
    try {
      const state = mcpManager.getAllServersState().find(s => s.config.id === serverId);
      if (!state) throw new Error('Server not found');
      const res = await mcpManager.startServer(state.config);
      return { success: true, ...res };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // ── Module A: Resources IPC ───────────────────────────────────────────
  ipcMain.handle('mcp:get-resources', async (event) => {
    if (!isKnownTopLevelSender(event)) return UNAUTHORIZED;
    try {
      const resources = mcpManager.getAllResources();
      return { success: true, resources };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('mcp:read-resource', async (event, payload: { serverId: string; uri: string }) => {
    if (!isKnownTopLevelSender(event)) return UNAUTHORIZED;
    try {
      const data = await mcpManager.readResource(payload.serverId, payload.uri);
      return { success: true, data };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  // ── Module A: Prompts IPC ─────────────────────────────────────────────
  ipcMain.handle('mcp:get-prompts', async (event) => {
    if (!isKnownTopLevelSender(event)) return UNAUTHORIZED;
    try {
      const prompts = mcpManager.getAllPrompts();
      return { success: true, prompts };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('mcp:get-prompt', async (event, payload: { serverId: string; name: string; args?: Record<string, string> }) => {
    if (!isKnownTopLevelSender(event)) return UNAUTHORIZED;
    try {
      const promptResult = await mcpManager.getPrompt(payload.serverId, payload.name, payload.args || {});
      return { success: true, prompt: promptResult };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
}
