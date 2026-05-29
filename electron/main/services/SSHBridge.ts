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

    // Forward to sshHandler via IPC event or direct method call.
    // Using ipcMain.emit simulates the renderer sending the message, allowing sshHandler to process it naturally.
    ipcMain.emit('ssh-write', null, { sessionId, data: finalCommand });
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
