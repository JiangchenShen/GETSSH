import { ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export type AgentAccessLevel = 'Read-Only' | 'Runbook-Only' | 'Full-Access';

export class AgentExecutor {
  async executeProposal(workspaceId: string, command: string): Promise<{ allowed: boolean; reason?: string }> {
    const metaPath = path.join(os.homedir(), '.getssh/workspaces', workspaceId, 'workspace_meta.json');
    let accessLevel: AgentAccessLevel = 'Read-Only';
    
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        accessLevel = meta.agentAccessLevel || 'Read-Only';
      } catch (e) {
        console.error('Failed to parse workspace_meta.json for Agent Access Level', e);
      }
    }

    if (accessLevel === 'Read-Only') {
      const isSafe = /^(ls|cat|tail|grep|top|htop|ps|df|free)(\s|$)/.test(command.trim());
      if (!isSafe) return { allowed: false, reason: 'BLOCKED: Workspace is in Read-Only Agent Mode. Only basic viewing commands are permitted.' };
    }

    if (accessLevel === 'Runbook-Only') {
       // Typically we would cross-reference with runbooks.json here.
       // The proposal must strictly match a pre-defined runbook, so arbitrary dynamic commands fail here.
       return { allowed: false, reason: 'BLOCKED: Dynamic commands not permitted under Runbook-Only mode.' };
    }

    return { allowed: true };
  }
}

export const agentExecutor = new AgentExecutor();

export function registerAgentHandlers(ipcMain: Electron.IpcMain) {
  // Future TECTONIUM API Channel
  ipcMain.handle('tectonium:trigger-agent', async (event, payload) => {
     console.log("[Tectonium RPC] Received autonomous deployment request.");
     
     // Evaluate permissions
     const result = await agentExecutor.executeProposal(payload.workspaceId || 'default', payload.command);
     if (!result.allowed) {
        return { success: false, error: result.reason };
     }

     // If allowed, dispatch to active window for Human-in-the-loop review
     const win = require('electron').BrowserWindow.getAllWindows()[0];
     if (win && !win.isDestroyed()) {
        win.webContents.send('app:agent-propose', {
           id: Date.now().toString(),
           intent: payload.intent || 'Autonomous Execution',
           command: payload.command,
           riskLevel: payload.riskLevel || 'medium'
        });
        return { success: true, status: 'PENDING_CONFIRMATION' };
     }

     return { success: false, error: 'No active terminal window to execute proposal.' };
  });
}
