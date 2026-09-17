import { EventEmitter } from 'events';
import { ipcMain } from 'electron';
import { SecureCenter } from '../security/SecureCenter';

class SSHBridge extends EventEmitter {
  private static instance: SSHBridge;

  private constructor() {
    super();
    // Allow up to 100 listeners to avoid warnings when multiple plugins are listening
    this.setMaxListeners(100);
  }

  public static getInstance(): SSHBridge {
    if (!SSHBridge.instance) {
      SSHBridge.instance = new SSHBridge();
    }
    return SSHBridge.instance;
  }

  /**
   * Broadcast data received from an SSH session to all listeners.
   * This is called by sshHandler when data arrives from ssh2 or pty.
   */
  public broadcastData(sessionId: string, chunk: string) {
    this.emit(`data:${sessionId}`, chunk);
  }

  /**
   * Write a command to the specified SSH session after auditing it.
   */
  public writeCommand(sessionId: string, command: string) {
    if (!SecureCenter.getInstance().auditPluginCommand(command)) {
      throw new Error(`[Security] SSH write command rejected by SecureCenter audit.`);
    }

    // Ensure the command ends with a newline to execute it
    const finalCommand = command.endsWith('\n') ? command : `${command}\n`;

    // 复用渲染进程那条 'ssh-write' 通道，但 ipcMain.emit 的 event 是 null。
    // 打上显式标记，让 sshHandler 能区分来源 —— 否则它只能靠形参位置猜，
    // 任何在那边加 event.sender 校验的改动都会把这条路径打成 TypeError。
    ipcMain.emit('ssh-write', null, { sessionId, data: finalCommand, __fromBridge: true });
  }

  /**
   * Called when a session is closed to clean up all listeners
   * registered for this session, preventing memory leaks.
   */
  public cleanupSession(sessionId: string) {
    this.removeAllListeners(`data:${sessionId}`);
  }
}

export const sshBridge = SSHBridge.getInstance();
